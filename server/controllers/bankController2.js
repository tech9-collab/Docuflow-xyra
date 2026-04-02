// controllers/bankController2.js
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import {
    startJob,
    startJobWithMode,
    getStatus,
    getResult,
    fetchProcessedJSON,
    pipeProcessedExcelByJob,
} from "../services/razor.js";

/* ---------------- small utils ---------------- */
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const HDR = (res, msg, code = 400) => res.status(code).json({ message: msg });

// Convenience memory (not authoritative across restarts)
const JOBS = new Map(); // jobId/groupId -> meta

/* ---------- PDF utils ---------- */
async function countPdfPages(buffer) {
    const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
    return pdf.getPageCount();
}
async function slicePdf(buffer, startPageIdx, endPageIdx) {
    const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const dst = await PDFDocument.create();
    const idx = [];
    for (let i = startPageIdx; i < Math.min(endPageIdx, src.getPageCount()); i++) idx.push(i);
    const pages = await dst.copyPages(src, idx);
    pages.forEach((p) => dst.addPage(p));
    return await dst.save();
}

/* ---------- robust main-table extractor ---------- */
/**
 * Goal: pick the single transaction table (spread across pages),
 * keep the EXACT header text & order from the PDF, and merge rows.
 *
 * Strategy
 * 1) If vendor returns `transactions[]`, use it as-is (exact key order from first row).
 * 2) Else, walk `tables[]`:
 *    - Determine a canonical header by majority* of normalized header-sets across pages.
 *    - Skip repeated header rows that re-appear on new pages.
 *    - Accept rows that match canonical width; align objects by header name.
 */
function extractSingleTransactionTable(payload) {
    const root = payload?.data ?? payload;

    // 1) Native transactions[]
    if (Array.isArray(root?.transactions) && root.transactions.length) {
        const keys = Object.keys(root.transactions[0]);
        const rows = root.transactions.map((r) => keys.map((k) => clean(r?.[k])));
        return { headers: keys, rows };
    }

    // 2) Assemble from tables[]
    const tables = Array.isArray(root?.tables) ? root.tables : [];
    if (!tables.length) return { headers: [], rows: [] };

    // Normalize helpers
    const norm = (x) => clean(x).toLowerCase();
    const normArr = (arr) => (arr || []).map(norm);
    const joinKey = (arr) => normArr(arr).join("|");

    // Collect header candidates
    const counts = new Map();    // key -> {count, rows}
    const samples = [];          // keep original refs

    for (const t of tables) {
        const hdr = (t.headers || t.header || t.columns || []).map(clean);
        let key = "";
        if (hdr.length) key = joinKey(hdr);
        else if (Array.isArray(t.rows?.[0])) key = joinKey(t.rows[0].map((c) => clean(c?.text ?? c)));
        if (!key) continue;
        const prev = counts.get(key) || { count: 0, rows: 0, headers: hdr };
        counts.set(key, { count: prev.count + 1, rows: prev.rows + (t.rows?.length || t.data?.length || t.body?.length || 0), headers: hdr });
        samples.push({ key, t });
    }

    // Choose canonical header: most frequent, tie-break by total rows
    let canonicalKey = null, canonicalMeta = null;
    for (const [k, v] of counts.entries()) {
        if (!canonicalMeta ||
            v.count > canonicalMeta.count ||
            (v.count === canonicalMeta.count && v.rows > canonicalMeta.rows)) {
            canonicalKey = k; canonicalMeta = v;
        }
    }
    let headers = canonicalMeta?.headers && canonicalMeta.headers.length
        ? canonicalMeta.headers
        : (tables[0].headers || tables[0].header || tables[0].columns || []).map(clean);

    if (!headers.length) {
        const guessLen = Array.isArray(tables[0].rows?.[0]) ? tables[0].rows[0].length : 0;
        headers = Array.from({ length: guessLen }, (_, i) => `Col ${i + 1}`);
    }

    // Helper: check if a row equals header (dedupe page headers)
    const isHeaderRow = (arr) => {
        if (!arr || arr.length !== headers.length) return false;
        for (let i = 0; i < headers.length; i++) {
            if (norm(arr[i]) !== norm(headers[i])) return false;
        }
        return true;
    };

    // Merge rows across all tables whose normalized header matches canonical
    const rows = [];
    const acceptKey = canonicalKey;
    for (const t of tables) {
        const cols = (t.headers || t.header || t.columns || []).map(clean);
        const thisKey = cols.length
            ? joinKey(cols)
            : (Array.isArray(t.rows?.[0]) ? joinKey(t.rows[0].map((c) => clean(c?.text ?? c))) : "");

        // Soft match: accept exact key or same width
        const accept =
            (acceptKey && thisKey && thisKey === acceptKey) ||
            (!thisKey && Array.isArray(t.rows?.[0]) && t.rows[0].length === headers.length) ||
            (cols.length && cols.length === headers.length);

        if (!accept) continue;

        // Prefer array-of-arrays
        if (Array.isArray(t.rows)) {
            for (const row of t.rows) {
                const cells = row.map((c) => clean(c?.text ?? c));
                if (cells.length === headers.length && isHeaderRow(cells)) continue; // skip repeated header
                // pad/truncate
                const fixed = headers.map((_, i) => clean(cells[i] ?? ""));
                rows.push(fixed);
            }
        }

        // Also support array-of-objects (data/body)
        const addObjRows = (arr) => {
            if (!Array.isArray(arr) || !arr.length) return;
            const keys = cols.length ? cols : Object.keys(arr[0] || {});
            for (const r of arr) {
                const obj = {};
                keys.forEach((k) => { obj[k] = clean(r?.[k]); });
                const fixed = headers.map((h) => clean(obj[h] ?? ""));
                if (fixed.length === headers.length && isHeaderRow(fixed)) continue;
                rows.push(fixed);
            }
        };
        addObjRows(t.data);
        addObjRows(t.body);
    }

    return { headers, rows };
}

