import { useEffect, useMemo, useRef, useState } from "react";
import {
  Upload,
  Trash2,
  FileText,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Lock,
} from "lucide-react";
import { useNavigate, useParams, useLocation } from "react-router-dom";

import PdfViewer from "../../components/PdfViewer/PdfViewer";
import ImageViewer from "../../components/ImageViewer/ImageViewer";

import {
  startInvoiceJob,
  pollInvoiceStatus,
  fetchInvoicePreview,
  makeInvoiceDownloadUrl,
  startBankExtract,
  pollBankJob,
  getCompanyById,
  fetchVatPeriods,
  fetchVatRun,
} from "../../helper/helper";
import { api } from "../../helper/helper";

import "./BankAndInvoice.css";

const MAX_BANK_BYTES = 20 * 1024 * 1024; // 20MB

export default function BankAndInvoice() {
  return <VatFilingComposer />;
}

export function VatFilingComposer({
  embedded = false,
  initialCompanyId = null,
  initialPeriodId = null,
  initialRunId = null,
  initialExistingPayload = null,
  onClose = null,
  onCombinedPreviewReady = null,
} = {}) {
  // Get company ID from URL params
  const { companyId: routeCompanyId } = useParams();
  const location = useLocation();

  const searchParams = new URLSearchParams(location.search);
  const companyId = initialCompanyId || routeCompanyId;
  const periodId = initialPeriodId ?? searchParams.get("periodId");
  const runId = initialRunId ?? searchParams.get("runId");

  // identity
  const [country] = useState("uae");
  const [companyName, setCompanyName] = useState("");
  const [companyTRN, setCompanyTRN] = useState("");
  const [displayCompanyName, setDisplayCompanyName] = useState(""); // For display only

  // Set the document title when display company name changes
  useEffect(() => {
    document.title = `Xyra Books - VAT Filing - ${displayCompanyName || "Company"
      }`;
  }, [displayCompanyName]);

  // Load company data when component mounts
  useEffect(() => {
    if (companyId) {
      loadCompanyData();
    }
  }, [companyId]);

  useEffect(() => {
    if (companyId) {
      loadCompanyData();
      loadPeriodData();
    }
  }, [companyId, periodId]);

  const [periodData, setPeriodData] = useState(null);

  const loadPeriodData = async () => {
    if (!periodId) return;
    try {
      const periods = await fetchVatPeriods(companyId);
      const current = periods.find((p) => String(p.id) === String(periodId));
      if (current) {
        setPeriodData(current);
      }
    } catch (err) {
      console.error("Failed to load period data", err);
    }
  };

  const loadCompanyData = async () => {
    try {
      const { company } = await getCompanyById(companyId);
      const name = company.name || "";
      setDisplayCompanyName(name);
      setCompanyName(name);

      setCompanyTRN(company.trn || "");
    } catch (error) {
      console.error("Failed to load company data:", error);
      // Fallback to placeholder if API call fails
      setDisplayCompanyName(`Company ${companyId}`);
    }
  };

  // invoices (multi)
  const invoicePickerRef = useRef(null);
  const [invQueue, setInvQueue] = useState([]);
  const [invFiles, setInvFiles] = useState([]); // [{id,name,size,url,type,file}]
  const [invSelectedId, setInvSelectedId] = useState(null);

  // bank statements (multi – we’ll submit one-by-one using current API)
  const bankPickerRef = useRef(null);
  const [bankQueue, setBankQueue] = useState([]);
  const [bankFiles, setBankFiles] = useState([]);
  const [bankSelectedId, setBankSelectedId] = useState(null);
  const [pdfPassword, setPdfPassword] = useState("");
  const [showPw, setShowPw] = useState(false);

  // preview (single viewer pane that previews whichever side is “active”)
  const [activePane, setActivePane] = useState("inv"); // 'inv' | 'bank'
  const selectedInvoice = useMemo(
    () => invFiles.find((f) => f.id === invSelectedId) || null,
    [invFiles, invSelectedId]
  );
  const selectedBank = useMemo(
    () => bankFiles.find((f) => f.id === bankSelectedId) || null,
    [bankFiles, bankSelectedId]
  );
  const selected = activePane === "inv" ? selectedInvoice : selectedBank;

  // import status
  const [polling, setPolling] = useState(false);
  const [status, setStatus] = useState(null);
  const pollTimer = useRef(null);

  // results modal
  const [resultsModal, setResultsModal] = useState(null); // {invoice, bank[]} | null
  const [combinedData, setCombinedData] = useState(null);

  const navigate = useNavigate();

  // ---------- pickers ----------
  const openInvPicker = () => invoicePickerRef.current?.click();
  const openBankPicker = () => bankPickerRef.current?.click();

  const INV_ACCEPT = ".pdf,image/*";
  const BANK_ACCEPT = ".pdf,image/*";

  function onPickInvoice(e) {
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
    if (!picked.length) return;
    picked.forEach(readWithProgressInvoice);
    setActivePane("inv");
  }

  function onPickBank(e) {
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
    if (!picked.length) return;
    // basic max size validation for bank files (match your current page rule)
    const filtered = picked.filter((f) => {
      if (f.size > MAX_BANK_BYTES) {
        alert(`${f.name}: Maximum file size is 20MB`);
        return false;
      }
      return true;
    });
    filtered.forEach(readWithProgressBank);
    setActivePane("bank");
  }

  function readWithProgressInvoice(file) {
    const id = crypto.randomUUID();
    setInvQueue((prev) => [
      ...prev,
      { id, name: file.name, size: file.size, percent: 0 },
    ]);

    const reader = new FileReader();
    reader.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      const percent = Math.min(100, Math.round((ev.loaded / ev.total) * 100));
      setInvQueue((prev) =>
        prev.map((it) => (it.id === id ? { ...it, percent } : it))
      );
    };
    reader.onload = () => {
      const url = URL.createObjectURL(file);
      const type = file.type.startsWith("image/")
        ? "image"
        : file.type === "application/pdf" ||
          file.name.toLowerCase().endsWith(".pdf")
          ? "pdf"
          : "other";
      setInvQueue((prev) => prev.filter((it) => it.id !== id));
      setInvFiles((prev) => {
        const next = [
          ...prev,
          { id, name: file.name, size: file.size, url, type, file },
        ];
        if (!invSelectedId) setInvSelectedId(id);
        return next;
      });
    };
    reader.onerror = () =>
      setInvQueue((prev) => prev.filter((it) => it.id !== id));
    reader.readAsArrayBuffer(file);
  }

  function readWithProgressBank(file) {
    const id = crypto.randomUUID();
    setBankQueue((prev) => [
      ...prev,
      { id, name: file.name, size: file.size, percent: 0 },
    ]);

    const reader = new FileReader();
    reader.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      const percent = Math.min(100, Math.round((ev.loaded / ev.total) * 100));
      setBankQueue((prev) =>
        prev.map((it) => (it.id === id ? { ...it, percent } : it))
      );
    };
    reader.onload = () => {
      const url = URL.createObjectURL(file);
      const type =
        file.type.startsWith("image/") ||
          /\.(png|jpe?g|webp|gif|tiff?)$/i.test(file.name)
          ? "image"
          : file.type === "application/pdf" || /\.pdf$/i.test(file.name)
            ? "pdf"
            : "other";
      setBankQueue((prev) => prev.filter((it) => it.id !== id));
      setBankFiles((prev) => {
        const next = [
          ...prev,
          { id, name: file.name, size: file.size, url, type, file },
        ];
        if (!bankSelectedId) setBankSelectedId(id);
        return next;
      });
    };
    reader.onerror = () =>
      setBankQueue((prev) => prev.filter((it) => it.id !== id));
    reader.readAsArrayBuffer(file);
  }

  function removeInvoice(id) {
    setInvFiles((prev) => {
      const idx = prev.findIndex((f) => f.id === id);
      const t = prev[idx];
      if (t) URL.revokeObjectURL(t.url);
      const next = prev.filter((f) => f.id !== id);
      if (invSelectedId === id) {
        const neighbor = next[idx] || next[idx - 1] || null;
        setInvSelectedId(neighbor?.id || null);
      }
      return next;
    });
  }

  function removeBank(id) {
    setBankFiles((prev) => {
      const idx = prev.findIndex((f) => f.id === id);
      const t = prev[idx];
      if (t) URL.revokeObjectURL(t.url);
      const next = prev.filter((f) => f.id !== id);
      if (bankSelectedId === id) {
        const neighbor = next[idx] || next[idx - 1] || null;
        setBankSelectedId(neighbor?.id || null);
      }
      return next;
    });
  }

  // keep first item selected on add
  useEffect(() => {
    if (invFiles.length && !invFiles.some((f) => f.id === invSelectedId)) {
      setInvSelectedId(invFiles[0].id);
    }
  }, [invFiles, invSelectedId]);
  useEffect(() => {
    if (bankFiles.length && !bankFiles.some((f) => f.id === bankSelectedId)) {
      setBankSelectedId(bankFiles[0].id);
    }
  }, [bankFiles, bankSelectedId]);

  // revoke object urls on unmount
  const allUrlsRef = useRef([]);
  useEffect(() => {
    allUrlsRef.current = [...invFiles, ...bankFiles];
  }, [invFiles, bankFiles]);
  useEffect(() => {
    return () => {
      allUrlsRef.current.forEach((f) => f?.url && URL.revokeObjectURL(f.url));
    };
  }, []);

  // ---------- import ----------
  async function handleImport() {
    if (polling) return;

    const hasInvoices = invFiles.length > 0;
    const hasBanks = bankFiles.length > 0;

    if (!hasInvoices && !hasBanks) {
      alert("Please add invoice files and/or bank statements.");
      return;
    }

    const token = localStorage.getItem("token");
    if (!token) {
      alert("Please login first.");
      return;
    }

    let effectiveCompanyName = String(companyName || "").trim();
    let effectiveCompanyTRN = String(companyTRN || "").trim();
    if (!effectiveCompanyName || !effectiveCompanyTRN) {
      try {
        const { company } = await getCompanyById(companyId);
        if (!effectiveCompanyName) {
          effectiveCompanyName = String(company?.name || "").trim();
          if (effectiveCompanyName) setCompanyName(effectiveCompanyName);
        }
        if (!effectiveCompanyTRN) {
          effectiveCompanyTRN = String(company?.trn || "").trim();
          if (effectiveCompanyTRN) setCompanyTRN(effectiveCompanyTRN);
        }
      } catch (e) {
        console.warn("Could not refresh company identity before import:", e);
      }
    }

    setStatus(null);
    setPolling(true);

    let invoiceResult = null;
    const bankResults = [];

    try {
      // 1) Invoices batch (your existing API handles multiple files)
      if (hasInvoices) {
        const { job_id } = await startInvoiceJob({
          files: invFiles,
          country,
          token,
          company_name: effectiveCompanyName,
          company_trn: effectiveCompanyTRN,
        });

        await pollUntilDone(job_id, token);

        const preview = await fetchInvoicePreview({ jobId: job_id, token });
        const apiDownloadUrl = makeInvoiceDownloadUrl(job_id);

          invoiceResult = {
            title: preview.title || "Invoice Results",
            downloadLabel: "Download Excel",
            downloadFileName: preview.downloadFileName || "invoices.xlsx",
            apiDownloadUrl: apiDownloadUrl,
            authToken: token,
            // normalize: preview may return columns/rows directly, not as table
            table: {
              columns: Array.isArray(preview.columns)
                ? preview.columns
                : preview.table?.columns || [],
              rows: Array.isArray(preview.rows)
                ? preview.rows
                : preview.table?.rows || [],
            },
            // carry through if backend already separates and totals
            uaeSalesRows: Array.isArray(preview.uaeSalesRows)
              ? preview.uaeSalesRows
              : [],
            uaePurchaseRows: Array.isArray(preview.uaePurchaseRows)
              ? preview.uaePurchaseRows
              : [],
            uaeOtherRows: Array.isArray(preview.uaeOtherRows)
              ? preview.uaeOtherRows
              : [],
            totals: preview.totals || { purchase: {}, sales: {} },
          };
      }

      // 2) Bank statements – submit sequentially using your single-file endpoint
      if (hasBanks) {
        for (const item of bankFiles) {
          const { jobId } = await startBankExtract(item.file, {
            password: pdfPassword?.trim() ? pdfPassword.trim() : undefined,
          });

          const result = await pollBankJob(jobId, {
            onTick: (st) =>
              setStatus({
                message: `Bank: ${item.name} — ${st}`,
                progress_pct: 0,
                processed_files: 0,
                total_files: 0,
              }),
          });

          bankResults.push({
            ...result,
            subtitle: item.name,
            downloadFileName:
              result?.downloadFileName || "bank_statements.xlsx",
          });
        }
      }

      // Don’t auto-navigate; show a small results modal with quick links
      setResultsModal({ invoice: invoiceResult, bank: bankResults });
    } catch (err) {
      console.error(err);
      alert(err?.message || "Import failed.");
    } finally {
      if (pollTimer.current) clearInterval(pollTimer.current);
      setPolling(false);
      setStatus(null);
    }
  }

  function pollUntilDone(jobId, token) {
    return new Promise((resolve, reject) => {
      const tick = async () => {
        try {
          const s = await pollInvoiceStatus({ jobId, token });
          setStatus(s);
          if (s.state === "done") {
            clearInterval(pollTimer.current);
            pollTimer.current = null;
            resolve();
          } else if (s.state === "error") {
            clearInterval(pollTimer.current);
            pollTimer.current = null;
            reject(new Error(s?.message || "Job failed."));
          }
        } catch (e) {
          clearInterval(pollTimer.current);
          pollTimer.current = null;
          reject(e);
        }
      };
      tick();
      pollTimer.current = setInterval(tick, 1500);
    });
  }

  // quick links to existing result pages
  function gotoInvoice(result) {
    navigate("/converts/invoices/tableresult", {
      state: {
        title: result.title,
        downloadLabel: result.downloadLabel,
        downloadFileName: result.downloadFileName,
        apiDownloadUrl: result.apiDownloadUrl,
        authToken: result.authToken,
        table: result.table,
        uaeSalesRows: result.uaeSalesRows || [],
        uaePurchaseRows: result.uaePurchaseRows || [],
        othersRows: result.othersRows || result.uaeOtherRows || [],
        totals: result.totals,
      },
    });
  }

  function parseDate(dateStr) {
    if (!dateStr) return null;
    let s = String(dateStr).trim();

    // 1. Fix known typos or common scanning errors
    // "Jult" -> "July"
    s = s.replace(/\bjult\b/i, "July");
    // "Sept" -> "Sep" etc already handled by Date(), usually. 

    // 2. Try ISO YYYY-MM-DD
    if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) {
      const d = new Date(s);
      if (!isNaN(d.getTime())) return d;
    }

    // 3. Handle Slash Formats: DD/MM/YYYY, MM/DD/YYYY, YYYY/MM/DD
    if (s.includes("/")) {
      const parts = s.split("/");
      if (parts.length === 3) {
        const p0 = parseInt(parts[0], 10);
        const p1 = parseInt(parts[1], 10);
        const p2 = parseInt(parts[2], 10);

        let day, month, year;

        // Case A: Starts with Year (YYYY/...)
        if (p0 >= 1000) {
          year = p0;
          // Ambiguity: MM/DD or DD/MM?
          // If p1 > 12, p1 is Day -> YYYY/DD/MM
          if (p1 > 12) {
            day = p1;
            month = p2 - 1;
          } else {
            // Assume YYYY/MM/DD by default
            month = p1 - 1;
            day = p2;
          }
        }
        // Case B: Ends with Year (.../YYYY)
        else if (p2 >= 1000) {
          year = p2;
          // Ambiguity: DD/MM or MM/DD?
          if (p0 > 12) {
            // p0 must be Day (e.g. 24/05/2025) -> DD/MM
            day = p0;
            month = p1 - 1;
          } else if (p1 > 12) {
            // p1 must be Day (e.g. 05/24/2025) -> MM/DD
            month = p0 - 1;
            day = p1;
          } else {
            // Both <= 12 (e.g. 05/06/2025). 
            // Default to DD/MM/YYYY (common in UAE/UK).
            day = p0;
            month = p1 - 1;
          }
        }

        if (year && day && month >= 0) {
          const d = new Date(year, month, day);
          if (!isNaN(d.getTime())) return d;
        }
      }
    }

    // 4. Fallback to native (Handles "24 July 2025", "July 24 2025")
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;

    return null;
  }

  async function gotoCombinedPreview() {
    try {
      // Ensure we actually have anything to combine
      if (
        !resultsModal ||
        (!resultsModal.invoice && !resultsModal.bank?.length)
      ) {
        alert(
          "No results available to preview. Please import invoices and/or bank statements first."
        );
        /*
              ### 4. Supplemental Upload Logic (`BankAndInvoice.jsx`)
        *   **Data Merging**: If a `runId` is present in the URL, the component fetches existing run data.
        *   **Appending Rows**: New processed bank transactions and invoices are appended to the existing arrays (`bankData.rows`, `uaeSalesRows`, `uaePurchaseRows`, `othersRows`).
        *   **Column & Summary Preservation**: If only one type of file (e.g., invoices) is uploaded, the existing columns and summaries for the other types (e.g., bank statements) are preserved from the original conversion.
        *   **State Persistence**: The merged state is passed to the preview page, where saving a draft updates the existing conversion.
        */
        return;
      }

      // If runId is present, fetch existing run for merging
      let existingPayload = null;
      if (runId) {
        const res = await fetchVatRun(runId);
        existingPayload = res.payload;
      } else if (initialExistingPayload) {
        existingPayload = initialExistingPayload;
      }

      // BANK: coerce columns to {key,label}
      function normalizeColumns(cols) {
        if (!Array.isArray(cols)) return [];
        if (cols.length && typeof cols[0] === "string") {
          // e.g., ["DATE", "DESCRIPTION", ...]
          return cols.map((k) => ({ key: k, label: k.replace(/_/g, " ") }));
        }
        // e.g., [{ key: "DATE", label: "Date" }] or other shapes
        return cols.map((c) => ({
          key: c.key ?? c.field ?? c.accessor ?? String(c),
          label: c.label ?? c.header ?? String(c.key ?? c),
        }));
      }

      const bankColumns = resultsModal.bank?.length
        ? normalizeColumns(resultsModal.bank[0].columns)
        : [];

      const allBankRows = [];
      (resultsModal.bank || []).forEach((b) => {
        if (Array.isArray(b.rows)) allBankRows.push(...b.rows);
      });

      // ✅ NEW: pick the first non-empty summary from any bank file
      const firstSummary =
        (resultsModal.bank || [])
          .map((b) => b.summary)
          .find(
            (s) =>
              s &&
              typeof s === "object" &&
              !Array.isArray(s) &&
              Object.keys(s).length > 0
          ) || {};

      const bankData = {
        columns: bankColumns,
        rows: allBankRows,
        // ✅ NEW
        summary: firstSummary,
      };

      // INVOICE: prefer already separated arrays from invoice module
      const iv = resultsModal.invoice || {};

      const toKind = (val) => {
        const s = String(val || "")
          .trim()
          .toLowerCase();
        if (!s) return "";
        if (s.startsWith("sale")) return "sales"; // sale, sales
        if (s.startsWith("purchas")) return "purchase"; // purchase, purchases
        if (s === "bill" || s === "expense" || s === "supplier" || s === "buy")
          return "purchase";
        return s; // fallback: if backend sends exact "sales"/"purchase" etc.
      };

      const splitInvoiceBuckets = (src) => {
        const invSrc = src && typeof src === "object" ? src : {};
        const uniqueRows = (rows = []) => {
          const out = [];
          const seen = new Set();
          rows.forEach((r, idx) => {
            let key = `__row_${idx}`;
            try {
              key = JSON.stringify(r ?? null);
            } catch {
              // keep fallback key
            }
            if (seen.has(key)) return;
            seen.add(key);
            out.push(r);
          });
          return out;
        };
        const hasSalesKey = Object.prototype.hasOwnProperty.call(
          invSrc,
          "uaeSalesRows"
        );
        const hasPurchaseKey = Object.prototype.hasOwnProperty.call(
          invSrc,
          "uaePurchaseRows"
        );
        const hasOthersKey =
          Object.prototype.hasOwnProperty.call(invSrc, "othersRows") ||
          Object.prototype.hasOwnProperty.call(invSrc, "uaeOtherRows");
        const explicit =
          !!invSrc.__explicitBuckets || hasSalesKey || hasPurchaseKey || hasOthersKey;

        const salesExplicit = Array.isArray(invSrc.uaeSalesRows)
          ? [...invSrc.uaeSalesRows]
          : [];
        const purchaseExplicit = Array.isArray(invSrc.uaePurchaseRows)
          ? [...invSrc.uaePurchaseRows]
          : [];
        const othersExplicit = uniqueRows([
          ...(Array.isArray(invSrc.othersRows) ? invSrc.othersRows : []),
          ...(Array.isArray(invSrc.uaeOtherRows) ? invSrc.uaeOtherRows : []),
        ]);

        if (
          explicit &&
          (salesExplicit.length || purchaseExplicit.length || othersExplicit.length)
        ) {
          return {
            sales: salesExplicit,
            purchase: purchaseExplicit,
            others: othersExplicit,
            explicit: true,
          };
        }

        const unifiedRows = Array.isArray(invSrc.table?.rows)
          ? invSrc.table.rows
          : [];
        if (!unifiedRows.length) {
          return {
            sales: salesExplicit,
            purchase: purchaseExplicit,
            others: othersExplicit,
            explicit,
          };
        }

        const sales = [];
        const purchase = [];
        const others = [];
        unifiedRows.forEach((r) => {
          const kind = toKind(r?.TYPE);
          if (kind === "sales") sales.push(r);
          else if (kind === "purchase") purchase.push(r);
          else others.push(r);
        });
        return { sales, purchase, others, explicit };
      };

      const normalizeRowToken = (v) =>
        String(v ?? "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, " ");

      const confidenceScore = (row) => {
        const n = Number(String(row?.CONFIDENCE ?? "").replace(/%/g, ""));
        return Number.isFinite(n) ? n : -1;
      };

      const invoiceRowKey = (row) =>
        [
          row?.SOURCE,
          row?.DATE,
          row?.["INVOICE NUMBER"],
          row?.["SUPPLIER/VENDOR"],
          row?.PARTY,
          row?.["SUPPLIER TRN"],
          row?.["CUSTOMER TRN"],
          row?.CURRENCY,
          row?.["BEFORE TAX AMOUNT"],
          row?.VAT,
          row?.["NET AMOUNT"],
          row?.["BEFORE TAX (AED)"],
          row?.["VAT (AED)"],
          row?.["ZERO RATED (AED)"],
          row?.["NET AMOUNT (AED)"],
        ]
          .map(normalizeRowToken)
          .join("|");

      const dedupeInvoiceRows = (rows = []) => {
        const byKey = new Map();
        rows.forEach((row) => {
          if (!row || typeof row !== "object") return;
          const key = invoiceRowKey(row);
          if (!byKey.has(key)) {
            byKey.set(key, row);
            return;
          }
          const prev = byKey.get(key);
          if (confidenceScore(row) > confidenceScore(prev)) {
            byKey.set(key, row);
          }
        });
        return Array.from(byKey.values());
      };

      let uaeSalesRows = [];
      let uaePurchaseRows = [];
      // NEW: Store items that fail date check
      let othersRows = [];

      // Determine period bounds
      let pStart = null;
      let pEnd = null;
      if (periodData && periodData.period_from && periodData.period_to) {
        // parse strings like "2025-01-01" to date objects
        // Be careful with timezones if they are YYYY-MM-DD only
        pStart = new Date(periodData.period_from);
        pEnd = new Date(periodData.period_to);
        // Normalize time
        pStart.setHours(0, 0, 0, 0);
        pEnd.setHours(23, 59, 59, 999);
      }

      const routeInvoiceRow = (row, preferredKind = "") => {
        // VAT filing: when period is selected, rows outside period OR
        // rows without parseable date are routed to Others.
        if (pStart && pEnd) {
          const dObj = parseDate(row?.DATE);
          if (!dObj || dObj < pStart || dObj > pEnd) return "others";
        }

        const detected = toKind(row?.TYPE) || preferredKind;
        if (detected === "sales") return "sales";
        if (detected === "purchase") return "purchase";
        return "others";
      };

      const incoming = splitInvoiceBuckets(iv);
      incoming.sales.forEach((r) => {
        const bucket = routeInvoiceRow(r, "sales");
        if (bucket === "sales") uaeSalesRows.push(r);
        else if (bucket === "purchase") uaePurchaseRows.push(r);
        else othersRows.push(r);
      });
      incoming.purchase.forEach((r) => {
        const bucket = routeInvoiceRow(r, "purchase");
        if (bucket === "sales") uaeSalesRows.push(r);
        else if (bucket === "purchase") uaePurchaseRows.push(r);
        else othersRows.push(r);
      });
      incoming.others.forEach((r) => {
        // Keep explicit "other" rows as Others in VAT flow.
        othersRows.push(r);
      });
      uaeSalesRows = dedupeInvoiceRows(uaeSalesRows);
      uaePurchaseRows = dedupeInvoiceRows(uaePurchaseRows);
      othersRows = dedupeInvoiceRows(othersRows);

      const invoiceData = {
        uaeSalesRows,
        uaePurchaseRows,
        othersRows, // ✅ NEW
        totals: iv.totals || null,
        __explicitBuckets: true,
      };

      if (existingPayload) {
        // MERGE BANK: Append new rows to existing rows
        const baseBank = existingPayload.bankData || { rows: [] };
        bankData.rows = [...(baseBank.rows || []), ...bankData.rows];

        // ✅ NEW: Preserve columns if no new bank statement uploaded
        if (!bankData.columns.length && baseBank.columns) {
          bankData.columns = baseBank.columns;
        }

        // Keep new summary if non-empty, else keep existing
        if (!Object.keys(bankData.summary).length) {
          bankData.summary = baseBank.summary || {};
        }

        // MERGE INVOICE: Append new rows
        const baseInv = splitInvoiceBuckets(existingPayload.invoiceData || {});
        invoiceData.uaeSalesRows = [
          ...baseInv.sales,
          ...uaeSalesRows,
        ];
        invoiceData.uaePurchaseRows = [
          ...baseInv.purchase,
          ...uaePurchaseRows,
        ];
        invoiceData.othersRows = [
          ...baseInv.others,
          ...othersRows,
        ];
        invoiceData.uaeSalesRows = dedupeInvoiceRows(invoiceData.uaeSalesRows);
        invoiceData.uaePurchaseRows = dedupeInvoiceRows(
          invoiceData.uaePurchaseRows
        );
        invoiceData.othersRows = dedupeInvoiceRows(invoiceData.othersRows);
      }
      invoiceData.uaeOtherRows = invoiceData.othersRows;

      const combined = {
        companyId,
        companyName: companyName || displayCompanyName,
        bankData,
        invoiceData,
        periodId: periodId ? Number(periodId) : (existingPayload?.periodId || null),
        runId: runId || null,
      };

      if (onCombinedPreviewReady) {
        setResultsModal(null);
        onCombinedPreviewReady(combined);
        return;
      }

      // Navigate to the preview page with the combined data
      const targetQuery = `periodId=${combined.periodId}${runId ? `&runId=${runId}` : ""}`;
      navigate(`/vat-filing-preview/${companyId}?${targetQuery}`, {
        state: combined,
      });
    } catch (err) {
      console.error("Failed to generate combined preview:", err);
      alert("Failed to generate combined preview");
    }
  }

  function gotoBank(r) {
    navigate("/converts/bank-statement/tableresult", { state: r });
  }

  return (
    <section className="imp2 vat-page">
      {/* Header */}
      <header className="imp2-header">
        <div className="title-wrap" style={{ flex: 1 }}>
          <h2>VAT Filing - {displayCompanyName || "Company"}</h2>
          <p className="page-kicker">
            Upload invoices & bank statements, then generate VAT outputs.
          </p>
        </div>

        <div className="imp2-header-actions">
          <button
            type="button"
            className="prj-btn prj-btn-outline vf-back-btn"
            onClick={() => {
              if (embedded && onClose) {
                onClose();
                return;
              }
              if (runId && periodId) {
                navigate(
                  `/projects/vat-filing/periods/${companyId}/runs/${periodId}`
                );
              } else {
                navigate(`/projects/vat-filing/periods/${companyId}`);
              }
            }}
          >
            ← Back
          </button>

          <button
            className="btn btn-black"
            onClick={handleImport}
            disabled={polling}
          >
            {polling ? "Processing…" : "Import"}
          </button>
        </div>
      </header>

      {/* Identity row */}
      <div className="block block-identity">
        <div
          className="static-row"
          style={{ gridTemplateColumns: "1fr 1fr 1fr" }}
        >
          <label className="static-col">
            <span className="small muted">Country</span>
            <select className="input" value="uae" disabled>
              <option value="uae">UAE</option>
            </select>
          </label>
          <label className="static-col">
            <span className="small muted">Company Name</span>
            <input
              className="input"
              placeholder="Enter your company name"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </label>
          <label className="static-col">
            <span className="small muted">Company TRN</span>
            <input
              className="input"
              placeholder="Enter your 15-digit TRN"
              value={companyTRN}
              onChange={(e) => setCompanyTRN(e.target.value)}
            />
          </label>
        </div>
        <p className="muted small">
          Providing your company name helps the AI classify sales vs purchases.
        </p>
      </div>

      <div className="filing-layout">
        {/* Invoices */}
        <div className="upload-card">
          <div className="upload-card-head">
            <div className="upload-title with-count">
              Invoices & Bills{" "}
              <span className="count-pill purchase">{invFiles.length}</span>
            </div>
            <button
              className="btn btn-black btn-add-files"
              onClick={openInvPicker}
              disabled={polling}
            >
              <Upload size={16} /> Add Files
            </button>
            <input
              ref={invoicePickerRef}
              type="file"
              multiple
              accept={INV_ACCEPT}
              onChange={onPickInvoice}
              hidden
            />
          </div>

          <div className="drop-hint">
            Drag & drop files here or click "Add Files"
          </div>

          {invQueue.length > 0 && (
            <div className="block">
              <div className="block-title">Uploading</div>
              <ul className="queue-list">
                {invQueue.map((q) => (
                  <li key={q.id} className="queue-item">
                    <div className="qi-top">
                      <span className="qi-name" title={q.name}>
                        {q.name}
                      </span>
                      <span className="qi-percent">{q.percent}%</span>
                    </div>
                    <div className="progress">
                      <div className="bar" style={{ width: `${q.percent}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <FilesList
            title="Files"
            items={invFiles}
            onSelect={(id) => {
              setActivePane("inv");
              setInvSelectedId(id);
            }}
            selectedId={invSelectedId}
            onRemove={(id) => removeInvoice(id)}
          />
        </div>

        {/* Right-side preview panel */}
        <div className="pane-right">
          {!selected && (
            <div className="preview-empty">Select a file to preview</div>
          )}

          {selected && selected.type === "image" && (
            <ImageViewer
              key={selected.id}
              src={selected.url}
              alt={selected.name}
              initialScale={1}
              minScale={0.4}
              maxScale={5}
              step={0.2}
            />
          )}

          {selected && selected.type === "pdf" && (
            <PdfViewer
              key={selected.id}
              fileUrl={selected.url}
              controls={{
                prev: <ChevronLeft size={16} />,
                next: <ChevronRight size={16} />,
              }}
            />
          )}
        </div>
      </div>

      {/* Processing overlay */}
      {polling && (
        <div
          className="import-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Processing"
        >
          <div className="import-card">
            <div className="progress-card">
              <div className="progress-top">
                <span>{status?.message || "Processing…"}</span>
                {status?.total_files || status?.processed_files ? (
                  <span className="small">
                    {status?.processed_files || 0} / {status?.total_files || 0}
                  </span>
                ) : null}
              </div>
              <div className="progress-outer">
                <div
                  className="progress-inner"
                  style={{ width: `${status?.progress_pct ?? 0}%` }}
                />
              </div>
            </div>
            <div className="small muted">Please keep this tab open.</div>
          </div>
        </div>
      )}

      {/* Results modal with links to your existing result routes */}
      {resultsModal && (
        <div className="vf-modal" role="dialog" aria-modal="true">
          <div className="vf-modal-card">
            <div className="vf-modal-hd">
              <h3>Import Completed</h3>
              <button
                className="vf-x"
                onClick={() => setResultsModal(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="vf-modal-body">
              {resultsModal.invoice || resultsModal.bank?.length > 0 ? (
                <div className="vf-res-block">
                  <div className="vf-res-title">Combined VAT Filing</div>
                  <button
                    className="btn btn-black"
                    onClick={gotoCombinedPreview}
                  >
                    {onCombinedPreviewReady ? "Update Preview" : "View Combined Preview"}
                  </button>
                </div>
              ) : (
                <div className="vf-res-empty">
                  No data imported. Please import invoices and/or bank
                  statements first.
                </div>
              )}
            </div>
            <div className="vf-modal-ft">
              <button
                className="prj-btn prj-btn-outline"
                onClick={() => setResultsModal(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function FilesList({ title, items, onSelect, selectedId, onRemove }) {
  return (
    <div className="block">
      <div className="block-title">{title}</div>
      {items.length === 0 ? (
        <div className="muted small">No files yet.</div>
      ) : (
        <div className="file-list-scroll">
          <ul className="file-list">
            {items.map((f) => (
              <li
                key={f.id}
                className={`file-item ${selectedId === f.id ? "active" : ""}`}
              >
                <button
                  className="file-main"
                  onClick={() => onSelect(f.id)}
                  title={f.name}
                >
                  <span className="icon">
                    {f.type === "image" ? (
                      <ImageIcon size={16} />
                    ) : (
                      <FileText size={16} />
                    )}
                  </span>
                  <span className="name">{f.name}</span>
                </button>
                <button
                  className="icon-btn danger"
                  onClick={() => onRemove(f.id)}
                  aria-label="Delete"
                  title="Remove"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
