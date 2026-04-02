// server/services/pdfSlim.js
import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const pExec = promisify(exec);

function approxMB(sizeBytes) {
    return Math.round((sizeBytes / (1024 * 1024)) * 10) / 10;
}
function pickGsBin() {
    return process.platform === "win32" ? "gswin64c" : "gs";
}

/** Downsample big/scanned PDFs; if Ghostscript missing, returns input. */
export async function slimPdfIfNeeded(inputPath, { targetDpi = 180, sizeMBThreshold = 10 } = {}) {
    try {
        const st = await fs.stat(inputPath);
        if (approxMB(st.size) < sizeMBThreshold) return { path: inputPath, slimmed: false };
    } catch { }

    const gs = pickGsBin();
    const outPath = path.join(os.tmpdir(), `slim_${Date.now().toString(36)}.pdf`);
    const cmd =
        `"${gs}" -q -dNOPAUSE -dBATCH -dSAFER ` +
        `-sDEVICE=pdfwrite -dCompatibilityLevel=1.6 ` +
        `-dDetectDuplicateImages=true ` +
        `-dColorImageDownsampleType=/Bicubic -dColorImageResolution=${targetDpi} ` +
        `-dGrayImageDownsampleType=/Bicubic -dGrayImageResolution=${targetDpi} ` +
        `-dMonoImageDownsampleType=/Subsample -dMonoImageResolution=${targetDpi} ` +
        `-sOutputFile="${outPath}" "${inputPath}"`;

    try {
        await pExec(cmd, { windowsHide: true });
        const outStat = await fs.stat(outPath).catch(() => null);
        if (outStat && outStat.size > 0) return { path: outPath, slimmed: true };
    } catch { }
    return { path: inputPath, slimmed: false };
}
