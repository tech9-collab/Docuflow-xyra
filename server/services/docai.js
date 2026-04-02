// services/docai.js
import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";

/* ---------------- env & client ---------------- */
const {
    GCP_PROJECT_ID,
    GCP_LOCATION,
    DOCAI_PROCESSOR_ID,
} = process.env;

const client = new DocumentProcessorServiceClient();

/* ---------------- page limits ---------------- */
// Target behavior from requirements:
// - up to 15 pages: normal sync
// - 16..30: imageless mode
// - >30: split into <=30-page parts; use imageless per part
const NON_IMAGELESS_MAX = 15;
const IMAGELESS_MAX = 30;

// Conservative shard size for fallback re-splitting when a processor enforces 15/shard.
const SHARD_FALLBACK = 15;

/* ---------------- in-memory job store ---------------- */
const JOBS = new Map(); // jobId -> { status, startedAt, doneAt, fileName, mimeType, resultJson, excelBuffer, downloadFileName }

/* ---------------- text helpers ---------------- */
const squashSpaces = (s) => String(s ?? "").replace(/[ \t\f\v]+/g, " ").replace(/\u00A0/g, " ").trim();

/**
 * Extract plain text from a Document AI textAnchor.
 * We JOIN internal newlines with a single space to satisfy:
 *  "If a description wraps to multiple lines in the PDF, keep all text in the same cell, separated by spaces."
 */
function textFromAnchorJoinSpaces(doc, anchor) {
    if (!anchor?.textSegments?.length) return "";
    const { text } = doc;
    let out = "";
    for (const seg of anchor.textSegments) {
        const start = Number(seg.startIndex || 0);
        const end = Number(seg.endIndex);
        out += text.substring(start, end);
    }
    return squashSpaces(out.replace(/[\r\n]+/g, " "));
}

/* ---------------- numeric parsing (typed JSON + numeric cells in Excel) --- */
function parseAmountToNumber(raw) {
    // Keep null for blanks
    const t = String(raw ?? "").trim();
    if (!t) return null;

    // Remove currency symbols and spaces around
    let s = t.replace(/[^\d.,()\-+]/g, "").replace(/\s+/g, "");

    // Parentheses denote negative
    let neg = false;
    if (s.startsWith("(") && s.endsWith(")")) {
        neg = true;
        s = s.slice(1, -1);
    }

    // Normalize thousand/decimal separators:
    // 1,234.56 | 1 234,56 | 1.234,56 → 1234.56
    // remove thousands separators
    s = s.replace(/(?<=\d)[,\s.](?=\d{3}(\D|$))/g, "");
    // Last comma likely decimal
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) s = s.replace(",", ".");

    // Now only digits, optional dot, optional leading sign
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return neg ? -n : n;
}

function isNumericHeader(h) {
    const s = h.toLowerCase();
    return (
        s.includes("debit") ||
        s.includes("credit") ||
        s.includes("amount") ||
        s.includes("balance") ||
        s.includes("withdrawal") ||
        s.includes("deposit")
    );
}

function isNumericLike(s) {
    const t = String(s ?? "").trim();
    if (!t) return false;
    let nrm = t.replace(/\s/g, "").replace(/(?<=\d)[,.](?=\d{3}(\D|$))/g, "");
    const lastComma = nrm.lastIndexOf(",");
    const lastDot = nrm.lastIndexOf(".");
    if (lastComma > lastDot) nrm = nrm.replace(",", ".");
    const n = Number(nrm.replace(/[^\d.\-+]/g, ""));
    return Number.isFinite(n) && /[0-9]/.test(t);
}

