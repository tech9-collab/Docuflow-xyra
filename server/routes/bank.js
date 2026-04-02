// routes/bank.js
import { Router } from "express";
import multer from "multer";
import * as bank from "../controllers/bankController.js";

const router = Router();

/* ---------- Multer: memory storage + filters ---------- */
const storage = multer.memoryStorage();

// allow PDF + common image types
const ALLOWED = new Set([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/gif",
    "image/tiff",
]);

const fileFilter = (req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);

    // Fallback by extension if mimetype is odd
    const name = (file.originalname || "").toLowerCase();
    const okByExt =
        /\.pdf$/.test(name) ||
        /\.(png|jpe?g|webp|gif|tiff?)$/.test(name);

    if (okByExt) return cb(null, true);
    cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "file"));
};

// 80 MB max (multi-page bank statements can be large)
const limits = { fileSize: 80 * 1024 * 1024 };

const upload = multer({ storage, fileFilter, limits });

/**
 * Wrap upload.single to catch Multer errors and send clean JSON.
 */
function safeSingle(field = "file") {
    const handler = upload.single(field);
    return (req, res, next) => {
        handler(req, res, (err) => {
            if (!err) return next();
            if (err instanceof multer.MulterError) {
                if (err.code === "LIMIT_FILE_SIZE") {
                    return res.status(413).json({ message: "File too large (max 80 MB)" });
                }
                return res.status(400).json({ message: `Upload error: ${err.code}` });
            }
            return res.status(400).json({ message: err?.message || "Upload failed" });
        });
    };
}

/* ---------- Routes (job-based flow) ---------- */
// 1) Start extraction (accepts single file field "file")
router.post("/extract/start", safeSingle("file"), bank.start);

// 2) Poll job status
router.get("/extract/status/:jobId", bank.status);

// 3) Get normalized results (TextData + TableData) for UI preview
router.get("/extract/result/:jobId", bank.result);

// 4) Download styled Excel (2 sheets)
router.get("/excel/:jobId", bank.excelByJob);

export default router;
