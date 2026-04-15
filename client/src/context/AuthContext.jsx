import { createContext, useContext, useEffect, useState } from "react";
import { jwtDecode } from "jwt-decode";
import { api } from "../helper/helper"; // ✅ use the shared axios instance

const AuthContext = createContext();

/**
 * Clear ALL client-side session artifacts so no stale data persists.
 * Called before every new login/SSO entry and on explicit logout.
 */
const clearSession = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    sessionStorage.clear();
    document.cookie = "token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    delete api.defaults.headers.common.Authorization;
};

/**
 * Returns true when the JWT is structurally valid AND not yet expired.
 */
const isTokenValid = (token) => {
    if (!token) return false;
    try {
        const decoded = jwtDecode(token);
        return decoded.exp * 1000 > Date.now();
    } catch {
        return false;
    }
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [permissions, setPermissions] = useState([]);
    const [loading, setLoading] = useState(true);

    // Function to fetch user profile with permissions.
    // Returns true on success, false on failure.
    const fetchUserProfile = async () => {
        try {
            const response = await api.get('/admin/profile');
            const { user: userProfile, permissions: userPermissions, role } = response.data;

            // Replace user state entirely — never merge with previous user
            setUser({
                ...userProfile,
                role: role?.name || userProfile.role_name
            });
            setPermissions(userPermissions || []);
            return true;
        } catch (error) {
            console.error('Failed to fetch user profile:', error);
            const status = error?.response?.status || error?.status;
            // 401 = invalid/expired token, 404 = user not found in DB
            // Both mean the session is no longer usable
            if (status === 401 || status === 404) {
                clearSession();
                setUser(null);
                setPermissions([]);
            }
            return false;
        }
    };

    // helper to read a cookie
    const getCookie = (name) => {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    };

    // boot: load token+user and set axios header
    useEffect(() => {
        const initAuth = async () => {
            let token = localStorage.getItem("token");

            // If no token in localStorage, check the cookie (for direct backend redirects)
            if (!token) {
                const cookieToken = getCookie("token");
                if (cookieToken) {
                    token = cookieToken;
                }
            }

            // Validate token before using it
            if (!isTokenValid(token)) {
                clearSession();
                setLoading(false);
                return;
            }

            try {
                api.defaults.headers.common.Authorization = `Bearer ${token}`;

                // Always fetch fresh profile from backend — never rely on cached state
                const ok = await fetchUserProfile();
                if (!ok) {
                    // Profile fetch failed (user not found / token rejected)
                    clearSession();
                }
            } catch (error) {
                console.error('Auth initialization error:', error);
                clearSession();
                setUser(null);
                setPermissions([]);
            }

            setLoading(false);
        };

        initAuth();
    }, []);

    const login = async (token, userInfo) => {
        // Clear any previous session data first
        clearSession();
        setUser(null);
        setPermissions([]);

        localStorage.setItem("token", token);
        localStorage.setItem("user", JSON.stringify(userInfo));
        api.defaults.headers.common.Authorization = `Bearer ${token}`;

        // Fetch fresh profile from backend — this is the authoritative source
        const ok = await fetchUserProfile();

        // Only fall back to token/login payload if profile fetch failed
        if (!ok) {
            const decoded = jwtDecode(token);
            setUser({ ...decoded, ...userInfo });
        }
    };

    const logout = () => {
        clearSession();
        setUser(null);
        setPermissions([]);
    };

    // Helper function to check if user has specific permission
    const hasPermission = (permission) => {
        if (!user) return false;
        // Super admin and company admin have all permissions
        if (user.role === 'super_admin' || user.type === 'admin') return true;
        // Check for wildcard permission
        if (permissions.includes('all')) return true;
        // Regular user has specific permissions
        return permissions.includes(permission);
    };

    // Helper function to check if user has specific role
    const hasRole = (role) => {
        return user?.role === role;
    };

    // Helper function to check if user is super admin or company admin
    const isSuperAdmin = () => {
        return user?.role === 'super_admin' || user?.type === 'super_admin' || user?.type === 'admin' || Number(user?.role_id) === 1;
    };

    // Helper function to check if user is a department admin
    const isDepartmentAdmin = () => {
        // A user is a department admin if they have a department_id and their role_name is 'admin'
        return user && user.department_id && (user.role_name === 'admin' || user.role === 'admin');
    };

    // Helper function to check if user is a company admin
    const isCompanyAdmin = () => {
        // A user is a company admin if they have a company_id and their role_name is 'admin'
        return user && user.company_id && (user.role_name === 'admin' || user.role === 'admin');
    };

    // Helper function to check if user is a business user (has business_name, not super/dept admin)
    const isBusinessUser = () => {
        if (!user) return false;
        if (isSuperAdmin() || isDepartmentAdmin()) return false;
        return !!(user.business_name && user.business_name.trim());
    };

    return (
        <AuthContext.Provider value={{
            user,
            permissions,
            login,
            logout,
            hasPermission,
            hasRole,
            isSuperAdmin,
            isDepartmentAdmin,
            isCompanyAdmin,
            isBusinessUser,
            isAuthenticated: !!user,
            refreshProfile: fetchUserProfile,
            clearSession,
            isTokenValid
        }}>
            {!loading && children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