/* ---------------- header similarity helpers ---------------- */
const norm = (s) =>
    String(s ?? "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "") // strip diacritics
        .replace(/[\s\u00A0]+/g, " ")
        .replace(/[^a-z0-9\u0600-\u06FF ]/gi, "") // keep Arabic & alnum
        .trim();

function headerSim(a, b) {
    const A = new Set(norm(a).split(" ").filter(Boolean));
    const B = new Set(norm(b).split(" ").filter(Boolean));
    if (!A.size || !B.size) return 0;
    let inter = 0;
    A.forEach((x) => { if (B.has(x)) inter++; });
    return inter / Math.min(A.size, B.size);
}

function looksLikeHeaderRow(cells) {
    if (!cells || !cells.length) return false;
    const joined = squashSpaces(cells.join(" "));
    if (!joined) return false;
    const headerHints = /(date|transaction|desc|narration|particular|reference|ref|cheque|credit|debit|withdrawal|deposit|balance|amount|entries)/i;
    const amountish = /[-+]?\d[\d, ]*(\.\d+)?/;
    return headerHints.test(joined) && !amountish.test(joined);
}

/* ---------------- table extraction (tolerant, preserves PDF headers) ------ */
function extractTablesPreserveStructure(doc) {
    const cellText = (c) => textFromAnchorJoinSpaces(doc, c?.layout?.textAnchor);

    // Build mapping localHeaders -> masterHeader
    function buildIndexMap(masterHeader, localHeaders) {
        const usedLocal = new Set();
        const map = new Array(masterHeader.length).fill(-1);
        for (let mi = 0; mi < masterHeader.length; mi++) {
            let bestIdx = -1, bestScore = 0;
            for (let li = 0; li < localHeaders.length; li++) {
                if (usedLocal.has(li)) continue;
                const score = headerSim(masterHeader[mi], localHeaders[li]);
                if (score > bestScore) { bestScore = score; bestIdx = li; }
            }
            const exact = norm(masterHeader[mi]) === norm(localHeaders[bestIdx] || "");
            if (bestIdx !== -1 && (bestScore >= 0.45 || exact)) {
                map[mi] = bestIdx;
                usedLocal.add(bestIdx);
            }
        }
        return map;
    }

    let masterHeader = null;   // exact labels & order from first detected table
    const allRows = [];        // rows aligned to masterHeader (strings)

    (doc.pages || []).forEach((p) => {
        (p.tables || []).forEach((t) => {
            // 1) local headers
            let localHeaders = [];
            if (Array.isArray(t.headerRows) && t.headerRows.length) {
                localHeaders = t.headerRows[0].cells.map((c, idx) => squashSpaces(cellText(c) || `Col ${idx + 1}`));
            } else if (t.bodyRows?.[0]?.cells?.length) {
                const firstBody = t.bodyRows[0].cells.map((c) => squashSpaces(cellText(c)));
                if (looksLikeHeaderRow(firstBody)) {
                    localHeaders = firstBody;
                    t.__skipFirstBodyRowAsHeader = true;
                }
            } else {
                return; // empty table
            }

            // 2) seed master header once
            if (!masterHeader && localHeaders.length) {
                masterHeader = localHeaders.slice();
            }
            // fallback: infer from body width
            if (!masterHeader && t.bodyRows?.[0]?.cells?.length) {
                const count = t.bodyRows[0].cells.length;
                masterHeader = Array.from({ length: count }, (_, i) => `Col ${i + 1}`);
            }
            if (!masterHeader) return;

            const masterCount = masterHeader.length;
            const localCount = localHeaders.length || (t.bodyRows?.[0]?.cells?.length ?? 0);

            // 3) mapping local->master
            let indexMap = [];
            if (localHeaders.length) {
                indexMap = buildIndexMap(masterHeader, localHeaders);
            } else {
                indexMap = Array.from({ length: masterCount }, (_, mi) => (mi < localCount ? mi : -1));
            }

            // weak mapping? fall back to positional
            const mappedCount = indexMap.filter((x) => x !== -1).length;
            if (mappedCount < Math.ceil(masterCount * 0.4)) {
                indexMap = Array.from({ length: masterCount }, (_, mi) => (mi < localCount ? mi : -1));
            }

            // 4) rows
            (t.bodyRows || []).forEach((br, idx) => {
                if (idx === 0 && t.__skipFirstBodyRowAsHeader) return;

                const obj = {};
                for (let mi = 0; mi < masterCount; mi++) {
                    const li = indexMap[mi];
                    const val = li !== -1 && br.cells[li] ? cellText(br.cells[li]) : "";
                    obj[masterHeader[mi]] = val;
                }
                // drop blank
                if (!Object.values(obj).some((v) => squashSpaces(v))) return;
                allRows.push(obj);
            });
        });
    });

    return { header: masterHeader || [], rows: allRows };
}

/* ---------------- Build typed JSON transactions ----------------------------
   - Keep the same header names as PDF.
   - For numeric columns (by header name), convert to numbers (null if blank).
   - Dates remain strings in the same format as PDF (e.g., DD-MMM-YYYY).
---------------------------------------------------------------------------*/
function buildTransactionsJSON(header, stringRows) {
    const numericIdx = header.map((h) => isNumericHeader(h));
    const tx = [];

    for (const r of stringRows) {
        const obj = {};
        header.forEach((h, i) => {
            const raw = r[h] ?? "";
            if (numericIdx[i]) {
                const n = parseAmountToNumber(raw);
                obj[h] = n;
            } else {
                obj[h] = String(raw);
            }
        });
        // skip rows that are entirely empty after typing
        if (Object.values(obj).some((v) => v !== null && String(v).trim() !== "")) {
            tx.push(obj);
        }
    }
    return tx;
}

/* ---------------- Excel writer: single sheet "Transactions" ---------------- */
async function toStyledExcelTransactions({ header, stringRows, fileBase = "Transactions" }) {
    const wb = new ExcelJS.Workbook();
    wb.creator = "DocAI Parser";
    wb.created = new Date();

    const ws = wb.addWorksheet("Transactions");

    // Decide which columns are numeric (by header name)
    const numericCol = header.map((h) => isNumericHeader(h));

    // Header
    ws.addRow(header);
    const hdr = ws.getRow(1);
    hdr.font = { bold: true };
    hdr.alignment = { vertical: "middle", horizontal: "center" };
    hdr.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F0F0" } };
        cell.border = {
            top: { style: "thin" }, left: { style: "thin" },
            bottom: { style: "thin" }, right: { style: "thin" },
        };
    });
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.properties.defaultRowHeight = 18;

    // Body rows: write numbers as numbers (for numeric columns), others as strings
    for (const r of stringRows) {
        const vals = header.map((h, idx) => {
            const raw = r[h] ?? "";
            if (numericCol[idx]) {
                const n = parseAmountToNumber(raw);
                return n === null ? null : n;
            }
            return String(raw);
        });

        const added = ws.addRow(vals);

        const isAlt = added.number % 2 === 0;
        added.eachCell((cell, colNumber) => {
            if (isAlt) {
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFF" } };
            }
            cell.border = {
                top: { style: "thin" }, left: { style: "thin" },
                bottom: { style: "thin" }, right: { style: "thin" },
            };
            const right = numericCol[colNumber - 1];
            cell.alignment = {
                vertical: "middle",
                horizontal: right ? "right" : "left",
                wrapText: true,
            };
            // Dates remain strings as seen in the PDF; we don't force a date number format.
        });
    }

    // Auto-fit width (consider longest line per cell)
    ws.columns.forEach((col) => {
        let max = 10;
        col.eachCell({ includeEmpty: true }, (c) => {
            const s = c.value == null ? "" : String(c.value);
            const longest = s.split(/\r?\n/).reduce((m, ln) => Math.max(m, ln.length), 0);
            max = Math.max(max, Math.min(60, longest + 2));
        });
        col.width = max;
    });

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
}

