// server/controllers/bankController3.js
import XLSX from "xlsx-js-style";
import { PDFDocument } from "pdf-lib";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  startJobFromFile,
  startJobWithModeFromFile,
  getStatus,
  getResult,
  DEFAULT_CHUNK_PAGES,
  JOBS as GEMINI_JOBS, // kept for reference if needed
} from "../services/gemini.js";

import { ensureDecrypted } from "../services/pdfDecrypt.js";
import { slimPdfIfNeeded } from "../services/pdfSlim.js";

import {
  updateDocumentCount,
  ensureModuleId,
  getUserDepartmentId,
  getOrCreateDefaultDepartmentId,
  createBankConvert,
  setBankConvertStatus,
  setBankConvertOutputJsonPath,
  setBankConvertJobId,
  getBankConvertByJobId,
} from "../initDatabase.js";

import {
  copyToLocal,
  writeJsonLocal,
  readJsonLocal,
  withExt,
  buildBankLocalPath,
} from "../lib/localStorage.js";

/* ---------------- utils ---------------- */
const HDR = (res, msg, code = 400) => res.status(code).json({ message: msg });
const JOBS = new Map(); // controller-level meta (grouping, convertId, etc.)

/* ---------------- Bank Storage helpers ---------------- */
async function persistUploadAndRow({
  reqUserId,
  originalName,
  fileSize,
  srcAbsPath,
}) {
  const relPath = buildBankLocalPath({ type: "uploads", originalName });
  await copyToLocal({ srcAbsPath, destRelPath: relPath });

  const userId = reqUserId || null;
  const departmentId =
    (userId ? await getUserDepartmentId(userId) : null) ||
    (await getOrCreateDefaultDepartmentId());
  const moduleId = await ensureModuleId("bank_statements");

  const convertId = await createBankConvert({
    userId,
    departmentId,
    moduleId,
    fileName: originalName,
    fileSize: fileSize || 0,
    fileInputPath: relPath,
  });

  return { convertId, relInput: relPath };
}

/* ---------------- PDF helpers ---------------- */
async function countPdfPages(buffer) {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  return pdf.getPageCount();
}

async function slicePdf(buffer, startPageIdx, endPageIdx) {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const dst = await PDFDocument.create();
  const idx = [];
  for (let i = startPageIdx; i < Math.min(endPageIdx, src.getPageCount()); i++)
    idx.push(i);
  const pages = await dst.copyPages(src, idx);
  pages.forEach((p) => dst.addPage(p));
  return await dst.save();
}

