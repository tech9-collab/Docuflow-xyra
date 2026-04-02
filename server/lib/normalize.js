function normalizeDocCategory(raw) {
  if (!raw) return "Others";
  const s = String(raw).toLowerCase();
  // Specific-first mapping (mirrors SYNONYMS in lib/category.js)
  if (/\bproforma\s+tax\s+invoice\b/i.test(s)) return "Proforma Tax Invoice";
  if (/\bcommercial\s+invoice\b/i.test(s)) return "Commercial invoice";
  if (/\bpro\s*forma\b.*\binvoice\b/i.test(s)) return "Proforma Invoice";
  if (/\bcash\s+invoice\b/i.test(s)) return "Cash Invoice";
  if (/\breceipt\s+voucher\b/i.test(s)) return "Receipt Voucher";
  if (/\bpayment\s+voucher\b/i.test(s)) return "Payment Voucher";
  if (/\bpurchase\s+order\b/i.test(s)) return "Purchase order";
  if (/\bsales\s+order\b/i.test(s)) return "Sales order";
  if (/\border\s+summary\b/i.test(s)) return "Order summary";
  if (/\bsales\s+summary\b/i.test(s)) return "Sales summary";
  if (/\bpurchase\s+summary\b/i.test(s)) return "Purchase summary";
  if (/\bstatement\s+of\s+accounts?\b/i.test(s)) return "Statement of Accounts";
  if (/\bpacking\s+list\b/i.test(s)) return "Packing List";
  if (/\bremittance\s+advice\b/i.test(s)) return "Remittance advice";
  if (/\bpayment\s+details?\b/i.test(s)) return "Payment details";
  if (/\btax\s+invoice\b/i.test(s)) return "Tax Invoice";
  if (/\binvoice\b/i.test(s)) return "Invoice";
  if (/\bbill\b/i.test(s)) return "Bill";
  if (/\breceipt\b/i.test(s)) return "Receipt";
  if (/\bcheque\b/i.test(s)) return "Cheque";
  if (/\border\b/i.test(s)) return "Order";
  return "Others";
}

