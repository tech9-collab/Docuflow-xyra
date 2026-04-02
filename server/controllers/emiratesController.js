// controllers/emiratesController.js
import multer from "multer";
import XLSX from "xlsx-js-style";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import path from "path";
import os from "os";

import { uploadPathToGemini, extractJsonFromFile } from "../lib/gemini.js";

import {
    EMIRATES_SYSTEM_PROMPT,
    EMIRATES_USER_PROMPT,
} from "../lib/emiratesIdPrompt.js";

import {
    EMIRATES_COLUMNS,
    normalizeEmiratesIdJson,
} from "../lib/emiratesIdNormalize.js";

import {
    buildEmiratesLocalPath,
    copyToLocal,
    writeJsonLocal,
    withExt,
    safeName,
} from "../lib/localStorage.js";

import {
    ensureModuleId,
    getUserDepartmentId,
    getOrCreateDefaultDepartmentId,
    updateDocumentCount,
    // new helpers (added below in initDatabase.js)
    createEmiratesConvert,
    setEmiratesConvertStatus,
    setEmiratesConvertOutputJsonPath,
} from "../initDatabase.js";

import { compressPdfWithGs } from "../compressor/gsCompress.js";

const CONCURRENCY = Number(process.env.EMIRATES_CONCURRENCY || 6);
// We keep SPLIT_MODE var for future; for now we avoid splitting big PDFs to keep memory low.
const SPLIT_MODE = (process.env.EMIRATES_SPLIT_PDFS || "smart").toLowerCase();

const TMP_DIR = path.join(os.tmpdir(), "emirates");
await fs.mkdir(TMP_DIR, { recursive: true });

// Disk-based, like invoices
export const upload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, TMP_DIR),
        filename: (_req, file, cb) =>
            cb(
                null,
                `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.originalname
                }`
            ),
    }),
    limits: {
        files: 1000,
        fileSize: 200 * 1024 * 1024, // 200MB per file
    },
}).array("files", 1000);

// in-memory jobs (same pattern as invoices)
const JOBS = new Map();

/** POST /api/emirates/jobs/start */
export async function startJob(req, res) {
    try {
        const files = req.files || [];
        if (!files.length)
            return res.status(400).json({ message: "No files uploaded." });

        // Page count + totals
        let totalFileSize = 0;
        let totalPageCount = 0;
        for (const f of files) {
            totalFileSize += f.size || 0;
            const isPdf =
                f?.mimetype === "application/pdf" ||
                (f?.originalname || "").toLowerCase().endsWith(".pdf");
            if (isPdf) {
                try {
                    const buf = await fs.readFile(f.path);
                    totalPageCount += await countPdfPages(buf);
                } catch {
                    totalPageCount += 1;
                }
            } else {
                totalPageCount += 1;
            }
        }

        const jobId = uuidv4();
        JOBS.set(jobId, {
            state: "queued",
            message: "Queued",
            total_files: files.length,
            processed_files: 0,
            progress_pct: 0,

            files, // raw disk files from multer
            resultBuffer: null,
            preview: { columns: EMIRATES_COLUMNS, rows: [] },

            userId: req.user?.id || null,
            totalFileSize,
            totalPageCount,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            fileNames: files.map((f) => f.originalname).join(", "),
        });

        processJob(jobId).catch((err) => {
            const job = JOBS.get(jobId);
            if (job) {
                job.state = "error";
                job.message = err?.message || "Processing failed.";
            }
        });

        res.json({ job_id: jobId });
    } catch (e) {
        console.error("emirates startJob error:", e);
        res.status(500).json({ message: e?.message || "Failed to start job." });
    }
}

/** GET /api/emirates/jobs/status/:id */
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

/** GET /api/emirates/jobs/preview/:id */
export function jobPreview(req, res) {
    const job = JOBS.get(req.params.id);
    if (!job) return res.status(404).json({ message: "Not found" });
    if (job.state !== "done")
        return res.status(400).json({ message: "Preview not ready." });
    res.json({
        title: "Emirates ID Results",
        downloadFileName: "emirates_id.xlsx",
        columns: job.preview.columns,
        rows: job.preview.rows,
    });
}

