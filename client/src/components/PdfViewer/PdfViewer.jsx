import { useEffect, useRef, useState } from "react";
// import * as pdfjsLib from "pdfjs-dist";
// import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url"; // <- bundled URL

import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf";
import workerSrc from "pdfjs-dist/legacy/build/pdf.worker.min.js?url";
import "pdfjs-dist/web/pdf_viewer.css";
import "./PdfViewer.css";

// Tell pdf.js where to fetch the worker script (bundled asset, not CDN)
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export default function PdfViewer({ fileUrl, controls = {} }) {
  const canvasRef = useRef(null);

  const [doc, setDoc] = useState(null);   // current PDFDocumentProxy
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(1);
  const [scale, setScale] = useState(1.15);

  const loadTaskRef = useRef(null);   // PDFDocumentLoadingTask
  const renderTaskRef = useRef(null); // RenderTask
  const docRef = useRef(null);        // holds last PDFDocumentProxy for cleanup

  // Load when fileUrl changes
  useEffect(() => {
    let cancelled = false;

    // reset UI
    setDoc(null);
    setPage(1);
    setTotal(1);
    cancelRender();
    cancelLoad();
    clearCanvas();

    if (!fileUrl) return;

    // start loading new doc
    const task = pdfjsLib.getDocument({ url: fileUrl });
    loadTaskRef.current = task;

    (async () => {
      try {
        const pdf = await task.promise;
        if (cancelled) {
          // If we got cancelled after load, destroy the doc we just got.
          try { await pdf.destroy(); } catch {}
          return;
        }
        // Destroy any previous doc before swapping in a new one
        try { await docRef.current?.destroy?.(); } catch {}
        docRef.current = pdf;

        setDoc(pdf);
        setTotal(pdf.numPages);
      } catch (e) {
        if (e?.name !== "AbortException") console.error("PDF load error:", e);
      }
    })();

    return () => {
      cancelled = true;
      cancelRender();
      // IMPORTANT: only cancel loading, don't destroy the global worker
      try { loadTaskRef.current?.cancel?.(); } catch {}
      loadTaskRef.current = null;
      clearCanvas();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl]);

  // Render whenever doc/page/scale change
  useEffect(() => {
    renderPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, page, scale]);

  function cancelLoad() {
    try { loadTaskRef.current?.cancel?.(); } catch {}
    loadTaskRef.current = null;
  }

  function cancelRender() {
    try { renderTaskRef.current?.cancel?.(); } catch {}
    renderTaskRef.current = null;
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 1;   // keep minimal size so container height stays stable
    canvas.height = 1;
  }

  async function renderPage() {
    if (!doc) return;
    cancelRender();

    try {
      const safePage = Math.min(Math.max(1, page), doc.numPages);
      const pdfPage = await doc.getPage(safePage);
      const viewport = pdfPage.getViewport({ scale });

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderTask = pdfPage.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = renderTask;
      await renderTask.promise;
    } catch (e) {
      if (e?.name !== "RenderingCancelledException") {
        console.error("Render error:", e);
      }
    } finally {
      renderTaskRef.current = null;
    }
  }

  return (
    <div className="pdf-wrap">
      <div className="pdf-toolbar">
        <button className="btn-mini" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={!doc || page <= 1}>
          {controls.prev || "<"}
        </button>
        <div className="pdf-meta">{page} / {total}</div>
        <button className="btn-mini" onClick={() => setPage(p => Math.min(total, p + 1))} disabled={!doc || page >= total}>
          {controls.next || ">"}
        </button>
        <div className="spacer" />
        <button className="btn-mini" onClick={() => setScale(s => Math.max(0.6, +(s - 0.2).toFixed(1)))}>-</button>
        <div className="pdf-meta">{Math.round(scale * 100)}%</div>
        <button className="btn-mini" onClick={() => setScale(s => Math.min(2, +(s + 0.2).toFixed(1)))}>+</button>
      </div>

      <div className="pdf-stage">
        <canvas ref={canvasRef} className="pdf-canvas" />
      </div>
    </div>
  );
} 
