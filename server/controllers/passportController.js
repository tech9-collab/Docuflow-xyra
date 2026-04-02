// controllers/passportController.js
import multer from "multer";
import XLSX from "xlsx-js-style";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";

import { uploadBufferToGemini, extractJsonFromFile } from "../lib/gemini.js";
import { PASSPORT_SYSTEM_PROMPT, PASSPORT_USER_PROMPT } from "../lib/passportPrompt.js";
import {
    PASSPORT_CORE_COLUMNS,
    normalizePassportJson,
    finalizePassportColumnsRows,
} from "../lib/passportNormalize.js";
import {
    updateDocumentCount,
    ensureModuleId,
    getUserDepartmentId,
    getOrCreateDefaultDepartmentId,
    createPassportConvert,                 // NEW
    setPassportConvertStatus,              // NEW
    setPassportConvertOutputJsonPath,      // NEW
} from "../initDatabase.js";

import {
    buildPassportLocalPath,                // NEW
    writeBufferLocal,                      // NEW
    writeJsonLocal,                        // already existed
    withExt,                               // already existed
} from "../lib/localStorage.js";

const CONCURRENCY = Number(process.env.PASSPORT_CONCURRENCY || 6);
const SPLIT_MODE = (process.env.PASSPORT_SPLIT_PDFS || "smart").toLowerCase();

export const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 300, fileSize: 40 * 1024 * 1024 },
}).array("files", 300);

const JOBS = new Map();

/** POST /api/passport/jobs/start */
export async function startJob(req, res) {
    try {
        const files = req.files || [];
        if (!files.length) return res.status(400).json({ message: "No files uploaded." });

        // Calculate total file size
        const totalFileSize = files.reduce((acc, file) => acc + (file.size || file.buffer?.length || 0), 0);

        // Create a list of file names
        const fileNames = files.map(f => f.originalname).join(", ");

        // Count pages for page count tracking
        let totalPageCount = 0;
        try {
            for (const file of files) {
                if (file.mimetype === "application/pdf" || (file.originalname || "").toLowerCase().endsWith(".pdf")) {
                    const pg = await getPdfPageCount(file.buffer);
                    totalPageCount += pg;
                } else {
                    totalPageCount += 1;
                }
            }
        } catch (e) {
            console.warn("Failed to count pages:", e?.message);
            totalPageCount = files.length;
        }

        const jobId = uuidv4();
        JOBS.set(jobId, {
            state: "queued",
            message: "Queued",
            total_files: files.length,
            processed_files: 0,
            progress_pct: 0,
            files,
            // NEW: track DB rows per expanded file
            records: [], // { originalname, inputRel, jsonRel, convertId }
            preview: { columns: [], rows: [] },
            resultBuffer: null,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            userId: req.user.id,
            totalFileSize,
            fileNames,
            totalPageCount,
        });

        processJob(jobId, req.user).catch(err => {
            const job = JOBS.get(jobId);
            if (job) {
                job.state = "error";
                job.message = err?.message || "Processing failed.";
            }
        });

        res.json({ job_id: jobId });
    } catch (e) {
        console.error("passport startJob error:", e);
        res.status(500).json({ message: e?.message || "Failed to start job." });
    }
}

/** GET /api/passport/jobs/status/:id */
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

/** GET /api/passport/jobs/preview/:id */
export function jobPreview(req, res) {
    const job = JOBS.get(req.params.id);
    if (!job) return res.status(404).json({ message: "Not found" });
    if (job.state !== "done") return res.status(400).json({ message: "Preview not ready." });
    res.json({
        title: "Passport Results",
        downloadFileName: "passports.xlsx",
        columns: job.preview.columns,
        rows: job.preview.rows,
    });
}

/** GET /api/passport/jobs/result/:id */
export function jobResult(req, res) {
    const job = JOBS.get(req.params.id);
    if (!job) return res.status(404).json({ message: "Not found" });
    if (job.state !== "done" || !job.resultBuffer) {
        return res.status(400).json({ message: "Result not ready." });
    }
    const fname = "passports.xlsx";
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.send(job.resultBuffer);
    res.on("finish", () => JOBS.delete(req.params.id));
}

/* ---------------- internals ---------------- */

