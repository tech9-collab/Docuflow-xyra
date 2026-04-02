// pages/Bills/Bills.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Upload, Trash2, FileText, Image as ImageIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import PdfViewer from "../../components/PdfViewer/PdfViewer";
import ImageViewer from "../../components/ImageViewer/ImageViewer";
import "./Bills.css"; // reuse the same stylesheet
import { extractBills } from "../../helper/helper";

export default function Bills() {
  // Set document title
  useEffect(() => {
    document.title = "DocuFlow - Upload Bills (UAE)";
  }, []);

  return <BillsImporter />;
}

function BillsImporter() {
  const title = "Upload Bills (UAE)";
  const accept = ".pdf,image/*";
  const navigate = useNavigate();

  const inputRef = useRef(null);

  // upload queue + files
  const [queue, setQueue] = useState([]); // [{id,name,percent}]
  const [files, setFiles] = useState([]); // [{id,name,size,url,type,file}]
  const [selectedId, setSelectedId] = useState(null);

  // converting overlay
  const [converting, setConverting] = useState(false);
  const [statusText, setStatusText] = useState("Preparing…");

  const selected = useMemo(
    () => files.find((f) => f.id === selectedId) || null,
    [files, selectedId]
  );

  const openPicker = () => inputRef.current?.click();

  const onPick = (e) => {
    const picked = Array.from(e.target.files || []);
    if (!picked.length) return;
    picked.forEach(readWithProgress);
    e.target.value = "";
  };

  function readWithProgress(file) {
    const id = crypto.randomUUID();
    setQueue((prev) => [...prev, { id, name: file.name, size: file.size, percent: 0 }]);

    const reader = new FileReader();
    reader.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      const percent = Math.min(100, Math.round((ev.loaded / ev.total) * 100));
      setQueue((prev) => prev.map((it) => (it.id === id ? { ...it, percent } : it)));
    };
    reader.onload = () => {
      const url = URL.createObjectURL(file);
      const type = file.type.startsWith("image/")
        ? "image"
        : file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
        ? "pdf"
        : "other";
      setQueue((prev) => prev.filter((it) => it.id !== id));
      setFiles((prev) => {
        const next = [...prev, { id, name: file.name, size: file.size, url, type, file }];
        if (!selectedId) setSelectedId(id);
        return next;
      });
    };
    reader.onerror = () => setQueue((prev) => prev.filter((it) => it.id !== id));
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

  // keep selection valid
  useEffect(() => {
    if (files.length && !files.some((f) => f.id === selectedId)) {
      setSelectedId(files[0].id);
    }
  }, [files, selectedId]);

  // revoke blobs on unmount
  const allRef = useRef([]);
  useEffect(() => {
    allRef.current = [...files];
  }, [files]);
  useEffect(() => () => allRef.current.forEach((f) => URL.revokeObjectURL(f.url)), []);

  async function handleConvert() {
    if (!files.length || converting) return;

    const token = localStorage.getItem("token");
    if (!token) {
      alert("Please login first.");
      return;
    }

    try {
      setConverting(true);
      setStatusText("Uploading…");

      const payload = await extractBills(files);
      navigate("/converts/bills/tableresult", {
        state: {
          title: payload.title || "Bills Results",
          columns: payload.columns || [],
          rows: payload.rows || [],
          downloadLabel: "Download Excel",
          downloadFileName: payload.downloadFileName || "Bills.xlsx",
          authToken: token,
        },
      });
    } catch (e) {
      console.error(e);
      alert(e?.response?.data?.message || e.message || "Failed to convert bills");
    } finally {
      setConverting(false);
    }
  }

  return (
    <section className="imp2">
      <header className="imp2-header">
        <h2>{title}</h2>
        <button
          className="btn primary"
          onClick={handleConvert}
          disabled={converting || files.length === 0}
          title={files.length === 0 ? "Add files first" : ""}
        >
          {converting ? "Processing…" : "Convert"}
        </button>
      </header>

      <div className="imp2-grid">
        <div className="pane-left">
          <div className="upload-card">
            <div className="upload-card-head">
              <div className="upload-title with-count">
                Bills
                <span className="count-pill purchase" title="Uploaded files">
                  {files.length}
                </span>
              </div>
            </div>

            <div className="upload-sub">Add bills/receipts (images or PDFs).</div>

            <div className="upload-actions" style={{ marginTop: 8 }}>
              <button className="btn soft" onClick={openPicker} disabled={converting}>
                <Upload size={16} /> Add Files
              </button>
              <input ref={inputRef} type="file" multiple accept={accept} onChange={onPick} hidden />
            </div>

            {/* Upload queue */}
            {queue.length > 0 && (
              <div className="block">
                <div className="block-title">Uploading</div>
                <ul className="queue-list">
                  {queue.map((q) => (
                    <li key={q.id} className="queue-item">
                      <div className="qi-top">
                        <span className="qi-name" title={q.name}>{q.name}</span>
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
              items={files}
              onSelect={setSelectedId}
              selectedId={selectedId}
              onRemove={removeFile}
            />
          </div>

          {/* Modal loader (reusing invoice styles) */}
          {converting && (
            <div className="import-overlay" role="dialog" aria-modal="true" aria-label="Converting bills">
              <div className="import-card">
                <div className="progress-card">
                  <div className="progress-top">
                    <span>{statusText}</span>
                    {/* no percentage number as requested previously */}
                  </div>
                  <div className="progress-outer">
                    <div className="progress-inner" style={{ width: "60%" }} />
                  </div>
                </div>
                <div className="small muted">Please keep this tab open.</div>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: preview */}
        <div className="pane-right">
          {!selected && <div className="preview-empty">Select a file to preview</div>}
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
              controls={{ prev: <ChevronLeft size={16} />, next: <ChevronRight size={16} /> }}
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
              <li key={f.id} className={`file-item ${selectedId === f.id ? "active" : ""}`}>
                <button className="file-main" onClick={() => onSelect(f.id)} title={f.name}>
                  <span className="icon">
                    {f.type === "image" ? <ImageIcon size={16} /> : <FileText size={16} />}
                  </span>
                  <span className="name">{f.name}</span>
                </button>
                <button className="icon-btn danger" onClick={() => onRemove(f.id)} aria-label="Delete">
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
