import { useLocation } from "react-router-dom";
import { useMemo, useState, useRef, useEffect } from "react";
import axios from "axios";
import "./InvoiceTable.css";
import PdfViewer from "../../components/PdfViewer/PdfViewer";
import ImageViewer from "../../components/ImageViewer/ImageViewer";
import { X, Info } from "lucide-react";

/* --- DATE UTILS (same as yours, kept unchanged) --- */
const parseFlexibleDate = (s) => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

const formatDateDisplay = (val) => {
  if (!val) return "";
  const d = parseFlexibleDate(val);
  if (!d) return val;
  return `${String(d.getDate()).padStart(2, "0")}/${String(
    d.getMonth() + 1
  ).padStart(2, "0")}/${d.getFullYear()}`;
};

export default function InvoiceTable() {
  const { state } = useLocation() || {};
  const { table = { columns: [], rows: [] } } = state || {};

  const [preview, setPreview] = useState(null);

  /* ✅ FIXED TOOLTIP STATE (INSIDE COMPONENT) */
  const [posTooltipOpen, setPosTooltipOpen] = useState(false);
  const [posTooltipPos, setPosTooltipPos] = useState({ x: 0, y: 0 });

  const posIconRef = useRef(null);
  const posClickLockedRef = useRef(false);

  const showPosTooltip = () => {
    if (posIconRef.current) {
      const rect = posIconRef.current.getBoundingClientRect();
      setPosTooltipPos({
        x: rect.left,
        y: rect.bottom + 8,
      });
      setPosTooltipOpen(true);
    }
  };

  useEffect(() => {
    const handleClickOutside = () => {
      if (!posClickLockedRef.current) {
        setPosTooltipOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  const columns = table.columns || [];
  const rows = table.rows || [];

  return (
    <div className="result-page">
      <div className="result-card">
        <div className="tbl-scroller">
          <table className="tbl nice">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key}>
                    {c.key === "PLACE OF SUPPLY" ? (
                      <span className="th-with-info">
                        {c.label}
                        <button
                          ref={posIconRef}
                          className="pos-info-btn"
                          onMouseEnter={showPosTooltip}
                          onMouseLeave={() => {
                            if (!posClickLockedRef.current)
                              setPosTooltipOpen(false);
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            posClickLockedRef.current =
                              !posClickLockedRef.current;
                            if (posClickLockedRef.current) {
                              showPosTooltip();
                            } else {
                              setPosTooltipOpen(false);
                            }
                          }}
                        >
                          <Info size={13} />
                        </button>
                      </span>
                    ) : (
                      c.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c.key}>
                      {String(r[c.key] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ✅ TOOLTIP */}
      {posTooltipOpen && (
        <div
          className="pos-tooltip-popup"
          style={{
            position: "fixed",
            top: posTooltipPos.y,
            left: posTooltipPos.x,
            background: "#111",
            color: "#fff",
            padding: "10px",
            borderRadius: "6px",
            fontSize: "12px",
            zIndex: 9999,
          }}
        >
          <p>
            <strong>Domestic (UAE):</strong> Select the Emirate where goods
            were delivered or services performed.
          </p>
          <p>
            <strong>Exports:</strong> Select "Outside UAE" (0% VAT).
          </p>
        </div>
      )}

      {/* Preview */}
      {preview && (
        <div className="invoice-preview-overlay">
          <div className="invoice-preview-dialog">
            <button onClick={() => setPreview(null)}>
              <X size={18} />
            </button>
            {preview.type === "pdf" ? (
              <PdfViewer fileUrl={preview.url} />
            ) : (
              <ImageViewer src={preview.url} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}