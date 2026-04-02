// lib/visaNormalize.js
export const VISA_COLUMNS = [
  { key: "ID_NUMBER",      label: "ID Number" },
  { key: "FILE_NUMBER",    label: "File" },
  { key: "PASSPORT_NO",    label: "Passport No" },
  { key: "PLACE_OF_ISSUE", label: "Place of Issue" },
  { key: "NAME",           label: "Name" },
  { key: "PROFESSION",     label: "Profession" },
  { key: "EMPLOYER",       label: "Employer" },
  { key: "ISSUE_DATE",     label: "Issue Date" },
  { key: "EXPIRY_DATE",    label: "Expiry Date" },
  { key: "SOURCE",         label: "Source" } // filename/pages that contributed
];

const clean = (v) => {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s || null;
};

const normDate = (v) => {
  const s = clean(v);
  if (!s) return null;
  // try DD/MM/YYYY or DD-MM-YYYY or YYYY-MM-DD → YYYY-MM-DD
  const dmy = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (dmy) {
    const [ , d, m, y ] = dmy;
    const dd = d.padStart(2,"0"), mm = m.padStart(2,"0");
    return `${y}-${mm}-${dd}`;
  }
  const ymd = s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (ymd) {
    const [ , y, m, d ] = ymd;
    const dd = d.padStart(2,"0"), mm = m.padStart(2,"0");
    return `${y}-${mm}-${dd}`;
  }
  return s; // keep original if unknown format
};

export function normalizeVisaJson(j, sourceName = null) {
  const row = {
    ID_NUMBER:      clean(j?.id_number),
    FILE_NUMBER:    clean(j?.file_number),
    PASSPORT_NO:    clean(j?.passport_no),
    PLACE_OF_ISSUE: clean(j?.place_of_issue),
    NAME:           clean(j?.name),
    PROFESSION:     clean(j?.profession),
    EMPLOYER:       clean(j?.employer),
    ISSUE_DATE:     normDate(j?.issue_date),
    EXPIRY_DATE:    normDate(j?.expiry_date),
    SOURCE:         clean(sourceName),
  };
  return row;
}
