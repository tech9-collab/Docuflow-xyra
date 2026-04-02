// Gemini 

// controllers/billsController.js
import XLSX from "xlsx-js-style";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

import {
  uploadBufferToGemini,
  extractJsonFromFile,
  extractJsonFromInlineBuffer,
} from "../lib/gemini.js";
import {
  BILLS_SYSTEM_PROMPT,
  BILLS_USER_PROMPT,
  BILLS_MULTI_DOC_COUNT_PROMPT,
  buildBillsForceExtractPrompt,
  buildBillsMultiDocRetryPrompt,
} from "../lib/billsPrompt.js";
import { normalizeBillRecord } from "../lib/billsNormalize.js";
import { updateDocumentCount } from "../initDatabase.js";

const CONCURRENCY = Number(process.env.BILLS_CONCURRENCY || 4);
const PDF_PAGE_IMAGE_DENSITY = Number(
  process.env.BILLS_PDF_PAGE_IMAGE_DENSITY || 300
);
const PDF_PAGE_IMAGE_MAX_SIDE = Number(
  process.env.BILLS_PDF_PAGE_IMAGE_MAX_SIDE || 3200
);
const PDF_PAGE_IMAGE_QUALITY = Number(
  process.env.BILLS_PDF_PAGE_IMAGE_QUALITY || 88
);

function hasAnyUsableBillValue(j = {}) {
  if (!j || typeof j !== "object") return false;
  const hasId =
    String(j?.receipt_no || "").trim() !== "" ||
    String(j?.bill_no || "").trim() !== "";
  const hasSupplier = String(j?.supplier || "").trim() !== "";
  const hasDate = String(j?.date || "").trim() !== "";
  const hasAmount = [
    j?.before_tax_amount,
    j?.vat,
    j?.net_amount,
    j?.total,
    j?.amount,
  ].some((x) => Number.isFinite(Number(String(x).replace(/[, ]/g, ""))));

  return hasId || hasSupplier || hasDate || hasAmount;
}

function coerceBillObjects(payload) {
  const out = [];
  let claimedCount = 0;
  const pushObj = (x) => {
    if (x && typeof x === "object" && !Array.isArray(x)) out.push(x);
  };

  if (Array.isArray(payload)) {
    payload.forEach(pushObj);
  } else if (payload && typeof payload === "object") {
    if (
      typeof payload.total_documents_found === "number" &&
      payload.total_documents_found > claimedCount
    ) {
      claimedCount = payload.total_documents_found;
    }
    if (Array.isArray(payload.documents)) payload.documents.forEach(pushObj);
    else if (Array.isArray(payload.records)) payload.records.forEach(pushObj);
    else if (Array.isArray(payload.bills)) payload.bills.forEach(pushObj);
    else if (Array.isArray(payload.items)) payload.items.forEach(pushObj);
    else pushObj(payload);
  }

  const result = out.filter(hasAnyUsableBillValue);
  result._claimedCount = claimedCount;
  return result;
}

/**
 * POST /api/bills/extract
 * Multer already attached in routes (memory storage).
 * Returns a preview payload {title, columns, rows, downloadFileName}
 */
