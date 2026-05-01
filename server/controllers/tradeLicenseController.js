// controllers/tradeLicenseController.js
import multer from "multer";
import XLSX from "xlsx-js-style";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import path from "path";
import os from "os";

import { uploadPathToGemini, extractJsonFromFile } from "../lib/gemini.js";
import { TL_SYSTEM_PROMPT, TL_USER_PROMPT } from "../lib/tradeLicensePrompt.js";
import { TL_COLUMNS, normalizeTLJson } from "../lib/tradeLicenseNormalize.js";

import {
    updateDocumentCount,
    // OPTIONAL DB hooks if you want parity with Emirates:
    // createTradeLicenseConvert,
    // setTradeLicenseConvertStatus,
    // setTradeLicenseConvertOutputJsonPath,
    ensureModuleId,
    getUserDepartmentId,
    getOrCreateDefaultDepartmentId,
} from "../initDatabase.js";

import {
    buildTradeLicenseLocalPath,
    copyToLocal,
    writeJsonLocal,
    withExt,
    safeName,
} from "../lib/localStorage.js";

import { compressPdfWithGs } from "../compressor/gsCompress.js";

const CONCURRENCY = Number(process.env.TL_CONCURRENCY || 6);
// IMPORTANT: For one row per PDF, do NOT split. Keep whole PDFs.
const SPLIT_MODE = (process.env.TL_SPLIT_PDFS || "never").toLowerCase();

const TMP_DIR_NAME = `trade_license-${
  (typeof process.getuid === "function" && process.getuid()) || "default"
}`;
const TMP_DIR = path.join(os.tmpdir(), TMP_DIR_NAME);
await fs.mkdir(TMP_DIR, { recursive: true, mode: 0o700 });

// Disk-based (same as Emirates)
export const upload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, TMP_DIR),
        filename: (_req, file, cb) =>
            cb(
                null,
                `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.originalname}`
            ),
    }),
    limits: {
        files: 1000,
        fileSize: 200 * 1024 * 1024, // 200MB/file
    },
}).array("files", 1000);

const JOBS = new Map();

/** POST /api/tradelicense/jobs/start */
export async function startJob(req, res) {
    try {
        const files = req.files || [];
        if (!files.length) return res.status(400).json({ message: "No files uploaded." });

        // compute totals
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

            files, // raw multer disk files
            resultBuffer: null,
            preview: { columns: TL_COLUMNS, rows: [] },

            userId: req.user?.id || null,
            totalFileSize,
            totalPageCount,
            fileNames: files.map((f) => f.originalname).join(", "),
            totalInputTokens: 0,
            totalOutputTokens: 0,
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
        console.error("TL startJob error:", e);
        res.status(500).json({ message: e?.message || "Failed to start job." });
    }
}

/** GET /api/tradelicense/jobs/status/:id */
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

/** GET /api/tradelicense/jobs/preview/:id */
export function jobPreview(req, res) {
    const job = JOBS.get(req.params.id);
    if (!job) return res.status(404).json({ message: "Not found" });
    if (job.state !== "done")
        return res.status(400).json({ message: "Preview not ready." });
    res.json({
        title: "UAE Trade License Results",
        downloadFileName: "trade_license.xlsx",
        columns: job.preview.columns,
        rows: job.preview.rows,
    });
}

/** GET /api/tradelicense/jobs/result/:id */
export function jobResult(req, res) {
    const job = JOBS.get(req.params.id);
    if (!job) return res.status(404).json({ message: "Not found" });
    if (job.state !== "done" || !job.resultBuffer) {
        return res.status(400).json({ message: "Result not ready." });
    }
    const fname = "trade_license.xlsx";
    res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.send(job.resultBuffer);
    // optional cleanup: // res.on("finish", () => JOBS.delete(req.params.id));
}