/* ---------------- SMART START ---------------- */
export async function startSmart(req, res) {
  try {
    const f = req.file;
    if (!f) return HDR(res, "file is required");

    let workPath = f.path;
    const name = f.originalname || "document.pdf";
    const fileSize = f.size || 0;

    // Persist original upload + DB row
    let convertRow = null;
    try {
      const persisted = await persistUploadAndRow({
        reqUserId: req.user?.id,
        originalName: name,
        fileSize,
        srcAbsPath: workPath,
      });
      convertRow = persisted;
    } catch (err) {
      console.error("Persist upload copy failed:", err?.message || err);
    }

    if (convertRow?.convertId) {
      try {
        await setBankConvertStatus(convertRow.convertId, "extracting");
      } catch {}
    }

    // Decrypt if needed
    const suppliedPw = req.body?.pdfPassword || req.body?.password || "";
    try {
      const srcBuf = await fs.readFile(workPath);
      const dec = await ensureDecrypted(srcBuf, suppliedPw);
      if (dec.wasEncrypted) {
        const tmp = path.join(
          os.tmpdir(),
          `dec_${Date.now().toString(36)}.pdf`
        );
        await fs.writeFile(tmp, dec.buffer);
        workPath = tmp;
      }
    } catch (e) {
      if (e?.code === "PDF_PASSWORD_REQUIRED")
        return HDR(
          res,
          "PDF is password-protected. Please provide pdfPassword.",
          423
        );
      if (e?.code === "PDF_DECRYPT_FAILED")
        return HDR(res, "Invalid password or failed to decrypt PDF.", 423);
    }

    // Slim if needed
    const slim = await slimPdfIfNeeded(workPath, {
      targetDpi: 180,
      sizeMBThreshold: 10,
    });
    workPath = slim.path;

    // Count pages
    let pages = 0;
    let bufForCount = null;
    try {
      bufForCount = await fs.readFile(workPath);
      const isPdf =
        f.mimetype === "application/pdf" ||
        /\.pdf$/i.test(f.originalname || "");
      pages = isPdf ? await countPdfPages(bufForCount) : 1;
    } catch (e) {
      console.warn("Failed to count pages:", e?.message);
      pages = 1;
    }

    const DEFAULT_CHUNK = DEFAULT_CHUNK_PAGES;
    const CHUNK = pages > 30 ? 2 : DEFAULT_CHUNK;

    // ≤ 2 pages → single job
    if (pages <= 2) {
      const jobId = await startJobFromFile(workPath, name, f.mimetype);
      JOBS.set(jobId, {
        originalName: name,
        startedAt: Date.now(),
        status: "started",
        type: "single",
        mode: "normal",
        userId: req.user?.id,
        fileSize,
        pageCount: pages,
        convertId: convertRow?.convertId || null,
        totalInputTokens: 0,
        totalOutputTokens: 0,
      });
      if (convertRow?.convertId) {
        await setBankConvertJobId(convertRow.convertId, jobId);
      }
      return res.json({ jobId, originalName: name, pages, mode: "normal" });
    }

    // > 2 pages → split jobs (group)
    const groupId = `grp_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;
    const parts = [];

    for (let start = 0; start < pages; start += CHUNK) {
      const end = Math.min(start + CHUNK, pages);
      const chunkBuf = await slicePdf(bufForCount, start, end);
      const chunkPath = path.join(
        os.tmpdir(),
        `chunk_${start + 1}-${end}_${Date.now().toString(36)}.pdf`
      );
      await fs.writeFile(chunkPath, chunkBuf);
      const label = `${name.replace(/\.pdf$/i, "")}_${start + 1}-${end}.pdf`;
      const jobId = await startJobWithModeFromFile(
        chunkPath,
        label,
        f.mimetype,
        "normal",
        end - start
      );
      parts.push({ jobId, start: start + 1, end });
      JOBS.set(jobId, {
        originalName: name,
        startedAt: Date.now(),
        status: "started",
        type: "part",
        groupId,
        userId: req.user?.id,
        fileSize,
        pageCount: pages,
        convertId: convertRow?.convertId || null,
        totalInputTokens: 0,
        totalOutputTokens: 0,
      });
    }

    JOBS.set(groupId, {
      originalName: name,
      type: "group",
      parts: parts.map((p) => p.jobId),
      pages,
      mode: "normal",
      workPath,
      userId: req.user?.id,
      fileSize,
      pageCount: pages,
      convertId: convertRow?.convertId || null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
    });

    if (convertRow?.convertId) {
      await setBankConvertJobId(convertRow.convertId, groupId);
    }

    return res.json({
      groupId,
      parts,
      originalName: name,
      pages,
      mode: "normal",
    });
  } catch (e) {
    console.error("bank.startSmart:", e?.response?.data || e.message);
    res.status(500).json({ message: "Failed to start (smart) extraction" });
  }
}

/* ---------------- Legacy start (no chunking) ---------------- */
export async function start(req, res) {
  try {
    const f = req.file;
    if (!f) return HDR(res, "file is required");

    const fileSize = f.size || 0;

    // Persist + DB row
    let convertRow = null;
    try {
      const persisted = await persistUploadAndRow({
        reqUserId: req.user?.id,
        originalName: f.originalname || "document.pdf",
        fileSize,
        srcAbsPath: f.path,
      });
      convertRow = persisted;
      if (convertRow?.convertId) {
        try {
          await setBankConvertStatus(convertRow.convertId, "extracting");
        } catch {}
      }
    } catch (err) {
      console.error("Persist upload copy failed:", err?.message || err);
    }

    // Decrypt if needed
    const suppliedPw = req.body?.pdfPassword || req.body?.password || "";
    let tmpPath = f.path;

    try {
      const srcBuf = await fs.readFile(f.path);
      const dec = await ensureDecrypted(srcBuf, suppliedPw);
      if (dec.wasEncrypted) {
        tmpPath = path.join(os.tmpdir(), `dec_${Date.now().toString(36)}.pdf`);
        await fs.writeFile(tmpPath, dec.buffer);
      }
    } catch (e) {
      if (e?.code === "PDF_PASSWORD_REQUIRED")
        return HDR(
          res,
          "PDF is password-protected. Please provide pdfPassword.",
          423
        );
      if (e?.code === "PDF_DECRYPT_FAILED")
        return HDR(res, "Invalid password or failed to decrypt PDF.", 423);
    }

    // page count
    let pageCount = 0;
    try {
      const buf = await fs.readFile(tmpPath);
      const isPdf =
        f.mimetype === "application/pdf" ||
        /\.pdf$/i.test(f.originalname || "");
      pageCount = isPdf ? await countPdfPages(buf) : 1;
    } catch (e) {
      console.warn("Failed to count pages:", e?.message);
      pageCount = 1;
    }

    const jobId = await startJobFromFile(tmpPath, f.originalname, f.mimetype);
    JOBS.set(jobId, {
      originalName: f.originalname,
      startedAt: Date.now(),
      status: "started",
      type: "single",
      userId: req.user?.id,
      fileSize,
      pageCount,
      convertId: convertRow?.convertId || null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
    });

    if (convertRow?.convertId) {
      await setBankConvertJobId(convertRow.convertId, jobId);
    }

    res.json({ jobId, originalName: f.originalname });
  } catch (e) {
    console.error("bank.start:", e?.response?.data || e.message);
    res.status(500).json({ message: "Failed to start extraction" });
  }
}

/* ---------------- STATUS ---------------- */
export async function status(req, res) {
  try {
    const { id } = req.params;
    const meta = JOBS.get(id);

    if (meta?.type === "group") {
      const statuses = [];
      let done = 0;

      for (const jid of meta.parts || []) {
        try {
          const st = await getStatus(jid);
          const s = String(st?.status || "").toLowerCase();
          statuses.push({ jobId: jid, status: s, error: st?.error });
          if (s === "completed") done++;
        } catch {
          statuses.push({ jobId: jid, status: "error" });
        }
      }

      const overall =
        done === (meta.parts || []).length ? "completed" : "processing";
      return res.json({ status: overall, parts: statuses });
    }

    const st = await getStatus(id);
    const status = String(st?.status || "").toLowerCase();
    res.json(st?.error ? { status, error: st.error } : { status });
  } catch (e) {
    console.error("bank.status:", e?.response?.data || e.message);
    res.status(500).json({ status: "error", message: "status check failed" });
  }
}

// ---------------- Core transaction projection ----------------

/* ---------------- Helper: merge job result(s) ---------------- */

function normalizeHeaderLabel(label) {
  const raw = String(label || "").trim();
  if (!raw) return raw;

  const lower = raw
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.]/g, "")
    .trim();

  // Date-like
  if (/^date$/.test(lower)) return "Date";
  if (/^(txn|transaction|trans|tran|posting|value) date$/.test(lower))
    return "Date";

  // Description / narration
  if (
    /^(description|desc|details|detail|narration|particulars?)$/.test(lower)
  ) {
    return "Description";
  }

  // Reference number-like
  if (
    /(ref|utr|reference)( no| number| #)?$/.test(lower) ||
    /^utr no$/.test(lower) ||
    /^utr number$/.test(lower)
  ) {
    return "Reference Number";
  }

  // Debit
  if (/^(debit|dr|withdrawal|withdrawn|amount debited?)$/.test(lower)) {
    return "Debit";
  }

  // Credit
  if (/^(credit|cr|deposit|amount credited?)$/.test(lower)) {
    return "Credit";
  }

  // Balance
  if (/^(balance|bal|closing balance|running balance)$/.test(lower)) {
    return "Balance";
  }

  // Fallback: keep the original bank label
  return raw;
}

function mergeCellValue(target, key, value) {
  if (value == null) return;
  const v = String(value).trim();
  if (!v) return;

  const existing = target[key];

  if (existing == null || String(existing).trim() === "") {
    // If empty, just set it
    target[key] = v;
    return;
  }

  const existingStr = String(existing).trim();

  // Avoid duplicating the same text
  if (existingStr === v) return;

  // For description-like fields, concatenation can be OK
  if (key === "Description") {
    target[key] = `${existingStr} ${v}`.trim();
    return;
  }

  // For other fields, if different, keep the first non-empty (do nothing)
  // If you want to see both versions, you could instead join with " | "
  // target[key] = `${existingStr} | ${v}`;
}

// async function collectHeadersAndRowsForJob(id) {
//     const meta = JOBS.get(id);
//     const headersSet = new Set();
//     const headersOrder = [];
//     const rowsAccum = [];

//     async function collectOne(jobId) {
//         const r = await getResult(jobId);
//         if (r.status !== "completed") {
//             throw new Error("Result not ready");
//         }

//         const data = r.data || {};
//         const h = Array.isArray(data.headers) ? data.headers : [];
//         const rs = Array.isArray(data.rows) ? data.rows : [];

//         // Union headers (for multi-chunk group jobs)
//         h.forEach((col) => {
//             if (!headersSet.has(col)) {
//                 headersSet.add(col);
//                 headersOrder.push(col);
//             }
//         });

//         // Normalize each row into an object keyed by those headers
//         rs.forEach((row) => {
//             let obj;
//             if (Array.isArray(row)) {
//                 obj = {};
//                 h.forEach((col, idx) => {
//                     obj[col] = row[idx] ?? "";
//                 });
//             } else {
//                 obj = { ...(row || {}) };
//             }
//             rowsAccum.push(obj);
//         });
//     }

//     if (meta?.type === "group") {
//         for (const jid of meta.parts || []) {
//             await collectOne(jid);
//         }
//     } else {
//         await collectOne(id);
//     }

//     const headers = headersOrder;

//     const normalizedRows = rowsAccum.map((r) => {
//         const o = {};
//         headers.forEach((col) => {
//             o[col] = r[col] ?? "";
//         });
//         return o;
//     });

//     const baseName = (meta?.originalName || "bank_statements").replace(
//         /\.[^/.]+$/,
//         ""
//     );

//     return { headers, rows: normalizedRows, baseName, meta };
// }

// async function collectHeadersAndRowsForJob(id) {
//     const meta = JOBS.get(id);
//     const headersSet = new Set();   // canonical headers
//     const headersOrder = [];        // canonical headers in order
//     const rowsAccum = [];

//     async function collectOne(jobId) {
//         const r = await getResult(jobId);
//         if (r.status !== "completed") {
//             throw new Error("Result not ready");
//         }

//         const data = r.data || {};
//         const h = Array.isArray(data.headers) ? data.headers : [];
//         const rs = Array.isArray(data.rows) ? data.rows : [];

//         // Build per-job mapping: original header -> canonical header
//         const headerMap = {};
//         h.forEach((orig) => {
//             const canon = normalizeHeaderLabel(orig);
//             headerMap[orig] = canon;
//             if (!headersSet.has(canon)) {
//                 headersSet.add(canon);
//                 headersOrder.push(canon);
//             }
//         });

//         // Normalize each row into an object keyed by canonical headers
//         rs.forEach((row) => {
//             const obj = {};

//             if (Array.isArray(row)) {
//                 // array-of-arrays (just in case)
//                 row.forEach((val, idx) => {
//                     const orig = h[idx] ?? `Col ${idx + 1}`;
//                     const canon = headerMap[orig] || normalizeHeaderLabel(orig);
//                     mergeCellValue(obj, canon, val);
//                 });
//             } else if (row && typeof row === "object") {
//                 // array-of-objects (what normalizeLLMJson produces)
//                 Object.entries(row).forEach(([orig, val]) => {
//                     const canon = headerMap[orig] || normalizeHeaderLabel(orig);
//                     mergeCellValue(obj, canon, val);
//                 });
//             }

//             rowsAccum.push(obj);
//         });
//     }

//     if (meta?.type === "group") {
//         for (const jid of meta.parts || []) {
//             await collectOne(jid);
//         }
//     } else {
//         await collectOne(id);
//     }

//     const headers = headersOrder;

//     const normalizedRows = rowsAccum.map((r) => {
//         const o = {};
//         headers.forEach((col) => {
//             o[col] = r[col] ?? "";
//         });
//         return o;
//     });

//     const baseName = (meta?.originalName || "bank_statements").replace(
//         /\.[^/.]+$/,
//         ""
//     );

//     return { headers, rows: normalizedRows, baseName, meta };
// }

async function collectHeadersAndRowsForJob(id) {
  const meta = JOBS.get(id);
  const headersSet = new Set(); // canonical headers
  const headersOrder = []; // canonical headers in order
  const rowsAccum = [];
  let summary = {}; // account summary (first non-empty we see)

  async function collectOne(jobId, index) {
    const r = await getResult(jobId);
    if (r.status !== "completed") {
      throw new Error("Result not ready");
    }

    const data = r.data || {};
    const h = Array.isArray(data.headers) ? data.headers : [];
    const rs = Array.isArray(data.rows) ? data.rows : [];

    // ---- Accumulate token usage from Gemini ----
    if (data?.__usage) {
      meta.totalInputTokens = (meta.totalInputTokens || 0) + (data.__usage.inputTokens || 0);
      meta.totalOutputTokens = (meta.totalOutputTokens || 0) + (data.__usage.outputTokens || 0);
    }

    // ---- Capture summary (first non-empty) ----
    if (
      (!summary || Object.keys(summary).length === 0) &&
      data.summary &&
      typeof data.summary === "object" &&
      !Array.isArray(data.summary) &&
      Object.keys(data.summary).length > 0
    ) {
      summary = data.summary;
    }

    // Build per-job mapping: original header -> canonical header
    const headerMap = {};
    h.forEach((orig) => {
      const canon = normalizeHeaderLabel(orig);
      headerMap[orig] = canon;
      if (!headersSet.has(canon)) {
        headersSet.add(canon);
        headersOrder.push(canon);
      }
    });

    // Normalize each row into an object keyed by canonical headers
    rs.forEach((row) => {
      const obj = {};

      if (Array.isArray(row)) {
        // array-of-arrays
        row.forEach((val, idx) => {
          const orig = h[idx] ?? `Col ${idx + 1}`;
          const canon = headerMap[orig] || normalizeHeaderLabel(orig);
          mergeCellValue(obj, canon, val);
        });
      } else if (row && typeof row === "object") {
        // array-of-objects
        Object.entries(row).forEach(([orig, val]) => {
          const canon = headerMap[orig] || normalizeHeaderLabel(orig);
          mergeCellValue(obj, canon, val);
        });
      }

      rowsAccum.push(obj);
    });
  }

  if (meta?.type === "group") {
    let idx = 0;
    for (const jid of meta.parts || []) {
      await collectOne(jid, idx++);
    }
  } else {
    await collectOne(id, 0);
  }

  const headers = headersOrder;

  const normalizedRows = rowsAccum.map((r) => {
    const o = {};
    headers.forEach((col) => {
      o[col] = r[col] ?? "";
    });
    return o;
  });

  const baseName = (meta?.originalName || "bank_statements").replace(
    /\.[^/.]+$/,
    ""
  );

  return { headers, rows: normalizedRows, baseName, meta, summary };
}

/* ---------------- RESULT ---------------- */
export async function result(req, res) {
  const { id } = req.params;
  try {
    // const { headers, rows: allRows, baseName, meta } =
    //     await collectHeadersAndRowsForJob(id);

    const {
      headers,
      rows: allRows,
      baseName,
      meta,
      summary,
    } = await collectHeadersAndRowsForJob(id);

    const columns = headers.map((h) => ({ key: h, label: h }));

    // Resolve convertId (single or group)
    let convertIdForUpdate = meta?.convertId || null;
    if (!convertIdForUpdate && meta?.type === "group") {
      const firstPart = (meta?.parts || []).find(
        (jid) => JOBS.get(jid)?.convertId
      );
      if (firstPart) convertIdForUpdate = JOBS.get(firstPart).convertId;
    }

    // Decide JSON path under uploads/bank_statements/json/...
    const jsonRel = withExt(
      buildBankLocalPath({ type: "json", originalName: `${baseName}.json` }),
      ".json"
    );

    try {
      // await writeJsonLocal({
      //     json: { headers, rows: allRows },
      //     destRelPath: jsonRel,
      // });

      await writeJsonLocal({
        json: { headers, rows: allRows, summary: summary || {} },
        destRelPath: jsonRel,
      });

      const convertId = convertIdForUpdate || meta?.convertId || null;
      if (convertId) {
        await setBankConvertOutputJsonPath(convertId, jsonRel, "extracted");
      }
    } catch (err) {
      console.error("Failed to persist JSON:", err?.message || err);
    }

    // Document count update
    try {
      const jobMeta = meta || JOBS.get(id);
      if (jobMeta && jobMeta.userId) {
        const fileName = jobMeta.originalName || null;
        const fileSize = jobMeta.fileSize || 0;
        const pageCount = jobMeta.pageCount || 0;
        await updateDocumentCount(
          jobMeta.userId,
          1,
          fileSize,
          "bank_statements",
          fileName,
          pageCount,
          jobMeta.totalInputTokens || 0,
          jobMeta.totalOutputTokens || 0
        );
      }
    } catch (err) {
      console.error("Failed to update document count:", err);
    }

    const downloadFileName = `${baseName}.xlsx`;

    return res.json({
      title: "Bank Statement Results",
      jobId: id,
      columns,
      rows: allRows,
      tableTable: { columns, rows: allRows },
      downloadFileName,
      summary: summary || {},
    });
  } catch (e) {
    const metaJ = JOBS.get(id);
    let convertIdFail = metaJ?.convertId || null;
    if (!convertIdFail && metaJ?.type === "group") {
      const firstPart = (metaJ?.parts || []).find(
        (jid) => JOBS.get(jid)?.convertId
      );
      if (firstPart) convertIdFail = JOBS.get(firstPart).convertId;
    }
    if (convertIdFail) {
      try {
        await setBankConvertStatus(
          convertIdFail,
          "failed",
          String(e?.message || "failed")
        );
      } catch {}
    }

    const msg = e?.message || "";
    const code = /not ready/i.test(msg) ? 425 : 500;
    console.error("bank.result:", e?.response?.data || e.message);
    res.status(code).json({ message: "Failed to fetch result" });
  }
}

/* ---------------- Excel (xlsx-js-style) ---------------- */

// async function buildWorkbookBufferForJob(id) {
//     const { headers, rows, baseName } = await collectHeadersAndRowsForJob(id);

//     const safeName = (baseName || "bank_statements").substring(0, 28);
//     const sheetName = safeName || "Transactions";
//     const fileName = `${safeName || "bank_statements"}.xlsx`;

//     // Build AOA: first row headers, then data
//     const data = [
//         headers,
//         ...rows.map((r) => headers.map((h) => r[h] ?? "")),
//     ];

//     const ws = XLSX.utils.aoa_to_sheet(data);

//     // Style header row
//     if (headers.length) {
//         for (let c = 0; c < headers.length; c++) {
//             const cellRef = XLSX.utils.encode_cell({ r: 0, c });
//             const cell = ws[cellRef] || {};
//             cell.s = {
//                 font: {
//                     bold: true,
//                     color: { rgb: "FFFFFFFF" },
//                 },
//                 fill: {
//                     patternType: "solid",
//                     fgColor: { rgb: "FF486581" }, // TVC-ish bluish header
//                 },
//                 alignment: {
//                     vertical: "center",
//                     horizontal: "left",
//                     wrapText: true,
//                 },
//                 border: {
//                     top: { style: "thin", color: { rgb: "FFBAC7D5" } },
//                     left: { style: "thin", color: { rgb: "FFBAC7D5" } },
//                     right: { style: "thin", color: { rgb: "FFBAC7D5" } },
//                     bottom: { style: "medium", color: { rgb: "FFBAC7D5" } },
//                 },
//             };
//             ws[cellRef] = cell;
//         }
//     }

//     // Column widths
//     const wscols = headers.map((h, colIdx) => {
//         let maxLen = String(h || "").length;
//         rows.forEach((r) => {
//             const v = r[h] ?? "";
//             const s = String(v);
//             if (s.length > maxLen) maxLen = s.length;
//         });
//         return { wch: Math.min(Math.max(maxLen + 4, 12), 50) };
//     });
//     ws["!cols"] = wscols;

//     // Auto height & basic border for body cells
//     const rowCount = data.length;
//     for (let r = 1; r < rowCount; r++) {
//         for (let c = 0; c < headers.length; c++) {
//             const cellRef = XLSX.utils.encode_cell({ r, c });
//             const cell = ws[cellRef] || { v: data[r][c] ?? "" };
//             cell.s = {
//                 ...(cell.s || {}),
//                 alignment: {
//                     vertical: "center",
//                     horizontal: "left",
//                     wrapText: true,
//                 },
//                 border: {
//                     top: { style: "thin", color: { rgb: "FFE1E6EB" } },
//                     left: { style: "thin", color: { rgb: "FFE1E6EB" } },
//                     right: { style: "thin", color: { rgb: "FFE1E6EB" } },
//                     bottom: { style: "thin", color: { rgb: "FFE1E6EB" } },
//                 },
//             };
//             ws[cellRef] = cell;
//         }
//     }

//     const wb = XLSX.utils.book_new();
//     XLSX.utils.book_append_sheet(wb, ws, sheetName || "Transactions");

//     const buf = XLSX.write(wb, {
//         bookType: "xlsx",
//         type: "buffer",
//     });

//     return { buffer: buf, fileName };
// }

async function buildWorkbookBufferForJob(id) {
  const { headers, rows, baseName, summary } =
    await collectHeadersAndRowsForJob(id);

  const safeName = (baseName || "bank_statements").substring(0, 28);
  const sheetName = safeName || "Transactions";
  const fileName = `${safeName || "bank_statements"}.xlsx`;

  const wb = XLSX.utils.book_new();

  /* ---------- Sheet 1: Transactions ---------- */
  const txData = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ""))];

  const wsTx = XLSX.utils.aoa_to_sheet(txData);

  // Style header row
  if (headers.length) {
    for (let c = 0; c < headers.length; c++) {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c });
      const cell = wsTx[cellRef] || {};
      cell.s = {
        font: {
          bold: true,
          color: { rgb: "FFFFFFFF" },
        },
        fill: {
          patternType: "solid",
          fgColor: { rgb: "FF486581" },
        },
        alignment: {
          vertical: "center",
          horizontal: "left",
          wrapText: true,
        },
        border: {
          top: { style: "thin", color: { rgb: "FFBAC7D5" } },
          left: { style: "thin", color: { rgb: "FFBAC7D5" } },
          right: { style: "thin", color: { rgb: "FFBAC7D5" } },
          bottom: { style: "medium", color: { rgb: "FFBAC7D5" } },
        },
      };
      wsTx[cellRef] = cell;
    }
  }

  // Column widths
  const wscolsTx = headers.map((h) => {
    let maxLen = String(h || "").length;
    rows.forEach((r) => {
      const v = r[h] ?? "";
      const s = String(v);
      if (s.length > maxLen) maxLen = s.length;
    });
    return { wch: Math.min(Math.max(maxLen + 4, 12), 50) };
  });
  wsTx["!cols"] = wscolsTx;

  // Body styles
  const txRowCount = txData.length;
  for (let r = 1; r < txRowCount; r++) {
    for (let c = 0; c < headers.length; c++) {
      const cellRef = XLSX.utils.encode_cell({ r, c });
      const cell = wsTx[cellRef] || { v: txData[r][c] ?? "" };
      cell.s = {
        ...(cell.s || {}),
        alignment: {
          vertical: "center",
          horizontal: "left",
          wrapText: true,
        },
        border: {
          top: { style: "thin", color: { rgb: "FFE1E6EB" } },
          left: { style: "thin", color: { rgb: "FFE1E6EB" } },
          right: { style: "thin", color: { rgb: "FFE1E6EB" } },
          bottom: { style: "thin", color: { rgb: "FFE1E6EB" } },
        },
      };
      wsTx[cellRef] = cell;
    }
  }

  XLSX.utils.book_append_sheet(wb, wsTx, sheetName || "Transactions");

  /* ---------- Sheet 2: Account Summary ---------- */
  const summaryEntries =
    summary && typeof summary === "object" ? Object.entries(summary) : [];

  if (summaryEntries.length) {
    const sumData = [
      ["Field", "Value"],
      ...summaryEntries.map(([k, v]) => [k, v == null ? "" : String(v)]),
    ];

    const wsSum = XLSX.utils.aoa_to_sheet(sumData);

    // Style summary header
    const hdrCells = ["A1", "B1"];
    hdrCells.forEach((ref) => {
      const cell = wsSum[ref] || {};
      cell.s = {
        font: {
          bold: true,
          color: { rgb: "FFFFFFFF" },
        },
        fill: {
          patternType: "solid",
          fgColor: { rgb: "FF486581" },
        },
        alignment: {
          vertical: "center",
          horizontal: "left",
          wrapText: true,
        },
        border: {
          top: { style: "thin", color: { rgb: "FFBAC7D5" } },
          left: { style: "thin", color: { rgb: "FFBAC7D5" } },
          right: { style: "thin", color: { rgb: "FFBAC7D5" } },
          bottom: { style: "medium", color: { rgb: "FFBAC7D5" } },
        },
      };
      wsSum[ref] = cell;
    });

    // Column widths: "Field" narrow-ish, "Value" wider
    wsSum["!cols"] = [{ wch: 28 }, { wch: 60 }];

    const sumRowCount = sumData.length;
    for (let r = 1; r < sumRowCount; r++) {
      for (let c = 0; c < 2; c++) {
        const cellRef = XLSX.utils.encode_cell({ r, c });
        const cell = wsSum[cellRef] || { v: sumData[r][c] ?? "" };
        cell.s = {
          ...(cell.s || {}),
          alignment: {
            vertical: "center",
            horizontal: c === 0 ? "left" : "left",
            wrapText: true,
          },
          border: {
            top: { style: "thin", color: { rgb: "FFE1E6EB" } },
            left: { style: "thin", color: { rgb: "FFE1E6EB" } },
            right: { style: "thin", color: { rgb: "FFE1E6EB" } },
            bottom: { style: "thin", color: { rgb: "FFE1E6EB" } },
          },
        };
        wsSum[cellRef] = cell;
      }
    }

    XLSX.utils.book_append_sheet(wb, wsSum, "Account Summary");
  }

  const buf = XLSX.write(wb, {
    bookType: "xlsx",
    type: "buffer",
  });

  return { buffer: buf, fileName };
}

export async function excelByJob(req, res) {
  try {
    const { id } = req.params;
    const { buffer, fileName } = await buildWorkbookBufferForJob(id);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (e) {
    console.error("bank.excelByJob:", e?.response?.data || e.message);
    res.status(500).json({ message: "Excel download failed" });
  }
}

export async function excelRebuild(req, res) {
  // Same behavior – builds fresh from Gemini result
  return excelByJob(req, res);
}

/**
 * GET /api/bank/extract/result/:id
 * Returns the full extracted data in a structured format.
 */
export async function getExtractionResult(req, res) {
  const { id } = req.params;
  let meta = JOBS.get(id);
  let dbRecord = null;

  // 1) Try Database if not in Map (survives restarts)
  if (!meta) {
    try {
      dbRecord = await getBankConvertByJobId(id);
      if (dbRecord) {
        meta = {
          originalName: dbRecord.file_name,
          status: dbRecord.status === "extracted" ? "completed" : "processing",
          type: "single", // Assume single if looking up by job_id from DB
          convertId: dbRecord.id,
          fileOutputJsonPath: dbRecord.file_output_json_path,
        };
      }
    } catch (err) {
      console.warn("DB lookup failed for jobId:", id, err.message);
    }
  }

  if (!meta) {
    return res.status(404).json({
      success: false,
      message: "Extraction job not found."
    });
  }

  try {
    let currentStatus = "processing";
    let summary = {};
    let allRows = [];

    // 2) Handle In-Memory Job
    if (JOBS.has(id)) {
      const st = await getStatus(id);
      currentStatus = String(st?.status || "").toLowerCase();

      if (currentStatus === "completed") {
        const result = await collectHeadersAndRowsForJob(id);
        allRows = result.rows;
        summary = result.summary;
      } else if (currentStatus === "error") {
        return res.status(500).json({
          success: false,
          jobId: id,
          status: "error",
          message: st.error || "Extraction failed."
        });
      }
    } 
    // 3) Handle DB-only Job (completed)
    else if (dbRecord && dbRecord.status === "extracted" && dbRecord.file_output_json_path) {
      try {
        const saved = await readJsonLocal(dbRecord.file_output_json_path);
        allRows = saved.rows || [];
        summary = saved.summary || {};
        currentStatus = "completed";
      } catch (err) {
        console.error("Failed to read persistent JSON:", err.message);
        currentStatus = "processing"; // fallback to processing if file missing
      }
    }
    // 4) Handle DB-only Job (still processing)
    else if (dbRecord) {
      currentStatus = "processing";
    }

    if (currentStatus === "processing" || currentStatus === "started" || currentStatus === "queued") {
      return res.json({
        success: true,
        jobId: id,
        status: "processing",
        originalName: meta.originalName || "document.pdf",
      });
    }

    // Map summary fields to requested schema
    const data = {
      type: summary.type || summary.document_type || summary["Document Type"] || null,
      date: summary.date || summary.invoice_date || summary["Date"] || null,
      invoice_number: summary.invoice_number || summary.bill_number || summary.receipt_no || summary["Invoice Number"] || null,
      invoice_category: summary.invoice_category || summary.category || summary["Category"] || null,
      supplier_vendor: summary.supplier_vendor || summary.supplier || summary.vendor || summary["Supplier Name"] || null,
      party: summary.party || summary.customer || summary.customer_name || summary["Customer Name"] || null,
      taxable_amount: summary.taxable_amount || summary.before_tax_amount || summary["Taxable Amount"] || null,
      vat_amount: summary.vat_amount || summary.vat || summary["VAT Amount"] || null,
      gross_amount: summary.gross_amount || summary.total || summary.net_amount || summary["Total Amount"] || null,
      currency: summary.currency || summary["Currency"] || null,
      line_items: allRows || [],
      additional_fields: summary,
      raw_text: meta.raw_text || null,
    };

    return res.json({
      success: true,
      jobId: id,
      status: "completed",
      originalName: meta.originalName || "document.pdf",
      data: data
    });
  } catch (e) {
    console.error("getExtractionResult error:", e);
    const msg = e?.message || "Failed to fetch result";
    res.status(500).json({
      success: false,
      jobId: id,
      message: msg
    });
  }
}
