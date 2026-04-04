import { useEffect, useMemo, useRef, useState } from "react";
import {
  Upload,
  Trash2,
  FileText,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import PdfViewer from "../../components/PdfViewer/PdfViewer";
import ImageViewer from "../../components/ImageViewer/ImageViewer";
import "./Invoices.css";

import {
  startInvoiceJob,
  pollInvoiceStatus,
  fetchInvoicePreview,
  makeInvoiceDownloadUrl,
} from "../../helper/helper";

export default function Invoices() {
  // Set document title
  useEffect(() => {
    document.title = "Xyra Books - Upload Invoices & Bills";
  }, []);

  return <ImporterInvoices />;
}

function ImporterInvoices() {
  const title = "Upload Invoices & Bills";
  const accept = ".pdf,image/*";
  const navigate = useNavigate();

  const inputRef = useRef(null);

  const [queue, setQueue] = useState([]);
  const [files, setFiles] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const [country] = useState("uae");
  const [companyName, setCompanyName] = useState("");
  const [companyTRN, setCompanyTRN] = useState("");

  const [polling, setPolling] = useState(false);
  const [status, setStatus] = useState(null);
  const pollTimer = useRef(null);

  const selected = useMemo(
    () => files.find((f) => f.id === selectedId) || null,
    [files, selectedId]
  );

  const openPicker = () => inputRef.current?.click();

  const onPick = (e) => {
    const picked = Array.from(e.target.files || []);
    if (!picked.length) return;
    picked.forEach((file) => readWithProgress(file));
    e.target.value = "";
  };

  function readWithProgress(file) {
    const id = crypto.randomUUID();

    setQueue((prev) => [
      ...prev,
      { id, name: file.name, size: file.size, percent: 0 },
    ]);

    const reader = new FileReader();
    reader.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      const percent = Math.min(100, Math.round((ev.loaded / ev.total) * 100));
      setQueue((prev) =>
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
      setQueue((prev) => prev.filter((it) => it.id !== id));
      setFiles((prev) => {
        const next = [
          ...prev,
          {
            id,
            name: file.name,
            size: file.size,
            url,
            type,
            file,
          },
        ];
        if (!selectedId) setSelectedId(id);
        return next;
      });
    };
    reader.onerror = () =>
      setQueue((prev) => prev.filter((it) => it.id !== id));
    reader.readAsArrayBuffer(file);
  }

  function removeFile(id) {
    setFiles((prev) => {
      const idx = prev.findIndex((f) => f.id === id);
      const target = prev[idx];
      if (target) URL.revokeObjectURL(target.url);
      const next = prev.filter((f) => f.id !== id);
      if (selectedId === id) {
        const neighbor = next[idx] || next[idx - 1] || null;
        setSelectedId(neighbor?.id || null);
      }
      return next;
    });
  }

  useEffect(() => {
    if (files.length && !files.some((f) => f.id === selectedId)) {
      setSelectedId(files[0].id);
    }
  }, [files, selectedId]);

  async function handleImport() {
    if (!files.length || polling) return;

    const token = localStorage.getItem("token");
    if (!token) {
      alert("Please login first.");
      return;
    }

    setStatus(null);
    setPolling(true);

    try {
      const { job_id } = await startInvoiceJob({
        files,
        country,
        token,
        company_name: companyName,
        company_trn: companyTRN,
      });

      await pollUntilDone(job_id, token);

      const preview = await fetchInvoicePreview({ jobId: job_id, token });
      const apiDownloadUrl = makeInvoiceDownloadUrl(job_id);

      navigate("/converts/invoices/tableresult", {
        state: {
          jobId: job_id,
          title: preview.title || "Invoice Results",
          downloadLabel: "Download Excel",
          downloadFileName: preview.downloadFileName || "invoices.xlsx",
          apiDownloadUrl,
          authToken: token,
          table: preview.table || { columns: [], rows: [] },
          uaeSalesRows: preview.uaeSalesRows || [],
          uaePurchaseRows: preview.uaePurchaseRows || [],
          othersRows: preview.othersRows || [],
          totals: preview.totals || { purchase: {}, sales: {} },
        },
      });
    } catch (err) {
      console.error(err);
      alert(err.message || "Import failed");
    } finally {
      if (pollTimer.current) clearInterval(pollTimer.current);
      setPolling(false);
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

  const allFilesRef = useRef([]);
  useEffect(() => {
    allFilesRef.current = [...files];
  }, [files]);
  useEffect(() => {
    return () => {
      allFilesRef.current.forEach((f) => URL.revokeObjectURL(f.url));
    };
  }, []);

  return (
    <section className="imp2">
      {/* Header */}
      <header className="imp2-header">
        <div className="title-wrap">
          <h2>{title}</h2>
          <p className="page-kicker">
            PDF or images. Max size depends on your plan.
          </p>
        </div>
        <button
          className="btn btn-black"
          onClick={handleImport}
          disabled={polling || !files.length}
          title={!files.length ? "Add files first" : ""}
        >
          {polling ? "Processing…" : "Import"}
        </button>
      </header>

      {/* Company identity */}
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
      </div>

      <div className="imp2-grid">
        {/* LEFT */}
        <div className="pane-left">
          <div className="upload-card">
            <div className="upload-card-head">
              <div className="upload-title with-count">
                Invoices
                <span className="count-pill purchase" title="Uploaded files">
                  {files.length}
                </span>
              </div>
              {/* Add Files — black button */}
              <button
                className="btn btn-black btn-add-files"
                onClick={openPicker}
                disabled={polling}
              >
                <Upload size={16} /> Add Files
              </button>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept={accept}
                onChange={onPick}
                hidden
              />
            </div>

            <p className="upload-sub">Add UAE invoices (PDF or Images).</p>

            {/* Uploading progress */}
            {queue.length > 0 && (
              <div className="block">
                <div className="block-title">Uploading</div>
                <ul className="queue-list">
                  {queue.map((q) => (
                    <li key={q.id} className="queue-item">
                      <div className="qi-top">
                        <span className="qi-name" title={q.name}>
                          {q.name}
                        </span>
                        <span className="qi-percent">{q.percent}%</span>
                      </div>
                      <div className="progress">
                        <div
                          className="bar"
                          style={{ width: `${q.percent}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <FilesList
              title="Files"
              items={files}
              onSelect={setSelectedId}
              selectedId={selectedId}
              onRemove={(id) => removeFile(id)}
            />
          </div>

          {polling && (
            <div
              className="import-overlay"
              role="dialog"
              aria-modal="true"
              aria-label="Converting invoices"
            >
              <div className="import-card">
                <div className="progress-card">
                  <div className="progress-top">
                    <span>{status?.message || "Processing..."}</span>
                    <span className="small">
                      {status?.processed_files || 0} /{" "}
                      {status?.total_files || 0}
                    </span>
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
        </div>

        {/* RIGHT: preview */}
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
