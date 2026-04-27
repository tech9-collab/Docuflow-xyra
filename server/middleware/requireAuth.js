// middleware/requireAuth.js
import jwt from "jsonwebtoken";
import { pool } from "../db.js";
import { checkUserPermission, getUserRole } from "../initDatabase.js";

export default async function requireAuth(req, res, next) {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) return res.status(401).json({ message: "Missing token" });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Company admin accounts (registered via /auth/register) are stored in companies table
        if (decoded.type === 'admin') {
            const [compRows] = await pool.query(
                "SELECT id, business_id FROM companies WHERE id = ? LIMIT 1",
                [decoded.id]
            );
            if (compRows.length === 0) {
                return res.status(401).json({ message: "Account not found" });
            }
            req.user = {
                id: decoded.id,
                role: 'admin',
                type: 'admin',
                role_id: null,
                company_id: decoded.id,
                business_id: compRows[0].business_id,
                department_id: null,
            };
            return next();
        }

        // Employee accounts are stored in users table
        const [rows] = await pool.query(
            `SELECT u.id, u.business_id, u.type, u.role_id, u.department_id,
                    r.name as role,
                    c.id as numeric_company_id
             FROM users u
             LEFT JOIN roles r ON u.role_id = r.id
             LEFT JOIN companies c ON u.business_id = c.business_id
             WHERE u.id = ? LIMIT 1`,
            [decoded.id]
        );

        if (rows.length === 0) {
            return res.status(401).json({ message: "User not found" });
        }

        const userRow = rows[0];

        req.user = {
            id: userRow.id,
            role: userRow.type === 'super_admin' ? 'super_admin' : (userRow.role || userRow.type),
            type: userRow.type,
            role_id: userRow.role_id,
            company_id: userRow.numeric_company_id || null,
            business_id: userRow.business_id || null,
            department_id: userRow.department_id
        };

        // Fallback for company_id if join failed but we have business_id
        if (!req.user.company_id && req.user.business_id) {
            const [cRows] = await pool.query("SELECT id FROM companies WHERE business_id = ? LIMIT 1", [req.user.business_id]);
            if (cRows.length) req.user.company_id = cRows[0].id;
        }

        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            console.warn(`[AUTH] Token expired at ${error.expiredAt}`);
        } else {
            console.error("[AUTH] JWT verification error:", error.message);
        }
        return res.status(401).json({ message: "Invalid or expired token" });
    }
}

// Middleware factory for permission-based access control
export function requirePermission(permission) {
    return async (req, res, next) => {
        try {
            if (!req.user || !req.user.id) {
                return res.status(401).json({ message: "Authentication required" });
            }

            const hasPermission = await checkUserPermission(req.user.id, permission);
            if (!hasPermission) {
                return res.status(403).json({ message: "Insufficient permissions" });
            }

            next();
        } catch (error) {
            console.error("Permission check error:", error);
            return res.status(500).json({ message: "Server error" });
        }
    };
}

// Middleware factory for role-based access control
export function requireRole(roleName) {
    return async (req, res, next) => {
        try {
            if (!req.user || !req.user.id) {
                return res.status(401).json({ message: "Authentication required" });
            }

            const userRole = await getUserRole(req.user.id);
            if (!userRole || userRole.name !== roleName) {
                return res.status(403).json({ message: "Insufficient role privileges" });
            }

            next();
        } catch (error) {
            console.error("Role check error:", error);
            return res.status(500).json({ message: "Server error" });
        }
    };
}