// lib/tradeLicenseNormalize.js

const clean = (v) => {
    if (v == null) return null;
    const s = String(v).replace(/\s+/g, " ").trim();
    return s || null;
};

const toISOorOriginal = (v) => {
    const s = clean(v);
    if (!s) return null;

    // dd/mm/yyyy or dd-mm-yyyy
    let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) {
        const [, d, mo, y] = m;
        return `${y.padStart(4, "0")}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    // yyyy-mm-dd or yyyy/mm/dd
    m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
    if (m) {
        const [, y, mo, d] = m;
        return `${y.padStart(4, "0")}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    return s; // unknown format -> keep original
};

export const TL_COLUMNS = [
    { key: "COMPANY_NAME", label: "Company Name" },
    { key: "FORMATION_TYPE", label: "Formation Type" },
    { key: "FORMATION_NUMBER", label: "Formation No" },
    { key: "LICENSE_NUMBER", label: "License No" },
    { key: "LICENSE_FORMATION_DATE", label: "License Formation Date" },
    { key: "ISSUE_DATE", label: "Issue Date" },
    { key: "EXPIRY_DATE", label: "Expiry Date" },
    { key: "ADDRESS", label: "Address" },
    { key: "MANAGERS", label: "Managers" },
    { key: "ACTIVITIES", label: "Activities" },
    { key: "ACTIVITIES_CODE", label: "Code" },
    { key: "ISSUING_AUTHORITY", label: "Issuing Authority" },
    { key: "VAT_TRN", label: "VAT TRN" },
    { key: "VAT_REGISTERED_DATE", label: "VAT Reg Date" },
    { key: "SOURCE", label: "Source" },
    { key: "SHAREHOLDERS", label: "Shareholders" },
];

export function normalizeTLJson(j, sourceName = null) {
    const row = {
        COMPANY_NAME: clean(j?.company_name),
        FORMATION_TYPE: clean(j?.formation_type),
        FORMATION_NUMBER: clean(j?.formation_number),
        LICENSE_NUMBER: clean(j?.license_number),
        LICENSE_FORMATION_DATE: toISOorOriginal(j?.license_formation_date),
        ISSUE_DATE: toISOorOriginal(j?.issue_date),
        EXPIRY_DATE: toISOorOriginal(j?.expiry_date),
        ADDRESS: clean(j?.address),
        MANAGERS: clean(j?.managers),
        ACTIVITIES: clean(j?.activities),
        ACTIVITIES_CODE: clean(j?.activities_code),
        ISSUING_AUTHORITY: clean(j?.issuing_authority),
        IS_FREEZONE: j?.is_freezone === true || String(j?.is_freezone).toLowerCase() === "true",
        VAT_TRN: clean(j?.vat_trn)?.replace(/\s+/g, "") || null,
        VAT_REGISTERED_DATE: toISOorOriginal(j?.vat_registered_date),
        FIRST_VAT_PERIOD: clean(j?.first_vat_period),
        VAT_RETURN_DUE_DATE: toISOorOriginal(j?.vat_return_due_date),
        SOURCE: clean(sourceName),
        SHAREHOLDERS: Array.isArray(j?.shareholders)
            ? j.shareholders.map((s) => ({
                name: clean(s.name),
                nationality: clean(s.nationality),
                share_percentage: clean(s.share_percentage),
            }))
            : null,
    };
    return row;
}
