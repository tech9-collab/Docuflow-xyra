// controllers/invoiceConvertController.js
import multer from "multer";
import XLSX from "xlsx-js-style";
import ExcelJS from "exceljs";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { compressPdfWithGs } from "../compressor/gsCompress.js";
import os from "os";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

import {
  uploadBufferToGemini,
  uploadPathToGemini,
  extractJsonFromFile,
  extractJsonFromInlineBuffer,
} from "../lib/gemini.js";
import { normalizeRecord } from "../lib/normalize.js";
import {
  SYSTEM_PROMPT,
  USER_PROMPT,
  WHOLE_PDF_USER_PROMPT,
  PAGE_PDF_USER_PROMPT,
  buildMultiDocRetryPrompt,
  buildCompanyContext,
} from "../lib/prompt.js";
import { fetchUsdRatesOnce, toAED, round2 as round2fx } from "../lib/fx.js";
import {
  resolveInvoiceCategory,
  resolveWithOverrides,
} from "../lib/category.js";
import { updateDocumentCount } from "../initDatabase.js";

import {
  buildInvoiceLocalPath,
  copyToLocal,
  writeJsonLocal,
  withExt,
  safeName,
} from "../lib/localStorage.js";

import {
  ensureModuleId,
  getUserDepartmentId,
  getOrCreateDefaultDepartmentId,
  createInvoiceConvert,
  setInvoiceConvertStatus,
  setInvoiceConvertOutputJsonPath,
} from "../initDatabase.js";

/* ---------------- PDF helpers ---------------- */
async function countPdfPages(buffer) {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  return pdf.getPageCount();
}

async function splitPdfToPageBuffers(buffer) {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const total = src.getPageCount();
  const pages = [];
  for (let i = 0; i < total; i++) {
    const pdf = await PDFDocument.create();
    const [p] = await pdf.copyPages(src, [i]);
    pdf.addPage(p);
    const bytes = await pdf.save();
    pages.push({ index: i + 1, buffer: Buffer.from(bytes) });
  }
  return pages;
}

const PDF_PAGE_IMAGE_DENSITY = Number(
  process.env.INVOICE_PDF_PAGE_IMAGE_DENSITY || 300
);
const PDF_PAGE_IMAGE_MAX_SIDE = Number(
  process.env.INVOICE_PDF_PAGE_IMAGE_MAX_SIDE || 3200
);
const PDF_PAGE_IMAGE_QUALITY = Number(
  process.env.INVOICE_PDF_PAGE_IMAGE_QUALITY || 88
);

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function makePageImageName(originalName, pageIndex) {
  const base = path.basename(
    originalName || "document.pdf",
    path.extname(originalName || "document.pdf")
  );
  return `${base}-p${pageIndex}.jpg`;
}

async function renderPdfPageToImageBuffer(pdfBuffer, pageIndexZeroBased) {
  const density = clampNumber(PDF_PAGE_IMAGE_DENSITY, 220, 96, 400);
  const maxSide = clampNumber(PDF_PAGE_IMAGE_MAX_SIDE, 2200, 800, 4096);
  const quality = clampNumber(PDF_PAGE_IMAGE_QUALITY, 82, 50, 95);

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

function mergeInvoiceRecords(records = []) {
  const out = [];
  const byKey = new Map();

  const normKey = (v) =>
    String(v || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");

  const addPage = (target, pageStr) => {
    const p = String(pageStr || "").trim();
    if (!p) return;
    const set = new Set(
      String(target.pages_covered || "")
        .split(/[,\s]+/)
        .map((x) => x.trim())
        .filter(Boolean)
    );
    p.split(/[,\s]+/).forEach((x) => {
      if (x) set.add(x);
    });
    const tokens = Array.from(set).sort((a, b) => {
      const an = Number(a);
      const bn = Number(b);
      const aNum = Number.isFinite(an);
      const bNum = Number.isFinite(bn);
      if (aNum && bNum) return an - bn;
      if (aNum) return -1;
      if (bNum) return 1;
      return String(a).localeCompare(String(b));
    });
    target.pages_covered = tokens.join(",");
  };

  const mergeInto = (base, rec) => {
    Object.keys(rec || {}).forEach((k) => {
      if (k === "field_confidence" || k === "document_category_evidence") return;
      if (base[k] === null || base[k] === undefined || base[k] === "") {
        if (rec[k] !== null && rec[k] !== undefined && rec[k] !== "") {
          base[k] = rec[k];
        }
      }
    });
    if (rec?.field_confidence && typeof rec.field_confidence === "object") {
      base.field_confidence = base.field_confidence || {};
      Object.keys(rec.field_confidence).forEach((k) => {
        if (
          base.field_confidence[k] == null &&
          rec.field_confidence[k] != null
        ) {
          base.field_confidence[k] = rec.field_confidence[k];
        }
      });
    }
    if (
      rec?.document_category_evidence &&
      !base.document_category_evidence
    ) {
      base.document_category_evidence = rec.document_category_evidence;
    }
    if (rec?.overall_confidence != null) {
      base.overall_confidence =
        base.overall_confidence == null
          ? rec.overall_confidence
          : Math.max(base.overall_confidence, rec.overall_confidence);
    }
    addPage(base, rec?.pages_covered);
  };

  for (const rec of records) {
    const inv = normKey(rec?.invoice_number);
    const vtrn = normKey(rec?.vendor_trn);
    const ctrn = normKey(rec?.customer_trn);
    const dt = normKey(rec?.date);
    const pageKey = normKey(rec?.pages_covered);
    const vendorNameKey = normKey(
      rec?.vendor_name ||
        rec?.supplier_vendor ||
        rec?.supplier_name ||
        rec?.supplier ||
        rec?.vendor ||
        rec?.seller_name
    );
    const customerNameKey = normKey(
      rec?.customer_name ||
        rec?.party_name ||
        rec?.party ||
        rec?.customer ||
        rec?.buyer_name ||
        rec?.client_name
    );
    const beforeTaxKey = normKey(rec?.before_tax_amount);
    const vatKey = normKey(rec?.vat);
    const netKey = normKey(rec?.net_amount);
    const currencyKey = normKey(rec?.currency);

    const key = inv
      ? `${inv}|${vtrn}|${ctrn}|${dt}`
      : `${pageKey}|${vendorNameKey}|${customerNameKey}|${beforeTaxKey}|${vatKey}|${netKey}|${currencyKey}`;
    if (!key) {
      out.push(rec);
      continue;
    }
    if (!byKey.has(key)) {
      const clone = { ...rec };
      byKey.set(key, clone);
      out.push(clone);
      continue;
    }
    const existing = byKey.get(key);
    mergeInto(existing, rec);
  }

  return out;
}

const CONCURRENCY = Number(process.env.INVOICE_CONCURRENCY || 2);
const PAGE_CONCURRENCY = Math.max(
  1,
  Number(process.env.INVOICE_PAGE_CONCURRENCY || 2)
);
const EXTRACTION_CACHE_MAX = Math.max(
  10,
  Number(process.env.INVOICE_EXTRACTION_CACHE_MAX || 200)
);

const EXTRACTION_CACHE = new Map(); // key -> raw records[]
const EXTRACTION_CACHE_PERSIST = !["0", "false", "off"].includes(
  String(process.env.INVOICE_EXTRACTION_CACHE_PERSIST || "1")
    .trim()
    .toLowerCase()
);
const EXTRACTION_CACHE_VERSION = String(
  process.env.INVOICE_EXTRACTION_CACHE_VERSION || "v2"
).trim();
const EXTRACTION_CACHE_DIR = path.join(
  path.resolve(process.env.UPLOADS_ROOT || "uploads"),
  "invoice",
  "cache"
);

function makeExtractionCacheKeyFromBuffer(buf) {
  return createHash("sha256")
    .update(buf)
    .update("\n---cache-version---\n")
    .update(EXTRACTION_CACHE_VERSION)
    .update("\n---model---\n")
    .update(String(process.env.GEMINI_MODEL || "gemini-2.5-flash"))
    .update("\n---system-prompt---\n")
    .update(SYSTEM_PROMPT)
    .update("\n---single-page-prompt---\n")
    .update(USER_PROMPT)
    .update("\n---whole-pdf-prompt---\n")
    .update(WHOLE_PDF_USER_PROMPT)
    .update("\n---page-pdf-prompt---\n")
    .update(PAGE_PDF_USER_PROMPT)
    .digest("hex");
}

function getCachedExtraction(cacheKey) {
  if (!cacheKey || !EXTRACTION_CACHE.has(cacheKey)) return null;
  const val = EXTRACTION_CACHE.get(cacheKey);
  // touch key for simple LRU behavior
  EXTRACTION_CACHE.delete(cacheKey);
  EXTRACTION_CACHE.set(cacheKey, val);
  return JSON.parse(JSON.stringify(val));
}

function setCachedExtraction(cacheKey, records) {
  if (!cacheKey || !Array.isArray(records) || !records.length) return;
  EXTRACTION_CACHE.set(cacheKey, JSON.parse(JSON.stringify(records)));
  while (EXTRACTION_CACHE.size > EXTRACTION_CACHE_MAX) {
    const oldest = EXTRACTION_CACHE.keys().next().value;
    if (!oldest) break;
    EXTRACTION_CACHE.delete(oldest);
  }
}

async function getCachedExtractionAny(cacheKey) {
  const mem = getCachedExtraction(cacheKey);
  if (mem) return mem;
  if (!EXTRACTION_CACHE_PERSIST || !cacheKey) return null;

  const fp = path.join(EXTRACTION_CACHE_DIR, `${cacheKey}.json`);
  try {
    const raw = await fs.readFile(fp, "utf8");
    const parsed = JSON.parse(raw);
    const records = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.records)
      ? parsed.records
      : null;
    if (!Array.isArray(records) || !records.length) return null;
    setCachedExtraction(cacheKey, records);
    return JSON.parse(JSON.stringify(records));
  } catch {
    return null;
  }
}

async function setCachedExtractionAny(cacheKey, records) {
  setCachedExtraction(cacheKey, records);
  if (!EXTRACTION_CACHE_PERSIST || !cacheKey) return;
  if (!Array.isArray(records) || !records.length) return;

  const fp = path.join(EXTRACTION_CACHE_DIR, `${cacheKey}.json`);
  try {
    await fs.writeFile(
      fp,
      JSON.stringify({ records, cachedAt: new Date().toISOString() }),
      "utf8"
    );
  } catch (e) {
    console.warn("Failed to write invoice extraction cache:", e?.message || e);
  }
}

// ****** Job store ****** //
const JOBS = new Map();
// ****** Job store ****** //

// ****** Multer upload ****** //

// ---- multer (memory) ----
// export const upload = multer({
//   storage: multer.memoryStorage(),
//   limits: { files: 300, fileSize: 40 * 1024 * 1024 },
// });

// const TMP_DIR = "/tmp/invoices";
const TMP_DIR = path.join(os.tmpdir(), "invoices");
await fs.mkdir(TMP_DIR, { recursive: true });
if (EXTRACTION_CACHE_PERSIST) {
  await fs.mkdir(EXTRACTION_CACHE_DIR, { recursive: true });
}

export const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TMP_DIR),
    filename: (_req, file, cb) =>
      cb(
        null,
        `${Date.now()}-${Math.random().toString(36).slice(2)}-${
          file.originalname
        }`
      ),
  }),
  limits: {
    files: 1000, // allow big batches
    fileSize: 200 * 1024 * 1024, // 200MB per file
  },
});

// ****** Multer Upload ****** //

