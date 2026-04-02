import { useLocation } from "react-router-dom";
import { downloadBankExcelByJob } from "../../helper/helper";
import "./TableResultPage.css";

export default function TableResultPage() {
    const { state } = useLocation() || {};
    if (!state) {
        return (
            <section className="result-page">
                <div className="muted">No results to display.</div>
            </section>
        );
    }

    const title = state?.title || "Results";
    const subtitle = state?.subtitle || "";
    const jobId = state?.jobId;
    const downloadFileName = state?.downloadFileName || "bank_statements.xlsx";
    // Removed projectId

    // Prefer the normalized union table if present
    const tableTable = state?.tableTable || { columns: [], rows: [] };

    /* -------- helpers -------- */
    const HIDE_KEYS = new Set(["row"]); // hide any generic "row" column

    const normalizeCols = (cols) =>
        (cols || []).map((c, idx) => {
            if (typeof c === "string") return { key: c, label: c };
            const key = c?.key ?? `col_${idx}`;
            const label = Object.prototype.hasOwnProperty.call(c, "label") ? c.label : key;
            return { key: String(key), label: String(label ?? "") };
        });

    const filterHidden = (cols) => cols.filter((c) => !HIDE_KEYS.has(String(c.key).toLowerCase()));

    // Preferred (tableTable) path
    const tabColsAll = normalizeCols(tableTable.columns);
    const tabCols = filterHidden(tabColsAll);
    const tabRows = Array.isArray(tableTable.rows) ? tableTable.rows : [];

    // Backward compat (if some legacy callers still use columns/rows on state)
    const columnsRawAll = Array.isArray(state?.columns) ? normalizeCols(state.columns) : tabColsAll;
    const columnsRaw = filterHidden(columnsRawAll);
    const rowsRaw = Array.isArray(state?.rows) ? state.rows : tabRows;

    // Removed getProjectName function

    // Removed projectName

    async function handleDownload() {
        if (!jobId) return alert("No document to export.");
        try {
            const blob = await downloadBankExcelByJob(jobId, downloadFileName);
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = downloadFileName;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error(e);
            alert("Download failed.");
        }
    }

    const isNumeric = (text) => /^-?\d[\d,\s]*(\.\d+)?$/.test(String(text ?? "").trim());
    const isRTL = (text) =>
        /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0590-\u05FF\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(
            String(text ?? "")
        );

    const renderTable = (cols, rows, emptyText = "No data.") => {
        if (!cols.length) return <div className="muted" style={{ padding: 12 }}>{emptyText}</div>;
        return (
            <div className="tbl-scroller">
                <table className="tbl nice">
                    <thead>
                        <tr>
                            {cols.map((c, i) => (
                                <th key={c.key} className={i === 0 ? "sticky-col" : ""} title={c.label}>
                                    {c.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 ? (
                            <tr>
                                <td colSpan={cols.length} className="muted" style={{ padding: 12 }}>
                                    {emptyText}
                                </td>
                            </tr>
                        ) : (
                            rows.map((r, idx) => (
                                <tr key={idx}>
                                    {cols.map((c, i) => {
                                        const val = r?.[c.key] ?? "";
                                        const text = String(val);
                                        const cls = `${isNumeric(text) ? "num" : ""} ${isRTL(text) ? "rtl" : ""} ${i === 0 ? "sticky-col" : ""}`;
                                        return (
                                            <td key={c.key} className={cls} title={text}>
                                                {text}
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

    // Choose the best available columns/rows (prefer union)
    const effectiveCols = tabCols.length ? tabCols : columnsRaw;
    const effectiveRows = tabRows.length ? tabRows : rowsRaw;

    return (
        <section className="result-page">
            <header className="result-head">
                <div>
                    <h2 className="result-title">{subtitle || title}</h2>
                    {subtitle ? <div className="muted">{title}</div> : null}
                    {/* Removed project info section */}
                </div>

                {/* Black/white button as requested */}
                <button className="btn btn-black btn-sm" onClick={handleDownload}>
                    {state?.downloadLabel ||
                        (String(title).toLowerCase().includes("bank")
                            ? "Download Bank Statement"
                            : "Download Excel")}
                </button>
            </header>

            {/* Table Data (Transactions only) */}
            <div className="result-card">
                {renderTable(effectiveCols, effectiveRows, "No tables detected.")}
            </div>
        </section>
    );
}