/** GET /api/emirates/jobs/result/:id */
export function jobResult(req, res) {
    const job = JOBS.get(req.params.id);
    if (!job) return res.status(404).json({ message: "Not found" });
    if (job.state !== "done" || !job.resultBuffer) {
        return res.status(400).json({ message: "Result not ready." });
    }
    const fname = "emirates_id.xlsx";
    res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.send(job.resultBuffer);
    // optional: cleanup job on finish (keep if you prefer)
    // res.on("finish", () => JOBS.delete(req.params.id));
}

/* ---------------- internals ---------------- */

async function processJob(jobId) {
    const job = JOBS.get(jobId);
    if (!job) return;

    job.state = "running";
    job.message = "Preparing files…";

    // Normalize inputs like invoices: disk path + flags
    const inputs = [];
    for (const f of job.files) {
        const isPdf =
            f?.mimetype === "application/pdf" ||
            (f?.originalname || "").toLowerCase().endsWith(".pdf");

        inputs.push({
            originalname: f.originalname,
            mimetype: f.mimetype,
            path: f.path,
            size: f.size || 0,
            isPdf,
        });
    }

    job.files = inputs;
    job.total_files = inputs.length;
    job.processed_files = 0;
    job.progress_pct = 0;
    job.message = "Processing…";

    const rows = [];

    // derive user/dept/module (like invoices)
    const userId = job.userId || null;
    let departmentId = userId ? await getUserDepartmentId(userId) : null;
    if (!departmentId) departmentId = await getOrCreateDefaultDepartmentId();
    const moduleId = await ensureModuleId("emirates_id");

    const worker = async (f) => {
        const tmpPaths = new Set();
        let convertId = null;
        try {
            if (!f?.path || !f?.mimetype) return;

            // 1) choose upload path (maybe compressed)
            let uploadPath = f.path;

            if (f.isPdf) {
                try {
                    const compressedPath = await compressPdfWithGs(f.path, {
                        pdfSettings: "/ebook",
                        compatibilityLevel: "1.6",
                        dpi: 110,
                    });
                    if (compressedPath && compressedPath !== f.path) {
                        uploadPath = compressedPath;
                        tmpPaths.add(compressedPath);
                    }
                } catch (err) {
                    console.warn(
                        "PDF compression failed, using original:",
                        err?.message || err
                    );
                }
            } else if (f.mimetype.startsWith("image/")) {
                // Re-encode to JPEG into a temp file (avoid buffers)
                try {
                    const out = path.join(
                        TMP_DIR,
                        `${path.basename(f.path, path.extname(f.path))}-re.jpg`
                    );
                    await sharp(f.path, { limitInputPixels: 268435456 })
                        .resize({ width: 2000, withoutEnlargement: true })
                        .jpeg({ quality: 78, mozjpeg: true })
                        .toFile(out);
                    uploadPath = out;
                    tmpPaths.add(out);
                } catch (err) {
                    console.warn(
                        "Image re-encode failed, using original:",
                        err?.message || err
                    );
                }
            }

            // 2) copy original/processed to local storage (uploads root)
            const destUploadsRel = buildEmiratesLocalPath({
                type: "uploads",
                originalName: f.originalname,
            });
            const savedOriginal = await copyToLocal({
                srcAbsPath: uploadPath,
                destRelPath: destUploadsRel,
            });

            // 3) DB row (queued -> extracting)
            convertId = await createEmiratesConvert({
                userId,
                departmentId,
                moduleId,
                fileName: f.originalname,
                fileSize: f.size || 0,
                fileInputPath: savedOriginal.rel,
            });
            await setEmiratesConvertStatus(convertId, "extracting");

            // 4) Upload to Gemini by **path** + extract
            job.message = `Uploading ${f.originalname}…`;
            const gFile = await uploadPathToGemini({
                path: uploadPath,
                filename: f.originalname,
                mimeType: f.mimetype,
            });

            job.message = `Extracting ${f.originalname}…`;
            const gJSON = await extractJsonFromFile({
                file: gFile,
                systemPrompt: EMIRATES_SYSTEM_PROMPT,
                userPrompt: EMIRATES_USER_PROMPT,
            });

            if (gJSON?.__usage) {
                job.totalInputTokens += gJSON.__usage.inputTokens || 0;
                job.totalOutputTokens += gJSON.__usage.outputTokens || 0;
            }

            const looksEmpty =
                !gJSON?.id_number &&
                !gJSON?.name &&
                !gJSON?.expiry_date &&
                !gJSON?.date_of_birth;

            // 5) Write per-file JSON to /emirates_id/json/DD-MM-YYYY
            const baseSafe = safeName(f.originalname).replace(/\.[^.]+$/i, "");
            const jsonRel = withExt(
                buildEmiratesLocalPath({
                    type: "json",
                    originalName: `${baseSafe}.json`,
                }),
                ".json"
            );
            await writeJsonLocal({
                json: { source: f.originalname, record: gJSON || null },
                destRelPath: jsonRel,
            });

            // update DB with output path + final status
            if (convertId) {
                await setEmiratesConvertOutputJsonPath(
                    convertId,
                    jsonRel,
                    looksEmpty ? "extracted" : "extracted"
                );
            }

            if (!looksEmpty) {
                const row = normalizeEmiratesIdJson(gJSON, f.originalname);
                rows.push(row);
            }
        } catch (e) {
            console.error(`File failed (${f.originalname}):`, e?.message || e);
            if (convertId) {
                await setEmiratesConvertStatus(
                    convertId,
                    "failed",
                    e?.message || "failed"
                );
            }
        } finally {
            // cleanup temps (compressed/re-encoded)
            for (const p of tmpPaths) {
                try {
                    await fs.unlink(p);
                } catch { }
            }
            job.processed_files += 1;
            job.progress_pct = Math.round(
                (job.processed_files / job.total_files) * 100
            );
        }
    };

    await runPool(job.files, CONCURRENCY, worker);

    // Build Excel (like before)
    const order = EMIRATES_COLUMNS.map((c) => c.key);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, aoaSheet(order, rows), "Emirates ID");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    job.resultBuffer = buf;
    job.preview = { columns: EMIRATES_COLUMNS, rows: rows.slice(0, 200) };
    job.state = "done";
    job.message = "Completed";
    job.files = [];

    // Update document count AFTER success (like invoices)
    try {
        await updateDocumentCount(
            job.userId,
            job.total_files,
            job.totalFileSize,
            "emirates_id",
            job.fileNames,
            job.totalPageCount || 0,
            job.totalInputTokens || 0,
            job.totalOutputTokens || 0
        );
    } catch (err) {
        console.error("Failed to update document count (emirates):", err);
    }
}

