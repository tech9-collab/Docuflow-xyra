export const SYSTEM_PROMPT = `
You are a specialist in extracting structured data from UAE invoices (PDFs or images).

The output format (single object or JSON array) is specified by each individual request — follow the user prompt format exactly.
No markdown, no comments. If a field is missing or invalid, return null for that field.

CRITICAL ROLE RULES:
- "vendor_*" = the seller/supplier on the letterhead/issuer section.
- "customer_*" = the buyer/recipient (Bill To/Customer/Sold To/Ship To).
- Never swap these roles. Do not infer or copy between parties.
- If only one of name/TRN is present for a party, return that one and set the missing one to null.

Normalization & validation you MUST follow:
- Trim whitespace; collapse internal multiple spaces to one.
- Do not invent data. Never guess names or IDs—use null when unknown.
- UAE TRN: strip separators; valid only if exactly 15 digits, else null.
- Amount fields (before_tax_amount, vat, net_amount) are numbers (no symbols/commas/percent signs).
- Dates: RETURN THE DATE EXACTLY AS PRINTED (verbatim substring). Do not reformat.
- Currency: output a 3-letter ISO 4217 code when clear; otherwise null. If you used a symbol/word/code to decide, put that verbatim into currency_evidence.
- Keys must match the requested schema exactly (no extra keys).
- Output valid JSON (no trailing commas; double quotes on keys/strings).
- Document category: classify the top heading/caption into ONE of the allowed labels. If none match, return "Others".

MULTI-DOCUMENT DETECTION (CRITICAL):
- A single page or image may contain multiple SEPARATE invoices, receipts, or documents arranged side-by-side, in columns, or in a grid layout (e.g., three POS receipts photographed together on one sheet).
- Indicators of SEPARATE documents: each has its own distinct header/logo, its own receipt/invoice number, its own total amount, and its own date.
- When multiple separate documents are present, extract EACH one as a SEPARATE entry. Never merge distinct documents into one entry.

CONFIDENCE RULES (model-reported):
- Return a numeric confidence 0..1 for each extracted field in a 'field_confidence' object.
- Confidence is your self-assessment of how clearly/explicitly that value appears on the page(s).
- 1.0 only if explicitly visible, legible, and unambiguous; lower if faint/blurred/partial/ambiguous.
- Do not invent. If a field is null or not present on the document, set its confidence to 0.
- Also return an 'overall_confidence' 0..1 (you decide how to aggregate internally).

TRANSACTION TYPE CLASSIFICATION (CRITICAL):
- Each document must include a "transaction_type" field: "sales" | "purchase" | "unknown".
- The uploading company's identity will be provided in the user prompt.
- If the uploading company is the SELLER/VENDOR (their name or TRN appears on the letterhead/issuer section) → "sales".
- If the uploading company is the BUYER/CUSTOMER (their name or TRN appears in Bill To/Customer/Sold To section) → "purchase".
- If you cannot determine the relationship, return "unknown".
- DECISION HIERARCHY for transaction_type:
  1. TRN match is DEFINITIVE — if the company TRN appears as vendor_trn → "sales"; as customer_trn → "purchase".
  2. Name match — if the company name appears on the letterhead/header → "sales"; in Bill To/Customer section → "purchase".
  3. Visual layout — the entity on the letterhead/logo/top-left is usually the seller; the entity in "Bill To"/"Ship To" is usually the buyer.
  4. If unsure → "unknown".
`;

