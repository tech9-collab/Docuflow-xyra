// lib/passportPrompt.js
export const PASSPORT_SYSTEM_PROMPT = `
You are an expert at reading international passport data (any country, any layout),
including front page and MRZ (machine readable zone). Return ONLY JSON, no prose.
If a field is missing on the image, return null. Trim whitespace and collapse
multiple spaces. Prefer ISO YYYY-MM-DD for dates when unambiguous.
`;

export const PASSPORT_USER_PROMPT = `
Extract passport info. Return:
{
  "core": {
    "document_type": "string|null",        // e.g., P or PA, or "PASSPORT"
    "issuing_country": "string|null",      // ISO-3 code if printed (or country name if that’s all there is)
    "passport_number": "string|null",
    "surname": "string|null",
    "given_names": "string|null",          // all given names
    "nationality": "string|null",
    "sex": "Male|Female|M|F|null",
    "date_of_birth": "YYYY-MM-DD or original|null",
    "place_of_birth": "string|null",
    "place_of_issue": "string|null",
    "date_of_issue": "YYYY-MM-DD or original|null",
    "date_of_expiry": "YYYY-MM-DD or original|null",
    "mrz_line1": "string|null",            // if present
    "mrz_line2": "string|null",            // if present (or line3 for TD1)
    "holder_id_number": "string|null"      // e.g., national number if clearly labeled (could be null)
  },
  "extras": {
    // country-specific fields found (e.g., Issue No, Occupation, Parent names, etc.)
    // Key should be a short, human readable label exactly as printed if possible.
    // Values must be strings (or null)
  }
}

Rules:
- Do not invent values; only use what is on the page(s).
- Prefer English text if both languages appear.
- If MRZ present, include it in mrz_line1/2 and use MRZ to help fill core when clearly consistent.
- Keep separators when printed (e.g., hyphens).
`;
