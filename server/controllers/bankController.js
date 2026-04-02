// controllers/bankController.js
import {
    startJob,
    getStatus,
    getResult,
    fetchProcessedJSON,
    pipeProcessedExcelByJob,
} from "../services/docai.js";
import { updateDocumentCount } from "../initDatabase.js";
import { PDFDocument } from "pdf-lib";

const JOBS = new Map();
const HDR = (res, msg, code = 400) => res.status(code).json({ message: msg });

/* ---------------- PDF helpers ---------------- */
async function countPdfPages(buffer) {
    const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
    return pdf.getPageCount();
}

/* 1) POST /api/bank/extract/start */
export async function start(req, res) {
    try {
        const f = req.file;
        if (!f) return HDR(res, "file is required");

        // Count pages for page count tracking
        // For PDF files, count actual pages; for image files, count as 1 page
        let pageCount = 0;
        try {
            // Check if it's a PDF file
            const isPdf = f.mimetype === "application/pdf" || (/\.pdf$/i.test(f.originalname || ""));
            if (isPdf) {
                pageCount = await countPdfPages(f.buffer);
            } else {
                // For images and other file types, count as 1 page
                pageCount = 1;
            }
        } catch (e) {
            console.warn("Failed to count pages:", e?.message);
            // Fallback: count as 1 page
            pageCount = 1;
        }

        const jobId = await startJob(f.buffer, f.originalname, f.mimetype);

        JOBS.set(jobId, {
            originalName: f.originalname,
            startedAt: Date.now(),
            status: "started",
            userId: req.user.id, // Store user ID for document count update
            fileSize: f.size, // Store file size for document count update
            pageCount: pageCount, // Store page count for document count update
        });

        res.json({ jobId, originalName: f.originalname });
    } catch (e) {
        console.error("bank.start:", e?.response?.data || e.message);
        res.status(500).json({ message: "Failed to start extraction" });
    }
}

/* 2) GET /api/bank/extract/status/:jobId */
export async function status(req, res) {
    try {
        const { jobId } = req.params;
        const st = await getStatus(jobId);
        const status = String(st?.status || "").toLowerCase();
        const j = JOBS.get(jobId);
        if (j) j.status = status;
        res.json({ status });
    } catch (e) {
        console.error("bank.status:", e?.response?.data || e.message);
        res.status(500).json({ status: "error", message: "status check failed" });
    }
}

/* 3) GET /api/bank/extract/result/:jobId */
export async function result(req, res) {
    try {
        const { jobId } = req.params;
        const j = JOBS.get(jobId);
        if (!j) return HDR(res, "Unknown jobId", 404);

        const r = await getResult(jobId);
        const processed_json_url =
            r?.processed_json_url || r?.data?.processed_json_url;
        const processed_excel_url =
            r?.processed_excel_url || r?.data?.processed_excel_url;

        if (!processed_json_url) return HDR(res, "processed_json_url not ready yet", 425);

        j.processed_json_url = processed_json_url;
        j.processed_excel_url = processed_excel_url;

        const processed = await fetchProcessedJSON(processed_json_url);
        // processed: { tableTable:{columns,rows}, meta:{} }

        const tableTable = processed?.tableTable || { columns: [], rows: [] };
        const downloadFileName =
            r?.data?.downloadFileName ||
            `${(j.originalName || "bank_statements").replace(/\.[^/.]+$/, "")}.xlsx`;
        const title = r?.data?.title || "Bank Statement Results";

        // Update document count for the user
        try {
            const fileName = j.originalName || null;
            const fileSize = j.fileSize || 0;
            const pageCount = j.pageCount || 0;
            await updateDocumentCount(j.userId, 1, fileSize, 'bank_statements', fileName, pageCount, 0, 0);
        } catch (err) {
            console.error("Failed to update document count:", err);
        }

        res.json({
            title,
            jobId,
            // top-level for backward-compat
            columns: tableTable.columns,
            rows: tableTable.rows,
            // explicit table
            tableTable,
            downloadFileName,
        });
    } catch (e) {
        console.error("bank.result:", e?.response?.data || e.message);
        res.status(500).json({ message: "Failed to fetch result" });
    }
}

/* 4) GET /api/bank/excel/:jobId */
export async function excelByJob(req, res) {
    try {
        const { jobId } = req.params;
        const { fileName } = req.query || {};
        const j = JOBS.get(jobId);
        if (!j) return HDR(res, "Unknown jobId", 404);

        const safe =
            (fileName || j.originalName || "bank_statements").replace(/\.[^/.]+$/, "");
        await pipeProcessedExcelByJob(jobId, res, `${safe}.xlsx`);
    } catch (e) {
        console.error("bank.excelByJob:", e?.response?.data || e.message);
        res.status(500).json({ message: "Excel download failed" });
    }
}