/* ---------------- PDF splitting ------------------------------------------ */
export async function getPdfPageCount(buf) {
    const pdf = await PDFDocument.load(buf, { updateMetadata: false });
    return pdf.getPageCount();
}

async function splitPdfIntoChunks(buf, size) {
    const src = await PDFDocument.load(buf, { updateMetadata: false });
    const total = src.getPageCount();
    const chunks = [];
    for (let start = 0; start < total; start += size) {
        const end = Math.min(start + size, total);
        const target = await PDFDocument.create();
        const pages = await target.copyPages(
            src,
            Array.from({ length: end - start }, (_, i) => start + i)
        );
        pages.forEach((p) => target.addPage(p));
        const out = await target.save();
        chunks.push({ start, end, buffer: Buffer.from(out), pageCount: end - start });
    }
    return { total, chunks };
}

/* ---------------- Process ONE buffer (imageless-aware) -------------------- */
async function processOneBufferWithDocAI(fileBuffer, mimeType = "application/pdf", { imageless = false } = {}) {
    const name = `projects/${GCP_PROJECT_ID}/locations/${GCP_LOCATION}/processors/${DOCAI_PROCESSOR_ID}`;

    const buildRequest = (useImageless) => ({
        name,
        rawDocument: { content: fileBuffer.toString("base64"), mimeType },
        imagelessMode: !!useImageless, // raises sync limit to 30 (when supported)
    });

    try {
        const [result] = await client.processDocument(buildRequest(imageless));
        const doc = result.document;
        const { header, rows } = extractTablesPreserveStructure(doc);
        const pages = Array.isArray(doc.pages) ? doc.pages.length : 0;
        return { header, rows, pages };
    } catch (err) {
        const msg = String(err?.message || "");
        const code = err?.code;
        const shardLimit =
            code === 13 ||
            msg.includes("supports up to 15 pages per document shard") ||
            msg.includes("PAGE_LIMIT_EXCEEDED") ||
            msg.includes("exceed the limit");
        if (!imageless && shardLimit) {
            // Retry once with imageless if not already
            const [result] = await client.processDocument(buildRequest(true));
            const doc = result.document;
            const { header, rows } = extractTablesPreserveStructure(doc);
            const pages = Array.isArray(doc.pages) ? doc.pages.length : 0;
            return { header, rows, pages };
        }
        // signal shard issue to caller for re-split if imageless also fails
        if (shardLimit) {
            return { header: null, rows: null, pages: 0, _shardLimit: true };
        }
        throw err;
    }
}

