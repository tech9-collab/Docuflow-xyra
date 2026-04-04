// src/pages/CtBankOnlyPreview/CtBankOnlyPreview.jsx
import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { downloadBankExcelByJob } from "../../helper/helper";
import "./CtBankOnlyPreview.css";

/** ─────────────────────────────────────────────
 *  CATEGORY groups (value = internal, label = human text)
 *  ────────────────────────────────────────────*/
const CATEGORY_GROUPS = [
  {
    group: "Equity",
    options: [
      { value: "Equity > Capital", label: "Capital" },
      { value: "Equity > Retained Earnings", label: "Retained Earnings" },
      { value: "Equity > Drawings", label: "Drawings" },
    ],
  },
  {
    group: "Liability",
    options: [
      {
        value: "Liability > Long Term > Loans & Mortgages",
        label: "Long Term - Loans & Mortgages",
      },
      {
        value: "Liability > Short Term > Trade Payables",
        label: "Short Term - Trade Payables",
      },
      {
        value: "Liability > Short Term > Other Payables",
        label: "Short Term - Other Payables",
      },
      {
        value: "Liability > Short Term > Provisions",
        label: "Short Term - Provisions",
      },
      {
        value: "Liability > Short Term > Other Current Liability",
        label: "Short Term - Other Current Liability",
      },
    ],
  },
  {
    group: "Assets",
    options: [
      {
        value: "Assets > Non Current > Fixed Assets",
        label: "Non Current - Fixed Assets",
      },
      {
        value: "Assets > Non Current > Intangible Assets",
        label: "Non Current - Intangible Assets",
      },
      {
        value: "Assets > Current > Cash/Bank/Other Cash Equivalents",
        label: "Current - Cash/Bank/Other Cash Equivalents",
      },
      {
        value: "Assets > Current > Inventory",
        label: "Current - Inventory",
      },
      {
        value: "Assets > Current > Trade Receivables",
        label: "Current - Trade Receivables",
      },
      {
        value: "Assets > Current > Other Receivables",
        label: "Current - Other Receivables",
      },
    ],
  },
  {
    group: "Profit & Loss",
    options: [
      {
        value: "P&L > Income > Sales Revenue",
        label: "Income - Sales Revenue",
      },
      {
        value: "P&L > Income > Other Income",
        label: "Income - Other Income",
      },
      { value: "P&L > Expense > Expense", label: "Expense - Expense" },
      {
        value: "P&L > Expense > Cost of Goods Sold",
        label: "Expense - Cost of Goods Sold",
      },
      {
        value: "P&L > Expense > Salaries and Wages",
        label: "Expense - Salaries & Wages",
      },
      { value: "P&L > Expense > Rent", label: "Expense - Rent" },
      { value: "P&L > Expense > Utilities", label: "Expense - Utilities" },
      { value: "P&L > Expense > Marketing", label: "Expense - Marketing" },
      {
        value: "P&L > Expense > Depreciation",
        label: "Expense - Depreciation",
      },
    ],
  },  
  {
    group: "Uncategorized",
    options: [{ value: "Uncategorized", label: "Uncategorized" }],
  },
];

// flat list + map for display (if needed later)
const CATEGORY_FLAT = CATEGORY_GROUPS.flatMap((g) => g.options);
const CATEGORY_DISPLAY_MAP = CATEGORY_FLAT.reduce((acc, opt) => {
  acc[opt.value] = opt.label;
  return acc;
}, {});

// helper: recognise CATEGORY column by key safely
const isCategoryKey = (key) =>
  String(key || "")
    .trim()
    .toUpperCase() === "CATEGORY";

export default function CtBankOnlyPreview() {
  const { companyId } = useParams();
  const { state } = useLocation() || {};

  // if user refreshes the page → no state
  if (!state) {
    return (
      <section className="result-page">
        <div className="muted">No results to display.</div>
      </section>
    );
  }

  const [tableState, setTableState] = useState(state);

  const title =
    tableState?.title || `CT Filing – Type 1 (Bank Statement Preview)`;
  const subtitle = tableState?.subtitle || "";
  const companyName = tableState?.companyName || "";
  const jobId = tableState?.jobId;
  const downloadFileName =
    tableState?.downloadFileName || "ct_bank_statements.xlsx";

  const table = tableState?.tableTable || // the real table
    (tableState?.table ? tableState.table : null) || {
      columns: tableState?.columns || [],
      rows: tableState?.rows || [],
    };

  useEffect(() => {
    document.title = "Xyra Books - CT Filing - Type 1 Preview";
  }, []);

  // ===== Helpers =====
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

  // ===== Bank table (only one view here) =====
  const bankData = useMemo(() => {
    const b = table || { columns: [], rows: [] };
    const colsAll = normalizeCols(b.columns || []);

    // filter + move CATEGORY to the last column if it exists
    let cols = filterHidden(colsAll);
    const catIdx = cols.findIndex((c) => isCategoryKey(c.key));
    if (catIdx !== -1) {
      const [catCol] = cols.splice(catIdx, 1);
      cols.push(catCol);
    }

    return {
      columns: cols,
      rows: Array.isArray(b.rows) ? b.rows : [],
    };
  }, [table]);

  const handleCategoryChange = (rowIndex, newCategory) => {
    setTableState((prev) => {
      if (!prev) return prev;
      const oldTable = prev.table || {};
      const rowsPrev = Array.isArray(oldTable.rows) ? [...oldTable.rows] : [];

      const row = { ...(rowsPrev[rowIndex] || {}) };
      row["CATEGORY"] = newCategory || null;
      rowsPrev[rowIndex] = row;

      return {
        ...prev,
        table: {
          ...oldTable,
          rows: rowsPrev,
        },
      };
    });
  };

  async function handleDownload() {
    if (!jobId) {
      alert("Missing job ID. Please re-run the extraction.");
      return;
    }
    try {
      const blob = await downloadBankExcelByJob(jobId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = downloadFileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download Excel file:", err);
      alert("Failed to download Excel file");
    }
  }

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
                    const rawVal = r?.[c.key] ?? "";
                    const text = String(rawVal ?? "");
                    const cls = [
                      idx === 0 ? "sticky-col" : "",
                      isNumeric(text) ? "num" : "",
                      isRTL(text) ? "rtl" : "",
                    ]
                      .join(" ")
                      .trim();
                    const title = text;
                    const categoryColumn = isCategoryKey(c.key);

                    return (
                      <td key={c.key} className={cls} title={title}>
                        {categoryColumn ? (
                          <select
                            className="category-select"
                            value={rawVal || ""}
                            onChange={(e) =>
                              handleCategoryChange(i, e.target.value)
                            }
                          >
                            <option value="">Select category</option>
                            {CATEGORY_GROUPS.map((group) => (
                              <optgroup key={group.group} label={group.group}>
                                {group.options.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        ) : (
                          text
                        )}
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
    <section className="result-page">
      {/* Header */}
      <header className="result-head">
        <div className="title-wrap">
          <h2 className="result-title">
            {title}
            {companyName ? ` – ${companyName}` : ""}
          </h2>
          <p className="title-sub">
            Type 1 – Bank Statement only. {subtitle ? `File: ${subtitle}` : ""}
          </p>
        </div>

        <div className="head-actions">
          <button className="btn btn-black" onClick={handleDownload}>
            Download Excel
          </button>
        </div>
      </header>

      {/* Table Card */}
      <div className="result-card">
        {renderTable(
          bankData.columns,
          bankData.rows,
          "No bank rows to display"
        )}
      </div>
    </section>
  );
}
