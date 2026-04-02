// lib/visaPrompt.js
export const VISA_SYSTEM_PROMPT = `
You are an expert at reading UAE Entry Permits / Residence Visas (front/back, photos or PDF scans).
Return ONLY one JSON object with the exact keys requested. No markdown.
If a field is missing, use null. Normalize whitespace (trim, collapse multiple spaces).
Dates: Prefer ISO YYYY-MM-DD if unambiguous; otherwise return as printed.
`;

export const VISA_USER_PROMPT = `
Extract these fields from the UAE visa document (entry permit or residence visa):

{
  "id_number": "string|null",        // UID / ID No. / Unified Number if present
  "file_number": "string|null",      // File No. / Sponsor File No.
  "passport_no": "string|null",
  "place_of_issue": "string|null",   // Place of issue (emirate/airport) if printed
  "name": "string|null",             // Full name in English (prefer English if bilingual)
  "profession": "string|null",
  "employer": "string|null",         // Sponsor / Employer name
  "issue_date": "YYYY-MM-DD or original|null",
  "expiry_date": "YYYY-MM-DD or original|null"
}

Rules:
- Do not invent values. If absent, return null.
- If both Arabic & English exist, return English.
- Merge multi-line fields with a single space.
- Keep punctuation/separators as printed for numbers (e.g., 784-XXXX-...).
`;
