// pages/TradeLicense/TradeLicense.jsx  (REPLACE)
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
import "./TradeLicense.css";

import {
    startTradeLicenseJob,
    pollTradeLicenseStatus,
    fetchTradeLicensePreview,
    makeTradeLicenseDownloadUrl,
} from "../../helper/helper";

export default function TradeLicense() {
    // Set document title
    useEffect(() => {
        document.title = "DocuFlow - Upload Trade License";
    }, []);

    return <ImporterTradeLicense />;
}

function ImporterTradeLicense() {
    const title = "Upload Trade License";
    const accept = ".pdf,image/*";
    const navigate = useNavigate();
    const fileInputRef = useRef(null);

    const [queue, setQueue] = useState([]);
    const [files, setFiles] = useState([]); // [{id,name,size,url,type,file}]
    const [selectedId, setSelectedId] = useState(null);

    // progress overlay (same style as Emirates)
    const [polling, setPolling] = useState(false);
    const [status, setStatus] = useState(null);
    const pollTimer = useRef(null);

    const selected = useMemo(
        () => files.find((f) => f.id === selectedId) || null,
        [files, selectedId]
    );
    const openPicker = () => fileInputRef.current?.click();

    const onPick = (e) => {
        const picked = Array.from(e.target.files || []);
        if (!picked.length) return;
        picked.forEach(readWithProgress);
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
                prev.map((q) => (q.id === id ? { ...q, percent } : q))
            );
        };
        reader.onload = () => {
            const url = URL.createObjectURL(file);
            const type = file.type.startsWith("image/")
                ? "image"
                : file.type === "application/pdf" || /\.pdf$/i.test(file.name)
                    ? "pdf"
                    : "other";
            setQueue((prev) => prev.filter((q) => q.id !== id));
            setFiles((prev) => {
                const next = [
                    ...prev,
                    { id, name: file.name, size: file.size, url, type, file },
                ];
                if (!selectedId) setSelectedId(id);
                return next;
            });
        };
        reader.onerror = () => setQueue((prev) => prev.filter((q) => q.id !== id));
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
        if (files.length && !files.some((f) => f.id === selectedId))
            setSelectedId(files[0].id);
    }, [files, selectedId]);

    // revoke blobs on unmount
    const filesRef = useRef([]);
    useEffect(() => {
        filesRef.current = files;
    }, [files]);
    useEffect(
        () => () => filesRef.current.forEach((f) => URL.revokeObjectURL(f.url)),
        []
    );

    async function handleConvert() {
        if (!files.length || polling) return;
        const token = localStorage.getItem("token");
        if (!token) {
            alert("Please login first.");
            return;
        }

        setStatus(null);
        setPolling(true);

        try {
            // 1) start TL job
            const { job_id } = await startTradeLicenseJob({ files, token });

            // 2) poll status until done
            await new Promise((resolve, reject) => {
                const tick = async () => {
                    try {
                        const s = await pollTradeLicenseStatus({ jobId: job_id, token });
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

            // 3) load preview + download URL
            const preview = await fetchTradeLicensePreview({ jobId: job_id, token });
            const apiDownloadUrl = makeTradeLicenseDownloadUrl(job_id);

            // 4) navigate to table
            navigate("/converts/tradelicense/tableresult", {
                state: {
                    title: preview.title || "UAE Trade License Results",
                    columns: preview.columns || [],
                    rows: preview.rows || [],
                    downloadLabel: "Download Excel",
                    downloadFileName: preview.downloadFileName || "trade_license.xlsx",
                    apiDownloadUrl,
                    authToken: token,
                },
            });
        } catch (e) {
            console.error(e);
            alert(e?.message || "Failed to convert Trade License(s)");
        } finally {
            if (pollTimer.current) clearInterval(pollTimer.current);
            setPolling(false);
        }
    }

    return (
        <section className="imp2">
            <header className="imp2-header">
                <h2>{title}</h2>
                <button
                    className="btn primary"
                    onClick={handleConvert}
                    disabled={polling || files.length === 0}
                    title={files.length === 0 ? "Add files first" : ""}
                >
                    {polling ? "Processing…" : "Convert"}
                </button>
            </header>

            <div className="imp2-grid">
                {/* LEFT */}
                <div className="pane-left">
                    <div className="upload-card">
                        <div className="upload-card-head">
                            <div className="upload-title with-count">
                                Trade License
                                <span className="count-pill sales" title="Uploaded files">
                                    {files.length}
                                </span>
                            </div>
                        </div>
                        <div className="upload-sub">
                            Add TL PDF or images (multi-page is okay).
                        </div>
                        <div className="upload-actions" style={{ marginTop: 8 }}>
                            <button
                                className="btn soft"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={polling}
                            >
                                <Upload size={16} /> Add Files
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                multiple
                                accept={accept}
                                onChange={onPick}
                                hidden
                            />
                        </div>

                        {/* (optional) upload progress list */}
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
                            onRemove={removeFile}
                        />
                    </div>

                    {/* Progress overlay — SAME UX as Emirates */}
                    {polling && (
                        <div
                            className="import-overlay"
                            role="dialog"
                            aria-modal="true"
                            aria-label="Converting Trade Licenses"
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

                {/* RIGHT */}
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