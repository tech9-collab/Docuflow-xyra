import { useEffect, useRef, useState } from "react";
import "./ImageViewer.css";

/**
 * Simple zoomable image viewer.
 * - Zoom in/out/reset
 * - Panning with mouse drag (optional toggle below)
 */
export default function ImageViewer({
  src,
  alt = "",
  minScale = 0.5,
  maxScale = 4,
  step = 0.2,
  initialScale = 1,
}) {
  const [scale, setScale] = useState(initialScale);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const startRef = useRef({ x: 0, y: 0 });
  const lastRef = useRef({ x: 0, y: 0 });
  const imgWrapRef = useRef(null);

  useEffect(() => {
    // reset pan when source changes
    setPos({ x: 0, y: 0 });
    setScale(initialScale);
  }, [src, initialScale]);

  const zoomIn = () => setScale(s => Math.min(maxScale, +(s + step).toFixed(2)));
  const zoomOut = () => setScale(s => Math.max(minScale, +(s - step).toFixed(2)));
  const reset = () => { setScale(1); setPos({ x: 0, y: 0 }); };

  // --- PANNING (drag to move) ---
  function onMouseDown(e) {
    // Only start dragging when the image area is larger than the viewport or user wants to pan
    setDragging(true);
    startRef.current = { x: e.clientX, y: e.clientY };
    lastRef.current = pos;
    e.preventDefault();
  }
  function onMouseMove(e) {
    if (!dragging) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    setPos({ x: lastRef.current.x + dx, y: lastRef.current.y + dy });
  }
  function onMouseUp() { setDragging(false); }

  // Optional: zoom with wheel (Ctrl+wheel or plain wheel—pick one)
  function onWheel(e) {
    e.preventDefault();
    const delta = Math.sign(e.deltaY);
    if (delta > 0) zoomOut();
    else zoomIn();
  }

  return (
    <div
      className={`imgv-wrap ${dragging ? "dragging" : ""}`}
      ref={imgWrapRef}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
    >
      <div className="imgv-toolbar">
        <button className="btn-mini" onClick={zoomOut} aria-label="Zoom out">-</button>
        <div className="imgv-meta">{Math.round(scale * 100)}%</div>
        <button className="btn-mini" onClick={zoomIn} aria-label="Zoom in">+</button>
        <div className="spacer" />
        <button className="btn-mini" onClick={reset} aria-label="Reset zoom">Reset</button>
      </div>

      <div className="imgv-stage" onMouseDown={onMouseDown}>
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={{
            transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
          }}
        />
      </div>
    </div>
  );
}
