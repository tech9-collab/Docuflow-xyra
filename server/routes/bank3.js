// server/routes/bank3.js
import { Router } from "express";
import multer from "multer";
import os from "node:os";
import * as bank from "../controllers/bankController3.js";

const router = Router();

/* Multer (disk) */
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) => {
        const safe = (file.originalname || "upload").replace(/[^\w.\-]+/g, "_");
        const stamp = Date.now().toString(36);
        cb(null, `${stamp}__${safe}`);
    },
});

const ALLOWED = new Set([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/gif",
    "image/tiff",
]);

const fileFilter = (_req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
    const name = (file.originalname || "").toLowerCase();
    const okByExt =
        /\.pdf$/.test(name) || /\.(png|jpe?g|webp|gif|tiff?)$/.test(name);
    if (okByExt) return cb(null, true);
    cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "file"));
};

const limits = { fileSize: 120 * 1024 * 1024 };
const upload = multer({ storage, fileFilter, limits });

function safeSingle(field = "file") {
    const handler = upload.single(field);
    return (req, res, next) => {
        handler(req, res, (err) => {
            if (!err) return next();
            if (err instanceof multer.MulterError) {
                if (err.code === "LIMIT_FILE_SIZE") {
                    return res
                        .status(413)
                        .json({ message: "File too large (max 120 MB)" });
                }
                return res.status(400).json({ message: `Upload error: ${err.code}` });
            }
            return res.status(400).json({ message: err?.message || "Upload failed" });
        });
    };
}

/* Routes */
router.post("/extract/start-smart", safeSingle("file"), bank.startSmart);
router.post("/extract/start", safeSingle("file"), bank.start);
router.get("/extract/status/:id", bank.status);
router.get("/extract/result/:id", bank.getExtractionResult);
router.get("/excel/:id", bank.excelByJob);
router.get("/excel/rebuild/:id", bank.excelRebuild);
router.get("/excel/transactions/:id", bank.excelRebuild);

export default router;
