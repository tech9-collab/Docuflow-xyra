// lib/category.js
export const CATEGORIES = [
  "Proforma Tax Invoice",
  "Commercial invoice",
  "Proforma Invoice",
  "Cash Invoice",
  "Tax Invoice",
  "Invoice",
  "Bill",
  "Payment Voucher",
  "Receipt Voucher",
  "Remittance advice",
  "Quotation",
  "Sales order",
  "Purchase order",
  "Packing List",
  "Order summary",
  "Sales summary",
  "Purchase summary",
  "Statement of Accounts",
  "Payment details",
  "Cheque",
  "Receipt",
  "Order",
  "Others",
];

// Specific-first patterns (prevents "tax invoice" from eating "proforma tax invoice")
const SYNONYMS = [
  { re: /\bproforma\s+tax\s+invoice\b/i, to: "Proforma Tax Invoice" },
  { re: /\bcommercial\s+invoice\b/i, to: "Commercial invoice" },
  { re: /\bpro\s*forma\b.*\binvoice\b/i, to: "Proforma Invoice" },
  { re: /\bcash\s+invoice\b/i, to: "Cash Invoice" },
  { re: /\breceipt\s+voucher\b/i, to: "Receipt Voucher" },
  { re: /\bpayment\s+voucher\b/i, to: "Payment Voucher" },
  { re: /\bpurchase\s+order\b/i, to: "Purchase order" },
  { re: /\bsales\s+order\b/i, to: "Sales order" },
  { re: /\border\s+summary\b/i, to: "Order summary" },
  { re: /\bsales\s+summary\b/i, to: "Sales summary" },
  { re: /\bpurchase\s+summary\b/i, to: "Purchase summary" },
  { re: /\bstatement\s+of\s+accounts?\b/i, to: "Statement of Accounts" },
  { re: /\bpacking\s+list\b/i, to: "Packing List" },
  { re: /\bremittance\s+advice\b/i, to: "Remittance advice" },
  { re: /\bpayment\s+details?\b/i, to: "Payment details" },
  { re: /\btax\s+invoice\b/i, to: "Tax Invoice" },
  { re: /\binvoice\b/i, to: "Invoice" },
  { re: /\bbill\b/i, to: "Bill" },
  { re: /\breceipt\b/i, to: "Receipt" },
  { re: /\bcheque\b/i, to: "Cheque" },
  { re: /\border\b/i, to: "Order" },
];

function pickBySynonyms(text) {
  if (!text) return null;
  for (const { re, to } of SYNONYMS) {
    if (re.test(text)) return to;
  }
  return null;
}

// Optional “confusion” overrides when both appear; prefer the specific one
const OVERRIDES = [
  ["Proforma Tax Invoice", "Tax Invoice"],
  ["Commercial invoice", "Invoice"],
  ["Receipt Voucher", "Receipt"],
  ["Payment Voucher", "Invoice"],
];

function applyOverrides(candidate, haystack) {
  const t = (haystack || "").toLowerCase();
  for (const [prefer, avoid] of OVERRIDES) {
    if (t.includes(prefer.toLowerCase()) && t.includes(avoid.toLowerCase())) {
      return prefer;
    }
  }
  return candidate;
}

export function resolveInvoiceCategory({
  modelCategory,
  modelEvidence, // { matched_text, page_region, confidence }
  headerText, // document_title_hint
  fullText, // any extra combined text you have
}) {
  // 1) Main title wins
  const fromHeader = pickBySynonyms(headerText);
  if (fromHeader) return fromHeader;

  // 2) If evidence says it came from the header, use it
  if (
    modelEvidence &&
    (modelEvidence.page_region || "").toLowerCase() === "header"
  ) {
    const fromEv = pickBySynonyms(modelEvidence.matched_text || "");
    if (fromEv) return fromEv;
  }

  // 3) Otherwise scan overall text
  const fromFull = pickBySynonyms(fullText);
  if (fromFull) return fromFull;

  // 4) If model picked a valid label, keep it
  if (modelCategory && CATEGORIES.includes(modelCategory)) {
    return modelCategory;
  }

  // 5) Fallback
  return "Others";
}

