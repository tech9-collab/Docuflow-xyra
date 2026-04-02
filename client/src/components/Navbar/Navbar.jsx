// import { useEffect, useRef, useState } from "react";
// import { Menu, User2, LogOut, ChevronDown } from "lucide-react";
// import { useNavigate } from "react-router-dom";
// import "./Navbar.css";
// import { useAuth } from "../../context/AuthContext";

// export default function Navbar({ onToggleSidebar }) {
//     const { user, logout } = useAuth();
//     const navigate = useNavigate();

//     const [open, setOpen] = useState(false);
//     const menuRef = useRef(null);
//     const btnRef = useRef(null);

//     // Close on outside click
//     useEffect(() => {
//         function onDocClick(e) {
//             if (!open) return;
//             if (
//                 menuRef.current &&
//                 !menuRef.current.contains(e.target) &&
//                 btnRef.current &&
//                 !btnRef.current.contains(e.target)
//             ) {
//                 setOpen(false);
//             }
//         }
//         function onEsc(e) {
//             if (e.key === "Escape") setOpen(false);
//         }
//         document.addEventListener("mousedown", onDocClick);
//         document.addEventListener("keydown", onEsc);
//         return () => {
//             document.removeEventListener("mousedown", onDocClick);
//             document.removeEventListener("keydown", onEsc);
//         };
//     }, [open]);

//     const handleLogout = () => {
//         logout();
//         navigate("/login", { replace: true });
//     };

//     const displayName = user?.name || "User";

//     return (
//         <header className="topbar">
//             <button
//                 className="menu-btn"
//                 onClick={onToggleSidebar}
//                 aria-label="Toggle sidebar"
//             >
//                 <Menu size={18} />
//             </button>

//             <div className="topbar-title">Converters</div>

//             <div className="topbar-right">
//                 {/* Profile toggle button */}
//                 <button
//                     ref={btnRef}
//                     className={`profile-btn ${open ? "open" : ""}`}
//                     onClick={() => setOpen((s) => !s)}
//                     aria-haspopup="menu"
//                     aria-expanded={open}
//                 >
//                     <span className="avatar" aria-hidden>
//                         <User2 size={16} />
//                     </span>
//                     <span className="profile-name" title={displayName}>{displayName}</span>
//                     <ChevronDown size={16} className="chev" aria-hidden />
//                 </button>

//                 {/* Dropdown */}
//                 {open && (
//                     <div
//                         ref={menuRef}
//                         className="profile-menu"
//                         role="menu"
//                         aria-label="Profile menu"
//                     >
//                         <button className="menu-item" role="menuitem" onClick={handleLogout}>
//                             <LogOut size={16} />
//                             <span>Logout</span>
//                         </button>
//                     </div>
//                 )}
//             </div>
//         </header>
//     );
// }

import { useEffect, useRef, useState } from "react";
import { Menu, User2, LogOut, ChevronDown, Shield } from "lucide-react";
import { useNavigate } from "react-router-dom";
import "./Navbar.css";
import { useAuth } from "../../context/AuthContext";

export default function Navbar({ onToggleSidebar }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const btnRef = useRef(null);

  // Close on outside click / Esc
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
    navigate("/login", { replace: true });
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

  return (
    <header className="topbar">
      {/* Left: menu button */}
      <button
        className="menu-btn"
        onClick={onToggleSidebar}
        aria-label="Toggle sidebar"
      >
        <Menu size={20} />
      </button>

      {/* Right: profile */}
      <div className="topbar-right">
        <button
          ref={btnRef}
          className={`profile-btn ${open ? "open" : ""}`}
          onClick={() => setOpen((s) => !s)}
        >
          <span className="avatar">{initials}</span>
          <div className="profile-info">
            <span className="profile-name">{displayName}</span>
          </div>
          <ChevronDown size={16} className="chev" />
        </button>

        {open && (
          <div ref={menuRef} className="profile-menu">
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
