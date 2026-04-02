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
  AlertCircle,
} from "lucide-react";
import PdfViewer from "../../components/PdfViewer/PdfViewer";
import ImageViewer from "../../components/ImageViewer/ImageViewer";
// Removed ProjectSelector import
import "./BankStatement.css";
import { useNavigate } from "react-router-dom";

// helpers (contracts updated to accept a password)
import { startBankExtract, pollBankJob } from "../../helper/helper"; // Removed saveExtractedData import

const MAX_BYTES = 20 * 1024 * 1024; // 20MB

export default function BankStatement() {
  // Set document title
  useEffect(() => {
    document.title = "DocuFlow - Upload Bank Statements";
  }, []);

  return <ImporterBank />;
}

function ImporterBank() {
  const title = "Upload Bank Statements";
  const addLabel = "Add Bank Statement";
  const importLabel = "Import";
  const accept = ".pdf,image/*";

  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const passwordInputRef = useRef(null);

  // Single-file state
  const [fileItem, setFileItem] = useState(null); // {id, name, size, url, type, file}
  const [importing, setImporting] = useState(false);
  const [statusText, setStatusText] = useState("");
  // Removed selectedProject state

  // password state
  const [pdfPassword, setPdfPassword] = useState("");
  const [showPw, setShowPw] = useState(false);

  const selected = useMemo(() => fileItem, [fileItem]);

  function openPicker() {
    fileInputRef.current?.click();
  }

  function onPick(e) {
    const f = (e.target.files && e.target.files[0]) || null;
    e.target.value = ""; // allow reselecting same file later
    // Removed warning state
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

    // revoke previous preview url if replacing
    if (fileItem?.url) URL.revokeObjectURL(fileItem.url);

    setFileItem({ id, name: f.name, size: f.size, url, type, file: f });
  }

  function removeFile() {
    if (fileItem?.url) URL.revokeObjectURL(fileItem.url);
    setFileItem(null);
    setPdfPassword("");
    // Removed warning state
  }

  // Removed useEffect for loading default project

  // Revoke blob on unmount
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

      // Removed saveExtractedDataToProject call

      navigate("/converts/bank-statement/tableresult", {
        state: {
          ...result,
          subtitle: fileItem.name,
          downloadFileName: result?.downloadFileName || "bank_statements.xlsx",
          // Removed projectId
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

  // Removed saveExtractedDataToProject function

  const bytesToStr = (n) =>
    n >= 1024 * 1024
      ? `${(n / (1024 * 1024)).toFixed(2)} MB`
      : `${Math.ceil(n / 1024)} KB`;

  return (
    <section className="imp2 page-wrap">
      <header className="imp2-header">
        <div>
          <h2>{title}</h2>
          <p className="muted small">
            Process a single PDF/image at a time (max 20MB).
          </p>
        </div>
        <button
          className="btn btn-black"
          onClick={handleImport}
          disabled={!fileItem || importing}
          title={!fileItem ? "Select a file first" : ""}
        >
          {importing ? statusText || "Importing…" : importLabel}
        </button>
      </header>

      <div className="imp2-grid">
        {/* LEFT */}
        <div className="pane-left">
          <div className="upload-card elevate">
            <div className="upload-title">Upload</div>
            <p className="upload-sub">Choose a PDF or image and import.</p>

            {/* Removed Project section */}

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
                aria-label={addLabel}
              >
                <Upload size={16} /> {addLabel}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={accept}
                onChange={onPick}
                hidden
              />
            </div>

            {/* Removed Warning section */}
          </div>

          {/* Selected file (single) */}
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

        {/* RIGHT */}
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