/* ---------------- Public API: runDocAIFromBuffer --------------------------
   - <=15 pages: regular
   - 16..30: imageless
   - >30: split into <=30-page parts (imageless), merge
   - If a processor still enforces 15/shard, re-split that part to <=15 and retry.
---------------------------------------------------------------------------*/
export async function runDocAIFromBuffer(fileBuffer, mimeType = "application/pdf") {
    const isPdf = (mimeType || "").toLowerCase().includes("pdf");
    if (!isPdf) {
        return await processOneBufferWithDocAI(fileBuffer, mimeType);
    }

    const total = await getPdfPageCount(fileBuffer);

    // Single call paths
    if (total <= NON_IMAGELESS_MAX) {
        return await processOneBufferWithDocAI(fileBuffer, mimeType, { imageless: false });
    }
    if (total <= IMAGELESS_MAX) {
        const res = await processOneBufferWithDocAI(fileBuffer, mimeType, { imageless: true });
        if (!res._shardLimit) return res;
        // If even imageless failed due to shard policy, fall back to split into 15s.
        const fallback = await splitPdfIntoChunks(fileBuffer, SHARD_FALLBACK);
        return await processAndMergeChunks(fallback.chunks);
    }

    // >30 pages → split into 30-page parts (imageless)
    const { chunks } = await splitPdfIntoChunks(fileBuffer, IMAGELESS_MAX);
    return await processAndMergeChunks(chunks, /*preferImageless*/ true);
}

