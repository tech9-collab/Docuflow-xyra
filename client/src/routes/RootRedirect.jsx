// src/routes/RootRedirect.jsx
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function RootRedirect() {
    const { user, isSuperAdmin, isDepartmentAdmin, isBusinessUser } = useAuth();

    // Not logged in → send to login
    if (!user) return <Navigate to="/login" replace />;

    // Super admin → system dashboard
    if (isSuperAdmin()) return <Navigate to="/admin/dashboard" replace />;

    // Department admin → their department dashboard
    if (isDepartmentAdmin()) {
        const deptId = user.department_id;
        return <Navigate to={`/admin/department/${deptId}/dashboard`} replace />;
    }

    // Business user → admin dashboard (scoped to their business)
    if (isBusinessUser()) return <Navigate to="/admin/dashboard" replace />;

    // Normal user → user dashboard
    return <Navigate to="/user/dashboard" replace />;
}