export async function extract(req, res) {
  try {
    const files = req.files?.length ? req.files : [];
    if (!files.length) {
      return res.status(400).json({ message: "No files uploaded." });
    }

    // Calculate total file size
    const totalFileSize = files.reduce((acc, file) => acc + (file.size || file.buffer?.length || 0), 0);
    
    // Create a list of file names
    const fileNames = files.map(f => f.originalname).join(', ');
    
    // Count pages for page count tracking
    // For PDF files, count actual pages; for image files, count each file as 1 page
    let totalPageCount = 0;
    try {
        for (const file of files) {
            const isPdf =
                file?.mimetype === "application/pdf" ||
                (file?.originalname || "").toLowerCase().endsWith(".pdf");

            if (isPdf) {
                const src = await PDFDocument.load(file.buffer);
                const pageCount = src.getPageCount();
                totalPageCount += pageCount;
            } else {
                // For images and other file types, count each file as 1 page
                totalPageCount += 1;
            }
        }
    } catch (e) {
        console.warn("Failed to count pages:", e?.message);
        // Fallback: count each file as 1 page
        totalPageCount = files.length;
    }
    
    let totalInputTokens = 0, totalOutputTokens = 0;

    // 1) Expand PDFs into single-page files; compress images
    const expanded = await expandUploads(files);
    expanded.forEach((f, i) => { f._expandedIndex = i; });

    // 2) Upload → Gemini → JSON → normalize
    const rowsByIndex = new Array(expanded.length).fill(null).map(() => []);
    await runPool(expanded, CONCURRENCY, async (f) => {
      try {
        const isImage = String(f.mimetype || "")
          .toLowerCase()
          .startsWith("image/");
        let gJSON = null;

        if (isImage) {
          // ── Two-phase multi-doc detection for images ──
          // Phase 1: Count documents
          let docCount = 1;
          try {
            const countRaw = await extractJsonFromInlineBuffer({
              buffer: f.buffer,
              mimeType: f.mimetype,
              systemPrompt: BILLS_SYSTEM_PROMPT,
              userPrompt: BILLS_MULTI_DOC_COUNT_PROMPT,
            });
            if (countRaw?.__usage) {
              totalInputTokens += countRaw.__usage.inputTokens || 0;
              totalOutputTokens += countRaw.__usage.outputTokens || 0;
            }
            const countParsed =
              countRaw && typeof countRaw === "object"
                ? countRaw
                : typeof countRaw === "string"
                ? JSON.parse(
                    countRaw
                      .replace(/```json/gi, "")
                      .replace(/```/g, "")
                      .trim()
                  )
                : {};
            const parsed = Number(countParsed?.document_count);
            if (Number.isFinite(parsed) && parsed >= 1) {
              docCount = parsed;
            }
            console.log(
              `[bills image] ${f.originalname}: count phase detected ${docCount} document(s).`
            );
          } catch (countErr) {
            console.warn(
              `[bills image] Count phase failed for ${f.originalname}, assuming 1:`,
              countErr?.message
            );
          }

          // Phase 2: Extract with count-aware prompt
          if (docCount > 1) {
            const forcePrompt = buildBillsForceExtractPrompt(docCount);
            gJSON = await extractJsonFromInlineBuffer({
              buffer: f.buffer,
              mimeType: f.mimetype,
              systemPrompt: BILLS_SYSTEM_PROMPT,
              userPrompt: forcePrompt,
            });
          } else {
            gJSON = await extractJsonFromInlineBuffer({
              buffer: f.buffer,
              mimeType: f.mimetype,
              systemPrompt: BILLS_SYSTEM_PROMPT,
              userPrompt: BILLS_USER_PROMPT,
            });
          }
          if (gJSON?.__usage) {
            totalInputTokens += gJSON.__usage.inputTokens || 0;
            totalOutputTokens += gJSON.__usage.outputTokens || 0;
          }
        } else {
          const gemFile = await uploadBufferToGemini({
            buffer: f.buffer,
            filename: f.originalname,
            mimeType: f.mimetype,
          });
          gJSON = await withRetry(
            () =>
              extractJsonFromFile({
                file: gemFile,
                systemPrompt: BILLS_SYSTEM_PROMPT,
                userPrompt: BILLS_USER_PROMPT,
              }),
            { retries: 6, baseMs: 1500 }
          );
          if (gJSON?.__usage) {
            totalInputTokens += gJSON.__usage.inputTokens || 0;
            totalOutputTokens += gJSON.__usage.outputTokens || 0;
          }
        }

        let billObjects = coerceBillObjects(gJSON);

        // Retry if Gemini claimed more documents than it actually returned
        const claimed = billObjects._claimedCount || 0;
        if (claimed > billObjects.length && billObjects.length > 0) {
          console.log(
            `[bills multi-doc retry] ${f.originalname}: Gemini claimed ${claimed} docs but returned ${billObjects.length}. Retrying...`
          );
          const retryPrompt = buildBillsMultiDocRetryPrompt(
            claimed,
            billObjects.length
          );
          let rawRetry = null;
          if (isImage) {
            rawRetry = await extractJsonFromInlineBuffer({
              buffer: f.buffer,
              mimeType: f.mimetype,
              systemPrompt: BILLS_SYSTEM_PROMPT,
              userPrompt: retryPrompt,
            });
          } else {
            const gFileRetry = await uploadBufferToGemini({
              buffer: f.buffer,
              filename: f.originalname,
              mimeType: f.mimetype,
            });
            rawRetry = await withRetry(
              () =>
                extractJsonFromFile({
                  file: gFileRetry,
                  systemPrompt: BILLS_SYSTEM_PROMPT,
                  userPrompt: retryPrompt,
                }),
              { retries: 3, baseMs: 1500 }
            );
          }
          if (rawRetry?.__usage) {
            totalInputTokens += rawRetry.__usage.inputTokens || 0;
            totalOutputTokens += rawRetry.__usage.outputTokens || 0;
          }
          const retryBills = coerceBillObjects(rawRetry);
          if (retryBills.length > billObjects.length) {
            console.log(
              `[bills multi-doc retry] ${f.originalname}: Retry returned ${retryBills.length} docs (improved from ${billObjects.length}).`
            );
            billObjects = retryBills;
          }
        }

        billObjects.forEach((b) => {
          rowsByIndex[f._expandedIndex].push(normalizeBillRecord(b, f.originalname));
        });
      } catch (e) {
        console.error(`Bill failed (${f.originalname}):`, e?.message || e);
      }
    });

    // Flatten results in the original expanded order
    const rows = rowsByIndex.flat();

    const COLUMNS_ORDER = [
      "DATE",
      "BILL/RECEIPT NO",
      "SUPPLIER/VENDOR",
      "TRN",
      "BEFORE TAX AMOUNT",
      "VAT",
      "NET AMOUNT",
      "PAYMENT METHOD",
      "SOURCE",
    ];
    const columns = COLUMNS_ORDER.map((k) => ({ key: k, label: k }));

    // Update document count now that we have token usage
    await updateDocumentCount(
      req.user.id,
      files.length,
      totalFileSize,
      "bills",
      fileNames,
      totalPageCount,
      totalInputTokens,
      totalOutputTokens
    );

    return res.json({
      title: "Bills Results",
      columns,
      rows,
      downloadFileName: "Bills.xlsx",
    });
  } catch (e) {
    console.error("bills.extract error:", e);
    res.status(500).json({ message: e.message || "Failed to extract bills." });
  }
}

