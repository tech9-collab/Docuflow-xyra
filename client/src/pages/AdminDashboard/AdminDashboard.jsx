import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
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
    ClipboardList,
    ArrowUpRight,
    ArrowDownRight,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { api, fetchVatPeriods } from "../../helper/helper";
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
    const { user, isSuperAdmin, isDepartmentAdmin } = useAuth();
    const navigate = useNavigate();
    const canAccess = isSuperAdmin() || isDepartmentAdmin() || user?.role === 'admin';

    useEffect(() => {
        let title = "XYRA Books - Dashboard";
        if (isSuperAdmin()) title = "XYRA Books - Super Admin Dashboard";
        else if (isDepartmentAdmin()) title = "XYRA Books - Department Dashboard";
        document.title = title;
    }, [isSuperAdmin, isDepartmentAdmin]);

    // Month picker state — default to current month
    const now = new Date();
    const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
    const [selectedYear, setSelectedYear] = useState(now.getFullYear());

    const [stats, setStats] = useState({
        totalUsers: 0,
        totalDepartments: 0,
        totalRoles: 0,
        totalDocuments: 0,
        pendingFilings: 0,
        totalSize: 0,
        departmentDocumentCounts: [],
        aggregatedUserDocumentCounts: [],
        allDocumentDetails: [],
    });
    const [monthlySummary, setMonthlySummary] = useState([]);
    const [pendingFilingRows, setPendingFilingRows] = useState([]);
    const [pendingCustomers, setPendingCustomers] = useState([]);
    const [showPendingFilings, setShowPendingFilings] = useState(false);
    const [pendingSearch, setPendingSearch] = useState("");
    const [selectedPendingCustomer, setSelectedPendingCustomer] = useState("");
    const [selectedCustomerPendingRows, setSelectedCustomerPendingRows] = useState([]);
    const [pendingSortDir, setPendingSortDir] = useState("desc");
    const [pendingPage, setPendingPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    // utils
    const formatFileSize = (bytes = 0) => {
        if (!bytes) return "0 Bytes";
        const k = 1024, sizes = ["Bytes", "KB", "MB", "GB", "TB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    };

    // data load
    useEffect(() => {
        if (!canAccess) {
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

        setLoading(true);
        setError("");
        try {
            const [summaryRes, pendingRes, customersRes] = await Promise.all([
                api.get(`/dashboard/summary?month=${month}&year=${year}`),
                api.get(`/dashboard/pending-filings?month=${month}&year=${year}`),
                api.get(`/customers`)
            ]);
            const data = summaryRes.data;

            const users = data.employees || [];
            const roles = data.roles || [];
            const departments = data.departments || [];
            const docCount = data.sysStats || {};
            const deptDocCounts = data.departmentCounts || [];
            const aggregated = data.aggregatedCounts || [];
            const allDocs = data.documentCounts || [];

            const pendingItems = pendingRes.data.pendingFilings || [];
            setStats({
                totalUsers: users.length,
                totalDepartments: departments.length,
                totalRoles: roles.length,
                totalDocuments: Number(docCount.totalFiles) || 0,
                pendingFilings: pendingItems.length,
                totalPages: Number(docCount.totalPages) || 0,
                totalSize: Number(docCount.totalSize) || 0,
                totalInputTokens: Number(docCount.totalInputTokens) || 0,
                totalOutputTokens: Number(docCount.totalOutputTokens) || 0,
                departmentDocumentCounts: deptDocCounts,
                aggregatedUserDocumentCounts: aggregated,
                allDocumentDetails: allDocs,
            });
            setMonthlySummary(data.monthlySummary || []);
            setPendingFilingRows(pendingItems);
            setPendingCustomers(customersRes.data.customers || []);
            setSelectedCustomerPendingRows([]);
            setPendingPage(1);
        } catch (err) {
            setError(err.message || "Failed to fetch dashboard data");
        } finally {
            setLoading(false);
        }
    }, [selectedMonth, selectedYear]);

    useEffect(() => {
        let ignore = false;

        const loadSelectedCustomerPeriods = async () => {
            if (!selectedPendingCustomer) {
                setSelectedCustomerPendingRows([]);
                return;
            }

            const customer = (pendingCustomers || []).find(
                (item) => String(item.id) === String(selectedPendingCustomer)
            );
            if (!customer) {
                setSelectedCustomerPendingRows([]);
                return;
            }

            try {
                const periods = await fetchVatPeriods(selectedPendingCustomer);
                if (ignore) return;

                const rows = (periods || [])
                    .filter((period) =>
                        period?.status === "not_started" || period?.status === "in_progress"
                    )
                    .map((period) => ({
                        id: period.id,
                        customer_id: customer.id,
                        customer_name: customer.customer_name,
                        email: customer.email || "",
                        phone: customer.mobile || "",
                        service_required: "VAT Filing - Period",
                        status: period.status,
                        created_at: period.created_at || period.updated_at || period.period_from,
                        period_from: period.period_from,
                        period_to: period.period_to,
                        due_date: period.due_date,
                        submit_date: period.submit_date,
                    }));

                setSelectedCustomerPendingRows(rows);
                setPendingPage(1);
            } catch {
                if (!ignore) {
                    setSelectedCustomerPendingRows([]);
                }
            }
        };

        loadSelectedCustomerPeriods();

        return () => {
            ignore = true;
        };
    }, [selectedPendingCustomer, pendingCustomers]);

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

    const pendingPageSize = 10;
    const pendingCustomerOptions = useMemo(() => {
        const seen = new Set();
        return (pendingCustomers || [])
            .filter((customer) => {
                if (!customer?.id || !customer?.customer_name) return false;
                const key = customer.customer_name.trim().toLowerCase();
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .map((customer) => ({
                id: customer.id,
                name: customer.customer_name,
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [pendingCustomers]);

    const filteredPendingFilings = useMemo(() => {
        const sourceRows = selectedPendingCustomer
            ? selectedCustomerPendingRows
            : pendingFilingRows;
        const term = pendingSearch.trim().toLowerCase();
        const rows = (sourceRows || []).filter((row) => {
            if (selectedPendingCustomer && String(row.customer_id) !== selectedPendingCustomer) {
                return false;
            }
            if (!term) return true;
            return [
                row.customer_name,
                row.email,
                row.phone,
                row.service_required,
                row.status,
            ].some((value) => String(value || "").toLowerCase().includes(term));
        });

        return rows.sort((a, b) => {
            const aTime = new Date(a.created_at).getTime();
            const bTime = new Date(b.created_at).getTime();
            return pendingSortDir === "asc" ? aTime - bTime : bTime - aTime;
        });
    }, [pendingFilingRows, selectedCustomerPendingRows, pendingSearch, selectedPendingCustomer, pendingSortDir]);

    // KPI count always matches what the table displays
    const pendingFilingsCount = filteredPendingFilings.length;

    const pendingTotalPages = Math.max(1, Math.ceil(filteredPendingFilings.length / pendingPageSize));
    const currentPendingPage = Math.min(pendingPage, pendingTotalPages);
    const pendingPageRows = filteredPendingFilings.slice(
        (currentPendingPage - 1) * pendingPageSize,
        currentPendingPage * pendingPageSize
    );

    const formatDate = (value) => {
        if (!value) return "-";
        try {
            return new Date(value).toLocaleDateString();
        } catch {
            return "-";
        }
    };

    const formatStatus = (value) =>
        String(value || "")
            .split("_")
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" ") || "-";



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

    if (!canAccess) {
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
                <Kpi icon={<Users />} title="Users" value={stats.totalUsers} tone="indigo" />
                <Kpi icon={<Briefcase />} title="Departments" value={stats.totalDepartments} tone="emerald" />
                <Kpi icon={<Shield />} title="Roles" value={stats.totalRoles} tone="amber" />
                <Kpi
                    icon={<FileSpreadsheet />}
                    title="Documents"
                    value={stats.totalDocuments}
                    tone="violet"
                />
                <Kpi
                    icon={<ScrollText />}
                    title="Total Pages"
                    value={stats.totalPages}
                    tone="sky"
                />
                <Kpi
                    icon={<ClipboardList />}
                    title="Pending Filings"
                    value={pendingFilingsCount}
                    hint="View filing list"
                    onClick={() => setShowPendingFilings((prev) => !prev)}
                    active={showPendingFilings}
                    className="kpi-card--pending"
                    tone="rose"
                />
            </section>

            {showPendingFilings && (
                <section className="panel full-width">
                    <div className="panel-head">
                        <div>
                            <h2>Pending Filings</h2>
                            <p className="muted">{MONTH_NAMES[selectedMonth - 1]} {selectedYear} - pending VAT and CT filings</p>
                        </div>
                        <div className="pending-filings-toolbar">
                            <div className="pending-filings-filters">
                                <input
                                    type="search"
                                    className="pending-search"
                                    placeholder="Search by customer, email, phone, service, or status"
                                    value={pendingSearch}
                                    onChange={(e) => {
                                        setPendingSearch(e.target.value);
                                        setPendingPage(1);
                                    }}
                                />
                                <select
                                    className="pending-customer-select"
                                    value={selectedPendingCustomer}
                                    onChange={(e) => {
                                        setSelectedPendingCustomer(e.target.value);
                                        setPendingPage(1);
                                    }}
                                >
                                    <option value="">All Customers</option>
                                    {pendingCustomerOptions.map((customer) => (
                                        <option key={customer.id} value={String(customer.id)}>
                                            {customer.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <button
                                type="button"
                                className="btn-refresh bw pending-sort-button"
                                onClick={() => {
                                    setPendingSortDir((prev) => (prev === "desc" ? "asc" : "desc"));
                                    setPendingPage(1);
                                }}
                            >
                                <span>Sort: {pendingSortDir === "desc" ? "Newest" : "Oldest"}</span>
                            </button>
                        </div>
                    </div>

                    <div className="table-wrap">
                        <table className="table scrolling">
                            <thead>
                                <tr>
                                    <th>Customer Name</th>
                                    <th>Email</th>
                                    <th>Phone</th>
                                    <th>Service Required</th>
                                    <th>Status</th>
                                    <th>Created Date</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pendingPageRows.length ? pendingPageRows.map((row) => (
                                    <tr key={`${row.service_required}-${row.id}`}>
                                        <td className="strong">{row.customer_name || "-"}</td>
                                        <td>{row.email || "-"}</td>
                                        <td>{row.phone || "-"}</td>
                                        <td>{row.service_required}</td>
                                        <td>{formatStatus(row.status)}</td>
                                        <td>{formatDate(row.created_at)}</td>
                                        <td>
                                            <div className="table-actions">
                                                <button type="button" className="table-action-btn" onClick={() => navigate(`/customers/${row.customer_id}`)}>
                                                    View
                                                </button>
                                                <button type="button" className="table-action-btn secondary" onClick={() => navigate(`/customers/${row.customer_id}/edit`)}>
                                                    Edit
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                )) : (
                                    <tr>
                                        <td colSpan="7" className="empty-cell">No pending filings available</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div className="pending-pagination">
                        <span className="muted">
                            {filteredPendingFilings.length ? `${(currentPendingPage - 1) * pendingPageSize + 1}-${Math.min(currentPendingPage * pendingPageSize, filteredPendingFilings.length)} of ${filteredPendingFilings.length}` : "0 results"}
                        </span>
                        <div className="pagination-actions">
                            <button
                                type="button"
                                className="table-action-btn secondary"
                                onClick={() => setPendingPage((page) => Math.max(1, page - 1))}
                                disabled={currentPendingPage === 1}
                            >
                                Previous
                            </button>
                            <span className="muted">Page {currentPendingPage} of {pendingTotalPages}</span>
                            <button
                                type="button"
                                className="table-action-btn secondary"
                                onClick={() => setPendingPage((page) => Math.min(pendingTotalPages, page + 1))}
                                disabled={currentPendingPage === pendingTotalPages}
                            >
                                Next
                            </button>
                        </div>
                    </div>
                </section>
            )}

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
function Kpi({ icon, title, value, hint, change, onClick, active = false, className = "", tone = "default" }) {
    return (
        <article
            className={`kpi-card kpi-tone-${tone}${onClick ? " clickable" : ""}${active ? " active" : ""}${className ? ` ${className}` : ""}`}
            onClick={onClick}
            onKeyDown={(e) => {
                if (!onClick) return;
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onClick();
                }
            }}
            role={onClick ? "button" : undefined}
            tabIndex={onClick ? 0 : undefined}
        >
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
