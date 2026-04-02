import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
    Users,
    Shield,
    Briefcase,
    FileSpreadsheet,
    TrendingUp,
    Activity,
    User2,
    ScrollText,
    Calendar,
    ChevronLeft,
    ChevronRight,
    DollarSign,
    ArrowUpRight,
    ArrowDownRight,
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
import "./AdminDashboard.css";

/* ---- Constants ---- */
const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Gemini 2.5 Flash — Paid Tier pricing per 1M tokens
// (Pro fallback: input $1.25/1M, output $10.00/1M — not tracked separately)
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

export default function AdminDashboard() {
    const { user, isSuperAdmin } = useAuth();

    useEffect(() => {
        document.title = "DocuFlow - Super Admin Dashboard";
    }, []);

    // Month picker state — default to current month
    const now = new Date();
    const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
    const [selectedYear, setSelectedYear] = useState(now.getFullYear());

    const [stats, setStats] = useState({
        totalUsers: 0,
        totalDepartments: 0,
        totalRoles: 0,
        totalDocuments: 0,
        totalSize: 0,
        departmentDocumentCounts: [],
        aggregatedUserDocumentCounts: [],
        allDocumentDetails: [],
    });
    const [monthlySummary, setMonthlySummary] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    // utils
    const formatFileSize = (bytes = 0) => {
        if (!bytes) return "0 Bytes";
        const k = 1024, sizes = ["Bytes", "KB", "MB", "GB", "TB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    };

    const monthParam = `?month=${selectedMonth}&year=${selectedYear}`;

    // data load
    useEffect(() => {
        if (!isSuperAdmin()) {
            setError("Access denied: Administrator access required.");
            setLoading(false);
            return;
        }
        fetchDashboardData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const fetchDashboardData = useCallback(async (m, y) => {
        const month = m || selectedMonth;
        const year = y || selectedYear;
        const qp = `?month=${month}&year=${year}`;

        setLoading(true);
        setError("");
        try {
            const [
                usersRes,
                rolesRes,
                deptsRes,
                docCountRes,
                deptDocCountsRes,
                aggregatedUserDocCountsRes,
                allDocDetailsRes,
                monthlySummaryRes,
            ] = await Promise.all([
                api.get("/admin/employees"),
                api.get("/admin/roles"),
                api.get("/admin/departments"),
                api.get(`/admin/system/document-count${qp}`),
                api.get(`/admin/system/department-document-counts${qp}`),
                api.get(`/admin/system/aggregated-user-document-counts${qp}`),
                api.get(`/admin/system/all-users-document-counts${qp}`),
                api.get("/admin/system/monthly-summary"),
            ]);

            const users = usersRes.data.employees || [];
            const roles = rolesRes.data.roles || [];
            const departments = deptsRes.data.departments || [];
            const docCount = docCountRes.data || {};
            const deptDocCounts = deptDocCountsRes.data?.departmentCounts || [];
            const aggregated = aggregatedUserDocCountsRes.data?.aggregatedCounts || [];
            const allDocs = allDocDetailsRes.data?.documentCounts || [];

            setStats({
                totalUsers: users.length,
                totalDepartments: departments.length,
                totalRoles: roles.length,
                totalDocuments: Number(docCount.totalFiles) || 0,
                totalPages: Number(docCount.totalPages) || 0,
                totalSize: Number(docCount.totalSize) || 0,
                totalInputTokens: Number(docCount.totalInputTokens) || 0,
                totalOutputTokens: Number(docCount.totalOutputTokens) || 0,
                departmentDocumentCounts: deptDocCounts,
                aggregatedUserDocumentCounts: aggregated,
                allDocumentDetails: allDocs,
            });
            setMonthlySummary(monthlySummaryRes.data?.monthlySummary || []);
        } catch (err) {
            setError(err.message || "Failed to fetch dashboard data");
        } finally {
            setLoading(false);
        }
    }, [selectedMonth, selectedYear]);

    // Month navigation
    const goToPrevMonth = () => {
        let m = selectedMonth - 1;
        let y = selectedYear;
        if (m < 1) { m = 12; y -= 1; }
        setSelectedMonth(m);
        setSelectedYear(y);
        fetchDashboardData(m, y);
    };

    const goToNextMonth = () => {
        const nowM = now.getMonth() + 1;
        const nowY = now.getFullYear();
        let m = selectedMonth + 1;
        let y = selectedYear;
        if (m > 12) { m = 1; y += 1; }
        // Don't go past current month
        if (y > nowY || (y === nowY && m > nowM)) return;
        setSelectedMonth(m);
        setSelectedYear(y);
        fetchDashboardData(m, y);
    };

    const isCurrentMonth = selectedMonth === (now.getMonth() + 1) && selectedYear === now.getFullYear();

    /** --------- Derived datasets --------- */

    const departmentWiseCards = useMemo(() => {
        return (stats.departmentDocumentCounts || []).map((d) => {
            const inpT = Number(d.total_input_tokens) || 0;
            const outT = Number(d.total_output_tokens) || 0;
            return {
                name: d.department_name,
                docs: Number(d.total_documents) || 0,
                pages: Number(d.total_pages) || 0,
                inputTokens: inpT,
                outputTokens: outT,
                cost: calcCost(inpT, outT),
            };
        });
    }, [stats.departmentDocumentCounts]);

    const deptChartRows = departmentWiseCards.map((d) => ({
        name: d.name,
        documents: d.docs,
        pages: d.pages,
    }));

    const moduleRows = useMemo(() => {
        const map = {};
        (stats.allDocumentDetails || []).forEach((doc) => {
            const moduleName = doc.module_name ? doc.module_name.replace(/_/g, " ") : "Unknown";
            if (!map[moduleName]) map[moduleName] = { name: moduleName, documents: 0, pages: 0, inputTokens: 0, outputTokens: 0 };
            map[moduleName].documents += Number(doc.files_count) || 0;
            map[moduleName].pages += Number(doc.page_count) || 0;
            map[moduleName].inputTokens += Number(doc.input_tokens) || 0;
            map[moduleName].outputTokens += Number(doc.output_tokens) || 0;
        });
        return Object.values(map);
    }, [stats.allDocumentDetails]);

    // Use direct API values as the single source of truth for totals
    const totalCost = calcCost(stats.totalInputTokens, stats.totalOutputTokens);
    const totalTokens = (stats.totalInputTokens || 0) + (stats.totalOutputTokens || 0);

    // Monthly trend chart data
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



    /** --------- Render --------- */

    if (loading) {
        return (
            <div className="admin-dashboard">
                <div className="block center">
                    <Activity className="spin" size={40} />
                    <div className="muted">Loading dashboard…</div>
                </div>
            </div>
        );
    }

    if (!isSuperAdmin()) {
        return (
            <div className="admin-dashboard">
                <div className="block center">
                    <Shield size={44} />
                    <h3>Access Denied</h3>
                    <p className="muted">Administrator access required.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="admin-dashboard">
            <header className="page-header">
                <div>
                    <h1 className="page-title">Admin Dashboard</h1>
                    <p className="page-subtitle">Welcome back, {user?.name || "Admin"}.</p>
                </div>

                <div className="header-actions">
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

                    <button
                        type="button"
                        className="btn-refresh bw"
                        onClick={() => fetchDashboardData()}
                    >
                        <TrendingUp size={16} strokeWidth={2} />
                        <span>Refresh</span>
                    </button>
                </div>
            </header>

            {error ? <div className="alert error">{error}</div> : null}

            {/* KPIs */}
            <section className="kpi-grid">
                <Kpi icon={<Users />} title="Users" value={stats.totalUsers} />
                <Kpi icon={<Briefcase />} title="Departments" value={stats.totalDepartments} />
                <Kpi icon={<Shield />} title="Roles" value={stats.totalRoles} />
                <Kpi
                    icon={<FileSpreadsheet />}
                    title="Documents"
                    value={stats.totalDocuments}
                />
                <Kpi
                    icon={<ScrollText />}
                    title="Total Pages"
                    value={stats.totalPages}
                />
                <Kpi
                    icon={<DollarSign />}
                    title="Gemini Cost"
                    value={fmtCost(totalCost)}
                    hint={`${(totalTokens / 1000).toFixed(1)}K tokens`}
                />
            </section>

            {/* Monthly Trend */}
            {monthlyTrendData.length > 1 && (
                <section className="panel full-width">
                    <div className="panel-head">
                        <div>
                            <h2>Monthly Trend (Last 12 Months)</h2>
                            <p className="muted">Documents, pages, and estimated cost over time</p>
                        </div>
                    </div>
                    <div className="chart-wrap chart-wrap--roomy">
                        <ResponsiveContainer width="100%" height={280}>
                            <AreaChart data={monthlyTrendData} margin={{ top: 8, right: 16, left: 16, bottom: 8 }}>
                                <defs>
                                    <linearGradient id="gradPages" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#111" stopOpacity={0.15} />
                                        <stop offset="95%" stopColor="#111" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="gradDocs" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#6b7280" stopOpacity={0.15} />
                                        <stop offset="95%" stopColor="#6b7280" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid stroke="#ececec" strokeDasharray="3 3" />
                                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                                <Tooltip
                                    contentStyle={{ borderRadius: 8 }}
                                    formatter={(value, name) => {
                                        if (name === "cost") return [`$${value}`, "Est. Cost"];
                                        return [value, name.charAt(0).toUpperCase() + name.slice(1)];
                                    }}
                                />
                                <Legend />
                                <Area type="monotone" dataKey="pages" name="Pages" stroke="#111" fill="url(#gradPages)" strokeWidth={2} />
                                <Area type="monotone" dataKey="documents" name="Documents" stroke="#6b7280" fill="url(#gradDocs)" strokeWidth={2} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </section>
            )}

            {/* Charts Row */}
            <section className="charts">
                {/* Department Bar */}
                <div className="panel">
                    <div className="panel-head">
                        <div>
                            <h2>Documents & Pages by Department</h2>
                            <p className="muted">For {MONTH_NAMES[selectedMonth - 1]} {selectedYear}</p>
                        </div>
                    </div>

                    {deptChartRows.length ? (
                        <div className="chart-wrap chart-wrap--roomy">
                            <ResponsiveContainer width="100%" height={300}>
                                <BarChart
                                    data={deptChartRows}
                                    barSize={18}
                                    barCategoryGap="45%"
                                    margin={{ top: 8, right: 12, left: 12, bottom: 56 }}
                                >
                                    <CartesianGrid stroke="#ececec" strokeDasharray="3 3" />
                                    <XAxis
                                        dataKey="name"
                                        tick={{ fontSize: 12 }}
                                        interval={0}
                                        angle={-15}
                                        textAnchor="end"
                                        height={46}
                                        tickMargin={12}
                                    />
                                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                                    <Tooltip cursor={{ fill: "rgba(0,0,0,.04)" }} contentStyle={{ borderRadius: 8 }} />
                                    <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: 8 }} />
                                    <Bar dataKey="documents" name="Documents" fill="#111111" radius={[6, 6, 0, 0]} />
                                    <Bar dataKey="pages" name="Pages" fill="#6b7280" radius={[6, 6, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="empty">No department data for this month.</div>
                    )}

                    {/* Compact department totals with cost */}
                    {departmentWiseCards.length ? (
                        <div className="compact-grid">
                            {departmentWiseCards.map((d) => (
                                <div key={d.name} className="compact-card">
                                    <div className="compact-title">{d.name}</div>
                                    <div className="compact-stats">
                                        <span className="badge black">{d.docs} docs</span>
                                        <span className="badge gray">{d.pages} pages</span>
                                        <span className="badge cost">{fmtCost(d.cost)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>

                {/* Module Bar */}
                <div className="panel">
                    <div className="panel-head">
                        <div>
                            <h2>Documents & Pages by Module</h2>
                            <p className="muted">For {MONTH_NAMES[selectedMonth - 1]} {selectedYear}</p>
                        </div>
                    </div>

                    {moduleRows.length ? (
                        <div className="chart-wrap chart-wrap--roomy">
                            <ResponsiveContainer width="100%" height={300}>
                                <BarChart
                                    data={moduleRows}
                                    barSize={18}
                                    barCategoryGap="45%"
                                    margin={{ top: 8, right: 12, left: 12, bottom: 56 }}
                                >
                                    <CartesianGrid stroke="#ececec" strokeDasharray="3 3" />
                                    <XAxis
                                        dataKey="name"
                                        tick={{ fontSize: 12 }}
                                        interval={0}
                                        angle={-15}
                                        textAnchor="end"
                                        height={46}
                                        tickMargin={12}
                                    />
                                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                                    <Tooltip cursor={{ fill: "rgba(0,0,0,.04)" }} contentStyle={{ borderRadius: 8 }} />
                                    <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: 8 }} />
                                    <Bar dataKey="documents" name="Documents" fill="#111111" radius={[6, 6, 0, 0]} />
                                    <Bar dataKey="pages" name="Pages" fill="#6b7280" radius={[6, 6, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="empty">No module data for this month.</div>
                    )}

                    {/* Compact module totals with cost */}
                    {moduleRows.length ? (
                        <div className="compact-grid">
                            {moduleRows.map((m) => (
                                <div key={m.name} className="compact-card">
                                    <div className="compact-title">{m.name}</div>
                                    <div className="compact-stats">
                                        <span className="badge black">{m.documents} docs</span>
                                        <span className="badge gray">{m.pages} pages</span>
                                        <span className="badge cost">{fmtCost(calcCost(m.inputTokens, m.outputTokens))}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>
            </section>

            {/* Department Cost Summary Table */}
            {departmentWiseCards.length > 0 && (
                <section className="panel full-width">
                    <div className="panel-head">
                        <div>
                            <h2>Department Cost Summary</h2>
                            <p className="muted">{MONTH_NAMES[selectedMonth - 1]} {selectedYear} — Gemini API cost from actual token usage</p>
                        </div>
                    </div>
                    <div className="table-wrap">
                        <table className="table scrolling">
                            <thead>
                                <tr>
                                    <th>Department</th>
                                    <th className="right">Documents</th>
                                    <th className="right">Pages</th>
                                    <th className="right">Cost</th>
                                    <th className="right">Share</th>
                                </tr>
                            </thead>
                            <tbody>
                                {departmentWiseCards.map((d) => {
                                    const share = totalCost > 0
                                        ? Math.round((d.cost / totalCost) * 100)
                                        : 0;
                                    return (
                                        <tr key={d.name}>
                                            <td className="strong">{d.name}</td>
                                            <td className="right">{d.docs}</td>
                                            <td className="right">{d.pages}</td>
                                            <td className="right strong">{fmtCost(d.cost)}</td>
                                            <td className="right">
                                                <div className="share-bar-wrap">
                                                    <div className="share-bar" style={{ width: `${share}%` }} />
                                                    <span>{share}%</span>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <td className="strong">Total</td>
                                    <td className="right strong">{stats.totalDocuments}</td>
                                    <td className="right strong">{stats.totalPages}</td>
                                    <td className="right strong">{fmtCost(totalCost)}</td>
                                    <td className="right strong">100%</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </section>
            )}

            {/* Aggregated by user (scrollable tbody) */}
            <section className="panel full-width">
                <div className="panel-head">
                    <div>
                        <h2>User Document Processing Details</h2>
                        <p className="muted">{MONTH_NAMES[selectedMonth - 1]} {selectedYear} — Totals by user</p>
                    </div>
                </div>

                {stats.aggregatedUserDocumentCounts.length ? (
                    <div className="table-wrap">
                        <table className="table scrolling">
                            <thead>
                                <tr>
                                    <th>User</th>
                                    <th>Department</th>
                                    <th className="right">Documents</th>
                                    <th className="right">Pages</th>
                                    <th className="right">Total Size</th>
                                    <th className="right">Cost</th>
                                    <th className="right">Entries</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stats.aggregatedUserDocumentCounts.map((row) => (
                                    <tr key={row.user_id}>
                                        <td>
                                            <div className="user-inline">
                                                <span className="avatar sm">
                                                    <User2 size={14} />
                                                </span>
                                                {row.user_name}
                                            </div>
                                        </td>
                                        <td>{row.department_name || "—"}</td>
                                        <td className="right">{Number(row.total_documents) || 0}</td>
                                        <td className="right">{Number(row.total_pages) || 0}</td>
                                        <td className="right">{formatFileSize(Number(row.total_size) || 0)}</td>
                                        <td className="right strong">{fmtCost(calcCost(row.total_input_tokens, row.total_output_tokens))}</td>
                                        <td className="right">{Number(row.processing_entries) || 0}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="empty">
                        <ScrollText size={32} />
                        <div>No user data for this month.</div>
                    </div>
                )}
            </section>
        </div>
    );
}

/** Small KPI component (local) */
function Kpi({ icon, title, value, hint, change }) {
    return (
        <article className="kpi-card">
            <div className="kpi-icon">{React.cloneElement(icon, { size: 20 })}</div>
            <div className="kpi-meta">
                <div className="kpi-value-row">
                    <div className="kpi-value">{value}</div>
                    {change !== null && change !== undefined && (
                        <span className={`kpi-change ${change >= 0 ? "up" : "down"}`}>
                            {change >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                            {Math.abs(change)}
                        </span>
                    )}
                </div>
                <div className="kpi-title">{title}</div>
                {hint ? <div className="kpi-hint">{hint}</div> : null}
            </div>
        </article>
    );
}