/**
 * POST /api/bills/excel
 * Body: { rows: Array<rowLike> }  (usually the rows you just got from /extract)
 * Returns an .xlsx file.
 */
export async function excel(req, res) {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const ORDER = [
      "DATE",
      "BILL/RECEIPT NO",
      "SUPPLIER/VENDOR",
      "TRN",
      "BEFORE TAX AMOUNT",
      "VAT",
      "NET AMOUNT",
      "PAYMENT METHOD",
      "SOURCE",
    ];

    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      wb,
      sheetFromObjects(rows, ORDER),
      "Bills (UAE)"
    );

    // Simple totals sheet
    const totals = {
      beforeTax: sumCol(rows, "BEFORE TAX AMOUNT"),
      vat: sumCol(rows, "VAT"),
      net: sumCol(rows, "NET AMOUNT"),
    };
    XLSX.utils.book_append_sheet(wb, summarySheet(totals), "Totals");

    const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", 'attachment; filename="Bills.xlsx"');
    res.send(buf);
  } catch (e) {
    console.error("bills.excel error:", e);
    res.status(500).json({ message: e.message || "Failed to build Excel." });
  }
}

/* ---------------- internals (same style as invoices) ---------------- */

async function expandUploads(files) {
  const out = [];
  for (const f of files) {
    const isPdf =
      f?.mimetype === "application/pdf" ||
      (f?.originalname || "").toLowerCase().endsWith(".pdf");

    if (isPdf) {
      try {
        const pages = await splitPdfToPageImages(f.buffer, f.originalname);
        out.push(...pages);
      } catch (e) {
        console.warn(
          `PDF page-to-image split failed (${f.originalname}), falling back to page PDFs:`,
          e?.message || e
        );
        try {
          out.push(...(await splitPdfToPagePdfs(f.buffer, f.originalname)));
        } catch (fallbackErr) {
          console.warn(
            `PDF fallback split also failed (${f.originalname}):`,
            fallbackErr?.message || fallbackErr
          );
          out.push({
            originalname: f.originalname,
            mimetype: f.mimetype,
            buffer: f.buffer,
          });
        }
      }
    } else {
      const buf = await maybeCompressImage(f.buffer, f.mimetype);
      out.push({
        originalname: f.originalname,
        mimetype: buf ? "image/jpeg" : f.mimetype,
        buffer: buf || f.buffer,
      });
    }
  }
  return out;
}

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function makePageImageName(originalName, pageIndex) {
  const base = (originalName || "document.pdf").replace(/\.pdf$/i, "");
  return `${base}-p${pageIndex}.jpg`;
}

