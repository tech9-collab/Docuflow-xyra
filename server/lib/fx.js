// lib/fx.js
// Uses ExchangeRate-API v6. We'll pull the USD table once and do cross-rates.

const FX_BASE = "USD";
const FX_URL = (key) =>
  `https://v6.exchangerate-api.com/v6/${key}/latest/${FX_BASE}`;

// Simple in-memory cache for the job (you can lift this to a process cache if you like)
export async function fetchUsdRatesOnce(apiKey, cache = {}) {
  if (!apiKey) throw new Error("Missing EXCHANGE_RATE_API_KEY");
  if (cache.usdQuote) return cache.usdQuote;

  const res = await fetch(FX_URL(apiKey));
  if (!res.ok)
    throw new Error(`FX fetch failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json?.result !== "success" || !json?.conversion_rates) {
    throw new Error("FX payload missing conversion_rates");
  }
  cache.usdQuote = json; // { base_code:'USD', conversion_rates:{ USD:1, AED:3.67, ... } }
  return cache.usdQuote;
}

/**
 * Convert an amount from `from` currency to AED using a USD-based table.
 * Cross-rate formula: rate(from→AED) = rate(USD→AED) / rate(USD→from)
 * @returns number|null
 */
export function toAED(amount, from, usdQuote) {
  if (amount == null || !Number.isFinite(Number(amount))) return null;
  if (!from) return null;

  const cur = String(from).toUpperCase();
  if (cur === "AED") return Number(amount);

  const rates = usdQuote?.conversion_rates || {};
  const rUSDToAED = rates["AED"];
  const rUSDToFrom = rates[cur];

  if (!rUSDToAED || !rUSDToFrom) return null; // unknown currency

  const cross = rUSDToAED / rUSDToFrom;
  return Number(amount) * cross;
}

export const round2 = (n) =>
  n == null ? null : Math.round((n + Number.EPSILON) * 100) / 100;
