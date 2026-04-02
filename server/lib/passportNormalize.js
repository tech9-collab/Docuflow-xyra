// lib/passportNormalize.js

// Core columns (fixed order)
export const PASSPORT_CORE_COLUMNS = [
  { key: "DOCUMENT_TYPE",  label: "Type" },
  { key: "ISSUING_COUNTRY",label: "Country Code" },
  { key: "PASSPORT_NUMBER",label: "Passport No" },
  { key: "SURNAME",        label: "Surname" },
  { key: "GIVEN_NAMES",    label: "Given Name(s)" },
  { key: "NATIONALITY",    label: "Nationality" },
  { key: "SEX",            label: "Sex" },
  { key: "DATE_OF_BIRTH",  label: "Date of Birth" },
  { key: "PLACE_OF_BIRTH", label: "Place of Birth" },
  { key: "PLACE_OF_ISSUE", label: "Place of Issue" },
  { key: "DATE_OF_ISSUE",  label: "Date of Issue" },
  { key: "DATE_OF_EXPIRY", label: "Date of Expiry" },
  { key: "HOLDER_ID_NUMBER", label: "National/ID No" },
  { key: "MRZ_LINE1",      label: "MRZ Line 1" },
  { key: "MRZ_LINE2",      label: "MRZ Line 2" },
  { key: "SOURCE",         label: "Source" },
];

// normalize helpers
const clean = (s) => {
  if (s === null || s === undefined) return null;
  const t = String(s).trim().replace(/\s+/g, " ");
  return t || null;
};

const upper = (s) => (s ? String(s).toUpperCase() : s);
const title = (s) =>
  s
    ? s
        .toLowerCase()
        .replace(/\b\w/g, (m) => m.toUpperCase())
        .replace(/\s+/g, " ")
    : s;

// Very light MRZ parser (optional) – fills missing core if MRZ looks valid.
function parseMrz(m1, m2) {
  if (!m1 || !m2) return {};
  const L1 = m1.replace(/<+/g, "<").trim();
  const L2 = m2.replace(/<+/g, "<").trim();

  // TD3 format quick checks
  // L1: P<COUNTRYSURNAME<<GIVEN<<<
  // L2: PassportNoCountryDOBSexExpiry... (we’ll only pull a few robust bits)
  const out = {};
  try {
    // issuing_country from L1 (pos 2-4)
    const ic = L1.substring(2, 5).replace(/<+/g, "");
    if (ic) out.issuing_country = ic;

    // surname/given from L1 after country
    const namePart = L1.substring(5).replace(/<+/g, " ").trim();
    if (namePart) {
      const [surname, rest] = namePart.split("  ").filter(Boolean);
      if (surname) out.surname = surname.trim();
      if (rest) out.given_names = rest.trim();
    }

    // DOB, sex, expiry from L2 (TD3 positions)
    // L2: passportNumber (9) + check + nationality(3) + dob(6) + check + sex(1) + expiry(6) + check ...
    const dobRaw = L2.substring(13, 19);
    const sex = L2.substring(20, 21);
    const expRaw = L2.substring(21, 27);
    if (/^\d{6}$/.test(dobRaw)) out.date_of_birth = yymmddToIso(dobRaw);
    if (sex === "M" || sex === "F") out.sex = sex;
    if (/^\d{6}$/.test(expRaw)) out.date_of_expiry = yymmddToIso(expRaw);
  } catch { /* ignore */ }

  return out;
}

