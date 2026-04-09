// src/pages/vat/VatFillingPreview.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import {
  saveVatFilingDraft,
  fetchVatRun,
  updateVatRun,
} from "../../helper/helper";
import {
  getVatFilingPreview,
  generateVatFilingExcel,
} from "../../helper/helper";
import "./VatFilingPreview.css";
import toast from "react-hot-toast";
import PdfViewer from "../../components/PdfViewer/PdfViewer";
import ImageViewer from "../../components/ImageViewer/ImageViewer";
import { VatFilingComposer } from "../BankandInvoice/BankAndInvoice";
import { X } from "lucide-react";

const RAW_API_BASE =
  import.meta.env.VITE_API_BASE || "http://localhost:3001/api";

const API_BASE = RAW_API_BASE.replace(/\/$/, "");
const BACKEND_ORIGIN = API_BASE.replace(/\/api$/i, "");

function parseReconAmount(val) {
  if (val === null || val === undefined) return null;

  if (typeof val === "number") {
    return Number.isFinite(val) ? val : null;
  }

  let s = String(val).trim();
  if (!s) return null;

  // Remove commas & spaces
  s = s.replace(/,/g, "").replace(/\s+/g, "");
  // Keep only digits, dot, +, -
  s = s.replace(/[^0-9.+-]/g, "");
  if (!s) return null;

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const VAT_RATE = 0.05;

const round2 = (n) => {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
};

const toNumberLoose = (v) => {
  if (v === null || v === undefined) return null;
  const n = parseReconAmount(v); // you already have this
  return n == null ? null : n;
};

const fmt2 = (n) => round2(n).toFixed(2);
const COLUMN_FILTER_VIEWS = new Set(["sales", "purchase", "others"]);

const normalizeInvoiceRowToken = (v) =>
  String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const getInvoiceRowMatchKey = (row) =>
  [
    row?.SOURCE,
    row?.DATE,
    row?.["INVOICE NUMBER"],
    row?.["SUPPLIER/VENDOR"],
    row?.PARTY,
    row?.["SUPPLIER TRN"],
    row?.["CUSTOMER TRN"],
    row?.CURRENCY,
    row?.["BEFORE TAX AMOUNT"],
    row?.VAT,
    row?.["NET AMOUNT"],
    row?.["BEFORE TAX (AED)"],
    row?.["VAT (AED)"],
    row?.["ZERO RATED (AED)"],
    row?.["NET AMOUNT (AED)"],
    row?.["PLACE OF SUPPLY"],
  ]
    .map(normalizeInvoiceRowToken)
    .join("|");

/* --- DATE FORMATTING UTILS --- */
const parseFlexibleDate = (s) => {
  if (!s) return null;
  const str = String(s).trim();
  if (!str) return null;

  // 1. Try standard parse (YYYY-MM-DD or MM/DD/YYYY)
  let d = new Date(str);
  if (!isNaN(d.getTime())) {
    // Check if it's DD/MM/YYYY format which JS might misinterpret as MM/DD/YYYY
    // e.g. 05/01/2024 (Jan 5 in UAE) -> JS might say May 1.
    // If it has slashes, we'll favor the explicit parse below for DD/MM/YYYY.
    if (str.includes("/") && !str.includes("-") && str.split("/")[0].length <= 2) {
      // Continue to explicit parse
    } else {
      return d;
    }
  }

  // 2. Explicit DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const ddmmMatch = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (ddmmMatch) {
    const day = parseInt(ddmmMatch[1], 10);
    const month = parseInt(ddmmMatch[2], 10) - 1;
    const year = parseInt(ddmmMatch[3], 10);
    return new Date(year, month, day);
  }

  // 3. Handle "03 SEP 2025" or "3 Sep 2025" or "06-Sep-2025"
  const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  // Regex to match "D(D) MMM YYYY" with various separators
  const alphaMatch = str.match(/^(\d{1,2})[\/\- ]?([a-z]{3})[\/\- ]?(\d{4})$/i);
  if (alphaMatch) {
    const day = parseInt(alphaMatch[1], 10);
    const monthStr = alphaMatch[2].toLowerCase();
    const monthIndex = monthNames.indexOf(monthStr);
    const year = parseInt(alphaMatch[3], 10);
    if (monthIndex !== -1) return new Date(year, monthIndex, day);
  }

  return isNaN(d.getTime()) ? null : d;
};

const formatDateDisplay = (val) => {
  if (val === null || val === undefined || val === "") return "";
  const d = parseFlexibleDate(val);
  if (!d || isNaN(d.getTime())) return String(val);

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

// Normalize bank rows → one object per row with debit/credit & basic info
function normalizeBankRowsForReconFrontend(bankData) {
  const rawRows = Array.isArray(bankData?.rows) ? bankData.rows : [];
  if (!rawRows.length) return { rows: [] };

  const sample = rawRows[0] || {};
  const keys =
    bankData.headers && bankData.headers.length
      ? bankData.headers
      : Object.keys(sample);

  let creditKey = null;
  let debitKey = null;
  let amountKey = null;
  let balanceKey = null;
  let dateKey = null;
  let refKey = null;
  let descKey = null;

  for (const k of keys) {
    const lower = String(k).toLowerCase();

    if (!creditKey && lower.includes("credit")) creditKey = k;
    if (!debitKey && lower.includes("debit")) debitKey = k;

    if (!amountKey && lower.includes("amount") && !lower.includes("balance")) {
      amountKey = k;
    }

    if (!balanceKey && lower.includes("balance")) balanceKey = k;
    if (!dateKey && lower.includes("date")) dateKey = k;
    if (!refKey && lower.includes("reference")) refKey = k;

    if (
      !descKey &&
      (lower.includes("description") || lower.includes("narration"))
    ) {
      descKey = k;
    }
  }

  const rows = rawRows
    .map((row, idx) => {
      let credit = creditKey ? parseReconAmount(row[creditKey]) : null;
      let debit = debitKey ? parseReconAmount(row[debitKey]) : null;

      // For banks with only a single "Amount" column
      if (!creditKey && !debitKey && amountKey) {
        const amt = parseReconAmount(row[amountKey]);
        if (amt != null && amt !== 0) {
          if (amt < 0) {
            debit = amt;
          } else {
            credit = amt;
          }
        }
      }

      return {
        index: idx,
        date: dateKey ? row[dateKey] || "" : "",
        description: descKey ? row[descKey] || "" : "",
        debit,
        credit,
        balance: balanceKey ? parseReconAmount(row[balanceKey]) : null,
        ref: refKey ? row[refKey] || "" : "",
        source: row?.SOURCE ?? row?.source ?? "",
        sourceUrl: row?.SOURCE_URL ?? row?.source_url ?? null,
        sourceType: row?.SOURCE_TYPE ?? row?.source_type ?? null,
      };
    })
    // Drop header-like rows with no money
    .filter((r) => r.debit != null || r.credit != null);

  return { rows };
}

function normalizeRowKeyToken(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function readRowValueByAliases(row, aliases = []) {
  if (!row || typeof row !== "object") return undefined;
  const normalizedToActual = new Map();
  Object.keys(row).forEach((k) => {
    normalizedToActual.set(normalizeRowKeyToken(k), k);
  });
  for (const alias of aliases) {
    const actual = normalizedToActual.get(normalizeRowKeyToken(alias));
    if (actual !== undefined) return row[actual];
  }
  return undefined;
}

function normalizeValueToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isBankModeValue(value) {
  const token = normalizeValueToken(value);
  if (!token) return false;
  if (token === "bank" || token === "banktransfer" || token === "wiretransfer")
    return true;
  return token.includes("bank");
}

function isPaidStatusValue(value) {
  const token = normalizeValueToken(value);
  if (!token) return false;
  if (
    token.startsWith("unpaid") ||
    token.startsWith("pending") ||
    token.startsWith("partiallypaid")
  ) {
    return false;
  }
  if (
    token === "paid" ||
    token.startsWith("paid") ||
    token === "fullypaid" ||
    token === "settled" ||
    token === "completed" ||
    token === "received"
  ) {
    return true;
  }
  if (token === "unpaid" || token === "partiallypaid" || token === "pending") {
    return false;
  }
  return false;
}

const PAYMENT_MODE_ALIASES = [
  "PAYMENT MODE",
  "PAYMENT_MODE",
  "MODE OF PAYMENT",
  "PAYMENT METHOD",
  "PAYMENT TYPE",
];

const PAYMENT_STATUS_ALIASES = [
  "PAYMENT STATUS",
  "PAYMENT_STATUS",
  "INVOICE STATUS",
  "PAYMENT STATE",
];

function rowHasPaymentMeta(row) {
  const hasMode =
    readRowValueByAliases(row, PAYMENT_MODE_ALIASES) !== undefined;
  const hasStatus =
    readRowValueByAliases(row, PAYMENT_STATUS_ALIASES) !== undefined;
  return hasMode || hasStatus;
}

function isReconEligibleInvoiceRow(row) {
  const paymentMode = readRowValueByAliases(row, PAYMENT_MODE_ALIASES);
  const paymentStatus = readRowValueByAliases(row, PAYMENT_STATUS_ALIASES);
  return isBankModeValue(paymentMode) && isPaidStatusValue(paymentStatus);
}

// Normalize invoice rows for reconciliation
function buildInvoiceReconRowsFrontend(invoiceRows = [], typeLabel = "Sales") {
  const enforcePaymentFilter = (invoiceRows || []).some(rowHasPaymentMeta);
  const out = [];
  invoiceRows.forEach((r, idx) => {
    if (enforcePaymentFilter && !isReconEligibleInvoiceRow(r)) return;

    const net = parseReconAmount(
      r["NET AMOUNT (AED)"] != null ? r["NET AMOUNT (AED)"] : r["NET AMOUNT"]
    );
    if (net == null || !Number.isFinite(net) || net === 0) return;

    out.push({
      index: idx,
      type: typeLabel, // "Sales" / "Purchase"
      net,
      date: r.DATE ?? null,
      number: r["INVOICE NUMBER"] ?? "",
      party: r["SUPPLIER/VENDOR"] ?? r.PARTY ?? "",
      source: r.SOURCE ?? r.source ?? "",
      sourceUrl: r.SOURCE_URL ?? r.source_url ?? null,
      sourceType: r.SOURCE_TYPE ?? r.source_type ?? null,
    });
  });
  return out;
}

// Match invoices to bank rows by amount:
// mode = "sales" → use bank.credit, "purchase" → bank.debit
function matchInvoicesToBankFrontend(
  invoices,
  bankRows,
  mode,
  usedBankIndices
) {
  const matches = [];
  const byAmount = new Map();

  // Lookup by ABS(bank amount)
  for (const b of bankRows) {
    const rawAmt = mode === "sales" ? b.credit : b.debit;
    if (rawAmt == null || !Number.isFinite(rawAmt) || rawAmt === 0) continue;

    const amt = Math.abs(rawAmt);
    const key = amt.toFixed(2);
    if (!byAmount.has(key)) byAmount.set(key, []);
    byAmount.get(key).push(b);
  }

  for (const inv of invoices) {
    if (inv.net == null || !Number.isFinite(inv.net) || inv.net === 0) continue;

    const key = Math.abs(inv.net).toFixed(2);
    const list = byAmount.get(key);
    if (!list || !list.length) continue;

    const bank = list.find((b) => !usedBankIndices.has(b.index));
    if (!bank) continue;

    usedBankIndices.add(bank.index);
    matches.push({ invoice: inv, bank });
  }

  return matches;
}

// Build display-ready reconciliation rows for UI
function buildBankReconciliationDisplay(bankData, salesRows, purchaseRows) {
  const normBank = normalizeBankRowsForReconFrontend(bankData);
  if (!normBank.rows.length) {
    return { columns: [], rows: [] };
  }

  const salesInvoices = buildInvoiceReconRowsFrontend(salesRows, "Sales");
  const purchaseInvoices = buildInvoiceReconRowsFrontend(
    purchaseRows,
    "Purchase"
  );

  if (!salesInvoices.length && !purchaseInvoices.length) {
    return { columns: [], rows: [] };
  }

  const usedBank = new Set();

  const salesMatches = matchInvoicesToBankFrontend(
    salesInvoices,
    normBank.rows,
    "sales",
    usedBank
  );
  const purchaseMatches = matchInvoicesToBankFrontend(
    purchaseInvoices,
    normBank.rows,
    "purchase",
    usedBank
  );

  const order = [
    "MATCH TYPE",
    "INVOICE TYPE",
    "INVOICE DATE",
    "INVOICE NUMBER",
    "INVOICE PARTY",
    "INVOICE NET (AED)",
    "BANK DATE",
    "BANK DESCRIPTION",
    "BANK DEBIT",
    "BANK CREDIT",
  ];

  const rows = [];
  const matchedSalesIdx = new Set();
  const matchedPurchaseIdx = new Set();

  // Matched sales
  for (const m of salesMatches) {
    matchedSalesIdx.add(m.invoice.index);
    rows.push({
      "MATCH TYPE": "Sales receipt",
      "INVOICE TYPE": m.invoice.type,
      "INVOICE DATE": m.invoice.date || "",
      "INVOICE NUMBER": m.invoice.number || "",
      "INVOICE PARTY": m.invoice.party || "",
      "INVOICE NET (AED)": m.invoice.net,
      "BANK DATE": m.bank.date || "",
      "BANK DESCRIPTION": m.bank.description || "",
      "BANK DEBIT": m.bank.debit,
      "BANK CREDIT": m.bank.credit,
      "INVOICE SOURCE": m.invoice.source || "",
      INVOICE_SOURCE_URL: m.invoice.sourceUrl,
      INVOICE_SOURCE_TYPE: m.invoice.sourceType,
      "BANK SOURCE": m.bank.source || "",
      BANK_SOURCE_URL: m.bank.sourceUrl,
      BANK_SOURCE_TYPE: m.bank.sourceType,
    });
  }

  // Matched purchases
  for (const m of purchaseMatches) {
    matchedPurchaseIdx.add(m.invoice.index);
    rows.push({
      "MATCH TYPE": "Purchase payment",
      "INVOICE TYPE": m.invoice.type,
      "INVOICE DATE": m.invoice.date || "",
      "INVOICE NUMBER": m.invoice.number || "",
      "INVOICE PARTY": m.invoice.party || "",
      "INVOICE NET (AED)": m.invoice.net,
      "BANK DATE": m.bank.date || "",
      "BANK DESCRIPTION": m.bank.description || "",
      "BANK DEBIT": m.bank.debit,
      "BANK CREDIT": m.bank.credit,
      "INVOICE SOURCE": m.invoice.source || "",
      INVOICE_SOURCE_URL: m.invoice.sourceUrl,
      INVOICE_SOURCE_TYPE: m.invoice.sourceType,
      "BANK SOURCE": m.bank.source || "",
      BANK_SOURCE_URL: m.bank.sourceUrl,
      BANK_SOURCE_TYPE: m.bank.sourceType,
    });
  }

  // Unmatched invoices (sales)
  for (const inv of salesInvoices) {
    if (matchedSalesIdx.has(inv.index)) continue;
    rows.push({
      "MATCH TYPE": "Unmatched invoice",
      "INVOICE TYPE": inv.type,
      "INVOICE DATE": inv.date || "",
      "INVOICE NUMBER": inv.number || "",
      "INVOICE PARTY": inv.party || "",
      "INVOICE NET (AED)": inv.net,
      "BANK DATE": "",
      "BANK DESCRIPTION": "",
      "BANK DEBIT": null,
      "BANK CREDIT": null,
      "INVOICE SOURCE": inv.source || "",
      INVOICE_SOURCE_URL: inv.sourceUrl,
      INVOICE_SOURCE_TYPE: inv.sourceType,
    });
  }

  // Unmatched invoices (purchases)
  for (const inv of purchaseInvoices) {
    if (matchedPurchaseIdx.has(inv.index)) continue;
    rows.push({
      "MATCH TYPE": "Unmatched invoice",
      "INVOICE TYPE": inv.type,
      "INVOICE DATE": inv.date || "",
      "INVOICE NUMBER": inv.number || "",
      "INVOICE PARTY": inv.party || "",
      "INVOICE NET (AED)": inv.net,
      "BANK DATE": "",
      "BANK DESCRIPTION": "",
      "BANK DEBIT": null,
      "BANK CREDIT": null,
      "INVOICE SOURCE": inv.source || "",
      INVOICE_SOURCE_URL: inv.sourceUrl,
      INVOICE_SOURCE_TYPE: inv.sourceType,
    });
  }

  // Unmatched bank transactions
  for (const b of normBank.rows) {
    if (usedBank.has(b.index)) continue;
    rows.push({
      "MATCH TYPE": "Unmatched bank transaction",
      "INVOICE TYPE": "",
      "INVOICE DATE": "",
      "INVOICE NUMBER": "",
      "INVOICE PARTY": "",
      "INVOICE NET (AED)": null,
      "BANK DATE": b.date || "",
      "BANK DESCRIPTION": b.description || "",
      "BANK DEBIT": b.debit,
      "BANK CREDIT": b.credit,
      "BANK SOURCE": b.source || "",
      BANK_SOURCE_URL: b.sourceUrl,
      BANK_SOURCE_TYPE: b.sourceType,
    });
  }

  const columns = order.map((k) => ({ key: k, label: k }));
  return { columns, rows };
}

const formatAED = (value) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
};

const sanitizeVatReturnOverrides = (o) => {
  if (!o) return {};
  return Object.entries(o).reduce((acc, [key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      acc[key] = value;
    }
    return acc;
  }, {});
};

const DEFAULT_TAB_VISIBILITY = {
  bank: false,
  bankRecon: false,
};

function toOptionalBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return undefined;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["true", "1", "yes", "enabled", "show", "visible"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "disabled", "hide", "hidden"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function pickVisibilityValue(sources, keys, fallback) {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const key of keys) {
      const resolved = toOptionalBoolean(source[key]);
      if (resolved !== undefined) return resolved;
    }
  }
  return fallback;
}