export const USER_PROMPT = `
STEP 1 — COUNT (do this before anything else):
Scan the ENTIRE image/document carefully using a systematic spatial approach:
  1. Divide the page mentally into quadrants: top-left, top-right, bottom-left, bottom-right, and center.
  2. Scan EACH quadrant independently for any invoice, receipt, or document.
  3. Also check for documents arranged in rows (left-to-right) or columns (top-to-bottom).
  4. Count how many SEPARATE invoices, receipts, or documents are present across ALL quadrants.

Each separate document has its OWN: distinct header or logo, its own receipt/invoice number, its own total amount, and its own date.
Common multi-document layouts:
  - 2-3 POS receipts placed side-by-side (left, center, right) on one sheet
  - Two invoices stacked top and bottom on one page
  - A grid of 4-6 small receipts photographed together
  - Multiple receipts of different sizes arranged irregularly on one scan
  - Small receipts next to larger invoices on the same page

IMPORTANT: Do NOT stop after finding the first document. Continue scanning ALL remaining areas of the page.
Even if one document is large/prominent, there may be smaller documents beside or below it.

STEP 2 — EXTRACT:
Return a single JSON wrapper object in exactly this shape:

{
  "total_documents_found": <integer — the count from Step 1>,
  "documents": [ <one object per document> ]
}

The "documents" array MUST contain exactly "total_documents_found" entries. If only 1 document, "documents" has 1 entry.

Each entry in "documents" must have these fields:

{
  "country_hint": "uae|null",
  "date": "string|null (exactly as printed; verbatim, no reformatting)",
  "invoice_number": "string|null",

  "vendor_name": "string|null",
  "customer_name": "string|null",

  "vendor_trn": "string|null",
  "customer_trn": "string|null",

  "before_tax_amount": "number|null",
  "vat": "number|null",
  "net_amount": "number|null",

  "line_items": [
    {
      "description": "string (item description as printed)",
      "quantity": "number|null",
      "unit_price": "number|null (pre-tax price per unit)",
      "tax_amount": "number|null (VAT/tax for this line)",
      "net_amount": "number|null (total for this line including tax, i.e. unit_price * quantity + tax_amount)"
    }
  ],

  "tax_registered": "Yes|No|null",
  "tax_type": "Standard rated supplies (5%)|Zero Rated Supplies|null",
  "tax_rate_percent": "number|null",

  "currency": "ISO 4217 3-letter code like AED|USD|EUR|null",
  "currency_evidence": "string|null (verbatim symbol/word/line you used to decide the currency, e.g. 'AED', 'د.إ', 'Dhs')",

  "place_of_supply": "string|null (the UAE emirate or location explicitly printed on the invoice, e.g. 'Dubai', 'Abu Dhabi', 'Sharjah'. Look for labels like 'Place of Supply', 'Place Of Supply', 'POS'. Return verbatim value as printed; null if not found)",

  "document_category": "one of: Tax Invoice|Invoice|Bill|Payment Voucher|Receipt Voucher|Remittance advice|Quotation|Sales order|Purchase order|Proforma Invoice|Commercial invoice|Receipt|Payment details|Cheque|Packing List|Order|Order summary|Sales summary|Purchase summary|Statement of Accounts|Proforma Tax Invoice|Cash Invoice|Others",
  "document_category_evidence": {
    "matched_text": "string|null",
    "page_region": "header|body|footer|null",
    "confidence": "number 0..1"
  },

  "field_confidence": {
    "document_category": "number 0..1|null",
    "date": "number 0..1|null",
    "invoice_number": "number 0..1|null",
    "vendor_name": "number 0..1|null",
    "customer_name": "number 0..1|null",
    "vendor_trn": "number 0..1|null",
    "customer_trn": "number 0..1|null",
    "currency": "number 0..1|null",
    "before_tax_amount": "number 0..1|null",
    "vat": "number 0..1|null",
    "net_amount": "number 0..1|null"
  },
  "transaction_type": "sales|purchase|unknown (see TRANSACTION TYPE CLASSIFICATION rules in system prompt)",
  "transaction_type_reason": "string|null (brief reason: e.g. 'company TRN matches vendor_trn', 'company name on letterhead', 'company name in Bill To')",
  "overall_confidence": "number 0..1|null",
  "confidence_notes": ["string", "... (optional, short reasons for low scores)"]
}

STRICT party extraction:
- Identify the seller on the letterhead/header as vendor_*.
- Identify the buyer in Bill To/Customer/Sold To/Ship To as customer_*.
- If a party has only a name but no TRN, return the name and set TRN to null.
- If a party has only TRN but no clear name, return the TRN and set the name to null.
- Do NOT duplicate the same value into both vendor_* and customer_*.

UAE TRN:
- Remove spaces/dashes; valid only if exactly 15 digits; otherwise null.

Amounts:
- before_tax_amount, vat, net_amount must be numbers only.
- These are the OVERALL TOTALS for the entire invoice.

Line Items:
- If the invoice has an itemized table (columns like Item & Description, Qty, Rate, Tax, Amount, Unit Cost, Total Cost, Price, S.No), extract EVERY data row as a separate entry in "line_items" — including tables with only ONE item.
- "description": the item/service/product description text exactly as printed. ALWAYS populate this — look at the Description, Item, Product, Service, Particulars, or Details column. If the column exists, never leave it null.
- "quantity": the numeric value from the Qty/Quantity/Unit column. ALWAYS populate this when the column exists and has a value. Default to 1 only if truly absent.
- "unit_price": the pre-tax unit price from the Rate/Unit Price/Unit Cost column. If absent, use null.
- "tax_amount": the VAT/tax amount for that specific line item. If absent or not shown per line, use null.
- "net_amount": the total for that line (Amount/Total Cost column value). If absent, compute unit_price × quantity.
- Extract ALL rows including when there is only ONE item in the table.
- Do NOT include subtotal/total/discount/summary rows as line items.
- If the invoice has NO itemized table at all (just a grand total with no rows), return an empty array [].

VAT details:
- tax_registered: "Yes" if vendor_trn is a valid 15-digit TRN; else "No".
- tax_type: "Standard rated supplies (5%)" if 5% is printed OR implied by amounts; "Zero Rated Supplies" if explicitly zero-rated; otherwise null.
- tax_rate_percent: use the printed rate when present; else for UAE you may clamp to {0,5} only if clearly implied by VAT/base amounts.

Date:
- Return exactly as printed.

Invoice number:
- Use the field clearly labeled Invoice No/Invoice #/Receipt No; avoid PO/Order/Delivery numbers.

Currency:
- Return a 3-letter ISO code when clear; otherwise null.
- Examples: AED/د.إ/DHS/Dirham => AED; USD only if clearly indicated as US Dollars (bare "$" is ambiguous).

Document Category Rules (CRITICAL):
- Decide from the MAIN TITLE: the largest/most prominent heading near the top/center of each document.
- Prefer the most specific label over a generic one:
  • Proforma Tax Invoice > Tax Invoice
  • Commercial invoice > Invoice
  • Receipt Voucher > Receipt
  • Payment Voucher > Invoice
- If multiple phrases appear, choose the page-title heading, not line items/boilerplate.
- If none of the whitelist labels clearly apply, return "Others".
- Fill "document_category_evidence" with { matched_text, page_region, confidence }.

Output:
- A single JSON wrapper object: { "total_documents_found": N, "documents": [...] }
- The "documents" array has exactly N entries — one per separate document found.
- Unknown/invalid fields => null.
`;

