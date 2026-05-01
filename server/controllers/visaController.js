// controllers/visaController.js
import multer from "multer";
import XLSX from "xlsx-js-style";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import path from "path";
import os from "os";

import { uploadBufferToGemini, extractJsonFromFile } from "../lib/gemini.js";
import { VISA_SYSTEM_PROMPT, VISA_USER_PROMPT } from "../lib/visaPrompt.js";
import { VISA_COLUMNS, normalizeVisaJson } from "../lib/visaNormalize.js";
import { updateDocumentCount } from "../initDatabase.js";
import {
    buildVisaLocalPath,
    writeBufferLocal,
    writeJsonLocal,
    withExt,
    safeName,
} from "../lib/localStorage.js";
import { compressPdfWithGs } from "../compressor/gsCompress.js"; // same helper used in other modules

const CONCURRENCY = Number(process.env.VISA_CONCURRENCY || 6);
const SPLIT_MODE = (process.env.VISA_SPLIT_PDFS || "smart").toLowerCase();

// temp workspace (for PDF compression & split)
const TMP_DIR_NAME = `visa_jobs-${
  (typeof process.getuid === "function" && process.getuid()) || "default"
}`;
const TMP_DIR = path.join(os.tmpdir(), TMP_DIR_NAME);
await fs.mkdir(TMP_DIR, { recursive: true, mode: 0o700 });

export const upload = multer({
    storage: multer.memoryStorage(), // we’ll write buffers to disk when needed
    limits: { files: 300, fileSize: 40 * 1024 * 1024 },
}).array("files", 300);

const JOBS = new Map();

/** POST /api/visa/jobs/start */
export async function startJob(req, res) {
    try {
        const files = req.files || [];
        if (!files.length) return res.status(400).json({ message: "No files uploaded." });

        // size & page count (for analytics)
        const totalFileSize = files.reduce(
            (acc, f) => acc + (f.size || f.buffer?.length || 0),
            0
        );

        let totalPageCount = 0;
        try {
            for (const f of files) {
                const isPdf = f.mimetype === "application/pdf" || (f.originalname || "").toLowerCase().endsWith(".pdf");
                if (isPdf) {
                    totalPageCount += await getPdfPageCount(f.buffer);
                } else {
                    totalPageCount += 1;
                }
            }
        } catch (e) {
            console.warn("VISA page count fallback:", e?.message);
            totalPageCount = files.length;
        }

        const fileNames = files.map((f) => f.originalname).join(", ");

        const jobId = uuidv4();
        JOBS.set(jobId, {
            state: "queued",
            message: "Queued",
            total_files: files.length,
            processed_files: 0,
            progress_pct: 0,
            files,
            preview: { columns: VISA_COLUMNS, rows: [] },
            resultBuffer: null,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            userId: req.user.id,
            totalFileSize,
            fileNames,
            totalPageCount,
        });

        processJob(jobId).catch((err) => {
            const j = JOBS.get(jobId);
            if (j) {
                j.state = "error";
                j.message = err?.message || "Processing failed.";
            }
        });

        res.json({ job_id: jobId });
    } catch (e) {
        console.error("visa startJob error:", e);
        res.status(500).json({ message: e?.message || "Failed to start job." });
    }
}

/** GET /api/visa/jobs/status/:id */
export function jobStatus(req, res) {
    const job = JOBS.get(req.params.id);
    if (!job) return res.status(404).json({ message: "Not found" });
    res.json({
        state: job.state,
        message: job.message,
        total_files: job.total_files,
        processed_files: job.processed_files,
        progress_pct: job.progress_pct,
    });
}

/** GET /api/visa/jobs/preview/:id */
export function jobPreview(req, res) {
    const job = JOBS.get(req.params.id);
    if (!job) return res.status(404).json({ message: "Not found" });
    if (job.state !== "done") return res.status(400).json({ message: "Preview not ready." });
    res.json({
        title: "UAE Visa Results",
        downloadFileName: "uae_visa.xlsx",
        columns: VISA_COLUMNS,
        rows: job.preview.rows,
    });
}

/** GET /api/visa/jobs/result/:id */
export function jobResult(req, res) {
    const job = JOBS.get(req.params.id);
    if (!job) return res.status(404).json({ message: "Not found" });
    if (job.state !== "done" || !job.resultBuffer) {
        return res.status(400).json({ message: "Result not ready." });
    }
    const fname = "uae_visa.xlsx";
    res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.send(job.resultBuffer);
    res.on("finish", () => JOBS.delete(req.params.id));
}