/* ----- util/helpers ----- */

async function countPdfPages(buffer) {
    const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
    return pdf.getPageCount();
}

async function runPool(items, limit, worker) {
    let i = 0;
    const runners = Array.from(
        { length: Math.min(limit, items.length) },
        async () => {
            while (true) {
                const idx = i++;
                if (idx >= items.length) break;
                await worker(items[idx]);
            }
        }
    );
    await Promise.all(runners);
}

function aoaSheet(order, rows) {
    const data = [
        order,
        ...rows.map((r) => order.map((k) => (r[k] === undefined ? null : r[k]))),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = order.map((k) => ({
        wch: Math.max(12, Math.min(38, k.length + 4)),
    }));
    const widen = (k, w) => {
        const i = order.indexOf(k);
        if (i !== -1) ws["!cols"][i] = { wch: w };
    };
    widen("NAME", 28);
    widen("EMPLOYER", 28);
    widen("OCCUPATION", 24);
    widen("SOURCE", 30);

    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r: 0, c });
        ws[addr].s = {
            font: { bold: true },
            alignment: { horizontal: "center", vertical: "center", wrapText: true },
            fill: { fgColor: { rgb: "F2F2F2" } },
        };
    }
    ws["!freeze"] = {
        xSplit: "0",
        ySplit: "1",
        topLeftCell: "A2",
        activePane: "bottomLeft",
        state: "frozen",
    };
    return ws;
}