function yymmddToIso(yyMMdd) {
  // naive century guess; adjust if needed
  const yy = Number(yyMMdd.slice(0, 2));
  const mm = yyMMdd.slice(2, 4);
  const dd = yyMMdd.slice(4, 6);
  const yyyy = yy >= 50 ? 1900 + yy : 2000 + yy;
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Normalize a single model JSON -> row with core + extras
 * @param {object} modelJSON  { core: {...}, extras: {...} }
 * @param {string} sourceName original file/page name
 * @returns {object} row + attached extras object (row.__extras)
 */
export function normalizePassportJson(modelJSON, sourceName) {
  const core = modelJSON?.core || {};
  const extras = modelJSON?.extras || {};

  // Optional MRZ backfill (only if present)
  const mrzBackfill = parseMrz(core?.mrz_line1 || null, core?.mrz_line2 || null);

  // pick / coalesce
  const row = {
    DOCUMENT_TYPE: clean(core.document_type) || clean(extras.type) || null,
    ISSUING_COUNTRY: upper(clean(core.issuing_country)) || null,
    PASSPORT_NUMBER: clean(core.passport_number),
    SURNAME: upper(clean(core.surname)),
    GIVEN_NAMES: upper(clean(core.given_names)),
    NATIONALITY: upper(clean(core.nationality)),
    SEX: normalizeSex(clean(core.sex)),
    DATE_OF_BIRTH: clean(core.date_of_birth),
    PLACE_OF_BIRTH: title(clean(core.place_of_birth)),
    PLACE_OF_ISSUE: title(clean(core.place_of_issue)),
    DATE_OF_ISSUE: clean(core.date_of_issue),
    DATE_OF_EXPIRY: clean(core.date_of_expiry),
    HOLDER_ID_NUMBER: clean(core.holder_id_number) || clean(extras["National Number"]) || null,
    MRZ_LINE1: clean(core.mrz_line1),
    MRZ_LINE2: clean(core.mrz_line2),
    SOURCE: sourceName || null,
  };

  // MRZ backfill only if missing
  row.ISSUING_COUNTRY = row.ISSUING_COUNTRY || upper(clean(mrzBackfill.issuing_country));
  row.SURNAME = row.SURNAME || upper(clean(mrzBackfill.surname));
  row.GIVEN_NAMES = row.GIVEN_NAMES || upper(clean(mrzBackfill.given_names));
  row.SEX = row.SEX || normalizeSex(clean(mrzBackfill.sex));
  row.DATE_OF_BIRTH = row.DATE_OF_BIRTH || clean(mrzBackfill.date_of_birth);
  row.DATE_OF_EXPIRY = row.DATE_OF_EXPIRY || clean(mrzBackfill.date_of_expiry);

  // Attach extras for column union later
  const cleanedExtras = {};
  for (const [k, v] of Object.entries(extras || {})) {
    const key = tidyExtraKey(k);
    const val = clean(v);
    if (key && val !== null) cleanedExtras[key] = val;
  }
  row.__extras = cleanedExtras;

  return row;
}

function normalizeSex(s) {
  if (!s) return null;
  const t = s.toString().trim().toUpperCase();
  if (t === "M" || t === "MALE") return "Male";
  if (t === "F" || t === "FEMALE") return "Female";
  return s; // leave unknown
}

// Make extra keys nice column headers
function tidyExtraKey(k) {
  if (!k) return null;
  return k
    .toString()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[:：]+$/, "")
    .replace(/\bno\.?$/i, "No")
    .replace(/\bNATIONAL\s*NUMBER\b/i, "National Number")
    .replace(/\bISSUE\s*NO\b/i, "Issue No")
    .replace(/\bOCCUPATION\b/i, "Occupation")
    .replace(/\bFATHER(?:'S)?\s*NAME\b/i, "Father Name")
    .replace(/\bMOTHER(?:'S)?\s*NAME\b/i, "Mother Name");
}

/**
 * Compute final columns + rows by unioning extras keys across batch.
 * @param {object[]} normalizedRows rows from normalizePassportJson
 * @param {object} options { extrasPrefix?: string, flattenExtras?: boolean }
 * @returns {{ columns, rows }}
 */
export function finalizePassportColumnsRows(normalizedRows, { flattenExtras = true, extrasPrefix = "EXTRA: " } = {}) {
  const coreOrder = PASSPORT_CORE_COLUMNS.map(c => c.key);

  if (!flattenExtras) {
    // Single JSON column for extras
    const columns = [...PASSPORT_CORE_COLUMNS, { key: "EXTRAS_JSON", label: "Extras (JSON)" }];
    const rows = normalizedRows.map(r => ({
      ...stripMeta(r),
      EXTRAS_JSON: Object.keys(r.__extras || {}).length ? JSON.stringify(r.__extras) : null
    }));
    return { columns, rows };
  }

  // Union extras keys
  const extrasSet = new Set();
  normalizedRows.forEach(r => {
    Object.keys(r.__extras || {}).forEach(k => extrasSet.add(`${extrasPrefix}${k}`));
  });
  const extraColumns = Array.from(extrasSet).sort().map(k => ({ key: k, label: k }));

  // Build columns + rows
  const columns = [...PASSPORT_CORE_COLUMNS, ...extraColumns];
  const rows = normalizedRows.map(r => {
    const base = stripMeta(r);
    for (const col of extraColumns) {
      const rawKey = col.key.replace(extrasPrefix, "");
      base[col.key] = r.__extras?.[rawKey] ?? null;
    }
    return base;
  });

  return { columns, rows };
}

function stripMeta(r) {
  const { __extras, ...plain } = r;
  return plain;
}