async function processJob(jobId, user) {
    const job = JOBS.get(jobId);
    if (!job) return;

    job.state = "running";
    job.message = "Preparing files…";

    // Resolve module/department for DB rows
    const moduleId = await ensureModuleId("passport"); // NEW
    let departmentId = await getUserDepartmentId(user.id); // NEW
    if (!departmentId) departmentId = await getOrCreateDefaultDepartmentId(); // NEW

    // 1) Expand PDFs (smart) + compress images
    const expanded = [];
    for (const f of job.files) {
        const isPdf = f.mimetype === "application/pdf" || (f.originalname || "").toLowerCase().endsWith(".pdf");
        if (isPdf) {
            if (SPLIT_MODE === "always") {
                expanded.push(...(await splitPdf(f.buffer, f.originalname)));
            } else if (SPLIT_MODE === "never") {
                expanded.push({ originalname: f.originalname, mimetype: f.mimetype, buffer: f.buffer, groupId: null });
            } else {
                const pg = await getPdfPageCount(f.buffer);
                if (pg <= 2) {
                    expanded.push({ originalname: f.originalname, mimetype: f.mimetype, buffer: f.buffer, groupId: null });
                } else {
                    expanded.push(...(await splitPdf(f.buffer, f.originalname)));
                }
            }
        } else {
            const buf = await maybeCompressImage(f.buffer, f.mimetype);
            expanded.push({
                originalname: f.originalname,
                mimetype: buf ? "image/jpeg" : f.mimetype,
                buffer: buf || f.buffer,
                groupId: null,
            });
        }
    }

    // 1b) Persist every expanded file (uploads)
    const persisted = [];
    for (const f of expanded) {
        const inputRel = buildPassportLocalPath({ type: "uploads", originalName: f.originalname }); // NEW
        await writeBufferLocal({ buffer: f.buffer, destRelPath: inputRel });                       // NEW
        const convertId = await createPassportConvert({                                            // NEW
            userId: user.id,
            departmentId,
            moduleId,
            fileName: f.originalname,
            fileSize: f.buffer?.length || 0,
            fileInputPath: inputRel,
        });
        persisted.push({ ...f, inputRel, convertId });
    }

    job.files = persisted;
    job.total_files = persisted.length;
    job.processed_files = 0;
    job.progress_pct = 0;
    job.message = "Processing…";

    // 2) OCR in parallel
    const normalizedRows = [];
    const worker = async (file) => {
        if (!file?.buffer || !file?.mimetype) return;

        // DB status: extracting
        await setPassportConvertStatus(file.convertId, "extracting").catch(() => { });

        job.message = `Uploading ${file.originalname}…`;
        const gFile = await uploadBufferToGemini({
            buffer: file.buffer,
            filename: file.originalname,
            mimeType: file.mimetype,
        });

        job.message = `Extracting ${file.originalname}…`;
        let gJSON = null;
        try {
            gJSON = await extractJsonFromFile({
                file: gFile,
                systemPrompt: PASSPORT_SYSTEM_PROMPT,
                userPrompt: PASSPORT_USER_PROMPT,
            });
        } catch (err) {
            await setPassportConvertStatus(file.convertId, "failed", err?.message || "extract error").catch(() => { });
            throw err;
        }

        if (gJSON?.__usage) {
            job.totalInputTokens += gJSON.__usage.inputTokens || 0;
            job.totalOutputTokens += gJSON.__usage.outputTokens || 0;
        }

        const looksEmpty = !gJSON?.core?.passport_number && !gJSON?.core?.surname && !gJSON?.core?.given_names;
        if (!looksEmpty) {
            // Normalize → rows
            const row = normalizePassportJson(gJSON, file.originalname);
            normalizedRows.push(row);

            // Persist JSON alongside
            const jsonRel = withExt(
                buildPassportLocalPath({ type: "json", originalName: file.originalname }),
                ".json"
            );
            await writeJsonLocal({ json: gJSON, destRelPath: jsonRel }).catch(() => { });

            // DB: link JSON + status extracted
            await setPassportConvertOutputJsonPath(file.convertId, jsonRel, "extracted").catch(() => { });
        } else {
            // Even if empty, create a minimal JSON to help triage
            const jsonRel = withExt(
                buildPassportLocalPath({ type: "json", originalName: file.originalname }),
                ".json"
            );
            await writeJsonLocal({ json: { empty: true, note: "No core fields detected" }, destRelPath: jsonRel }).catch(
                () => { }
            );
            await setPassportConvertOutputJsonPath(file.convertId, jsonRel, "extracted").catch(() => { });
        }

        job.processed_files += 1;
        job.progress_pct = Math.round((job.processed_files / job.total_files) * 100);
    };

    await runPool(job.files, CONCURRENCY, worker);

    // 3) Build final columns+rows
    const { columns, rows } = finalizePassportColumnsRows(normalizedRows, { flattenExtras: true });

    // 4) Build Excel
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetFromObjects(rows, columns.map(c => c.key)), "Passports");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    // 5) finalize
    job.resultBuffer = buf;
    job.preview = { columns, rows: rows.slice(0, 200) };

    // Update document count now that we have token usage
    await updateDocumentCount(
        job.userId,
        job.total_files,
        job.totalFileSize,
        "passport",
        job.fileNames,
        job.totalPageCount,
        job.totalInputTokens,
        job.totalOutputTokens
    );

    job.state = "done";
    job.message = "Completed";
    job.files = [];
}

/* ----- helpers ----- */
async function getPdfPageCount(buffer) {
    const src = await PDFDocument.load(buffer);
    return src.getPageCount();
}

async function splitPdf(buffer, originalName = "doc.pdf") {
    const src = await PDFDocument.load(buffer);
    const base = originalName.replace(/\.pdf$/i, "");
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
        const needResize = longest > 2000;
        const pipeline = needResize
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
            try { await worker(items[idx]); } catch { /* keep going */ }
        }
    });
    await Promise.all(runners);
}

// a quick sheet builder matching your existing style
function sheetFromObjects(rows, order) {
    const headers = order;
    const data = [
        headers,
        ...rows.map((r) => order.map((k) => (r[k] === undefined ? null : r[k]))),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);

    ws["!cols"] = order.map((k) => ({ wch: Math.max(12, Math.min(38, k.length + 4)) }));
    const widen = (k, w) => { const i = order.indexOf(k); if (i !== -1) ws["!cols"][i] = { wch: w }; };
    widen("SURNAME", 24); widen("GIVEN_NAMES", 28); widen("PLACE_OF_BIRTH", 24); widen("PLACE_OF_ISSUE", 24); widen("SOURCE", 30);

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
