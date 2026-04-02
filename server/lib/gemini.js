// lib/gemini.js
import { GoogleGenAI } from "@google/genai";

const AI_KEY =
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.GOOGLEAI_API_KEY;
if (!AI_KEY) throw new Error("Missing GEMINI_API_KEY/GOOGLE_API_KEY");

export const ai = new GoogleGenAI({ apiKey: AI_KEY });

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_TEMPERATURE = Number(process.env.GEMINI_TEMPERATURE || 0);
const MAX_OUTPUT_TOKENS = Math.max(
  4096,
  Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 24576)
);

// Reusable retry with jitter
async function withRetry(fn, { retries = 6, baseMs = 1200 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      // Normalize status/code
      const code =
        e?.status || e?.response?.status || e?.error?.code || e?.code || 0;

      // Retry only on 429/5xx/network-ish
      const retryable =
        code === 0 || code === 429 || (code >= 500 && code < 600);

      if (i === retries || !retryable) break;
      const jitter = Math.floor(Math.random() * 250);
      const wait = baseMs * Math.pow(2, i) + jitter;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

export async function uploadBufferToGemini({ buffer, filename, mimeType }) {
  return await withRetry(
    async () => {
      let fileArg;
      if (typeof Blob !== "undefined") {
        fileArg = new Blob([buffer], {
          type: mimeType || "application/octet-stream",
        });
      } else {
        const { Readable } = await import("stream");
        fileArg = { data: Readable.from(buffer), mimeType };
      }

      const uploaded = await ai.files.upload({
        file: fileArg,
        config: {
          mimeType: mimeType || "application/octet-stream",
          displayName: filename || "upload",
        },
      });

      // Wait longer for ACTIVE under load
      return await waitUntilActive(uploaded.name, {
        tries: 120,
        delayMs: 2500,
      });
    },
    { retries: 6, baseMs: 1500 }
  );
}

export async function extractJsonFromFile({ file, systemPrompt, userPrompt }) {
  const result = await withRetry(
    async () => {
      return await ai.models.generateContent({
        model: MODEL,
        contents: [
          {
            role: "user",
            parts: [
              { text: systemPrompt.trim() },
              { fileData: { fileUri: file.uri, mimeType: file.mimeType } },
              { text: userPrompt.trim() },
            ],
          },
        ],
        generationConfig: {
          temperature: GEMINI_TEMPERATURE,
          // Dense invoice pages can contain many rows; keep this high to avoid truncation.
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          responseMimeType: "application/json",
        },
      });
    },
    { retries: 6, baseMs: 1500 }
  );

  const usage = extractUsageMetadata(result);
  const data = await parseResultAsJsonOrRetryableError(result);
  data.__usage = usage;
  return data;
}

export async function extractJsonFromInlineBuffer({
  buffer,
  mimeType,
  systemPrompt,
  userPrompt,
}) {
  if (!buffer) throw new Error("Missing buffer for inline Gemini extraction");
  const dataBase64 = Buffer.from(buffer).toString("base64");
  const mt = mimeType || "application/octet-stream";

  const result = await withRetry(
    async () => {
      return await ai.models.generateContent({
        model: MODEL,
        contents: [
          {
            role: "user",
            parts: [
              { text: systemPrompt.trim() },
              { inlineData: { mimeType: mt, data: dataBase64 } },
              { text: userPrompt.trim() },
            ],
          },
        ],
        generationConfig: {
          temperature: GEMINI_TEMPERATURE,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          responseMimeType: "application/json",
        },
      });
    },
    { retries: 6, baseMs: 1200 }
  );

  const usage = extractUsageMetadata(result);
  const data = await parseResultAsJsonOrRetryableError(result);
  data.__usage = usage;
  return data;
}

// Extract token usage from Gemini response
function extractUsageMetadata(result) {
  const meta =
    result?.usageMetadata ||
    result?.response?.usageMetadata ||
    result?.usage_metadata ||
    result?.response?.usage_metadata ||
    null;
  return {
    inputTokens: meta?.promptTokenCount || meta?.prompt_token_count || meta?.inputTokens || 0,
    outputTokens: meta?.candidatesTokenCount || meta?.candidates_token_count || meta?.outputTokens || 0,
  };
}

export { extractUsageMetadata };

async function parseResultAsJsonOrRetryableError(result) {
  const text =
    (typeof result?.response?.text === "function"
      ? await result.response.text()
      : null) ??
    // fallback: join parts if needed
    (Array.isArray(result?.response?.candidates)
      ? result.response.candidates
          .flatMap((c) => c?.content?.parts || [])
          .map((p) => p?.text || "")
          .join("")
      : null) ??
    // older shapes / wrappers
    result?.output_text ??
    result?.text ??
    "";

  const raw = String(text || "").trim();

  if (!raw || /^\s*null\s*$/i.test(raw)) {
    const err = new Error("Model returned empty/null JSON");
    err.status = 503;
    throw err;
  }

  const parsed = parseGeminiJson(raw);
  if (parsed == null) {
    const err = new Error("Model returned non-JSON or unparseable output");
    err.status = 503;
    throw err;
  }
  return parsed;
}

function parseGeminiJson(s) {
  let t = s.trim();

  // Strip triple backticks fences if present
  if (t.startsWith("```")) {
    t = t
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();
  }

  // If there is prose + JSON mixed, isolate the first JSON object/array
  const first = Math.min(
    ...["{", "["].map((ch) => t.indexOf(ch)).filter((i) => i >= 0)
  );
  const last = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (first >= 0 && last > first) {
    t = t.slice(first, last + 1);
  }

  // Try direct parse
  try {
    const val = JSON.parse(t);
    // Normalize return shape:
    // - If array → return array (controller already handles arrays)
    // - If object → return object (controller wraps it to [obj])
    // - If null → treat as no data (let caller decide)
    if (Array.isArray(val) || (val && typeof val === "object")) return val;
    return null;
  } catch {
    // As a last resort, try extracting only the outermost [] or {}
    const a1 = t.indexOf("[");
    const b1 = t.lastIndexOf("]");
    if (a1 !== -1 && b1 !== -1 && b1 > a1) {
      try {
        const arr = JSON.parse(t.slice(a1, b1 + 1));
        if (Array.isArray(arr)) return arr;
      } catch {}
    }
    const a2 = t.indexOf("{");
    const b2 = t.lastIndexOf("}");
    if (a2 !== -1 && b2 !== -1 && b2 > a2) {
      try {
        const obj = JSON.parse(t.slice(a2, b2 + 1));
        if (obj && typeof obj === "object") return obj;
      } catch {}
    }
    // No valid JSON
    return null;
  }
}

// Upload a local file by **path** (best for large PDFs)
export async function uploadPathToGemini({ path, filename, mimeType }) {
  return await withRetry(
    async () => {
      const uploaded = await ai.files.upload({
        file: path, // <-- path string (preferred for Node)
        config: {
          mimeType: mimeType || "application/octet-stream",
          displayName: filename || "upload",
        },
      });
      // Large PDFs can take a while; extend wait window
      return await waitUntilActive(uploaded.name, {
        // tries: 240,
        // delayMs: 2500,
        tries: 480,
        delayMs: 2500,
      });
    },
    { retries: 6, baseMs: 2000 }
  );
}

async function waitUntilActive(name, { tries = 60, delayMs = 2000 } = {}) {
  let f = await ai.files.get({ name });
  for (let i = 0; i < tries; i++) {
    if (!f?.state || String(f.state) === "ACTIVE") return f;
    if (String(f.state) === "FAILED") {
      const msg = f.error?.message || "Gemini file processing failed.";
      const code = f.error?.code || "";
      throw new Error(`Gemini upload failed: ${code} ${msg}`.trim());
    }
    await new Promise((r) => setTimeout(r, delayMs));
    f = await ai.files.get({ name });
  }
  throw new Error("Timed out waiting for Gemini to activate the file.");
}
