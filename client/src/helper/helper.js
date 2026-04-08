import axios from "axios";

export const API_BASE = (import.meta.env.VITE_API_BASE || "https://apivatfiling.thexyra.com/api").replace(/\/$/, "");
export const BACKEND_ORIGIN = API_BASE.replace(/\/api$/i, "");

export const api = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
  timeout: 300000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem("token");
      // Redirect to login if possible, or just let the caller handle it
      if (typeof window !== "undefined") {
        window.location.href = "/login?error=session_expired";
      }
    }
    const msg = error.response?.data?.message || error.message || "Request failed.";
    return Promise.reject(new Error(msg));
  }
);

export const apiUpload = axios.create({ baseURL: API_BASE });

const getAuthHeader = () => {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

function rethrow(err, fallback = "Request failed.") {
  const msg = err?.response?.data?.message || err?.message || fallback;
  throw new Error(msg);
}

// POST Routes

// Api for register user   -  POST
export async function registerUser(payload) {
  try {
    const { data } = await api.post("/auth/register", payload);
    return data;
  } catch (err) {
    const msg =
      err.response?.data?.message || err.message || "Unable to create account.";
    throw new Error(msg);
  }
}

// Api for login users     -  POST
export async function loginUser(payload) {
  try {
    const { data } = await api.post("/auth/login", payload);
    return data;
  } catch (err) {
    const msg =
      err.response?.data?.message || err.message || "Unable to sign in.";
    throw new Error(msg);
  }
}

// Customers API
export async function fetchCustomers() {
  try {
    const res = await api.get("/customers", { headers: getAuthHeader() });
    return res.data.customers || [];
  } catch (err) {
    rethrow(err, "Failed to load customers");
  }
}

export async function fetchCustomerById(id) {
  try {
    const res = await api.get(`/customers/${id}`, { headers: getAuthHeader() });
    return res.data;
  } catch (err) {
    rethrow(err, "Failed to fetch customer");
  }
}

export async function createCustomer(formData) {
  try {
    const res = await api.post("/customers", formData, {
      headers: {
        ...getAuthHeader(),
        "Content-Type": "multipart/form-data",
      },
    });
    return res.data;
  } catch (err) {
    rethrow(err, "Failed to create customer");
  }
}

export async function deleteCustomer(id) {
  try {
    const res = await api.delete(`/customers/${id}`, {
      headers: getAuthHeader(),
    });
    return res.data;
  } catch (err) {
    rethrow(err, "Failed to delete customer");
  }
}

// Customers API
export async function updateCustomer(id, formData) {
  try {
    const res = await api.put(`/customers/${id}`, formData, {
      headers: {
        ...getAuthHeader(),
        "Content-Type": "multipart/form-data",
      },
    });
    return res.data;
  } catch (err) {
    rethrow(err, "Failed to update customer");
  }
}

// ---- Bank Statements: Extract + Excel ----

/** 1) start job (smart: handles large PDFs via chunking) */
export async function startBankExtract(
  file,
  { password, smart = true, signal } = {},
) {
  const fd = new FormData();
  fd.append("file", file, file.name);
  if (password) fd.append("pdfPassword", password);

  // use smart endpoint by default (supports 30+/60+/100+ pages)
  const endpoint = smart ? "/bank/extract/start-smart" : "/bank/extract/start";

  try {
    const { data } = await api.post(endpoint, fd, {
      headers: {
        ...getAuthHeader(),
        "Content-Type": "multipart/form-data",
      },
      signal,
    });

    // start-smart:
    //  - small docs: { jobId, originalName, pages, mode: "normal" }
    //  - big docs:   { groupId, parts, originalName, pages, mode: "imageless" }
    const jobId = data?.jobId || data?.groupId;
    if (!jobId) throw new Error("Failed to start job");

    return {
      ...data,
      jobId, // normalized so frontend always uses `jobId`
    };
  } catch (err) {
    const msg =
      err?.response?.data?.message || err.message || "Failed to start job";
    throw new Error(msg);
  }
}

/** normalize backend result (DocAI service) */
function normalizeResult(jobId, resData) {
  const title = resData?.title || "Bank Statement Results";
  const downloadFileName = resData?.downloadFileName || "bank_statements.xlsx";

  // Prefer explicit sheets
  const textTable = resData?.textTable || { columns: [], rows: [] };
  const tableTable = resData?.tableTable || {
    columns: Array.isArray(resData?.columns) ? resData.columns : [],
    rows: Array.isArray(resData?.rows) ? resData.rows : [],
  };

  // Backward compat: columns/rows reflect TableData
  const columns = tableTable.columns || [];
  const rows = tableTable.rows || [];

  // ✅ NEW: carry summary from backend
  const summary =
    resData?.summary && typeof resData.summary === "object"
      ? resData.summary
      : {};

  return {
    jobId,
    title,
    downloadFileName,
    // Explicit sheets
    textTable,
    tableTable,
    // Back-compat fields
    columns,
    rows,
    // ✅ New
    summary,
  };
}

/**
 * 2) Poll job until we can get a result.
 * We still try /result on each tick even if status != completed.
 * Options:
 *  - onTick(status)
 *  - intervalMs: initial delay (default 2000ms). Backoff up to 5000ms.
 *  - timeoutMs: overall cap (default 15 min)
 *  - signal: AbortSignal for cancellation
 */
// export async function pollBankJob(
//   jobId,
//   {
//     onTick = () => {},
//     intervalMs = 2000,
//     timeoutMs = 15 * 60 * 1000, // 15 minutes
//     signal,
//   } = {}
// ) {
//   const t0 = Date.now();
//   let delay = Math.max(500, intervalMs); // start gentle
//   const maxDelay = 5000;

//   while (Date.now() - t0 < timeoutMs) {
//     if (signal?.aborted) throw new Error("Polling aborted");

//     try {
//       // (A) status
//       const stRes = await api.get(`/bank/extract/status/${jobId}`, {
//         headers: { ...getAuthHeader() },
//         signal,
//       });
//       const status = String(stRes?.data?.status || "").toLowerCase();
//       onTick(status);

//       // (B) try result every tick
//       try {
//         const rRes = await api.get(`/bank/extract/result/${jobId}`, {
//           headers: { ...getAuthHeader() },
//           signal,
//         });
//         // If we got here, backend returned 200 with data
//         return normalizeResult(jobId, rRes.data);
//       } catch (err) {
//         const code = err?.response?.status;
//         // 425: not ready; 404: unknown early in pipeline. Keep polling on network/5xx too.
//         if (
//           !(
//             code === 425 ||
//             code === 404 ||
//             !code ||
//             (code >= 500 && code <= 599)
//           )
//         ) {
//           const msg =
//             err?.response?.data?.message ||
//             err.message ||
//             "Result fetch failed";
//           throw new Error(msg);
//         }
//       }

//       // (C) stop on explicit failure
//       if (status === "failed" || status === "error") {
//         throw new Error(`Extraction ${status}`);
//       }
//     } catch (e) {
//       const code = e?.response?.status;
//       // For non-5xx HTTP errors (e.g., 400/401/403), surface immediately
//       if (code && code < 500) {
//         const msg = e?.response?.data?.message || e.message || "Polling failed";
//         throw new Error(msg);
//       }
//       // else: network/5xx — keep polling
//     }

//     // Wait (with capped backoff) and loop
//     await new Promise((r, rej) => {
//       const id = setTimeout(r, delay);
//       if (signal) {
//         const onAbort = () => {
//           clearTimeout(id);
//           signal.removeEventListener("abort", onAbort);
//           rej(new Error("Polling aborted"));
//         };
//         signal.addEventListener("abort", onAbort, { once: true });
//       }
//     });
//     delay = Math.min(maxDelay, Math.floor(delay * 1.25));
//   }

//   throw new Error("Timed out waiting for extraction result");
// }
export async function pollBankJob(
  jobId,
  {
    onTick = () => { },
    intervalMs = 2000,
    timeoutMs = 15 * 60 * 1000,
    signal,
  } = {},
) {
  const t0 = Date.now();
  let delay = Math.max(500, intervalMs);
  const maxDelay = 5000;

  while (Date.now() - t0 < timeoutMs) {
    if (signal?.aborted) throw new Error("Polling aborted");

    // 1) status
    const stRes = await api.get(`/bank/extract/status/${jobId}`, {
      headers: { ...getAuthHeader() },
      signal,
    });

    const status = String(stRes?.data?.status || "").toLowerCase();
    onTick(status);

    // 2) only fetch result when completed
    if (status === "completed") {
      const rRes = await api.get(`/bank/extract/result/${jobId}`, {
        headers: { ...getAuthHeader() },
        signal,
      });
      return normalizeResult(jobId, rRes.data);
    }

    // stop if failed
    if (status === "failed" || status === "error") {
      throw new Error(`Extraction ${status}`);
    }

    // wait + backoff
    await new Promise((r, rej) => {
      const id = setTimeout(r, delay);
      if (signal) {
        const onAbort = () => {
          clearTimeout(id);
          signal.removeEventListener("abort", onAbort);
          rej(new Error("Polling aborted"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
    delay = Math.min(maxDelay, Math.floor(delay * 1.25));
  }

  throw new Error("Timed out waiting for extraction result");
}

/**
 * 3) Download Excel by job id
 * Uses /excel/rebuild so it works for both single and group jobs.
 * Also handles 425 "Result not ready" with internal retry/backoff.
 */
export async function downloadBankExcelByJob(
  jobId,
  fileName,
  { signal, timeoutMs = 10 * 60 * 1000 } = {},
) {
  const t0 = Date.now();
  let delay = 1500;
  const maxDelay = 5000;

  while (Date.now() - t0 < timeoutMs) {
    if (signal?.aborted) throw new Error("Download aborted");

    try {
      const { data } = await api.get(`/bank/excel/rebuild/${jobId}`, {
        headers: { ...getAuthHeader() },
        params: fileName ? { fileName } : {},
        responseType: "blob",
        signal,
      });
      // Success: got the XLSX blob
      return data;
    } catch (err) {
      const code = err?.response?.status;

      // 425 => Excel still building server-side → wait & retry
      if (code === 425) {
        // fall through to delay + retry
      } else if (code && code < 500) {
        // Client-side / auth / validation → surface immediately
        const msg =
          err?.response?.data?.message ||
          err.message ||
          "Excel download failed";
        throw new Error(msg);
      } else {
        // 5xx or network error → retry
      }
    }

    await new Promise((r, rej) => {
      const id = setTimeout(r, delay);
      if (signal) {
        const onAbort = () => {
          clearTimeout(id);
          signal.removeEventListener("abort", onAbort);
          rej(new Error("Download aborted"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
    delay = Math.min(maxDelay, Math.floor(delay * 1.3));
  }

  throw new Error("Timed out waiting for Excel download");
}

// ---- Emirates ID helpers ----
export async function startEmiratesJob({ files, token }) {
  const fd = new FormData();
  files.forEach((f) => {
    const blob = f.file ?? f; // support {file,...} or raw File
    const name = f.name ?? blob.name; // preserve filename
    fd.append("files", blob, name);
  });

  const res = await fetch(`${API_BASE}/emirates/jobs/start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  if (!res.ok) throw new Error("Failed to start job");
  return res.json(); // { job_id }
}

export async function pollEmiratesStatus({ jobId, token }) {
  const { data } = await api.get(`/emirates/jobs/status/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15000,
  });
  return data; // { state, message, processed_files, total_files, progress_pct }
}

export async function fetchEmiratesPreview({ jobId, token }) {
  const { data } = await api.get(`/emirates/jobs/preview/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 30000,
  });
  return data; // { title, columns, rows, downloadFileName }
}

export function makeEmiratesDownloadUrl(jobId) {
  return `${API_BASE}/emirates/jobs/result/${jobId}`;
}

// --- Passport APIs ---
export async function startPassportJob({ files, token }) {
  const fd = new FormData();
  files.forEach((f) => {
    const blob = f.file ?? f;
    const name = f.name ?? blob.name;
    fd.append("files", blob, name);
  });
  const res = await fetch(`${API_BASE}/passport/jobs/start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  if (!res.ok) throw new Error("Failed to start job");
  return res.json(); // { job_id }
}

export async function pollPassportStatus({ jobId, token }) {
  const { data } = await api.get(`/passport/jobs/status/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15000,
  });
  return data;
}

export async function fetchPassportPreview({ jobId, token }) {
  const { data } = await api.get(`/passport/jobs/preview/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 30000,
  });
  return data;
}

export function makePassportDownloadUrl(jobId) {
  return `${API_BASE}/passport/jobs/result/${jobId}`;
}

// --- Visa APIs ---
export async function startVisaJob({ files, token }) {
  const fd = new FormData();
  files.forEach((f) => {
    const blob = f.file ?? f;
    const name = f.name ?? blob.name;
    fd.append("files", blob, name);
  });
  const res = await fetch(`${API_BASE}/visa/jobs/start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  if (!res.ok) throw new Error("Failed to start job");
  return res.json(); // { job_id }
}

export async function pollVisaStatus({ jobId, token }) {
  const { data } = await api.get(`/visa/jobs/status/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15000,
  });
  return data; // { state, message, processed_files, total_files, progress_pct }
}

export async function fetchVisaPreview({ jobId, token }) {
  const { data } = await api.get(`/visa/jobs/preview/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 30000,
  });
  return data; // { title, columns, rows, downloadFileName }
}

export function makeVisaDownloadUrl(jobId) {
  return `${API_BASE}/visa/jobs/result/${jobId}`;
}

// --- Bills APIs ---
export async function extractBills(files) {
  const form = new FormData();
  // support both {file,name} objects and File blobs
  files.forEach((f) => {
    const blob = f.file ?? f;
    const name = f.name ?? blob.name ?? "bill";
    form.append("files", blob, name);
  });

  const { data } = await api.post("/bills/extract", form, {
    headers: { ...getAuthHeader(), "Content-Type": "multipart/form-data" },
    timeout: Number(
      import.meta?.env?.VITE_BILLS_EXTRACT_TIMEOUT_MS || 30 * 60 * 1000,
    ),
  });
  return data; // { title, columns, rows, downloadFileName }
}

export async function downloadBillsExcel(
  columns,
  rows,
  fileName = "Bills.xlsx",
) {
  const { data } = await api.post(
    "/bills/excel",
    { columns, rows, fileName },
    { responseType: "blob", headers: { ...getAuthHeader() } },
  );
  return data; // Blob
}

/** ---------- TRADE LICENSE API ---------- */
export async function startTradeLicenseJob({ files, token }) {
  const fd = new FormData();
  for (const f of files) fd.append("files", f.file, f.name);
  const res = await fetch(`${API_BASE}/tradelicense/jobs/start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function pollTradeLicenseStatus({ jobId, token }) {
  const res = await fetch(`${API_BASE}/tradelicense/jobs/status/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchTradeLicensePreview({ jobId, token }) {
  const res = await fetch(`${API_BASE}/tradelicense/jobs/preview/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export const makeTradeLicenseDownloadUrl = (jobId) =>
  `${API_BASE}/tradelicense/jobs/result/${jobId}`;

export async function extractTradeLicense(file) {
  const fd = new FormData();
  fd.append("files", file); // Backend expects 'files' array/single
  try {
    const { data } = await api.post("/tradelicense/extract-one", fd, {
      headers: {
        ...getAuthHeader(),
        "Content-Type": "multipart/form-data",
      },
    });
    return data; // normalized row
  } catch (err) {
    rethrow(err, "Failed to extract trade license data");
  }
}

/* ---------- Invoice Convert APIs (NEW) ---------- */
export async function startInvoiceJob({
  files,
  country,
  token,
  company_name,
  company_trn,
}) {
  // `files` should be the same array you're storing in state (each has {file, name, kind})

  const fd = new FormData();
  files.forEach((f) => {
    const blob = f.file ?? f; // support {file,...} or raw File
    const name = f.name ?? blob.name; // preserve filename
    fd.append("files", blob, name);
  });
  fd.append("country", country);
  fd.append("company_name", company_name);
  fd.append("company_trn", company_trn);

  const res = await fetch(`${API_BASE}/invoice/jobs/start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  if (!res.ok) throw new Error("Failed to start job");
  return res.json();
}

export async function pollInvoiceStatus({ jobId, token }) {
  try {
    const { data } = await api.get(`/invoice/jobs/status/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15_000,
    });
    return data; // { state, message, processed_files, total_files, progress_pct }
  } catch (err) {
    rethrow(err, "Polling failed.");
  }
}

export async function fetchInvoicePreview({ jobId, token }) {
  try {
    const { data } = await api.get(`/invoice/jobs/preview/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30_000,
    });
    return data; // { title, columns, rows, downloadFileName }
  } catch (err) {
    rethrow(err, "Preview fetch failed.");
  }
}

export function makeInvoiceDownloadUrl(jobId) {
  return `${API_BASE}/invoice/jobs/result/${jobId}`;
}

export function makeInvoiceZohoTemplateDownloadUrl(jobId, kind) {
  const safeKind =
    String(kind || "purchase").toLowerCase() === "sales" ? "sales" : "purchase";
  return `${API_BASE}/invoice/jobs/zoho-template/${jobId}?kind=${safeKind}`;
}

// Company API functions

export async function getCompanyById(companyId) {
  // actually using customers table now
  try {
    const { data } = await api.get(`/customers/${companyId}`, {
      headers: getAuthHeader(),
    });
    // shape: { customer, shareholders, documents }
    return {
      company: {
        id: data.customer.id,
        name: data.customer.customer_name,
        trn: data.customer.vat_trn || "",
        country: data.customer.country || "",
      },
    };
  } catch (err) {
    rethrow(err, "Failed to fetch customer as company");
  }
}

// ===== VAT Filing Period APIs =====

export async function fetchVatPeriods(customerId) {
  try {
    const { data } = await api.get(
      `/vat-filing/customers/${customerId}/periods`,
      { headers: getAuthHeader() },
    );
    return data.periods || [];
  } catch (err) {
    rethrow(err, "Failed to load VAT filing periods");
  }
}

export async function createVatPeriod(customerId, payload) {
  try {
    const { data } = await api.post(
      `/vat-filing/customers/${customerId}/periods`,
      payload,
      { headers: getAuthHeader() },
    );
    return data.period;
  } catch (err) {
    rethrow(err, "Failed to create VAT filing period");
  }
}

export async function updateVatPeriod(id, payload) {
  try {
    const { data } = await api.put(`/vat-filing/periods/${id}`, payload, {
      headers: getAuthHeader(),
    });
    return data.period;
  } catch (err) {
    rethrow(err, "Failed to update VAT filing period");
  }
}

export async function deleteVatPeriod(id) {
  try {
    const { data } = await api.delete(`/vat-filing/periods/${id}`, {
      headers: getAuthHeader(),
    });
    return data;
  } catch (err) {
    rethrow(err, "Failed to delete VAT filing period");
  }
}

export async function saveVatFilingDraft(periodId, payload) {
  try {
    const { data } = await api.post(
      `/vat-filing/periods/${periodId}/drafts`,
      payload,
      { headers: { ...getAuthHeader(), "Content-Type": "application/json" } },
    );
    return data.run;
  } catch (err) {
    rethrow(err, "Failed to save VAT filing draft");
  }
}

export async function fetchVatRun(runId) {
  try {
    const { data } = await api.get(`/vat-filing/runs/${runId}`, {
      headers: getAuthHeader(),
    });
    return data; // { run, payload }
  } catch (err) {
    rethrow(err, "Failed to load VAT filing run");
  }
}

export async function fetchVatRunsForPeriod(periodId) {
  try {
    const { data } = await api.get(`/vat-filing/periods/${periodId}/runs`, {
      headers: getAuthHeader(),
    });
    return data.runs || [];
  } catch (err) {
    rethrow(err, "Failed to load VAT filing drafts");
  }
}

export async function updateVatRun(runId, payload) {
  try {
    const { data } = await api.put(`/vat-filing/runs/${runId}`, payload, {
      headers: {
        ...getAuthHeader(),
        "Content-Type": "application/json",
      },
    });
    // data: { run, payload }
    return data;
  } catch (err) {
    rethrow(err, "Failed to update VAT filing run");
  }
}

export async function deleteVatRun(runId) {
  try {
    const { data } = await api.delete(`/vat-filing/runs/${runId}`, {
      headers: getAuthHeader(),
    });
    // data = { message: "VAT filing run deleted successfully" }
    return data;
  } catch (err) {
    rethrow(err, "Failed to delete VAT filing run");
  }
}

// ---- CT Filing helpers ----

// GET /ct-filing/customers/:customerId/periods
export async function fetchCtPeriods(customerId) {
  try {
    const { data } = await api.get(
      `/ct-filing/customers/${customerId}/periods`,
      { headers: getAuthHeader() },
    );
    return data.periods || [];
  } catch (err) {
    rethrow(err, "Failed to load CT filing periods");
  }
}

// POST /ct-filing/customers/:customerId/periods
export async function createCtPeriod(customerId, payload) {
  try {
    const { data } = await api.post(
      `/ct-filing/customers/${customerId}/periods`,
      {
        periodFrom: payload.periodFrom,
        periodTo: payload.periodTo,
        dueDate: payload.dueDate || null,
        submitDate: payload.submitDate || null,
        status: payload.status || "not_started",
      },
      { headers: getAuthHeader() },
    );
    return data.period;
  } catch (err) {
    rethrow(err, "Failed to create CT filing period");
  }
}

export async function updateCtPeriod(id, payload) {
  try {
    const { data } = await api.put(`/ct-filing/periods/${id}`, payload, {
      headers: getAuthHeader(),
    });
    return data.period;
  } catch (err) {
    rethrow(err, "Failed to update CT filing period");
  }
}

export async function deleteCtPeriod(id) {
  try {
    const { data } = await api.delete(`/ct-filing/periods/${id}`, {
      headers: getAuthHeader(),
    });
    return data;
  } catch (err) {
    rethrow(err, "Failed to delete CT filing period");
  }
}

// VAT Filing API functions
export async function getVatFilingPreview(companyId) {
  try {
    const { data } = await api.get(
      `/vat-filing/companies/${companyId}/preview`,
      {
        headers: getAuthHeader(),
      },
    );
    return data;
  } catch (err) {
    rethrow(err, "Failed to fetch VAT filing preview");
  }
}

export async function generateVatFilingExcel(companyId, data) {
  try {
    const response = await api.post(
      `/vat-filing/companies/${companyId}/combined-excel`,
      data,
      {
        headers: { ...getAuthHeader(), "Content-Type": "application/json" },
        responseType: "blob",
      },
    );
    return response.data;
  } catch (err) {
    rethrow(err, "Failed to generate VAT filing Excel");
  }
}

// Generate combined Excel file
export async function generateCombinedExcel(companyId, data) {
  try {
    const token = localStorage.getItem("token");
    const { data: response } = await api.post(
      `/vat-filing/companies/${companyId}/combined-excel`,
      data,
      {
        headers: { Authorization: `Bearer ${token}` },
        responseType: "blob",
      },
    );
    return response;
  } catch (err) {
    rethrow(err, "Failed to generate combined Excel file");
  }
}

// === CT Filing API functions ===
export async function getCtFilingPreview(companyId) {
  try {
    const { data } = await api.get(
      `/ct-filing/companies/${companyId}/preview`,
      {
        headers: getAuthHeader(), // ✅ same as VAT
      },
    );
    return data;
  } catch (err) {
    rethrow(err, "Failed to fetch CT filing preview");
  }
}

export async function generateCtFilingExcel(companyId, data) {
  try {
    const response = await api.post(
      `/ct-filing/companies/${companyId}/combined-excel`,
      data,
      {
        headers: {
          ...getAuthHeader(), // ✅ auth
          "Content-Type": "application/json", // ✅ same as VAT
        },
        responseType: "blob", // ✅ Excel as Blob
      },
    );
    return response.data; // ✅ same pattern as VAT
  } catch (err) {
    rethrow(err, "Failed to generate CT filing Excel");
  }
}

// --- Dashboard Analytics APIs ---
export async function fetchDashboardSummary(params = {}) {
  try {
    const { data } = await api.get("/dashboard/summary", { params });
    return data;
  } catch (err) {
    rethrow(err, "Failed to load dashboard summary");
  }
}

export async function fetchDashboardStats(params = {}) {
  try {
    const { data } = await api.get("/dashboard/stats", { params });
    return data;
  } catch (err) {
    rethrow(err, "Failed to load dashboard stats");
  }
}

export async function fetchDepartmentStats(params = {}) {
  try {
    const { data } = await api.get("/dashboard/department-stats", { params });
    return data;
  } catch (err) {
    rethrow(err, "Failed to load department stats");
  }
}

export async function fetchModuleStats(params = {}) {
  try {
    const { data } = await api.get("/dashboard/module-stats", { params });
    return data;
  } catch (err) {
    rethrow(err, "Failed to load module stats");
  }
}

export async function fetchUserProcessingDetails(params = {}) {
  try {
    const { data } = await api.get("/dashboard/user-processing", { params });
    return data;
  } catch (err) {
    rethrow(err, "Failed to load user processing details");
  }
}