export function resolveWithOverrides(candidate, haystack) {
  return applyOverrides(candidate, haystack);
}

// ---------- Sales / Purchase / Others top-level grouping ----------

export const TRANSACTION_GROUPS = ["Sales", "Purchase", "Others"];

const SALES_CATEGORY_HINTS = new Set([
  "Sales order",
  "Sales summary",
  "Tax Invoice",
  "Proforma Tax Invoice",
  "Proforma Invoice",
  "Commercial invoice",
  "Cash Invoice",
  "Invoice",
  "Receipt",
  "Receipt Voucher",
]);

const PURCHASE_CATEGORY_HINTS = new Set([
  "Purchase order",
  "Purchase summary",
  "Bill",
  "Payment Voucher",
  "Remittance advice",
]);

const SALES_KEYWORDS = [
  /\bsales\s+order\b/i,
  /\bsales\s+invoice\b/i,
  /\bsales\s+receipt\b/i,
  /\bsold\s+to\b/i,
  /\bbill\s+to\b/i,
  /\bcustomer(?:\s+name)?\b/i,
  /\bclient(?:\s+name)?\b/i,
];

const PURCHASE_KEYWORDS = [
  /\bpurchase\s+order\b/i,
  /\bpo\s*number\b/i,
  /\bp\.?o\.?\s*#/i,
  /\bsupplier(?:\s+name)?\b/i,
  /\bvendor(?:\s+name)?\b/i,
  /\bbought\s+from\b/i,
  /\bship\s+from\b/i,
  /\bprocurement\b/i,
];

/**
 * Classify a document into Sales | Purchase | Others.
 * If signals from both Sales and Purchase appear, default to Others.
 *
 * @param {object} args
 * @param {string} [args.transactionType]  - "sales" | "purchase" | "unknown"
 * @param {string} [args.documentCategory] - one of CATEGORIES (e.g. "Tax Invoice", "Bill")
 * @param {string} [args.companyTrn]
 * @param {string} [args.vendorTrn]
 * @param {string} [args.customerTrn]
 * @param {string} [args.text]             - any document text for keyword fallback
 * @returns {"Sales"|"Purchase"|"Others"}
 */
export function classifySalesPurchase({
  transactionType,
  documentCategory,
  companyTrn,
  vendorTrn,
  customerTrn,
  text,
} = {}) {
  // 1) Trust an explicit model classification.
  const tt = String(transactionType || "").trim().toLowerCase();
  if (tt === "sales" || tt === "sale") return "Sales";
  if (tt === "purchase" || tt === "purchases") return "Purchase";

  // 2) Owner-based hint: if we know the company's TRN, match it to vendor/customer.
  const norm = (s) => String(s || "").replace(/\D/g, "");
  const co = norm(companyTrn);
  if (co.length === 15) {
    const vendorMatch = norm(vendorTrn) === co;
    const customerMatch = norm(customerTrn) === co;
    if (vendorMatch && !customerMatch) return "Sales";
    if (customerMatch && !vendorMatch) return "Purchase";
  }

  // 3) Document-category hint.
  if (documentCategory) {
    const isSalesCat = SALES_CATEGORY_HINTS.has(documentCategory);
    const isPurchaseCat = PURCHASE_CATEGORY_HINTS.has(documentCategory);
    if (isSalesCat && !isPurchaseCat) return "Sales";
    if (isPurchaseCat && !isSalesCat) return "Purchase";
  }

  // 4) Keyword fallback. Ambiguous (terms from both) → Others.
  if (text) {
    const hasSales = SALES_KEYWORDS.some((re) => re.test(text));
    const hasPurchase = PURCHASE_KEYWORDS.some((re) => re.test(text));
    if (hasSales && !hasPurchase) return "Sales";
    if (hasPurchase && !hasSales) return "Purchase";
  }

  // 5) Nothing matched, or conflicting signals → Others.
  return "Others";
}