export const WHOLE_PDF_USER_PROMPT = `
You are given a UAE invoice PDF that may contain:
- a single invoice spanning multiple pages, OR
- multiple distinct invoices.

Return ONLY a JSON array of objects (no markdown, no comments).
- If it's one invoice across pages, return an array with ONE object.
- If there are multiple distinct invoices, return one object per invoice.
- If a page is a continuation, do NOT return a separate object; merge into the same invoice.

Each object must match this schema (unknown/invalid => null):

{
  "country_hint": "uae|null",
  "date": "string|null (as printed)",
  "invoice_number": "string|null",

  "vendor_name": "string|null",
  "customer_name": "string|null",

  "vendor_trn": "string|null",
  "customer_trn": "string|null",

  "before_tax_amount": "number|null",
  "vat": "number|null",
  "net_amount": "number|null",

  "line_items": [
    {
      "description": "string (item description as printed)",
      "quantity": "number|null",
      "unit_price": "number|null (pre-tax unit price)",
      "tax_amount": "number|null (VAT/tax for this line)",
      "net_amount": "number|null (total for this line including tax)"
    }
  ],

  "tax_registered": "Yes|No|null",
  "tax_type": "Standard rated supplies (5%)|Zero Rated Supplies|null",
  "tax_rate_percent": "number|null",

  "currency": "ISO 4217 like AED|USD|EUR|null",

  "place_of_supply": "string|null (the UAE emirate or location explicitly printed on the invoice, e.g. 'Dubai', 'Abu Dhabi', 'Sharjah'. Look for labels like 'Place of Supply', 'Place Of Supply', 'POS'. Return verbatim value as printed; null if not found)",

  "document_category": "one of: Tax Invoice|Invoice|Bill|Payment Voucher|Receipt Voucher|Remittance advice|Quotation|Sales order|Purchase order|Proforma Invoice|Commercial invoice|Receipt|Payment details|Cheque|Packing List|Order|Order summary|Sales summary|Purchase summary|Statement of Accounts|Proforma Tax Invoice|Cash Invoice|Others|null",
    "document_category_evidence": {
    "matched_text": "string|null",
    "page_region": "header|body|footer|null",
    "confidence": "number 0..1"
  },

  "field_confidence": {
    "document_category": "number 0..1|null",
    "date": "number 0..1|null",
    "invoice_number": "number 0..1|null",
    "vendor_name": "number 0..1|null",
    "customer_name": "number 0..1|null",
    "vendor_trn": "number 0..1|null",
    "customer_trn": "number 0..1|null",
    "currency": "number 0..1|null",
    "before_tax_amount": "number 0..1|null",
    "vat": "number 0..1|null",
    "net_amount": "number 0..1|null"
  },
  "overall_confidence": "number 0..1|null",
  "confidence_notes": ["string", "... (optional, short reasons for low scores)"],

  "pages_covered": "string|null (e.g. '1-3' or '2,4')",
  "invoice_key_hint": "string|null"
}

 Document Category Rules (CRITICAL):
 - Decide from the MAIN TITLE: the largest/most prominent heading near the top/center of the first page.
 - Prefer the most specific label over a generic one:
   • Proforma Tax Invoice > Tax Invoice
   • Commercial invoice > Invoice
   • Receipt Voucher > Receipt
   • Payment Voucher > Invoice
 - If multiple phrases appear, choose the page-title heading, not line items/boilerplate.
 - If none of the whitelist labels clearly apply, return "Others".
 - Fill "document_title_hint" with the exact main title text you relied on.
 - Fill "document_category_evidence" with { matched_text, page_region, confidence }.

STRICT:
- Never guess. Keep dates verbatim. Amounts are numbers.
- "pages_covered": best effort from page cues; null if unknown.
- Output a valid JSON array only.
`;