// POST /api/invoice/jobs/start
export async function startJob(req, res) {
  try {
    const country = (req.body.country || "auto").toLowerCase();

    const files = req.files?.length ? req.files : [];
    if (!files.length)
      return res.status(400).json({ message: "No files uploaded." });

    const company_name = (req.body.company_name || "").trim();
    const company_trn = (req.body.company_trn || "").trim();

    // Calculate total file size
    const totalFileSize = files.reduce(
      (acc, file) => acc + (file.size || 0),
      0
    );

    // Create a list of file names
    const fileNames = files.map((f) => f.originalname).join(", ");

    // Count pages for page count tracking
    // For PDF files, count actual pages; for image files, count each file as 1 page
    let totalPageCount = 0;
    try {
      for (const file of files) {
        if (
          file.mimetype === "application/pdf" ||
          (file.originalname || "").toLowerCase().endsWith(".pdf")
        ) {
          try {
            // For disk storage, we need to read the file
            const buffer = await fs.readFile(file.path);
            const pageCount = await countPdfPages(buffer);
            totalPageCount += pageCount;
          } catch (e) {
            console.warn(
              "Failed to count PDF pages for file:",
              file.originalname,
              e?.message
            );
            // Count as 1 page if PDF page count fails
            totalPageCount += 1;
          }
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

    const jobId = uuidv4();
    JOBS.set(jobId, {
      state: "queued",
      message: "Queued",
      total_files: files.length,
      processed_files: 0,
      progress_pct: 0,
      country,
      company_name,
      company_trn,
      files,
      uaePurchaseRows: [],
      uaeSalesRows: [],
      uaeOtherRows: [],
      uaeOtherRows: [],
      uaeAllRows: [],
      resultBuffer: null,
      preview: { columns: [], rows: [] },
      userId: req.user.id, // Store user ID for document count update
      totalFileSize: totalFileSize, // Store total file size for document count update
      totalPageCount: totalPageCount, // Store total page count for document count update
      totalInputTokens: 0,
      totalOutputTokens: 0,
    });

    processJob(jobId).catch((err) => {
      console.error("processJob fatal error:", err);
      const job = JOBS.get(jobId);
      if (job) {
        job.state = "error";
        job.message = err?.message || "Processing failed.";
      }
    });

    res.json({ job_id: jobId });
  } catch (e) {
    console.error("startJob error:", e);
    res.status(500).json({ message: e.message || "Failed to start job." });
  }
}

// GET /api/invoice/jobs/status/:id
export function jobStatus(req, res) {
  const job = JOBS.get(req.params.id);
  if (!job) return res.status(404).json({ message: "Not found" });
  res.json({
    state: job.state,
    message: job.message,
    total_files: job.total_files,
    processed_files: job.processed_files,
    progress_pct: job.progress_pct,
  });
}

// GET /api/invoice/jobs/result/:id  (Excel download)
export function jobResult(req, res) {
  const job = JOBS.get(req.params.id);
  if (!job) return res.status(404).json({ message: "Not found" });
  if (job.state !== "done" || !job.resultBuffer) {
    return res.status(400).json({ message: "Result not ready." });
  }

  const fname = "Invoices.xlsx";

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
  res.send(job.resultBuffer);

  // // cleanup after sending
  // res.on("finish", () => {
  //   JOBS.delete(req.params.id);
  // });
}

function normalizeZohoDate(value) {
  if (value == null || value === "") return "";
  const raw = String(value).trim();
  if (!raw) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;

  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toZohoText(value) {
  return value == null ? "" : String(value);
}

function toZohoNumber(value) {
  if (value == null || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? n : "";
}

function buildZohoSheet(headers, rows) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const widths = headers.map((header) => ({
    wch: Math.max(14, Math.min(28, String(header || "").length + 4)),
  }));

  const widen = (name, wch) => {
    const idx = headers.indexOf(name);
    if (idx !== -1) widths[idx] = { wch };
  };

  widen("Customer Name", 28);
  widen("Vendor Name", 28);
  widen("Tax Registration Number", 22);
  widen("Terms & Conditions", 24);
  widen("Adjustment Description", 24);
  widen("Description", 22);
  ws["!cols"] = widths;

  ws["!freeze"] = {
    xSplit: "0",
    ySplit: "1",
    topLeftCell: "A2",
    activePane: "bottomLeft",
    state: "frozen",
  };

  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    const cell = ws[addr] || (ws[addr] = { t: "s", v: headers[c] });
    cell.s = {
      font: { bold: true },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      fill: { fgColor: { rgb: "F2F2F2" } },
    };
  }

  const numericHeaders = new Set([
    "Exchange Rate",
    "Entity Discount Percent",
    "Entity Discount Amount",
    "Item Price",
    "Discount",
    "Discount Amount",
    "Adjustment",
    "Quantity",
    "Rate",
    "Tax Percentage",
    "Payment Terms",
    "Reverse Charge Tax Rate",
  ]);

  for (let r = 1; r <= range.e.r; r += 1) {
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (!cell) continue;
      if (numericHeaders.has(headers[c]) && typeof cell.v === "number") {
        cell.t = "n";
        cell.z = "#,##0.00";
        cell.s = {
          ...(cell.s || {}),
          alignment: { ...(cell.s?.alignment || {}), horizontal: "right" },
        };
      }
    }
  }

  return ws;
}

function buildZohoCsv(headers, rows) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  return XLSX.utils.sheet_to_csv(ws);
}

async function buildZohoSalesXlsx(dataRows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sales");

  // Header row
  ws.addRow(ZOHO_SALES_HEADERS);

  // Data rows
  for (const row of dataRows) {
    ws.addRow(row);
  }

  // ZOHO_SALES_HEADERS column positions (0-indexed → Excel letter):
  // 5=F  VAT Treatment
  // 8=I  Is Inclusive Tax
  // 33=AH Item Tax
  // 34=AI Item Tax %
  // 43=AR Payment Terms Label
  const DV_LAST_ROW = 10000;

  ws.dataValidations.add(`F2:F${DV_LAST_ROW}`, {
    type: "list",
    allowBlank: true,
    formulae: [
      '"dz_vat_registered,vat_registered,vat_not_registered,dz_vat_not_registered,gcc_vat_registered,gcc_vat_not_registered,non_gcc"',
    ],
    showErrorMessage: true,
    errorStyle: "stop",
    error: "Please select a valid VAT Treatment option.",
  });

  ws.dataValidations.add(`I2:I${DV_LAST_ROW}`, {
    type: "list",
    allowBlank: true,
    formulae: ['"True,False"'],
    showErrorMessage: true,
    errorStyle: "stop",
    error: "Please select True or False.",
  });

  ws.dataValidations.add(`AH2:AH${DV_LAST_ROW}`, {
    type: "list",
    allowBlank: true,
    formulae: ['"Standard Rate,Zero Rate"'],
    showErrorMessage: true,
    errorStyle: "stop",
    error: "Please select a valid Item Tax option.",
  });

  ws.dataValidations.add(`AI2:AI${DV_LAST_ROW}`, {
    type: "list",
    allowBlank: true,
    formulae: ['"5,0"'],
    showErrorMessage: true,
    errorStyle: "stop",
    error: "Please select a valid tax percentage.",
  });

  ws.dataValidations.add(`AR2:AR${DV_LAST_ROW}`, {
    type: "list",
    allowBlank: true,
    formulae: ['"Due on Receipt,Custom"'],
    showErrorMessage: true,
    errorStyle: "stop",
    error: "Please select a valid Payment Terms Label.",
  });

  return wb.xlsx.writeBuffer();
}

async function buildZohoPurchaseXlsx(dataRows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Purchase");

  // Header row
  ws.addRow(ZOHO_PURCHASE_HEADERS);

  // Data rows
  for (const row of dataRows) {
    ws.addRow(row);
  }

  // ZOHO_PURCHASE_HEADERS column positions (0-indexed → Excel letter):
  // 4=E  Bill Status
  // 5=F  VAT Treatment
  // 7=H  Is Inclusive Tax
  // 16=Q Is Billable
  // 23=X Tax Name
  // 24=Y Tax Percentage
  const DV_LAST_ROW = 10000;

  ws.dataValidations.add(`E2:E${DV_LAST_ROW}`, {
    type: "list",
    allowBlank: true,
    formulae: ['"Paid,PartiallyPaid"'],
    showErrorMessage: true,
    errorStyle: "stop",
    error: "Please select a valid Bill Status.",
  });

  ws.dataValidations.add(`F2:F${DV_LAST_ROW}`, {
    type: "list",
    allowBlank: true,
    formulae: [
      '"dz_vat_registered,vat_registered,vat_not_registered,dz_vat_not_registered,gcc_vat_registered,gcc_vat_not_registered,non_gcc"',
    ],
    showErrorMessage: true,
    errorStyle: "stop",
    error: "Please select a valid VAT Treatment option.",
  });

  ws.dataValidations.add(`H2:H${DV_LAST_ROW}`, {
    type: "list",
    allowBlank: true,
    formulae: ['"TRUE,FALSE"'],
    showErrorMessage: true,
    errorStyle: "stop",
    error: "Please select TRUE or FALSE.",
  });

  ws.dataValidations.add(`Q2:Q${DV_LAST_ROW}`, {
    type: "list",
    allowBlank: true,
    formulae: ['"TRUE,FALSE"'],
    showErrorMessage: true,
    errorStyle: "stop",
    error: "Please select TRUE or FALSE.",
  });

  ws.dataValidations.add(`X2:X${DV_LAST_ROW}`, {
    type: "list",
    allowBlank: true,
    formulae: ['"Standard Rate,Zero Rate"'],
    showErrorMessage: true,
    errorStyle: "stop",
    error: "Please select a valid Tax Name.",
  });

  ws.dataValidations.add(`Y2:Y${DV_LAST_ROW}`, {
    type: "list",
    allowBlank: true,
    formulae: ['"5,0"'],
    showErrorMessage: true,
    errorStyle: "stop",
    error: "Please select a valid Tax Percentage.",
  });

  return wb.xlsx.writeBuffer();
}

const ZOHO_SALES_HEADERS = [
  "Invoice Date",
  "Invoice Number",
  "Estimate Number",
  "Invoice Status",
  "Customer Name",
  "VAT Treatment",
  "Place Of Supply",
  "Tax Registration Number",
  "Is Inclusive Tax",
  "Invoice Level Tax",
  "Invoice Level Tax %",
  "Invoice Level Tax Type",
  "Invoice Level Tax Exemption Reason",
  "Due Date",
  "Expected Payment Date",
  "PurchaseOrder",
  "Template Name",
  "Currency Code",
  "Exchange Rate",
  "Discount Type",
  "Is Discount Before Tax",
  "Entity Discount Percent",
  "Entity Discount Amount",
  "Account",
  "Item Name",
  "SKU",
  "Item Desc",
  "Quantity",
  "Usage unit",
  "Item Price",
  "Discount",
  "Discount Amount",
  "Expense Reference ID",
  "Item Tax",
  "Item Tax %",
  "Item Tax Type",
  "Item Type",
  "Out of Scope Reason",
  "Item Tax Exemption Reason",
  "Adjustment",
  "Adjustment Description",
  "Sales person",
  "Payment Terms",
  "Payment Terms Label",
  "Shipping Charge",
  "Sales Order Number",
  "Notes",
  "Terms & Conditions",
];

const ZOHO_PURCHASE_HEADERS = [
  "Bill Date",
  "Bill Number",
  "PurchaseOrder",
  "Tax Registration Number",
  "Bill Status",
  "VAT Treatment",
  "Place Of Supply",
  "Is Inclusive Tax",
  "Vendor Name",
  "Due Date",
  "Currency Code",
  "Adjustment",
  "Adjustment Description",
  "Exchange Rate",
  "Item Name",
  "SKU",
  "Is Billable",
  "Is Landed Cost",
  "Project Name",
  "Account",
  "Description",
  "Quantity",
  "Rate",
  "Tax Name",
  "Tax Percentage",
  "Vendor Notes",
  "Tax Type",
  "Out of Scope Reason",
  "Item Exemption Code",
  "Item Type",
  "Reverse Charge Tax Name",
  "Reverse Charge Tax Rate",
  "Reverse Charge Tax Type",
  "Payment Terms",
  "ITC Eligibility",
  "Terms & Conditions",
  "Is Discount Before Tax",
  "Entity Discount Percent",
  "Entity Discount Amount",
  "Discount Account",
  "Payment Terms Label",
  "Adjustment",
  "Customer Name",
  "Warehouse Name",
  "Branch Name",
  "CF.Transporte_Name",
];

function buildZohoSalesRows(rows = []) {
  const result = [];
  const idx = Object.fromEntries(
    ZOHO_SALES_HEADERS.map((header, index) => [header, index])
  );

  for (const row of rows) {
    const lineItems = Array.isArray(row?.LINE_ITEMS) && row.LINE_ITEMS.length >= 1
      ? row.LINE_ITEMS
      : null;

    if (lineItems) {
      // One or more line items: one Zoho row per item
      for (const item of lineItems) {
        const line = ZOHO_SALES_HEADERS.map(() => "");
        line[idx["Invoice Date"]] = normalizeZohoDate(row?.DATE);
        line[idx["Invoice Number"]] = toZohoText(row?.["INVOICE NUMBER"]);
        line[idx["Invoice Status"]] = "Draft";
        line[idx["Customer Name"]] = toZohoText(row?.PARTY);
        line[idx["Place Of Supply"]] = toZohoText(row?.["PLACE OF SUPPLY"]);
        line[idx["Tax Registration Number"]] = toZohoText(row?.["CUSTOMER TRN"]);
        line[idx["Template Name"]] = "Standard Template";
        line[idx["Currency Code"]] = toZohoText(row?.CURRENCY);
        line[idx["Discount Type"]] = "item_level";
        line[idx["Is Discount Before Tax"]] = "TRUE";
        line[idx["Entity Discount Percent"]] = 0;
        line[idx["Entity Discount Amount"]] = 0;
        line[idx["Account"]] = "Sales";
        line[idx["Item Desc"]] = toZohoText(item.description);
        line[idx["Quantity"]] = item.quantity != null ? item.quantity : 1;
        line[idx["Item Price"]] = toZohoNumber(item.net_amount);
        line[idx["Discount"]] = 0;
        line[idx["Discount Amount"]] = 0;
        line[idx["Adjustment"]] = 0;
        line[idx["Adjustment Description"]] = "Adjustment";
        line[idx["Payment Terms"]] = 0;
        line[idx["Shipping Charge"]] = 0;
        line[idx["Terms & Conditions"]] = "All Terms & Conditions";
        result.push(line);
      }
    } else {
      // Single item or no line items: original behavior
      const line = ZOHO_SALES_HEADERS.map(() => "");
      line[idx["Invoice Date"]] = normalizeZohoDate(row?.DATE);
      line[idx["Invoice Number"]] = toZohoText(row?.["INVOICE NUMBER"]);
      line[idx["Invoice Status"]] = "Draft";
      line[idx["Customer Name"]] = toZohoText(row?.PARTY);
      line[idx["Place Of Supply"]] = toZohoText(row?.["PLACE OF SUPPLY"]);
      line[idx["Tax Registration Number"]] = toZohoText(row?.["CUSTOMER TRN"]);
      line[idx["Template Name"]] = "Standard Template";
      line[idx["Currency Code"]] = toZohoText(row?.CURRENCY);
      line[idx["Discount Type"]] = "item_level";
      line[idx["Is Discount Before Tax"]] = "TRUE";
      line[idx["Entity Discount Percent"]] = 0;
      line[idx["Entity Discount Amount"]] = 0;
      line[idx["Account"]] = "Sales";
      line[idx["Item Price"]] = toZohoNumber(row?.["NET AMOUNT"]);
      line[idx["Discount"]] = 0;
      line[idx["Discount Amount"]] = 0;
      line[idx["Adjustment"]] = 0;
      line[idx["Adjustment Description"]] = "Adjustment";
      line[idx["Payment Terms"]] = 0;
      line[idx["Shipping Charge"]] = 0;
      line[idx["Terms & Conditions"]] = "All Terms & Conditions";
      result.push(line);
    }
  }

  return result;
}

function buildZohoPurchaseRows(rows = []) {
  const result = [];
  const idx = {};
  ZOHO_PURCHASE_HEADERS.forEach((header, index) => {
    if (!(header in idx)) idx[header] = index;
  });

  for (const row of rows) {
    const lineItems = Array.isArray(row?.LINE_ITEMS) && row.LINE_ITEMS.length >= 1
      ? row.LINE_ITEMS
      : null;

    if (lineItems) {
      // One or more line items: one Zoho row per item
      for (const item of lineItems) {
        const line = ZOHO_PURCHASE_HEADERS.map(() => "");
        line[idx["Bill Date"]] = normalizeZohoDate(row?.DATE);
        line[idx["Bill Number"]] = toZohoText(row?.["INVOICE NUMBER"]);
        line[idx["Tax Registration Number"]] = toZohoText(row?.["SUPPLIER TRN"]);
        line[idx["Vendor Name"]] = toZohoText(row?.["SUPPLIER/VENDOR"]);
        line[idx["Currency Code"]] = toZohoText(row?.CURRENCY);
        line[idx["Description"]] = toZohoText(item.description);
        line[idx["Quantity"]] = item.quantity != null ? item.quantity : 1;
        line[idx["Rate"]] = toZohoNumber(item.net_amount);
        line[idx["Terms & Conditions"]] = "All Terms & Conditions";
        result.push(line);
      }
    } else {
      // Single item or no line items: original behavior
      const line = ZOHO_PURCHASE_HEADERS.map(() => "");
      line[idx["Bill Date"]] = normalizeZohoDate(row?.DATE);
      line[idx["Bill Number"]] = toZohoText(row?.["INVOICE NUMBER"]);
      line[idx["Tax Registration Number"]] = toZohoText(row?.["SUPPLIER TRN"]);
      line[idx["Vendor Name"]] = toZohoText(row?.["SUPPLIER/VENDOR"]);
      line[idx["Currency Code"]] = toZohoText(row?.CURRENCY);
      line[idx["Rate"]] = toZohoNumber(row?.["NET AMOUNT"]);
      line[idx["Terms & Conditions"]] = "All Terms & Conditions";
      result.push(line);
    }
  }

  return result;
}

export async function jobZohoTemplate(req, res) {
  const job = JOBS.get(req.params.id);
  if (!job) return res.status(404).json({ message: "Not found" });
  if (job.state !== "done") {
    return res.status(400).json({ message: "Result not ready." });
  }

  const kind = String(req.query.kind || "purchase")
    .trim()
    .toLowerCase();

  if (kind !== "sales" && kind !== "purchase" && kind !== "others") {
    return res.status(400).json({ message: "Invalid kind." });
  }

  if (kind === "sales" || kind === "others") {
    const sourceRows =
      kind === "sales"
        ? job.uaeSalesRows || []
        : job.uaeOtherRows || [];
    const rows = buildZohoSalesRows(sourceRows);
    const buffer = await buildZohoSalesXlsx(rows);
    const fileName =
      kind === "sales"
        ? "Zoho_Sales_Template.xlsx"
        : "Zoho_Others_Template.xlsx";
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );
    return res.send(buffer);
  }

  // Purchase: XLSX with dropdowns
  const rows = buildZohoPurchaseRows(job.uaePurchaseRows || []);
  const buffer = await buildZohoPurchaseXlsx(rows);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="Zoho_Purchase_Template.xlsx"'
  );
  res.send(buffer);
}

