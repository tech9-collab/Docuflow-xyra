// compressor/gsCompress.js
import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";
import fs from "fs/promises";

const execFileP = promisify(execFile);

// Pick GS binary
function gsBin() {
  if (process.env.GS_BIN) return process.env.GS_BIN; // allow override
  if (process.platform === "win32") return "gswin64c"; // or gswin32c on 32-bit
  return "gs";
}

/**
 * Compress a PDF with Ghostscript.
 * @param {string} inPath Absolute path to input PDF
 * @param {object} opts
 *  - pdfSettings: "/screen" | "/ebook" | "/printer" | "/prepress"
 *  - compatibilityLevel: "1.4".."1.7"
 *  - dpi: 72..300 (affects color/gray/mono downsample)
 *  - outDir: optional output directory
 * @returns {Promise<string>} absolute path to compressed PDF
 */

const GS_TMP_DIR_NAME = `gs_compress-${
  (typeof process.getuid === "function" && process.getuid()) || "default"
}`;

export async function compressPdfWithGs(
  inPath,
  { pdfSettings = "/ebook", compatibilityLevel = "1.6", dpi = 100, outDir } = {}
) {
  const inAbs = path.resolve(inPath);
  const dir = outDir || path.join(os.tmpdir(), GS_TMP_DIR_NAME);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const outAbs = path.join(
    dir,
    `${path.basename(inAbs, path.extname(inAbs))}-compressed.pdf`
  );

  const args = [
    "-q",
    "-dNOPAUSE",
    "-dBATCH",
    "-dSAFER",
    "-dSimulateOverprint=true",
    "-sDEVICE=pdfwrite",
    `-dCompatibilityLevel=${compatibilityLevel}`,
    `-dPDFSETTINGS=${pdfSettings}`,
    "-dEmbedAllFonts=true",
    "-dSubsetFonts=true",
    "-dAutoRotatePages=/None",
    "-dColorImageDownsampleType=/Bicubic",
    `-dColorImageResolution=${dpi}`,
    "-dGrayImageDownsampleType=/Bicubic",
    `-dGrayImageResolution=${dpi}`,
    "-dMonoImageDownsampleType=/Bicubic",
    `-dMonoImageResolution=${dpi}`,
    `-sOutputFile=${outAbs}`,
    inAbs,
  ];

  try {
    await execFileP(gsBin(), args, { windowsHide: true, timeout: 5 * 60_000 });
    // Sanity: ensure output exists & smaller
    const [statIn, statOut] = await Promise.all([
      fs.stat(inAbs),
      fs.stat(outAbs).catch(() => null),
    ]);
    if (!statOut || statOut.size >= statIn.size) return inAbs; // no gain → keep original
    return outAbs;
  } catch (e) {
    // Log stderr if available
    const msg = e?.stderr?.toString?.() || e.message;
    console.error("Ghostscript compression failed:", msg);
    return inAbs; // fall back to original
  }
}