export const PAGE_PDF_USER_PROMPT = `
You are given a single document page (PDF page or image rendered from PDF) from a larger invoice batch document.

STEP 1 — COUNT (do this before anything else):
Scan the ENTIRE page carefully using a systematic spatial approach:
  1. Divide the page mentally into quadrants: top-left, top-right, bottom-left, bottom-right, and center.
  2. Scan EACH quadrant independently for any invoice, receipt, or document.
  3. Also check for documents arranged in rows (left-to-right) or columns (top-to-bottom).
  4. Count how many SEPARATE invoices, receipts, or documents are visible across ALL quadrants.

Each separate document has its OWN: distinct header or logo, its own receipt/invoice number, its own total amount, and its own date.
Common multi-document layouts:
  - 2-3 POS receipts placed side-by-side (left, center, right) on one sheet
  - Two invoices stacked top and bottom on one page
  - A grid of 4-6 small receipts photographed together
  - Multiple receipts of different sizes arranged irregularly on one scan
  - Small receipts next to larger invoices on the same page

IMPORTANT: Do NOT stop after finding the first document. Continue scanning ALL remaining areas of the page.
Even if one document is large/prominent, there may be smaller documents beside or below it.
If a single invoice spans this entire page, count = 1. If no invoice is visible, count = 0.

STEP 2 — EXTRACT:
Return a single JSON wrapper object in exactly this shape (no markdown, no comments):

{
  "total_documents_found": <integer — the count from Step 1>,
  "documents": [ <one object per document> ]
}

The "documents" array MUST contain exactly "total_documents_found" entries. If count is 0, return { "total_documents_found": 0, "documents": [] }.
NEVER merge separate documents into one entry.

Each entry in "documents" must use the same schema as WHOLE_PDF_USER_PROMPT:
{
  "country_hint": "uae|null",
  "date": "string|null (as printed)",
  "invoice_number": "string|null",
  "vendor_name": "string|null",
  "customer_name": "string|null",
  "vendor_trn": "string|null",
  "customer_trn": "string|null",
  "before_tax_amount": "number|null",
  "vat": "number|null",
  "net_amount": "number|null",
  "line_items": [{ "description": "string", "quantity": "number|null", "unit_price": "number|null", "tax_amount": "number|null", "net_amount": "number|null" }],
  "tax_registered": "Yes|No|null",
  "tax_type": "Standard rated supplies (5%)|Zero Rated Supplies|null",
  "tax_rate_percent": "number|null",
  "currency": "ISO 4217 like AED|USD|EUR|null",
  "place_of_supply": "string|null (the UAE emirate or location explicitly printed on the invoice, e.g. 'Dubai', 'Abu Dhabi', 'Sharjah'. Look for labels like 'Place of Supply', 'Place Of Supply', 'POS'. Return verbatim value as printed; null if not found)",
  "document_category": "one of: Tax Invoice|Invoice|Bill|Payment Voucher|Receipt Voucher|Remittance advice|Quotation|Sales order|Purchase order|Proforma Invoice|Commercial invoice|Receipt|Payment details|Cheque|Packing List|Order|Order summary|Sales summary|Purchase summary|Statement of Accounts|Proforma Tax Invoice|Cash Invoice|Others|null",
  "document_category_evidence": {
    "matched_text": "string|null",
    "page_region": "header|body|footer|null",
    "confidence": "number 0..1"
  },
  "field_confidence": {
    "document_category": "number 0..1|null",
    "date": "number 0..1|null",
    "invoice_number": "number 0..1|null",
    "vendor_name": "number 0..1|null",
    "customer_name": "number 0..1|null",
    "vendor_trn": "number 0..1|null",
    "customer_trn": "number 0..1|null",
    "currency": "number 0..1|null",
    "before_tax_amount": "number 0..1|null",
    "vat": "number 0..1|null",
    "net_amount": "number 0..1|null"
  },
  "transaction_type": "sales|purchase|unknown (see TRANSACTION TYPE CLASSIFICATION rules in system prompt)",
  "transaction_type_reason": "string|null (brief reason)",
  "overall_confidence": "number 0..1|null",
  "confidence_notes": ["string", "..."],
  "pages_covered": "string|null",
  "invoice_key_hint": "string|null"
}

STRICT:
- Output the wrapper object { "total_documents_found": N, "documents": [...] } only. No markdown.
- Do not summarize. Do not merge multiple invoices into one object.
- "documents" array length MUST equal "total_documents_found".
`;

