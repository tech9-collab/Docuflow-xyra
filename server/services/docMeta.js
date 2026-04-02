// server/services/docMeta.js
import * as GenAI from "@google/genai";
import fs from "node:fs/promises";
import path from "node:path";

const GoogleCtor =
    GenAI.GoogleGenAI || GenAI.GoogleAI || GenAI.GoogleGenerativeAI || GenAI.default || null;
if (!GoogleCtor) throw new Error("Unsupported @google/genai version.");

const ai = new GoogleCtor({ apiKey: process.env.GOOGLE_API_KEY });
const META_MODEL = process.env.GEMINI_META_MODEL || "gemini-2.0-flash";

/* ---------------- date helpers ---------------- */
function parseDateLoose(s) {
    if (!s) return null;
    const str = String(s).trim();
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
    let m = /^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{2,4})$/.exec(str);
    if (m) {
        const d = Number(m[1]); const mon = months[m[2].toLowerCase()]; const y = Number(m[3].length === 2 ? "20" + m[3] : m[3]);
        if (!isNaN(d) && mon != null && !isNaN(y)) return new Date(Date.UTC(y, mon, d));
    }
    m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(str);
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(str);
    if (m) return new Date(Date.UTC(Number(m[3].length === 2 ? "20" + m[3] : m[3]), Number(m[2]) - 1, Number(m[1])));
    return null;
}
function fmtDate(d) {
    if (!d) return "";
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/* ---------------- heuristics over tables ---------------- */
function findFirstValueByHeaderRegex(tables, rx) {
    for (const t of tables || []) {
        const hdr = Array.isArray(t.header) ? t.header : [];
        const rows = Array.isArray(t.rows) ? t.rows : [];
        const idx = hdr.findIndex(h => rx.test(h));
        if (idx === -1) continue;
        for (const row of rows) {
            const v = (row && typeof row === "object") ? row[hdr[idx]] : Array.isArray(row) ? row[idx] : "";
            const s = String(v ?? "").trim();
            if (s) return s;
        }
    }
    return "";
}
function computePeriodFromRows(union) {
    const hdrs = union?.headers || [];
    const rows = union?.rows || [];
    const idxDate = hdrs.findIndex(h => /(^|\s)date($|\s)/i.test(h));
    if (idxDate === -1) return { from: "", to: "" };
    let min = null, max = null;
    for (const r of rows) {
        const raw = r[hdrs[idxDate]];
        const d = parseDateLoose(raw);
        if (!d) continue;
        if (!min || d < min) min = d;
        if (!max || d > max) max = d;
    }
    return { from: fmtDate(min), to: fmtDate(max) };
}

/** Cheap heuristic extraction from tables only */
export function extractDocInfoHeuristic({ tables, union, docName }) {
    const accountNumber = findFirstValueByHeaderRegex(tables, /\b(account\s*(number|no\.?)|a\/?c\s*(no\.?)?)\b/i);
    const iban = findFirstValueByHeaderRegex(tables, /\bIBAN\b/i);
    const holder = findFirstValueByHeaderRegex(tables, /\b(account\s*(holder|name)|customer\s*name)\b/i);
    const address = findFirstValueByHeaderRegex(tables, /\b(address|mailing\s*address|postal)\b/i);
    const bank = findFirstValueByHeaderRegex(tables, /\b(bank|financial\s*institution|issuer)\b/i);
    const branch = findFirstValueByHeaderRegex(tables, /\bbranch\b/i);
    const swift = findFirstValueByHeaderRegex(tables, /\b(SWIFT|BIC)\b/i);
    const routing = findFirstValueByHeaderRegex(tables, /\b(routing\s*number|sort\s*code|IFSC)\b/i);
    const currency = findFirstValueByHeaderRegex(tables, /\b(currency|ccy)\b/i);
    const statementDate = findFirstValueByHeaderRegex(tables, /\b(statement\s*date|date\s*of\s*statement)\b/i);
    const periodFromCell = findFirstValueByHeaderRegex(tables, /\b(period\s*from|from\s*date)\b/i);
    const periodToCell = findFirstValueByHeaderRegex(tables, /\b(period\s*to|to\s*date)\b/i);

    const explicitFrom = fmtDate(parseDateLoose(periodFromCell));
    const explicitTo = fmtDate(parseDateLoose(periodToCell));
    const inferred = computePeriodFromRows(union);

    return {
        "Document Name": docName || "",
        "Bank Name": bank || "",
        "Branch": branch || "",
        "Account Holder": holder || "",
        "Account Number": accountNumber || "",
        "IBAN": iban || "",
        "SWIFT/BIC": swift || "",
        "Routing/Sort Code": routing || "",
        "Currency": currency || "",
        "Statement Date": fmtDate(parseDateLoose(statementDate)) || statementDate || "",
        "Statement Period From": explicitFrom || inferred.from || "",
        "Statement Period To": explicitTo || inferred.to || "",
        "Address": address || "",
    };
}

/* ---------------- AI pass over the original file ---------------- */
function guessMimeByExt(filePath, fallback = "application/pdf") {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".png") return "image/png";
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".webp") return "image/webp";
    if (ext === ".gif") return "image/gif";
    if (ext === ".tif" || ext === ".tiff") return "image/tiff";
    if (ext === ".pdf") return "application/pdf";
    return fallback;
}

