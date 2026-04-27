import { useEffect, useRef, useState } from "react";
import {
  LogOut,
  ChevronDown,
  Shield,
  ChevronLeft,
  Search,
  Terminal,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import "./Navbar.css";
import { useAuth } from "../../context/AuthContext";

export default function Navbar({ onToggleSidebar, setupProgress = 0 }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const menuRef = useRef(null);
  const btnRef = useRef(null);

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
    };
    const onEsc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const handleLogout = () => {
    logout();
    window.location.href = "https://xyra.tvcbooks.com/";
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

        <div className="topbar-search">
          <Search size={14} className="search-icon" />
          <input
            type="text"
            placeholder="Search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search"
          />
          <span className="search-hint" aria-hidden>⌘</span>
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
