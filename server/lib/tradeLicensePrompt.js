// lib/tradeLicensePrompt.js
export const TL_SYSTEM_PROMPT = `
You are an expert at reading UAE Trade/Business Licenses (free zones & mainland),
from PDFs or photos (front/back, multi-page). Return ONLY one JSON object.
If a field is missing, return null. Normalize whitespace (trim, collapse spaces).
Dates: Prefer ISO YYYY-MM-DD when unambiguous; otherwise return as printed.
`;

export const TL_USER_PROMPT = `
Extract these fields from the trade/business license:

{
  "company_name": "string|null",
  "formation_type": "string|null",       // e.g., Limited Liability Company
  "formation_number": "string|null",     // "Formation No." / "رقم التأسيس"
  "license_number": "string|null",       // "License No." / "رقم الرخصة"
  "license_formation_date": "YYYY-MM-DD or original|null",
  "issue_date": "YYYY-MM-DD or original|null",
  "expiry_date": "YYYY-MM-DD or original|null",
  "address": "string|null",
  "managers": "string|null",             // comma-separated if multiple
  "activities": "string|null",           // full text line as printed (English preferred)
  "activities_code": "string|null"       // code(s) like 4630.01, 7310.11 etc. (comma-separated if many)
}

Rules:
- Do not invent values; use null if absent.
- If both Arabic & English exist, return English.
- If multi-line fields exist (e.g., address, activities), collapse to single space.
- Keep punctuation/separators inside license numbers and codes if printed.
`;
