// services/razor.js
import axios from "axios";
import FormData from "form-data";

const BASE = process.env.RAZOR_API_BASE || "https://api.razorextract.com";
const KEY = process.env.RAZOR_API_KEY;
const HDRS = { "x-rzx-api-key": KEY, Accept: "application/json" };

// single axios instance with large limits
export const ax = axios.create({
    timeout: 300000, // 5 min
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
});

function assertKey() {
    if (!KEY) throw new Error("Missing RAZOR_API_KEY");
}

// retry/backoff for transient vendor states
async function withRetry(fn, {
    tries = 8,
    baseDelayMs = 1000,
    shouldRetry = (err) => {
        const s = err?.response?.status;
        return s === 404 || s === 409 || s === 425 || (s >= 500);
    },
} = {}) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
        try { return await fn(); }
        catch (err) {
            lastErr = err;
            if (!shouldRetry(err) || i === tries - 1) throw err;
            const delay = Math.min(baseDelayMs * Math.pow(2, i), 15000);
            await new Promise(r => setTimeout(r, delay));
        }
    }
    throw lastErr;
}

/** Start a job (normal) — POST /api/v1/extract */
export async function startJob(buffer, fileName, mimeType) {
    assertKey();
    const fd = new FormData();
    fd.append("file", buffer, { filename: fileName || "document.pdf", contentType: mimeType || "application/pdf" });
    const { data } = await ax.post(`${BASE}/api/v1/extract`, fd, { headers: { ...HDRS, ...fd.getHeaders() } });
    if (!data?.job_id) throw new Error(`Unexpected start response: ${JSON.stringify(data)}`);
    return data.job_id;
}

/** Start a job with a mode (e.g., "imageless") — same endpoint */
export async function startJobWithMode(buffer, fileName, mimeType, mode = "imageless") {
    assertKey();
    const fd = new FormData();
    fd.append("file", buffer, { filename: fileName || "document.pdf", contentType: mimeType || "application/pdf" });
    // If the API ignores unknown fields, this is harmless; if supported, it enables imageless.
    fd.append("mode", mode);
    const { data } = await ax.post(`${BASE}/api/v1/extract`, fd, { headers: { ...HDRS, ...fd.getHeaders() } });
    if (!data?.job_id) throw new Error(`Unexpected start response: ${JSON.stringify(data)}`);
    return data.job_id;
}

/** Status — GET /api/v1/status/{jobId} */
export async function getStatus(jobId) {
    assertKey();
    return withRetry(async () => {
        const { data } = await ax.get(`${BASE}/api/v1/status/${jobId}`, { headers: HDRS });
        return data;
    });
}

/** Result — GET /api/v1/result/{jobId} */
export async function getResult(jobId) {
    assertKey();
    return withRetry(async () => {
        const { data } = await ax.get(`${BASE}/api/v1/result/${jobId}`, { headers: HDRS });
        return data;
    });
}

export async function fetchProcessedJSON(url) {
    const { data } = await ax.get(url, { headers: HDRS, responseType: "json" });
    return data;
}

export async function pipeProcessedExcelByJob(jobId, res, outName = "bank_statements.xlsx") {
    const result = await getResult(jobId);
    const excelUrl = result?.processed_excel_url || result?.data?.processed_excel_url;
    if (!excelUrl) throw new Error("processed_excel_url missing");
    const streamRes = await ax.get(excelUrl, { headers: HDRS, responseType: "stream" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${outName}"`);
    streamRes.data.pipe(res);
}
