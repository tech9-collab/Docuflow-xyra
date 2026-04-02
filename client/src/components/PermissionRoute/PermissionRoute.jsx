import { useAuth } from '../../context/AuthContext';
import { Navigate } from 'react-router-dom';
import { Shield } from 'lucide-react';

export function PermissionRoute({ permission, children, fallback = null }) {
    const { hasPermission, user } = useAuth();

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    if (!hasPermission(permission)) {
        return fallback || (
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '60vh',
                textAlign: 'center',
                color: '#64748b'
            }}>
                <Shield size={64} />
                <h2 style={{ margin: '16px 0 8px', color: '#0f172a' }}>Access Denied</h2>
                <p>You don't have permission to access this feature.</p>
            </div>
        );
    }

    return children;
}

export function RoleRoute({ role, children, fallback = null }) {
    const { hasRole, user } = useAuth();

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    if (!hasRole(role)) {
        return fallback || (
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '60vh',
                textAlign: 'center',
                color: '#64748b'
            }}>
                <Shield size={64} />
                <h2 style={{ margin: '16px 0 8px', color: '#0f172a' }}>Access Denied</h2>
                <p>You don't have the required role to access this feature.</p>
            </div>
        );
    }

    return children;
}

export function SuperAdminRoute({ children, fallback = null }) {
    const { isSuperAdmin, user } = useAuth();

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    if (!isSuperAdmin()) {
        return fallback || (
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '60vh',
                textAlign: 'center',
                color: '#64748b'
            }}>
                <Shield size={64} />
                <h2 style={{ margin: '16px 0 8px', color: '#0f172a' }}>Access Denied</h2>
                <p>Super Admin access required.</p>
            </div>
        );
    }

    return children;
}

export function AdminRoute({ children, fallback = null }) {
    const { isSuperAdmin, isDepartmentAdmin, isBusinessUser, user } = useAuth();

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    // Allow super admins, department admins, and business users (business owners are admins of their company)
    if (!isSuperAdmin() && !isDepartmentAdmin() && !isBusinessUser() && user.role !== 'admin') {
        return fallback || (
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '60vh',
                textAlign: 'center',
                color: '#64748b'
            }}>
                <Shield size={64} />
                <h2 style={{ margin: '16px 0 8px', color: '#0f172a' }}>Access Denied</h2>
                <p>Administrator access required.</p>
            </div>
        );
    }

    return children;
}