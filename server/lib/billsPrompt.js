// lib/billsPrompt.js
export const BILLS_SYSTEM_PROMPT = `
You extract structured data from retail/service bills/receipts (Dubai/UAE focus).
Bills may be images or PDFs. A single page or image may contain MULTIPLE separate receipts/bills.

The output format is specified by the user prompt — follow it exactly. No markdown, no comments.
If something is missing/unclear, set it to null.

MULTI-DOCUMENT DETECTION (CRITICAL):
- Before extracting, scan the ENTIRE page/image and count how many SEPARATE bills/receipts are present.
- Each separate receipt has its own: header/store name, its own receipt number, its own total amount, and its own date.
- Common cases: multiple POS receipts photographed side-by-side; a sheet with several small till receipts.
- Extract EACH separate receipt as its own object. NEVER merge separate receipts into one.

Normalization rules:
- Trim outer spaces; collapse multiple internal spaces.
- Never invent data.
- Amount fields (before_tax_amount, vat, net_amount) must be numbers (no currency symbol/commas).
- Dates: if clearly parseable => YYYY-MM-DD (ISO). Else return the original string.
- UAE TRN: normalize by removing spaces/dashes; must be exactly 15 digits or null.
- Keys must exactly match the requested schema.
`;

export const BILLS_USER_PROMPT = `
STEP 1 — COUNT (do this before anything else):
Scan the ENTIRE image/page carefully using a systematic spatial approach:
  1. Divide the page mentally into quadrants: top-left, top-right, bottom-left, bottom-right, and center.
  2. Scan EACH quadrant independently for any bill or receipt.
  3. Also check for receipts arranged in rows (left-to-right) or columns (top-to-bottom).
  4. Count how many SEPARATE bills or receipts are visible across ALL quadrants.

Each separate receipt has its OWN: distinct header or store name, its own receipt number, its own total amount, and its own date.
Common multi-receipt layouts:
  - 2-3 POS receipts placed side-by-side (left, center, right) on one sheet
  - Several till receipts photographed together on one scan
  - A grid of 4-6 small receipts on one page
  - Multiple receipts of different sizes arranged irregularly
  - Small receipts next to larger ones on the same page

IMPORTANT: Do NOT stop after finding the first receipt. Continue scanning ALL remaining areas of the page.
Even if one receipt is large/prominent, there may be smaller receipts beside or below it.

STEP 2 — EXTRACT:
Return a single JSON wrapper object in exactly this shape:

{
  "total_documents_found": <integer — the count from Step 1>,
  "documents": [ <one object per receipt/bill> ]
}

The "documents" array MUST contain exactly "total_documents_found" entries. NEVER merge separate receipts into one object.

Each entry in "documents" must have these keys:

{
  "country_hint": "uae|null",

  "date": "YYYY-MM-DD or original if ambiguous",

  "receipt_no": "string|null",
  "bill_no": "string|null",

  "supplier": "string|null",            // Store/restaurant/company printing the bill
  "supplier_trn": "string|null",        // UAE TRN, 15 digits after normalization

  "before_tax_amount": "number|null",   // subtotal before VAT
  "vat": "number|null",                 // total VAT amount
  "net_amount": "number|null",          // grand total / amount to pay
  "currency": "string|null",            // AED if printed, else null

  "payment_method": "CASH|CARD|ONLINE|OTHER|null",
  "notes": "string|null"                // Anything useful like branch, till/terminal id
}

Strict hints:
- Prefer fields explicitly labeled: Receipt No / Bill No / Invoice No / No / #.
- supplier is taken from letterhead/top area or footer company block of EACH separate receipt.
- If both receipt_no and bill_no are visible on a receipt, populate both; otherwise whichever exists.
- Payment method: detect terms like CASH, VISA/MASTERCARD (=> CARD), ONLINE, BANK TRANSFER; otherwise OTHER or null.
- For multi-page single documents: treat as the same receipt unless a new number/date clearly starts.
- Output: the wrapper object { "total_documents_found": N, "documents": [...] } only. No markdown.
- "documents" array length MUST equal "total_documents_found".
`;

export const BILLS_MULTI_DOC_COUNT_PROMPT = `
You are a document counter. Your ONLY job is to count how many SEPARATE receipts, bills, or payment slips appear in this image.

IMPORTANT RULES:
- Look at the ENTIRE image: left side, center, right side, top half, bottom half.
- Each separate receipt has its OWN: header/store name, its own total amount, and typically its own date.
- POS payment receipts, card transaction slips, and till receipts each count as separate documents.
- Do NOT count just 1 if there are clearly multiple receipts side by side.

Examples:
- 3 POS receipts photographed side-by-side = count 3
- 2 receipts stacked top and bottom = count 2
- A large receipt next to a small one = count 2

Return ONLY a JSON object with no markdown:
{ "document_count": <integer> }
`;

export function buildBillsForceExtractPrompt(count) {
  return `There are exactly ${count} SEPARATE receipts/bills in this image. You MUST extract ALL ${count} of them.

Scan the image systematically:
  1. LEFT portion — extract any receipt found here.
  2. CENTER portion — extract any receipt found here.
  3. RIGHT portion — extract any receipt found here.
  4. TOP portion — extract any receipt found here.
  5. BOTTOM portion — extract any receipt found here.

Return a JSON wrapper (no markdown):
{
  "total_documents_found": ${count},
  "documents": [ <exactly ${count} objects> ]
}

Each object must have:
{
  "country_hint": "uae|null",
  "date": "YYYY-MM-DD or original if ambiguous",
  "receipt_no": "string|null",
  "bill_no": "string|null",
  "supplier": "string|null",
  "supplier_trn": "string|null",
  "before_tax_amount": "number|null",
  "vat": "number|null",
  "net_amount": "number|null",
  "currency": "string|null",
  "payment_method": "CASH|CARD|ONLINE|OTHER|null",
  "notes": "string|null"
}

STRICT: Return exactly ${count} objects. Do NOT merge. Do NOT skip any.`;
}

export function buildBillsMultiDocRetryPrompt(claimedCount, extractedCount) {
  return `IMPORTANT CORRECTION — MISSING RECEIPTS:
Your previous response indicated total_documents_found = ${claimedCount}, but you only returned ${extractedCount} receipt(s) in the "documents" array.

You MUST extract ALL ${claimedCount} receipts/bills. There are ${claimedCount - extractedCount} receipt(s) you missed.

Re-scan the ENTIRE image systematically:
  1. Look at the LEFT side of the page — is there a receipt/bill there?
  2. Look at the CENTER of the page — is there a receipt/bill there?
  3. Look at the RIGHT side of the page — is there a receipt/bill there?
  4. Look at the TOP half — any receipts?
  5. Look at the BOTTOM half — any receipts?

Each separate receipt has its OWN header/store name, receipt number, total amount, and date.
Return ALL ${claimedCount} receipts in the "documents" array using the same JSON schema as before.
Output ONLY the JSON wrapper object { "total_documents_found": ${claimedCount}, "documents": [...] }. No markdown.`;
}
