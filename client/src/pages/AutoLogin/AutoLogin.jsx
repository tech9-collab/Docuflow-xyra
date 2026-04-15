import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { jwtDecode } from "jwt-decode";
import { useAuth } from "../../context/AuthContext";

/**
 * AutoLogin — called by XYRA backend with ?token=<jwt>&redirect=/admin/dashboard
 * Destroys any previous session, validates the incoming token, calls
 * AuthContext.login() (which fetches fresh profile), then redirects.
 */
export default function AutoLogin() {
    const navigate = useNavigate();
    const { login, clearSession } = useAuth();

    useEffect(() => {
        const run = async () => {
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

                // Destroy any previous session before setting up the new one
                clearSession();

                // Use AuthContext.login() so profile is fetched & state is set
                // before we navigate to the dashboard
                await login(token, decoded);

                navigate(redirectTo, { replace: true });
            } catch (e) {
                navigate("/login?error=invalid_token", { replace: true });
            }
        };

        run();
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