/**
 * Extract metadata by sending the original file (PDF or image)
 * to a compact prompt that returns STRICT JSON. Works for any bank/locale.
 */
export async function extractDocInfoWithAI({ filePath, mimeType, fallbacks }) {
    try {
        const buf = await fs.readFile(filePath);
        const base64 = Buffer.from(buf).toString("base64");
        const mm = mimeType || guessMimeByExt(filePath, "application/octet-stream");

        const system = `
You extract top-of-document metadata from bank statements (any country/language).
Return STRICT JSON with these keys only (use empty string if unknown):

{
  "Document Name": "string",
  "Bank Name": "string",
  "Branch": "string",
  "Account Holder": "string",
  "Account Number": "string",
  "IBAN": "string",
  "SWIFT/BIC": "string",
  "Routing/Sort Code": "string",
  "Currency": "string",
  "Statement Date": "YYYY-MM-DD or empty string",
  "Statement Period From": "YYYY-MM-DD or empty string",
  "Statement Period To": "YYYY-MM-DD or empty string",
  "Address": "string"
}

Rules:
- Read the header/summary regions on the first 1–2 pages. Do not invent values.
- Normalize dates to YYYY-MM-DD if unambiguous; otherwise "".
- If multiple accounts appear, prefer the primary one shown as the statement subject.
- Preserve original casing for names/addresses. No comments or reasoning.
`;

        const user = `The inline file is a bank statement (PDF or image). Output ONLY the JSON object above.`;

        // Prefer new "responses" surface if available
        if (ai.responses && typeof ai.responses.generate === "function") {
            const resp = await ai.responses.generate({
                model: META_MODEL,
                input: [
                    { role: "system", parts: [{ text: system }] },
                    { role: "user", parts: [{ inlineData: { data: base64, mimeType: mm } }, { text: user }] }
                ],
                generationConfig: {
                    temperature: 0,
                    topK: 1,
                    topP: 0,
                    maxOutputTokens: 1024,
                    responseMimeType: "application/json"
                }
            });
            const txt = typeof resp.output_text === "string" ? resp.output_text : (await resp.response?.text?.());
            const parsed = JSON.parse(txt || "{}");
            return sanitizeAI(parsed, fallbacks);
        }

        // Fallback to older surface
        const resp = await ai.models.generateContent({
            model: META_MODEL,
            systemInstruction: { role: "system", parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ inlineData: { data: base64, mimeType: mm } }, { text: user }] }],
            generationConfig: {
                temperature: 0,
                topK: 1,
                topP: 0,
                maxOutputTokens: 1024,
                responseMimeType: "application/json"
            }
        });
        const txt = typeof resp.response?.text === "function" ? await resp.response.text() : "";
        const parsed = JSON.parse(txt || "{}");
        return sanitizeAI(parsed, fallbacks);
    } catch {
        return fallbacks;
    }
}

/* ---------------- sanitize / merge ---------------- */
function parseDateLooseMaybe(s) { return fmtDate(parseDateLoose(s)) || ""; }

function sanitizeAI(aiObj, fallbacks) {
    const coerce = (v) => (v == null ? "" : String(v));

    const out = {
        "Document Name": coerce(aiObj["Document Name"]) || fallbacks["Document Name"],
        "Bank Name": coerce(aiObj["Bank Name"]) || fallbacks["Bank Name"],
        "Branch": coerce(aiObj["Branch"]) || fallbacks["Branch"],
        "Account Holder": coerce(aiObj["Account Holder"]) || fallbacks["Account Holder"],
        "Account Number": coerce(aiObj["Account Number"]) || fallbacks["Account Number"],
        "IBAN": coerce(aiObj["IBAN"]) || fallbacks["IBAN"],
        "SWIFT/BIC": coerce(aiObj["SWIFT/BIC"]) || fallbacks["SWIFT/BIC"],
        "Routing/Sort Code": coerce(aiObj["Routing/Sort Code"]) || fallbacks["Routing/Sort Code"],
        "Currency": coerce(aiObj["Currency"]) || fallbacks["Currency"],
        "Statement Date": parseDateLooseMaybe(aiObj["Statement Date"]) || fallbacks["Statement Date"],
        "Statement Period From": parseDateLooseMaybe(aiObj["Statement Period From"]) || fallbacks["Statement Period From"],
        "Statement Period To": parseDateLooseMaybe(aiObj["Statement Period To"]) || fallbacks["Statement Period To"],
        "Address": coerce(aiObj["Address"]) || fallbacks["Address"],
    };
    return out;
}