// GET /api/invoice/jobs/preview/:id
export function jobPreview(req, res) {
  const job = JOBS.get(req.params.id);
  if (!job) return res.status(404).json({ message: "Not found" });
  if (job.state !== "done")
    return res.status(400).json({ message: "Preview not ready." });

  const ORDER = [
    "TYPE",
    "DATE",
    "INVOICE NUMBER",
    "INVOICE CATEGORY",
    "SUPPLIER/VENDOR",
    "PARTY",
    "SUPPLIER TRN",
    "CUSTOMER TRN",
    "PLACE OF SUPPLY",
    "CURRENCY",
    "BEFORE TAX AMOUNT",
    "VAT",
    "NET AMOUNT",
    "BEFORE TAX (AED)",
    "VAT (AED)",
    "ZERO RATED (AED)",
    "NET AMOUNT (AED)",
    "CONFIDENCE",
    "SOURCE",
  ];
  const colsFor = (order) => order.map((k) => ({ key: k, label: k }));
  const table = {
    columns: colsFor(ORDER),
    rows: (job.uaeAllRows || []).slice(0, 200),
  };

  const purchaseTotals = {
    beforeTax: sumCol(job.uaePurchaseRows, "BEFORE TAX (AED)"),
    vat: sumCol(job.uaePurchaseRows, "VAT (AED)"),
    zero: sumCol(job.uaePurchaseRows, "ZERO RATED (AED)"),
    net: sumCol(job.uaePurchaseRows, "NET AMOUNT (AED)"),
  };
  const salesTotals = {
    beforeTax: sumCol(job.uaeSalesRows, "BEFORE TAX (AED)"),
    vat: sumCol(job.uaeSalesRows, "VAT (AED)"),
    zero: sumCol(job.uaeSalesRows, "ZERO RATED (AED)"),
    net: sumCol(job.uaeSalesRows, "NET AMOUNT (AED)"),
  };

  res.json({
    title: "Invoice Results",
    downloadFileName: "Invoices.xlsx",
    table,
    uaeSalesRows: job.uaeSalesRows || [],
    uaePurchaseRows: job.uaePurchaseRows || [],
    uaeOtherRows: job.uaeOtherRows || [],
    totals: { purchase: purchaseTotals, sales: salesTotals },
  });
}

