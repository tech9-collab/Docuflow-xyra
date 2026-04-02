import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import "./Login.css";
import { API_BASE } from "../../helper/helper";

export default function Login() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [showPwd, setShowPwd] = useState(false);

    // Check for errors in the URL (sent by backend on redirect fail)
    const errorMsg = searchParams.get("error");

    // Set document title
    React.useEffect(() => {
        document.title = "Xyra Books - Login";
    }, []);

    return (
        <div className="login-page">
            <div className="login-card">

                <h2 className="title">Welcome back</h2>

                {errorMsg && (
                    <div className="alert error">
                        {errorMsg === "invalid_credentials" ? "Invalid credentials. Please try again." : "A system error occurred."}
                    </div>
                )}

                <form
                    className="login-form"
                    action={`${API_BASE}/auth/login`}
                    method="POST"
                >
                    <label htmlFor="email">Email</label>
                    <input
                        id="email"
                        name="email"
                        type="email"
                        placeholder="you@example.com"
                        required
                    />

                    <label htmlFor="password">Password</label>
                    <div className="password-field">
                        <input
                            id="password"
                            name="password"
                            type={showPwd ? "text" : "password"}
                            placeholder="••••••••"
                            required
                        />
                        <button
                            type="button"
                            className="toggle"
                            onClick={() => setShowPwd((s) => !s)}
                        >
                            {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>

                    <button className="btn-primary" type="submit">
                        Sign In
                    </button>
                </form>

                <hr className="divider" />

                <div className="switch">
                    Don't have an account?{" "}
                    <span className="link-btn" onClick={() => navigate("/signup")}>
                        Create an account
                    </span>
                </div>

            </div>
        </div>
    );
}