async function renderPdfPageToImageBuffer(pdfBuffer, pageIndexZeroBased) {
  const density = clampNumber(PDF_PAGE_IMAGE_DENSITY, 300, 96, 400);
  const maxSide = clampNumber(PDF_PAGE_IMAGE_MAX_SIDE, 3200, 800, 4096);
  const quality = clampNumber(PDF_PAGE_IMAGE_QUALITY, 88, 50, 95);

  let pipeline = sharp(pdfBuffer, {
    density,
    page: pageIndexZeroBased,
    pages: 1,
    limitInputPixels: false,
  }).flatten({ background: "#ffffff" });

  const meta = await pipeline.metadata();
  const w = Number(meta?.width || 0);
  const h = Number(meta?.height || 0);
  const longest = Math.max(w, h);

  if (longest > maxSide && w > 0 && h > 0) {
    pipeline = pipeline.resize({
      width: w >= h ? maxSide : null,
      height: h > w ? maxSide : null,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  return await pipeline
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

async function splitPdfToPageImages(buffer, originalName = "document.pdf") {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pageCount = src.getPageCount();
  const pages = [];
  for (let i = 0; i < pageCount; i++) {
    const image = await renderPdfPageToImageBuffer(buffer, i);
    pages.push({
      originalname: makePageImageName(originalName, i + 1),
      mimetype: "image/jpeg",
      buffer: image,
    });
  }
  return pages;
}

async function splitPdfToPagePdfs(buffer, originalName = "document.pdf") {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pageCount = src.getPageCount();
  const pages = [];
  for (let i = 0; i < pageCount; i++) {
    const pdf = await PDFDocument.create();
    const [copied] = await pdf.copyPages(src, [i]);
    pdf.addPage(copied);
    const bytes = await pdf.save();
    pages.push({
      originalname: `${originalName.replace(/\.pdf$/i, "")}-p${i + 1}.pdf`,
      mimetype: "application/pdf",
      buffer: Buffer.from(bytes),
    });
  }
  return pages;
}

// Image precompression: JPEG ~80, max 2400px longest side
async function maybeCompressImage(buffer, mime) {
  try {
    if (!mime?.startsWith("image/")) return null;
    const img = sharp(buffer, { limitInputPixels: 268435456 });
    const meta = await img.metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;
    const longest = Math.max(w, h);
    const needsResize = longest > 3200;

    const pipeline = needsResize
      ? img.resize({
          width: w >= h ? 3200 : undefined,
          height: h > w ? 3200 : undefined,
        })
      : img;

    return await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  } catch {
    return null;
  }
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

async function withRetry(fn, { retries = 6, baseMs = 1200 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const code =
        e?.status || e?.response?.status || e?.error?.code || e?.code || 0;
      const retryable =
        code === 0 || code === 429 || (code >= 500 && code < 600);
      if (i === retries || !retryable) break;
      const jitter = Math.floor(Math.random() * 250);
      const wait = baseMs * Math.pow(2, i) + jitter;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

/* ---------- XLSX helpers (mirrors invoice style) ---------- */

function sheetFromObjects(rows, order) {
  const headers = order;
  const data = [
    headers,
    ...rows.map((r) => order.map((k) => (r[k] === undefined ? null : r[k]))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);

  // widths
  const baseCols = order.map((k) => ({
    wch: Math.max(12, Math.min(40, k.length + 4)),
  }));
  const widen = (name, wch) => {
    const i = order.indexOf(name);
    if (i !== -1) baseCols[i] = { wch };
  };
  widen("SUPPLIER/VENDOR", 28);
  widen("BILL/RECEIPT NO", 18);
  widen("PAYMENT METHOD", 16);
  widen("SOURCE", 32);
  ws["!cols"] = baseCols;

  ws["!freeze"] = { xSplit: "0", ySplit: "1", topLeftCell: "A2", state: "frozen" };

  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let C = range.s.c; C <= range.e.c; ++C) {
    const addr = XLSX.utils.encode_cell({ r: 0, c: C });
    const cell = ws[addr] || (ws[addr] = { t: "s", v: headers[C] });
    cell.s = {
      font: { bold: true },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      fill: { fgColor: { rgb: "F2F2F2" } },
    };
  }

  const numeric = new Set(["BEFORE TAX AMOUNT", "VAT", "NET AMOUNT"]);
  for (let R = 1; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const key = order[C];
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[addr];
      if (!cell) continue;
      if (numeric.has(key) && typeof cell.v === "number") {
        cell.t = "n";
        cell.z = "#,##0.00";
        cell.s = {
          ...(cell.s || {}),
          alignment: { ...(cell.s?.alignment || {}), horizontal: "right" },
        };
      }
      if (key === "DATE") {
        cell.s = {
          ...(cell.s || {}),
          alignment: { ...(cell.s?.alignment || {}), horizontal: "center" },
        };
      }
    }
  }
  return ws;
}

function sumCol(rows, key) {
  return rows.reduce((acc, r) => acc + (Number(r?.[key]) || 0), 0);
}

function summarySheet({ beforeTax, vat, net }) {
  const data = [
    ["Metric", "Amount"],
    ["Total Before Tax Amount", beforeTax],
    ["Total VAT", vat],
    ["Total Net Amount", net],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [{ wch: 28 }, { wch: 18 }];
  for (let c = 0; c < 2; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    ws[addr].s = {
      font: { bold: true },
      alignment: { horizontal: "center", vertical: "center" },
      fill: { fgColor: { rgb: "F2F2F2" } },
    };
  }
  for (let r = 1; r <= 3; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: 1 });
    const cell = ws[addr] || (ws[addr] = {});
    cell.t = "n";
    cell.z = "#,##0.00";
    cell.s = {
      ...(cell.s || {}),
      alignment: { ...(cell.s?.alignment || {}), horizontal: "right" },
    };
  }
  return ws;
}
