import { useEffect, useMemo, useRef, useState } from "react";
import {
  LogOut,
  ChevronDown,
  Shield,
  ChevronLeft,
  Search,
  Terminal,
  CornerDownLeft,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import "./Navbar.css";
import { useAuth } from "../../context/AuthContext";

export default function Navbar({ onToggleSidebar, setupProgress = 0 }) {
  const {
    user,
    logout,
    hasPermission,
    isSuperAdmin,
    isDepartmentAdmin,
    isBusinessUser,
  } = useAuth();
  const navigate = useNavigate();
  const isAdmin = () => user?.type === "admin";

  const searchIndex = useMemo(() => {
    const items = [];
    const push = (label, path, group, keywords = "") =>
      items.push({ label, path, group, keywords });

    if (isSuperAdmin() && !isAdmin()) {
      push("Dashboard", "/admin/dashboard", "Dashboard", "home overview");
      push("Departments", "/admin/departments", "Dashboard", "department teams");
      push("Roles & Permissions", "/admin/roles-permissions", "Dashboard", "roles permissions access");
      push("User Management", "/admin/employees", "Dashboard", "users staff employees people");
    }

    if (isAdmin()) {
      push("Dashboard", "/admin/dashboard", "Dashboard", "home overview");
      push("Departments", "/admin/departments", "Dashboard", "department teams");
      push("Roles & Permissions", "/admin/roles-permissions", "Dashboard", "roles permissions access");
      push("User Management", "/admin/employees", "Dashboard", "users staff employees people");
    }

    if (isBusinessUser() && !isAdmin()) {
      push("Dashboard", "/admin/dashboard", "Dashboard", "home overview");
      push("Departments", "/admin/departments", "Dashboard", "department teams");
      push("Roles & Permissions", "/admin/roles-permissions", "Dashboard", "roles permissions access");
      push("User Management", "/admin/employees", "Dashboard", "users staff employees people");
    }

    if (isDepartmentAdmin()) {
      if (hasPermission("dashboard.read")) {
        push(
          `${user?.department_name || "Department"} Dashboard`,
          `/admin/department/${user?.department_id}/dashboard`,
          "Department Admin",
          "department dashboard overview"
        );
      }
      if (hasPermission("roles.read")) {
        push("Roles & Permissions", "/admin/roles-permissions", "Department Admin", "roles permissions access");
      }
      if (hasPermission("employees.read")) {
        push(
          "Department Users",
          `/admin/department/${user?.department_id}/users`,
          "Department Admin",
          "users staff department"
        );
      }
    }

    if (!isSuperAdmin() && !isDepartmentAdmin() && !isBusinessUser()) {
      if (hasPermission("dashboard.read")) {
        push("My Dashboard", "/user/dashboard", "Dashboard", "home overview");
      }
    }

    if (hasPermission("customers.read")) {
      push("Customers", "/customers", "Customers", "clients");
    }

    if (hasPermission("projects.vat_filing") || hasPermission("projects.ct_filing")) {
      if (hasPermission("projects.vat_filing")) {
        push("VAT Filing", "/projects/vat-filing", "Departments", "vat tax return filing");
      }
    }

    if (hasPermission("converts.invoices")) {
      push("Invoices & Bills", "/converts/invoices", "Converts", "invoice receipt bills");
      push("TRN Verification", "/converts/trn-verification", "Converts", "trn tax registration number");
    }

    if (!isAdmin() && hasPermission("converts.emirates_id")) {
      push("Emirates ID", "/converts/emiratesid", "Converts", "emirates id eid");
    }
    if (!isAdmin() && hasPermission("converts.passport")) {
      push("Passport", "/converts/passport", "Converts", "passport travel");
    }
    if (!isAdmin() && hasPermission("converts.visa")) {
      push("Visa", "/converts/visa", "Converts", "visa residence");
    }
    if (!isAdmin() && hasPermission("converts.trade_license")) {
      push("Trade License", "/converts/tradelicense", "Converts", "trade license");
    }

    return items;
  }, [user, hasPermission, isSuperAdmin, isDepartmentAdmin, isBusinessUser]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const menuRef = useRef(null);
  const btnRef = useRef(null);
  const searchRef = useRef(null);
  const inputRef = useRef(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return searchIndex
      .filter((item) => {
        const hay = `${item.label} ${item.group} ${item.keywords || ""}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 8);
  }, [query, searchIndex]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (
        open &&
        menuRef.current &&
        !menuRef.current.contains(e.target) &&
        btnRef.current &&
        !btnRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
      if (
        searchOpen &&
        searchRef.current &&
        !searchRef.current.contains(e.target)
      ) {
        setSearchOpen(false);
      }
    };
    const onEsc = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        setSearchOpen(false);
      }
    };
    const onShortcut = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setSearchOpen(true);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    document.addEventListener("keydown", onShortcut);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
      document.removeEventListener("keydown", onShortcut);
    };
  }, [open, searchOpen]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  const goTo = (path) => {
    setSearchOpen(false);
    setQuery("");
    navigate(path);
  };

  const onSearchKeyDown = (e) => {
    if (!searchOpen) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const pick = results[activeIdx];
      if (pick) {
        e.preventDefault();
        goTo(pick.path);
      }
    }
  };

  const handleLogout = () => {
    logout();
    window.location.href = "https://thexyra.ai/";
  };

  const displayName = user?.name || "User";
  const userRole = user?.role || "user";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const getRoleBadgeClass = (role) => {
    switch (role) {
      case "super_admin":
        return "role-super-admin";
      case "admin":
        return "role-admin";
      default:
        return "role-user";
    }
  };

  const progress = Math.max(0, Math.min(100, Number(setupProgress) || 0));

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          className="nav-icon-btn"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          title="Toggle sidebar"
        >
          <ChevronLeft size={18} />
        </button>

        <div className="topbar-search-wrap" ref={searchRef}>
          <div className={`topbar-search ${searchOpen ? "active" : ""}`}>
            <Search size={14} className="search-icon" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search pages..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={onSearchKeyDown}
              aria-label="Global search"
            />
            <span className="search-hint" aria-hidden>
              {navigator.platform.toLowerCase().includes("mac") ? "⌘K" : "Ctrl+K"}
            </span>
          </div>

          {searchOpen && (
            <div className="search-dropdown" role="listbox">
              {query.trim() === "" ? (
                <div className="search-empty">
                  Type to search pages, modules, and admin tools.
                </div>
              ) : results.length === 0 ? (
                <div className="search-empty">
                  No results for "<strong>{query}</strong>"
                </div>
              ) : (
                <>
                  {results.map((r, i) => (
                    <button
                      key={r.path}
                      type="button"
                      role="option"
                      aria-selected={i === activeIdx}
                      className={`search-item ${i === activeIdx ? "active" : ""}`}
                      onMouseEnter={() => setActiveIdx(i)}
                      onClick={() => goTo(r.path)}
                    >
                      <Search size={14} className="search-item-icon" />
                      <div className="search-item-text">
                        <span className="search-item-label">{r.label}</span>
                        <span className="search-item-path">{r.path}</span>
                      </div>
                      <span className="search-item-group">{r.group}</span>
                      {i === activeIdx && (
                        <CornerDownLeft size={12} className="search-item-enter" />
                      )}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="topbar-right">
        <div
          className="setup-progress-card"
          role="status"
          aria-label={`Setup progress ${progress}%`}
        >
          <div className="sp-text">
            <span className="sp-label">SETUP PROGRESS</span>
            <span className="sp-pct">{progress}%</span>
          </div>
          <div className="sp-bar">
            <div className="sp-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <button
          className="nav-icon-btn ghost"
          aria-label="Console"
          title="Console"
          type="button"
        >
          <Terminal size={18} />
        </button>

        <button
          ref={btnRef}
          className={`profile-btn ${open ? "open" : ""}`}
          onClick={() => setOpen((s) => !s)}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <span className="avatar">{initials}</span>
          <div className="profile-info">
            <span className="profile-name">{displayName}</span>
          </div>
          <ChevronDown size={16} className="chev" />
        </button>

        {open && (
          <div ref={menuRef} className="profile-menu" role="menu">
            <div className="user-info">
              <div className="user-details">
                <span className="user-name">{displayName}</span>
                <span className="user-email">{user?.email}</span>
                <span className={`role-badge ${getRoleBadgeClass(userRole)}`}>
                  <Shield size={12} />
                  {userRole.replace("_", " ")}
                </span>
              </div>
            </div>
            <div className="menu-divider"></div>
            <button className="menu-item" onClick={handleLogout}>
              <LogOut size={16} />
              <span>Logout</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