function resolvePreviewUrl(rawUrl) {
  if (!rawUrl) return null;
  return String(rawUrl).startsWith("http")
    ? rawUrl
    : `${BACKEND_ORIGIN}${rawUrl}`;
}

function inferPreviewType(rawType, rawUrl) {
  if (rawType) return rawType;
  if (rawUrl && String(rawUrl).toLowerCase().endsWith(".pdf")) return "pdf";
  return "image";
}

function buildRowDocuments(row, viewName) {
  if (!row || typeof row !== "object") return [];

  const docs = [];
  const seen = new Set();

  const pushDoc = ({ label, rawUrl, rawType, role }) => {
    const url = resolvePreviewUrl(rawUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    docs.push({
      id: `${role || "doc"}:${url}`,
      label: label || "Uploaded document",
      type: inferPreviewType(rawType, rawUrl),
      url,
      role: role || viewName || "doc",
    });
  };

  pushDoc({
    label: row.SOURCE || row.source || "Uploaded document",
    rawUrl: row.SOURCE_URL || row.source_url,
    rawType: row.SOURCE_TYPE || row.source_type,
    role: viewName,
  });

  pushDoc({
    label: row["INVOICE SOURCE"] || row.invoiceSourceLabel || "Invoice document",
    rawUrl: row.INVOICE_SOURCE_URL || row.invoice_source_url,
    rawType: row.INVOICE_SOURCE_TYPE || row.invoice_source_type,
    role: "invoice",
  });

  pushDoc({
    label: row["BANK SOURCE"] || row.bankSourceLabel || "Bank document",
    rawUrl: row.BANK_SOURCE_URL || row.bank_source_url,
    rawType: row.BANK_SOURCE_TYPE || row.bank_source_type,
    role: "bank",
  });

  return docs;
}

function clonePreviewSnapshot(data) {
  if (!data) return data;
  return JSON.parse(JSON.stringify(data));
}

export default function VatFillingPreview() {
  const { companyId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState(location.state || null);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [activeDocumentId, setActiveDocumentId] = useState(null);
  const [committedPreviewData, setCommittedPreviewData] = useState(
    clonePreviewSnapshot(location.state || null)
  );
  const [showAddFilesModal, setShowAddFilesModal] = useState(false);
  const editablePaneRef = useRef(null);
  const columnFilterRef = useRef(null);
  const [openColumnFilterView, setOpenColumnFilterView] = useState(null);
  const [vatReturnEditKey, setVatReturnEditKey] = useState(null);
  const [visibleColumnKeysByView, setVisibleColumnKeysByView] = useState({
    sales: [],
    purchase: [],
    others: [],
  });

  const searchParams = new URLSearchParams(location.search);
  const runId = searchParams.get("runId");
  const isExistingRun = !!runId;

  const periodIdFromQuery = searchParams.get("periodId");

  const modeFromQuery = searchParams.get("mode");
  const isEditMode = modeFromQuery === "edit";

  const exitEditMode = (nextData = committedPreviewData) => {
    const snapshot = clonePreviewSnapshot(nextData);
    setVatReturnEditKey(null);
    if (snapshot) {
      setPreviewData(snapshot);
      setCommittedPreviewData(snapshot);
    }

    const nextParams = new URLSearchParams(location.search);
    nextParams.delete("mode");
    navigate(
      `${location.pathname}${nextParams.toString() ? `?${nextParams.toString()}` : ""}`,
      {
        replace: true,
        state: snapshot,
      }
    );
  };

  const handleBack = () => {
    const periodId = periodIdFromQuery || previewData?.periodId;

    if (isExistingRun) {
      // 👀 Opened from "VAT Filing – Conversions" list
      if (periodId) {
        navigate(`/projects/vat-filing/periods/${companyId}/runs/${periodId}`);
      } else {
        // Fallback if periodId missing
        navigate(`/projects/vat-filing/periods/${companyId}`);
      }
    } else {
      // 👀 Opened from Bank & Invoice combined preview
      if (periodId) {
        navigate(
          `/projects/vat-filing/bank-and-invoice/${companyId}?periodId=${periodId}`
        );
      } else {
        // Fallback to periods
        navigate(`/projects/vat-filing/periods/${companyId}`);
      }
    }
  };

  const handleAddMoreFiles = () => {
    setShowAddFilesModal(true);
  };

  const handleInlinePreviewRefresh = (combined) => {
    const snapshot = clonePreviewSnapshot(combined);
    setPreviewData(snapshot);
    setCommittedPreviewData(snapshot);
    setShowAddFilesModal(false);
    toast.success("Preview updated with additional files.");
  };

  const [draftSaved, setDraftSaved] = useState(isExistingRun);

  // views:
  // "bank" | "bankRecon" | "sales" | "purchase" | "others" | "placeOfSupply" | "salesTotal" | "purchaseTotal" | "vatSummary" | "vatReturn"
  const [view, setView] = useState("sales");
  const [vatSummaryLocks, setVatSummaryLocks] = useState({});

  const tabVisibility = useMemo(() => {
    const tabOptions = previewData?.tabVisibility;
    const displayMenu = previewData?.displayMenu;
    const visibilityOptions = previewData?.visibilityOptions;
    const uiOptions = previewData?.uiOptions;
    const sources = [tabOptions, displayMenu, visibilityOptions, uiOptions];

    return {
      bank: pickVisibilityValue(
        sources,
        [
          "bank",
          "showBank",
          "showBankStatement",
          "bankStatement",
          "enableBankStatement",
          "bankStatementVisible",
        ],
        DEFAULT_TAB_VISIBILITY.bank
      ),
      bankRecon: pickVisibilityValue(
        sources,
        [
          "bankRecon",
          "showBankRecon",
          "showBankReconciliation",
          "bankReconciliation",
          "enableBankReconciliation",
          "bankReconciliationVisible",
        ],
        DEFAULT_TAB_VISIBILITY.bankRecon
      ),
    };
  }, [previewData]);

  const [metricLocks, setMetricLocks] = useState({
    salesTotal: {}, // e.g. { STANDARDRATEDSUPPLIES: true }
    purchaseTotal: {}, // e.g. { STANDARDRATEDEXPENSES: true }
  });

  const toNum = (v) => {
    if (v === null || v === undefined || v === "") return 0;
    const n = Number(String(v).replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  const metricKey = (s) =>
    String(s || "")
      .replace(/[\s_]/g, "")
      .toUpperCase();

  const findMetricAmount = (rows, metricName) => {
    const target = metricKey(metricName);
    const row = (rows || []).find((r) => metricKey(r?.METRIC) === target);
    return row ? toNum(row.AMOUNT) : 0;
  };

  const setMetricAmount = (rows, metricName, amount) => {
    const target = metricKey(metricName);
    const idx = (rows || []).findIndex((r) => metricKey(r?.METRIC) === target);

    const fixed = Number(amount || 0).toFixed(2);

    if (idx === -1)
      return [...(rows || []), { METRIC: metricName, AMOUNT: fixed }];

    const next = [...rows];
    next[idx] = { ...next[idx], METRIC: metricName, AMOUNT: fixed };
    return next;
  };

  const particularKey = (s) =>
    String(s || "")
      .replace(/[\s_]/g, "")
      .toUpperCase();

  const findVatSummaryRow = (rows, particular) => {
    const target = particularKey(particular);
    return (rows || []).find((r) => particularKey(r?.PARTICULAR) === target);
  };

  const getVatSummaryCellNum = (rows, particular, colKey) => {
    const r = findVatSummaryRow(rows, particular);
    return toNum(r?.[colKey]);
  };

  const setVatSummaryCell = (rows, particular, colKey, valueFixed2) => {
    const target = particularKey(particular);
    const idx = (rows || []).findIndex(
      (r) => particularKey(r?.PARTICULAR) === target
    );

    const base =
      idx === -1
        ? { PARTICULAR: particular, SALES: "", PURCHASES: "", NET_VAT: "" }
        : rows[idx];

    const nextRow = { ...base, [colKey]: valueFixed2 };

    if (idx === -1) return [...rows, nextRow];

    const next = [...rows];
    next[idx] = nextRow;
    return next;
  };

  const normalizeParticularKey = (s) =>
    String(s || "")
      .replace(/[\s_]/g, "")
      .toUpperCase();

  const makeVatSummaryLockKey = (particular, field) =>
    `${normalizeParticularKey(particular)}::${String(field).toUpperCase()}`;

  useEffect(() => {
    // If we are opening a saved conversion (runId), don't auto-fetch company preview
    if (runId) return;

    if (!location.state && !previewData) {
      fetchPreviewData();
    } else if (location.state && !previewData) {
      setPreviewData(location.state);
      setCommittedPreviewData(clonePreviewSnapshot(location.state));
    }
  }, [location.state, previewData, runId]);

  useEffect(() => {
    if (!previewData && runId) {
      (async () => {
        try {
          setLoading(true);
          const { payload } = await fetchVatRun(runId);
          setPreviewData(payload); // {companyId, companyName, bankData, invoiceData, periodId,...}
          setCommittedPreviewData(clonePreviewSnapshot(payload));
          setError(null);
        } catch (err) {
          console.error(err);
          setError(err.message || "Failed to load saved VAT filing");
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [runId, previewData]);

  useEffect(() => {
    if (!previewData?.invoiceData?.othersRows?.length) return;
    const rows = previewData.invoiceData.othersRows;
    const updatedRows = rows.map((row) => {
      if (!row || typeof row !== "object") return row;
      const val = row["VAT ELIGIBILTY"];
      if (val === undefined || val === null || val === "") {
        return {
          ...row,
          "VAT ELIGIBILTY": "Not qualified for Vat Return Filing",
        };
      }
      return row;
    });
    const changed =
      rows.length !== updatedRows.length ||
      rows.some((r, i) => r !== updatedRows[i]);
    if (!changed) return;

    setPreviewData((prev) => {
      if (!prev) return prev;
      const inv = { ...(prev.invoiceData || {}) };
      inv.othersRows = updatedRows;
      inv.__explicitBuckets = true;
      return { ...prev, invoiceData: inv };
    });
  }, [previewData?.invoiceData?.othersRows]);

  const handleSaveDraft = async () => {
    if (!previewData) {
      toast.error("No data to save.");
      return;
    }

    // Prefer period from payload, fallback to query
    const periodId = previewData.periodId || periodIdFromQuery;
    if (!periodId) {
      toast.error("Missing filing period id; please open from a period.");
      return;
    }

    try {
      setLoading(true);
      const latestBankReconData =
        previewData.bankReconData && Array.isArray(previewData.bankReconData.rows)
          ? previewData.bankReconData
          : buildBankReconciliationDisplay(
              previewData.bankData,
              salesRows,
              purchaseRows
            );
      const savedSnapshot = clonePreviewSnapshot({
        ...previewData,
        invoiceData: normalizedInvoiceData,
        bankReconData: latestBankReconData,
      });

      if (isExistingRun && runId) {
        const updated = await updateVatRun(runId, {
          status: previewData.status || "draft",
          companyId: previewData.companyId || companyId,
          companyName: previewData.companyName || "",
          companyTRN: previewData.companyTRN || "",
          bankData: previewData.bankData,
          invoiceData: normalizedInvoiceData,
          bankReconData: latestBankReconData,
          salesTotal: previewData.salesTotal,
          purchaseTotal: previewData.purchaseTotal,
          vatSummary: previewData.vatSummary,
          vatReturnOverrides: sanitizeVatReturnOverrides(
            previewData.vatReturnOverrides
          ),
        });

        const persistedSnapshot = clonePreviewSnapshot(
          updated?.payload || savedSnapshot
        );

        toast.success("Conversion updated successfully.");
        setPreviewData(persistedSnapshot);
        setCommittedPreviewData(persistedSnapshot);
        setDraftSaved(true);
        exitEditMode(persistedSnapshot);
      } else {
        // 🆕 CREATE FIRST DRAFT (same behavior as before)
        if (draftSaved) {
          toast.success("Draft already saved for this run.");
          return;
        }

        const created = await saveVatFilingDraft(periodId, {
          companyId: previewData.companyId || companyId,
          companyName: previewData.companyName || "",
          companyTRN: previewData.companyTRN || "",
          bankData: previewData.bankData,
          invoiceData: normalizedInvoiceData,
          status: "draft",
          bankReconData: latestBankReconData,
          salesTotal: previewData.salesTotal,
          purchaseTotal: previewData.purchaseTotal,
          vatSummary: previewData.vatSummary,
          vatReturnOverrides: previewData.vatReturnOverrides,
        });

        const createdRun = created?.run;
        const persistedSnapshot = clonePreviewSnapshot(
          created?.payload || savedSnapshot
        );

        setDraftSaved(true);
        toast.success("VAT filing draft saved successfully.");
        setPreviewData(persistedSnapshot);
        setCommittedPreviewData(persistedSnapshot);

        const nextParams = new URLSearchParams(location.search);
        if (createdRun?.id) nextParams.set("runId", String(createdRun.id));
        nextParams.set("periodId", String(periodId));
        navigate(
          `${location.pathname}${nextParams.toString() ? `?${nextParams.toString()}` : ""}`,
          { replace: true }
        );

        exitEditMode(persistedSnapshot);
      }
    } catch (err) {
      console.error(err);
      toast.error(err?.message || "Failed to save.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = () => {
    // Here you can: call backend to generate Excel and maybe mark run as 'final'
    // for now just a placeholder
    alert("Verify action to be implemented (e.g. finalise & generate Excel)");
  };

  async function fetchPreviewData() {
    try {
      setLoading(true);
      const res = await getVatFilingPreview(companyId);
      setPreviewData(res);
      setCommittedPreviewData(clonePreviewSnapshot(res));
    } catch (e) {
      console.error("Failed to fetch preview data:", e);
      setError("Failed to load preview data");
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload() {
    try {
      if (!previewData) {
        alert("No data to download");
        return;
      }

      const latestBankReconData =
        previewData.bankReconData && Array.isArray(previewData.bankReconData.rows)
          ? previewData.bankReconData
          : buildBankReconciliationDisplay(
              previewData.bankData,
              salesRows,
              purchaseRows
            );

      const blob = await generateVatFilingExcel(companyId, {
        bankData: previewData.bankData,
        invoiceData: normalizedInvoiceData,
        companyName: previewData.companyName || `Company ${companyId}`,
        bankReconData: latestBankReconData,
        salesTotal: previewData.salesTotal,
        purchaseTotal: previewData.purchaseTotal,
        vatSummary: previewData.vatSummary,
        vatReturnOverrides: previewData.vatReturnOverrides,
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = previewData.downloadFileName || "VAT_Filing.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download Excel file:", err);
      alert("Failed to download Excel file");
    }
  }

  const handleCellChange = (viewName, rowIndex, colKey, newValue) => {
    // helper: unlock totals when invoice (sales/purchase) numbers are edited
    const unlockTotalsForInvoiceEdit = (viewName, colKey) => {
      setMetricLocks((prevLocks) => {
        const updated = { ...prevLocks };

        if (viewName === "sales") {
          const section = { ...(updated.salesTotal || {}) };

          if (colKey === "BEFORE TAX (AED)")
            delete section["STANDARDRATEDSUPPLIES"];
          if (colKey === "VAT (AED)") delete section["OUTPUTTAX"];
          if (colKey === "ZERO RATED (AED)")
            delete section["ZERORATEDSUPPLIES"];

          // total including vat must recalc if std/output changed
          if (["BEFORE TAX (AED)", "VAT (AED)"].includes(colKey)) {
            delete section["TOTALAMOUNTINCLUDINGVAT"];
          }

          updated.salesTotal = section;
        } else {
          const section = { ...(updated.purchaseTotal || {}) };

          if (colKey === "BEFORE TAX (AED)")
            delete section["STANDARDRATEDEXPENSES"];
          if (colKey === "VAT (AED)") delete section["INPUTTAX"];
          if (colKey === "ZERO RATED (AED)")
            delete section["ZERORATEDEXPENSES"];

          if (["BEFORE TAX (AED)", "VAT (AED)"].includes(colKey)) {
            delete section["TOTALAMOUNTINCLUDINGVAT"];
          }

          updated.purchaseTotal = section;
        }

        return updated;
      });
    };

    setPreviewData((prev) => {
      if (!prev) return prev;
      const next = { ...prev };

      // 1) Bank Statement (✅ allow ANY text in debit/credit/balance cells)
      if (viewName === "bank") {
        if (!next.bankData || !Array.isArray(next.bankData.rows)) return prev;

        const rows = [...next.bankData.rows];
        const row = { ...rows[rowIndex] };

        // ✅ store raw string (no parseReconAmount / no numeric coercion)
        row[colKey] = newValue;

        rows[rowIndex] = row;
        next.bankData = { ...next.bankData, rows };
        next.bankReconData = null;
        return next;
      }

      // 2) Bank Reconciliation (✅ allow ANY text in BANK DEBIT/BANK CREDIT etc.)
      if (viewName === "bankRecon") {
        const recon = next.bankReconData || { columns: [], rows: [] };
        const rowsArr = Array.isArray(recon.rows) ? recon.rows : [];
        if (!rowsArr.length) return prev;

        const newRows = [...rowsArr];
        const row = { ...newRows[rowIndex] };

        // ✅ store raw string (no parseReconAmount / no numeric coercion)
        row[colKey] = newValue;

        newRows[rowIndex] = row;
        next.bankReconData = { ...recon, rows: newRows };
        return next;
      }

      // 3) Sales / Purchase raw tables (editable)
      if (viewName === "sales" || viewName === "purchase") {
        const keyName =
          viewName === "sales" ? "uaeSalesRows" : "uaePurchaseRows";
        const inv = { ...(next.invoiceData || {}) };

        const rowsArr = Array.isArray(inv[keyName]) ? inv[keyName] : [];
        if (!rowsArr.length) return prev;

        const newRows = [...rowsArr];
        const row = { ...newRows[rowIndex] };

        // 1) set the edited cell
        row[colKey] = newValue;

        // 2) VAT <-> BEFORE TAX sync (only for AED columns)
        const isBeforeTaxAED = colKey === "BEFORE TAX (AED)";
        const isVatAED = colKey === "VAT (AED)";

        if (isBeforeTaxAED) {
          // allow typing freely
          row["BEFORE TAX (AED)"] = newValue;

          // if user cleared, clear dependent
          if (String(newValue).trim() === "") {
            row["VAT (AED)"] = "";
            row["NET AMOUNT (AED)"] = "";
          } else {
            const bt = toNumberLoose(newValue);

            // only compute if parseable
            if (bt != null) {
              const vat = round2(bt * VAT_RATE);
              row["VAT (AED)"] = fmt2(vat);
              row["NET AMOUNT (AED)"] = fmt2(bt + vat);
            }
          }
        }

        if (isVatAED) {
          row["VAT (AED)"] = newValue;

          if (String(newValue).trim() === "") {
            row["BEFORE TAX (AED)"] = "";
            row["NET AMOUNT (AED)"] = "";
          } else {
            const vat = toNumberLoose(newValue);

            if (vat != null) {
              const bt = round2(vat / VAT_RATE);
              row["BEFORE TAX (AED)"] = fmt2(bt);
              row["NET AMOUNT (AED)"] = fmt2(bt + vat);
            }
          }
        }

        // (optional) if user edits NET, you can back-calc too — not requested now

        newRows[rowIndex] = row;
        inv[keyName] = newRows;
        inv.__explicitBuckets = true;
        next.invoiceData = inv;
        next.bankReconData = null;

        // unlock totals so they recalc
        if (
          ["BEFORE TAX (AED)", "VAT (AED)", "ZERO RATED (AED)"].includes(colKey)
        ) {
          unlockTotalsForInvoiceEdit(viewName, colKey);
        }

        return next;
      }

      // 4) Others & Place of Supply
      if (viewName === "others" || viewName === "placeOfSupply") {
        const keyName = viewName === "others" ? "othersRows" : "placeOfSupplyRows";
        const inv = { ...(next.invoiceData || {}) };
        const rowsArr = Array.isArray(inv[keyName])
          ? [...inv[keyName]]
          : [];
        if (rowIndex < 0 || rowIndex >= rowsArr.length) return prev;
        const row = { ...(rowsArr[rowIndex] || {}) };
        row[colKey] = newValue;
        rowsArr[rowIndex] = row;
        inv[keyName] = rowsArr;
        if (viewName === "others") inv.uaeOtherRows = rowsArr;
        inv.__explicitBuckets = true;
        next.invoiceData = inv;
        next.bankReconData = null;
        return next;
      }

      // 5) Sales Total / Purchase Total / VAT Summary (NOT editable now)
      if (
        viewName === "salesTotal" ||
        viewName === "purchaseTotal" ||
        viewName === "vatSummary"
      ) {
        const next = { ...prev };

        if (viewName === "salesTotal" || viewName === "purchaseTotal") {
          const targetKey = viewName;
          const rowsArr = Array.isArray(next[targetKey]) ? [...next[targetKey]] : [];
          if (rowIndex < 0 || rowIndex >= rowsArr.length) return prev;
          const row = { ...(rowsArr[rowIndex] || {}) };
          row[colKey] = newValue;
          rowsArr[rowIndex] = row;
          next[targetKey] = rowsArr;

          const metricName = row?.METRIC;
          if (metricName && String(colKey).toUpperCase() === "AMOUNT") {
            setMetricLocks((prevLocks) => ({
              ...prevLocks,
              [targetKey]: {
                ...(prevLocks[targetKey] || {}),
                [metricKey(metricName)]: true,
              },
            }));
          }

          return next;
        }

        const rowsArr = Array.isArray(next.vatSummary) ? [...next.vatSummary] : [];
        if (rowIndex < 0 || rowIndex >= rowsArr.length) return prev;
        const row = { ...(rowsArr[rowIndex] || {}) };
        row[colKey] = newValue;
        rowsArr[rowIndex] = row;
        next.vatSummary = rowsArr;

        const particular = row?.PARTICULAR;
        if (particular) {
          setVatSummaryLocks((prevLocks) => ({
            ...prevLocks,
            [makeVatSummaryLockKey(particular, colKey)]: true,
          }));
        }

        return next;
      }

      return prev;
    });
  };

  const handleDeleteRow = (viewName, rowIndex) => {
    if (!isEditMode) return;

    setPreviewData((prev) => {
      if (!prev) return prev;
      const next = { ...prev };

      if (viewName === "bank") {
        const rows = Array.isArray(next.bankData?.rows)
          ? [...next.bankData.rows]
          : [];
        if (rowIndex < 0 || rowIndex >= rows.length) return prev;
        rows.splice(rowIndex, 1);
        next.bankData = { ...(next.bankData || {}), rows };
        next.bankReconData = null;
        return next;
      }

      if (viewName === "sales" || viewName === "purchase") {
        const keyName =
          viewName === "sales" ? "uaeSalesRows" : "uaePurchaseRows";
        const inv = { ...(next.invoiceData || {}) };
        const rowsArr = Array.isArray(inv[keyName]) ? [...inv[keyName]] : [];
        if (rowIndex < 0 || rowIndex >= rowsArr.length) return prev;
        rowsArr.splice(rowIndex, 1);
        inv[keyName] = rowsArr;
        inv.__explicitBuckets = true;
        next.invoiceData = inv;
        next.bankReconData = null;
        return next;
      }

      if (viewName === "others" || viewName === "placeOfSupply") {
        const keyName = viewName === "others" ? "othersRows" : "placeOfSupplyRows";
        const inv = { ...(next.invoiceData || {}) };
        const rowsArr = Array.isArray(inv[keyName]) ? [...inv[keyName]] : [];
        if (rowIndex < 0 || rowIndex >= rowsArr.length) return prev;
        rowsArr.splice(rowIndex, 1);
        inv[keyName] = rowsArr;
        if (viewName === "others") inv.uaeOtherRows = rowsArr;
        inv.__explicitBuckets = true;
        next.invoiceData = inv;
        next.bankReconData = null;
        return next;
      }

      return prev;
    });
  };

  const handleOthersRowAction = (rowIndex, action) => {
    if (!action) return;

    if (action === "edit") {
      setSelectedRecord({ view: "others", rowIndex });

      if (!isEditMode) {
        const nextParams = new URLSearchParams(location.search);
        nextParams.set("mode", "edit");
        navigate(
          `${location.pathname}${nextParams.toString() ? `?${nextParams.toString()}` : ""}`
        );
      }
      return;
    }

    if (action === "delete") {
      const displayedOthersRows = Array.isArray(othersRowsView) ? othersRowsView : [];

      setPreviewData((prev) => {
        if (!prev) return prev;

        const deletedRow = displayedOthersRows[rowIndex];
        if (!deletedRow) return prev;

        const deletedRowKey = getInvoiceRowMatchKey(deletedRow);
        const removeMatchingRow = (rows = []) => {
          let removed = false;
          return rows.filter((row) => {
            if (removed) return true;
            const isMatch = getInvoiceRowMatchKey(row) === deletedRowKey;
            if (isMatch) {
              removed = true;
              return false;
            }
            return true;
          });
        };

        const next = { ...prev };
        const inv = { ...(next.invoiceData || {}) };
        const othersRows = removeMatchingRow(
          Array.isArray(inv.othersRows) ? [...inv.othersRows] : []
        );
        const uaeOtherRows = removeMatchingRow(
          Array.isArray(inv.uaeOtherRows) ? [...inv.uaeOtherRows] : []
        );

        inv.othersRows = othersRows;
        inv.uaeOtherRows = uaeOtherRows;
        inv.__explicitBuckets = true;
        next.invoiceData = inv;
        next.bankReconData = null;

        setSelectedRecord(null);
        setActiveDocumentId(null);
        toast.success("Others record deleted.");

        return next;
      });
      return;
    }

    if (action !== "moveToSales" && action !== "moveToPurchase") return;

    const targetView = action === "moveToSales" ? "sales" : "purchase";

    const displayedOthersRows = Array.isArray(othersRowsView) ? othersRowsView : [];

    setPreviewData((prev) => {
      if (!prev) return prev;

      const inv = { ...(prev.invoiceData || {}) };
      const movedRow = displayedOthersRows[rowIndex];
      if (!movedRow) return prev;

      const movedRowKey = getInvoiceRowMatchKey(movedRow);
      const removeMatchingRow = (rows = []) => {
        let removed = false;
        return rows.filter((row) => {
          if (removed) return true;
          const isMatch = getInvoiceRowMatchKey(row) === movedRowKey;
          if (isMatch) {
            removed = true;
            return false;
          }
          return true;
        });
      };

      const othersRows = removeMatchingRow(
        Array.isArray(inv.othersRows) ? [...inv.othersRows] : []
      );
      const uaeOtherRows = removeMatchingRow(
        Array.isArray(inv.uaeOtherRows) ? [...inv.uaeOtherRows] : []
      );
      const targetKey =
        targetView === "sales" ? "uaeSalesRows" : "uaePurchaseRows";
      const targetRows = Array.isArray(inv[targetKey]) ? [...inv[targetKey]] : [];

      targetRows.push({
        ...movedRow,
        TYPE: targetView === "sales" ? "Sales" : "Purchase",
      });

      inv.othersRows = othersRows;
      inv.uaeOtherRows = uaeOtherRows;
      inv[targetKey] = targetRows;
      inv.__explicitBuckets = true;

      setView(targetView);
      setSelectedRecord({ view: targetView, rowIndex: targetRows.length - 1 });
      setActiveDocumentId(null);

      toast.success(
        `Record moved to ${targetView === "sales" ? "Sales" : "Purchase"}.`
      );

      return {
        ...prev,
        invoiceData: inv,
        bankReconData: null,
      };
    });
  };

  const handleSalesPurchaseRowAction = (viewName, rowIndex, action) => {
    if (!action || !["sales", "purchase"].includes(viewName)) return;

    if (action === "edit") {
      setSelectedRecord({ view: viewName, rowIndex });

      if (!isEditMode) {
        const nextParams = new URLSearchParams(location.search);
        nextParams.set("mode", "edit");
        navigate(
          `${location.pathname}${nextParams.toString() ? `?${nextParams.toString()}` : ""}`
        );
      }
      return;
    }

    if (action !== "delete" && action !== "moveToOthers") return;

    const displayedRows =
      viewName === "sales"
        ? Array.isArray(salesRows)
          ? salesRows
          : []
        : Array.isArray(purchaseRows)
          ? purchaseRows
          : [];

    setPreviewData((prev) => {
      if (!prev) return prev;

      const movedRow = displayedRows[rowIndex];
      if (!movedRow) return prev;

      const rowKey = getInvoiceRowMatchKey(movedRow);
      const removeMatchingRow = (rows = []) => {
        let removed = false;
        return rows.filter((row) => {
          if (removed) return true;
          const isMatch = getInvoiceRowMatchKey(row) === rowKey;
          if (isMatch) {
            removed = true;
            return false;
          }
          return true;
        });
      };

      const next = { ...prev };
      const inv = { ...(next.invoiceData || {}) };
      const sourceKey =
        viewName === "sales" ? "uaeSalesRows" : "uaePurchaseRows";
      const sourceRows = removeMatchingRow(
        Array.isArray(inv[sourceKey]) ? [...inv[sourceKey]] : []
      );

      inv[sourceKey] = sourceRows;

      if (action === "moveToOthers") {
        const othersBase = Array.isArray(inv.othersRows) ? [...inv.othersRows] : [];
        const nextOthers = [
          ...othersBase,
          {
            ...movedRow,
            TYPE: "Others",
          },
        ];
        inv.othersRows = nextOthers;
        inv.uaeOtherRows = nextOthers;
      }

      inv.__explicitBuckets = true;
      next.invoiceData = inv;
      next.bankReconData = null;

      if (action === "moveToOthers") {
        setView("others");
        const nextOthersIndex = Math.max((inv.othersRows || []).length - 1, 0);
        setSelectedRecord({ view: "others", rowIndex: nextOthersIndex });
        setActiveDocumentId(null);
        toast.success(
          `Record moved to Others from ${viewName === "sales" ? "Sales" : "Purchase"}.`
        );
      } else {
        setSelectedRecord(null);
        setActiveDocumentId(null);
        toast.success(
          `${viewName === "sales" ? "Sales" : "Purchase"} record deleted.`
        );
      }

      return next;
    });
  };

  const handleMetricRowEdit = (viewName, rowIndex) => {
    setSelectedRecord({ view: viewName, rowIndex });

    if (!isEditMode) {
      const nextParams = new URLSearchParams(location.search);
      nextParams.set("mode", "edit");
      navigate(
        `${location.pathname}${nextParams.toString() ? `?${nextParams.toString()}` : ""}`
      );
    }
  };

  const handleVatReturnRowEdit = (rowKey) => {
    setVatReturnEditKey(rowKey);

    if (!isEditMode) {
      const nextParams = new URLSearchParams(location.search);
      nextParams.set("mode", "edit");
      navigate(
        `${location.pathname}${nextParams.toString() ? `?${nextParams.toString()}` : ""}`
      );
    }
  };

  const handleAddRow = (viewName) => {
    if (!isEditMode) return;

    setPreviewData((prev) => {
      if (!prev) return prev;
      const next = { ...prev };

      if (viewName === "bank") {
        const columns = Array.isArray(next.bankData?.columns)
          ? normalizeCols(next.bankData.columns)
          : [];
        const keys = columns.length
          ? columns.map((c) => c.key)
          : Object.keys(next.bankData?.rows?.[0] || {});
        const newRow = {};
        keys.forEach((k) => {
          if (String(k).toLowerCase() === "row") return;
          newRow[k] = "";
        });
        const rows = Array.isArray(next.bankData?.rows)
          ? [...next.bankData.rows, newRow]
          : [newRow];
        next.bankData = { ...(next.bankData || {}), rows };
        next.bankReconData = null;
        return next;
      }

      if (viewName === "sales" || viewName === "purchase") {
        const keyName =
          viewName === "sales" ? "uaeSalesRows" : "uaePurchaseRows";
        const inv = { ...(next.invoiceData || {}) };
        const rowsArr = Array.isArray(inv[keyName]) ? [...inv[keyName]] : [];
        const order =
          viewName === "sales" ? UAE_SALES_ORDER : UAE_PURCHASE_ORDER;
        const newRow = {};
        order.forEach((k) => {
          newRow[k] = "";
        });
        rowsArr.push(newRow);
        inv[keyName] = rowsArr;
        inv.__explicitBuckets = true;
        next.invoiceData = inv;
        next.bankReconData = null;
        return next;
      }

      if (viewName === "others" || viewName === "placeOfSupply") {
        const keyName = viewName === "others" ? "othersRows" : "placeOfSupplyRows";
        const inv = { ...(next.invoiceData || {}) };
        const rowsArr = Array.isArray(inv[keyName])
          ? [...inv[keyName]]
          : [];
        const keys = rowsArr.length
          ? Object.keys(rowsArr[0])
          : (viewName === "others" ? UAE_OTHERS_ORDER : UAE_PLACE_OF_SUPPLY_ORDER);
        const newRow = {};
        keys.forEach((k) => {
          if (String(k).toLowerCase() === "row") return;
          if (viewName === "others" && String(k).toUpperCase() === "VAT ELIGIBILTY") {
            newRow[k] = "Not qualified for Vat Return Filing";
            return;
          }
          newRow[k] = "";
        });
        rowsArr.push(newRow);
        inv[keyName] = rowsArr;
        if (viewName === "others") inv.uaeOtherRows = rowsArr;
        inv.__explicitBuckets = true;
        next.invoiceData = inv;
        next.bankReconData = null;
        return next;
      }

      return prev;
    });
  };

  // ===== Helpers =====
  const HIDE_KEYS = new Set(["row"]);
  const normalizeCols = (cols = []) =>
    cols.map((c, i) => {
      if (typeof c === "string") return { key: c, label: c };
      const key = c?.key ?? c?.field ?? c?.accessor ?? `col_${i}`;
      const label = Object.prototype.hasOwnProperty.call(c || {}, "label")
        ? c.label
        : key;
      return { key: String(key), label: String(label ?? "") };
    });
  const filterHidden = (cols) =>
    cols.filter((c) => !HIDE_KEYS.has(String(c.key).toLowerCase()));
  const isNumeric = (text) => {
    const t = String(text ?? "").trim();

    if (/^[+-]?\d[\d,\s]*(\.\d+)?$/.test(t)) return true;

    if (/^\([\d,\s]+(\.\d+)?\)$/.test(t)) return true;

    return false;
  };

  const isCellEditable = (viewName) =>
    isEditMode &&
    ["bank", "bankRecon", "sales", "purchase", "others", "placeOfSupply"].includes(viewName);

  // === VAT Return overrides helpers ===
  const handleVatReturnInputChange = (key, rawValue) => {
    setPreviewData((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      const overrides = { ...(prev.vatReturnOverrides || {}) };
      overrides[key] = rawValue;
      next.vatReturnOverrides = overrides;
      return next;
    });
  };

  const getVatReturnOverrideNumber = (overrides, key, fallback) => {
    const raw = overrides?.[key];
    if (raw === undefined || raw === null || raw === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };

  const getVatReturnInputValue = (key, fallbackNumber) => {
    const overrides = previewData?.vatReturnOverrides || {};
    const raw = overrides[key];
    if (raw === undefined || raw === null || raw === "") {
      if (!Number.isFinite(fallbackNumber)) return "";
      return fallbackNumber.toFixed(2);
    }
    return String(raw);
  };

  const getVatReturnChoiceValue = (key) => {
    const raw = previewData?.vatReturnOverrides?.[key];
    return raw === "yes" || raw === "no" ? raw : "";
  };

  const isRTL = (text) =>
    /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0590-\u05FF\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(
      String(text ?? "")
    );

  // Defensive utilities
  const lower = (s) =>
    String(s || "")
      .trim()
      .toLowerCase();
  const isSalesType = (r) => lower(r?.TYPE).startsWith("sale");
  const isPurchType = (r) => lower(r?.TYPE).startsWith("purchas");

  // ===== Column orders (match server) =====
  const UAE_SALES_ORDER = [
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
  const UAE_PURCHASE_ORDER = [
    "DATE",
    "INVOICE NUMBER",
    "INVOICE CATEGORY",
    "SUPPLIER/VENDOR",
    "PARTY",
    "SUPPLIER TRN",
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
    "VAT ELIGIBILTY",
    "CONFIDENCE",
    "SOURCE",
  ];
  const UAE_PLACE_OF_SUPPLY_ORDER = [
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
  const VAT_ELIGIBILITY_OPTIONS = [
    "Not qualified for Vat Return Filing",
    "Already accounted in relevant Vat Return Filing",
    "Will be considered in next quarter Vat Return Filing",
  ];

  // Sum helper (same logic as backend)
  const sumAmount = (rows, key) =>
    (rows || []).reduce((s, r) => s + (Number(r?.[key]) || 0), 0);

  // ===== Bank table =====
  const bankData = useMemo(() => {
    const b = previewData?.bankData || { columns: [], rows: [] };
    const colsAll = normalizeCols(b.columns);
    return {
      columns: filterHidden(colsAll),
      rows: Array.isArray(b.rows) ? b.rows : [],
    };
  }, [previewData]);

  // ===== Strict buckets without row dropping =====
  const { salesRows, purchaseRows, othersRowsView, placeOfSupplyRowsView } = useMemo(() => {
    const inv = previewData?.invoiceData || {};

    // Consider buckets "explicit" if any bucket key exists OR flag is set
    const hasSalesKey = Object.prototype.hasOwnProperty.call(
      inv,
      "uaeSalesRows"
    );
    const hasPurchKey = Object.prototype.hasOwnProperty.call(
      inv,
      "uaePurchaseRows"
    );
    const hasOthersKey =
      Object.prototype.hasOwnProperty.call(inv, "othersRows") ||
      Object.prototype.hasOwnProperty.call(inv, "uaeOtherRows");
    const hasPlaceOfSupplyKey = Object.prototype.hasOwnProperty.call(inv, "placeOfSupplyRows");
    const explicit =
      !!inv.__explicitBuckets || hasSalesKey || hasPurchKey || hasOthersKey || hasPlaceOfSupplyKey;

    // Start with explicit arrays (or empty)
    const confidenceScore = (row) => {
      const n = Number(String(row?.CONFIDENCE ?? "").replace(/%/g, ""));
      return Number.isFinite(n) ? n : -1;
    };
    const dedupeRows = (rows = []) => {
      const byKey = new Map();
      rows.forEach((row) => {
        if (!row || typeof row !== "object") return;
        const key = getInvoiceRowMatchKey(row);
        if (!byKey.has(key)) {
          byKey.set(key, row);
          return;
        }
        const prev = byKey.get(key);
        if (confidenceScore(row) > confidenceScore(prev)) {
          byKey.set(key, row);
        }
      });
      return Array.from(byKey.values());
    };
    let sales = dedupeRows(Array.isArray(inv.uaeSalesRows) ? inv.uaeSalesRows : []);
    let purch = dedupeRows(
      Array.isArray(inv.uaePurchaseRows) ? inv.uaePurchaseRows : []
    );
    let others = dedupeRows([
      ...(Array.isArray(inv.othersRows) ? inv.othersRows : []),
      ...(Array.isArray(inv.uaeOtherRows) ? inv.uaeOtherRows : []),
    ]);

    // Keep Place of Supply derived from the live source buckets so edits stay in sync.
    const posCombined = [...sales, ...purch, ...others];

    return {
      salesRows: dedupeRows(sales),
      purchaseRows: dedupeRows(purch),
      othersRowsView: dedupeRows(others),
      placeOfSupplyRowsView: dedupeRows(posCombined),
    };
  }, [previewData]);

  const normalizedInvoiceData = useMemo(() => {
    const inv = previewData?.invoiceData || {};
    return {
      ...inv,
      uaeSalesRows: Array.isArray(salesRows) ? salesRows : [],
      uaePurchaseRows: Array.isArray(purchaseRows) ? purchaseRows : [],
      othersRows: Array.isArray(othersRowsView) ? othersRowsView : [],
      uaeOtherRows: Array.isArray(othersRowsView) ? othersRowsView : [],
      placeOfSupplyRows: Array.isArray(placeOfSupplyRowsView) ? placeOfSupplyRowsView : [],
      __explicitBuckets: true,
    };
  }, [previewData?.invoiceData, salesRows, purchaseRows, othersRowsView, placeOfSupplyRowsView]);

  // ===== Totals (same formula as backend generateCombinedExcel) =====
  const computedSales = useMemo(() => {
    const rows = salesRows || [];
    return {
      beforeTax: sumAmount(rows, "BEFORE TAX (AED)"),
      vat: sumAmount(rows, "VAT (AED)"),
      zero: sumAmount(rows, "ZERO RATED (AED)"),
      net: sumAmount(rows, "NET AMOUNT (AED)"),
    };
  }, [salesRows]);

  const computedPurchase = useMemo(() => {
    const rows = purchaseRows || [];
    return {
      beforeTax: sumAmount(rows, "BEFORE TAX (AED)"),
      vat: sumAmount(rows, "VAT (AED)"),
      zero: sumAmount(rows, "ZERO RATED (AED)"),
      net: sumAmount(rows, "NET AMOUNT (AED)"),
    };
  }, [purchaseRows]);

  useEffect(() => {
    if (!previewData || !previewData.bankData) return;

    setPreviewData((prev) => {
      if (!prev || !prev.bankData) return prev;
      // If we already have recon data, don't overwrite user edits
      if (prev.bankReconData && Array.isArray(prev.bankReconData.rows)) {
        return prev;
      }

      const built = buildBankReconciliationDisplay(
        prev.bankData,
        salesRows,
        purchaseRows
      );

      return {
        ...prev,
        bankReconData: built,
      };
    });
  }, [previewData, salesRows, purchaseRows]);

  // ===== Build display data from the final rows =====
  const salesData = useMemo(() => {
    const rows = (salesRows || []).map((r) => {
      const out = {};
      UAE_SALES_ORDER.forEach((k) => (out[k] = r?.[k] ?? null));

      // ✅ keep source meta for preview
      out.SOURCE_URL = r?.SOURCE_URL ?? r?.source_url ?? null;
      out.SOURCE_TYPE = r?.SOURCE_TYPE ?? r?.source_type ?? null;

      return out;
    });

    return {
      columns: UAE_SALES_ORDER.map((k) => ({ key: k, label: k })),
      rows,
    };
  }, [salesRows]);

  const purchaseData = useMemo(() => {
    const rows = (purchaseRows || []).map((r) => {
      const out = {};
      UAE_PURCHASE_ORDER.forEach((k) => (out[k] = r?.[k] ?? null));

      // ✅ keep source meta for preview
      out.SOURCE_URL = r?.SOURCE_URL ?? r?.source_url ?? null;
      out.SOURCE_TYPE = r?.SOURCE_TYPE ?? r?.source_type ?? null;

      return out;
    });

    return {
      columns: UAE_PURCHASE_ORDER.map((k) => ({ key: k, label: k })),
      rows,
    };
  }, [purchaseRows]);

  const othersData = useMemo(() => {
    const rows = othersRowsView || [];
    const keys = rows.length ? Object.keys(rows[0]) : [];
    const baseOrder = UAE_OTHERS_ORDER.filter(
      (k) =>
        String(k).toUpperCase() !== "SOURCE_URL" &&
        String(k).toUpperCase() !== "SOURCE_TYPE"
    );
    const extraKeys = keys.filter(
      (k) =>
        !baseOrder.includes(k) &&
        String(k).toUpperCase() !== "SOURCE_URL" &&
        String(k).toUpperCase() !== "SOURCE_TYPE"
    );
    const orderedKeys = baseOrder.concat(extraKeys);
    const columns = orderedKeys.map((k) => ({
      key: k,
      label: k,
    }));

    return {
      rows,
      columns: columns.length ? columns : [{ key: "NoData", label: "No Data" }],
    };
  }, [othersRowsView]);

  const placeOfSupplyData = useMemo(() => {
    const rows = (placeOfSupplyRowsView || []).map((r) => {
      const out = {};
      UAE_PLACE_OF_SUPPLY_ORDER.forEach((k) => (out[k] = r?.[k] ?? null));

      // ✅ keep source meta for preview
      out.SOURCE_URL = r?.SOURCE_URL ?? r?.source_url ?? null;
      out.SOURCE_TYPE = r?.SOURCE_TYPE ?? r?.source_type ?? null;

      return out;
    });

    return {
      columns: UAE_PLACE_OF_SUPPLY_ORDER.map((k) => ({ key: k, label: k })),
      rows,
    };
  }, [placeOfSupplyRowsView]);

  const bankReconData = useMemo(() => {
    const b = previewData?.bankReconData || { columns: [], rows: [] };
    const colsAll = normalizeCols(b.columns);
    return {
      columns: filterHidden(colsAll),
      rows: Array.isArray(b.rows) ? b.rows : [],
    };
  }, [previewData]);

  // ===== NEW: Sales Total / Purchase Total tables (UI version of Excel sheets) =====
  const salesTotalData = useMemo(() => {
    const cols = [
      { key: "METRIC", label: "Metric" },
      { key: "AMOUNT", label: "Amount (AED)" },
    ];
    const rows = previewData?.salesTotal || [];
    return { columns: cols, rows };
  }, [previewData]);

  const purchaseTotalData = useMemo(() => {
    const cols = [
      { key: "METRIC", label: "Metric" },
      { key: "AMOUNT", label: "Amount (AED)" },
    ];
    const rows = previewData?.purchaseTotal || [];
    return { columns: cols, rows };
  }, [previewData]);

  const vatSummaryData = useMemo(() => {
    const cols = [
      { key: "PARTICULAR", label: "Particular" },
      { key: "SALES", label: "Sales (AED)" },
      { key: "PURCHASES", label: "Purchases (AED)" },
      { key: "NET_VAT", label: "Net VAT (AED)" },
    ];
    const rows = previewData?.vatSummary || [];
    return { columns: cols, rows };
  }, [previewData]);

  // ===== VAT SUMMARY base values (source-of-truth for VAT Return defaults) =====
  const vatSummaryRows = previewData?.vatSummary || [];

  const baseStdSuppliesAmount = getVatSummaryCellNum(
    vatSummaryRows,
    "STANDARDRATEDSUPPLIES/EXPENSES",
    "SALES"
  );

  const baseOutputTaxAmount = getVatSummaryCellNum(
    vatSummaryRows,
    "OUTPUTTAX",
    "SALES"
  );

  const baseZeroRatedAmount = getVatSummaryCellNum(
    vatSummaryRows,
    "ZERORATEDSUPPLIES",
    "SALES"
  );

  const baseExemptAmount = getVatSummaryCellNum(
    vatSummaryRows,
    "EXEMPTEDSUPPLIES",
    "SALES"
  );

  const baseStdExpensesAmount = getVatSummaryCellNum(
    vatSummaryRows,
    "STANDARDRATEDSUPPLIES/EXPENSES",
    "PURCHASES"
  );

  const baseInputTaxAmount = getVatSummaryCellNum(
    vatSummaryRows,
    "INPUTTAX",
    "PURCHASES"
  );
  // ===== VAT Return numbers (from SalesTotal & PurchaseTotal) =====
  const vatReturnData = useMemo(() => {
    const overrides = previewData?.vatReturnOverrides || {};

    const readNum = (key, fallback) =>
      getVatReturnOverrideNumber(overrides, key, fallback);

    // ===== Apply overrides on top of VAT SUMMARY base values =====

    // Outputs (VAT on sales & outputs)
    const standardAmount = readNum("outputs.standard.amount", baseStdSuppliesAmount);
    const standardVat = readNum("outputs.standard.vat", baseOutputTaxAmount);
    const standardTotal = standardAmount + standardVat;
    const standardAdjustment = readNum("outputs.standard.adjustment", 0);

    const reverseSupAmount = readNum("outputs.reverseCharge.amount", 0);
    const reverseSupVat = readNum("outputs.reverseCharge.vat", 0);
    const reverseSupTotal = reverseSupAmount + reverseSupVat;
    const reverseSupAdjustment = readNum("outputs.reverseCharge.adjustment", 0);

    const zeroAmount = readNum("outputs.zeroRated.amount", baseZeroRatedAmount);
    const zeroVat = readNum("outputs.zeroRated.vat", 0);
    const zeroTotal = zeroAmount + zeroVat;
    const zeroAdjustment = readNum("outputs.zeroRated.adjustment", 0);

    const exemptAmount = readNum("outputs.exempt.amount", 0);
    const exemptVat = readNum("outputs.exempt.vat", 0);
    const exemptTotal = exemptAmount + exemptVat;
    const exemptAdjustment = readNum("outputs.exempt.adjustment", 0);

    const goodsAmount = readNum("outputs.goodsImport.amount", 0);
    const goodsVat = readNum("outputs.goodsImport.vat", 0);
    const goodsTotal = goodsAmount + goodsVat;
    const goodsAdjustment = readNum("outputs.goodsImport.adjustment", 0);

    const outputs = {
      standard: {
        amount: standardAmount,
        vat: standardVat,
        total: standardTotal,
        adjustment: standardAdjustment,
      },
      reverseCharge: {
        amount: reverseSupAmount,
        vat: reverseSupVat,
        total: reverseSupTotal,
        adjustment: reverseSupAdjustment,
      },
      zeroRated: {
        amount: zeroAmount,
        vat: zeroVat,
        total: zeroTotal,
        adjustment: zeroAdjustment,
      },
      exempt: {
        amount: exemptAmount,
        vat: exemptVat,
        total: exemptTotal,
        adjustment: exemptAdjustment,
      },
      goodsImport: {
        amount: goodsAmount,
        vat: goodsVat,
        total: goodsTotal,
        adjustment: goodsAdjustment,
      },
    };

    const outputsTotals = {
      amount:
        outputs.standard.amount +
        outputs.reverseCharge.amount +
        outputs.zeroRated.amount +
        outputs.exempt.amount +
        outputs.goodsImport.amount,
      vat:
        outputs.standard.vat +
        outputs.reverseCharge.vat +
        outputs.zeroRated.vat +
        outputs.exempt.vat +
        outputs.goodsImport.vat,
      adjustment: readNum("outputs.total.adjustment", 0),
    };
    outputsTotals.total = outputsTotals.amount + outputsTotals.vat;

    // Inputs (VAT on expenses & inputs)
    const stdExpAmount = readNum("inputs.standard.amount", baseStdExpensesAmount);
    const stdExpVat = readNum("inputs.standard.vat", baseInputTaxAmount);
    const stdExpTotal = stdExpAmount + stdExpVat;
    const stdExpAdjustment = readNum("inputs.standard.adjustment", 0);

    const revExpAmount = readNum("inputs.reverseCharge.amount", 0);
    const revExpVat = readNum("inputs.reverseCharge.vat", 0);
    const revExpTotal = revExpAmount + revExpVat;
    const revExpAdjustment = readNum("inputs.reverseCharge.adjustment", 0);

    const inputs = {
      standard: {
        amount: stdExpAmount,
        vat: stdExpVat,
        total: stdExpTotal,
        adjustment: stdExpAdjustment,
      },
      reverseCharge: {
        amount: revExpAmount,
        vat: revExpVat,
        total: revExpTotal,
        adjustment: revExpAdjustment,
      },
    };

    const inputsTotals = {
      amount: inputs.standard.amount + inputs.reverseCharge.amount,
      vat: inputs.standard.vat + inputs.reverseCharge.vat,
      adjustment: readNum("inputs.total.adjustment", 0),
    };
    inputsTotals.total = inputsTotals.amount + inputsTotals.vat;

    // NET VAT
    const totalDueTax = outputsTotals.vat;
    const totalRecoverableTax = inputsTotals.vat;
    const vatPayableForPeriod = totalDueTax - totalRecoverableTax;

    const ftaFundNum = readNum("ftaFund", 0);
    const netVatPayableAfterFund = vatPayableForPeriod - ftaFundNum;
    const totalDueTaxAdjustment = readNum("net.totalDueTax.adjustment", 0);
    const totalRecoverableTaxAdjustment = readNum(
      "net.totalRecoverableTax.adjustment",
      0
    );
    const vatPayableForPeriodAdjustment = readNum("net.vatPayable.adjustment", 0);
    const ftaFundAdjustment = readNum("ftaFund.adjustment", 0);
    const netVatPayableAfterFundAdjustment = readNum(
      "net.afterFund.adjustment",
      0
    );
    const refundRequestAdjustment = readNum("refundRequest.adjustment", 0);
    const profitMarginSchemeAdjustment = readNum(
      "profitMarginScheme.adjustment",
      0
    );

    return {
      outputs,
      outputsTotals,
      inputs,
      inputsTotals,
      totalDueTax,
      totalRecoverableTax,
      vatPayableForPeriod,
      ftaFund: ftaFundNum,
      netVatPayableAfterFund,
      totalDueTaxAdjustment,
      totalRecoverableTaxAdjustment,
      vatPayableForPeriodAdjustment,
      ftaFundAdjustment,
      netVatPayableAfterFundAdjustment,
      refundRequestAdjustment,
      profitMarginSchemeAdjustment,
    };
  }, [
    previewData?.vatReturnOverrides,
    baseStdSuppliesAmount,
    baseOutputTaxAmount,
    baseZeroRatedAmount,
    baseExemptAmount,
    baseStdExpensesAmount,
    baseInputTaxAmount,
  ]);

  const ftaFundInputValue = (() => {
    const raw = previewData?.vatReturnOverrides?.ftaFund;

    // if user already touched it (even ""), show exactly what they typed
    if (raw !== undefined) return String(raw);

    // not touched yet → show default 0.00 (from calculated ftaFund)
    const fallback = vatReturnData?.ftaFund ?? 0;
    return Number(fallback).toFixed(2);
  })();

  useEffect(() => {
    if (view === "bank" && !tabVisibility.bank) {
      setView("sales");
      return;
    }
    if (view === "bankRecon" && !tabVisibility.bankRecon) {
      setView("sales");
    }
  }, [tabVisibility, view]);

  const normalizeMetricKey = (s) =>
    String(s || "")
      .replace(/[\s_]/g, "")
      .toUpperCase();

  useEffect(() => {
    setPreviewData((prev) => {
      if (!prev) return prev;

      let next = { ...prev };
      let changed = false;

      const salesLocks = metricLocks.salesTotal || {};
      const purchaseLocks = metricLocks.purchaseTotal || {};

      const isMetricLocked = (sectionLocks, metricName) =>
        !!sectionLocks[metricKey(metricName)];

      // ---------- SALES TOTAL ----------
      let salesTotalRows = Array.isArray(next.salesTotal)
        ? [...next.salesTotal]
        : [];

      // Standard from sales rows unless locked
      if (!isMetricLocked(salesLocks, "STANDARDRATEDSUPPLIES")) {
        const newRows = setMetricAmount(
          salesTotalRows,
          "STANDARDRATEDSUPPLIES",
          computedSales.beforeTax
        );
        changed =
          changed || JSON.stringify(newRows) !== JSON.stringify(salesTotalRows);
        salesTotalRows = newRows;
      }

      if (!isMetricLocked(salesLocks, "OUTPUTTAX")) {
        const newRows = setMetricAmount(
          salesTotalRows,
          "OUTPUTTAX",
          computedSales.vat
        );
        changed =
          changed || JSON.stringify(newRows) !== JSON.stringify(salesTotalRows);
        salesTotalRows = newRows;
      }

      if (!isMetricLocked(salesLocks, "ZERORATEDSUPPLIES")) {
        const newRows = setMetricAmount(
          salesTotalRows,
          "ZERORATEDSUPPLIES",
          computedSales.zero
        );
        changed =
          changed || JSON.stringify(newRows) !== JSON.stringify(salesTotalRows);
        salesTotalRows = newRows;
      }

      // Exempt is editable: only set default if missing and not locked
      if (!isMetricLocked(salesLocks, "EXEMPTEDSUPPLIES")) {
        const newRows = setMetricAmount(salesTotalRows, "EXEMPTEDSUPPLIES", 0);
        changed =
          changed || JSON.stringify(newRows) !== JSON.stringify(salesTotalRows);
        salesTotalRows = newRows;
      }

      // TOTAL always computed from *current* SalesTotal values
      const effStdSales = findMetricAmount(
        salesTotalRows,
        "STANDARDRATEDSUPPLIES"
      );
      const effOutTax = findMetricAmount(salesTotalRows, "OUTPUTTAX");
      const salesTotalIncVat = effStdSales + effOutTax;

      const rowsWithSalesTotal = setMetricAmount(
        salesTotalRows,
        "TOTALAMOUNTINCLUDINGVAT",
        salesTotalIncVat
      );
      changed =
        changed ||
        JSON.stringify(rowsWithSalesTotal) !== JSON.stringify(salesTotalRows);
      salesTotalRows = rowsWithSalesTotal;

      next.salesTotal = salesTotalRows;

      // ---------- PURCHASE TOTAL ----------
      let purchaseTotalRows = Array.isArray(next.purchaseTotal)
        ? [...next.purchaseTotal]
        : [];

      if (!isMetricLocked(purchaseLocks, "STANDARDRATEDEXPENSES")) {
        const newRows = setMetricAmount(
          purchaseTotalRows,
          "STANDARDRATEDEXPENSES",
          computedPurchase.beforeTax
        );
        changed =
          changed ||
          JSON.stringify(newRows) !== JSON.stringify(purchaseTotalRows);
        purchaseTotalRows = newRows;
      }

      if (!isMetricLocked(purchaseLocks, "INPUTTAX")) {
        const newRows = setMetricAmount(
          purchaseTotalRows,
          "INPUTTAX",
          computedPurchase.vat
        );
        changed =
          changed ||
          JSON.stringify(newRows) !== JSON.stringify(purchaseTotalRows);
        purchaseTotalRows = newRows;
      }

      if (!isMetricLocked(purchaseLocks, "ZERORATEDEXPENSES")) {
        const newRows = setMetricAmount(
          purchaseTotalRows,
          "ZERORATEDEXPENSES",
          computedPurchase.zero
        );
        changed =
          changed ||
          JSON.stringify(newRows) !== JSON.stringify(purchaseTotalRows);
        purchaseTotalRows = newRows;
      }

      if (!isMetricLocked(purchaseLocks, "EXEMPTEDEXPENSES")) {
        const newRows = setMetricAmount(
          purchaseTotalRows,
          "EXEMPTEDEXPENSES",
          0
        );
        changed =
          changed ||
          JSON.stringify(newRows) !== JSON.stringify(purchaseTotalRows);
        purchaseTotalRows = newRows;
      }

      const effStdPurch = findMetricAmount(
        purchaseTotalRows,
        "STANDARDRATEDEXPENSES"
      );
      const effInputTax = findMetricAmount(purchaseTotalRows, "INPUTTAX");
      const purchTotalIncVat = effStdPurch + effInputTax;

      const rowsWithPurchTotal = setMetricAmount(
        purchaseTotalRows,
        "TOTALAMOUNTINCLUDINGVAT",
        purchTotalIncVat
      );
      changed =
        changed ||
        JSON.stringify(rowsWithPurchTotal) !==
        JSON.stringify(purchaseTotalRows);
      purchaseTotalRows = rowsWithPurchTotal;

      next.purchaseTotal = purchaseTotalRows;

      // ---------- VAT SUMMARY ----------
      let vatSummaryRows = Array.isArray(next.vatSummary)
        ? [...next.vatSummary]
        : [];

      // Push totals into VAT summary ONLY if VAT summary cells not locked
      const setIfNotLocked = (particular, colKey, value) => {
        const lockKey = makeVatSummaryLockKey(particular, colKey);
        if (vatSummaryLocks[lockKey]) return;

        const fixed = Number(value || 0).toFixed(2);
        const before = JSON.stringify(vatSummaryRows);
        vatSummaryRows = setVatSummaryCell(
          vatSummaryRows,
          particular,
          colKey,
          fixed
        );
        const after = JSON.stringify(vatSummaryRows);
        if (before !== after) changed = true;
      };

      // STANDARD RATED SUPPLIES/EXPENSES
      setIfNotLocked("STANDARDRATEDSUPPLIES/EXPENSES", "SALES", effStdSales);
      setIfNotLocked(
        "STANDARDRATEDSUPPLIES/EXPENSES",
        "PURCHASES",
        effStdPurch
      );

      // OUTPUTTAX from SalesTotal
      setIfNotLocked("OUTPUTTAX", "SALES", effOutTax);

      // INPUTTAX from PurchaseTotal
      setIfNotLocked("INPUTTAX", "PURCHASES", effInputTax);

      // ZERO & EXEMPT
      const effZeroSales = findMetricAmount(
        salesTotalRows,
        "ZERORATEDSUPPLIES"
      );
      const effZeroPurch = findMetricAmount(
        purchaseTotalRows,
        "ZERORATEDEXPENSES"
      );
      setIfNotLocked("ZERORATEDSUPPLIES", "SALES", effZeroSales);
      setIfNotLocked("ZERORATEDSUPPLIES", "PURCHASES", effZeroPurch);

      setIfNotLocked("EXEMPTEDSUPPLIES", "SALES", 0);
      setIfNotLocked("EXEMPTEDSUPPLIES", "PURCHASES", 0);

      // 4) Others (read-only for now)
      // 4) Others (read-only for now)
      if (view === "others") {
        return prev;
      }

      // 5) Sales Total / Purchase Total / VAT Summary (NOT editable now)

      // ✅ TOTALAMOUNTINCLUDINGVAT must be computed from VAT SUMMARY CURRENT VALUES (not totals)
      const vsStdSales = getVatSummaryCellNum(
        vatSummaryRows,
        "STANDARDRATEDSUPPLIES/EXPENSES",
        "SALES"
      );

      const vsStdPurch = getVatSummaryCellNum(
        vatSummaryRows,
        "STANDARDRATEDSUPPLIES/EXPENSES",
        "PURCHASES"
      );
      const vsOutput = getVatSummaryCellNum(
        vatSummaryRows,
        "OUTPUTTAX",
        "SALES"
      );
      const vsInput = getVatSummaryCellNum(
        vatSummaryRows,
        "INPUTTAX",
        "PURCHASES"
      );

      // Always overwrite total (read-only in UI)
      {
        const fixedSales = Number(vsStdSales + vsOutput).toFixed(2);
        const fixedPurch = Number(vsStdPurch + vsInput).toFixed(2);

        const before = JSON.stringify(vatSummaryRows);
        vatSummaryRows = setVatSummaryCell(
          vatSummaryRows,
          "TOTALAMOUNTINCLUDINGVAT",
          "SALES",
          fixedSales
        );
        vatSummaryRows = setVatSummaryCell(
          vatSummaryRows,
          "TOTALAMOUNTINCLUDINGVAT",
          "PURCHASES",
          fixedPurch
        );
        const after = JSON.stringify(vatSummaryRows);
        if (before !== after) changed = true;
      }

      // ✅ NET VAT PAYABLE FOR THE PERIOD must be computed from VAT SUMMARY CURRENT VALUES
      {
        const netVat = vsOutput - vsInput;
        const fixedNet = Number(netVat).toFixed(2);

        const before = JSON.stringify(vatSummaryRows);
        vatSummaryRows = setVatSummaryCell(
          vatSummaryRows,
          "NETVATPAYABLEFORTHEPERIOD",
          "NET_VAT",
          fixedNet
        );
        const after = JSON.stringify(vatSummaryRows);
        if (before !== after) changed = true;
      }

      next.vatSummary = vatSummaryRows;

      return changed ? next : prev;
    });
  }, [computedSales, computedPurchase, metricLocks, vatSummaryLocks]);

  // Decide which table to show based on `view`
  const current = useMemo(() => {
    switch (view) {
      case "bank":
        return bankData;
      case "bankRecon":
        return bankReconData;
      case "sales":
        return salesData;
      case "purchase":
        return purchaseData;
      case "salesTotal":
        return salesTotalData;
      case "purchaseTotal":
        return purchaseTotalData;
      case "vatSummary":
        return vatSummaryData;
      case "others":
        return othersData;
      case "placeOfSupply":
        return placeOfSupplyData;
      default:
        return bankData;
    }
  }, [
    view,
    bankData,
    bankReconData,
    salesData,
    purchaseData,
    salesTotalData,
    purchaseTotalData,
    vatSummaryData,
    othersData,
    placeOfSupplyData,
  ]);

  useEffect(() => {
    if (view === "vatReturn") {
      setSelectedRecord(null);
      setActiveDocumentId(null);
      return;
    }

    const rows = Array.isArray(current?.rows) ? current.rows : [];
    if (!rows.length) {
      setSelectedRecord(null);
      setActiveDocumentId(null);
      return;
    }

    const currentIndex =
      selectedRecord && selectedRecord.view === view ? selectedRecord.rowIndex : -1;

    if (currentIndex >= 0 && currentIndex < rows.length) {
      return;
    }

    const firstRowWithDocument = rows.findIndex(
      (row) => buildRowDocuments(row, view).length > 0
    );

    if (firstRowWithDocument >= 0) {
      setSelectedRecord({ view, rowIndex: firstRowWithDocument });
    } else {
      setSelectedRecord(null);
      setActiveDocumentId(null);
    }
  }, [current, selectedRecord, view]);

  const selectedRow =
    selectedRecord &&
    selectedRecord.view === view &&
    Array.isArray(current?.rows) &&
    selectedRecord.rowIndex >= 0 &&
    selectedRecord.rowIndex < current.rows.length
      ? current.rows[selectedRecord.rowIndex]
      : null;

  const contextualDocuments = useMemo(
    () => buildRowDocuments(selectedRow, view),
    [selectedRow, view]
  );

  useEffect(() => {
    if (!contextualDocuments.length) {
      if (activeDocumentId !== null) setActiveDocumentId(null);
      return;
    }
    if (!contextualDocuments.some((doc) => doc.id === activeDocumentId)) {
      setActiveDocumentId(contextualDocuments[0].id);
    }
  }, [activeDocumentId, contextualDocuments]);

  useEffect(() => {
    const syncVisibleColumns = (viewName, columns) => {
      if (!COLUMN_FILTER_VIEWS.has(viewName)) return;
      const availableKeys = (columns || []).map((col) => String(col.key));

      setVisibleColumnKeysByView((prev) => {
        const currentKeys = Array.isArray(prev[viewName]) ? prev[viewName] : [];
        const normalizedCurrentKeys = currentKeys.filter((key) =>
          availableKeys.includes(String(key))
        );
        const nextKeys =
          normalizedCurrentKeys.length === 0
            ? availableKeys
            : [
                ...normalizedCurrentKeys,
                ...availableKeys.filter(
                  (key) => !normalizedCurrentKeys.includes(key)
                ),
              ];

        if (
          nextKeys.length === currentKeys.length &&
          nextKeys.every((key, index) => key === currentKeys[index])
        ) {
          return prev;
        }

        return {
          ...prev,
          [viewName]: nextKeys,
        };
      });
    };

    syncVisibleColumns("sales", salesData.columns);
    syncVisibleColumns("purchase", purchaseData.columns);
    syncVisibleColumns("others", othersData.columns);
  }, [othersData.columns, purchaseData.columns, salesData.columns]);

  useEffect(() => {
    if (!openColumnFilterView) return;

    const handleDocumentClick = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (columnFilterRef.current?.contains(target)) return;
      setOpenColumnFilterView(null);
    };

    document.addEventListener("click", handleDocumentClick);
    return () => document.removeEventListener("click", handleDocumentClick);
  }, [openColumnFilterView]);

  const activeDocument =
    contextualDocuments.find((doc) => doc.id === activeDocumentId) ||
    contextualDocuments[0] ||
    null;

  useEffect(() => {
    if (!isEditMode) return;

    const handleOutsideClick = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      if (editablePaneRef.current?.contains(target)) return;
      if (target.closest(".invoice-preview-overlay")) return;
      if (target.closest(".result-card-footer")) return;

      exitEditMode();
    };

    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, [exitEditMode, isEditMode]);

  // ===== Table renderer =====
  const renderTable = (
    cols,
    rows,
    emptyText = "No rows to display",
    viewName = ""
  ) => {
    const supportsColumnFilter = COLUMN_FILTER_VIEWS.has(viewName);
    const availableColumnKeys = cols.map((c) => String(c.key));
    const selectedColumnKeys = supportsColumnFilter
      ? visibleColumnKeysByView[viewName]?.filter((key) =>
          availableColumnKeys.includes(String(key))
        ) || []
      : availableColumnKeys;
    const resolvedColumnKeys =
      supportsColumnFilter && selectedColumnKeys.length
        ? selectedColumnKeys
        : availableColumnKeys;
    const filteredCols = supportsColumnFilter
      ? cols.filter((c) => resolvedColumnKeys.includes(String(c.key)))
      : cols;

    if (!cols.length) {
      return (
        <div className="muted" style={{ padding: 12 }}>
          {emptyText}
        </div>
      );
    }

    const scrollerClassName = [
      "tbl-scroller",
      viewName ? `tbl-scroller-${viewName}` : "",
    ]
      .join(" ")
      .trim();

    const tableClassName = ["tbl", "nice", viewName ? `tbl-${viewName}` : ""]
      .join(" ")
      .trim();

    const showActionColumn =
      ["sales", "purchase", "others", "salesTotal", "purchaseTotal", "vatSummary"].includes(viewName) ||
      (isEditMode && ["bank", "placeOfSupply"].includes(viewName));

    const showAddRowButton =
      isEditMode &&
      ["bank", "sales", "purchase", "others", "placeOfSupply"].includes(viewName);

    return (
      <div className="tbl-wrap">
        {(showAddRowButton || supportsColumnFilter) && (
          <div className="tbl-actions">
            {supportsColumnFilter && (
              <div className="column-filter" ref={openColumnFilterView === viewName ? columnFilterRef : null}>
                <button
                  type="button"
                  className="row-add-btn column-filter-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenColumnFilterView((prev) =>
                      prev === viewName ? null : viewName
                    );
                  }}
                >
                  Columns
                </button>
                {openColumnFilterView === viewName && (
                  <div
                    className="column-filter-menu"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {cols.map((col) => {
                      const colKey = String(col.key);
                      const isChecked = resolvedColumnKeys.includes(colKey);

                      return (
                        <label key={colKey} className="column-filter-option">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setVisibleColumnKeysByView((prev) => {
                                const previousKeys = Array.isArray(prev[viewName])
                                  ? prev[viewName].filter((key) =>
                                      availableColumnKeys.includes(String(key))
                                    )
                                  : availableColumnKeys;
                                const nextKeys = checked
                                  ? [
                                      ...previousKeys,
                                      ...(!previousKeys.includes(colKey)
                                        ? [colKey]
                                        : []),
                                    ]
                                  : previousKeys.filter((key) => key !== colKey);

                                return {
                                  ...prev,
                                  [viewName]: nextKeys,
                                };
                              });
                            }}
                          />
                          <span>{col.label ?? col.key}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {showAddRowButton && (
              <button
                type="button"
                className="row-add-btn"
                onClick={() => handleAddRow(viewName)}
              >
                Add Row
              </button>
            )}
          </div>
        )}
        {supportsColumnFilter && filteredCols.length === 0 ? (
          <div className="muted" style={{ padding: 12 }}>
            No columns selected.
          </div>
        ) : (
        <div className={scrollerClassName}>
          <table className={tableClassName}>
            <thead>
              <tr>
                {filteredCols.map((c) => {
                  const label = c.label ?? "";

                  const isNumericHeader =
                    /\(aed\)/i.test(label) ||
                    /\bamount\b/i.test(label) ||
                    /\bvat\b/i.test(label) ||
                    /\btax\b/i.test(label) ||
                    /\btotal\b/i.test(label) ||
                    /\bnet\b/i.test(label) ||
                    /\bdebit\b/i.test(label) ||
                    /\bcredit\b/i.test(label) ||
                    /\bbalance\b/i.test(label);

                  const thCls = [
                    "no-wrap-header",
                    isNumericHeader ? "num num-header" : "",
                  ]
                    .join(" ")
                    .trim();

                  return (
                    <th key={c.key} className={thCls} title={label}>
                      {label}
                    </th>
                  );
                })}
                {showActionColumn && <th className="actions-col">Action</th>}
              </tr>
            </thead>

            <tbody>
              {!rows || rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={filteredCols.length + (showActionColumn ? 1 : 0)}
                    className="muted"
                    style={{ textAlign: "center", padding: 18 }}
                  >
                    {emptyText}
                  </td>
                </tr>
              ) : (
                rows.map((row, rowIndex) => (
                  <tr
                    key={rowIndex}
                    className={
                      selectedRecord?.view === viewName &&
                      selectedRecord?.rowIndex === rowIndex
                        ? "row-selected"
                        : ""
                    }
                    onClick={() => setSelectedRecord({ view: viewName, rowIndex })}
                  >
                    {filteredCols.map((c) => {
                      const val = row?.[c.key] ?? "";
                      const isDateCol = String(c.key).toUpperCase().includes("DATE");
                      const formattedDate = isDateCol ? formatDateDisplay(val) : null;
                      const text = isDateCol ? formattedDate : String(val ?? "");

                      // ✅ NEW: SOURCE column => open preview (pdf/image) using setPreview
                      if (c.key === "SOURCE") {
                        const label = val ?? "";
                        const rawUrl = row.SOURCE_URL || row.source_url || null;
                        const srcUrl = resolvePreviewUrl(rawUrl);
                        const srcType = inferPreviewType(
                          row.SOURCE_TYPE || row.source_type,
                          rawUrl
                        );

                        return (
                          <td key={c.key} title={String(label ?? "")}>
                            {srcUrl ? (
                              <button
                                type="button"
                                className="src-link"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedRecord({ view: viewName, rowIndex });
                                  setPreview({
                                    url: srcUrl,
                                    type: srcType,
                                    label,
                                  });
                                }}
                              >
                                {label}
                              </button>
                            ) : (
                              label
                            )}
                          </td>
                        );
                      }

                      const cls = [
                        isNumeric(text) ? "num" : "",
                        isRTL(text) ? "rtl" : "",
                      ]
                        .join(" ")
                        .trim();

                      const title =
                        c.key === "CONFIDENCE" && typeof val === "number"
                          ? `${val}%`
                          : text;

                      const isMetricRowEditing =
                        isEditMode &&
                        ["salesTotal", "purchaseTotal", "vatSummary"].includes(viewName) &&
                        selectedRecord?.view === viewName &&
                        selectedRecord?.rowIndex === rowIndex;

                      let editable = isCellEditable(viewName) || isMetricRowEditing;

                      if (
                        (viewName === "salesTotal" ||
                          viewName === "purchaseTotal") &&
                        metricKey(row?.METRIC) === "TOTALAMOUNTINCLUDINGVAT" &&
                        String(c.key).toUpperCase() === "AMOUNT"
                      ) {
                        editable = false;
                      }

                      // ✅ VAT SUMMARY: TOTALAMOUNTINCLUDINGVAT row should be read-only (auto)
                      if (
                        viewName === "vatSummary" &&
                        particularKey(row?.PARTICULAR) ===
                        "TOTALAMOUNTINCLUDINGVAT" &&
                        (String(c.key).toUpperCase() === "SALES" ||
                          String(c.key).toUpperCase() === "PURCHASES")
                      ) {
                        editable = false;
                      }

                      // ✅ NET VAT PAYABLE should always be calculated (read-only)
                      if (
                        viewName === "vatSummary" &&
                        normalizeParticularKey(row?.PARTICULAR) ===
                        "NETVATPAYABLEFORTHEPERIOD" &&
                        String(c.key).toUpperCase() === "NET_VAT"
                      ) {
                        editable = false;
                      }

                      return (
                        <td key={c.key} className={cls} title={title}>
                          {editable ? (
                            viewName === "others" &&
                              String(c.key).toUpperCase() === "VAT ELIGIBILTY" ? (
                              <select
                                className="inline-edit-input"
                                value={val ?? ""}
                                onChange={(e) =>
                                  handleCellChange(
                                    viewName,
                                    rowIndex,
                                    c.key,
                                    e.target.value
                                  )
                                }
                              >
                                <option value="">Select</option>
                                {VAT_ELIGIBILITY_OPTIONS.map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                className="inline-edit-input"
                                value={isDateCol ? formattedDate : (val ?? "")}
                                onChange={(e) =>
                                  handleCellChange(
                                    viewName,
                                    rowIndex,
                                    c.key,
                                    e.target.value
                                  )
                                }
                                onBlur={(e) => {
                                  // Only format these two columns for Sales/Purchase when leaving the field
                                  if (
                                    (viewName === "sales" ||
                                      viewName === "purchase") &&
                                    (c.key === "BEFORE TAX (AED)" ||
                                      c.key === "VAT (AED)")
                                  ) {
                                    const n = toNumberLoose(e.target.value);
                                    handleCellChange(
                                      viewName,
                                      rowIndex,
                                      c.key,
                                      n == null ? "" : fmt2(n)
                                    );
                                  }
                                }}
                              />
                            )
                          ) : viewName === "vatSummary" &&
                            String(c.key).toUpperCase() === "NET_VAT" ? (
                            formatAED(val)
                          ) : c.key === "CONFIDENCE" &&
                            typeof val === "number" ? (
                            `${val}%`
                          ) : (viewName === "salesTotal" ||
                            viewName === "purchaseTotal") &&
                            String(c.key).toUpperCase() === "AMOUNT" ? (
                            formatAED(val)
                          ) : (
                            text
                          )}
                        </td>
                      );
                    })}
                    {showActionColumn && (
                      <td className="actions-col">
                        {["others", "sales", "purchase", "salesTotal", "purchaseTotal", "vatSummary"].includes(viewName) ? (
                          <select
                            className="inline-edit-input action-select"
                            value=""
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              e.stopPropagation();
                              if (viewName === "others") {
                                handleOthersRowAction(rowIndex, e.target.value);
                              } else if (
                                ["salesTotal", "purchaseTotal", "vatSummary"].includes(viewName)
                              ) {
                                if (e.target.value === "edit") {
                                  handleMetricRowEdit(viewName, rowIndex);
                                }
                              } else {
                                handleSalesPurchaseRowAction(
                                  viewName,
                                  rowIndex,
                                  e.target.value
                                );
                              }
                            }}
                          >
                            <option value="">Actions</option>
                            <option value="edit">Edit</option>
                            {viewName === "others" ? (
                              <>
                                <option value="delete">Delete</option>
                                <option value="moveToSales">Move to Sales</option>
                                <option value="moveToPurchase">Move to Purchase</option>
                              </>
                            ) : ["salesTotal", "purchaseTotal", "vatSummary"].includes(viewName) ? null : (
                              <>
                                <option value="delete">Delete</option>
                                <option value="moveToOthers">Move to Others</option>
                              </>
                            )}
                          </select>
                        ) : (
                          <button
                            type="button"
                            className="row-delete-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteRow(viewName, rowIndex);
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>
    );
  };

  const renderVatReturnActionCell = (rowKey) => (
    <td className="actions-col">
      <select
        className="inline-edit-input action-select"
        value=""
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          e.stopPropagation();
          if (e.target.value === "edit") {
            handleVatReturnRowEdit(rowKey);
          }
        }}
      >
        <option value="">Actions</option>
        <option value="edit">Edit</option>
      </select>
    </td>
  );

  if (loading) {
    return (
      <div className="result-page">
        <div className="loading">Loading preview data...</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="result-page">
        <div className="error">{error}</div>
      </div>
    );
  }

  const renderVatReturn = () => {
    const {
      outputs,
      outputsTotals,
      inputs,
      inputsTotals,
      totalDueTax,
      totalRecoverableTax,
      vatPayableForPeriod,
      ftaFund,
      netVatPayableAfterFund,
      totalDueTaxAdjustment,
      totalRecoverableTaxAdjustment,
      vatPayableForPeriodAdjustment,
      ftaFundAdjustment,
      netVatPayableAfterFundAdjustment,
      refundRequestAdjustment,
      profitMarginSchemeAdjustment,
    } = vatReturnData;

    const isVatReturnRowEditing = (rowKey) =>
      isEditMode && view === "vatReturn" && vatReturnEditKey === rowKey;

    const renderVatReturnEditableCell = (rowKey, fieldKey, value) =>
      isVatReturnRowEditing(rowKey) ? (
        <input
          type="text"
          inputMode="decimal"
          className="inline-edit-input"
          value={getVatReturnInputValue(fieldKey, value)}
          onChange={(e) => handleVatReturnInputChange(fieldKey, e.target.value)}
          onBlur={(e) => {
            const n = parseReconAmount(e.target.value);
            handleVatReturnInputChange(fieldKey, n == null ? "" : n.toFixed(2));
          }}
        />
      ) : (
        formatAED(value)
      );

    const renderVatReturnAdjustmentCell = (
      rowKey,
      value = 0,
      { dashWhenZeroInView = false } = {}
    ) => {
      if (!isVatReturnRowEditing(rowKey) && dashWhenZeroInView && Number(value || 0) === 0) {
        return "-";
      }
      return renderVatReturnEditableCell(rowKey, `${rowKey}.adjustment`, value);
    };

    const renderVatReturnYesNoCell = (rowKey, fieldKey) => {
      const value = getVatReturnChoiceValue(fieldKey);
      return (
        <div className="vat-return-choice-group">
          <label className="vat-return-choice">
            <input
              type="radio"
              name={fieldKey}
              checked={value === "yes"}
              onChange={() => handleVatReturnInputChange(fieldKey, "yes")}
            />
            <span>Yes</span>
          </label>
          <label className="vat-return-choice">
            <input
              type="radio"
              name={fieldKey}
              checked={value === "no"}
              onChange={() => handleVatReturnInputChange(fieldKey, "no")}
            />
            <span>No</span>
          </label>
        </div>
      );
    };

    return (
      // ⬇️ use the same scroller class used by other tabs
      <div className="tbl-scroller tbl-scroller-vatReturn">
        <div className="vat-return-wrapper">
          {/* 1️⃣ VAT ON SALES & OUTPUTS */}
          <section className="vat-return-section">
            {/* <h3 className="vat-return-title">
            VAT ON SALES AND ALL OTHER OUTPUTS
          </h3> */}
            {/* ⬇️ also reuse table base classes */}
            <table className="tbl nice vat-return-table">
              <thead>
                <tr>
                  <th className="vat-return-col-label">
                    VAT ON SALES AND ALL OTHER OUTPUTS
                  </th>
                  <th>AMOUNT</th>
                  <th>VAT AMOUNT</th>
                  <th>TOTAL AMOUNT</th>
                  <th>ADJUSTMENT (AED)</th>
                  <th className="actions-col">Action</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>STANDARD RATED SUPPLIES</td>
                  <td>{renderVatReturnEditableCell("outputs.standard", "outputs.standard.amount", outputs.standard.amount)}</td>
                  <td>{renderVatReturnEditableCell("outputs.standard", "outputs.standard.vat", outputs.standard.vat)}</td>
                  <td>{formatAED(outputs.standard.total)}</td>
                  <td>{renderVatReturnAdjustmentCell("outputs.standard", outputs.standard.adjustment)}</td>
                  {renderVatReturnActionCell("outputs.standard")}
                </tr>
                <tr>
                  <td>Reverse Charge Provisions (Supplies)</td>
                  <td>{renderVatReturnEditableCell("outputs.reverseCharge", "outputs.reverseCharge.amount", outputs.reverseCharge.amount)}</td>
                  <td>{renderVatReturnEditableCell("outputs.reverseCharge", "outputs.reverseCharge.vat", outputs.reverseCharge.vat)}</td>
                  <td>{formatAED(outputs.reverseCharge.total)}</td>
                  <td>{renderVatReturnAdjustmentCell("outputs.reverseCharge", outputs.reverseCharge.adjustment)}</td>
                  {renderVatReturnActionCell("outputs.reverseCharge")}
                </tr>
                <tr>
                  <td>ZERO RATED SUPPLIES</td>
                  <td>{renderVatReturnEditableCell("outputs.zeroRated", "outputs.zeroRated.amount", outputs.zeroRated.amount)}</td>
                  <td>{renderVatReturnEditableCell("outputs.zeroRated", "outputs.zeroRated.vat", outputs.zeroRated.vat)}</td>
                  <td>{formatAED(outputs.zeroRated.total)}</td>
                  <td>{renderVatReturnAdjustmentCell("outputs.zeroRated", outputs.zeroRated.adjustment)}</td>
                  {renderVatReturnActionCell("outputs.zeroRated")}
                </tr>
                <tr>
                  <td>EXEMPTED SUPPLIES</td>
                  <td>{renderVatReturnEditableCell("outputs.exempt", "outputs.exempt.amount", outputs.exempt.amount)}</td>
                  <td>{renderVatReturnEditableCell("outputs.exempt", "outputs.exempt.vat", outputs.exempt.vat)}</td>
                  <td>{formatAED(outputs.exempt.total)}</td>
                  <td>{renderVatReturnAdjustmentCell("outputs.exempt", outputs.exempt.adjustment)}</td>
                  {renderVatReturnActionCell("outputs.exempt")}
                </tr>
                <tr>
                  <td>Goods imported into UAE</td>
                  <td>{renderVatReturnEditableCell("outputs.goodsImport", "outputs.goodsImport.amount", outputs.goodsImport.amount)}</td>
                  <td>{renderVatReturnEditableCell("outputs.goodsImport", "outputs.goodsImport.vat", outputs.goodsImport.vat)}</td>
                  <td>{formatAED(outputs.goodsImport.total)}</td>
                  <td>{renderVatReturnAdjustmentCell("outputs.goodsImport", outputs.goodsImport.adjustment)}</td>
                  {renderVatReturnActionCell("outputs.goodsImport")}
                </tr>
                <tr className="vat-return-total-row">
                  <td>TOTAL AMOUNT</td>
                  <td>{formatAED(outputsTotals.amount)}</td>
                  <td>{formatAED(outputsTotals.vat)}</td>
                  <td>{formatAED(outputsTotals.total)}</td>
                  <td>{renderVatReturnAdjustmentCell("outputs.total", outputsTotals.adjustment)}</td>
                  {renderVatReturnActionCell("outputs.total")}
                </tr>
              </tbody>
            </table>
          </section>

          {/* 2️⃣ VAT ON EXPENSES & INPUTS */}
          <section className="vat-return-section">
            {/* <h3 className="vat-return-title">
            VAT ON EXPENSES AND ALL OTHER INPUTS
          </h3> */}
            <table className="tbl nice vat-return-table">
              <thead>
                <tr>
                  <th className="vat-return-col-label">
                    VAT ON EXPENSES AND ALL OTHER INPUTS
                  </th>
                  <th>AMOUNT</th>
                  <th>VAT AMOUNT</th>
                  <th>TOTAL AMOUNT</th>
                  <th>ADJUSTMENT (AED)</th>
                  <th className="actions-col">Action</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>STANDARD RATED EXPENSES</td>
                  <td>{renderVatReturnEditableCell("inputs.standard", "inputs.standard.amount", inputs.standard.amount)}</td>
                  <td>{renderVatReturnEditableCell("inputs.standard", "inputs.standard.vat", inputs.standard.vat)}</td>
                  <td>{formatAED(inputs.standard.total)}</td>
                  <td>{renderVatReturnAdjustmentCell("inputs.standard", inputs.standard.adjustment)}</td>
                  {renderVatReturnActionCell("inputs.standard")}
                </tr>
                <tr>
                  <td>Reverse Charge Provisions (Expenses)</td>
                  <td>{renderVatReturnEditableCell("inputs.reverseCharge", "inputs.reverseCharge.amount", inputs.reverseCharge.amount)}</td>
                  <td>{renderVatReturnEditableCell("inputs.reverseCharge", "inputs.reverseCharge.vat", inputs.reverseCharge.vat)}</td>
                  <td>{formatAED(inputs.reverseCharge.total)}</td>
                  <td>{renderVatReturnAdjustmentCell("inputs.reverseCharge", inputs.reverseCharge.adjustment)}</td>
                  {renderVatReturnActionCell("inputs.reverseCharge")}
                </tr>
                <tr className="vat-return-total-row">
                  <td>TOTAL AMOUNT</td>
                  <td>{formatAED(inputsTotals.amount)}</td>
                  <td>{formatAED(inputsTotals.vat)}</td>
                  <td>{formatAED(inputsTotals.total)}</td>
                  <td>{renderVatReturnAdjustmentCell("inputs.total", inputsTotals.adjustment)}</td>
                  {renderVatReturnActionCell("inputs.total")}
                </tr>
              </tbody>
            </table>
          </section>

          {/* 3️⃣ NET VAT VALUE */}
          <section className="vat-return-section">
            {/* <h3 className="vat-return-title">NET VAT VALUE</h3> */}
            <table className="tbl nice vat-return-table vat-return-net">
              <thead>
                <tr>
                  <th>NET VAT VALUE</th>
                  <th>AMOUNT (AED)</th>
                  <th>ADJUSTMENT (AED)</th>
                  <th className="actions-col">Action</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Total Value of due tax for the period</td>
                  <td>{formatAED(totalDueTax)}</td>
                  <td>{renderVatReturnAdjustmentCell("net.totalDueTax", totalDueTaxAdjustment)}</td>
                  {renderVatReturnActionCell("net.totalDueTax")}
                </tr>
                <tr>
                  <td>Total Value of recoverable tax for the period</td>
                  <td>{formatAED(totalRecoverableTax)}</td>
                  <td>{renderVatReturnAdjustmentCell("net.totalRecoverableTax", totalRecoverableTaxAdjustment)}</td>
                  {renderVatReturnActionCell("net.totalRecoverableTax")}
                </tr>
                <tr>
                  <td>VAT PAYABLE FOR THE PERIOD</td>
                  <td>{formatAED(vatPayableForPeriod)}</td>
                  <td>{renderVatReturnAdjustmentCell("net.vatPayable", vatPayableForPeriodAdjustment)}</td>
                  {renderVatReturnActionCell("net.vatPayable")}
                </tr>
                <tr>
                  <td>FUND AVAILABLE FTA</td>
                  <td>
                    {isVatReturnRowEditing("ftaFund") ? (
                      <input
                        type="text"
                        inputMode="decimal"
                        className="inline-edit-input"
                        value={ftaFundInputValue}
                        onChange={(e) =>
                          handleVatReturnInputChange("ftaFund", e.target.value)
                        }
                        onBlur={(e) => {
                          const n = parseReconAmount(e.target.value);
                          handleVatReturnInputChange(
                            "ftaFund",
                            n == null ? "" : n.toFixed(2)
                          );
                        }}
                      />
                    ) : (
                      formatAED(ftaFund)
                    )}
                  </td>
                  <td>{renderVatReturnAdjustmentCell("ftaFund", ftaFundAdjustment)}</td>
                  {renderVatReturnActionCell("ftaFund")}
                </tr>
                <tr className="vat-return-total-row">
                  <td>NET VAT PAYABLE FOR THE PERIOD</td>
                  <td>{formatAED(netVatPayableAfterFund)}</td>
                  <td>{renderVatReturnAdjustmentCell("net.afterFund", netVatPayableAfterFundAdjustment)}</td>
                  {renderVatReturnActionCell("net.afterFund")}
                </tr>
                <tr>
                  <td>
                    Do you wish to request a refund for the above amount of excess
                    recoverable tax?
                  </td>
                  <td>{renderVatReturnYesNoCell("refundRequest", "refundRequest")}</td>
                  <td>
                    {renderVatReturnAdjustmentCell("refundRequest", refundRequestAdjustment, {
                      dashWhenZeroInView: true,
                    })}
                  </td>
                  <td className="actions-col vat-return-no-action-cell" aria-hidden="true" />
                </tr>
                <tr>
                  <td>
                    Did you apply the profit margin scheme in respect of any
                    supplies made during the tax period?
                  </td>
                  <td>
                    {renderVatReturnYesNoCell(
                      "profitMarginScheme",
                      "profitMarginScheme"
                    )}
                  </td>
                  <td>
                    {renderVatReturnAdjustmentCell(
                      "profitMarginScheme",
                      profitMarginSchemeAdjustment,
                      { dashWhenZeroInView: true }
                    )}
                  </td>
                  <td className="actions-col vat-return-no-action-cell" aria-hidden="true" />
                </tr>
              </tbody>
            </table>
          </section>
        </div>
      </div>
    );
  };

  return (
    <div className="result-page">
      {/* Header */}
      <header className="result-head">
        <div className="title-wrap">
          <h2 className="result-title">
            VAT Filing Preview{" "}
            {isEditMode && <span className="edit-badge">EDIT MODE</span>}
          </h2>
        </div>

        <div className="head-actions">
          {/* 1️⃣ Tabs on the left */}
          <div className="seg seg-black">
            <button
              className={`seg-btn ${view === "sales" ? "active" : ""}`}
              onClick={() => setView("sales")}
              title="Show Sales rows"
            >
              Sales
            </button>
            <button
              className={`seg-btn ${view === "purchase" ? "active" : ""}`}
              onClick={() => setView("purchase")}
              title="Show Purchase rows"
            >
              Purchase
            </button>
            <button
              className={`seg-btn ${view === "others" ? "active" : ""}`}
              onClick={() => setView("others")}
              title="Show Excluded Transactions"
            >
              Others
            </button>
            <button
              className={`seg-btn ${view === "salesTotal" ? "active" : ""}`}
              onClick={() => setView("salesTotal")}
              title="Show Sales Total sheet"
            >
              Sales Total
            </button>
            <button
              className={`seg-btn ${view === "purchaseTotal" ? "active" : ""}`}
              onClick={() => setView("purchaseTotal")}
              title="Show Purchase Total sheet"
            >
              Purchase Total
            </button>
            {tabVisibility.bank && (
              <button
                className={`seg-btn ${view === "bank" ? "active" : ""}`}
                onClick={() => setView("bank")}
                title="Show Bank Statement rows"
              >
                Bank Statement
              </button>
            )}
            {tabVisibility.bankRecon && (
              <button
                className={`seg-btn ${view === "bankRecon" ? "active" : ""}`}
                onClick={() => setView("bankRecon")}
                title="Show Bank Reconciliation"
              >
                Bank Reconciliation
              </button>
            )}
            <button
              className={`seg-btn ${view === "vatSummary" ? "active" : ""}`}
              onClick={() => setView("vatSummary")}
              title="Show VAT Summary"
            >
              VAT Summary
            </button>
            <button
              className={`seg-btn ${view === "vatReturn" ? "active" : ""}`}
              onClick={() => setView("vatReturn")}
              title="Show VAT Return"
            >
              VAT Return
            </button>
          </div>

          {/* 2️⃣ Back button – now before Download */}
          <button
            type="button"
            className="prj-btn prj-btn-outline vf-back-btn"
            onClick={handleBack}
          >
            ← {isExistingRun ? "Back to conversions" : "Back to filing"}
          </button>

          {/* 3️⃣ Download Excel on the far right */}
          <button className="btn btn-black" onClick={handleDownload}>
            Download Excel
          </button>
          <button className="btn btn-black" onClick={handleAddMoreFiles}>
            Add More Files
          </button>
        </div>
      </header>

      {/* Table Card */}
      <div className="result-card">
        <div className="result-card-body">
          <div className="result-main-pane" ref={editablePaneRef}>
            {view === "vatReturn"
              ? renderVatReturn()
              : renderTable(
                current.columns,
                current.rows,
                "No data to display",
                view
              )}
          </div>

          <aside className="result-doc-pane" aria-label="Document preview">
            <div className="result-doc-pane-head">
              <div className="result-doc-title">Verification Document</div>
              <div className="result-doc-subtitle">
                {activeDocument
                  ? activeDocument.label || "Uploaded document"
                  : "Select a row with an uploaded document"}
              </div>
            </div>

            {contextualDocuments.length > 1 && (
              <div className="result-doc-tabs">
                {contextualDocuments.map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    className={`result-doc-tab ${doc.id === activeDocument?.id ? "active" : ""}`}
                    onClick={() => setActiveDocumentId(doc.id)}
                  >
                    {doc.role === "invoice"
                      ? "Invoice"
                      : doc.role === "bank"
                        ? "Bank"
                        : "Document"}
                  </button>
                ))}
              </div>
            )}

            <div className="result-doc-pane-body">
              {!activeDocument ? (
                <div className="result-doc-empty">
                  No uploaded document is available for the current selection.
                </div>
              ) : (
                <>
                  <div className="result-doc-actions">
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => setPreview(activeDocument)}
                    >
                      Open Preview
                    </button>
                    <a
                      className="btn btn-outline"
                      href={activeDocument.url}
                      target="_blank"
                      rel="noreferrer"
                      download
                    >
                      Download
                    </a>
                  </div>

                  <div className="result-doc-viewer">
                    {activeDocument.type === "pdf" ? (
                      <PdfViewer
                        key={activeDocument.id}
                        fileUrl={activeDocument.url}
                        controls={{
                          prev: <span>{"<"}</span>,
                          next: <span>{">"}</span>,
                        }}
                      />
                    ) : (
                      <ImageViewer
                        key={activeDocument.id}
                        src={activeDocument.url}
                        alt={activeDocument.label || "Uploaded document"}
                        initialScale={1}
                        minScale={0.4}
                        maxScale={5}
                        step={0.2}
                      />
                    )}
                  </div>
                </>
              )}
            </div>
          </aside>
        </div>
        <div className="result-card-footer">
          <button
            type="button"
            className="btn btn-outline"
            onClick={handleSaveDraft}
            disabled={loading || !previewData}
          >
            {isExistingRun
              ? "Save Changes"
              : draftSaved
                ? "Draft Saved"
                : "Save Draft"}
          </button>
          {/* <button type="button" className="btn btn-black">
            Verify
          </button> */}
        </div>
      </div>
      {preview && (
        <div className="invoice-preview-overlay">
          <div className="invoice-preview-dialog">
            <div className="invoice-preview-header">
              <span className="preview-title">
                {preview.label || "Invoice preview"}
              </span>
              <button
                className="preview-close-btn"
                onClick={() => setPreview(null)}
                aria-label="Close preview"
              >
                <X size={18} />
              </button>
            </div>
            <div className="invoice-preview-body">
              {preview.type === "pdf" ? (
                <PdfViewer
                  fileUrl={preview.url}
                  controls={{
                    prev: <span>{"<"}</span>,
                    next: <span>{">"}</span>,
                  }}
                />
              ) : (
                <ImageViewer
                  src={preview.url}
                  alt={preview.label || "Invoice image"}
                  initialScale={1}
                  minScale={0.4}
                  maxScale={5}
                  step={0.2}
                />
              )}
            </div>
          </div>
        </div>
      )}
      {showAddFilesModal && (
        <div className="invoice-preview-overlay">
          <div className="invoice-preview-dialog add-files-dialog">
            <div className="invoice-preview-header">
              <span className="preview-title">Add More Files</span>
              <button
                className="preview-close-btn"
                onClick={() => setShowAddFilesModal(false)}
                aria-label="Close add files"
              >
                <X size={18} />
              </button>
            </div>
            <div className="invoice-preview-body add-files-body">
              <VatFilingComposer
                embedded
                initialCompanyId={companyId}
                initialPeriodId={periodIdFromQuery || previewData?.periodId}
                initialRunId={runId}
                initialExistingPayload={previewData}
                onClose={() => setShowAddFilesModal(false)}
                onCombinedPreviewReady={handleInlinePreviewRefresh}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
