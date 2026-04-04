// CtBankOnly.jsx
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
  startBankExtract,
  pollBankJob,
  getCompanyById,
} from "../../helper/helper";

import "./CtBankOnly.css";

const MAX_BYTES = 20 * 1024 * 1024; // 20MB

export default function CtBankOnly() {
  const { companyId } = useParams();
  const navigate = useNavigate();

  const [companyName, setCompanyName] = useState("");
  const [loadingCompany, setLoadingCompany] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await getCompanyById(companyId);
        setCompanyName(res.company?.name || `Company ${companyId}`);
      } catch (e) {
        console.error("Failed to load company:", e);
        setCompanyName(`Company ${companyId}`);
      } finally {
        setLoadingCompany(false);
      }
    }
    if (companyId) load();
  }, [companyId]);

  useEffect(() => {
    document.title = `Xyra Books - CT Filing - Type 1`;
  }, []);

  // ===== Single-file state (same as BankStatement.jsx) =====
  const fileInputRef = useRef(null);
  const passwordInputRef = useRef(null);

  const [fileItem, setFileItem] = useState(null); // {id, name, size, url, type, file}
  const [importing, setImporting] = useState(false);
  const [statusText, setStatusText] = useState("");

  const [pdfPassword, setPdfPassword] = useState("");
  const [showPw, setShowPw] = useState(false);

  const selected = useMemo(() => fileItem, [fileItem]);

  function openPicker() {
    fileInputRef.current?.click();
  }

  function onPick(e) {
    const f = (e.target.files && e.target.files[0]) || null;
    e.target.value = "";
    if (!f) return;

    if (f.size > MAX_BYTES) {
      alert("Maximum file size is 20MB. Please choose a smaller file.");
      return;
    }

    const id = crypto.randomUUID();
    const url = URL.createObjectURL(f);
    const type =
      f.type.startsWith("image/") ||
      /\.(png|jpe?g|webp|gif|tiff?)$/i.test(f.name)
        ? "image"
        : f.type === "application/pdf" || /\.pdf$/i.test(f.name)
        ? "pdf"
        : "other";

    if (fileItem?.url) URL.revokeObjectURL(fileItem.url);

    setFileItem({ id, name: f.name, size: f.size, url, type, file: f });
  }

  function removeFile() {
    if (fileItem?.url) URL.revokeObjectURL(fileItem.url);
    setFileItem(null);
    setPdfPassword("");
  }

  useEffect(() => {
    return () => {
      if (fileItem?.url) URL.revokeObjectURL(fileItem.url);
    };
  }, [fileItem]);

  async function handleImport() {
    if (!fileItem?.file || importing) return;

    setImporting(true);
    setStatusText("Uploading…");

    try {
      const { jobId } = await startBankExtract(fileItem.file, {
        password: pdfPassword?.trim() ? pdfPassword.trim() : undefined,
      });

      const result = await pollBankJob(jobId, {
        onTick: (st) => setStatusText(`Processing (${st})…`),
      });

      // Same behaviour as BankStatement converter
      navigate(`/projects/ct-filing/bank-only/${companyId}/preview`, {
        state: {
          ...result,
          subtitle: fileItem.name,
          downloadFileName:
            result?.downloadFileName || "ct_bank_statements.xlsx",
          companyId,
          companyName,
        },
      });
    } catch (e) {
      console.error(e);
      const msg = e?.message || "Extraction failed.";
      if (/password/i.test(msg)) {
        setTimeout(() => passwordInputRef.current?.focus(), 50);
      }
      alert(msg);
    } finally {
      setImporting(false);
      setStatusText("");
    }
  }

  const bytesToStr = (n) =>
    n >= 1024 * 1024
      ? `${(n / (1024 * 1024)).toFixed(2)} MB`
      : `${Math.ceil(n / 1024)} KB`;

  const goBackToTypes = () => {
    navigate(`/projects/ct-filing/types/${companyId}`);
  };

  return (
    <section className="imp2 page-wrap ct-bank-only">
      {/* Header */}
      <header className="imp2-header ct-bank-header">
        <div className="ct-bank-header-left">
          <button className="btn-back" onClick={goBackToTypes}>
            <ChevronLeft size={18} />
          </button>
          <div>
            <h2>CT Filing – {companyName || "Company"} (Type 1)</h2>
            <p className="muted small">
              Upload a single PDF/image bank statement (max 20MB) and process it
              for CT filing.
            </p>
          </div>
        </div>

        <button
          className="btn btn-black"
          onClick={handleImport}
          disabled={!fileItem || importing}
          title={!fileItem ? "Select a file first" : ""}
        >
          {importing ? statusText || "Importing…" : "Import"}
        </button>
      </header>

      {/* Main grid (re-using BankStatement layout) */}
      <div className="imp2-grid">
        {/* LEFT */}
        <div className="pane-left">
          <div className="upload-card elevate">
            <div className="upload-title">Upload</div>
            <p className="upload-sub">
              Choose a PDF or image and import for CT bank processing.
            </p>

            {/* Password */}
            <div className="field">
              <label className="label-inline">
                <Lock size={14} />
                PDF password (only if protected)
              </label>
              <div className="pw-wrap">
                <input
                  ref={passwordInputRef}
                  type={showPw ? "text" : "password"}
                  placeholder="Enter password (optional)"
                  value={pdfPassword}
                  onChange={(e) => setPdfPassword(e.target.value)}
                  autoComplete="off"
                  className="pw-input"
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
              <div className="hint">Leave empty for non-protected PDFs.</div>
            </div>

            {/* Add button */}
            <div className="upload-actions">
              <button
                className="btn btn-black"
                onClick={openPicker}
                aria-label="Add Bank Statement"
              >
                <Upload size={16} /> Add Bank Statement
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,image/*"
                onChange={onPick}
                hidden
              />
            </div>
          </div>

          {/* Selected file */}
          <div className="block elevate">
            <div className="block-title">Selected file</div>
            {!selected ? (
              <div className="muted small">No file selected.</div>
            ) : (
              <div className="single-file">
                <div className="file-chip" title={selected.name}>
                  <span className="icon">
                    {selected.type === "image" ? (
                      <ImageIcon size={16} />
                    ) : (
                      <FileText size={16} />
                    )}
                  </span>
                  <div className="meta">
                    <div className="name">{selected.name}</div>
                    <div className="size muted">
                      {bytesToStr(selected.size)}
                    </div>
                  </div>
                </div>
                <button
                  className="icon-btn danger"
                  onClick={removeFile}
                  aria-label="Delete"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT – preview */}
        <div className="pane-right elevate">
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

      {/* Import overlay */}
      {importing && (
        <div className="import-overlay" role="status" aria-live="polite">
          <div className="import-card">
            <div className="spinner" />
            <div className="import-text">
              {statusText || "Importing… Please wait"}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