async function processAndMergeChunks(chunks, preferImageless = true) {
    let masterHeader = null;
    const mergedRows = [];

    for (const chunk of chunks) {
        // First attempt (imageless for 16..30, regular for <=15)
        const preferImagelessForChunk = preferImageless || chunk.pageCount > NON_IMAGELESS_MAX;
        let work = [{ buffer: chunk.buffer, pages: chunk.pageCount, imageless: preferImagelessForChunk }];

        // Re-splitting loop if shard error persists
        while (work.length) {
            const part = work.shift();
            const res = await processOneBufferWithDocAI(part.buffer, "application/pdf", { imageless: !!part.imageless });

            if (res._shardLimit) {
                // Split further (<=15) and retry
                const cap = Math.max(1, Math.min(part.pages || SHARD_FALLBACK, SHARD_FALLBACK));
                const sub = await splitPdfIntoChunks(part.buffer, cap);
                if (!sub.chunks.length || sub.chunks.length === 1) {
                    // give up to avoid looping
                    continue;
                }
                sub.chunks.forEach(sc => work.push({ buffer: sc.buffer, pages: sc.pageCount, imageless: false }));
                continue;
            }

            const { header, rows } = res;
            if (!masterHeader && header?.length) {
                masterHeader = header.slice();
            }
            if (rows && rows.length) {
                mergedRows.push(...rows);
            }
        }
    }

    return { header: masterHeader || [], rows: mergedRows };
}

/* ---------------- Job-based API (used by controller) --------------------- */
export async function startJob(fileBuffer, originalName, mimeType) {
    const jobId = randomUUID();
    JOBS.set(jobId, {
        status: "started",
        startedAt: Date.now(),
        fileName: originalName,
        mimeType,
    });

    setImmediate(async () => {
        try {
            const { header, rows } = await runDocAIFromBuffer(fileBuffer, mimeType);

            // Build JSON transactions with typed numeric fields
            const transactions = buildTransactionsJSON(header, rows);

            // Excel: one sheet "Transactions"
            const fileBase = (originalName || "Transactions").replace(/\.[^/.]+$/, "");
            const excelBuffer = await toStyledExcelTransactions({
                header, stringRows: rows, fileBase,
            });

            const resultJson = {
                title: "Transactions",
                jobId,
                // UI preview table (same headers/order)
                tableTable: {
                    columns: (header || []).map((h) => ({ key: h, label: h })),
                    rows, // string rows for visual fidelity
                },
                // Typed JSON output as requested
                transactions,
                meta: { fileName: originalName },
            };

            JOBS.set(jobId, {
                ...JOBS.get(jobId),
                status: "done",
                doneAt: Date.now(),
                resultJson,
                excelBuffer,
                downloadFileName: `${fileBase}.xlsx`,
            });
        } catch (err) {
            console.error("DocAI process failed:", err?.response?.data || err);
            JOBS.set(jobId, {
                ...JOBS.get(jobId),
                status: "error",
                error: String(err?.message || err),
            });
        }
    });

    return jobId;
}

export async function getStatus(jobId) {
    const j = JOBS.get(jobId);
    if (!j) return { status: "unknown" };
    return { status: j.status };
}

export async function getResult(jobId) {
    const j = JOBS.get(jobId);
    if (!j) throw new Error("Unknown jobId");
    if (j.status !== "done") return { status: j.status };
    return {
        status: "done",
        data: {
            processed_json_url: `memory://${jobId}/json`,
            processed_excel_url: `memory://${jobId}/excel`,
            downloadFileName: j.downloadFileName || "Transactions.xlsx",
            title: j.resultJson?.title || "Transactions",
        },
    };
}

export async function fetchProcessedJSON(_urlOrId) {
    const m = String(_urlOrId).match(/memory:\/\/([^/]+)\/json/);
    const jobId = m?.[1] || _urlOrId;
    const j = JOBS.get(jobId);
    if (!j?.resultJson) throw new Error("Result not ready");
    return j.resultJson;
}

export async function pipeProcessedExcelByJob(jobId, res, fileName = "Transactions.xlsx") {
    const j = JOBS.get(jobId);
    if (!j?.excelBuffer) throw new Error("Excel not ready");
    res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    Readable.from(j.excelBuffer).pipe(res);
}