/* ---------------- internals ---------------- */
async function processJob(jobId) {
    const job = JOBS.get(jobId);
    if (!job) return;

    job.state = "running";
    job.message = "Preparing files…";

    // 1) Preprocess each file:
    //    - PDF → compress via Ghostscript, then split (smart/always/never)
    //    - Images → re-encode to JPEG (max 2000px, q=78)
    //    We keep everything in memory (buffers), but we’ll also persist
    //    each processed input into uploads/visa/uploads/... before OCR.
    const expanded = [];
    for (const f of job.files) {
        const isPdf =
            f.mimetype === "application/pdf" ||
            (f.originalname || "").toLowerCase().endsWith(".pdf");

        if (isPdf) {
            // write buffer to temp file → compress → read back
            let pdfBuf = f.buffer;
            try {
                const tmpIn = path.join(TMP_DIR, `${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
                const tmpOut = path.join(TMP_DIR, `${Date.now()}-${Math.random().toString(36).slice(2)}-c.pdf`);
                await fs.writeFile(tmpIn, pdfBuf);
                const compressedPath = await compressPdfWithGs(tmpIn, {
                    pdfSettings: "/ebook",
                    compatibilityLevel: "1.6",
                    dpi: 110,
                    outPath: tmpOut,
                });
                if (compressedPath) {
                    pdfBuf = await fs.readFile(compressedPath);
                }
                // cleanup
                try { await fs.unlink(tmpIn); } catch { }
                try { await fs.unlink(tmpOut); } catch { }
            } catch (err) {
                console.warn("VISA PDF compression failed, using original:", err?.message || err);
            }

            if (SPLIT_MODE === "always") {
                expanded.push(...(await splitPdf(pdfBuf, f.originalname)));
            } else if (SPLIT_MODE === "never") {
                expanded.push({
                    originalname: f.originalname,
                    mimetype: "application/pdf",
                    buffer: pdfBuf,
                    groupId: null,
                });
            } else {
                const pg = await getPdfPageCount(pdfBuf);
                if (pg <= 2) {
                    expanded.push({
                        originalname: f.originalname,
                        mimetype: "application/pdf",
                        buffer: pdfBuf,
                        groupId: null,
                    });
                } else {
                    expanded.push(...(await splitPdf(pdfBuf, f.originalname)));
                }
            }
        } else {
            const out = await maybeCompressImage(f.buffer, f.mimetype); // JPEG buffer or null
            expanded.push({
                originalname: f.originalname,
                mimetype: out ? "image/jpeg" : f.mimetype,
                buffer: out || f.buffer,
                groupId: null,
            });
        }
    }

    job.files = expanded;
    job.total_files = expanded.length;
    job.processed_files = 0;
    job.progress_pct = 0;
    job.message = "Processing…";

    // 2) OCR + LLM + persist processed file & JSON
    const rowsWithGroups = [];
    const worker = async (file) => {
        if (!file?.buffer || !file?.mimetype) return;

        // 2a) Persist processed input file to uploads/visa/uploads/...
        const destUploadsRel = buildVisaLocalPath({
            type: "uploads",
            originalName: file.originalname,
        });
        await writeBufferLocal({ buffer: file.buffer, destRelPath: destUploadsRel });

        // 2b) Upload to Gemini
        job.message = `Uploading ${file.originalname}…`;
        const gFile = await uploadBufferToGemini({
            buffer: file.buffer,
            filename: file.originalname,
            mimeType: file.mimetype,
        });

        // 2c) Extract JSON
        job.message = `Extracting ${file.originalname}…`;
        const gJSON = await extractJsonFromFile({
            file: gFile,
            systemPrompt: VISA_SYSTEM_PROMPT,
            userPrompt: VISA_USER_PROMPT,
        });

        if (gJSON?.__usage) {
            job.totalInputTokens += gJSON.__usage.inputTokens || 0;
            job.totalOutputTokens += gJSON.__usage.outputTokens || 0;
        }

        // 2d) Persist JSON alongside uploads/visa/json/...
        const baseSafe = safeName(file.originalname).replace(/\.[^.]+$/i, "");
        const jsonRel = withExt(
            buildVisaLocalPath({ type: "json", originalName: `${baseSafe}.json` }),
            ".json"
        );
        await writeJsonLocal({
            json: { source: file.originalname, record: gJSON || null },
            destRelPath: jsonRel,
        });

        // 2e) Normalize into a table row (skip totally empty)
        const empty =
            !gJSON?.id_number &&
            !gJSON?.file_number &&
            !gJSON?.passport_no &&
            !gJSON?.name;

        if (!empty) {
            const row = normalizeVisaJson(gJSON, file.originalname);
            rowsWithGroups.push({ row, groupId: file.groupId || null });
        }

        job.processed_files += 1;
        job.progress_pct = Math.round(
            (job.processed_files / job.total_files) * 100
        );
    };

    await runPool(job.files, CONCURRENCY, worker);

    // 3) Merge pages by source PDF (groupId) — images remain singles
    const mergedRows = mergeByGroup(rowsWithGroups);

    // 4) Build Excel workbook
    const wb = XLSX.utils.book_new();
    const order = VISA_COLUMNS.map((c) => c.key);
    XLSX.utils.book_append_sheet(wb, aoaSheet(order, mergedRows), "UAE Visa");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    // 5) finalize
    job.resultBuffer = buf;
    job.preview = { columns: VISA_COLUMNS, rows: mergedRows.slice(0, 200) };

    // Update document count now that we have token usage
    await updateDocumentCount(
        job.userId,
        job.total_files,
        job.totalFileSize,
        "visa",
        job.fileNames,
        job.totalPageCount,
        job.totalInputTokens,
        job.totalOutputTokens
    );

    job.state = "done";
    job.message = "Completed";
    job.files = [];
}

/* ---- helpers ---- */
async function getPdfPageCount(buffer) {
    const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
    return src.getPageCount();
}

async function splitPdf(buffer, originalName = "doc.pdf") {
    const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const base = (originalName || "doc.pdf").replace(/\.pdf$/i, "");
    const groupId = `pdf:${base}`;
    const pages = [];
    for (let i = 0; i < src.getPageCount(); i++) {
        const pdf = await PDFDocument.create();
        const [p] = await pdf.copyPages(src, [i]);
        pdf.addPage(p);
        const bytes = await pdf.save();
        pages.push({
            originalname: `${base}-p${i + 1}.pdf`,
            mimetype: "application/pdf",
            buffer: Buffer.from(bytes),
            groupId,
        });
    }
    return pages;
}

async function maybeCompressImage(buffer, mime) {
    try {
        if (!mime?.startsWith("image/")) return null;
        const img = sharp(buffer, { limitInputPixels: 268435456 });
        const meta = await img.metadata();
        const w = meta.width || 0, h = meta.height || 0;
        const longest = Math.max(w, h);
        const pipeline = longest > 2000
            ? img.resize({ width: w >= h ? 2000 : undefined, height: h > w ? 2000 : undefined })
            : img;
        return await pipeline.jpeg({ quality: 78, mozjpeg: true }).toBuffer();
    } catch {
        return null;
    }
}

async function runPool(items, limit, worker) {
    let i = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
            const idx = i++;
            if (idx >= items.length) break;
            try { await worker(items[idx]); } catch { /* swallow and continue */ }
        }
    });
    await Promise.all(runners);
}

function mergeRowValues(a, b) {
    const pick = (x, y) => (x !== null && x !== undefined && x !== "" ? x : y ?? null);
    const out = { ...a };
    for (const k of Object.keys(b)) {
        if (k === "SOURCE") continue;
        out[k] = pick(out[k], b[k]);
    }
    const srcA = a?.SOURCE ? String(a.SOURCE) : "";
    const srcB = b?.SOURCE ? String(b.SOURCE) : "";
    const joined = [srcA, srcB].filter(Boolean);
    out.SOURCE = joined.length ? Array.from(new Set(joined)).join(", ") : null;
    return out;
}

function mergeByGroup(rowsWithGroups) {
    const byGroup = new Map();
    const singles = [];
    for (const it of rowsWithGroups) {
        if (!it.groupId) { singles.push(it.row); continue; }
        if (!byGroup.has(it.groupId)) byGroup.set(it.groupId, it.row);
        else byGroup.set(it.groupId, mergeRowValues(byGroup.get(it.groupId), it.row));
    }
    return [...Array.from(byGroup.values()), ...singles];
}

function aoaSheet(order, rows) {
    const data = [order, ...rows.map((r) => order.map((k) => (r[k] === undefined ? null : r[k])))];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = order.map((k) => ({ wch: Math.max(12, Math.min(38, k.length + 4)) }));
    const widen = (k, w) => { const i = order.indexOf(k); if (i !== -1) ws["!cols"][i] = { wch: w }; };
    widen("NAME", 28); widen("EMPLOYER", 28); widen("PROFESSION", 22); widen("SOURCE", 30);

    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r: 0, c });
        ws[addr].s = {
            font: { bold: true },
            alignment: { horizontal: "center", vertical: "center", wrapText: true },
            fill: { fgColor: { rgb: "F2F2F2" } },
        };
    }
    ws["!freeze"] = { xSplit: "0", ySplit: "1", topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
    return ws;
}
