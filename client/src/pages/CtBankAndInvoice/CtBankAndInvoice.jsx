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
import { useNavigate, useParams } from "react-router-dom";

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
} from "../../helper/helper";
import { api } from "../../helper/helper";

import "./CtBankAndInvoice.css";

const MAX_BANK_BYTES = 20 * 1024 * 1024; // 20MB

export default function CtBankAndInvoice() {
  return <CtFilingComposer />;
}

function CtFilingComposer() {
  // Get company ID from URL params
  const { companyId } = useParams();

  // identity
  const [country] = useState("uae");
  const [companyName, setCompanyName] = useState("");
  const [companyTRN, setCompanyTRN] = useState("");
  const [displayCompanyName, setDisplayCompanyName] = useState(""); // For display only

  // Set the document title when display company name changes
  useEffect(() => {
    document.title = `DocuFlow - CT Filing - ${
      displayCompanyName || "Company"
    }`;
  }, [displayCompanyName]);

  // Load company data when component mounts
  useEffect(() => {
    if (companyId) {
      loadCompanyData();
    }
  }, [companyId]);

  const loadCompanyData = async () => {
    try {
      const response = await getCompanyById(companyId);
      setDisplayCompanyName(response.company.name);
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
          company_name: companyName,
          company_trn: companyTRN,
        });

        await pollUntilDone(job_id, token);

        const preview = await fetchInvoicePreview({ jobId: job_id, token });
        const apiDownloadUrl = makeInvoiceDownloadUrl(job_id);

        // invoiceResult = {
        //     title: preview.title || "Invoice Results",
        //     downloadLabel: "Download Excel",
        //     downloadFileName: preview.downloadFileName || "invoices.xlsx",
        //     apiDownloadUrl,
        //     authToken: token,
        //     table: preview.table || { columns: [], rows: [] },
        //     totals: preview.totals || { purchase: {}, sales: {} },
        // };
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
          uaeSalesRows: preview.uaeSalesRows || null,
          uaePurchaseRows: preview.uaePurchaseRows || null,
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
        totals: result.totals,
      },
    });
  }

  // generate combined data and navigate to preview
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
        return;
      }

      // BANK: coerce columns to {key,label}
      function normalizeColumns(cols) {
        if (!Array.isArray(cols)) return [];
        if (cols.length && typeof cols[0] === "string") {
          return cols.map((k) => ({ key: k, label: k.replace(/_/g, " ") }));
        }
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

      // ✅ pick first non-empty summary from any bank file
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
        summary: firstSummary,
      };

      // INVOICE: prefer already separated arrays; else split by TYPE (many aliases)
      const iv = resultsModal.invoice || {};
      const rawRows =
        iv.uaeSalesRows && iv.uaePurchaseRows
          ? [...iv.uaeSalesRows, ...iv.uaePurchaseRows]
          : iv.table?.rows || [];

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

      let uaeSalesRows = [];
      let uaePurchaseRows = [];

      if (iv.uaeSalesRows && iv.uaePurchaseRows) {
        // backend already separated
        uaeSalesRows = iv.uaeSalesRows;
        uaePurchaseRows = iv.uaePurchaseRows;
      } else {
        // split from unified "rawRows" by TYPE
        rawRows.forEach((r) => {
          const kind = toKind(r.TYPE);
          if (kind === "sales") uaeSalesRows.push(r);
          else if (kind === "purchase") uaePurchaseRows.push(r);
        });
        // if still empty but data exists, assume all sales so UI shows something
        if (!uaeSalesRows.length && rawRows.length) uaeSalesRows = rawRows;
      }

      const invoiceData = {
        uaeSalesRows,
        uaePurchaseRows,
        // let backend recompute if not provided
        totals: iv.totals || null,
      };

      const combined = {
        companyId,
        companyName: companyName || displayCompanyName,
        bankData,
        invoiceData,
      };

      // Navigate to the preview page with the combined data
      navigate(`/ct-filing-preview/${companyId}`, { state: combined });
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
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <button
            className="btn-back"
            onClick={() => navigate(`/projects/ct-filing/types/${companyId}`)}
          >
            ←
          </button>
          <div className="title-wrap" style={{ flex: 1 }}>
            <h2>CT Filing - {displayCompanyName || "Company"} (Type 2)</h2>
            <p className="page-kicker">
              Upload invoices & bank statements, then generate CT outputs.
            </p>
          </div>
        </div>
        <button
          className="btn btn-black"
          onClick={handleImport}
          disabled={polling}
        >
          {polling ? "Processing…" : "Import"}
        </button>
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

      <div className="two-panels">
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

        {/* Bank statements */}
        <div className="upload-card">
          <div className="upload-card-head">
            <div className="upload-title with-count">
              Bank Statements{" "}
              <span className="count-pill purchase">{bankFiles.length}</span>
            </div>
            <button
              className="btn btn-black btn-add-files"
              onClick={openBankPicker}
              disabled={polling}
            >
              <Upload size={16} /> Add Files
            </button>
            <input
              ref={bankPickerRef}
              type="file"
              multiple
              accept={BANK_ACCEPT}
              onChange={onPickBank}
              hidden
            />
          </div>

          <div className="drop-hint">
            Drag & drop files here or click "Add Files"
          </div>

          {/* Password */}
          <div className="field" style={{ marginTop: 12 }}>
            <label className="label-inline">
              <Lock size={14} /> PDF Password (optional)
            </label>
            <div className="pw-wrap">
              <input
                type={showPw ? "text" : "password"}
                className="pw-input"
                placeholder="Enter password if any PDFs are protected"
                value={pdfPassword}
                onChange={(e) => setPdfPassword(e.target.value)}
                autoComplete="off"
              />
              <button
                type="button"
                className="pw-toggle"
                onClick={() => setShowPw((s) => !s)}
                aria-label={showPw ? "Hide password" : "Show password"}
                title={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {bankQueue.length > 0 && (
            <div className="block">
              <div className="block-title">Uploading</div>
              <ul className="queue-list">
                {bankQueue.map((q) => (
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
            items={bankFiles}
            onSelect={(id) => {
              setActivePane("bank");
              setBankSelectedId(id);
            }}
            selectedId={bankSelectedId}
            onRemove={(id) => removeBank(id)}
          />
        </div>
      </div>

      {/* Right-side viewer (below on mobile) */}
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
              {resultsModal.invoice ? (
                <div className="vf-res-block">
                  <div className="vf-res-title">Invoices</div>
                  <button
                    className="btn btn-black"
                    onClick={() => gotoInvoice(resultsModal.invoice)}
                  >
                    View Invoice Results
                  </button>
                </div>
              ) : (
                <div className="vf-res-empty">No invoices were imported.</div>
              )}

              {resultsModal.bank?.length ? (
                <div className="vf-res-block">
                  <div className="vf-res-title">Bank Statements</div>
                  <div className="vf-bank-grid">
                    {resultsModal.bank.map((r, i) => (
                      <button
                        key={i}
                        className="btn btn-black"
                        onClick={() => gotoBank(r)}
                      >
                        View Bank Result — {r.subtitle}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="vf-res-empty">
                  No bank statements were imported.
                </div>
              )}

              {(resultsModal.invoice || resultsModal.bank?.length > 0) && (
                <div className="vf-res-block">
                  <div className="vf-res-title">Combined CT Filing</div>
                  <button
                    className="btn btn-black"
                    onClick={gotoCombinedPreview}
                  >
                    View Combined Preview
                  </button>
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
