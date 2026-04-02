// server/services/gemini.js
import * as GenAI from "@google/genai";
import fs from "node:fs/promises";

/* ─────────────────────────────────────────────────────────────
   Config
────────────────────────────────────────────────────────────── */
const MODEL_FLASH = process.env.GEMINI_FLASH || "gemini-2.5-flash";
const MODEL_PRO = process.env.GEMINI_MODEL_PRO || "gemini-2.5-pro";

const GEMINI_TIMEOUT_MS = Math.max(
  10000,
  Number(process.env.GEMINI_TIMEOUT_MS || 45000)
);
const GEMINI_MAX_RETRIES = Math.max(
  1,
  Number(process.env.GEMINI_MAX_RETRIES || 2)
);

export const DEFAULT_CHUNK_PAGES = Math.max(
  2,
  Number(process.env.BANK_CHUNK_PAGES || 3)
);

/* ─────────────────────────────────────────────────────────────
   SDK shim
────────────────────────────────────────────────────────────── */
const GoogleCtor =
  GenAI.GoogleGenAI ||
  GenAI.GoogleAI ||
  GenAI.GoogleGenerativeAI ||
  GenAI.default ||
  null;

if (!GoogleCtor) {
  throw new Error("Unsupported @google/genai version – no GoogleGenAI ctor.");
}

const ai = new GoogleCtor({ apiKey: process.env.GOOGLE_API_KEY });

/* ─────────────────────────────────────────────────────────────
   In-memory job store
────────────────────────────────────────────────────────────── */
const JOBS = new Map(); // jobId -> { status, originalName, mimeType, filePath?, error? }
const RESULTS = new Map(); // jobId -> { headers: [...], rows: [ {col:val} ] }

const jid = () =>
  "job_" + Math.random().toString(36).slice(2) + Date.now().toString(36);

/* ─────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */
const toBase64 = (buf) => Buffer.from(buf).toString("base64");

function safeParseJson(s) {
  const raw = String(s || "")
    .trim()
    .replace(/^```json\s*|\s*```$/g, "")
    .trim();

  try {
    return JSON.parse(raw);
  } catch {
    // salvage below
  }

  const starts = [raw.indexOf("{"), raw.indexOf("[")].filter((i) => i >= 0);
  if (!starts.length) throw new Error("Model returned invalid JSON");

  const start = Math.min(...starts);
  const open = raw[start];
  const close = open === "{" ? "}" : "]";

  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        const candidate = raw.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          break;
        }
      }
    }
  }

  throw new Error("Model returned invalid JSON (could not salvage).");
}

function extractUsageFromResp(resp) {
  const meta =
    resp?.usageMetadata ||
    resp?.response?.usageMetadata ||
    resp?.usage_metadata ||
    resp?.response?.usage_metadata ||
    null;
  return {
    inputTokens: meta?.promptTokenCount || meta?.prompt_token_count || meta?.inputTokens || 0,
    outputTokens: meta?.candidatesTokenCount || meta?.candidates_token_count || meta?.outputTokens || 0,
  };
}

function extractTextFromGenAI(resp) {
  if (!resp) return "";
  if (typeof resp.output_text === "string") return resp.output_text;
  if (typeof resp.text === "function") return resp.text();
  if (resp.response && typeof resp.response.text === "function")
    return resp.response.text();

  const cand = resp.candidates?.[0] || resp.response?.candidates?.[0] || null;
  if (cand?.content?.parts?.length) {
    const parts = cand.content.parts.map((p) => p.text ?? "").filter(Boolean);
    if (parts.length) return parts.join("");
  }

  const parts = resp.content?.parts;
  if (Array.isArray(parts)) {
    const s = parts
      .map((p) => p.text ?? "")
      .filter(Boolean)
      .join("");
    if (s) return s;
  }

  return "";
}


function normalizeLLMJson(raw) {
  if (!raw || typeof raw !== "object") {
    return { headers: [], rows: [], summary: {} };
  }

  // ---- 1) Extract summary if present ----
  let summary = {};
  if (
    raw.summary &&
    typeof raw.summary === "object" &&
    !Array.isArray(raw.summary)
  ) {
    summary = raw.summary;
  }

  // ---- 2) Support new shape: { transactions: { headers, rows }, summary: {...} } ----
  let base = raw;
  if (
    raw.transactions &&
    typeof raw.transactions === "object" &&
    !Array.isArray(raw.transactions)
  ) {
    base = raw.transactions;
  }

  let headers = [];
  let rows = [];

  if (Array.isArray(base.headers)) {
    headers = base.headers.map((h) => String(h ?? "").trim());
  }

  if (Array.isArray(base.rows)) {
    rows = base.rows;
  } else if (Array.isArray(base.data)) {
    rows = base.data;
  } else if (Array.isArray(base.table)) {
    rows = base.table;
  }

  // If headers empty but rows are objects → infer headers
  if (
    !headers.length &&
    Array.isArray(rows) &&
    rows.length &&
    typeof rows[0] === "object" &&
    !Array.isArray(rows[0])
  ) {
    const set = new Set();
    for (const r of rows) {
      Object.keys(r || {}).forEach((k) => set.add(k));
    }
    headers = Array.from(set);
  }

  // If still no headers and rows are arrays → synthesize generic headers
  if (
    !headers.length &&
    Array.isArray(rows) &&
    rows.length &&
    Array.isArray(rows[0])
  ) {
    const maxLen = rows.reduce((mx, r) => Math.max(mx, r.length), 0);
    headers = Array.from({ length: maxLen }, (_, i) => `Col ${i + 1}`);
  }

  // Convert rows → objects with those headers
  let objRows = [];
  if (Array.isArray(rows) && rows.length) {
    if (Array.isArray(rows[0])) {
      // array-of-arrays
      objRows = rows.map((arr) => {
        const o = {};
        headers.forEach((h, idx) => {
          o[h] = arr[idx] ?? "";
        });
        return o;
      });
    } else {
      // array-of-objects
      objRows = rows.map((r) => {
        const o = {};
        headers.forEach((h) => {
          o[h] = (r && r[h]) ?? "";
        });
        return o;
      });
    }
  }

  return { headers, rows: objRows, summary };
}

