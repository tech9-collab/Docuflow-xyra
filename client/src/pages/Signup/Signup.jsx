import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import "./Signup.css";
import { registerUser } from "../../helper/helper";
import { useAuth } from "../../context/AuthContext";

export default function Signup() {
    const navigate = useNavigate();
    const [showPwd, setShowPwd] = useState(false);
    const [form, setForm] = useState({
        name: "",
        email: "",
        password: "",
        phone: "",
        countryCode: "+971", // Default to UAE
        business_name: ""
    });
    const [msg, setMsg] = useState({ type: "", text: "" });
    const [loading, setLoading] = useState(false);

    const { login } = useAuth();

    // Set document title
    React.useEffect(() => {
        document.title = "DocuFlow - Sign Up";
    }, []);

    const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

    const onSubmit = async (e) => {
        e.preventDefault();
        setMsg({ type: "", text: "" });

        if (!form.name || !form.email || !form.password || !form.business_name) {
            return setMsg({ type: "error", text: "Name, email, password and business name are required." });
        }

        if (form.phone && form.phone.length < 7) {
            return setMsg({ type: "error", text: "Phone number must be at least 7 digits." });
        }

        try {
            setLoading(true);
            const { token, user } = await registerUser(form);
            login(token, user);
            setMsg({ type: "success", text: "Account created successfully." });
            navigate("/admin/dashboard", { replace: true });
        } catch (err) {
            setMsg({ type: "error", text: err.message || "Signup failed." });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="signup-page">
            <div className="signup-card">
                <h2 className="title">Join as Employee</h2>
                <p className="subtitle">Create your employee account to access the platform</p>

                {msg.text && (
                    <div className={`alert ${msg.type === "error" ? "error" : "success"}`}>
                        {msg.text}
                    </div>
                )}

                <form className="signup-form" onSubmit={onSubmit} noValidate>
                    <label htmlFor="name">Full name *</label>
                    <input
                        id="name"
                        name="name"
                        type="text"
                        placeholder="Your name"
                        value={form.name}
                        onChange={onChange}
                        required
                    />

                    <label htmlFor="email">Email *</label>
                    <input
                        id="email"
                        name="email"
                        type="email"
                        placeholder="you@example.com"
                        value={form.email}
                        onChange={onChange}
                        required
                    />

                    <label htmlFor="business_name">Business Name *</label>
                    <input
                        id="business_name"
                        name="business_name"
                        type="text"
                        placeholder="Your business name"
                        value={form.business_name}
                        onChange={onChange}
                        required
                    />

                    <div className="form-row">
                        <div className="form-group">
                            <label htmlFor="countryCode">Country Code</label>
                            <select
                                id="countryCode"
                                name="countryCode"
                                value={form.countryCode}
                                onChange={onChange}
                            >
                                <option value="+971">+971 (UAE)</option>
                                <option value="+1">+1 (US/Canada)</option>
                                <option value="+44">+44 (UK)</option>
                                <option value="+91">+91 (India)</option>
                                <option value="+966">+966 (Saudi Arabia)</option>
                                <option value="+974">+974 (Qatar)</option>
                                <option value="+965">+965 (Kuwait)</option>
                                <option value="+973">+973 (Bahrain)</option>
                                <option value="+968">+968 (Oman)</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label htmlFor="phone">Phone Number</label>
                            <input
                                id="phone"
                                name="phone"
                                type="tel"
                                placeholder="50 123 4567"
                                value={form.phone}
                                onChange={onChange}
                            />
                        </div>
                    </div>

                    <label htmlFor="password">Password *</label>
                    <div className="password-field">
                        <input
                            id="password"
                            name="password"
                            type={showPwd ? "text" : "password"}
                            placeholder="Create a password"
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
                        {loading ? "Creating..." : "Create Account"}
                    </button>
                </form>

                <hr className="divider" />

                <div className="switch">
                    Already have an account?{" "}
                    <span className="link-btn" onClick={() => navigate("/login")}>
                        Sign in
                    </span>
                </div>

            </div>
        </div>
    );
}