/** POST /api/tradelicense/extract-one */
export async function extractOne(req, res) {
    try {
        const file = req.files?.[0];
        if (!file) return res.status(400).json({ message: "No file uploaded." });

        let uploadPath = file.path;
        const tmpPaths = new Set();
        const isPdf = file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf");

        // 1. Process/Compress
        if (isPdf) {
            try {
                const compressedPath = await compressPdfWithGs(file.path, {
                    pdfSettings: "/ebook",
                    compatibilityLevel: "1.6",
                    dpi: 110,
                });
                if (compressedPath && compressedPath !== file.path) {
                    uploadPath = compressedPath;
                    tmpPaths.add(compressedPath);
                }
            } catch (err) {
                console.warn("TL PDF extraction compression failed:", err.message);
            }
        } else if (file.mimetype.startsWith("image/")) {
            try {
                const out = path.join(TMP_DIR, `${Date.now()}-re.jpg`);
                await sharp(file.path).resize({ width: 2000, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(out);
                uploadPath = out;
                tmpPaths.add(out);
            } catch (err) {
                console.warn("TL Image extraction re-encode failed:", err.message);
            }
        }

        // 2. Gemini Extraction
        const gFile = await uploadPathToGemini({
            path: uploadPath,
            filename: file.originalname,
            mimeType: file.mimetype,
        });

        const gJSON = await extractJsonFromFile({
            file: gFile,
            systemPrompt: TL_SYSTEM_PROMPT,
            userPrompt: TL_USER_PROMPT,
        });

        // Cleanup
        for (const p of tmpPaths) { try { await fs.unlink(p); } catch { } }
        try { await fs.unlink(file.path); } catch { }

        if (!gJSON) {
            return res.status(422).json({ message: "Could not extract data from this document." });
        }

        const normalized = normalizeTLJson(gJSON, file.originalname);
        res.json(normalized);

    } catch (err) {
        console.error("TL extractOne error:", err);
        res.status(500).json({ message: "Failed to extract trade license data." });
    }
}

/* ---------------- internals ---------------- */

async function processJob(jobId) {
    const job = JOBS.get(jobId);
    if (!job) return;

    job.state = "running";
    job.message = "Preparing files…";

    // normalize inputs
    const inputs = job.files.map((f) => ({
        originalname: f.originalname,
        mimetype: f.mimetype,
        path: f.path,
        size: f.size || 0,
        isPdf:
            f?.mimetype === "application/pdf" ||
            (f?.originalname || "").toLowerCase().endsWith(".pdf"),
    }));

    job.files = inputs;
    job.total_files = inputs.length;
    job.processed_files = 0;
    job.progress_pct = 0;
    job.message = "Processing…";

    // user/dept/module (for analytics or later DB writes)
    const userId = job.userId || null;
    let departmentId = userId ? await getUserDepartmentId(userId) : null;
    if (!departmentId) departmentId = await getOrCreateDefaultDepartmentId();
    const moduleId = await ensureModuleId("trade_license");

    const rows = [];
    const worker = async (f) => {
        const tmpPaths = new Set();
        try {
            if (!f?.path || !f?.mimetype) return;

            // 1) compress / re-encode like Emirates
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
                    console.warn("TL PDF compression failed, using original:", err?.message || err);
                }
            } else if (f.mimetype.startsWith("image/")) {
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
                    console.warn("TL image re-encode failed, using original:", err?.message || err);
                }
            }

            // 2) copy original/processed to uploads
            const destUploadsRel = buildTradeLicenseLocalPath({
                type: "uploads",
                originalName: f.originalname,
            });
            const savedOriginal = await copyToLocal({
                srcAbsPath: uploadPath,
                destRelPath: destUploadsRel,
            });

            // 3) Gemini by PATH — whole PDF ⇒ single record
            job.message = `Uploading ${f.originalname}…`;
            const gFile = await uploadPathToGemini({
                path: uploadPath,
                filename: f.originalname,
                mimeType: f.mimetype,
            });

            job.message = `Extracting ${f.originalname}…`;
            const gJSON = await extractJsonFromFile({
                file: gFile,
                systemPrompt: TL_SYSTEM_PROMPT,
                userPrompt: TL_USER_PROMPT,
            });

            if (gJSON?.__usage) {
                job.totalInputTokens += gJSON.__usage.inputTokens || 0;
                job.totalOutputTokens += gJSON.__usage.outputTokens || 0;
            }

            const looksEmpty =
                !gJSON?.company_name &&
                !gJSON?.license_number &&
                !gJSON?.activities;

            // 4) persist per-file JSON
            const baseSafe = safeName(f.originalname).replace(/\.[^.]+$/i, "");
            const jsonRel = withExt(
                buildTradeLicenseLocalPath({ type: "json", originalName: `${baseSafe}.json` }),
                ".json"
            );
            await writeJsonLocal({
                json: { source: f.originalname, record: gJSON || null },
                destRelPath: jsonRel,
            });

            if (!looksEmpty) {
                rows.push(normalizeTLJson(gJSON, f.originalname));
            }
        } catch (e) {
            console.error(`TL file failed (${f.originalname}):`, e?.message || e);
        } finally {
            // cleanup temps
            for (const p of tmpPaths) { try { await fs.unlink(p); } catch { } }
            job.processed_files += 1;
            job.progress_pct = Math.round((job.processed_files / job.total_files) * 100);
        }
    };

    await runPool(job.files, CONCURRENCY, worker);

    // Build Excel
    const order = TL_COLUMNS.map((c) => c.key);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, aoaSheet(order, rows), "Trade License");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    job.resultBuffer = buf;
    job.preview = { columns: TL_COLUMNS, rows: rows.slice(0, 200) };
    job.state = "done";
    job.message = "Completed";
    job.files = [];

    // analytics
    try {
        await updateDocumentCount(
            job.userId,
            job.total_files,
            job.totalFileSize,
            "trade_license",
            job.fileNames,
            job.totalPageCount || 0,
            job.totalInputTokens || 0,
            job.totalOutputTokens || 0
        );
    } catch (err) {
        console.error("Failed to update document count (trade_license):", err);
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
    ws["!cols"] = order.map((k) => ({ wch: Math.max(12, Math.min(38, k.length + 4)) }));
    // nice widths for long fields
    const widen = (k, w) => {
        const i = order.indexOf(k);
        if (i !== -1) ws["!cols"][i] = { wch: w };
    };
    widen("COMPANY_NAME", 28);
    widen("ADDRESS", 36);
    widen("ACTIVITIES", 40);
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
    ws["!freeze"] = { xSplit: "0", ySplit: "1", topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
    return ws;
}
