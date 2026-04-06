import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { jwtDecode } from "jwt-decode";
import { api } from "../../helper/helper";

/**
 * AutoLogin — called by XYRA backend with ?token=<jwt>&redirect=/admin/dashboard
 * Stores token + user in localStorage (same keys the app uses everywhere),
 * sets the axios Authorization header, then redirects to the dashboard.
 */
export default function AutoLogin() {
    const navigate = useNavigate();

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const token = params.get("token");
        const redirectTo = params.get("redirect") || "/admin/dashboard";

        if (!token) {
            navigate("/login", { replace: true });
            return;
        }

        try {
            const decoded = jwtDecode(token);

            // Check token is not expired
            if (decoded.exp && decoded.exp * 1000 < Date.now()) {
                navigate("/login?error=session_expired", { replace: true });
                return;
            }

            // Store exactly the same way AuthContext.login() does
            localStorage.setItem("token", token);
            localStorage.setItem("user", JSON.stringify(decoded));

            // Set axios header so any immediate API calls work
            api.defaults.headers.common.Authorization = `Bearer ${token}`;

            navigate(redirectTo, { replace: true });
        } catch (e) {
            navigate("/login?error=invalid_token", { replace: true });
        }
    }, []);

    return (
        <div style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#0E0C1A",
            fontFamily: "Inter, sans-serif",
        }}>
            <div style={{
                width: 48, height: 48,
                border: "3px solid rgba(124,92,255,0.2)",
                borderTopColor: "#7C5CFF",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
                marginBottom: 16,
            }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <p style={{ fontSize: "0.95rem", color: "rgba(255,255,255,0.5)" }}>
                Signing you in...
            </p>
        </div>
    );
}
