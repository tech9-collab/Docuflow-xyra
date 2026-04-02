// server/services/workers/geminiWorker.js
import { parentPort, workerData } from "node:worker_threads";
import * as GenAI from "@google/genai";
import fs from "node:fs/promises";

function timeout(ms) {
  return new Promise((_, rej) =>
    setTimeout(() => rej(new Error(`genai timeout after ${ms}ms`)), ms)
  );
}

function extractText(resp) {
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

function safeParseJson(s) {
  const raw = String(s || "")
    .trim()
    .replace(/^```json\s*|\s*```$/g, "")
    .trim();
  try {
    return JSON.parse(raw);
  } catch {}
  const starts = [raw.indexOf("{"), raw.indexOf("[")].filter((i) => i >= 0);
  if (!starts.length) throw new Error("Model returned invalid JSON");
  const start = Math.min(...starts);
  const open = raw[start],
    close = open === "{" ? "}" : "]";
  let depth = 0,
    inStr = false,
    esc = false;
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
        } catch {}
        break;
      }
    }
  }
  throw new Error("Model returned invalid JSON");
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

async function callGenAI({ apiKey, model, sys, up, base64, mime }) {
  const GoogleCtor =
    GenAI.GoogleGenAI ||
    GenAI.GoogleAI ||
    GenAI.GoogleGenerativeAI ||
    GenAI.default ||
    null;
  if (!GoogleCtor)
    throw new Error("Unsupported @google/genai version in worker");

  const ai = new GoogleCtor({ apiKey });
  const generationConfig = {
    temperature: 0,
    topK: 1,
    topP: 0,
    candidateCount: 1,
    seed: 42,
    maxOutputTokens: 8192,
  };

  if (ai.responses && typeof ai.responses.generate === "function") {
    const resp = await ai.responses.generate({
      model,
      systemInstruction: { role: "system", parts: [{ text: sys }] },
      input: [
        {
          role: "user",
          parts: [
            { inlineData: { data: base64, mimeType: mime } },
            { text: up },
          ],
        },
      ],
      generationConfig,
    });
    const usage = extractUsageFromResp(resp);
    const parsed = safeParseJson(extractText(resp));
    return { __parsed: parsed, __usage: usage };
  }

  if (ai.models && typeof ai.models.generateContent === "function") {
    const resp = await ai.models.generateContent({
      model,
      systemInstruction: { role: "system", parts: [{ text: sys }] },
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { data: base64, mimeType: mime } },
            { text: up },
          ],
        },
      ],
      generationConfig,
    });
    const usage = extractUsageFromResp(resp);
    const parsed = safeParseJson(extractText(resp));
    return { __parsed: parsed, __usage: usage };
  }

  throw new Error("No responses/models surface in worker");
}

(async () => {
  const {
    filePath,
    mimeType,
    systemPrompt,
    userPrompt,
    modelFlash,
    modelPro,
    timeoutMs,
    maxRetries,
    apiKey,
  } = workerData;

  const buf = await fs.readFile(filePath);
  const base64 = buf.toString("base64");

  let attempt = 0,
    lastErr = null;

  while (attempt < maxRetries) {
    attempt++;
    try {
      const flashResult = await Promise.race([
        callGenAI({
          apiKey,
          model: modelFlash,
          sys: systemPrompt,
          up: userPrompt,
          base64,
          mime: mimeType,
        }),
        timeout(timeoutMs),
      ]);
      return parentPort.postMessage({ ok: true, data: flashResult.__parsed, usage: flashResult.__usage });
    } catch (e1) {
      lastErr = e1;
      try {
        const proResult = await Promise.race([
          callGenAI({
            apiKey,
            model: modelPro,
            sys: systemPrompt,
            up: userPrompt,
            base64,
            mime: mimeType,
          }),
          timeout(timeoutMs),
        ]);
        return parentPort.postMessage({ ok: true, data: proResult.__parsed, usage: proResult.__usage });
      } catch (e2) {
        lastErr = e2;
        const wait =
          Math.min(8000, 600 * attempt) + Math.floor(Math.random() * 1200);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  parentPort.postMessage({
    ok: false,
    error: String(lastErr?.message || lastErr || "genai failed"),
  });
})().catch((e) => {
  parentPort.postMessage({ ok: false, error: String(e?.message || e) });
});
