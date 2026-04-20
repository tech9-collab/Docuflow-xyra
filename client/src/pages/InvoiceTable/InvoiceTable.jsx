import { useLocation } from "react-router-dom";
import { useMemo, useState, useRef, useEffect } from "react";
import axios from "axios";
import "./InvoiceTable.css";
import PdfViewer from "../../components/PdfViewer/PdfViewer";
import ImageViewer from "../../components/ImageViewer/ImageViewer";
import { X, Info } from "lucide-react";

/* --- DATE FORMATTING UTILS --- */
const parseFlexibleDate = (s) => {
  if (!s) return null;
  const str = String(s).trim();
  if (!str) return null;

  const makeDate = (year, month, day) => {
    const d = new Date(year, month - 1, day);
    if (
      d.getFullYear() !== year ||
      d.getMonth() !== month - 1 ||
      d.getDate() !== day
    ) {
      return null;
    }
    return d;
  };

  // 1. ISO-like YYYY-MM-DD / YYYY/MM/DD
  const isoMatch = str.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    return makeDate(year, month, day);
  }

  // 2. Numeric dates
  const numericMatch = str.match(/^(\d{1,2})([\/\-.])(\d{1,2})\2(\d{4})$/);
  if (numericMatch) {
    const first = parseInt(numericMatch[1], 10);
    const sep = numericMatch[2];
    const second = parseInt(numericMatch[3], 10);
    const year = parseInt(numericMatch[4], 10);
    if (sep === "/") {
      if (first > 12) return makeDate(year, second, first);
      return makeDate(year, first, second);
    }
    if (second > 12) return makeDate(year, first, second);
    return makeDate(year, second, first);
  }

  // 3. Alpha months
  const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const alphaMatch = str.match(/^(\d{1,2})[\/\- ]?([a-z]{3})[\/\- ]?(\d{4})$/i);
  if (alphaMatch) {
    const day = parseInt(alphaMatch[1], 10);
    const monthStr = alphaMatch[2].toLowerCase();
    const monthIndex = monthNames.indexOf(monthStr);
    const year = parseInt(alphaMatch[3], 10);
    if (monthIndex !== -1) return makeDate(year, monthIndex + 1, day);
  }

  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
};

const formatLineItems = (items) => {
  if (!items) return "";
  const arr = Array.isArray(items) ? items : [];
  if (arr.length === 0) return "";
  return arr.map((li, idx) => {
    const desc = li.description || `Item ${idx + 1}`;
    const qty = li.quantity != null ? ` | Qty: ${li.quantity}` : "";
    const rate = li.unit_price != null ? ` | Rate: ${li.unit_price}` : "";
    const amount = li.net_amount != null ? ` | Amount: ${li.net_amount}` : "";
    return `Item ${idx + 1}: ${desc}${qty}${rate}${amount}`;
  }).join("\n");
};

const formatDateDisplay = (val) => {
  if (val === null || val === undefined || val === "") return "";
  const str = String(val).trim();
  const strippedDate = str.replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s*[AP]M)?$/i, "");
  const d = parseFlexibleDate(strippedDate);
  if (!d || isNaN(d.getTime())) return strippedDate;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

const RAW_API_BASE =
  import.meta.env.VITE_API_BASE || "http://localhost:3001/api";

const API_BASE = RAW_API_BASE.replace(/\/$/, "");
const BACKEND_ORIGIN = API_BASE.replace(/\/api$/i, "");

const UAE_SALES_ORDER = [
  "DATE",
  "INVOICE NUMBER",
  "INVOICE CATEGORY",
  "SUPPLIER/VENDOR",
  "PARTY",
  "CUSTOMER TRN",
  "PLACE OF SUPPLY",
  "CURRENCY",
  "BEFORE TAX AMOUNT",
  "VAT",
  "NET AMOUNT",
  "BEFORE TAX (AED)",
  "VAT (AED)",
  "ZERO RATED (AED)",
  "NET AMOUNT (AED)",
  "CONFIDENCE",
  "SOURCE",
];

