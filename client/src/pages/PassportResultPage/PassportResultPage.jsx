// pages/PassportResultPage/PassportResultPage.jsx
import { useLocation } from "react-router-dom";
import { useMemo } from "react";
import "./PassportResultPage.css"; // you can also reuse EmiratesResultPage.css

export default function PassportResultPage() {
  const { state } = useLocation() || {};
  const {
    title = "Passport Results",
    columns = [],
    rows = [],
    downloadLabel = "Download Excel",
    downloadFileName = "passports.xlsx",
    apiDownloadUrl,  // set by Passport.jsx
    authToken,       // set by Passport.jsx
  } = state || {};

  const numericKeys = useMemo(() => new Set([]), []);

  async function handleDownload() {
    try {
      if (!apiDownloadUrl) throw new Error("Download URL missing.");
      const res = await fetch(apiDownloadUrl, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      if (!res.ok) throw new Error("Download failed.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
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
        <div><h2 className="result-title">{title}</h2></div>
        <button className="btn primary" onClick={handleDownload}>{downloadLabel}</button>
      </header>

      <div className="result-card">
        <div className="tbl-scroller">
          <table className="tbl nice">
            <thead>
              <tr>
                {columns.map((c, idx) => (
                  <th key={c.key} className={idx === 0 ? "sticky-col" : undefined} title={c.label}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length || 1} className="muted" style={{ textAlign: "center", padding: 18 }}>
                    No rows to display
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={i}>
                  {columns.map((c, idx) => {
                    const val = r[c.key];
                    return (
                      <td
                        key={c.key}
                        className={[idx === 0 ? "sticky-col" : "", numericKeys.has(c.key) ? "num" : ""].join(" ").trim()}
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
