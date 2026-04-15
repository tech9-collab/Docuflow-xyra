export const SYSTEM_PROMPT = `
You are a specialist in extracting structured data from UAE invoices (PDFs or images).

The output format (single object or JSON array) is specified by each individual request — follow the user prompt format exactly.
No markdown, no comments. If a field is missing or invalid, return null for that field.

VENDOR vs CUSTOMER IDENTIFICATION (follow these steps in order):

Step A — Find the VENDOR (seller/supplier/issuer):
  The vendor is the company that CREATED and ISSUED this invoice.
  1. LETTERHEAD/LOGO: The company whose logo, letterhead, branding, trade name, or stamp appears on the document is the VENDOR. This is the most reliable signal.
  2. LABELS: Any field explicitly labeled "Supplier", "Vendor", "Seller", "From", "Issued by", "Service Provider" → that is the vendor.
  3. TABLE/GRID LAYOUT: If both parties are in a table, read headers — "Supplier"/"Vendor"/"Seller" column = vendor.
  4. CONTEXTUAL: The company providing/selling the goods or services is the vendor.

Step B — Find the CUSTOMER (buyer/recipient):
  The customer is the company/person this invoice is addressed TO — the one being billed.
  1. LABELS: Any field labeled "Bill To", "Customer", "Party", "Sold To", "Ship To", "Buyer", "Recipient", "Deliver To", "To" → that is the customer.
     IMPORTANT: "Client", "Client Name", "Customer Name" = the CUSTOMER (buyer), NOT the vendor. On an invoice, "Client" means the person being billed.
  2. TABLE/GRID LAYOUT: "Customer"/"Party"/"Buyer"/"Bill To"/"Client" column = customer.
  3. POSITION: Usually in a secondary block below or beside the vendor info.

Step C — Match TRNs to the correct party:
  - LABELED TRNs: "Supplier TRN"/"Vendor TRN" → vendor_trn. "Customer TRN"/"Party TRN"/"Buyer TRN"/"Client TRN" → customer_trn. Trust labels over position.
  - STANDALONE TRN in invoice metadata: A TRN appearing alongside invoice metadata fields (Invoice Number, Invoice Date, Due Date) with a generic label like "TRN", "TRN N°", "TRN No", or "Tax Registration Number" — this is the VENDOR's (issuer's) TRN, because it identifies who issued the invoice.
  - TRN IN A PARTY BLOCK: A TRN printed inside or directly below a party's name/address block belongs to THAT party.
  - If two TRNs are present, one belongs to each party — use labels or proximity to assign them.

Step D — Verify (sanity check before outputting):
  - The vendor and customer MUST be DIFFERENT entities. If you have the same name/TRN in both, re-examine.
  - If only one party is identifiable, set the other party's fields to null.
  - If the layout is genuinely ambiguous, prefer null over guessing.
  - Do NOT invent or hallucinate company names. Only return names that are actually printed on the document.

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

TRANSACTION TYPE:
- Always return transaction_type as "unknown" and transaction_type_reason as null.
- Transaction type classification is handled server-side after extraction.
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

  "vendor_place_of_supply": "string|null (emirate/city from the SELLER/VENDOR address block — near letterhead/logo/company stamp at top of document. Look for: Dubai, Abu Dhabi, Sharjah, Ajman, etc. NEVER copy the customer's address here. null if not visible)",
  "customer_place_of_supply": "string|null (emirate/city from the BUYER/CUSTOMER address block — in Bill To/Customer/Ship To/Sold To/Deliver To section. Look for: Dubai, Abu Dhabi, Sharjah, Ajman, etc. NEVER copy the vendor's address here. null if not visible)",
  "place_of_supply": "string|null (the explicit invoice field labeled 'Place of Supply', 'Place Of Supply', or 'POS'. Return that verbatim field value only; do not copy seller/customer address into this field unless the invoice explicitly labels it as Place of Supply. null if not found)",

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

PARTY EXTRACTION (use the Step A/B/C/D method from the system prompt):
- Step A (VENDOR): The company on the letterhead/logo/branding is the VENDOR who issued this invoice. Also check for "Supplier"/"Vendor"/"Seller"/"From" labels.
- Step B (CUSTOMER): The company under "Bill To"/"Customer"/"Party"/"Sold To"/"Client"/"Client Name" is the CUSTOMER being billed. REMEMBER: "Client" and "Client Name" on an invoice = the CUSTOMER (buyer), not the vendor.
- Step C (TRNs): A standalone TRN near invoice metadata (Invoice No, Date, Due Date) labeled "TRN"/"TRN N°" belongs to the VENDOR (issuer). A TRN labeled with a party name ("Supplier TRN", "Customer TRN") belongs to that party. A TRN inside a party's address block belongs to that party.
- Step D: Vendor and customer must be different. Do not hallucinate names not printed on the document.
- PLACE OF SUPPLY extraction (CRITICAL — do not mix up):
  - vendor_place_of_supply: Extract the emirate/city ONLY from the vendor/seller's address section (e.g. "Dubai", "Abu Dhabi", "Sharjah"). Do NOT use the customer's address here.
  - customer_place_of_supply: Extract the emirate/city ONLY from the customer/buyer's address section. Do NOT use the vendor's address here.
  - place_of_supply: ONLY fill this if the invoice has an explicit field LABELED "Place of Supply" or "POS". Copy that value verbatim. Do NOT infer this from addresses.
  - If only one party's address/emirate is visible, return that one and set the other to null.
  - UAE Emirates: Dubai, Abu Dhabi, Sharjah, Ajman, Umm Al Quwain, Ras Al Khaimah, Fujairah.

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

  "vendor_place_of_supply": "string|null (seller/supplier emirate or location printed in the issuer/vendor section or vendor address block. Return ONLY the seller/vendor place, never the customer place. null if not found)",
  "customer_place_of_supply": "string|null (buyer/customer emirate or location printed in the Bill To/Customer/Ship To/Sold To section or customer address block. Return ONLY the customer place, never the vendor place. null if not found)",
  "place_of_supply": "string|null (the explicit invoice field labeled 'Place of Supply', 'Place Of Supply', or 'POS'. Return that verbatim field value only; do not copy seller/customer address into this field unless the invoice explicitly labels it as Place of Supply. null if not found)",

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

PARTY EXTRACTION (use the Step A/B/C/D method from the system prompt):
- Step A (VENDOR): The company on the letterhead/logo/branding is the VENDOR who issued this invoice. Also check "Supplier"/"Vendor"/"Seller"/"From" labels.
- Step B (CUSTOMER): The company under "Bill To"/"Customer"/"Party"/"Sold To"/"Client"/"Client Name" is the CUSTOMER being billed. "Client" = buyer, not vendor.
- Step C (TRNs): A standalone "TRN"/"TRN N°" near invoice metadata = VENDOR's TRN. Labeled TRNs go to the named party. TRN inside a party block = that party's TRN.
- Step D: Vendor and customer must be different. Do not hallucinate names. If uncertain, use null.

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
  "vendor_place_of_supply": "string|null (seller/supplier emirate or location printed in the issuer/vendor section or vendor address block. Return ONLY the seller/vendor place, never the customer place. null if not found)",
  "customer_place_of_supply": "string|null (buyer/customer emirate or location printed in the Bill To/Customer/Ship To/Sold To section or customer address block. Return ONLY the customer place, never the vendor place. null if not found)",
  "place_of_supply": "string|null (the explicit invoice field labeled 'Place of Supply', 'Place Of Supply', or 'POS'. Return that verbatim field value only; do not copy seller/customer address into this field unless the invoice explicitly labels it as Place of Supply. null if not found)",
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

PARTY EXTRACTION (use the Step A/B/C/D method from the system prompt):
- Step A (VENDOR): The company on the letterhead/logo/branding is the VENDOR who issued this invoice. Also check "Supplier"/"Vendor"/"Seller"/"From" labels.
- Step B (CUSTOMER): The company under "Bill To"/"Customer"/"Party"/"Sold To"/"Client"/"Client Name" is the CUSTOMER being billed. "Client" = buyer, not vendor.
- Step C (TRNs): A standalone "TRN"/"TRN N°" near invoice metadata = VENDOR's TRN. Labeled TRNs go to the named party. TRN inside a party block = that party's TRN.
- Step D: Vendor and customer must be different. Do not hallucinate names. If uncertain, use null.

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
  return `UPLOADING COMPANY IDENTITY (for transaction_type classification ONLY):
