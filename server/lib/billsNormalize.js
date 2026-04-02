// lib/billsNormalize.js
export function normalizeBillRecord(gJSON, sourceName) {
  const safe = (v) => (v === undefined ? null : v);

  // 15-digit UAE TRN
  const cleanTrn = (v) => {
    if (!v) return null;
    const d = String(v).replace(/\D/g, "");
    return d.length === 15 ? d : null;
  };

  function num(v) {
    if (v == null || v === "") return null;
    const n = Number(String(v).replace(/[, ]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  const date = safe(gJSON?.date);
  const receipt = (gJSON?.receipt_no || "").trim() || null;
  const bill = (gJSON?.bill_no || "").trim() || null;
  const billOrReceipt =
    receipt || bill || safe(gJSON?.invoice_number) || null;

  return {
    DATE: date,
    "BILL/RECEIPT NO": billOrReceipt,
    "SUPPLIER/VENDOR": safe(gJSON?.supplier || gJSON?.vendor_name || null),
    TRN: cleanTrn(gJSON?.supplier_trn || gJSON?.vendor_trn || null),
    "BEFORE TAX AMOUNT": num(gJSON?.before_tax_amount),
    VAT: num(gJSON?.vat),
    "NET AMOUNT": num(gJSON?.net_amount),
    "PAYMENT METHOD": normalizePayment(gJSON?.payment_method),
    SOURCE: sourceName,
  };
}

function normalizePayment(v) {
  if (!v) return null;
  const s = String(v).toUpperCase();
  if (/\bCASH\b/.test(s)) return "CASH";
  if (/\b(CARD|VISA|MASTERCARD|MAESTRO|AMEX|POS|DEBIT|CREDIT)\b/.test(s))
    return "CARD";
  if (/\b(ONLINE|BANK\s*TRANSFER|WIRE|UPI|APPLE\s*PAY|SAMSUNG\s*PAY)\b/.test(s))
    return "ONLINE";
  return "OTHER";
}