export function normalizeRecord(
  gJSON,
  sourceName,
  countryParam = "uae",
  statement = "purchase",
  self = { name: null, trn: null }, // << new
  invoiceCategory = null
) {
  const safe = (v) => (v === undefined ? null : v);

  const selfName = self?.name || null;
  const selfTRN = self?.trn || null;

  // CURRENCY PICKER
  function pickCurrencyFromGemini(gJSON) {
    const c = (gJSON?.currency || "").trim().toUpperCase();

    // If Gemini already returned a 3-letter ISO code, just use it.
    if (/^[A-Z]{3}$/.test(c)) return c || null;

    // Fall back to evidence (symbol/word/line) if present.
    const ev = (
      gJSON?.currency_evidence ||
      gJSON?.currency ||
      ""
    ).toUpperCase();

    if (/(^|[^A-Z])AED($|[^A-Z])/.test(ev) || /(DHS|DIRHAM|د\.إ)/.test(ev))
      return "AED";
    if (/(^|[^A-Z])INR($|[^A-Z])/.test(ev) || /(₹|RS\.?|RUPEE|RUPEES)/.test(ev))
      return "INR";

    // USD: only if explicitly mentioned; bare "$" is ambiguous—skip unless "USD"/"US DOLLAR" exists.
    if (/USD|US DOLLAR|US\$/.test(ev)) return "USD";

    // A few regional neighbors (optional)
    if (/SAR/.test(ev)) return "SAR";
    if (/QAR/.test(ev)) return "QAR";
    if (/OMR/.test(ev)) return "OMR";
    if (/KWD/.test(ev)) return "KWD";
    if (/BHD/.test(ev)) return "BHD";
    if (/EUR|EURO/.test(ev)) return "EUR";
    if (/GBP|POUND/.test(ev)) return "GBP";

    return null;
  }

  // Default Vat to Zero
  function vatUAE_loosy(gJSON) {
    const v = num(gJSON?.vat);
    return v == null ? 0 : v;
  }

  // Clean TRN (UAE = 15 digits)
  const cleanTrn = (v) => {
    if (!v) return null;
    const digits = String(v).replace(/\D/g, "");
    return digits.length === 15 ? digits : null;
  };

  function fixUaePartiesBySelfTRN({
    statement, // 'sales' | 'purchase'
    selfTRN, // known 15-digit TRN (string) or null
    vendorName,
    vendorTRN,
    customerName,
    customerTRN,
    selfName = null, // optional: helps fallback-by-name when no selfTRN
  }) {
    // normalize to 15-digit (or null)
    const vTRN = cleanTrn(vendorTRN);
    const cTRN = cleanTrn(customerTRN);
    const sTRN = cleanTrn(selfTRN);

    let vName = vendorName ?? null;
    let cName = customerName ?? null;
    let vId = vTRN ?? null;
    let cId = cTRN ?? null;

    if (statement !== "sales" && statement !== "purchase") {
      return {
        vendorName: vName,
        vendorTRN: vId,
        customerName: cName,
        customerTRN: cId,
      };
    }

    if (sTRN) {
      if (statement === "purchase") {
        // We (self) must be customer.
        if (cId === sTRN) {
          // already correct
        } else if (vId === sTRN) {
          // Flipped -> swap
          [vName, cName] = [cName, vName];
          [vId, cId] = [cId, vId];
        } else if (cId && !vId) {
          // Supplier missing, Gemini put supplier TRN into customer:
          vId = cId; // move to supplier
          cId = sTRN; // set our TRN as customer
        } else if (!cId) {
          // Our TRN missing on customer side -> set it
          cId = sTRN;
        }
      } else {
        // SALES: we (self) must be vendor.
        if (vId === sTRN) {
          // already correct
        } else if (cId === sTRN) {
          // Flipped -> swap
          [vName, cName] = [cName, vName];
          [vId, cId] = [cId, vId];
        } else if (vId && !cId) {
          // Customer missing, Gemini put customer TRN into supplier:
          cId = vId; // move to customer
          vId = sTRN; // set our TRN as supplier
        } else if (!vId) {
          // Our TRN missing on vendor side -> set it
          vId = sTRN;
        }
      }
    } else if (selfName) {
      // Optional fallback by name if no self TRN
      const n = (s) =>
        String(s || "")
          .toLowerCase()
          .replace(/\s+/g, " ")
          .replace(/[^a-z0-9\s]/g, "")
          .trim();
      const sN = n(selfName);
      const vN = n(vName);
      const cN = n(cName);

      if (statement === "purchase") {
        if (sN && vN && (vN === sN || vN.includes(sN) || sN.includes(vN))) {
          // self is on vendor -> flip
          [vName, cName] = [cName, vName];
          [vId, cId] = [cId, vId];
        }
      } else {
        if (sN && cN && (cN === sN || cN.includes(sN) || sN.includes(cN))) {
          // self is on customer -> flip
          [vName, cName] = [cName, vName];
          [vId, cId] = [cId, vId];
        }
      }
    }

    return {
      vendorName: vName,
      vendorTRN: vId,
      customerName: cName,
      customerTRN: cId,
    };
  }

  // Document Category (resolved upstream; fallback normalize if needed)
  const docCategory = invoiceCategory
    ? invoiceCategory
    : normalizeDocCategory(
        gJSON?.document_category ||
          gJSON?.document_title_hint ||
          gJSON?.invoice_heading ||
          gJSON?.remarks ||
          null
      );

  let currencyISO = pickCurrencyFromGemini(gJSON) || "AED";

  // Extract line items if present (1+ items in itemized table)
  const rawLineItems = Array.isArray(gJSON?.line_items) ? gJSON.line_items : [];
  const lineItems = rawLineItems
    .filter((li) => li && typeof li === "object" && (li.description || li.net_amount != null || li.unit_price != null))
    .map((li) => ({
      description: String(li.description || "").trim(),
      quantity: num(li.quantity),
      unit_price: num(li.unit_price),
      tax_amount: num(li.tax_amount),
      net_amount: num(li.net_amount),
    }));

  const base = {
    DATE: safe(gJSON?.date),
    "INVOICE NUMBER": safe(gJSON?.invoice_number),
    "BEFORE TAX AMOUNT": num(gJSON?.before_tax_amount),
    "NET AMOUNT": num(gJSON?.net_amount),
    SOURCE: sourceName,
  };

  const rawVendorName = gJSON?.vendor_name ?? gJSON?.supplier_vendor ?? null;
  const rawCustomerName = gJSON?.customer_name ?? null;
  const rawVendorTRN = cleanTrn(gJSON?.vendor_trn ?? gJSON?.trn);
  const rawCustomerTRN = cleanTrn(gJSON?.customer_trn);

  // Fix potential swap using company TRN + expected statement
  const fixed = fixUaePartiesBySelfTRN({
    statement,
    selfTRN,
    vendorName: rawVendorName,
    vendorTRN: rawVendorTRN,
    customerName: rawCustomerName,
    customerTRN: rawCustomerTRN,
    selfName,
  });

  if (statement === "sales") {
    return {
      sheet: "UAE",
      row: {
        DATE: base.DATE,
        "INVOICE NUMBER": base["INVOICE NUMBER"],
        "SUPPLIER/VENDOR": fixed.vendorName || selfName,
        "INVOICE CATEGORY": docCategory,
        PARTY: fixed.customerName,
        "SUPPLIER TRN": fixed.vendorTRN || cleanTrn(selfTRN),
        "CUSTOMER TRN": fixed.customerTRN || null,
        "PLACE OF SUPPLY": safe(gJSON?.place_of_supply) || null,
        CURRENCY: currencyISO,
        "BEFORE TAX AMOUNT": base["BEFORE TAX AMOUNT"],
        VAT: vatUAE_loosy(gJSON),
        "NET AMOUNT": base["NET AMOUNT"],
        LINE_ITEMS: lineItems.length >= 1 ? lineItems : [],
        SOURCE: base.SOURCE,
      },
    };
  }

  return {
    sheet: "UAE",
    row: {
      DATE: base.DATE,
      "INVOICE NUMBER": base["INVOICE NUMBER"],
      "INVOICE CATEGORY": docCategory,
      "SUPPLIER/VENDOR": fixed.vendorName,
      // PARTY: fixed.customerName || selfName,
      PARTY: fixed.customerName,
      "SUPPLIER TRN": fixed.vendorTRN || null,
      // "CUSTOMER TRN": fixed.customerTRN || cleanTrn(selfTRN),
      "CUSTOMER TRN": fixed.customerTRN,
      "PLACE OF SUPPLY": safe(gJSON?.place_of_supply) || null,
      CURRENCY: currencyISO,
      "BEFORE TAX AMOUNT": base["BEFORE TAX AMOUNT"],
      VAT: vatUAE_loosy(gJSON),
      "NET AMOUNT": base["NET AMOUNT"],
      LINE_ITEMS: lineItems.length >= 1 ? lineItems : [],
      SOURCE: base.SOURCE,
    },
  };
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : null;
}