${parts.join("\n")}

CRITICAL RULES:
1. EXTRACT ALL FIELDS (vendor_name, vendor_trn, customer_name, customer_trn, etc.) ONLY from what is PRINTED on the document. NEVER copy or insert the uploading company name or TRN into any extracted field. The company identity above is ONLY for deciding transaction_type.
2. After extracting all fields purely from the document, determine transaction_type:
   - SEARCH for the company TRN (15-digit number) in the EXTRACTED vendor_trn and customer_trn values. If it matches the extracted vendor_trn -> "sales". If it matches the extracted customer_trn -> "purchase".
   - SEARCH for the company name on the letterhead/header/logo area AND in the Bill To/Customer/Sold To section.
   - In transaction_type_reason, state exactly what you matched and where (e.g. "TRN 100XXXXXXXXXXX found in supplier TRN field" or "Company name found in Bill To section").
   - If neither the company name nor TRN appear anywhere on the document -> transaction_type = "unknown". Do NOT guess. It is perfectly valid for a document to be unrelated to the uploading company.
3. Role sanity check before returning JSON:
   - If the company name/TRN is printed in the Supplier/Vendor/Seller block, the company must remain in vendor_* fields.
   - If the company name/TRN is printed in the Bill To/Customer/Party/Buyer block, the company must remain in customer_* fields.
   - Never duplicate the same company into both vendor_* and customer_* because of a generic title like "Tax Invoice".

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
  "vendor_place_of_supply": "string|null (from SELLER/VENDOR address only)",
  "customer_place_of_supply": "string|null (from BUYER/CUSTOMER address only)",
  "place_of_supply": "string|null (only if explicitly labeled 'Place of Supply' on document)",
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