// ****** Detect 'Sales' vs 'Purchase' ****** //
function detectType(gJSON, companyName, companyTrn) {
  const STOP_WORDS = new Set([
    "llc",
    "l.l.c",
    "ltd",
    "limited",
    "inc",
    "incorporated",
    "corp",
    "corporation",
    "company",
    "co",
    "co.",
    "fze",
    "fzco",
    "fzc",
    "llp",
    "l.l.p",
    "l.l.c.",
    "m/s",
    "ms",
  ]);

  const pickFirst = (...vals) => {
    for (const v of vals) {
      const s = String(v ?? "").trim();
      if (s) return s;
    }
    return "";
  };

  const normalizeNameTokens = (s) => {
    const base = String(s || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/\s+/g, " ")
      .replace(/[^a-z0-9\s]/g, "")
      .trim();
    if (!base) return [];
    return base
      .split(" ")
      .map((t) => t.trim())
      .filter((t) => t && !STOP_WORDS.has(t));
  };

  const normalizeName = (s) => normalizeNameTokens(s).join(" ");

  const cleanTrn15 = (s) => {
    if (!s) return null;
    const digits = String(s).replace(/\D/g, "");
    return digits.length === 15 ? digits : null;
  };

  const withinEditDistance = (aRaw, bRaw, maxDist) => {
    const a = String(aRaw || "");
    const b = String(bRaw || "");
    if (a === b) return true;
    if (!a || !b) return false;
    if (Math.abs(a.length - b.length) > maxDist) return false;

    const rows = a.length + 1;
    const cols = b.length + 1;
    const dp = Array.from({ length: rows }, () => Array(cols).fill(0));

    for (let i = 0; i < rows; i++) dp[i][0] = i;
    for (let j = 0; j < cols; j++) dp[0][j] = j;

    for (let i = 1; i < rows; i++) {
      let rowMin = Number.POSITIVE_INFINITY;
      for (let j = 1; j < cols; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
        if (dp[i][j] < rowMin) rowMin = dp[i][j];
      }
      if (rowMin > maxDist) return false;
    }
    return dp[rows - 1][cols - 1] <= maxDist;
  };

  const tokensStrongMatch = (aRaw, bRaw) => {
    const a = String(aRaw || "").trim();
    const b = String(bRaw || "").trim();
    if (!a || !b) return false;
    if (a === b) return true;

    const minLen = Math.min(a.length, b.length);
    const maxLen = Math.max(a.length, b.length);
    if (minLen >= 6 && (a.includes(b) || b.includes(a))) return true;

    if (maxLen < 6) return false;
    const maxDist = maxLen >= 12 ? 2 : 1;
    return withinEditDistance(a, b, maxDist);
  };

  const tokenOverlap = (aTokens, bTokens) => {
    const A = Array.from(new Set(aTokens));
    const B = Array.from(new Set(bTokens));
    const usedB = new Set();
    const sharedTokens = [];
    for (const a of A) {
      for (let i = 0; i < B.length; i++) {
        if (usedB.has(i)) continue;
        if (!tokensStrongMatch(a, B[i])) continue;
        usedB.add(i);
        sharedTokens.push(a);
        break;
      }
    }
    const shared = sharedTokens.length;
    const minSize = Math.max(1, Math.min(A.length, B.length));
    return {
      shared,
      sharedTokens,
      aCount: A.length,
      bCount: B.length,
      coverage: shared / minSize,
    };
  };

  const nameMatchesCompany = (sideName) => {
    const companyNorm = normalizeName(companyName);
    const sideNorm = normalizeName(sideName);
    if (!companyNorm || !sideNorm) return false;

    const compact = (s) =>
      String(s || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
    const companyCompact = compact(companyNorm);
    const sideCompact = compact(sideNorm);
    if (
      companyCompact &&
      sideCompact &&
      (companyCompact === sideCompact ||
        (companyCompact.length >= 8 && sideCompact.includes(companyCompact)) ||
        (sideCompact.length >= 8 && companyCompact.includes(sideCompact)))
    ) {
      return true;
    }
    if (
      companyCompact &&
      sideCompact &&
      Math.min(companyCompact.length, sideCompact.length) >= 8 &&
      withinEditDistance(
        companyCompact,
        sideCompact,
        Math.max(companyCompact.length, sideCompact.length) >= 18 ? 2 : 1
      )
    ) {
      return true;
    }

    // Exact normalized match
    if (companyNorm === sideNorm) return true;

    // Containment for cases like branches/suffixes/prefixes after OCR cleanup
    if (
      (companyNorm.length >= 6 && sideNorm.includes(companyNorm)) ||
      (sideNorm.length >= 6 && companyNorm.includes(sideNorm))
    ) {
      return true;
    }

    const companyTokens = companyNorm.split(" ").filter(Boolean);
    const sideTokens = sideNorm.split(" ").filter(Boolean);
    if (!companyTokens.length || !sideTokens.length) return false;

    const ov = tokenOverlap(companyTokens, sideTokens);

    // Relaxed token match for OCR variants (e.g., missing suffix token)
    if (ov.shared >= 2 && ov.coverage >= 0.66) return true;

    // Single-token company names: require a longer distinctive token
    if (
      ov.shared >= 1 &&
      ov.aCount === 1 &&
      ov.bCount === 1 &&
      ov.sharedTokens[0] &&
      ov.sharedTokens[0].length >= 5
    ) {
      return true;
    }

    return false;
  };

  // ── Gather identity ──
  const selfTRN = cleanTrn15(companyTrn);
  const hasSelfName = normalizeNameTokens(companyName).length > 0;
  const hasSelfIdentity = hasSelfName || !!selfTRN;

  // When company identity is not provided, do not guess Sales/Purchase.
  if (!hasSelfIdentity) {
    return {
      type: "unknown",
      reason: "SELF_IDENTITY_MISSING",
      confidence: 0,
    };
  }

  // ── Step 0: Use Gemini's own transaction_type classification (highest priority) ──
  // Gemini sees the full visual layout and was given the company identity in the prompt.
  // Its classification is more reliable than post-processing name/TRN matching.
  const geminiType = String(gJSON?.transaction_type || "").toLowerCase().trim();
  if (geminiType === "sales" || geminiType === "purchase") {
    const reason = gJSON?.transaction_type_reason || "GEMINI_VISUAL_CLASSIFICATION";
    // Cross-validate with TRN if available — TRN is definitive
    if (selfTRN) {
      const vTrn = cleanTrn15(
        pickFirst(gJSON?.vendor_trn, gJSON?.supplier_trn, gJSON?.seller_trn)
      );
      const cTrn = cleanTrn15(
        pickFirst(gJSON?.customer_trn, gJSON?.party_trn, gJSON?.buyer_trn, gJSON?.client_trn)
      );
      // If TRN explicitly contradicts Gemini's classification, trust TRN
      if (selfTRN === vTrn && geminiType === "purchase") {
        return {
          type: "sales",
          reason: "TRN_OVERRIDES_GEMINI_TYPE_vendor_trn_matches",
          confidence: 1,
        };
      }
      if (selfTRN === cTrn && geminiType === "sales") {
        return {
          type: "purchase",
          reason: "TRN_OVERRIDES_GEMINI_TYPE_customer_trn_matches",
          confidence: 1,
        };
      }
    }
    // Gemini's classification is consistent or no TRN to contradict
    return {
      type: geminiType,
      reason: `GEMINI_CLASSIFIED: ${reason}`,
      confidence: 0.95,
    };
  }

  const vendorName = pickFirst(
    gJSON?.vendor_name,
    gJSON?.supplier_vendor,
    gJSON?.supplier_name,
    gJSON?.supplier,
    gJSON?.vendor,
    gJSON?.seller_name
  );
  const customerName = pickFirst(
    gJSON?.customer_name,
    gJSON?.party_name,
    gJSON?.party,
    gJSON?.customer,
    gJSON?.buyer_name,
    gJSON?.client_name
  );

  // Vendor TRN — do NOT use generic gJSON.trn as fallback (it's ambiguous)
  const vendorTRN = cleanTrn15(
    pickFirst(
      gJSON?.vendor_trn,
      gJSON?.supplier_trn,
      gJSON?.seller_trn
    )
  );
  // Customer TRN
  const customerTRN = cleanTrn15(
    pickFirst(
      gJSON?.customer_trn,
      gJSON?.party_trn,
      gJSON?.buyer_trn,
      gJSON?.client_trn
    )
  );
  // Generic/ambiguous TRN (standalone "TRN" on invoice, role unknown)
  const genericTRN = cleanTrn15(gJSON?.trn);
  const docCategory = String(gJSON?.document_category || "").toLowerCase();

  // ── Step 1: TRN-based matching (highest confidence, unambiguous) ──
  const supplierTrnMatch = !!(selfTRN && vendorTRN && selfTRN === vendorTRN);
  const customerTrnMatch = !!(selfTRN && customerTRN && selfTRN === customerTRN);

  // ── Step 2: Name-based matching ──
  const supplierNameMatch = nameMatchesCompany(vendorName);
  const customerNameMatch = nameMatchesCompany(customerName);
  const genericTrnMatch = !!(selfTRN && genericTRN && selfTRN === genericTRN);

  // ── DEBUG: Log all signals for troubleshooting ──
  console.log(`[detectType] selfTRN=${selfTRN}, vendorTRN=${vendorTRN}, customerTRN=${customerTRN}, genericTRN=${genericTRN}`);
  console.log(`[detectType] vendorName="${vendorName}", customerName="${customerName}"`);
  console.log(`[detectType] supplierTrnMatch=${supplierTrnMatch}, customerTrnMatch=${customerTrnMatch}`);
  console.log(`[detectType] supplierNameMatch=${supplierNameMatch}, customerNameMatch=${customerNameMatch}`);
  console.log(`[detectType] genericTrnMatch=${genericTrnMatch}, geminiType="${geminiType}", docCategory="${docCategory}"`);

  // ── Step 3: Detect Gemini role-swap ──
  // If company name matches CUSTOMER side but company TRN matches VENDOR side,
  // Gemini likely swapped roles. Trust TRN over name since TRN is an exact number.
  // Similarly for the reverse case.
  const supplierSideMatch = supplierTrnMatch || supplierNameMatch;
  const customerSideMatch = customerTrnMatch || customerNameMatch;

  // Case: TRN says one thing, name says the opposite — Gemini swapped roles.
  // TRN is definitive, so trust it over the name match.
  if (supplierTrnMatch && customerNameMatch && !customerTrnMatch && !supplierNameMatch) {
    // TRN on vendor side = company is the seller = Sales
    // Name on customer side is a false positive from role swap
    return {
      type: "sales",
      reason: "MATCH_SUPPLIER_TRN_OVERRIDES_CUSTOMER_NAME_SWAP",
      confidence: 1,
    };
  }

  // ── Weighted Voting ──
  // Each signal votes for "sales" (positive) or "purchase" (negative).
  // Weights reflect reliability: TRN >> name > doc category.
  // Doc category only fires for explicitly directional types (e.g. "bill",
  // "purchase order"), NOT for neutral types like "Tax Invoice" / "Invoice"
  // which can go either way.
  // ── Simple weighted voting — trust Gemini's extraction, just match ──
  const WEIGHT_TRN = 10;
  const WEIGHT_NAME = 4;
  const WEIGHT_DOC_CATEGORY = 2;
  const WEIGHT_GENERIC_TRN = 1;

  let salesScore = 0;
  let purchaseScore = 0;
  const votes = [];

  // Signal 1: Vendor TRN matches company TRN → Sales (company is the seller)
  if (supplierTrnMatch) {
    salesScore += WEIGHT_TRN;
    votes.push(`+${WEIGHT_TRN}S:VENDOR_TRN`);
  }

  // Signal 2: Customer TRN matches company TRN → Purchase (company is the buyer)
  if (customerTrnMatch) {
    purchaseScore += WEIGHT_TRN;
    votes.push(`+${WEIGHT_TRN}P:CUSTOMER_TRN`);
  }

  // Signal 3: Document category hints — ONLY for explicitly directional types.
  const isPurchaseDoc = /\bbill\b|\bpurchase\s+(order|summary)\b/.test(docCategory);
  const isSalesDoc = /\bsales\s+(order|summary)\b/.test(docCategory);
  if (isPurchaseDoc && !isSalesDoc) {
    purchaseScore += WEIGHT_DOC_CATEGORY;
    votes.push(`+${WEIGHT_DOC_CATEGORY}P:DOC_CATEGORY`);
  } else if (isSalesDoc && !isPurchaseDoc) {
    salesScore += WEIGHT_DOC_CATEGORY;
    votes.push(`+${WEIGHT_DOC_CATEGORY}S:DOC_CATEGORY`);
  }

  // Signal 4: Vendor name matches company name → Sales
  if (supplierNameMatch) {
    salesScore += WEIGHT_NAME;
    votes.push(`+${WEIGHT_NAME}S:VENDOR_NAME`);
  }

  // Signal 5: Customer name matches company name → Purchase
  if (customerNameMatch) {
    purchaseScore += WEIGHT_NAME;
    votes.push(`+${WEIGHT_NAME}P:CUSTOMER_NAME`);
  }

  // Signal 6: Generic TRN fallback (weakest, only if no specific TRN matched)
  if (genericTrnMatch && !supplierTrnMatch && !customerTrnMatch) {
    if (isPurchaseDoc) {
      purchaseScore += WEIGHT_GENERIC_TRN;
      votes.push(`+${WEIGHT_GENERIC_TRN}P:GENERIC_TRN_PURCHASE_DOC`);
    } else {
      salesScore += WEIGHT_GENERIC_TRN;
      votes.push(`+${WEIGHT_GENERIC_TRN}S:GENERIC_TRN_DEFAULT`);
    }
  }

  // ── Decision ──
  const totalScore = salesScore + purchaseScore;
  const diff = Math.abs(salesScore - purchaseScore);
  const reason = `VOTE[S=${salesScore},P=${purchaseScore}] ${votes.join(" ")}`;

  if (totalScore === 0) {
    return { type: "unknown", reason: `NO_SIGNALS ${reason}`, confidence: 0 };
  }

  if (diff < 3) {
    return { type: "unknown", reason: `TIE ${reason}`, confidence: 0.3 };
  }

  const winnerType = salesScore > purchaseScore ? "sales" : "purchase";
  const winnerScore = Math.max(salesScore, purchaseScore);
  const confidence = Math.min(1, 0.5 + (diff / (totalScore * 2)) + (winnerScore >= WEIGHT_TRN ? 0.3 : 0));

  console.log(`[detectType] RESULT: ${winnerType} — ${reason}`);
  return { type: winnerType, reason, confidence: Math.round(confidence * 100) / 100 };
}

// Simplified: no swap-correction layer. We trust Gemini's extraction
// (improved via prompt) and detectType's name/TRN matching.
function finalizeInvoiceClassification({
  row,
  classification,
  companyName,
  companyTrn,
}) {
  return classification;
}
// ****** Detect 'Sales' vs 'Purchase' — Weighted Voting System ****** //

// ****** Parsing ****** //
function coerceGeminiJson(payload) {
  // Already an array/object
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") return [payload];

  // If it's a string, strip fences/noise and parse
  if (typeof payload === "string") {
    let s = payload.trim();

    // Strip triple backticks fences if present
    if (s.startsWith("```")) {
      s = s
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/i, "")
        .trim();
    }

    // Grab first JSON collection/object segment if the model added prose
    const firstBrace = Math.min(
      ...["{", "["].map((ch) => s.indexOf(ch)).filter((i) => i >= 0)
    );
    const lastBrace = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      s = s.slice(firstBrace, lastBrace + 1);
    }

    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") return [parsed];
    } catch (e) {
      console.warn("Gemini JSON parse failed:", e?.message);
    }
    return [];
  }

  // Anything else â†’ no records
  return [];
}
// ****** Parsing ****** //

function hasAnyUsableInvoiceValue(gJSON) {
  if (!gJSON || typeof gJSON !== "object") return false;
  const hasAnyName = [
    gJSON?.vendor_name,
    gJSON?.supplier_vendor,
    gJSON?.supplier_name,
    gJSON?.customer_name,
    gJSON?.party_name,
  ].some((x) => typeof x === "string" && x.trim() !== "");

  const hasAnyAmount = [
    gJSON?.net_amount,
    gJSON?.before_tax_amount,
    gJSON?.vat,
    gJSON?.total,
    gJSON?.grand_total,
    gJSON?.amount,
    gJSON?.amount_due,
    gJSON?.balance_due,
    gJSON?.invoice_total,
  ].some((x) =>
    Number.isFinite(Number(String(x).replace(/[, ]/g, "")))
  );

  const hasInvoiceNo = String(gJSON?.invoice_number || "").trim() !== "";
  const hasDate = String(gJSON?.date || "").trim() !== "";

  return hasInvoiceNo || hasAnyName || hasAnyAmount || hasDate;
}

function coerceInvoiceRecords(payload) {
  const base = coerceGeminiJson(payload);
  const out = [];
  let claimedCount = 0;

  const pushIfObject = (x) => {
    if (x && typeof x === "object" && !Array.isArray(x)) out.push(x);
  };

  for (const rec of base) {
    if (!rec || typeof rec !== "object") continue;
    if (Array.isArray(rec)) {
      rec.forEach(pushIfObject);
      continue;
    }

    // Track the claimed total_documents_found for validation
    if (
      typeof rec.total_documents_found === "number" &&
      rec.total_documents_found > claimedCount
    ) {
      claimedCount = rec.total_documents_found;
    }

    // Unwrap common wrapper shapes returned by LLMs.
    if (Array.isArray(rec.documents)) {
      rec.documents.forEach(pushIfObject);
      continue;
    }
    if (Array.isArray(rec.records)) {
      rec.records.forEach(pushIfObject);
      continue;
    }
    if (Array.isArray(rec.invoices)) {
      rec.invoices.forEach(pushIfObject);
      continue;
    }
    if (Array.isArray(rec.items)) {
      rec.items.forEach(pushIfObject);
      continue;
    }
    if (Array.isArray(rec.data)) {
      rec.data.forEach(pushIfObject);
      continue;
    }

    out.push(rec);
  }

  const result = out.filter(hasAnyUsableInvoiceValue);
  // Attach metadata so callers can detect mismatch
  result._claimedCount = claimedCount;
  return result;
}

