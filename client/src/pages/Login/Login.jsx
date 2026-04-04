import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import "./Login.css";
import { loginUser } from "../../helper/helper";
import { useAuth } from "../../context/AuthContext";

export default function Login() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [showPwd, setShowPwd] = useState(false);
    const [form, setForm] = useState({ email: "", password: "" });
    const [msg, setMsg] = useState({ type: "", text: "" });
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();

    const errorMsg = searchParams.get("error");

    React.useEffect(() => {
        document.title = "Xyra Books - Login";
    }, []);

    const onChange = (e) => {
        setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const onSubmit = async (e) => {
        e.preventDefault();
        setMsg({ type: "", text: "" });

        if (!form.email || !form.password) {
            setMsg({ type: "error", text: "Email and password are required." });
            return;
        }

        try {
            setLoading(true);
            const { token, user, redirectUrl } = await loginUser(form);
            await login(token, user);
            navigate(redirectUrl || "/", { replace: true });
        } catch (err) {
            setMsg({
                type: "error",
                text: err.message || "Unable to sign in.",
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-page">
            <div className="login-card">
                <h2 className="title">Welcome back</h2>

                {(msg.text || errorMsg) && (
                    <div className="alert error">
                        {msg.text ||
                            (errorMsg === "invalid_credentials"
                                ? "Invalid credentials. Please try again."
                                : "A system error occurred.")}
                    </div>
                )}

                <form className="login-form" onSubmit={onSubmit} noValidate>
                    <label htmlFor="email">Email</label>
                    <input
                        id="email"
                        name="email"
                        type="email"
                        placeholder="you@example.com"
                        value={form.email}
                        onChange={onChange}
                        required
                    />

                    <label htmlFor="password">Password</label>
                    <div className="password-field">
                        <input
                            id="password"
                            name="password"
                            type={showPwd ? "text" : "password"}
                            placeholder="Password"
                            value={form.password}
                            onChange={onChange}
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

                    <button className="btn-primary" type="submit" disabled={loading}>
                        {loading ? "Signing In..." : "Sign In"}
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