/* ---------- SMART START ---------- */
export async function startSmart(req, res) {
    try {
        const f = req.file;
        if (!f) return HDR(res, "file is required");

        const pages = await countPdfPages(f.buffer);
        const name = f.originalname || "document.pdf";

        if (pages <= 15) {
            const jobId = await startJob(f.buffer, name, f.mimetype);
            JOBS.set(jobId, { originalName: name, startedAt: Date.now(), status: "started", type: "single", mode: "normal" });
            return res.json({ jobId, originalName: name, pages, mode: "normal" });
        }

        if (pages <= 30) {
            const jobId = await startJobWithMode(f.buffer, name, f.mimetype, "imageless");
            JOBS.set(jobId, { originalName: name, startedAt: Date.now(), status: "started", type: "single", mode: "imageless" });
            return res.json({ jobId, originalName: name, pages, mode: "imageless" });
        }

        // > 30 pages → chunk
        const CHUNK = 30;
        const groupId = `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        const parts = [];

        for (let start = 0; start < pages; start += CHUNK) {
            const end = Math.min(start + CHUNK, pages);
            const chunkBuf = await slicePdf(f.buffer, start, end);
            const label = `${name.replace(/\.pdf$/i, "")}_${start + 1}-${end}.pdf`;
            const jobId = await startJobWithMode(chunkBuf, label, f.mimetype, "imageless");
            parts.push({ jobId, start: start + 1, end });
            JOBS.set(jobId, { originalName: name, startedAt: Date.now(), status: "started", type: "part", groupId });
        }

        JOBS.set(groupId, { originalName: name, type: "group", parts: parts.map(p => p.jobId), pages, mode: "imageless" });
        return res.json({ groupId, parts, originalName: name, pages, mode: "imageless" });
    } catch (e) {
        console.error("bank.startSmart:", e?.response?.data || e.message);
        res.status(500).json({ message: "Failed to start (smart) extraction" });
    }
}

/* ---------- Legacy start ---------- */
export async function start(req, res) {
    try {
        const f = req.file;
        if (!f) return HDR(res, "file is required");
        const jobId = await startJob(f.buffer, f.originalname, f.mimetype);
        JOBS.set(jobId, { originalName: f.originalname, startedAt: Date.now(), status: "started", type: "single" });
        res.json({ jobId, originalName: f.originalname });
    } catch (e) {
        console.error("bank.start:", e?.response?.data || e.message);
        res.status(500).json({ message: "Failed to start extraction" });
    }
}

/* ---------- STATUS (jobId or groupId) ---------- */
export async function status(req, res) {
    try {
        const { id } = req.params;
        const meta = JOBS.get(id);

        if (meta?.type === "group") {
            const statuses = [];
            let done = 0, failed = 0;
            for (const jid of meta.parts || []) {
                try {
                    const st = await getStatus(jid);
                    const s = String(st?.status || "").toLowerCase();
                    statuses.push({ jobId: jid, status: s });
                    if (s === "completed") done++;
                    if (s === "failed" || s === "error") failed++;
                } catch {
                    statuses.push({ jobId: jid, status: "error" });
                    failed++;
                }
            }
            const overall = failed ? "error" : (done === (meta.parts || []).length ? "completed" : "processing");
            return res.json({ status: overall, parts: statuses });
        }

        const st = await getStatus(id);
        const status = String(st?.status || "").toLowerCase();
        const j = JOBS.get(id);
        if (j) j.status = status;
        res.json({ status });
    } catch (e) {
        console.error("bank.status:", e?.response?.data || e.message);
        res.status(500).json({ status: "error", message: "status check failed" });
    }
}

/* ---------- RESULT (jobId or groupId) ---------- */
export async function result(req, res) {
    try {
        const { id } = req.params;
        const meta = JOBS.get(id);

        const collect = async (jobId) => {
            const r = await getResult(jobId);
            const jsonUrl = r?.processed_json_url || r?.data?.processed_json_url;
            if (!jsonUrl) throw new Error("processed_json_url not ready yet");
            const processed = await fetchProcessedJSON(jsonUrl);
            const { headers, rows } = extractSingleTransactionTable(processed);
            const objs = rows.map((arr) => Object.fromEntries(headers.map((h, i) => [h, clean(arr[i])])));
            return { headers, rows: objs };
        };

        let headers = null;
        let allRows = [];

        if (meta?.type === "group") {
            for (const jid of meta.parts || []) {
                const part = await collect(jid);
                if (!headers) headers = part.headers;
                if (headers.join("|") !== part.headers.join("|")) {
                    // Align mismatched parts by header name
                    part.rows.forEach((r) => {
                        const aligned = {};
                        headers.forEach((h) => (aligned[h] = r[h] ?? ""));
                        allRows.push(aligned);
                    });
                } else {
                    allRows = allRows.concat(part.rows);
                }
            }
            const baseName = (meta.originalName || "bank_statements").replace(/\.[^/.]+$/, "");
            return res.json({
                title: "Bank Statement Results",
                jobId: id,
                columns: headers.map((h) => ({ key: h, label: h })),
                rows: allRows,
                downloadFileName: `${baseName}.xlsx`,
            });
        }

        // Single job
        const part = await collect(id);
        headers = part.headers;
        allRows = part.rows;
        const baseName = (JOBS.get(id)?.originalName || "bank_statements").replace(/\.[^/.]+$/, "");
        res.json({
            title: "Bank Statement Results",
            jobId: id,
            columns: headers.map((h) => ({ key: h, label: h })),
            rows: allRows,
            downloadFileName: `${baseName}.xlsx`,
        });
    } catch (e) {
        const code = /not ready/i.test(String(e?.message || "")) ? 425 : 500;
        console.error("bank.result:", e?.response?.data || e.message);
        res.status(code).json({ message: "Failed to fetch result" });
    }
}

/* ---------- Vendor Excel (single job only) ---------- */
export async function excelByJob(req, res) {
    try {
        const { id } = req.params;
        const meta = JOBS.get(id);
        if (meta?.type === "group") return HDR(res, "Not supported for groups. Use /excel/rebuild/:id", 400);
        const safe = (JOBS.get(id)?.originalName || "bank_statements").replace(/\.[^/.]+$/, "");
        await pipeProcessedExcelByJob(id, res, `${safe}.xlsx`);
    } catch (e) {
        console.error("bank.excelByJob:", e?.response?.data || e.message);
        res.status(500).json({ message: "Excel download failed" });
    }
}

/* ---------- One-sheet Transactions Excel (jobId or groupId) ---------- */
export async function excelRebuild(req, res) {
    try {
        const { id } = req.params;
        const meta = JOBS.get(id);

        const collect = async (jobId) => {
            const r = await getResult(jobId);
            const jsonUrl = r?.processed_json_url || r?.data?.processed_json_url;
            if (!jsonUrl) throw new Error("processed_json_url not ready yet");
            const processed = await fetchProcessedJSON(jsonUrl);
            return extractSingleTransactionTable(processed); // { headers, rows }
        };

        let headers = null;
        let rows = [];

        if (meta?.type === "group") {
            for (const jid of meta.parts || []) {
                const part = await collect(jid);
                if (!headers) headers = part.headers;
                if (headers.join("|") !== part.headers.join("|")) {
                    const idxMap = headers.map((h) => part.headers.indexOf(h));
                    part.rows.forEach((r) => rows.push(headers.map((_, i) => clean(idxMap[i] >= 0 ? r[idxMap[i]] : ""))));
                } else {
                    rows = rows.concat(part.rows);
                }
            }
        } else {
            const part = await collect(id);
            headers = part.headers;
            rows = part.rows;
        }

        // Build ONE worksheet named "Transactions"
        const wb = new ExcelJS.Workbook();
        wb.creator = "Bank Parser";
        wb.created = new Date();

        const ws = wb.addWorksheet("Transactions", { views: [{ state: "frozen", ySplit: 1 }] });

        // Header (exact labels/order)
        ws.addRow(headers);
        const headerRow = ws.getRow(1);
        headerRow.font = { bold: true };
        headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF3F8" } };
        headerRow.alignment = { vertical: "middle", horizontal: "left", wrapText: true };

        // Data rows (skip duplicate headers automatically)
        for (const arr of rows) ws.addRow(arr);

        // Borders, zebra, alignment, approx auto-width
        const totalRows = ws.rowCount;
        const totalCols = headers.length;

        for (let c = 1; c <= totalCols; c++) {
            let maxLen = clean(headers[c - 1]).length;
            for (let r = 2; r <= totalRows; r++) {
                const v = ws.getCell(r, c).value ?? "";
                maxLen = Math.max(maxLen, String(v).length);
            }
            ws.getColumn(c).width = Math.min(Math.max(maxLen + 2, 12), 48);
        }

        for (let r = 1; r <= totalRows; r++) {
            const row = ws.getRow(r);
            if (r !== 1 && r % 2 === 0) {
                row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FBFD" } };
            }
            for (let c = 1; c <= totalCols; c++) {
                const cell = ws.getCell(r, c);
                cell.border = {
                    top: { style: "thin", color: { argb: "FFCDD2D7" } },
                    left: { style: "thin", color: { argb: "FFCDD2D7" } },
                    bottom: { style: "thin", color: { argb: "FFCDD2D7" } },
                    right: { style: "thin", color: { argb: "FFCDD2D7" } },
                };
                const val = cell.value;
                const isNum = typeof val === "number" || /^-?\d[\d,\s]*(\.\d+)?$/.test(String(val ?? "").trim());
                cell.alignment = { vertical: "middle", horizontal: isNum ? "right" : "left", wrapText: true };
            }
        }

        const baseName = (meta?.originalName || JOBS.get(id)?.originalName || "bank_statements")
            .replace(/\.[^/.]+$/, "");
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${baseName}.xlsx"`);
        await wb.xlsx.write(res);
        res.end();
    } catch (e) {
        console.error("bank.excelRebuild:", e?.response?.data || e.message);
        res.status(/not ready/i.test(String(e?.message || "")) ? 425 : 500)
            .json({ message: "Excel rebuild failed" });
    }
}
