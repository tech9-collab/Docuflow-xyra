// routes/bank2.js
import { Router } from "express";
import multer from "multer";
import * as bank from "../controllers/bankController2.js";

const router = Router();

/* ---------- Multer: memory storage + filters ---------- */
const storage = multer.memoryStorage();

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
    const name = (file.originalname || "").toLowerCase();
    const okByExt = /\.pdf$/.test(name) || /\.(png|jpe?g|webp|gif|tiff?)$/.test(name);
    if (okByExt) return cb(null, true);
    cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "file"));
};

// Allow big scans (adjust if needed)
const limits = { fileSize: 120 * 1024 * 1024 };
const upload = multer({ storage, fileFilter, limits });

function safeSingle(field = "file") {
    const handler = upload.single(field);
    return (req, res, next) => {
        handler(req, res, (err) => {
            if (!err) return next();
            if (err instanceof multer.MulterError) {
                if (err.code === "LIMIT_FILE_SIZE") {
                    return res.status(413).json({ message: "File too large (max 120 MB)" });
                }
                return res.status(400).json({ message: `Upload error: ${err.code}` });
            }
            return res.status(400).json({ message: err?.message || "Upload failed" });
        });
    };
}

/* ---------- Routes ---------- */
// Smart start (auto imageless / chunk & merge)
router.post("/extract/start-smart", safeSingle("file"), bank.startSmart);

// Legacy single start
router.post("/extract/start", safeSingle("file"), bank.start);

// Status / Result for jobId or groupId
router.get("/extract/status/:id", bank.status);
router.get("/extract/result/:id", bank.result);

// Vendor Excel (single job only)
router.get("/excel/:id", bank.excelByJob);

// One-sheet Transactions Excel (single or group)
router.get("/excel/rebuild/:id", bank.excelRebuild);
// Optional alias
router.get("/excel/transactions/:id", bank.excelRebuild);

export default router;
