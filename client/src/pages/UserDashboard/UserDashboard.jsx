import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  FileSpreadsheet,
  Building,
  Loader2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ScrollText,
  TrendingUp,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../helper/helper";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  AreaChart,
  Area,
} from "recharts";
import "./UserDashboard.css";

/* ---- Constants ---- */
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Gemini 2.5 Flash — Paid Tier pricing per 1M tokens
const INPUT_COST_PER_M = 0.30;   // $0.30 per 1M input tokens (text/image/video)
const OUTPUT_COST_PER_M = 2.50;  // $2.50 per 1M output tokens (including thinking)

function calcCost(inputTokens, outputTokens) {
    const inp = (Number(inputTokens) || 0) / 1_000_000 * INPUT_COST_PER_M;
    const out = (Number(outputTokens) || 0) / 1_000_000 * OUTPUT_COST_PER_M;
    return inp + out;
}

function fmtCost(cost) {
    return cost < 0.01 && cost > 0 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}

function formatLocalDate(iso) {
  if (!iso || iso === "Unknown") return "Unknown";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

export default function UserDashboard() {
  const { user } = useAuth();
  const [documentCount, setDocumentCount] = useState([]);
  const [userProfile, setUserProfile] = useState(null);
  const [monthlySummary, setMonthlySummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());

  useEffect(() => {
    document.title = "DocuFlow - User Dashboard";
  }, []);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line
  }, []);

  const getInitials = (name = "") =>
    name
      .split(" ")
      .filter(Boolean)
      .map(p => p[0]?.toUpperCase())
      .slice(0, 2)
      .join("") || "U";

  const fetchData = useCallback(async (m, y) => {
    const month = m || selectedMonth;
    const year = y || selectedYear;
    const qp = `?month=${month}&year=${year}`;

    setLoading(true);
    setError("");
    try {
      const [profileRes, docCountRes, monthlyRes] = await Promise.all([
        api.get("/admin/profile"),
        api.get(`/admin/users/${user.id}/document-count${qp}`),
        api.get(`/admin/users/${user.id}/monthly-summary`),
      ]);
      setUserProfile(profileRes.data.user);
      setDocumentCount(docCountRes.data.documentCount || []);
      setMonthlySummary(monthlyRes.data.monthlySummary || []);
    } catch (err) {
      setError(err?.message || "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, selectedYear, user.id]);

  // Month navigation
  const goToPrevMonth = () => {
    let m = selectedMonth - 1;
    let y = selectedYear;
    if (m < 1) { m = 12; y -= 1; }
    setSelectedMonth(m);
    setSelectedYear(y);
    fetchData(m, y);
  };

  const goToNextMonth = () => {
    const nowM = now.getMonth() + 1;
    const nowY = now.getFullYear();
    let m = selectedMonth + 1;
    let y = selectedYear;
    if (m > 12) { m = 1; y += 1; }
    if (y > nowY || (y === nowY && m > nowM)) return;
    setSelectedMonth(m);
    setSelectedYear(y);
    fetchData(m, y);
  };

  const isCurrentMonth = selectedMonth === (now.getMonth() + 1) && selectedYear === now.getFullYear();

  /* ---------- TOP TOTALS ---------- */
  const totalDocuments = useMemo(
    () => documentCount.reduce((sum, r) => sum + (Number(r.files_count) || 0), 0),
    [documentCount]
  );
  const totalPages = useMemo(
    () => documentCount.reduce((sum, r) => sum + (Number(r.page_count) || 0), 0),
    [documentCount]
  );
  const totalInputTokens = useMemo(
    () => documentCount.reduce((sum, r) => sum + (Number(r.input_tokens) || 0), 0),
    [documentCount]
  );
  const totalOutputTokens = useMemo(
    () => documentCount.reduce((sum, r) => sum + (Number(r.output_tokens) || 0), 0),
    [documentCount]
  );
  const totalCost = calcCost(totalInputTokens, totalOutputTokens);

  /* ---------- MODULE-WISE ---------- */
  const moduleAgg = useMemo(() => {
    const map = {};
    documentCount.forEach((r) => {
      const key = (r.module_name || "Unknown").replace(/_/g, " ");
      if (!map[key]) map[key] = { name: key, files: 0, pages: 0, inputTokens: 0, outputTokens: 0 };
      map[key].files += Number(r.files_count) || 0;
      map[key].pages += Number(r.page_count) || 0;
      map[key].inputTokens += Number(r.input_tokens) || 0;
      map[key].outputTokens += Number(r.output_tokens) || 0;
    });
    return Object.values(map).sort((a, b) => b.files - a.files);
  }, [documentCount]);

  const moduleFilesTotal = moduleAgg.reduce((s, x) => s + x.files, 0);
  const modulePagesTotal = moduleAgg.reduce((s, x) => s + x.pages, 0);
  const topModule = moduleAgg[0]?.name || "—";

  /* ---------- DATE-WISE ---------- */
  const dateData = useMemo(() => {
    const m = {};
    for (const r of documentCount) {
      const iso = r.file_uploaded_date
        ? new Date(r.file_uploaded_date).toISOString().slice(0, 10)
        : "Unknown";
      if (!m[iso]) m[iso] = { files: 0, pages: 0 };
      m[iso].files += Number(r.files_count) || 0;
      m[iso].pages += Number(r.page_count) || 0;
    }
    const known = Object.entries(m)
      .filter(([d]) => d !== "Unknown")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, v]) => ({ date, ...v }));
    if (m["Unknown"]) known.push({ date: "Unknown", ...m["Unknown"] });
    return known;
  }, [documentCount]);

  const busiestDay = useMemo(() => {
    if (!dateData.length) return "—";
    const max = [...dateData].sort((a, b) => b.files - a.files)[0];
    return max.date === "Unknown" ? "Unknown" : formatLocalDate(max.date);
  }, [dateData]);

  /* ---------- MONTHLY TREND ---------- */
  const monthlyTrendData = useMemo(() => {
    return monthlySummary.map((item) => {
      const inpT = Number(item.total_input_tokens) || 0;
      const outT = Number(item.total_output_tokens) || 0;
      return {
        label: `${SHORT_MONTHS[Number(item.month) - 1]} ${item.year}`,
        documents: Number(item.total_documents) || 0,
        pages: Number(item.total_pages) || 0,
        cost: Number(calcCost(inpT, outT).toFixed(4)),
      };
    });
  }, [monthlySummary]);

  /* ---------- RENDER ---------- */
  if (loading)
    return (
      <div className="udb page">
        <div className="center-stack" role="status" aria-live="polite">
          <Loader2 className="spin" size={22} />
          <span>Loading dashboard…</span>
        </div>
      </div>
    );

  if (error)
    return (
      <div className="udb page">
        <div className="notice error" role="alert">{error}</div>
      </div>
    );

  return (
    <div className="udb page">
      {/* HEADER */}
      <header className="header" aria-label="User header">
        <div>
          <h1 className="title">User Dashboard</h1>
          <p className="subtitle">Your document processing overview</p>
        </div>

        <div className="header-right">
          {/* Month Picker */}
          <div className="month-picker">
            <button type="button" className="month-nav" onClick={goToPrevMonth} title="Previous month">
              <ChevronLeft size={18} />
            </button>
            <div className="month-label">
              <Calendar size={16} />
              <span>{MONTH_NAMES[selectedMonth - 1]} {selectedYear}</span>
            </div>
            <button
              type="button"
              className="month-nav"
              onClick={goToNextMonth}
              disabled={isCurrentMonth}
              title="Next month"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="profile-card" aria-label="Signed-in user">
            <div className="avatar ring" aria-hidden="true">
              {getInitials(userProfile?.name || user.name)}
            </div>
            <div className="profile-text">
              <div className="profile-top">
                <span className="profile-name">{userProfile?.name || user.name}</span>
                {userProfile?.department_name && (
                  <span className="pill">
                    <Building size={14} />
                    <span className="pill-text">{userProfile.department_name.replace(/_/g, " ")}</span>
                  </span>
                )}
              </div>
              <a
                className="profile-email"
                href={`mailto:${userProfile?.email || user.email}`}
                title="Send email"
              >
                {userProfile?.email || user.email}
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* TOP KPIs */}
      <section className="kpis" aria-label="Key metrics">
        <article className="kpi">
          <div className="kpi-icon"><FileSpreadsheet size={20} /></div>
          <div className="kpi-meta">
            <div className="kpi-value">{totalDocuments}</div>
            <div className="kpi-label">Documents Processed</div>
          </div>
        </article>

        <article className="kpi">
          <div className="kpi-icon"><ScrollText size={20} /></div>
          <div className="kpi-meta">
            <div className="kpi-value">{totalPages}</div>
            <div className="kpi-label">Total Pages</div>
          </div>
        </article>

      </section>

      {/* MONTHLY TREND */}
      {monthlyTrendData.length > 1 && (
        <section className="panel">
          <div className="panel-head with-meta">
            <h2>Monthly Trend</h2>
            <div className="panel-meta">
              <span className="badge">Last 12 months</span>
            </div>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={monthlyTrendData} margin={{ top: 6, right: 12, left: 12, bottom: 6 }}>
                <defs>
                  <linearGradient id="userGradPages" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#111" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#111" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e6e6e6" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ borderRadius: 6 }}
                  formatter={(value, name) => {
                    if (name === "cost") return [`$${value}`, "Est. Cost"];
                    return [value, name.charAt(0).toUpperCase() + name.slice(1)];
                  }}
                />
                <Legend />
                <Area type="monotone" dataKey="pages" name="Pages" stroke="#111" fill="url(#userGradPages)" strokeWidth={2} />
                <Area type="monotone" dataKey="documents" name="Documents" stroke="#6b7280" fill="transparent" strokeWidth={2} strokeDasharray="5 5" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* MODULE-WISE */}
      {moduleAgg.length > 0 && (
        <section className="panel">
          <div className="panel-head with-meta">
            <h2>Module-wise Processing</h2>
            <div className="panel-meta">
              <span className="badge">{MONTH_NAMES[selectedMonth - 1]} {selectedYear}</span>
              <span className="badge">Modules: {moduleAgg.length}</span>
            </div>
          </div>

          <div className="mini-kpis">
            <article className="mini-kpi">
              <div className="mini-icon"><FileSpreadsheet size={18} /></div>
              <div className="mini-meta">
                <div className="mini-value">{moduleAgg.length}</div>
                <div className="mini-label">Distinct Modules</div>
              </div>
            </article>
            <article className="mini-kpi">
              <div className="mini-icon"><FileSpreadsheet size={18} /></div>
              <div className="mini-meta">
                <div className="mini-value">{moduleFilesTotal}</div>
                <div className="mini-label">Files (All Modules)</div>
              </div>
            </article>
            <article className="mini-kpi">
              <div className="mini-icon"><TrendingUp size={18} /></div>
              <div className="mini-meta">
                <div className="mini-value">{topModule}</div>
                <div className="mini-label">Top Module</div>
              </div>
            </article>
          </div>

          <div className="chart-wrap chart-narrow">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={moduleAgg}
                barSize={26}
                margin={{ top: 6, right: 8, left: 8, bottom: 28 }}
              >
                <CartesianGrid stroke="#e6e6e6" strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fill: "#0a0a0a", fontSize: 12 }} angle={-20} textAnchor="end" interval={0} />
                <YAxis tick={{ fill: "#0a0a0a", fontSize: 12 }} allowDecimals={false} />
                <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} contentStyle={{ borderRadius: 6, border: "1px solid #ccc" }} />
                <Legend wrapperStyle={{ paddingTop: 6 }} />
                <Bar dataKey="files" name="Files" fill="#0a0a0a" radius={[4, 4, 0, 0]} />
                <Bar dataKey="pages" name="Pages" fill="#6b7280" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="table-wrap compact" role="region" aria-label="Module summary">
            <table className="table">
              <thead>
                <tr>
                  <th>Sl&nbsp;No</th>
                  <th>Module</th>
                  <th className="right">Files</th>
                  <th className="right">Pages</th>
                  <th className="right">Cost</th>
                  <th className="right">Share</th>
                </tr>
              </thead>
              <tbody>
                {moduleAgg.map((m, i) => {
                  const modCost = calcCost(m.inputTokens, m.outputTokens);
                  const pct = totalCost > 0 ? Math.round((modCost / totalCost) * 100) : 0;
                  return (
                    <tr key={m.name}>
                      <td>{i + 1}</td>
                      <td className="nowrap">{m.name}</td>
                      <td className="right">{m.files}</td>
                      <td className="right">{m.pages}</td>
                      <td className="right">{fmtCost(modCost)}</td>
                      <td className="right">{pct}%</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan="2" className="right strong">Totals</td>
                  <td className="right strong">{moduleFilesTotal}</td>
                  <td className="right strong">{modulePagesTotal}</td>
                  <td className="right strong">{fmtCost(totalCost)}</td>
                  <td className="right strong">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {/* DATE-WISE */}
      {dateData.length > 0 && (
        <section className="panel">
          <div className="panel-head with-meta">
            <h2>Date-wise Processing</h2>
            <div className="panel-meta">
              <span className="badge">{MONTH_NAMES[selectedMonth - 1]} {selectedYear}</span>
              <span className="badge">Days: {dateData.length}</span>
            </div>
          </div>

          <div className="mini-kpis">
            <article className="mini-kpi">
              <div className="mini-icon"><Calendar size={18} /></div>
              <div className="mini-meta">
                <div className="mini-value">{busiestDay}</div>
                <div className="mini-label">Busiest Day</div>
              </div>
            </article>
            <article className="mini-kpi">
              <div className="mini-icon"><FileSpreadsheet size={18} /></div>
              <div className="mini-meta">
                <div className="mini-value">{dateData.reduce((s, x) => s + x.files, 0)}</div>
                <div className="mini-label">Files (All Days)</div>
              </div>
            </article>
            <article className="mini-kpi">
              <div className="mini-icon"><Calendar size={18} /></div>
              <div className="mini-meta">
                <div className="mini-value">{dateData.length}</div>
                <div className="mini-label">Active Days</div>
              </div>
            </article>
          </div>

          <div className="chart-wrap chart-narrow">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={dateData} barSize={26} margin={{ top: 6, right: 8, left: 8, bottom: 6 }}>
                <CartesianGrid stroke="#e6e6e6" strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "#0a0a0a", fontSize: 12 }}
                  tickFormatter={(v) => (v === "Unknown" ? v : formatLocalDate(v))}
                />
                <YAxis tick={{ fill: "#0a0a0a", fontSize: 12 }} allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: "rgba(0,0,0,0.04)" }}
                  contentStyle={{ borderRadius: 6, border: "1px solid #ccc" }}
                  labelFormatter={(v) => (v === "Unknown" ? v : formatLocalDate(v))}
                />
                <Legend wrapperStyle={{ paddingTop: 6 }} />
                <Bar dataKey="files" name="Files" fill="#0a0a0a" radius={[4, 4, 0, 0]} />
                <Bar dataKey="pages" name="Pages" fill="#6b7280" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* RAW TABLE */}
      <section className="panel">
        <div className="panel-head with-meta">
          <h2>Processing Details</h2>
          <div className="panel-meta">
            <span className="badge">{MONTH_NAMES[selectedMonth - 1]} {selectedYear}</span>
          </div>
        </div>

        {documentCount.length > 0 ? (
          <div className="table-wrap" role="region" aria-label="Statistics table" tabIndex={0}>
            <table className="table">
              <thead>
                <tr>
                  <th>Sl&nbsp;No</th>
                  <th>Date</th>
                  <th>Module</th>
                  <th>File Name</th>
                  <th className="right">Files</th>
                  <th className="right">Pages</th>
                  <th className="right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {documentCount.map((r, i) => (
                  <tr key={`${r.file_name}-${i}`}>
                    <td>{i + 1}</td>
                    <td>{formatLocalDate(r.file_uploaded_date)}</td>
                    <td className="nowrap">{(r.module_name || "N/A").replace(/_/g, " ")}</td>
                    <td className="truncate" title={r.file_name || ""}>{r.file_name || "N/A"}</td>
                    <td className="right">{Number(r.files_count) || 0}</td>
                    <td className="right">{Number(r.page_count) || 0}</td>
                    <td className="right">{fmtCost(calcCost(r.input_tokens, r.output_tokens))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan="4" className="right strong">Totals</td>
                  <td className="right strong">{totalDocuments}</td>
                  <td className="right strong">{totalPages}</td>
                  <td className="right strong">{fmtCost(totalCost)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="empty">
            <div className="empty-title">No data for this month</div>
            <div className="muted">When you process files, they'll show up here.</div>
          </div>
        )}
      </section>
    </div>
  );
}