const UAE_PURCHASE_ORDER = [
  "DATE",
  "INVOICE NUMBER",
  "INVOICE CATEGORY",
  "SUPPLIER/VENDOR",
  "PARTY",
  "SUPPLIER TRN",
  "PLACE OF SUPPLY",
  "CURRENCY",
  "BEFORE TAX AMOUNT",
  "VAT",
  "NET AMOUNT",
  "BEFORE TAX (AED)",
  "VAT (AED)",
  "ZERO RATED (AED)",
  "NET AMOUNT (AED)",
  "CONFIDENCE",
  "SOURCE",
];

const UAE_OTHERS_ORDER = [
  "DATE",
  "INVOICE NUMBER",
  "INVOICE CATEGORY",
  "SUPPLIER/VENDOR",
  "PARTY",
  "SUPPLIER TRN",
  "CUSTOMER TRN",
  "PLACE OF SUPPLY",
  "CURRENCY",
  "BEFORE TAX AMOUNT",
  "VAT",
  "NET AMOUNT",
  "BEFORE TAX (AED)",
  "VAT (AED)",
  "ZERO RATED (AED)",
  "NET AMOUNT (AED)",
  "CONFIDENCE",
  "SOURCE",
];

export default function InvoiceTable() {
  const { state } = useLocation() || {};
  const {
    jobId,
    title = "Invoice Results",
    downloadLabel = "Download Excel",
    downloadFileName = "results.xlsx",
    apiDownloadUrl,
    authToken,
    table = { columns: [], rows: [] },
    uaeSalesRows = [],
    uaePurchaseRows = [],
    othersRows = [],
  } = state || {};

  const [view, setView] = useState("purchase");

  const [preview, setPreview] = useState(null);

  const purchaseData = useMemo(() => {
    const fallbackRows = Array.isArray(uaePurchaseRows) ? uaePurchaseRows : [];
    const rows = (table.rows || []).length
      ? (table.rows || []).filter(
        (r) => String(r.TYPE || "").toLowerCase() === "purchase"
      )
      : fallbackRows;
    return {
      columns: UAE_PURCHASE_ORDER.map((k) => ({ key: k, label: k })),
      rows: rows.map((r) => {
        const o = {};
        UAE_PURCHASE_ORDER.forEach((k) => (o[k] = r[k] ?? null));

        o.SOURCE_URL = r.SOURCE_URL ?? r.source_url ?? null;
        o.SOURCE_TYPE = r.SOURCE_TYPE ?? r.source_type ?? null;

        return o;
      }),
    };
  }, [hasExplicitBuckets, table.rows, uaePurchaseRows]);

  const salesData = useMemo(() => {
    const fallbackRows = Array.isArray(uaeSalesRows) ? uaeSalesRows : [];
    const rows = hasExplicitBuckets
      ? fallbackRows
      : (table.rows || []).length
        ? (table.rows || []).filter(
          (r) => String(r.TYPE || "").toLowerCase() === "sales"
        )
        : fallbackRows;
    return {
      columns: UAE_SALES_ORDER.map((k) => ({ key: k, label: k })),
      rows: rows.map((r) => {
        const o = {};
        UAE_SALES_ORDER.forEach((k) => (o[k] = r[k] ?? null));

        o.SOURCE_URL = r.SOURCE_URL ?? r.source_url ?? null;
        o.SOURCE_TYPE = r.SOURCE_TYPE ?? r.source_type ?? null;

        return o;
      }),
    };
  }, [hasExplicitBuckets, table.rows, uaeSalesRows]);

  const othersData = useMemo(() => {
    const fallbackRows = Array.isArray(othersRows) ? othersRows : [];
    const rows = hasExplicitBuckets
      ? fallbackRows
      : (table.rows || []).length
        ? (table.rows || []).filter((r) => {
          const t = String(r.TYPE || "").toLowerCase();
          return t === "other" || t === "others";
        })
        : fallbackRows;
    return {
      columns: UAE_OTHERS_ORDER.map((k) => ({ key: k, label: k })),
      rows: rows.map((r) => {
        const o = {};
        UAE_OTHERS_ORDER.forEach((k) => (o[k] = r[k] ?? null));

        o.SOURCE_URL = r.SOURCE_URL ?? r.source_url ?? null;
        o.SOURCE_TYPE = r.SOURCE_TYPE ?? r.source_type ?? null;

        return o;
      }),
    };
  }, [hasExplicitBuckets, table.rows, othersRows]);

  const { columns, rows } =
    view === "sales"
      ? salesData
      : view === "others"
        ? othersData
        : purchaseData;

  const numericKeys = new Set([
    "BEFORE TAX AMOUNT",
    "VAT",
    "NET AMOUNT",
    "AMOUNT",
    "TOTAL",
    "BEFORE TAX (AED)",
    "VAT (AED)",
    "ZERO RATED (AED)",
    "NET AMOUNT (AED)",
    "CONFIDENCE",
  ]);

  async function handleDownload() {
    if (!apiDownloadUrl) return;
    try {
      const res = await axios.get(apiDownloadUrl, {
        responseType: "blob",
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        timeout: 60000,
      });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = downloadFileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Download failed", e);
      alert("Download failed");
    }
  }

  async function handleZohoDownload() {
    if (!jobId) return;
    const zohoUrl = `${API_BASE}/invoice/jobs/zoho-template/${jobId}?kind=${view}`;
    const fileName =
      view === "sales"
        ? "Zoho_Sales_Template.xlsx"
        : view === "purchase"
          ? "Zoho_Purchase_Template.xlsx"
          : "Zoho_Others_Template.xlsx";

    try {
      const res = await axios.get(zohoUrl, {
        responseType: "blob",
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        timeout: 60000,
      });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Zoho template download failed", e);
      alert("Zoho template download failed");
    }
  }

  return (
    <div className="result-page">
      {/* Header */}
      <header className="result-head">
        <div className="title-wrap">
          <h2 className="result-title">{title}</h2>
          <p className="title-sub">Neat, readable, and export-ready.</p>
        </div>

        <div className="head-actions">
          <div className="seg seg-black">
            <button
              className={`seg-btn ${view === "purchase" ? "active" : ""}`}
              onClick={() => setView("purchase")}
              title="Show Purchase rows"
            >
              Purchase
            </button>
            <button
              className={`seg-btn ${view === "sales" ? "active" : ""}`}
              onClick={() => setView("sales")}
              title="Show Sales rows"
            >
              Sales
            </button>
            <button
              className={`seg-btn ${view === "others" ? "active" : ""}`}
              onClick={() => setView("others")}
              title="Show Others rows"
            >
              Others
            </button>
          </div>

          <button className="btn btn-black" onClick={handleDownload}>
            {downloadLabel}
          </button>
          <button className="btn btn-black" onClick={handleZohoDownload}>
            Download Zoho Template
          </button>
        </div>
      </header>

      {/* Table Card */}
      <div className="result-card">
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px' }}>
          <span className="record-count" style={{ fontSize: '13px', color: '#6b7280', fontWeight: '500' }}>
            Total Records: {rows.length}
          </span>
        </div>
        <div className="tbl-scroller">
          <table className="tbl nice">
            <thead>
              <tr>
                {columns.map((c, idx) => (
                  <th
                    key={c.key}
                    className={idx === 0 ? "sticky-col" : undefined}
                    title={c.key === "PLACE OF SUPPLY" && view === "sales" ? undefined : c.label}
                  >
                    {c.key === "PLACE OF SUPPLY" && view === "sales" ? (
                      <span className="th-with-info">
                        {c.label}
                        <button
                          ref={posIconRef}
                          type="button"
                          className="pos-info-btn"
                          aria-label="Place of supply information"
                          onMouseEnter={showPosTooltip}
                          onMouseLeave={() => {
                            if (!posClickLockedRef.current) setPosTooltipOpen(false);
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            posClickLockedRef.current = !posClickLockedRef.current;
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
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={columns.length || 1}
                    className="muted"
                    style={{ textAlign: "center", padding: 18 }}
                  >
                    No rows to display
                  </td>
                </tr>
              )}

              {rows.map((r, i) => (
                <tr key={i}>
                  {columns.map((c, idx) => {
                    const val = r[c.key];
                    const isNum = numericKeys.has(c.key);

                    // 🔹 Special handling for SOURCE column
                    if (c.key === "SOURCE") {
                      const label = val ?? "";
                      const rawUrl = r.SOURCE_URL || r.source_url || null;
                      const srcUrl =
                        rawUrl && !rawUrl.startsWith("http")
                          ? `${BACKEND_ORIGIN}${rawUrl}`
                          : rawUrl;

                      const srcType =
                        r.SOURCE_TYPE ||
                        r.source_type ||
                        (rawUrl && rawUrl.toLowerCase().endsWith(".pdf")
                          ? "pdf"
                          : "image");

                      return (
                        <td
                          key={c.key}
                          className=""
                          title={label}
                        >
                          {srcUrl ? (
                            <button
                              type="button"
                              className="src-link"
                              onClick={() =>
                                setPreview({
                                  url: srcUrl,
                                  type: srcType,
                                  label,
                                })
                              }
                            >
                              {label}
                            </button>
                          ) : (
                            label
                          )}
                        </td>
                      );
                    }

                    const isDateCol = String(c.key).toUpperCase().includes("DATE");
                    const isLineItemsCol = String(c.key).toUpperCase() === "LINE_ITEMS";
                    const text = isDateCol ? formatDateDisplay(val) : (isLineItemsCol ? formatLineItems(val) : String(val ?? ""));

                    const cls = [
                      idx === 0 ? "sticky-col" : "",
                      numericKeys.has(c.key) ? "num" : "",
                    ]
                      .join(" ")
                      .trim();

                    const title =
                      c.key === "CONFIDENCE" && typeof val === "number"
                        ? `${val}%`
                        : text;

                    return (
                      <td
                        key={c.key}
                        className={[
                          idx === 0 ? "sticky-col" : "",
                          isNum ? "num" : "",
                        ]
                          .join(" ")
                          .trim()}
                        // title={val ?? ""}
                        title={
                          c.key === "CONFIDENCE" && typeof val === "number"
                            ? `${val}%`
                            : val ?? ""
                        }
                      >
                        {c.key === "CONFIDENCE" && typeof val === "number"
                          ? `${val}%`
                          : text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {posTooltipOpen && (
        <div
          className="pos-tooltip-popup"
          style={{ top: posTooltipPos.y, left: posTooltipPos.x }}
        >
          <p>
            <strong>Domestic (UAE):</strong> Select the Emirate where goods
            were delivered or services performed.
          </p>
          <p>
            <strong>Exports:</strong> Select &lsquo;Outside UAE&rsquo; (0%
            VAT). Ensure you have official exit/commercial evidence.
          </p>
          <p>
            <strong>Exceptions:</strong> For Real Estate or Events, POS is
            always the physical location of the property/activity.
          </p>
        </div>
      )}

      {preview && (
        <div className="invoice-preview-overlay">
          <div className="invoice-preview-dialog">
            <div className="invoice-preview-header">
              <span className="preview-title">
                {preview.label || "Invoice preview"}
              </span>
              <button
                className="preview-close-btn"
                onClick={() => setPreview(null)}
                aria-label="Close preview"
              >
                <X size={18} />
              </button>
            </div>
            <div className="invoice-preview-body">
              {preview.type === "pdf" ? (
                <PdfViewer
                  fileUrl={preview.url}
                  controls={{
                    prev: <span>{"<"}</span>,
                    next: <span>{">"}</span>,
                  }}
                />
              ) : (
                <ImageViewer
                  src={preview.url}
                  alt={preview.label || "Invoice image"}
                  initialScale={1}
                  minScale={0.4}
                  maxScale={5}
                  step={0.2}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
