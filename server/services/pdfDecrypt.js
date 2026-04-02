// server/services/pdfDecrypt.js
import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const pExecFile = promisify(execFile);
const pExec = promisify(exec);

function looksEncrypted(buf) {
    try {
        const s = buf.subarray(0, Math.min(buf.length, 2_000_000)).toString("latin1");
        return /\/Encrypt\b/.test(s);
    } catch { return false; }
}

async function tryQpdfDecrypt(inFile, outFile, password) {
    const bin = process.platform === "win32" ? "qpdf.exe" : "qpdf";
    const args = [`--password=${password || ""}`, "--decrypt", inFile, outFile];
    await pExecFile(bin, args);
    return true;
}

async function tryGsDecrypt(inFile, outFile, password) {
    const candidates = process.platform === "win32" ? ["gswin64c", "gswin32c"] : ["gs"];
    let lastErr = null;
    for (const bin of candidates) {
        try {
            const cmd = `"${bin}" -q -dNOPAUSE -dBATCH -dSAFER -sDEVICE=pdfwrite -o "${outFile}" -sPDFPassword=${password ? `"${password}"` : '""'} "${inFile}"`;
            await pExec(cmd, { windowsHide: true });
            return true;
        } catch (e) { lastErr = e; }
    }
    if (lastErr) throw lastErr;
    return false;
}

/** Ensure buffer is not password-protected; decrypt via qpdf→gs if needed. */
export async function ensureDecrypted(inputBuffer, password = "") {
    if (!looksEncrypted(inputBuffer) && !password) {
        return { buffer: inputBuffer, wasEncrypted: false };
    }
    if (looksEncrypted(inputBuffer) && !password) {
        const err = new Error("PDF appears to be password-protected. Please provide the password.");
        err.code = "PDF_PASSWORD_REQUIRED";
        throw err;
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pdfdec-"));
    const inFile = path.join(tmpDir, "in.pdf");
    const outFile = path.join(tmpDir, "out.pdf");
    try {
        await fs.writeFile(inFile, inputBuffer);
        let ok = false;
        try { ok = await tryQpdfDecrypt(inFile, outFile, password); } catch { }
        if (!ok) await tryGsDecrypt(inFile, outFile, password);

        const outBuf = await fs.readFile(outFile);
        if (!outBuf || !outBuf.length || looksEncrypted(outBuf)) {
            const err = new Error("Failed to decrypt PDF with the given password.");
            err.code = "PDF_DECRYPT_FAILED";
            throw err;
        }
        return { buffer: outBuf, wasEncrypted: true };
    } finally {
        try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { }
    }
}
