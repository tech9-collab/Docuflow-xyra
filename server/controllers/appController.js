// controllers/appController.js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db.js";

/* ===== Helpers ===== */
function signToken(payload) {
    return jwt.sign(
        payload,
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES || "1d" }
    );
}

function isEmail(str) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}

function wantsJson(req) {
    const accept = req.headers.accept || "";
    const contentType = req.headers["content-type"] || "";
    return accept.includes("application/json") || contentType.includes("application/json");
}

function buildAuthPayload(user, token, redirectUrl) {
    const finalRole =
        user.type === "super_admin"
            ? "super_admin"
            : (user.role_name || "user").toLowerCase();

    return {
        token,
        redirectUrl,
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            countryCode: user.country_code || "",
            business_name: user.business_name || "",
            role_id: user.role_id,
            company_id: user.company_id,
            role: finalRole,
            role_name: user.role_name || finalRole,
            type: user.type,
        },
    };
}

/* ===== Controllers ===== */

// POST /register
export const registerUser = async (req, res) => {
    try {
        const { name, email, password, phone, countryCode, business_name } = req.body || {};

        // Normalize inputs
        const nameNorm = typeof name === "string" ? name.trim() : "";
        const emailNorm = typeof email === "string" ? email.trim().toLowerCase() : "";
        const passwordNorm = typeof password === "string" ? password.trim() : "";
        const phoneNorm = typeof phone === "string" ? phone.trim() : null;
        const countryNorm = typeof countryCode === "string" ? countryCode.trim() : null;
        const businessNameNorm = typeof business_name === "string" ? business_name.trim() : "";

        // Basic validation
        if (!nameNorm || nameNorm.length < 2) {
            return res.status(422).json({ message: "Name is required (2+ chars)" });
        }
        if (!emailNorm || !isEmail(emailNorm)) {
            return res.status(422).json({ message: "Valid email is required" });
        }
        if (!passwordNorm || passwordNorm.length < 6) {
            return res.status(422).json({ message: "Password must be 6+ characters" });
        }
        if (phoneNorm && phoneNorm.length < 7) {
            return res.status(422).json({ message: "Phone number must be at least 7 digits" });
        }
        if (!businessNameNorm || businessNameNorm.length < 2) {
            return res.status(422).json({ message: "business_name is required (2+ chars)" });
        }

        // Check email uniqueness in companies table
        const [exists] = await pool.query(
            "SELECT id FROM companies WHERE email = ? LIMIT 1",
            [emailNorm]
        );
        if (exists.length) {
            return res.status(409).json({ message: "Email already registered" });
        }

        const passwordHash = await bcrypt.hash(passwordNorm, 12);

        // Save admin account only in companies table
        const [companyResult] = await pool.query(
            `INSERT INTO companies (business_name, email, password, contact_name, phone, country_code, type, description)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [businessNameNorm, emailNorm, passwordHash, nameNorm, phoneNorm, countryNorm, 'admin',
                `Registered by ${nameNorm}`]
        );
        const companyId = companyResult.insertId;

        // Auto-generate business_id using the company's ID (e.g. BIZ-00005)
        const businessId = `BIZ-${String(companyId).padStart(5, '0')}`;
        await pool.query("UPDATE companies SET business_id = ? WHERE id = ?", [businessId, companyId]);

        // Seed default departments for the new company
        const defaultDepts = ['Audit', 'Bookkeeping', 'Accounts', 'Corporate Tax', 'Default', 'Invoice'];
        for (const deptName of defaultDepts) {
            await pool.query(
                "INSERT INTO departments (name, company_id) VALUES (?, ?)",
                [deptName, companyId]
            );
        }

        const token = signToken({
            id: companyId,
            email: emailNorm,
            company_id: companyId,
            type: "admin",
        });

        const redirectUrl = "/admin/dashboard";

        res.cookie('token', token, {
            httpOnly: false,
            maxAge: 24 * 60 * 60 * 1000
        });

        const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
        const payload = buildAuthPayload({
            id: companyId,
            name: nameNorm,
            email: emailNorm,
            phone: phoneNorm,
            country_code: countryNorm || "",
            business_name: businessNameNorm || "",
            role_id: null,
            company_id: companyId,
            role_name: "admin",
            type: "admin",
        }, token, redirectUrl);

        if (wantsJson(req)) {
            return res.status(201).json(payload);
        }

        return res.redirect(`${frontendUrl}${redirectUrl}`);
    } catch (err) {
        console.error("registerUser error:", err);
        const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
        if (wantsJson(req)) {
            return res.status(500).json({ message: err.message || "Server error during registration" });
        }
        return res.redirect(`${frontendUrl}/signup?error=server_error`);
    }
};

// POST /login
export const loginUser = async (req, res) => {
    try {
        const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
        const { email, password } = req.body || {};

        if (!email || typeof email !== "string" || !password || typeof password !== "string") {
            if (wantsJson(req)) {
                return res.status(401).json({ message: "Invalid credentials" });
            }
            return res.redirect(`${frontendUrl}/login?error=invalid_credentials`);
        }

        const emailNorm = email.trim().toLowerCase();
        const passwordNorm = password.trim();

        // Check companies table first (admin accounts registered via /auth/register)
        const [companyRows] = await pool.query(
            `SELECT id, business_name, email, password, contact_name, phone, country_code
             FROM companies WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
            [emailNorm]
        );

        if (companyRows.length) {
            const company = companyRows[0];
            const isPasswordValid = await bcrypt.compare(passwordNorm, company.password || "");
            if (!isPasswordValid) {
                if (wantsJson(req)) {
                    return res.status(401).json({ message: "Invalid credentials" });
                }
                return res.redirect(`${frontendUrl}/login?error=invalid_credentials`);
            }

            const token = signToken({
                id: company.id,
                email: company.email,
                company_id: company.id,
                type: "admin",
            });

            res.cookie('token', token, { httpOnly: false, maxAge: 24 * 60 * 60 * 1000 });

            const payload = buildAuthPayload({
                id: company.id,
                name: company.contact_name || company.business_name,
                email: company.email,
                phone: company.phone,
                country_code: company.country_code || "",
                business_name: company.business_name,
                role_id: null,
                company_id: company.id,
                role_name: "admin",
                type: "admin",
            }, token, "/admin/dashboard");

            if (wantsJson(req)) return res.status(200).json(payload);
            return res.redirect(`${frontendUrl}/admin/dashboard`);
        }

        // Fall back to users table (employees)
        const [rows] = await pool.query(
            `SELECT
          u.id,
          u.name,
          u.email,
          u.password,
          u.phone,
          u.country_code,
          u.business_name,
          u.type,
          u.role_id,
          u.business_id AS company_id,
          r.name AS role_name
       FROM users u
       LEFT JOIN roles r ON u.role_id = r.id
       WHERE LOWER(TRIM(u.email)) = ?
       LIMIT 1`,
            [emailNorm]
        );

        if (!rows.length) {
            if (wantsJson(req)) {
                return res.status(401).json({ message: "Invalid credentials" });
            }
            return res.redirect(`${frontendUrl}/login?error=invalid_credentials`);
        }

        const user = rows[0];

        const isPasswordValid = await bcrypt.compare(passwordNorm, user.password);
        if (!isPasswordValid) {
            if (wantsJson(req)) {
                return res.status(401).json({ message: "Invalid credentials" });
            }
            return res.redirect(`${frontendUrl}/login?error=invalid_credentials`);
        }

        const token = signToken({
            id: user.id,
            email: user.email,
            role_id: user.role_id,
            company_id: user.company_id,
            type: user.type,
        });

        const finalRole =
            user.type === "super_admin"
                ? "super_admin"
                : (user.role_name || "user").toLowerCase();

        let redirectUrl = "/dashboard";

        if (user.type === "super_admin") {
            redirectUrl = "/admin/dashboard";
        } else if (finalRole === "admin") {
            redirectUrl = "/admin/dashboard";
        }

        res.cookie('token', token, {
            httpOnly: false,
            maxAge: 24 * 60 * 60 * 1000
        });

        if (wantsJson(req)) {
            return res.status(200).json(buildAuthPayload(user, token, redirectUrl));
        }

        return res.redirect(`${frontendUrl}${redirectUrl}`);
    } catch (err) {
        console.error("loginUser error:", err);
        const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
        const errorType = err.message === "Invalid credentials" ? "invalid_credentials" : "server_error";
        if (wantsJson(req)) {
            const statusCode = errorType === "invalid_credentials" ? 401 : 500;
            return res.status(statusCode).json({
                message: errorType === "invalid_credentials" ? "Invalid credentials" : "Server error",
            });
        }
        return res.redirect(`${frontendUrl}/login?error=${errorType}`);
    }
};

// POST /login-api (JSON response for API testing)
export const loginUserForApi = async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password) {
            return res.status(400).json({ message: "Email and password required" });
        }

        const emailNorm = email.trim().toLowerCase();
        const [rows] = await pool.query(
            `SELECT u.*, r.name as role_name 
             FROM users u 
             LEFT JOIN roles r ON u.role_id = r.id 
             WHERE LOWER(TRIM(u.email)) = ? 
             LIMIT 1`,
            [emailNorm]
        );

        if (!rows.length) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const user = rows[0];
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const token = jwt.sign(
            {
                id: user.id,
                email: user.email,
                role_id: user.role_id,
                company_id: user.company_id,
                type: user.type,
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES || "1d" }
        );

        res.json({
            message: "Login successful",
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.type === "super_admin" ? "super_admin" : (user.role_name || "user")
            }
        });
    } catch (err) {
        console.error("API login error:", err);
        res.status(500).json({ message: "Server error" });
    }
};
