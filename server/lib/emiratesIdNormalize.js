// lib/emiratesIdNormalize.js

/** Collapse whitespace and trim. */
function clean(s) {
  if (s == null) return null;
  const t = String(s).replace(/\s+/g, " ").trim();
  return t || null;
}

/** Try to coerce common dd/mm/yyyy, dd-mm-yyyy, yyyy/mm/dd to ISO yyyy-mm-dd. */
function toISOorOriginal(s) {
  if (!s) return null;
  const t = clean(s);
  if (!t) return null;

  // yyyy-mm-dd or yyyy/mm/dd
  let m = t.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (m) {
    const [, Y, M, D] = m.map(Number);
    if (validYMD(Y, M, D)) return `${pad(Y,4)}-${pad(M,2)}-${pad(D,2)}`;
  }

  // dd-mm-yyyy or dd/mm/yyyy
  m = t.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (m) {
    const [, D, M, Y] = m.map(Number);
    if (validYMD(Y, M, D)) return `${pad(Y,4)}-${pad(M,2)}-${pad(D,2)}`;
  }

  return t;
}
function pad(n, w){ return String(n).padStart(w,"0"); }
function validYMD(Y,M,D){ return Y>=1900 && M>=1 && M<=12 && D>=1 && D<=31; }

/** Map Gemini JSON to a single row with your table keys. */
export function normalizeEmiratesIdJson(json, sourceName) {
  const row = {
    "ID NUMBER":     clean(json?.id_number),
    "NAME":          clean(json?.name),
    "DATE OF BIRTH": toISOorOriginal(json?.date_of_birth),
    "NATIONALITY":   clean(json?.nationality),
    "ISSUING DATE":  toISOorOriginal(json?.issuing_date),
    "EXPIRY DATE":   toISOorOriginal(json?.expiry_date),
    "SEX":           clean(json?.sex),
    "CARD NUMBER":   clean(json?.card_number),
    "OCCUPATION":    clean(json?.occupation),
    "EMPLOYER":      clean(json?.employer),
    "ISSUING PLACE": clean(json?.issuing_place),
    "SOURCE":        sourceName || null,
  };
  return row;
}

/** Columns (stable order) for table + Excel. */
export const EMIRATES_COLUMNS = [
  { key: "ID NUMBER",     label: "ID Number" },
  { key: "NAME",          label: "Name" },
  { key: "DATE OF BIRTH", label: "Date of Birth" },
  { key: "NATIONALITY",   label: "Nationality" },
  { key: "ISSUING DATE",  label: "Issuing Date" },
  { key: "EXPIRY DATE",   label: "Expiry Date" },
  { key: "SEX",           label: "Sex" },
  { key: "CARD NUMBER",   label: "Card Number" },
  { key: "OCCUPATION",    label: "Occupation" },
  { key: "EMPLOYER",      label: "Employer" },
  { key: "ISSUING PLACE", label: "Issuing Place" },
  { key: "SOURCE",        label: "Source" },
];
