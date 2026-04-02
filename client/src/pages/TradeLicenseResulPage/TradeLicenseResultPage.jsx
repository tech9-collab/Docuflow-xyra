import { useLocation } from "react-router-dom";
import "./TradeLicenseResultPage.css"; // you can reuse the same table styles as others

export default function TradeLicenseResultPage() {
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
    const columnsRaw = Array.isArray(state?.columns) ? state.columns : [];
    const rows = Array.isArray(state?.rows) ? state.rows : [];
    const downloadFileName = state?.downloadFileName || "trade_license.xlsx";
    const apiDownloadUrl = state?.apiDownloadUrl;
    const authToken = state?.authToken;

    const columns = columnsRaw.map((c, idx) => {
        if (typeof c === "string") return { key: c, label: c };
        const key = c?.key ?? `col_${idx}`;
        const label = Object.prototype.hasOwnProperty.call(c, "label")
            ? c.label
            : key;
        return { key: String(key), label: String(label ?? "") };
    });

    async function handleDownload() {
        try {
            if (!apiDownloadUrl) throw new Error("No API download URL.");
            const res = await fetch(apiDownloadUrl, {
                headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
            });
            if (!res.ok) throw new Error("Download failed.");
            const blob = await res.blob();
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

    return (
        <section className="result-page">
            <header className="result-head">
                <div>
                    <h2 className="result-title">{subtitle || title}</h2>
                    {subtitle ? <div className="muted">{title}</div> : null}
                </div>
                <button className="btn primary btn-sm" onClick={handleDownload}>
                    Download Excel
                </button>
            </header>

            <div className="result-card">
                {!columns.length ? (
                    <div className="muted">No results.</div>
                ) : (
                    <div className="tbl-scroller">
                        <table className="tbl nice">
                            <thead>
                                <tr>
                                    {columns.map((c, i) => (
                                        <th
                                            key={c.key}
                                            className={i === 0 ? "sticky-col" : ""}
                                            title={c.label}
                                        >
                                            {c.label}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r, idx) => (
                                    <tr key={idx}>
                                        {columns.map((c, i) => {
                                            const text = String(r?.[c.key] ?? "");
                                            const isNum = /^-?\d[\d,\s]*(\.\d+)?$/.test(text.trim());
                                            const rtl =
                                                /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0590-\u05FF\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(
                                                    text
                                                );
                                            const cls = `${isNum ? "num" : ""} ${rtl ? "rtl" : ""} ${i === 0 ? "sticky-col" : ""
                                                }`;
                                            return (
                                                <td key={c.key} className={cls} title={text}>
                                                    {text}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </section>
    );
}