/* ─────────────────────────────────────────────────────────────
   Direct Gemini call (no workers, new prompt)
────────────────────────────────────────────────────────────── */

const BANK_SYSTEM_PROMPT = `
You are a strict JSON-only bank statement parser.

You will be sent a bank statement page (image or PDF).

Your job has TWO parts:

1) Extract the TRANSACTION TABLE with ALL transaction rows.
2) Extract the ACCOUNT SUMMARY / KEY ACCOUNT DETAILS (from anywhere on the page),
   such as account holder name, account number, statement period, opening balance,
   closing balance, currency, bank name, branch, IFSC / sort code, etc.

You MUST respond with JSON ONLY, no explanation, no prose.

The JSON MUST have this shape exactly:

{
  "transactions": {
    "headers": ["Header1", "Header2", ...],
    "rows": [
      ["row1-col1", "row1-col2", ...],
      ["row2-col1", "row2-col2", ...]
    ]
  },
  "summary": {
    "Some Label": "Some Value",
    "Another Label": "Another Value"
    // ...any number of key-value pairs
  }
}

VERY IMPORTANT:
- "transactions.headers" must be an array of strings.
- "transactions.rows" must be an array of arrays.
- Each inner array in "transactions.rows" must have the same length as "transactions.headers".
- "summary" must be a flat JSON object of key-value pairs (no arrays).
- Do NOT skip any transaction row.
- Do NOT aggregate, summarize, or merge multiple rows into one.
- Include every visible transaction line in order.

Columns of interest for transactions:
- Date
- Description
- Reference Number
- Debit
- Credit
- Balance

Headers rules for "transactions.headers":
- If the statement has a date column, include it as "Date".
- Prefer these exact header names (if present in the statement):
  - "Date"
  - "Description"
  - "Reference Number"
  - "Debit"
  - "Credit"
  - "Balance"
- If a logical field is not present (e.g. no separate reference number),
  you may omit that column OR include it with empty strings.

General rules:
- Do NOT include any keys other than "transactions" and "summary".
- Do NOT wrap JSON in markdown.
`.trim();

const BANK_USER_PROMPT = `
From this bank statement page:

1) Extract the TRANSACTION TABLE.

For EACH transaction row, include:
- Date (if visible)
- Description
- Reference Number (if visible)
- Debit or withdrawal amount (if visible)
- Credit or deposit amount (if visible)
- Running or closing Balance (if visible)

The "transactions.headers" should be human readable column names such as:
["Date", "Description", "Reference Number", "Debit", "Credit", "Balance"]
(or a subset if some columns truly do not exist on this statement).

Each transaction row must be a simple array of strings aligned to "transactions.headers".

2) Extract the ACCOUNT SUMMARY into "summary" as key-value pairs, for example:
- "Account Holder Name": "..."
- "Account Number": "..."
- "Statement Period From": "..."
- "Statement Period To": "..."
- "Opening Balance": "..."
- "Closing Balance": "..."
- "Currency": "AED"
- "Bank Name": "..."
- etc.

If a particular detail is not visible on this page, simply omit that key.

Remember: respond with JSON only, in this exact shape:
{
  "transactions": { "headers": [...], "rows": [...] },
  "summary": { ...key-value pairs... }
}
`.trim();

