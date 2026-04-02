import { useLocation } from "react-router-dom";
import { useMemo, useState } from "react";
import axios from "axios";
import "./InvoiceTable.css";

import PdfViewer from "../../components/PdfViewer/PdfViewer";
import ImageViewer from "../../components/ImageViewer/ImageViewer";
import { X } from "lucide-react";

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
  }, [table.rows, uaePurchaseRows]);

  const salesData = useMemo(() => {
    const fallbackRows = Array.isArray(uaeSalesRows) ? uaeSalesRows : [];
    const rows = (table.rows || []).length
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
  }, [table.rows, uaeSalesRows]);

  const othersData = useMemo(() => {
    const fallbackRows = Array.isArray(othersRows) ? othersRows : [];
    const rows = (table.rows || []).length
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
  }, [table.rows, othersRows]);

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
        <div className="tbl-scroller">
          <table className="tbl nice">
            <thead>
              <tr>
                {columns.map((c, idx) => (
                  <th
                    key={c.key}
                    className={idx === 0 ? "sticky-col" : undefined}
                    title={c.label}
                  >
                    {c.label}
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
                          className={[idx === 0 ? "sticky-col" : "", ""]
                            .join(" ")
                            .trim()}
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
                        {/* {val ?? ""} */}
                        {c.key === "CONFIDENCE" && typeof val === "number"
                          ? `${val}%`
                          : val ?? ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
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