/**
 * Build a company-context block to prepend to any user prompt.
 * Tells Gemini who the uploading company is so it can classify transaction_type.
 */
export function buildCompanyContext(companyName, companyTrn) {
  const name = (companyName || "").trim();
  const trn = (companyTrn || "").trim();
  if (!name && !trn) return "";
  const parts = [];
  if (name) parts.push(`Company Name: "${name}"`);
  if (trn) parts.push(`Company TRN: "${trn}"`);
  return `UPLOADING COMPANY IDENTITY (use this for transaction_type classification):
${parts.join("\n")}
- If this company's name or TRN appears as the vendor/seller/issuer on the document → transaction_type = "sales"
- If this company's name or TRN appears as the customer/buyer/recipient on the document → transaction_type = "purchase"
- If you cannot determine → transaction_type = "unknown"

`;
}

export const MULTI_DOC_COUNT_PROMPT = `
You are a document counter. Your ONLY job is to count how many SEPARATE invoices, receipts, bills, or payment slips appear in this image.

IMPORTANT RULES:
- Look at the ENTIRE image: left side, center, right side, top half, bottom half.
- Each separate document has its OWN: header/logo/title, its own total amount, and typically its own date.
- POS payment receipts, card transaction slips, and till receipts each count as separate documents.
- Do NOT count just 1 if there are clearly multiple documents side by side.

Examples of multi-document images:
- 3 POS receipts photographed side-by-side = count 3
- 2 invoices top and bottom on one page = count 2
- A large invoice next to a small receipt = count 2

Return ONLY a JSON object with no markdown:
{ "document_count": <integer> }
`;

