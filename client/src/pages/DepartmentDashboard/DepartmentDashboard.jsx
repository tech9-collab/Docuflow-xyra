import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Users,
  FileSpreadsheet,
  Landmark,
  Receipt,
  IdCard,
  BookUser,
  PlaneTakeoff,
  BadgeCheck,
  Building2,
  Calendar,
  Shield,
  ChevronLeft,
  ChevronRight,
  DollarSign,
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
import "./DepartmentDashboard.css";

/* ---------- Constants ---------- */
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

/* ---------- utils ---------- */
const initials = (name = "") =>
  name
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0]?.toUpperCase())
    .slice(0, 2)
    .join("") || "U";

const fmtDate = (v) => {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString();
  } catch {
    return "—";
  }
};

export default function DepartmentDashboard() {
  const { departmentId } = useParams();
  const navigate = useNavigate();
  const { user, hasPermission, isSuperAdmin, isDepartmentAdmin } = useAuth();

  useEffect(() => {
    document.title = "Xyra Books - Department Dashboard";
  }, []);

  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());

  const [department, setDepartment] = useState(null);
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [documentCount, setDocumentCount] = useState([]);
  const [adminDocumentCount, setAdminDocumentCount] = useState([]);
  const [userDocumentCounts, setUserDocumentCounts] = useState({});
  const [pendingFilings, setPendingFilings] = useState(0);
  const [pendingFilingRows, setPendingFilingRows] = useState([]);
  const [showPendingFilings, setShowPendingFilings] = useState(false);
  const [pendingSearch, setPendingSearch] = useState("");
  const [pendingSortDir, setPendingSortDir] = useState("desc");
  const [pendingPage, setPendingPage] = useState(1);
  const [monthlySummary, setMonthlySummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /* ---------- fetch ---------- */
  const fetchDashboard = useCallback(async (m, y) => {
    const month = m || selectedMonth;
    const year = y || selectedYear;
    const qp = `?month=${month}&year=${year}`;

    setLoading(true);
    setError("");

    try {
      if (user.department_id !== parseInt(departmentId) && !isSuperAdmin()) {
        setError("Access denied: You do not have permission to view this department dashboard");
        setLoading(false);
        return;
      }

      if (isDepartmentAdmin() && !isSuperAdmin()) {
        const [deptRes, usersRes, rolesRes, docCountRes, adminDocCountRes, pendingRes, pendingRowsRes, monthlyRes] =
          await Promise.all([
            api.get(`/admin/departments/${departmentId}`),
            api.get(`/admin/departments/${departmentId}/users`),
            api.get(`/admin/departments/${departmentId}/roles`),
            api.get(`/admin/departments/${departmentId}/document-count${qp}`),
            api.get(`/admin/users/${user.id}/document-count${qp}`),
            api.get(`/admin/departments/${departmentId}/pending-filings${qp}`),
            api.get(`/admin/departments/${departmentId}/pending-filings/details${qp}`),
            api.get(`/admin/departments/${departmentId}/monthly-summary`),
          ]);

        const dept = deptRes.data.department || deptRes.data;
        setDepartment(dept);

        const deptUsers = usersRes.data.users || usersRes.data.employees || [];
        setUsers(deptUsers);
        setRoles(rolesRes.data.roles || []);
        setDocumentCount(docCountRes.data.documentCount || []);
        setAdminDocumentCount(adminDocCountRes.data.documentCount || []);
        setPendingFilings(Number(pendingRes.data.pendingFilings) || 0);
        setPendingFilingRows(pendingRowsRes.data.pendingFilings || []);
        setMonthlySummary(monthlyRes.data.monthlySummary || []);
        setPendingPage(1);

        await fetchUserDocumentCounts(deptUsers, qp);
      } else {
        const [deptRes, usersRes, rolesRes, docCountRes, pendingRes, pendingRowsRes, monthlyRes] = await Promise.all([
          api.get(`/admin/departments`),
          api.get(`/admin/employees`),
          api.get(`/admin/roles`),
          api.get(`/admin/departments/${departmentId}/document-count${qp}`),
          api.get(`/admin/departments/${departmentId}/pending-filings${qp}`),
          api.get(`/admin/departments/${departmentId}/pending-filings/details${qp}`),
          api.get(`/admin/departments/${departmentId}/monthly-summary`),
        ]);

        const dept = (deptRes.data.departments || []).find(
          (d) => d.id == departmentId
        );
        if (!dept) {
          setError("Department not found");
          setLoading(false);
          return;
        }
        setDepartment(dept);

        const deptUsers = (usersRes.data.employees || []).filter(
          (u) => u.department_id == departmentId
        );
        setUsers(deptUsers);
        setRoles((rolesRes.data.roles || []).filter((r) => r.department_id == departmentId));
        setDocumentCount(docCountRes.data.documentCount || []);
        setPendingFilings(Number(pendingRes.data.pendingFilings) || 0);
        setPendingFilingRows(pendingRowsRes.data.pendingFilings || []);
        setMonthlySummary(monthlyRes.data.monthlySummary || []);
        setPendingPage(1);

        await fetchUserDocumentCounts(deptUsers, qp);
      }
    } catch (err) {
      setError(err?.message || "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  }, [departmentId, selectedMonth, selectedYear, user, isSuperAdmin, isDepartmentAdmin]);

  useEffect(() => {
    fetchDashboard();
    // eslint-disable-next-line
  }, [departmentId]);

  async function fetchUserDocumentCounts(usersList, qp = "") {
    const userCounts = {};
    for (const u of usersList) {
      try {
        const res = await api.get(`/admin/users/${u.id}/document-count${qp}`);
        userCounts[u.id] = res.data.documentCount || [];
      } catch {
        userCounts[u.id] = [];
      }
    }
    setUserDocumentCounts(userCounts);
  }

  // Month navigation
  const goToPrevMonth = () => {
    let m = selectedMonth - 1;
    let y = selectedYear;
    if (m < 1) { m = 12; y -= 1; }
    setSelectedMonth(m);
    setSelectedYear(y);
    fetchDashboard(m, y);
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
    fetchDashboard(m, y);
  };

  const isCurrentMonth = selectedMonth === (now.getMonth() + 1) && selectedYear === now.getFullYear();

  /* ---------- derived ---------- */
  const totalUserDocuments = Object.values(userDocumentCounts).reduce(
    (tot, docs) => tot + docs.reduce((s, r) => s + (Number(r.files_count) || 0), 0),
    0
  );
  const totalUserPages = Object.values(userDocumentCounts).reduce(
    (tot, docs) => tot + docs.reduce((s, r) => s + (Number(r.page_count) || 0), 0),
    0
  );
  const totalInputTokens = Object.values(userDocumentCounts).reduce(
    (tot, docs) => tot + docs.reduce((s, r) => s + (Number(r.input_tokens) || 0), 0),
    0
  );
  const totalOutputTokens = Object.values(userDocumentCounts).reduce(
    (tot, docs) => tot + docs.reduce((s, r) => s + (Number(r.output_tokens) || 0), 0),
    0
  );
  const totalCost = calcCost(totalInputTokens, totalOutputTokens);

  const moduleMap = (() => {
    const m = {};
    Object.values(userDocumentCounts).forEach((docs) =>
      docs.forEach((r) => {
        const k = (r.module_name || "Unknown").replace(/_/g, " ");
        if (!m[k]) m[k] = { files: 0, pages: 0, inputTokens: 0, outputTokens: 0 };
        m[k].files += Number(r.files_count) || 0;
        m[k].pages += Number(r.page_count) || 0;
        m[k].inputTokens += Number(r.input_tokens) || 0;
        m[k].outputTokens += Number(r.output_tokens) || 0;
      })
    );
    return m;
  })();

  const moduleData = Object.entries(moduleMap)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.files - a.files);

  const dateMap = (() => {
    const d = {};
    Object.values(userDocumentCounts).forEach((docs) =>
      docs.forEach((r) => {
        const key = r.file_uploaded_date
          ? new Date(r.file_uploaded_date).toISOString().slice(0, 10)
          : "Unknown";
        if (!d[key]) d[key] = { files: 0, pages: 0 };
        d[key].files += Number(r.files_count) || 0;
        d[key].pages += Number(r.page_count) || 0;
      })
    );
    return d;
  })();

  const dateData = Object.entries(dateMap)
    .map(([iso, v]) => ({ date: iso, ...v }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Admin quick totals
  const adminTotalDocuments = adminDocumentCount.reduce(
    (s, r) => s + (Number(r.files_count) || 0), 0
  );
  const adminTotalPages = adminDocumentCount.reduce(
    (s, r) => s + (Number(r.page_count) || 0), 0
  );
  const adminInputTokens = adminDocumentCount.reduce(
    (s, r) => s + (Number(r.input_tokens) || 0), 0
  );
  const adminOutputTokens = adminDocumentCount.reduce(
    (s, r) => s + (Number(r.output_tokens) || 0), 0
  );
  const adminTotalSize = adminDocumentCount.reduce(
    (s, r) => s + (Number(r.file_size) || 0), 0
  );

  // Monthly trend
  const monthlyTrendData = monthlySummary.map((item) => ({
    label: `${SHORT_MONTHS[Number(item.month) - 1]} ${item.year}`,
    documents: Number(item.total_documents) || 0,
    pages: Number(item.total_pages) || 0,
  }));

  // Per-user aggregation for team table
  const userStats = users.map((u) => {
    const docs = userDocumentCounts[u.id] || [];
    const docCount = docs.reduce((s, r) => s + (Number(r.files_count) || 0), 0);
    const pageCount = docs.reduce((s, r) => s + (Number(r.page_count) || 0), 0);
    const uInp = docs.reduce((s, r) => s + (Number(r.input_tokens) || 0), 0);
    const uOut = docs.reduce((s, r) => s + (Number(r.output_tokens) || 0), 0);
    return { ...u, docCount, pageCount, cost: calcCost(uInp, uOut) };
  }).sort((a, b) => b.docCount - a.docCount);

  const pendingPageSize = 10;
  const filteredPendingFilings = useMemo(() => {
    const term = pendingSearch.trim().toLowerCase();
    const rows = (pendingFilingRows || []).filter((row) => {
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
  }, [pendingFilingRows, pendingSearch, pendingSortDir]);

  const pendingTotalPages = Math.max(1, Math.ceil(filteredPendingFilings.length / pendingPageSize));
  const currentPendingPage = Math.min(pendingPage, pendingTotalPages);
  const pendingPageRows = filteredPendingFilings.slice(
    (currentPendingPage - 1) * pendingPageSize,
    currentPendingPage * pendingPageSize
  );

  const formatPendingStatus = (value) =>
    String(value || "")
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "-";

  /* ---------- guards ---------- */
  if (loading)
    return (
      <div className="dept page">
        <div className="center-stack">Loading…</div>
      </div>
    );

  if (error)
    return (
      <div className="dept page">
        <div className="notice error">{error}</div>
      </div>
    );

  if (!department)
    return (
      <div className="dept page">
        <div className="notice">Department not found</div>
      </div>
    );

  if (
    !isSuperAdmin() &&
    (!isDepartmentAdmin() || user.department_id !== parseInt(departmentId))
  ) {
    return (
      <div className="dept page">
        <div className="notice error">
          Access denied: Only department admins can view this dashboard
        </div>
      </div>
    );
  }

  /* ---------- UI ---------- */
  return (
    <div className="dept page">
      {/* header */}
      <header className="header">
        <div className="header-left">
          <h1 className="title">{department.name} Dashboard</h1>
          <p className="subtitle">
            Department activity, members & processing details
          </p>
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

          <div className="profile-card">
            <div className="avatar ring">{initials(department.name)}</div>
            <div className="profile-text">
              <div className="profile-top">
                <span className="profile-name">{department.name}</span>
                <span className="pill">
                  <Building2 size={14} />
                  <span className="pill-text">Dept ID: {department.id}</span>
                </span>
              </div>
              <div className="muted small">Updated {fmtDate(department.updated_at)}</div>
            </div>
          </div>
        </div>
      </header>

      {/* KPIs */}
      <section className="kpis">
        <article className="kpi">
          <div className="kpi-icon"><Users size={18} /></div>
          <div className="kpi-meta">
            <div className="kpi-value">{users.length}</div>
            <div className="kpi-label">Total Members</div>
          </div>
        </article>

        <article className="kpi">
          <div className="kpi-icon"><FileSpreadsheet size={18} /></div>
          <div className="kpi-meta">
            <div className="kpi-value">{totalUserDocuments}</div>
            <div className="kpi-label">Documents Processed</div>
          </div>
        </article>

        <article className="kpi">
          <div className="kpi-icon"><ScrollText size={18} /></div>
          <div className="kpi-meta">
            <div className="kpi-value">{totalUserPages}</div>
            <div className="kpi-label">Total Pages</div>
          </div>
        </article>

        <article
          className={`kpi pending-clickable${showPendingFilings ? " active" : ""}`}
          onClick={() => setShowPendingFilings((prev) => !prev)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setShowPendingFilings((prev) => !prev);
            }
          }}
          role="button"
          tabIndex={0}
        >
          <div className="kpi-icon"><DollarSign size={18} /></div>
          <div className="kpi-meta">
            <div className="kpi-value">{pendingFilings}</div>
            <div className="kpi-label">Pending Filings</div>
            <div className="kpi-hint">{pendingFilings} pending item{pendingFilings === 1 ? "" : "s"}</div>
          </div>
        </article>

        <article className="kpi">
          <div className="kpi-icon"><BarChart3 size={18} /></div>
          <div className="kpi-meta">
            <div className="kpi-value">{Object.keys(moduleMap).length}</div>
            <div className="kpi-label">Modules Used</div>
          </div>
        </article>
      </section>

      {showPendingFilings && (
        <section className="panel">
          <div className="panel-head with-meta">
            <h2>Pending Filings</h2>
            <div className="panel-meta pending-filings-toolbar">
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
              <button
                type="button"
                className="month-nav pending-sort-btn"
                onClick={() => {
                  setPendingSortDir((prev) => (prev === "desc" ? "asc" : "desc"));
                  setPendingPage(1);
                }}
                title="Toggle date sort"
              >
                {pendingSortDir === "desc" ? "Newest" : "Oldest"}
              </button>
            </div>
          </div>

          <div className="table-wrap">
            <table className="table">
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
                {pendingPageRows.length ? (
                  pendingPageRows.map((row) => (
                    <tr key={`${row.service_required}-${row.id}`}>
                      <td className="strong">{row.customer_name || "-"}</td>
                      <td>{row.email || "-"}</td>
                      <td>{row.phone || "-"}</td>
                      <td>{row.service_required}</td>
                      <td>{formatPendingStatus(row.status)}</td>
                      <td>{fmtDate(row.created_at)}</td>
                      <td>
                        <div className="pending-actions">
                          <button type="button" className="pending-action-btn" onClick={() => navigate(`/customers/${row.customer_id}`)}>
                            View
                          </button>
                          <button type="button" className="pending-action-btn secondary" onClick={() => navigate(`/customers/${row.customer_id}/edit`)}>
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="7" className="empty">No pending filings available</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="pending-pagination">
            <span className="muted small">
              {filteredPendingFilings.length
                ? `${(currentPendingPage - 1) * pendingPageSize + 1}-${Math.min(currentPendingPage * pendingPageSize, filteredPendingFilings.length)} of ${filteredPendingFilings.length}`
                : "0 results"}
            </span>
            <div className="pending-actions">
              <button
                type="button"
                className="pending-action-btn secondary"
                onClick={() => setPendingPage((page) => Math.max(1, page - 1))}
                disabled={currentPendingPage === 1}
              >
                Previous
              </button>
              <span className="muted small">Page {currentPendingPage} of {pendingTotalPages}</span>
              <button
                type="button"
                className="pending-action-btn secondary"
                onClick={() => setPendingPage((page) => Math.min(pendingTotalPages, page + 1))}
                disabled={currentPendingPage === pendingTotalPages}
              >
                Next
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Dept admin mini KPIs */}
      {isDepartmentAdmin() && user.department_id === parseInt(departmentId) && (
        <section className="mini-kpis">
          <article className="mini-kpi">
            <div className="mini-icon"><FileSpreadsheet size={16} /></div>
            <div className="mini-meta">
              <div className="mini-value">{adminTotalDocuments}</div>
              <div className="mini-label">Your Documents</div>
            </div>
          </article>
          <article className="mini-kpi">
            <div className="mini-icon"><ScrollText size={16} /></div>
            <div className="mini-meta">
              <div className="mini-value">{adminTotalPages}</div>
              <div className="mini-label">Your Pages</div>
            </div>
          </article>
          <article className="mini-kpi">
            <div className="mini-icon"><DollarSign size={16} /></div>
            <div className="mini-meta">
              <div className="mini-value">{fmtCost(calcCost(adminInputTokens, adminOutputTokens))}</div>
              <div className="mini-label">Your Cost</div>
            </div>
          </article>
          <article className="mini-kpi">
            <div className="mini-icon"><BarChart3 size={16} /></div>
            <div className="mini-meta">
              <div className="mini-value">{(adminTotalSize / (1024 * 1024)).toFixed(2)} MB</div>
              <div className="mini-label">Your Processed Size</div>
            </div>
          </article>
        </section>
      )}

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
                  <linearGradient id="deptGradPages" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#111" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#111" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e6e6e6" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip contentStyle={{ borderRadius: 6 }} />
                <Legend />
                <Area type="monotone" dataKey="pages" name="Pages" stroke="#111" fill="url(#deptGradPages)" strokeWidth={2} />
                <Area type="monotone" dataKey="documents" name="Documents" stroke="#6b7280" fill="transparent" strokeWidth={2} strokeDasharray="5 5" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Team Members Table (with cost) */}
      <section className="panel">
        <div className="panel-head with-meta">
          <h2>Team Members</h2>
          <div className="panel-meta">
            <span className="badge">{MONTH_NAMES[selectedMonth - 1]} {selectedYear}</span>
            <span className="badge">{users.length} members</span>
          </div>
        </div>
        {userStats.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  <th className="right">Documents</th>
                  <th className="right">Pages</th>
                  <th className="right">Cost</th>
                  <th className="right">Share</th>
                </tr>
              </thead>
              <tbody>
                {userStats.map((u) => {
                  const share = totalUserPages
                    ? Math.round((u.pageCount / totalUserPages) * 100)
                    : 0;
                  return (
                    <tr key={u.id}>
                      <td>
                        <div className="user-inline">
                          <div className="user-avatar-sm">{initials(u.name)}</div>
                          <span className="strong">{u.name}</span>
                        </div>
                      </td>
                      <td><span className="role-pill">{u.role_name || "—"}</span></td>
                      <td className="right">{u.docCount}</td>
                      <td className="right">{u.pageCount}</td>
                      <td className="right strong">{fmtCost(u.cost)}</td>
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
                  <td colSpan="2" className="right strong">Total</td>
                  <td className="right strong">{totalUserDocuments}</td>
                  <td className="right strong">{totalUserPages}</td>
                  <td className="right strong">{fmtCost(totalCost)}</td>
                  <td className="right strong">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="empty">No team members found</div>
        )}
      </section>

      {/* Department Processing Details — CHARTS */}
      <section className="panel">
        <div className="panel-head with-meta">
          <h2>Processing Details</h2>
          <div className="panel-meta">
            <span className="badge">{MONTH_NAMES[selectedMonth - 1]} {selectedYear}</span>
            <span className="badge">Modules: {Object.keys(moduleMap).length}</span>
          </div>
        </div>

        <div className="charts-row">
          {/* Module-wise */}
          <div className="chart-card">
            <div className="chart-title">Module-wise</div>
            {moduleData.length ? (
              <div className="chart-wrap chart-narrow">
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart
                    data={moduleData}
                    barSize={20}
                    margin={{ top: 6, right: 8, left: 8, bottom: 20 }}
                  >
                    <CartesianGrid stroke="#e6e6e6" strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fill: "#0a0a0a", fontSize: 12 }} angle={-20} textAnchor="end" interval={0} />
                    <YAxis tick={{ fill: "#0a0a0a", fontSize: 12 }} allowDecimals={false} />
                    <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} contentStyle={{ borderRadius: 6 }} />
                    <Legend wrapperStyle={{ paddingTop: 6 }} />
                    <Bar dataKey="files" name="Files" fill="#0a0a0a" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="pages" name="Pages" fill="#6b7280" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="empty small">No module data</div>
            )}
          </div>

          {/* Date-wise */}
          <div className="chart-card">
            <div className="chart-title">Date-wise</div>
            {dateData.length ? (
              <div className="chart-wrap chart-narrow">
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart
                    data={dateData}
                    barSize={20}
                    margin={{ top: 6, right: 8, left: 8, bottom: 6 }}
                  >
                    <CartesianGrid stroke="#e6e6e6" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: "#0a0a0a", fontSize: 12 }}
                      tickFormatter={(v) => (v === "Unknown" ? v : fmtDate(v))}
                    />
                    <YAxis tick={{ fill: "#0a0a0a", fontSize: 12 }} allowDecimals={false} />
                    <Tooltip
                      cursor={{ fill: "rgba(0,0,0,0.04)" }}
                      contentStyle={{ borderRadius: 6 }}
                      labelFormatter={(v) => (v === "Unknown" ? v : fmtDate(v))}
                    />
                    <Legend wrapperStyle={{ paddingTop: 6 }} />
                    <Bar dataKey="files" name="Files" fill="#0a0a0a" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="pages" name="Pages" fill="#6b7280" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="empty small">No date data</div>
            )}
          </div>
        </div>
      </section>

      {/* Module Cost Table */}
      {moduleData.length > 0 && (
        <section className="panel">
          <div className="panel-head with-meta">
            <h2>Module Cost Breakdown</h2>
            <div className="panel-meta">
              <span className="badge">{MONTH_NAMES[selectedMonth - 1]} {selectedYear}</span>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Module</th>
                  <th className="right">Files</th>
                  <th className="right">Pages</th>
                  <th className="right">Cost</th>
                  <th className="right">Share</th>
                </tr>
              </thead>
              <tbody>
                {moduleData.map((m) => {
                  const modCost = calcCost(m.inputTokens, m.outputTokens);
                  const share = totalCost > 0 ? Math.round((modCost / totalCost) * 100) : 0;
                  return (
                    <tr key={m.name}>
                      <td className="strong">{m.name}</td>
                      <td className="right">{m.files}</td>
                      <td className="right">{m.pages}</td>
                      <td className="right strong">{fmtCost(modCost)}</td>
                      <td className="right">{share}%</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="strong">Total</td>
                  <td className="right strong">{moduleData.reduce((s, m) => s + m.files, 0)}</td>
                  <td className="right strong">{totalUserPages}</td>
                  <td className="right strong">{fmtCost(totalCost)}</td>
                  <td className="right strong">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {/* Department tools (permissions) */}
      <section className="panel">
        <div className="panel-head">
          <h2>Department Tools</h2>
        </div>
        <div className="tools-grid">
          {hasPermission("converts.bank_statements") && (
            <div className="tool-card static">
              <Landmark size={28} />
              <h3>Bank Statements</h3>
              <p>Process bank statement documents</p>
            </div>
          )}
          {hasPermission("converts.invoices") && (
            <div className="tool-card static">
              <FileSpreadsheet size={28} />
              <h3>Invoices</h3>
              <p>Process invoice documents</p>
            </div>
          )}
          {hasPermission("converts.bills") && (
            <div className="tool-card static">
              <Receipt size={28} />
              <h3>Bills</h3>
              <p>Process bill documents</p>
            </div>
          )}
          {hasPermission("converts.emirates_id") && (
            <div className="tool-card static">
              <IdCard size={28} />
              <h3>Emirates ID</h3>
              <p>Process Emirates ID documents</p>
            </div>
          )}
          {hasPermission("converts.passport") && (
            <div className="tool-card static">
              <BookUser size={28} />
              <h3>Passport</h3>
              <p>Process passport documents</p>
            </div>
          )}
          {hasPermission("converts.visa") && (
            <div className="tool-card static">
              <PlaneTakeoff size={28} />
              <h3>Visa</h3>
              <p>Process visa documents</p>
            </div>
          )}
          {hasPermission("converts.trade_license") && (
            <div className="tool-card static">
              <BadgeCheck size={28} />
              <h3>Trade License</h3>
              <p>Process trade license documents</p>
            </div>
          )}
        </div>
      </section>

      {/* Admin tools */}
      {(isSuperAdmin() ||
        (isDepartmentAdmin() && user.department_id === parseInt(departmentId))) && (
        <section className="panel">
          <div className="panel-head">
            <h2>Department Admin Tools</h2>
          </div>
          <div className="tools-grid">
            <button
              className="tool-card"
              onClick={() => navigate(`/admin/department/${departmentId}/users`)}
              type="button"
            >
              <Users size={28} />
              <h3>User Management</h3>
              <p>Manage department users and roles</p>
            </button>

            <button
              className="tool-card"
              onClick={() => navigate("/admin/roles-permissions")}
              type="button"
            >
              <Shield size={28} />
              <h3>Roles & Permissions</h3>
              <p>Manage access for your department</p>
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