async function callGeminiOnce({ buffer, mimeType, modelId }) {
  const base64 = toBase64(buffer);
  const generationConfig = {
    temperature: 0,
    topK: 1,
    topP: 0,
    candidateCount: 1,
    seed: 42,
    maxOutputTokens: 8192,
  };

  // New style
  if (ai.responses && typeof ai.responses.generate === "function") {
    const resp = await ai.responses.generate({
      model: modelId,
      systemInstruction: {
        role: "system",
        parts: [{ text: BANK_SYSTEM_PROMPT }],
      },
      input: [
        {
          role: "user",
          parts: [
            { inlineData: { data: base64, mimeType } },
            { text: BANK_USER_PROMPT },
          ],
        },
      ],
      generationConfig,
    });
    const text = extractTextFromGenAI(resp);
    const usage = extractUsageFromResp(resp);
    const parsed = safeParseJson(text);
    return { __parsed: parsed, __usage: usage };
  }

  // Older style
  if (ai.models && typeof ai.models.generateContent === "function") {
    const resp = await ai.models.generateContent({
      model: modelId,
      systemInstruction: {
        role: "system",
        parts: [{ text: BANK_SYSTEM_PROMPT }],
      },
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { data: base64, mimeType } },
            { text: BANK_USER_PROMPT },
          ],
        },
      ],
      generationConfig,
    });
    const text = extractTextFromGenAI(resp);
    const usage = extractUsageFromResp(resp);
    const parsed = safeParseJson(text);
    return { __parsed: parsed, __usage: usage };
  }

  throw new Error("This @google/genai version lacks generate methods.");
}

async function runExtraction(buffer, mimeType) {
  let attempt = 0;
  let lastError = null;

  while (attempt < GEMINI_MAX_RETRIES) {
    attempt++;

    try {
      // FLASH first
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
      try {
        const result = await callGeminiOnce({
          buffer,
          mimeType,
          modelId: MODEL_FLASH,
        });
        clearTimeout(timer);
        const normalized = normalizeLLMJson(result.__parsed);
        normalized.__usage = result.__usage;
        return normalized;
      } catch (e) {
        clearTimeout(timer);
        lastError = e;
        const msg = String(e?.message || e);
        const shouldFallback =
          /invalid json|too large|safety|blocked|quota|exceeded|context|length|token|timeout|aborted/i.test(
            msg
          );
        if (!shouldFallback) throw e;
      }

      // Fallback: PRO
      const controller2 = new AbortController();
      const timer2 = setTimeout(() => controller2.abort(), GEMINI_TIMEOUT_MS);
      try {
        const result = await callGeminiOnce({
          buffer,
          mimeType,
          modelId: MODEL_PRO,
        });
        clearTimeout(timer2);
        const normalized = normalizeLLMJson(result.__parsed);
        normalized.__usage = result.__usage;
        return normalized;
      } catch (e2) {
        clearTimeout(timer2);
        lastError = e2;
      }
    } catch (e) {
      lastError = e;
    }

    await new Promise((r) =>
      setTimeout(r, 500 * attempt + Math.random() * 300)
    );
  }

  throw lastError || new Error("Gemini extraction failed");
}

/* ─────────────────────────────────────────────────────────────
   Public Job API (file-path based, no workers)
────────────────────────────────────────────────────────────── */

async function runExtractionAndStore(jobId, filePath, mimeType) {
  try {
    const buf = await fs.readFile(filePath);
    const normalized = await runExtraction(buf, mimeType); // { headers, rows }

    RESULTS.set(jobId, normalized);
    const j = JOBS.get(jobId);
    if (j) JOBS.set(jobId, { ...j, status: "completed" });
  } catch (err) {
    console.error("runExtractionAndStore error:", err?.message || err);
    const j = JOBS.get(jobId);
    if (j)
      JOBS.set(jobId, {
        ...j,
        status: "error",
        error: err?.message || "failed",
      });
  }
}

export async function startJobFromFile(
  filePath,
  originalName,
  mimeType,
  _opts = {}
) {
  const jobId = jid();
  JOBS.set(jobId, {
    status: "processing",
    originalName,
    mimeType,
    filePath,
  });
  // fire & forget
  runExtractionAndStore(jobId, filePath, mimeType);
  return jobId;
}

export async function startJobWithModeFromFile(
  filePath,
  originalName,
  mimeType,
  _mode = "normal",
  _pagesInChunk = 1
) {
  // mode/pages kept for compatibility, ignored in this simple pipeline
  return startJobFromFile(filePath, originalName, mimeType);
}

/* Back-compat (buffer callers) */
export async function startJob(buffer, originalName, mimeType) {
  const tmp = `./tmp_${Date.now().toString(36)}.bin`;
  await fs.writeFile(tmp, buffer);
  return startJobFromFile(tmp, originalName, mimeType);
}

export async function startJobWithMode(
  buffer,
  originalName,
  mimeType,
  _mode = "normal"
) {
  const tmp = `./tmp_${Date.now().toString(36)}.bin`;
  await fs.writeFile(tmp, buffer);
  return startJobFromFile(tmp, originalName, mimeType);
}

/* ─────────────────────────────────────────────────────────────
   Simple result API
────────────────────────────────────────────────────────────── */
export async function getStatus(jobId) {
  const j = JOBS.get(jobId);
  if (!j) return { status: "error" };
  return j.error ? { status: j.status, error: j.error } : { status: j.status };
}

export async function getResult(jobId) {
  const j = JOBS.get(jobId);
  if (!j) return { status: "error" };
  if (j.status !== "completed") return { status: j.status };

  const data = RESULTS.get(jobId);
  if (!data) return { status: "error" };

  // NOTE: we RETURN headers + rows directly (no processed_json_url)
  return {
    status: "completed",
    data, // { headers, rows }
  };
}

export { JOBS, RESULTS };