async function processJob(jobId) {
  const job = JOBS.get(jobId);
  if (!job) return;

  job.state = "running";
  job.message = "Preparing filesâ€¦";

  const inputs = [];
  let totalFileSize = 0; // Track total file size for document count update
  for (const f of job.files) {
    const isPdf =
      f?.mimetype === "application/pdf" ||
      (f?.originalname || "").toLowerCase().endsWith(".pdf");

    totalFileSize += f.size || 0; // Add file size to total

    inputs.push({
      originalname: f.originalname,
      mimetype: f.mimetype,
      path: f.path, // <--- disk path from multer
      size: f.size,
      isPdf,
      _fileIndex: inputs.length,
    });
  }

  job.files = inputs;
  job.total_files = inputs.length;
  const fileRowBuckets = inputs.map(() => ({ sales: [], purchase: [], other: [], all: [] }));
  job.processed_files = 0;
  job.progress_pct = 0;
  job.message = "Processingâ€¦";
  job.totalFileSize = totalFileSize; // Store total file size for later use

  function buildSourceLabel(originalName, pagesCovered) {
    const raw = String(pagesCovered ?? "").trim();
    if (!raw) return originalName;
    const cleaned = raw
      .replace(/\bpages?\b/gi, "")
      .replace(/[^\d,\-\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s*,\s*/g, ",")
      .replace(/\s*-\s*/g, "-");
    if (!cleaned) return originalName;
    const label = /^\d+$/.test(cleaned) ? `page ${cleaned}` : `pages ${cleaned}`;
    return `${originalName} [${label}]`;
  }

  function firstPageNumber(pagesCovered) {
    const raw = String(pagesCovered ?? "").trim();
    if (!raw) return null;
    const match = raw.match(/\d+/);
    if (!match) return null;
    const n = Number(match[0]);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
  }

  function isNonEmptyString(x) {
    return typeof x === "string" && x.trim() !== "";
  }
  function hasNumber(x) {
    return (
      x !== null &&
      x !== undefined &&
      Number.isFinite(Number(String(x).replace(/[, ]/g, "")))
    );
  }

  // Build company context once — prepended to every Gemini user prompt
  // so Gemini can classify transaction_type (sales/purchase) accurately.
  const companyCtx = buildCompanyContext(job.company_name, job.company_trn);

  const workOne = async (f) => {
    const tmpPaths = new Set();
    let convertId = null;

    // Derive department + module
    const userId = job.userId || null;
    let departmentId = null;
    let moduleId = null;

    // Precompute a safe base filename for JSON (mirror original)
    const baseSafe = safeName(f.originalname).replace(/\.[^.]+$/i, "");

    try {
      if ((!f?.path && !f?.buffer) || !f?.mimetype) return;

      if (f?.path) tmpPaths.add(f.path);

      // (A) pick uploadPath (maybe compressed) â€” your code as-is
      let uploadPath = f.path;

      if (f.isPdf) {
        try {
          const compressedPath = await compressPdfWithGs(f.path, {
            pdfSettings: "/ebook",
            compatibilityLevel: "1.6",
            dpi: 110,
          });
          if (compressedPath && compressedPath !== f.path) {
            uploadPath = compressedPath;
            tmpPaths.add(compressedPath);
          }
        } catch (err) {
          console.warn(
            "PDF compression failed, using original file:",
            err?.message || err
          );
        }
      }

      // (B) copy original/processed file to local storage (uploads bucket)
      const destUploadsRel = buildInvoiceLocalPath({
        type: "uploads",
        originalName: f.originalname,
      });
      const savedOriginal = await copyToLocal({
        srcAbsPath: uploadPath,
        destRelPath: destUploadsRel,
      });

      f.localRelPath = savedOriginal.rel;
      f.localPublicPath = `/uploads/${savedOriginal.rel.replace(/\\/g, "/")}`;

      // (C) Best-effort DB row: queued -> extracting
      try {
        departmentId = await getUserDepartmentId(userId);
        if (!departmentId) {
          departmentId = await getOrCreateDefaultDepartmentId();
        }
        moduleId = await ensureModuleId("invoices");

        convertId = await createInvoiceConvert({
          userId,
          departmentId,
          moduleId,
          fileName: f.originalname,
          fileSize: f.size || 0,
          fileInputPath: savedOriginal.rel, // RELATIVE path
        });
        await setInvoiceConvertStatus(convertId, "extracting");
      } catch (metaErr) {
        convertId = null;
        console.warn(
          `Invoice metadata write skipped for ${f.originalname}:`,
          metaErr?.message || metaErr
        );
      }

      // (D) Upload to Gemini & extract
      job.message = `Uploading ${f.originalname}â€¦`;

      // === Extraction branch ===
      let records = [];
      let sourceFileBuf = null;
      try {
        sourceFileBuf = await fs.readFile(f.path);
      } catch {}

      // Cache disabled: always run fresh extraction for every upload.
      const cachedRecords = null;

      if (cachedRecords) {
          records = Array.isArray(cachedRecords) ? cachedRecords : [];
          job.message = `Using cached extraction for ${f.originalname}...`;

          if (f.isPdf) {
            records = mergeInvoiceRecords(records);
            for (const gJSON of records) {
              const source = buildSourceLabel(
                f.originalname,
                gJSON?.pages_covered
              );
              const classification = detectType(
                gJSON,
                job.company_name,
                job.company_trn
              );
              const selfForRecord =
                classification.type === "sales"
                  ? { name: job.company_name, trn: job.company_trn }
                  : { name: null, trn: null };

              const headerText = gJSON?.document_title_hint || null;
              const modelCat = gJSON?.document_category || null;
              const evidence = gJSON?.document_category_evidence || null;
              const fullText = [
                gJSON?.document_title_hint,
                gJSON?.document_category_evidence?.matched_text,
                gJSON?.invoice_key_hint,
                gJSON?.remarks,
              ]
                .filter(Boolean)
                .join("\n");
              let resolvedCategory = resolveInvoiceCategory({
                modelCategory: modelCat,
                modelEvidence: evidence,
                headerText,
                fullText,
              });
              resolvedCategory = resolveWithOverrides(resolvedCategory, fullText);

              const { row } = normalizeRecord(
                gJSON,
                source,
                job.country,
                classification.type,
                selfForRecord,
                resolvedCategory
              );

              if (f.localPublicPath) {
                row.SOURCE_URL = f.localPublicPath;
                row.SOURCE_TYPE = f.isPdf ? "pdf" : "image";
              }

              row.PAGE_NUMBER = firstPageNumber(gJSON?.pages_covered);
              row.PAGES_COVERED = gJSON?.pages_covered || null;

              const overallPct =
                gJSON?.overall_confidence != null
                  ? Math.round(gJSON.overall_confidence * 100)
                  : gJSON?.document_category_evidence?.confidence != null
                  ? Math.round(gJSON.document_category_evidence.confidence * 100)
                  : null;

              row["CONFIDENCE"] = overallPct;
              const finalClassification = finalizeInvoiceClassification({
                row,
                classification,
                companyName: job.company_name,
                companyTrn: job.company_trn,
              });
              row["CLASSIFICATION_REASON"] = finalClassification.reason;
              row["CLASSIFICATION_CONFIDENCE"] = finalClassification.confidence;

              if (classification.type === "sales") {
                job.uaeSalesRows.push(row);
                job.uaeAllRows.push({ TYPE: "Sales", ...row });
              } else if (classification.type === "purchase") {
                job.uaePurchaseRows.push(row);
                job.uaeAllRows.push({ TYPE: "Purchase", ...row });
              } else {
                job.uaeOtherRows.push(row);
                job.uaeAllRows.push({ TYPE: "Other", ...row });
              }
            }
          } else {
            for (const gJSON of records) {
              if (!hasAnyUsableInvoiceValue(gJSON)) continue;

              const classification = detectType(
                gJSON,
                job.company_name,
                job.company_trn
              );
              const selfForRecord =
                classification.type === "sales"
                  ? { name: job.company_name, trn: job.company_trn }
                  : { name: null, trn: null };

              const { row } = normalizeRecord(
                gJSON,
                f.originalname,
                job.country,
                classification.type,
                selfForRecord
              );

              if (f.localPublicPath) {
                row.SOURCE_URL = f.localPublicPath;
                row.SOURCE_TYPE = f.isPdf ? "pdf" : "image";
              }

              row.PAGE_NUMBER = firstPageNumber(gJSON?.pages_covered);
              row.PAGES_COVERED = gJSON?.pages_covered || null;

              const overallPct =
                gJSON?.overall_confidence != null
                  ? Math.round(gJSON.overall_confidence * 100)
                  : gJSON?.document_category_evidence?.confidence != null
                  ? Math.round(gJSON.document_category_evidence.confidence * 100)
                  : null;

              row["CONFIDENCE"] = overallPct;
              const finalClassification = finalizeInvoiceClassification({
                row,
                classification,
                companyName: job.company_name,
                companyTrn: job.company_trn,
              });
              row["CLASSIFICATION_REASON"] = finalClassification.reason;
              row["CLASSIFICATION_CONFIDENCE"] = finalClassification.confidence;

              if (classification.type === "sales") {
                job.uaeSalesRows.push(row);
                job.uaeAllRows.push({ TYPE: "Sales", ...row });
              } else if (classification.type === "purchase") {
                job.uaePurchaseRows.push(row);
                job.uaeAllRows.push({ TYPE: "Purchase", ...row });
              } else {
                job.uaeOtherRows.push(row);
                job.uaeAllRows.push({ TYPE: "Other", ...row });
              }
            }
          }
      } else if (f.isPdf) {
          // Read from original PDF path for better OCR fidelity on dense pages.
          const pdfBuf = sourceFileBuf || (await fs.readFile(f.path));
          const pageCount = await countPdfPages(pdfBuf);

          // Always use page-by-page extraction for PDFs.
          // Keep this branch only for invalid/empty page counts.
          if (pageCount < 1) {
            const gemFile = await uploadPathToGemini({
              path: uploadPath,
              filename: f.originalname,
              mimeType: f.mimetype,
            });

            job.message = `Extracting ${f.originalname}â€¦`;
            const raw = await withRetry(
              () =>
                extractJsonFromFile({
                  file: gemFile,
                  systemPrompt: SYSTEM_PROMPT,
                  userPrompt: companyCtx + WHOLE_PDF_USER_PROMPT,
                }),
              { retries: 6, baseMs: 1500 }
            );
            if (raw?.__usage) {
              job.totalInputTokens += raw.__usage.inputTokens || 0;
              job.totalOutputTokens += raw.__usage.outputTokens || 0;
            }
            records = coerceInvoiceRecords(raw);

            if (!records.length) {
              const rawFallback = await withRetry(
                () =>
                  extractJsonFromFile({
                    file: gemFile,
                    systemPrompt: SYSTEM_PROMPT,
                    userPrompt: companyCtx + USER_PROMPT,
                  }),
                { retries: 6, baseMs: 1500 }
              );
              if (rawFallback?.__usage) {
                job.totalInputTokens += rawFallback.__usage.inputTokens || 0;
                job.totalOutputTokens += rawFallback.__usage.outputTokens || 0;
              }
              records = coerceInvoiceRecords(rawFallback);
            }
          } else {
            const extractOnePage = async ({
              pageIndex,
              pageBuffer,
              fileName,
              mimeType,
            }) => {
              job.message = `Extracting ${f.originalname} - page ${pageIndex}/${pageCount}...`;
              const isImage = String(mimeType || "").toLowerCase().startsWith("image/");
              let raw = null;
              if (isImage) {
                raw = await extractJsonFromInlineBuffer({
                  buffer: pageBuffer,
                  mimeType,
                  systemPrompt: SYSTEM_PROMPT,
                  userPrompt: companyCtx + PAGE_PDF_USER_PROMPT,
                });
              } else {
                const gFile = await uploadBufferToGemini({
                  buffer: pageBuffer,
                  filename: fileName,
                  mimeType,
                });
                raw = await withRetry(
                  () =>
                    extractJsonFromFile({
                      file: gFile,
                      systemPrompt: SYSTEM_PROMPT,
                      userPrompt: companyCtx + PAGE_PDF_USER_PROMPT,
                    }),
                  { retries: 6, baseMs: 1500 }
                );
              }
              if (raw?.__usage) {
                job.totalInputTokens += raw.__usage.inputTokens || 0;
                job.totalOutputTokens += raw.__usage.outputTokens || 0;
              }
              let pageRecords = coerceInvoiceRecords(raw);

              // Retry if Gemini claimed more documents than it actually returned
              const claimed = pageRecords._claimedCount || 0;
              if (
                claimed > pageRecords.length &&
                pageRecords.length > 0
              ) {
                console.log(
                  `[multi-doc retry] Page ${pageIndex}: Gemini claimed ${claimed} docs but returned ${pageRecords.length}. Retrying...`
                );
                const retryPrompt = buildMultiDocRetryPrompt(
                  claimed,
                  pageRecords.length
                );
                let rawRetry = null;
                if (isImage) {
                  rawRetry = await extractJsonFromInlineBuffer({
                    buffer: pageBuffer,
                    mimeType,
                    systemPrompt: SYSTEM_PROMPT,
                    userPrompt: retryPrompt,
                  });
                } else {
                  const gFileRetry = await uploadBufferToGemini({
                    buffer: pageBuffer,
                    filename: fileName,
                    mimeType,
                  });
                  rawRetry = await withRetry(
                    () =>
                      extractJsonFromFile({
                        file: gFileRetry,
                        systemPrompt: SYSTEM_PROMPT,
                        userPrompt: retryPrompt,
                      }),
                    { retries: 3, baseMs: 1500 }
                  );
                }
                if (rawRetry?.__usage) {
                  job.totalInputTokens += rawRetry.__usage.inputTokens || 0;
                  job.totalOutputTokens += rawRetry.__usage.outputTokens || 0;
                }
                const retryRecords = coerceInvoiceRecords(rawRetry);
                if (retryRecords.length > pageRecords.length) {
                  console.log(
                    `[multi-doc retry] Page ${pageIndex}: Retry returned ${retryRecords.length} docs (improved from ${pageRecords.length}).`
                  );
                  pageRecords = retryRecords;
                }
              }

              // Fallback to normal single-image prompt if page-array prompt yielded nothing.
              if (!pageRecords.length) {
                let rawFallback = null;
                if (isImage) {
                  rawFallback = await extractJsonFromInlineBuffer({
                    buffer: pageBuffer,
                    mimeType,
                    systemPrompt: SYSTEM_PROMPT,
                    userPrompt: companyCtx + USER_PROMPT,
                  });
                } else {
                  const gFileFallback = await uploadBufferToGemini({
                    buffer: pageBuffer,
                    filename: fileName,
                    mimeType,
                  });
                  rawFallback = await withRetry(
                    () =>
                      extractJsonFromFile({
                        file: gFileFallback,
                        systemPrompt: SYSTEM_PROMPT,
                        userPrompt: companyCtx + USER_PROMPT,
                      }),
                    { retries: 6, baseMs: 1500 }
                  );
                }
                if (rawFallback?.__usage) {
                  job.totalInputTokens += rawFallback.__usage.inputTokens || 0;
                  job.totalOutputTokens += rawFallback.__usage.outputTokens || 0;
                }
                pageRecords = coerceInvoiceRecords(rawFallback);
              }

              pageRecords.forEach((r) => {
                if (!r || typeof r !== "object") return;
                r.pages_covered = String(pageIndex);
              });
              return pageRecords;
            };

            const extractOnePageWithTimeout = async (args) => {
              const timeoutMs = Number(
                process.env.INVOICE_PAGE_TIMEOUT_MS || 180000
              );
              let timer = null;
              try {
                return await Promise.race([
                  extractOnePage(args),
                  new Promise((_, reject) => {
                    timer = setTimeout(
                      () => reject(new Error("Page extraction timeout")),
                      timeoutMs
                    );
                  }),
                ]);
              } finally {
                if (timer) clearTimeout(timer);
              }
            };

            // Convert each PDF page to image before Gemini call.
            // If image rendering is unavailable, fall back to per-page PDF upload.
            let firstPageImage = null;
            let useImagePages = true;
            try {
              firstPageImage = await renderPdfPageToImageBuffer(pdfBuf, 0);
            } catch (imgErr) {
              useImagePages = false;
              console.warn(
                `PDF page-to-image conversion unavailable (${f.originalname}); falling back to PDF pages:`,
                imgErr?.message || imgErr
              );
            }

            if (useImagePages) {
              let fallbackPdfPages = null;
              let pageFailures = 0;
              const pageIndices = Array.from({ length: pageCount }, (_, i) => i + 1);
              const pageResultsByIndex = new Array(pageCount).fill(null).map(() => []);
              await runPool(pageIndices, PAGE_CONCURRENCY, async (pageIndex) => {
                const i = pageIndex - 1;
                let pageBuffer = null;
                let fileName = makePageImageName(f.originalname, pageIndex);
                let mimeType = "image/jpeg";

                try {
                  pageBuffer =
                    i === 0
                      ? firstPageImage
                      : await renderPdfPageToImageBuffer(pdfBuf, i);
                } catch (pageImgErr) {
                  console.warn(
                    `Image render failed for ${f.originalname} page ${pageIndex}; using PDF fallback for this page:`,
                    pageImgErr?.message || pageImgErr
                  );
                  if (!fallbackPdfPages) {
                    try {
                      fallbackPdfPages = await splitPdfToPageBuffers(pdfBuf);
                    } catch (fallbackSplitErr) {
                      pageFailures += 1;
                      console.warn(
                        `Fallback PDF split failed for ${f.originalname} page ${pageIndex}; skipping page:`,
                        fallbackSplitErr?.message || fallbackSplitErr
                      );
                      return;
                    }
                  }
                  const fallbackPage = fallbackPdfPages[i];
                  if (!fallbackPage?.buffer) {
                    pageFailures += 1;
                    console.warn(
                      `Missing fallback page buffer for ${f.originalname} page ${pageIndex}; skipping page.`
                    );
                    return;
                  }
                  pageBuffer = fallbackPage.buffer;
                  fileName = `${path.basename(
                    f.originalname,
                    path.extname(f.originalname)
                  )}-p${pageIndex}.pdf`;
                  mimeType = "application/pdf";
                }

                try {
                  const pageRecords = await withRetry(
                    () =>
                      extractOnePageWithTimeout({
                        pageIndex,
                        pageBuffer,
                        fileName,
                        mimeType,
                      }),
                    { retries: 1, baseMs: 1000 }
                  );
                  if (Array.isArray(pageRecords) && pageRecords.length) {
                    pageResultsByIndex[pageIndex - 1] = pageRecords;
                  }
                } catch (pageExtractErr) {
                  pageFailures += 1;
                  console.warn(
                    `Extraction failed for ${f.originalname} page ${pageIndex}; skipping page:`,
                    pageExtractErr?.message || pageExtractErr
                  );
                }
              });
              // Flatten page results in page order
              for (const pRecs of pageResultsByIndex) {
                if (pRecs.length) records.push(...pRecs);
              }
              if (pageFailures > 0) {
                console.warn(
                  `${f.originalname}: skipped ${pageFailures}/${pageCount} page(s) due to extraction errors.`
                );
              }
            } else {
              const pages = await splitPdfToPageBuffers(pdfBuf);
              let pageFailures = 0;
              const pdfPageResultsByIndex = new Array(pages.length).fill(null).map(() => []);
              await runPool(pages, PAGE_CONCURRENCY, async (p) => {
                try {
                  const pageRecords = await withRetry(
                    () =>
                      extractOnePageWithTimeout({
                        pageIndex: p.index,
                        pageBuffer: p.buffer,
                        fileName: `${path.basename(
                          f.originalname,
                          path.extname(f.originalname)
                        )}-p${p.index}.pdf`,
                        mimeType: "application/pdf",
                      }),
                    { retries: 1, baseMs: 1000 }
                  );
                  if (Array.isArray(pageRecords) && pageRecords.length) {
                    pdfPageResultsByIndex[p.index - 1] = pageRecords;
                  }
                } catch (pageExtractErr) {
                  pageFailures += 1;
                  console.warn(
                    `Extraction failed for ${f.originalname} page ${p.index}; skipping page:`,
                    pageExtractErr?.message || pageExtractErr
                  );
                }
              });
              // Flatten PDF page results in page order
              for (const pRecs of pdfPageResultsByIndex) {
                if (pRecs.length) records.push(...pRecs);
              }
              if (pageFailures > 0) {
                console.warn(
                  `${f.originalname}: skipped ${pageFailures}/${pageCount} page(s) due to extraction errors.`
                );
              }
            }
          }

          records = mergeInvoiceRecords(records);
          for (const gJSON of records) {
            const source = buildSourceLabel(
              f.originalname,
              gJSON?.pages_covered
            );
          const classification = detectType(
            gJSON,
            job.company_name,
            job.company_trn
          );
          const selfForRecord =
            classification.type === "sales"
              ? { name: job.company_name, trn: job.company_trn }
              : { name: null, trn: null };

          // Category resolution (unchanged)
          const headerText = gJSON?.document_title_hint || null;
          const modelCat = gJSON?.document_category || null;
          const evidence = gJSON?.document_category_evidence || null;
          const fullText = [
            gJSON?.document_title_hint,
            gJSON?.document_category_evidence?.matched_text,
            gJSON?.invoice_key_hint,
            gJSON?.remarks,
          ]
            .filter(Boolean)
            .join("\n");
          let resolvedCategory = resolveInvoiceCategory({
            modelCategory: modelCat,
            modelEvidence: evidence,
            headerText,
            fullText,
          });
          resolvedCategory = resolveWithOverrides(resolvedCategory, fullText);

          const { row } = normalizeRecord(
            gJSON,
            source,
            job.country,
            classification.type,
            selfForRecord,
            resolvedCategory
          );

          if (f.localPublicPath) {
            row.SOURCE_URL = f.localPublicPath; // e.g. /uploads/invoice/uploads/...
            row.SOURCE_TYPE = f.isPdf ? "pdf" : "image"; // here: "pdf"
          }

          row.PAGE_NUMBER = firstPageNumber(gJSON?.pages_covered);
          row.PAGES_COVERED = gJSON?.pages_covered || null;

          const overallPct =
            gJSON?.overall_confidence != null
              ? Math.round(gJSON.overall_confidence * 100)
              : gJSON?.document_category_evidence?.confidence != null
              ? Math.round(gJSON.document_category_evidence.confidence * 100)
              : null;

          row["CONFIDENCE"] = overallPct;
          const finalClassification = finalizeInvoiceClassification({
            row,
            classification,
            companyName: job.company_name,
            companyTrn: job.company_trn,
          });
          row["CLASSIFICATION_REASON"] = finalClassification.reason;
          row["CLASSIFICATION_CONFIDENCE"] = finalClassification.confidence;

          const _bucket = fileRowBuckets[f._fileIndex];
          if (classification.type === "sales") {
            _bucket.sales.push(row);
            _bucket.all.push({ TYPE: "Sales", ...row });
          } else if (classification.type === "purchase") {
            _bucket.purchase.push(row);
            _bucket.all.push({ TYPE: "Purchase", ...row });
          } else {
            _bucket.other.push(row);
            _bucket.all.push({ TYPE: "Other", ...row });
          }
        }
        } else {
          // ── Image path: use Gemini File API (same as the PDF fallback that works) ──
          job.message = `Extracting ${f.originalname}…`;

          // Upload image to Gemini File API — same method PDFs use when
          // sharp can't render pages (which is the case on this system).
          const gemFile = await uploadPathToGemini({
            path: uploadPath,
            filename: f.originalname,
            mimeType: f.mimetype,
          });

          // Use PAGE_PDF_USER_PROMPT which has the strongest multi-doc detection
          const raw = await withRetry(
            () =>
              extractJsonFromFile({
                file: gemFile,
                systemPrompt: SYSTEM_PROMPT,
                userPrompt: companyCtx + PAGE_PDF_USER_PROMPT,
              }),
            { retries: 6, baseMs: 1500 }
          );
          if (raw?.__usage) {
            job.totalInputTokens += raw.__usage.inputTokens || 0;
            job.totalOutputTokens += raw.__usage.outputTokens || 0;
          }
          records = coerceInvoiceRecords(raw);

          // Retry if Gemini claimed more documents than it actually returned
          const claimedImg = records._claimedCount || 0;
          if (claimedImg > records.length && records.length > 0) {
            console.log(
              `[image multi-doc retry] ${f.originalname}: Gemini claimed ${claimedImg} docs but returned ${records.length}. Retrying...`
            );
            const retryPrompt = buildMultiDocRetryPrompt(
              claimedImg,
              records.length
            );
            const gemFileRetry = await uploadPathToGemini({
              path: uploadPath,
              filename: f.originalname,
              mimeType: f.mimetype,
            });
            const rawRetry = await withRetry(
              () =>
                extractJsonFromFile({
                  file: gemFileRetry,
                  systemPrompt: SYSTEM_PROMPT,
                  userPrompt: retryPrompt,
                }),
              { retries: 3, baseMs: 1500 }
            );
            if (rawRetry?.__usage) {
              job.totalInputTokens += rawRetry.__usage.inputTokens || 0;
              job.totalOutputTokens += rawRetry.__usage.outputTokens || 0;
            }
            const retryRecords = coerceInvoiceRecords(rawRetry);
            if (retryRecords.length > records.length) {
              records = retryRecords;
            }
          }

          // Fallback if PAGE_PDF_USER_PROMPT found nothing
          if (!records.length) {
            const rawFallback = await withRetry(
              () =>
                extractJsonFromFile({
                  file: gemFile,
                  systemPrompt: SYSTEM_PROMPT,
                  userPrompt: companyCtx + USER_PROMPT,
                }),
              { retries: 6, baseMs: 1500 }
            );
            if (rawFallback?.__usage) {
              job.totalInputTokens += rawFallback.__usage.inputTokens || 0;
              job.totalOutputTokens += rawFallback.__usage.outputTokens || 0;
            }
            records = coerceInvoiceRecords(rawFallback);
          }

          console.log(
            `[image] ${f.originalname}: extracted ${records.length} document(s).`
          );

        for (const gJSON of records) {
          if (!hasAnyUsableInvoiceValue(gJSON)) continue;

          const classification = detectType(
            gJSON,
            job.company_name,
            job.company_trn
          );
          const selfForRecord =
            classification.type === "sales"
              ? { name: job.company_name, trn: job.company_trn }
              : { name: null, trn: null };

          const { row } = normalizeRecord(
            gJSON,
            f.originalname,
            job.country,
            classification.type,
            selfForRecord
          );

          if (f.localPublicPath) {
            row.SOURCE_URL = f.localPublicPath; // /uploads/...
            row.SOURCE_TYPE = f.isPdf ? "pdf" : "image"; // here: "image"
          }

          row.PAGE_NUMBER = firstPageNumber(gJSON?.pages_covered);
          row.PAGES_COVERED = gJSON?.pages_covered || null;

          const overallPct =
            gJSON?.overall_confidence != null
              ? Math.round(gJSON.overall_confidence * 100)
              : gJSON?.document_category_evidence?.confidence != null
              ? Math.round(gJSON.document_category_evidence.confidence * 100)
              : null;

          row["CONFIDENCE"] = overallPct;
          const finalClassification = finalizeInvoiceClassification({
            row,
            classification,
            companyName: job.company_name,
            companyTrn: job.company_trn,
          });
          row["CLASSIFICATION_REASON"] = finalClassification.reason;
          row["CLASSIFICATION_CONFIDENCE"] = finalClassification.confidence;

          const _bucket = fileRowBuckets[f._fileIndex];
          if (classification.type === "sales") {
            _bucket.sales.push(row);
            _bucket.all.push({ TYPE: "Sales", ...row });
          } else if (classification.type === "purchase") {
            _bucket.purchase.push(row);
            _bucket.all.push({ TYPE: "Purchase", ...row });
          } else {
            _bucket.other.push(row);
            _bucket.all.push({ TYPE: "Other", ...row });
          }
        }
      }

      // (E) Write the raw JSON we got for THIS file (array) into /invoice/json/DD/MM/YYYY
      const jsonRel = withExt(
        buildInvoiceLocalPath({
          type: "json",
          originalName: `${baseSafe}.json`,
        }),
        ".json"
      );
      await writeJsonLocal({
        json: { source: f.originalname, records },
        destRelPath: jsonRel,
      });

      // (F) DB update: set output JSON path + final status
      if (convertId) {
        await setInvoiceConvertOutputJsonPath(convertId, jsonRel, "extracted");
      }
    } catch (e) {
      console.error(`File failed (${f.originalname}):`, e?.message || e);
      if (convertId) {
        await setInvoiceConvertStatus(
          convertId,
          "failed",
          e?.message || "failed"
        );
      }
    } finally {
      // tmp cleanup
      for (const p of tmpPaths) {
        try {
          await fs.unlink(p);
        } catch {}
      }
      job.processed_files += 1;
      job.progress_pct = Math.round(
        (job.processed_files / job.total_files) * 100
      );
    }
  };

  await runPool(job.files, CONCURRENCY, workOne);

  // Flatten per-file buckets into job arrays in upload order
  for (const bucket of fileRowBuckets) {
    job.uaeSalesRows.push(...bucket.sales);
    job.uaePurchaseRows.push(...bucket.purchase);
    job.uaeOtherRows.push(...bucket.other);
    job.uaeAllRows.push(...bucket.all);
  }

  // If everything landed in "Other", promote to Purchase so preview/export
  // does not appear empty in Sales/Purchase-only views.
  // BUT: if rows are in Others because the company identity was not found
  // on the document (NO_IDENTITY_MATCH or SELF_IDENTITY_MISSING), keep them
  // in Others — they are genuinely unrelated to the uploading company.
  if (
    (job.uaeSalesRows || []).length === 0 &&
    (job.uaePurchaseRows || []).length === 0 &&
    (job.uaeOtherRows || []).length > 0
  ) {
    const allUnrelated = (job.uaeOtherRows || []).every((r) => {
      const reason = String(r?.CLASSIFICATION_REASON || "");
      return (
        reason === "SELF_IDENTITY_MISSING" ||
        reason.startsWith("NO_IDENTITY_MATCH") ||
        reason.startsWith("NO_SIGNALS")
      );
    });
    if (allUnrelated) {
      // Keep in Others — these documents don't belong to the uploading company.
      job.uaeAllRows = [...(job.uaeOtherRows || [])].map((r) => ({
        TYPE: "Other",
        ...r,
      }));
    } else {
      const promoted = (job.uaeOtherRows || []).map((r) => ({
        ...r,
        CLASSIFICATION_REASON:
          r?.CLASSIFICATION_REASON || "FALLBACK_PROMOTED_FROM_OTHER",
        CLASSIFICATION_CONFIDENCE:
          r?.CLASSIFICATION_CONFIDENCE != null
            ? r.CLASSIFICATION_CONFIDENCE
            : 0.3,
      }));
      job.uaePurchaseRows = promoted;
      job.uaeOtherRows = [];
      job.uaeAllRows = [
        ...(job.uaeSalesRows || []).map((r) => ({ TYPE: "Sales", ...r })),
        ...(job.uaePurchaseRows || []).map((r) => ({ TYPE: "Purchase", ...r })),
      ];
    }
  }

  // --- FX: enrich every row with AED-converted columns ---
  const fxCache = {}; // per-job cache
  let usdQuote = null;

  try {
    // Only fetch rates if we actually need to convert something not already AED.
    const needsFx =
      (job.uaePurchaseRows || []).some(
        (r) => (r?.CURRENCY || "").toUpperCase() !== "AED" && r?.CURRENCY
      ) ||
      (job.uaeSalesRows || []).some(
        (r) => (r?.CURRENCY || "").toUpperCase() !== "AED" && r?.CURRENCY
      );

    if (needsFx) {
      const API_KEY =
        process.env.EXCHANGE_RATE_API_KEY || "83c63cdc03a8b532bb2476c8";
      usdQuote = await fetchUsdRatesOnce(API_KEY, fxCache);
    }

    const addAedCols = (rows) => {
      for (const r of rows) {
        const cur = (r?.CURRENCY || "").toUpperCase();

        const bt = Number(r?.["BEFORE TAX AMOUNT"] ?? null);
        const vt = Number(r?.["VAT"] ?? null);
        const nt = Number(r?.["NET AMOUNT"] ?? null);

        let btAED = null,
          vtAED = null,
          ntAED = null;

        if (!cur || cur === "AED") {
          // Already AED or unknown currency (unknown -> leave null to avoid lying)
          btAED = Number.isFinite(bt) ? bt : null;
          vtAED = Number.isFinite(vt) ? vt : null;
          ntAED = Number.isFinite(nt) ? nt : null;
        } else if (usdQuote) {
          btAED = Number.isFinite(bt) ? toAED(bt, cur, usdQuote) : null;
          vtAED = Number.isFinite(vt) ? toAED(vt, cur, usdQuote) : null;
          ntAED = Number.isFinite(nt) ? toAED(nt, cur, usdQuote) : null;
        }

        // Zero Rated
        const btAED2 = round2fx(btAED);
        const vtAED2 = round2fx(vtAED);
        const ntAED2 = round2fx(ntAED);

        // Round to 2 dp for presentation
        r["BEFORE TAX (AED)"] = round2fx(btAED);
        r["VAT (AED)"] = round2fx(vtAED);
        r["NET AMOUNT (AED)"] = round2fx(ntAED);

        // NEW: ZERO RATED (AED) = BT(AED) + VAT(AED) - NET(AED)
        // Only compute when we have all three numbers
        if (
          typeof btAED2 === "number" &&
          typeof vtAED2 === "number" &&
          typeof ntAED2 === "number"
        ) {
          let zr = btAED2 + vtAED2 - ntAED2;

          // Tolerate tiny rounding noise (e.g., Â±0.01 â†’ 0)
          if (Math.abs(zr) < 0.005) zr = 0;

          zr = Math.abs(zr);

          r["ZERO RATED (AED)"] = round2fx(zr);
        } else {
          r["ZERO RATED (AED)"] = null;
        }
      }
    };

    addAedCols(job.uaePurchaseRows || []);
    addAedCols(job.uaeSalesRows || []);
    addAedCols(job.uaeOtherRows || []);
    addAedCols(job.uaeOtherRows || []);
    addAedCols(job.uaeAllRows || []);
  } catch (e) {
    console.warn("FX conversion skipped due to error:", e?.message || e);
  }

  // Build Excel workbook (mirror your working app)
  const wb = XLSX.utils.book_new();

  // UAE - Unified (TYPE column first)
  XLSX.utils.book_append_sheet(
    wb,
    sheetFromObjects(job.uaeAllRows, [
      "TYPE", // Sales / Purchase
      "DATE",
      "INVOICE NUMBER",
      // for unified, prefer generic headers that exist in both shapes:
      // If row has SUPPLIER/VENDOR it'll still fill under this key if present
      "INVOICE CATEGORY",
      "SUPPLIER/VENDOR", // for purchase rows (sales rows will likely leave null)
      "PARTY", // for sales rows (purchase rows will likely leave null)
      "SUPPLIER TRN",
      "CUSTOMER TRN",
      "PLACE OF SUPPLY (SELLER)",
      "PLACE OF SUPPLY (CUSTOMER)",
      "CURRENCY",
      "BEFORE TAX AMOUNT",
      "VAT",
      "NET AMOUNT",
      "BEFORE TAX (AED)",
      "VAT (AED)",
      "ZERO RATED (AED)",
      "NET AMOUNT (AED)",
      "CONFIDENCE",
      "SOURCE",
    ]),
    "UAE - Invoices"
  );

  const UAE_SALES_ORDER = [
    "DATE",
    "INVOICE NUMBER",
    "INVOICE CATEGORY",
    "SUPPLIER/VENDOR",
    "PARTY",
    "CUSTOMER TRN", // only customer TRN for Sales
    "PLACE OF SUPPLY",
    "CURRENCY",
    "BEFORE TAX AMOUNT",
    "VAT",
    "NET AMOUNT",
    "BEFORE TAX (AED)",
    "VAT (AED)",
    "ZERO RATED (AED)",
    "NET AMOUNT (AED)",
    "CONFIDENCE",
    "SOURCE",
  ];

  const UAE_PURCHASE_ORDER = [
    "DATE",
    "INVOICE NUMBER",
    "INVOICE CATEGORY",
    "SUPPLIER/VENDOR",
    "PARTY",
    "SUPPLIER TRN", // only supplier TRN for Purchases
    "PLACE OF SUPPLY",
    "CURRENCY",
    "BEFORE TAX AMOUNT",
    "VAT",
    "NET AMOUNT",
    "BEFORE TAX (AED)",
    "VAT (AED)",
    "ZERO RATED (AED)",
    "NET AMOUNT (AED)",
    "CONFIDENCE",
    "SOURCE",
  ];
  const UAE_OTHERS_ORDER = [
    "DATE",
    "INVOICE NUMBER",
    "INVOICE CATEGORY",
    "SUPPLIER/VENDOR",
    "PARTY",
    "SUPPLIER TRN",
    "CUSTOMER TRN",
    "PLACE OF SUPPLY",
    "CURRENCY",
    "BEFORE TAX AMOUNT",
    "VAT",
    "NET AMOUNT",
    "BEFORE TAX (AED)",
    "VAT (AED)",
    "ZERO RATED (AED)",
    "NET AMOUNT (AED)",
    "CONFIDENCE",
    "SOURCE",
  ];

  XLSX.utils.book_append_sheet(
    wb,
    sheetFromObjects(job.uaeSalesRows, UAE_SALES_ORDER),
    "UAE - Sales"
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheetFromObjects(job.uaePurchaseRows, UAE_PURCHASE_ORDER),
    "UAE - Purchases"
  );

  if (Array.isArray(job.uaeOtherRows) && job.uaeOtherRows.length) {
    XLSX.utils.book_append_sheet(
      wb,
      sheetFromObjects(job.uaeOtherRows, UAE_OTHERS_ORDER),
      "UAE - Others"
    );
  }

  const purchaseTotals = {
    beforeTax: sumCol(job.uaePurchaseRows, "BEFORE TAX (AED)"),
    vat: sumCol(job.uaePurchaseRows, "VAT (AED)"),
    zero: sumCol(job.uaePurchaseRows, "ZERO RATED (AED)"),
    net: sumCol(job.uaePurchaseRows, "NET AMOUNT (AED)"),
  };

  const salesTotals = {
    beforeTax: sumCol(job.uaeSalesRows, "BEFORE TAX (AED)"),
    vat: sumCol(job.uaeSalesRows, "VAT (AED)"),
    zero: sumCol(job.uaeSalesRows, "ZERO RATED (AED)"),
    net: sumCol(job.uaeSalesRows, "NET AMOUNT (AED)"),
  };

  XLSX.utils.book_append_sheet(
    wb,
    summarySheet(purchaseTotals),
    "Purchase Total (AED)"
  );
  XLSX.utils.book_append_sheet(
    wb,
    summarySheet(salesTotals),
    "Sales Total (AED)"
  );
  XLSX.utils.book_append_sheet(
    wb,
    vatSummarySheet(salesTotals, purchaseTotals, "Sales", "Purchases", {
      layout: "stacked",
      header: {
        supplierVendor: job.company_name || "",
        supplierTRN: job.company_trn || "",
        taxPeriod: "",
        title: "VAT RETURN SUMMARY",
      },
    }),
    "Vat Summary"
  );

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  job.resultBuffer = buf;
  job.state = "done";
  job.message = "Completed";

  // Update document count for the user
  try {
    const fileNames = job.files.map((f) => f.originalname).join(", ");
    await updateDocumentCount(
      job.userId,
      job.files.length,
      job.totalFileSize,
      "invoices",
      fileNames,
      job.totalPageCount || 0,
      job.totalInputTokens,
      job.totalOutputTokens
    );
  } catch (err) {
    console.error("Failed to update document count:", err);
  }

  job.files = [];
}

// ****** Pool ****** //
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
// ****** Pool ****** //

// ****** XLSX sheet ****** //
function sheetFromObjects(rows, order) {
  const headers = order;
  const data = [
    headers,
    ...rows.map((r) => order.map((k) => (r[k] === undefined ? null : r[k]))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);

  const baseCols = order.map((k) => ({
    wch: Math.max(12, Math.min(40, k.length + 4)),
  }));
  const widen = (name, wch) => {
    const i = order.indexOf(name);
    if (i !== -1) baseCols[i] = { wch };
  };
  widen("SUPPLIER/VENDOR", 36);
  widen("DATE", 12);
  widen("INVOICE NUMBER", 18);
  widen("INVOICE CATEGORY", 20);
  widen("PARTY", 36);
  widen("SUPPLIER TRN", 20);
  widen("CUSTOMER TRN", 20);
  widen("SOURCE", 40);
  widen("ZERO RATED (AED)", 18);
  ws["!cols"] = baseCols;

  ws["!freeze"] = {
    xSplit: "0",
    ySplit: "1",
    topLeftCell: "A2",
    activePane: "bottomLeft",
    state: "frozen",
  };

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

  const numericCols = new Set([
    "BEFORE TAX AMOUNT",
    "VAT",
    "NET AMOUNT",
    "BEFORE TAX (AED)",
    "VAT (AED)",
    "ZERO RATED (AED)",
    "NET AMOUNT (AED)",
  ]);
  for (let R = 1; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const k = order[C];
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[addr];
      if (!cell) continue;
      if (k === "SUPPLIER/VENDOR") {
        cell.s = {
          ...(cell.s || {}),
          alignment: { ...(cell.s?.alignment || {}), wrapText: true },
        };
      }
      if (k === "DATE") {
        cell.s = {
          ...(cell.s || {}),
          alignment: { ...(cell.s?.alignment || {}), horizontal: "center" },
        };
      }
      if (numericCols.has(k) && typeof cell.v === "number") {
        cell.t = "n";
        cell.z = "#,##0.00";
        cell.s = {
          ...(cell.s || {}),
          alignment: { ...(cell.s?.alignment || {}), horizontal: "right" },
        };
      }
    }
  }
  return ws;
}

function sumCol(rows, key) {
  return rows.reduce((acc, r) => acc + (Number(r?.[key]) || 0), 0);
}

function summarySheet({ beforeTax, vat, net, zero = 0 }) {
  const data = [
    ["Metric", "Amount"],
    ["STANDARD RATED SUPPLIES", beforeTax],
    ["OUTPUT TAX", vat],
    ["TOTAL AMOUNT INCLUDING VAT", net],
    ["ZERO RATED SUPPLIES", zero],
    ["EXEMPTED SUPPLIES", 0],
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);

  // widths
  ws["!cols"] = [{ wch: 28 }, { wch: 18 }];

  // header style
  for (let c = 0; c < 2; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    ws[addr].s = {
      font: { bold: true },
      alignment: { horizontal: "center", vertical: "center" },
      fill: { fgColor: { rgb: "F2F2F2" } },
    };
  }

  // number format on amount cells
  for (let r = 1; r <= 4; r++) {
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

function vatSummarySheet(
  a = {},
  b = {},
  labelA = "Sales",
  labelB = "Purchases",
  opts = { layout: "columns", header: {} } // header: { supplierVendor, supplierTRN, taxPeriod, title }
) {
  const A = {
    beforeTax: Number(a.beforeTax || 0),
    vat: Number(a.vat || 0),
    net: Number(a.net || 0),
    zero: Number(a.zero || 0),
  };
  const B = {
    beforeTax: Number(b.beforeTax || 0),
    vat: Number(b.vat || 0),
    net: Number(b.net || 0),
  };

  const SALES_METRICS = [
    ["STANDARD RATED SUPPLIES", "beforeTax"],
    ["OUTPUT TAX", "vat"],
    ["TOTAL AMOUNT INCLUDING VAT", "net"],
    ["ZERO RATED SUPPLIES", "zero"],
    ["EXEMPTED SUPPLIES", null], // always 0
  ];
  const PURCHASE_METRICS = [
    ["STANDARD RATED EXPENSES", "beforeTax"],
    ["INPUT TAX", "vat"],
    ["TOTAL AMOUNT INCLUDING VAT", "net"],
  ];

  const header = opts?.header || {};
  const hdrVendor = header.supplierVendor ?? "";
  const hdrTRN = header.supplierTRN ?? "";
  const hdrTitle = header.title ?? "VAT RETURN SUMMARY";
  const hdrPeriod = header.taxPeriod ?? "";

  const netVat = A.vat - B.vat; // Sales OUTPUT TAX âˆ’ Purchases INPUT TAX
  let ws;

  if ((opts?.layout || "columns") === "stacked") {
    // ===== STACKED: 2 columns =====
    const data = [
      // 4 header rows (merged across A:B)
      [`Company name: ${hdrVendor}`, ""],
      [`TRN: ${hdrTRN}`, ""],
      [hdrTitle, ""],
      [`TAX PERIOD: ${hdrPeriod}`, ""],

      // table header
      ["PARTICULAR", "AMOUNT"],

      // Sales section
      [labelA, ""],
      ...SALES_METRICS.map(([label, key]) => [label, key ? A[key] : 0]),

      ["", ""], // spacer

      // Purchases section
      [labelB, ""],
      ...PURCHASE_METRICS.map(([label, key]) => [label, key ? B[key] : 0]),

      ["", ""], // spacer

      // Net VAT
      ["NET VAT PAYABLE FOR THE PERIOD", netVat],
    ];

    ws = XLSX.utils.aoa_to_sheet(data);

    // widths
    ws["!cols"] = [{ wch: 40 }, { wch: 18 }];

    // merges for the 4 header rows across A:B
    ws["!merges"] = (ws["!merges"] || []).concat([
      { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 1 } },
      { s: { r: 3, c: 0 }, e: { r: 3, c: 1 } },
    ]);

    // style
    // header rows (0..3)
    for (let r = 0; r <= 3; r++) {
      const addr = XLSX.utils.encode_cell({ r, c: 0 });
      ws[addr].s = {
        font: { bold: true, sz: r === 2 ? 12 : 11 }, // title a bit larger
        alignment: { horizontal: "center", vertical: "center" },
      };
    }

    // table heading row at r=4
    for (let c = 0; c < 2; c++) {
      const addr = XLSX.utils.encode_cell({ r: 4, c });
      ws[addr].s = {
        font: { bold: true },
        alignment: { horizontal: "center", vertical: "center" },
        fill: { fgColor: { rgb: "F2F2F2" } },
      };
    }

    // rest formatting
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let r = 5; r <= range.e.r; r++) {
      const partAddr = XLSX.utils.encode_cell({ r, c: 0 });
      const amtAddr = XLSX.utils.encode_cell({ r, c: 1 });
      const v = ws[partAddr]?.v;

      const isSectionHeader = v === labelA || v === labelB;
      const isSpacer = !v && !ws[amtAddr]?.v;

      if (isSectionHeader) {
        ws[partAddr].s = { ...(ws[partAddr].s || {}), font: { bold: true } };
      }

      if (!isSpacer && !isSectionHeader && typeof ws[amtAddr]?.v === "number") {
        ws[amtAddr].t = "n";
        ws[amtAddr].z = "#,##0.00";
        ws[amtAddr].s = {
          ...(ws[amtAddr].s || {}),
          alignment: {
            ...(ws[amtAddr].s?.alignment || {}),
            horizontal: "right",
          },
        };
      }
    }

    // bold the final NET line
    const lastRow = XLSX.utils.decode_range(ws["!ref"]).e.r;
    const netLabelAddr = XLSX.utils.encode_cell({ r: lastRow, c: 0 });
    const netAmtAddr = XLSX.utils.encode_cell({ r: lastRow, c: 1 });
    ws[netLabelAddr].s = {
      ...(ws[netLabelAddr].s || {}),
      font: { bold: true },
    };
    ws[netAmtAddr].t = "n";
    ws[netAmtAddr].z = "#,##0.00";
    ws[netAmtAddr].s = {
      ...(ws[netAmtAddr].s || {}),
      font: { bold: true },
      alignment: { horizontal: "right" },
    };
  } else {
    // ===== COLUMNS: 4 columns =====
    const rows = [
      // 4 merged header rows (A:D)
      [`SUPPLIER/VENDOR: ${hdrVendor}`, "", "", ""],
      [`SUPPLIER TRN: ${hdrTRN}`, "", "", ""],
      [hdrTitle, "", "", ""],
      [`TAX PERIOD: ${hdrPeriod}`, "", "", ""],

      // table header
      ["PARTICULAR", labelA, labelB, "NET VAT (PAYABLE)"],

      // body
      ["STANDARD RATED SUPPLIES", A.beforeTax, null, null],
      ["STANDARD RATED EXPENSES", null, B.beforeTax, null],
      ["OUTPUT TAX", A.vat, null, null],
      ["INPUT TAX", null, B.vat, null],
      ["TOTAL AMOUNT INCLUDING VAT", A.net, B.net, null],
      ["ZERO RATED SUPPLIES", A.zero, null, null],
      ["EXEMPTED SUPPLIES", 0, null, null],
      ["NET VAT PAYABLE FOR THE PERIOD", null, null, netVat],
    ];

    ws = XLSX.utils.aoa_to_sheet(rows);

    // widths
    ws["!cols"] = [{ wch: 40 }, { wch: 18 }, { wch: 18 }, { wch: 22 }];

    // merges for the 4 header rows across A:D
    ws["!merges"] = (ws["!merges"] || []).concat([
      { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 3 } },
      { s: { r: 3, c: 0 }, e: { r: 3, c: 3 } },
    ]);

    // style header rows
    for (let r = 0; r <= 3; r++) {
      const addr = XLSX.utils.encode_cell({ r, c: 0 });
      ws[addr].s = {
        font: { bold: true, sz: r === 2 ? 12 : 11 },
        alignment: { horizontal: "center", vertical: "center" },
      };
    }

    // table header row r=4
    for (let c = 0; c < 4; c++) {
      const addr = XLSX.utils.encode_cell({ r: 4, c });
      ws[addr].s = {
        font: { bold: true },
        alignment: { horizontal: "center", vertical: "center" },
        fill: { fgColor: { rgb: "F2F2F2" } },
      };
    }

    // body formatting
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let r = 5; r <= range.e.r; r++) {
      const labelAddr = XLSX.utils.encode_cell({ r, c: 0 });
      ws[labelAddr].s = { ...(ws[labelAddr].s || {}), font: { bold: true } };

      for (let c = 1; c <= 3; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr] || (ws[addr] = {});
        if (typeof cell.v === "number") {
          cell.t = "n";
          cell.z = "#,##0.00";
          cell.s = {
            ...(cell.s || {}),
            alignment: { ...(cell.s?.alignment || {}), horizontal: "right" },
          };
        }
      }
    }

    // emphasize last NET row
    const last = XLSX.utils.decode_range(ws["!ref"]).e.r;
    const netLabelAddr = XLSX.utils.encode_cell({ r: last, c: 0 });
    const netAmtAddr = XLSX.utils.encode_cell({ r: last, c: 3 });
    ws[netLabelAddr].s = {
      ...(ws[netLabelAddr].s || {}),
      font: { bold: true },
    };
    ws[netAmtAddr].s = {
      ...(ws[netAmtAddr].s || {}),
      font: { bold: true },
      alignment: { horizontal: "right" },
    };
  }

  return ws;
}

// ****** XLSX sheet ****** //

// ****** Retry ****** //
async function withRetry(fn, { retries = 3, baseMs = 1200 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const code = e?.status || e?.response?.status || 0;
      if (i === retries || (code && code < 500 && code !== 429)) break;
      const wait = baseMs * Math.pow(2, i);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}
// ****** Retry ****** //

