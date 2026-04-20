// src/pages/CtBankAndInvoicePreview/CtBankAndInvoicePreview.jsx
import { useEffect, useMemo, useState } from "react";
import { useParams, useLocation } from "react-router-dom";
import {
  getCtFilingPreview,
  generateCtFilingExcel,
} from "../../helper/helper";
import "./CtBankAndInvoicePreview.css";

export default function CtBankAndInvoicePreview() {
  const { companyId } = useParams();
  const location = useLocation();

  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState(location.state || null);
  const [error, setError] = useState(null);

  // views: "bank" | "sales" | "purchase"
  const [view, setView] = useState("bank");

  useEffect(() => {
    if (!location.state && !previewData) {
      fetchPreviewData();
    } else if (location.state && !previewData) {
      setPreviewData(location.state);
    }
  }, [location.state, previewData]);

  async function fetchPreviewData() {
    try {
      setLoading(true);
      const res = await getCtFilingPreview(companyId);
      setPreviewData(res);
    } catch (e) {
      console.error("Failed to fetch CT filing preview data:", e);
      setError("Failed to load CT filing preview data");
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload() {
    try {
      const blob = await generateCtFilingExcel(companyId, {
        bankData: previewData?.bankData,
        invoiceData: previewData?.invoiceData,
        companyName: previewData?.companyName || `Company ${companyId}`,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        previewData?.downloadFileName || "CT_Filing_Bank_Invoice.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download CT Excel file:", err);
      alert("Failed to download CT Excel file");
    }
  }

  if (loading) {
    return (
      <div className="result-page">
        <div className="loading">Loading CT filing preview data...</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="result-page">
        <div className="error">{error}</div>
      </div>
    );
  }

  // ===== Helpers (same as VAT) =====
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

  const HIDE_KEYS = new Set(["row"]);
  const normalizeCols = (cols = []) =>
    cols.map((c, i) => {
      if (typeof c === "string") return { key: c, label: c };
      const key = c?.key ?? c?.field ?? c?.accessor ?? `col_${i}`;
      const label = Object.prototype.hasOwnProperty.call(c || {}, "label")
        ? c.label
        : key;
      return { key: String(key), label: String(label ?? "") };
    });
  const filterHidden = (cols) =>
    cols.filter((c) => !HIDE_KEYS.has(String(c.key).toLowerCase()));
  const isNumeric = (text) =>
    /^-?\d[\d,\s]*(\.\d+)?$/.test(String(text ?? "").trim());
  const isRTL = (text) =>
    /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0590-\u05FF\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(
      String(text ?? "")
    );

  const lower = (s) =>
    String(s || "")
      .trim()
      .toLowerCase();
  const isSalesType = (r) => lower(r?.TYPE).startsWith("sale");
  const isPurchType = (r) => lower(r?.TYPE).startsWith("purchas");
  const deepEqual = (a, b) => {
    if (a === b) return true;
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false;
    }
    return true;
  };

  // ===== Column orders (same as VAT) =====
  const UAE_SALES_ORDER = [
    "DATE",
    "INVOICE NUMBER",
    "INVOICE CATEGORY",
    "SUPPLIER/VENDOR",
    "PARTY",
    "SUPPLIER TRN",
    "CUSTOMER TRN",
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

  // ===== Bank table =====
  const bankData = useMemo(() => {
    const b = previewData?.bankData || { columns: [], rows: [] };
    const colsAll = normalizeCols(b.columns);
    return {
      columns: filterHidden(colsAll),
      rows: Array.isArray(b.rows) ? b.rows : [],
    };
  }, [previewData]);

  // ===== Strict buckets with de-mirror + type scrubbing =====
  const { salesRows, purchaseRows } = useMemo(() => {
    const inv = previewData?.invoiceData || {};

    const hasSalesKey = Object.prototype.hasOwnProperty.call(
      inv,
      "uaeSalesRows"
    );
    const hasPurchKey = Object.prototype.hasOwnProperty.call(
      inv,
      "uaePurchaseRows"
    );
    const explicit = !!inv.__explicitBuckets || hasSalesKey || hasPurchKey;

    let sales = Array.isArray(inv.uaeSalesRows) ? [...inv.uaeSalesRows] : [];
    let purch = Array.isArray(inv.uaePurchaseRows)
      ? [...inv.uaePurchaseRows]
      : [];

    if (!explicit) {
      const unified = Array.isArray(inv.table?.rows) ? inv.table.rows : [];
      if (unified.length) {
        sales = unified.filter(isSalesType);
        purch = unified.filter(isPurchType);
      }
    }

    // If both buckets are identical, hide sales side like VAT preview
    if (sales === purch || deepEqual(sales, purch)) {
      sales = [];
    }

    const hasTypeInSales = sales.some((r) => r && r.TYPE != null);
    const hasTypeInPurch = purch.some((r) => r && r.TYPE != null);
    if (hasTypeInSales) sales = sales.filter((r) => !isPurchType(r));
    if (hasTypeInPurch) purch = purch.filter((r) => !isSalesType(r));

    return { salesRows: sales, purchaseRows: purch };
  }, [previewData]);

  // ===== Build display data from final rows =====
  const salesData = useMemo(() => {
    const rows = (salesRows || []).map((r) => {
      const out = {};
      UAE_SALES_ORDER.forEach((k) => (out[k] = r?.[k] ?? null));
      return out;
    });
    return {
      columns: UAE_SALES_ORDER.map((k) => ({ key: k, label: k })),
      rows,
    };
  }, [salesRows]);

  const purchaseData = useMemo(() => {
    const rows = (purchaseRows || []).map((r) => {
      const out = {};
      UAE_PURCHASE_ORDER.forEach((k) => (out[k] = r?.[k] ?? null));
      return out;
    });
    return {
      columns: UAE_PURCHASE_ORDER.map((k) => ({ key: k, label: k })),
      rows,
    };
  }, [purchaseRows]);

  // Auto-switch when selected tab is empty
  useEffect(() => {
    const hasSales = (salesData.rows || []).length > 0;
    const hasPurch = (purchaseData.rows || []).length > 0;
    if (view === "sales" && !hasSales && hasPurch) setView("purchase");
    if (view === "purchase" && !hasPurch && hasSales) setView("sales");
  }, [view, salesData.rows, purchaseData.rows]);

  const current =
    view === "bank" ? bankData : view === "sales" ? salesData : purchaseData;

  // ===== Table renderer =====
  const renderTable = (cols, rows, emptyText = "No rows to display") => {
    if (!cols.length) {
      return (
        <div className="muted" style={{ padding: 12 }}>
          {emptyText}
        </div>
      );
    }
    return (
      <div className="tbl-scroller">
        <table className="tbl nice">
          <thead>
            <tr>
              {cols.map((c, idx) => (
                <th
                  key={c.key}
                  className={idx === 0 ? "sticky-col" : ""}
                  title={c.label}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!rows || rows.length === 0 ? (
              <tr>
                <td
                  colSpan={cols.length}
                  className="muted"
                  style={{ textAlign: "center", padding: 18 }}
                >
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i}>
                  {cols.map((c, idx) => {
                    const val = r?.[c.key] ?? "";
                    const isDateCol = String(c.key).toUpperCase().includes("DATE");
                    const isLineItemsCol = String(c.key).toUpperCase() === "LINE_ITEMS";
                    const text = isDateCol ? formatDateDisplay(val) : (isLineItemsCol ? formatLineItems(val) : String(val ?? ""));
                    const cls = [
                      idx === 0 ? "sticky-col" : "",
                      isNumeric(text) ? "num" : "",
                      isRTL(text) ? "rtl" : "",
                    ]
                      .join(" ")
                      .trim();
                    const title =
                      c.key === "CONFIDENCE" && typeof val === "number"
                        ? `${val}%`
                        : text;
                    return (
                      <td key={c.key} className={cls} title={title} style={isLineItemsCol ? { whiteSpace: 'pre-wrap', minWidth: '400px' } : {}}>
                        {c.key === "CONFIDENCE" && typeof val === "number"
                          ? `${val}%`
                          : text}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="result-page">
      {/* Header */}
      <header className="result-head">
        <div className="title-wrap">
          <h2 className="result-title">Corporate Tax Filing Preview</h2>
          <p className="title-sub">
            Bank + Invoice data — neat, readable, and export-ready.
          </p>
        </div>

        <div className="head-actions">
          <div className="seg seg-black">
            <button
              className={`seg-btn ${view === "bank" ? "active" : ""}`}
              onClick={() => setView("bank")}
              title="Show Bank Statement rows"
            >
              Bank Statement
            </button>
            <button
              className={`seg-btn ${view === "sales" ? "active" : ""}`}
              onClick={() => setView("sales")}
              title="Show Sales rows"
            >
              Sales
            </button>
            <button
              className={`seg-btn ${view === "purchase" ? "active" : ""}`}
              onClick={() => setView("purchase")}
              title="Show Purchase rows"
            >
              Purchase
            </button>
          </div>

          <button className="btn btn-black" onClick={handleDownload}>
            Download Excel
          </button>
        </div>
      </header>

      {/* Table Card */}
      <div className="result-card">
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px' }}>
          <span className="record-count" style={{ fontSize: '13px', color: '#6b7280', fontWeight: '500' }}>
            Total Records: {current.rows.length}
          </span>
        </div>
        {renderTable(current.columns, current.rows, "No data to display")}
      </div>
    </div>
  );
}
