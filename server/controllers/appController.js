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

        // Existing?
        const [exists] = await pool.query(
            "SELECT id FROM users WHERE email = ? LIMIT 1",
            [emailNorm]
        );
        if (exists.length) {
            return res.status(409).json({ message: "Email already registered" });
        }

        // Hash + insert (forcing role_id: 1 for super_admin users as requested)
        const passwordHash = await bcrypt.hash(passwordNorm, 12);

        // Start transaction for consistency
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            // 1. Create User
            const [userResult] = await connection.query(
                `INSERT INTO users (name, email, password, phone, country_code, role_id, business_name, company_name, type)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [nameNorm, emailNorm, passwordHash, phoneNorm, countryNorm, 1, businessNameNorm, businessNameNorm, 'super_admin']
            );
            const userId = userResult.insertId;

            // 2. Create Company for the Super Admin
            const [companyResult] = await connection.query(
                `INSERT INTO companies (name, type, user_id, description) VALUES (?, ?, ?, ?)`,
                [businessNameNorm, 'Mainland', userId, `Created during registration for ${nameNorm}`]
            );
            const companyId = companyResult.insertId;

            // 3. Link Company back to User (company_id field in users)
            await connection.query(
                `UPDATE users SET company_id = ? WHERE id = ?`,
                [companyId, userId]
            );

            await connection.commit();

            const userRes = {
                id: userId,
                name: nameNorm,
                email: emailNorm,
                phone: phoneNorm,
                countryCode: countryNorm || "",
                business_name: businessNameNorm || "",
                role_id: 1,
                company_id: companyId,
                role: "super_admin",
                type: "super_admin"
            };
            const token = signToken({
                id: userId,
                email: emailNorm,
                role_id: 1,
                company_id: companyId,
                type: "super_admin",
            });

            const redirectUrl = "/admin/dashboard";

            res.cookie('token', token, {
                httpOnly: false,
                maxAge: 24 * 60 * 60 * 1000
            });

            const frontendUrl = process.env.FRONTEND_URL || "";
            return res.redirect(`${frontendUrl}${redirectUrl}`);
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (err) {
        console.error("registerUser error:", err);
        const frontendUrl = process.env.FRONTEND_URL || "";
        return res.redirect(`${frontendUrl}/signup?error=server_error`);
    }
};

// POST /login
export const loginUser = async (req, res) => {
    try {
        const frontendUrl = process.env.FRONTEND_URL || "";
        const { email, password } = req.body || {};

        if (!email || typeof email !== "string" || !password || typeof password !== "string") {
            return res.redirect(`${frontendUrl}/login?error=invalid_credentials`);
        }

        const emailNorm = email.trim().toLowerCase();
        const passwordNorm = password.trim();

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
          u.company_id,
          r.name AS role_name
       FROM users u
       LEFT JOIN roles r ON u.role_id = r.id
       WHERE LOWER(TRIM(u.email)) = ?
       LIMIT 1`,
            [emailNorm]
        );

        if (!rows.length) {
            return res.redirect(`${frontendUrl}/login?error=invalid_credentials`);
        }

        const user = rows[0];

        const isPasswordValid = await bcrypt.compare(passwordNorm, user.password);
        if (!isPasswordValid) {
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

        // Set JWT token as a cookie for direct redirection support
        res.cookie('token', token, {
            httpOnly: false, // Accessible by frontend JS (needed for your current Auth logic)
            secure: false,   // Set to true in production with HTTPS
            maxAge: 24 * 60 * 60 * 1000 // 1 day
        });

        // Perform direct backend redirection as requested
        return res.redirect(`${frontendUrl}${redirectUrl}`);
    } catch (err) {
        console.error("loginUser error:", err);
        const errorType = err.message === "Invalid credentials" ? "invalid_credentials" : "server_error";
        return res.redirect(`${frontendUrl}/login?error=${errorType}`);
    }
};
