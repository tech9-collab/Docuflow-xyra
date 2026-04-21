import logo from "../../assets/logo.png";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Landmark, // Bank (bank statements)
  FileSpreadsheet, // Invoices (tabular docs)
  Receipt, // Bills / receipts
  IdCard, // Emirates ID
  BookUser, // Passport
  PlaneTakeoff, // Visa / travel
  BadgeCheck, // Trade license / certified
  Shield, // Admin / roles
  BarChart3, // Dashboard
  Users, // User management
  Building2, // Department management
  FolderKanban, // Projects (new icon)
  // New icons for project modules
  FileBarChart, // Financial Overview
  FileText, // VAT Filing
  FileSpreadsheet as FileSpreadsheet2, // CT Filing
  FileUser, // Registration
  FileSearch, // Audit Report
  LogOut, // Logout
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import "./Sidebar.css";

function NavItem({ to, icon, text, collapsed }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
    >
      <span className="nav-icon">{icon}</span>
      {!collapsed && <span className="nav-text">{text}</span>}
    </NavLink>
  );
}


export default function Sidebar({ collapsed }) {
  const { logout, hasPermission, isSuperAdmin, isDepartmentAdmin, isBusinessUser, user } = useAuth();
  const isAdmin = () => user?.type === 'admin';
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="sidebar-brand">
        <img
          src={logo}
          alt="XYRA"
          className="brand-logo"
        />
      </div>

      <div className="nav-group">
        {/* Super Admin section */}
        {isSuperAdmin() && !isAdmin() && (
          <>
            {!collapsed && <div className="nav-title">Administration</div>}
            <NavItem
              to="/admin/dashboard"
              icon={<BarChart3 size={18} />}
              text="Dashboard"
              collapsed={collapsed}
            />
            <NavItem
              to="/admin/departments"
              icon={<Building2 size={18} />}
              text="Departments"
              collapsed={collapsed}
            />
            <NavItem
              to="/admin/roles-permissions"
              icon={<Shield size={18} />}
              text="Roles & Permissions"
              collapsed={collapsed}
            />
            <NavItem
              to="/admin/employees"
              icon={<Users size={18} />}
              text="User Management"
              collapsed={collapsed}
            />
          </>
        )}

        {/* Company Admin section (registered via signup, type='admin') */}
        {isAdmin() && (
          <>
            {!collapsed && <div className="nav-title">Administration</div>}
            <NavItem
              to="/admin/dashboard"
              icon={<BarChart3 size={18} />}
              text="Dashboard"
              collapsed={collapsed}
            />
            <NavItem
              to="/admin/departments"
              icon={<Building2 size={18} />}
              text="Departments"
              collapsed={collapsed}
            />
            <NavItem
              to="/admin/roles-permissions"
              icon={<Shield size={18} />}
              text="Roles & Permissions"
              collapsed={collapsed}
            />
            <NavItem
              to="/admin/employees"
              icon={<Users size={18} />}
              text="User Management"
              collapsed={collapsed}
            />
          </>
        )}

        {/* Business User Admin section */}
        {isBusinessUser() && !isAdmin() && (
          <>
            {!collapsed && <div className="nav-title">Administration</div>}
            <NavItem
              to="/admin/dashboard"
              icon={<BarChart3 size={18} />}
              text="Dashboard"
              collapsed={collapsed}
            />
            <NavItem
              to="/admin/departments"
              icon={<Building2 size={18} />}
              text="Departments"
              collapsed={collapsed}
            />
            <NavItem
              to="/admin/roles-permissions"
              icon={<Shield size={18} />}
              text="Roles & Permissions"
              collapsed={collapsed}
            />
            <NavItem
              to="/admin/employees"
              icon={<Users size={18} />}
              text="User Management"
              collapsed={collapsed}
            />
          </>
        )}

        {/* Department Admin section */}
        {isDepartmentAdmin() && (
          <>
            {!collapsed && <div className="nav-title">Department Admin</div>}
            {hasPermission("dashboard.read") && (
              <NavItem
                to={`/admin/department/${user.department_id}/dashboard`}
                icon={<BarChart3 size={18} />}
                text={`${user.department_name || "Department"} Dashboard`}
                collapsed={collapsed}
              />
            )}
            {hasPermission("roles.read") && (
              <NavItem
                to="/admin/roles-permissions"
                icon={<Shield size={18} />}
                text="Roles & Permissions"
                collapsed={collapsed}
              />
            )}
            {hasPermission("employees.read") && (
              <NavItem
                to={`/admin/department/${user.department_id}/users`}
                icon={<Users size={18} />}
                text="Department Users"
                collapsed={collapsed}
              />
            )}
          </>
        )}

        {/* User Dashboard section */}
        {!isSuperAdmin() && !isDepartmentAdmin() && !isBusinessUser() && (
          <>
            {!collapsed && <div className="nav-title">Dashboard</div>}
            {hasPermission("dashboard.read") && (
              <NavItem
                to="/user/dashboard"
                icon={<BarChart3 size={18} />}
                text="My Dashboard"
                collapsed={collapsed}
              />
            )}
          </>
        )}

        {/* Customers section - only show if user has customer permissions */}
        {hasPermission("customers.read") && (
          <>
            {!collapsed && <div className="nav-title">Customers</div>}
            <NavItem
              to="/customers"
              icon={<Users size={18} />}
              text="Customers"
              collapsed={collapsed}
            />
          </>
        )}

        {/* Departments section - only show if user has department permissions */}
        {(hasPermission("projects.vat_filing") || hasPermission("projects.ct_filing")) && (
          <>
            {!collapsed && <div className="nav-title">Departments</div>}
            {hasPermission("projects.vat_filing") && (
              <NavItem
                to="/projects/vat-filing"
                icon={<FileText size={18} />}
                text="VAT Filing"
                collapsed={collapsed}
              />
            )}
            {/* {hasPermission("projects.ct_filing") && (
              <NavItem
                to="/projects/ct-filing"
                icon={<FileSpreadsheet2 size={18} />}
                text="CT Filing"
                collapsed={collapsed}
              />
            )} */}
          </>
        )}

        {/* Converts section */}
        {!collapsed && <div className="nav-title">Converts</div>}

        {hasPermission("converts.bank_statements") && (
          <NavItem
            to="/converts/bank-statement"
            icon={<Landmark size={18} />}
            text="Bank Statements"
            collapsed={collapsed}
          />
        )}

        {hasPermission("converts.invoices") && (
          <NavItem
            to="/converts/invoices"
            icon={<FileSpreadsheet size={18} />}
            text="Invoices & Bills"
            collapsed={collapsed}
          />
        )}

        {!isAdmin() && hasPermission("converts.emirates_id") && (
          <NavItem
            to="/converts/emiratesid"
            icon={<IdCard size={18} />}
            text="Emirates ID"
            collapsed={collapsed}
          />
        )}

        {!isAdmin() && hasPermission("converts.passport") && (
          <NavItem
            to="/converts/passport"
            icon={<BookUser size={18} />}
            text="Passport"
            collapsed={collapsed}
          />
        )}

        {!isAdmin() && hasPermission("converts.visa") && (
          <NavItem
            to="/converts/visa"
            icon={<PlaneTakeoff size={18} />}
            text="Visa"
            collapsed={collapsed}
          />
        )}

        {!isAdmin() && hasPermission("converts.trade_license") && (
          <NavItem
            to="/converts/tradelicense"
            icon={<BadgeCheck size={18} />}
            text="Trade License"
            collapsed={collapsed}
          />
        )}
      </div>

      <div className="sidebar-footer">
        <button className="logout-btn" onClick={handleLogout}>
          <LogOut size={18} />
          {!collapsed && <span className="nav-text">Sign Out</span>}
        </button>
      </div>
    </aside>
  );
}