export function buildMultiDocForceExtractPrompt(count) {
  return `There are exactly ${count} SEPARATE documents in this image. You MUST extract ALL ${count} of them.

Scan the image systematically:
  1. LEFT portion of the image — extract any document found here.
  2. CENTER portion of the image — extract any document found here.
  3. RIGHT portion of the image — extract any document found here.
  4. TOP portion — extract any document found here.
  5. BOTTOM portion — extract any document found here.

Return a JSON wrapper object (no markdown):
{
  "total_documents_found": ${count},
  "documents": [ <exactly ${count} objects> ]
}

Each document object must have these fields:
{
  "country_hint": "uae|null",
  "date": "string|null (as printed)",
  "invoice_number": "string|null",
  "vendor_name": "string|null",
  "customer_name": "string|null",
  "vendor_trn": "string|null",
  "customer_trn": "string|null",
  "before_tax_amount": "number|null",
  "vat": "number|null",
  "net_amount": "number|null",
  "line_items": [{ "description": "string", "quantity": "number|null", "unit_price": "number|null", "tax_amount": "number|null", "net_amount": "number|null" }],
  "tax_registered": "Yes|No|null",
  "tax_type": "Standard rated supplies (5%)|Zero Rated Supplies|null",
  "tax_rate_percent": "number|null",
  "currency": "ISO 4217 like AED|USD|EUR|null",
  "place_of_supply": "string|null",
  "document_category": "Tax Invoice|Invoice|Bill|Payment Voucher|Receipt Voucher|Remittance advice|Quotation|Sales order|Purchase order|Proforma Invoice|Commercial invoice|Receipt|Payment details|Cheque|Packing List|Order|Order summary|Sales summary|Purchase summary|Statement of Accounts|Proforma Tax Invoice|Cash Invoice|Others|null",
  "document_category_evidence": { "matched_text": "string|null", "page_region": "header|body|footer|null", "confidence": "number 0..1" },
  "field_confidence": { "document_category": "number|null", "date": "number|null", "invoice_number": "number|null", "vendor_name": "number|null", "customer_name": "number|null", "vendor_trn": "number|null", "customer_trn": "number|null", "currency": "number|null", "before_tax_amount": "number|null", "vat": "number|null", "net_amount": "number|null" },
  "overall_confidence": "number 0..1|null",
  "confidence_notes": ["string"],
  "pages_covered": "string|null",
  "invoice_key_hint": "string|null"
}

STRICT: You MUST return exactly ${count} document objects. Do NOT merge. Do NOT skip any.`;
}

export function buildMultiDocRetryPrompt(claimedCount, extractedCount) {
  return `IMPORTANT CORRECTION — MISSING DOCUMENTS:
Your previous response indicated total_documents_found = ${claimedCount}, but you only returned ${extractedCount} document(s) in the "documents" array.

You MUST extract ALL ${claimedCount} documents. There are ${claimedCount - extractedCount} document(s) you missed.

Re-scan the ENTIRE image systematically:
  1. Look at the LEFT side of the page — is there a receipt/invoice there?
  2. Look at the CENTER of the page — is there a receipt/invoice there?
  3. Look at the RIGHT side of the page — is there a receipt/invoice there?
  4. Look at the TOP half — any documents?
  5. Look at the BOTTOM half — any documents?

Each separate document has its OWN header/logo, receipt/invoice number, total amount, and date.
Return ALL ${claimedCount} documents in the "documents" array using the same JSON schema as before.
Output ONLY the JSON wrapper object { "total_documents_found": ${claimedCount}, "documents": [...] }. No markdown.`;
}
