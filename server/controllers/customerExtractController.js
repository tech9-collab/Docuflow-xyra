// controllers/customerExtractController.js
import fs from "fs/promises";
import { extractJsonFromInlineBuffer } from "../lib/gemini.js";

const SYSTEM_PROMPT = `You are an expert at reading UAE business documents (Trade Licenses, MOAs, Certificates of Incorporation).
Extract only the requested fields. Return ONLY a JSON object with no extra text.
If a field cannot be found in the document, return null for that field.
Dates: use ISO YYYY-MM-DD format when unambiguous; otherwise return as printed on the document.
If both Arabic and English text appear, prefer the English version.`;

const PROMPTS = {
  trade_license: `
Extract these fields from this UAE Trade License / Business License document:
{
  "tradeLicenseNumber": "string|null",
  "tradeLicenseAuthority": "string|null",
  "licenseIssueDate": "YYYY-MM-DD|null",
  "licenseExpiryDate": "YYYY-MM-DD|null",
  "dateOfIncorporation": "YYYY-MM-DD|null",
  "entityType": "string|null",
  "businessActivity": "string|null",
  "isFreezone": true|false|null,
  "freezoneName": "string|null"
}

Field notes:
- tradeLicenseAuthority: the full name of the issuing authority (e.g. "Department of Economic Development", "DIFC Authority", "DMCC", "JAFZA", "Abu Dhabi Global Market")
- dateOfIncorporation: the formation/establishment date (may be labelled "Formation Date", "Date of Incorporation", "Establishment Date")
- entityType: the legal form printed on the document (e.g. "Limited Liability Company", "Sole Establishment", "Branch of a Foreign Company", "Civil Company")
- businessActivity: the full activities text exactly as printed (collapse multi-line to single space)
- isFreezone: true if the issuing authority is a UAE free zone (DIFC, ADGM, JAFZA, DAFZA, DMCC, DSO, RAKEZ, KIZAD, etc.), otherwise false
- freezoneName: the free zone name if isFreezone is true, otherwise null
`,
  moa: `
Extract these fields from this Memorandum of Association (MOA) document:
{
  "dateOfIncorporation": "YYYY-MM-DD|null",
  "entityType": "string|null",
  "businessActivity": "string|null",
  "shareCapital": "string|null",
  "isFreezone": true|false|null,
  "freezoneName": "string|null"
}

Field notes:
- shareCapital: include currency and amount as printed (e.g. "AED 300,000")
- entityType: the legal form as printed
- isFreezone: true if the company is registered in a UAE free zone
`,
  incorporation: `
Extract these fields from this Certificate of Incorporation document:
{
  "dateOfIncorporation": "YYYY-MM-DD|null",
  "entityType": "string|null",
  "tradeLicenseNumber": "string|null",
  "tradeLicenseAuthority": "string|null",
  "isFreezone": true|false|null,
  "freezoneName": "string|null"
}
`,
};

// Map raw entity type string from document to form option values
function mapEntityType(raw) {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes("sole establishment") || lower.includes("establishment")) return "legal_llc";
  if (lower.includes("llc") || lower.includes("limited liability")) return "legal_llc";
  if (lower.includes("branch") || lower.includes("foreign")) return "legal_foreign";
  if (lower.includes("club") || lower.includes("association") || lower.includes("society")) return "legal_club";
  if (lower.includes("charity") || lower.includes("foundation")) return "legal_charity";
  if (lower.includes("federal") && lower.includes("government")) return "legal_federal";
  if (lower.includes("emirate") && lower.includes("government")) return "legal_emirate";
  if (lower.includes("partnership")) return "partnership";
  if (lower.includes("civil company")) return "legal_llc";
  return null;
}

// Normalise a date string: ensure it is YYYY-MM-DD if already in that format,
// otherwise return it as-is so the UI can still display it.
function normaliseDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Try DD/MM/YYYY or DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return s;
}

export async function extractDocument(req, res) {
  let filePath = null;
  try {
    const { docType } = req.body;
    const file = req.file;

    if (!file) return res.status(400).json({ message: "No file uploaded" });
    filePath = file.path;

    if (!docType || !PROMPTS[docType]) {
      return res.status(400).json({ message: "Unsupported document type for extraction" });
    }

    const buffer = await fs.readFile(file.path);

    // Determine MIME type
    const ext = (file.originalname || "").split(".").pop().toLowerCase();
    const mimeMap = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
    const mimeType = file.mimetype || mimeMap[ext] || "application/octet-stream";

    const raw = await extractJsonFromInlineBuffer({
      buffer,
      mimeType,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: PROMPTS[docType],
    });

    // Build the result object with only non-null values
    const result = {};

    if (raw.tradeLicenseNumber) result.tradeLicenseNumber = String(raw.tradeLicenseNumber).trim();
    if (raw.tradeLicenseAuthority) result.tradeLicenseAuthority = String(raw.tradeLicenseAuthority).trim();
    if (raw.licenseIssueDate) result.licenseIssueDate = normaliseDate(raw.licenseIssueDate);
    if (raw.licenseExpiryDate) result.licenseExpiryDate = normaliseDate(raw.licenseExpiryDate);
    if (raw.dateOfIncorporation) result.dateOfIncorporation = normaliseDate(raw.dateOfIncorporation);
    if (raw.businessActivity) result.businessActivity = String(raw.businessActivity).trim();
    if (raw.shareCapital) result.shareCapital = String(raw.shareCapital).trim();

    const mappedType = mapEntityType(raw.entityType);
    if (mappedType) result.entityType = mappedType;

    if (raw.isFreezone !== null && raw.isFreezone !== undefined) {
      result.isFreezone = Boolean(raw.isFreezone);
    }
    if (raw.freezoneName) result.freezoneName = String(raw.freezoneName).trim();

    res.json({ extracted: result });
  } catch (err) {
    console.error("extractDocument error:", err);
    res.status(500).json({ message: "Failed to extract document data: " + (err.message || "Unknown error") });
  } finally {
    if (filePath) fs.unlink(filePath).catch(() => {});
  }
}
