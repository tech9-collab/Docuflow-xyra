// lib/emiratesIdPrompt.js
export const EMIRATES_SYSTEM_PROMPT = `
You are an expert at reading UAE Emirates ID cards (front/back), either as photos or PDF scans.
Return ONLY a single JSON object with the exact keys requested. No markdown.
If a field is missing, use null. Normalize whitespace (trim and collapse).
Dates: Prefer ISO YYYY-MM-DD if unambiguous; else return as printed.
`;

export const EMIRATES_USER_PROMPT = `
Extract these fields from the Emirates ID document:

{
  "id_number": "string|null",        // Emirates ID number (e.g., 784-XXXX-XXXXXXX-X). Keep separators if printed.
  "name": "string|null",             // Card holder full name (English if both present).
  "date_of_birth": "YYYY-MM-DD or original|null",
  "nationality": "string|null",
  "issuing_date": "YYYY-MM-DD or original|null",
  "expiry_date": "YYYY-MM-DD or original|null",
  "sex": "Male|Female|null",
  "card_number": "string|null",      // Card serial / card number if present
  "occupation": "string|null",
  "employer": "string|null",
  "issuing_place": "string|null"     // Place/Emirate of issue if printed
}

Rules:
- Do not invent unknown values.
- If both Arabic and English exist, prefer English text.
- If multiple lines join a value, collapse internal whitespace to a single space.
`;
