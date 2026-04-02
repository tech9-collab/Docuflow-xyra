// pages/Bills/BillsTable.jsx
import { useLocation } from "react-router-dom";
import axios from "axios";
import { useMemo } from "react";
import "./BillsResultPage.css"; // reuse same table styles
import { downloadBillsExcel } from "../../helper/helper";

export default function BillsTable() {
  const { state } = useLocation() || {};
  const {
    title = "Bills Results",
    columns = [],
    rows = [],
    downloadLabel = "Download Excel",
    downloadFileName = "Bills.xlsx",
    authToken,
  } = state || {};

  // numeric alignment
  const numericKeys = useMemo(
    () =>
      new Set(["BEFORE TAX AMOUNT", "VAT", "NET AMOUNT", "AMOUNT", "TOTAL"]),
    []
  );

  async function handleDownload() {
    try {
      const blob = await downloadBillsExcel([], rows, downloadFileName);
      const url = URL.createObjectURL(new Blob([blob]));
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

  return (
    <div className="result-page">
      <header className="result-head">
        <div>
          <h2 className="result-title">{title}</h2>
        </div>
        <button className="btn primary" onClick={handleDownload}>
          {downloadLabel}
        </button>
      </header>

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
                    return (
                      <td
                        key={c.key}
                        className={[
                          idx === 0 ? "sticky-col" : "",
                          isNum ? "num" : "",
                        ]
                          .join(" ")
                          .trim()}
                        title={val ?? ""}
                      >
                        {val ?? ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
