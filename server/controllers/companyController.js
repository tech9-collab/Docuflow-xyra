// server/controllers/companyController.js
import { pool } from "../db.js";

// Get all companies (Super Admin sees all, Others see assigned)
export const getUserCompanies = async (req, res) => {
    try {
        const userRole = req.user.role;
        const requesterCompanyId = req.user.company_id;

        let query;
        let params = [];

        if (userRole === 'super_admin') {
            query = "SELECT id, business_name, business_id, type, description, department_id, user_id, created_at FROM companies ORDER BY created_at DESC";
        } else {
            if (!requesterCompanyId) return res.json({ companies: [] });
            query = "SELECT id, business_name, business_id, type, description, department_id, user_id, created_at FROM companies WHERE id = ? ORDER BY created_at DESC";
            params = [requesterCompanyId];
        }

        const [companies] = await pool.query(query, params);
        res.json({ companies });
    } catch (error) {
        console.error("Get companies error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

export const getCompanyById = async (req, res) => {
    try {
        const userRole = req.user.role;
        const requesterCompanyId = req.user.company_id;
        const { companyId } = req.params;

        if (userRole !== 'super_admin' && parseInt(companyId) !== parseInt(requesterCompanyId)) {
            return res.status(403).json({ message: "Access denied" });
        }

        const [companies] = await pool.query(
            "SELECT id, business_name, business_id, type, description, department_id, user_id, created_at FROM companies WHERE id = ? LIMIT 1",
            [companyId]
        );

        if (companies.length === 0) {
            return res.status(404).json({ message: "Company not found" });
        }

        res.json({ company: companies[0] });
    } catch (error) {
        console.error("Get company error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Create a new company
export const createCompany = async (req, res) => {
    try {
        const userId = req.user.id;
        const { business_name, business_id, type, description } = req.body;

        // Validate input
        if (!business_name || business_name.trim().length === 0) {
            return res.status(422).json({ message: "Business name is required" });
        }

        // Get user's department ID
        const [user] = await pool.query(
            "SELECT department_id FROM users WHERE id = ? LIMIT 1",
            [userId]
        );

        const departmentId = user.length > 0 ? user[0].department_id : null;

        // Check if company with same business_name already exists
        const [existing] = await pool.query(
            "SELECT id FROM companies WHERE business_name = ? LIMIT 1",
            [business_name.trim()]
        );

        if (existing.length > 0) {
            return res.status(409).json({ message: "Company with this name already exists" });
        }

        // Insert new company
        const [result] = await pool.query(
            "INSERT INTO companies (user_id, department_id, business_name, business_id, type, description) VALUES (?, ?, ?, ?, ?, ?)",
            [userId, departmentId, business_name.trim(), business_id || null, type || 'admin', description || null]
        );

        const companyId = result.insertId;

        // Return the created company
        const [companies] = await pool.query(
            "SELECT id, business_name, business_id, type, description, department_id, created_at FROM companies WHERE id = ?",
            [companyId]
        );

        res.status(201).json({
            message: "Company created successfully",
            company: companies[0]
        });
    } catch (error) {
        console.error("Create company error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Update a company
export const updateCompany = async (req, res) => {
    try {
        const userRole = req.user.role;
        const requesterCompanyId = req.user.company_id;
        const { companyId } = req.params;
        const { business_name, business_id, type, description } = req.body;

        if (!business_name || business_name.trim().length === 0) {
            return res.status(422).json({ message: "Business name is required" });
        }

        if (userRole !== 'super_admin' && parseInt(companyId) !== parseInt(requesterCompanyId)) {
            return res.status(403).json({ message: "Access denied" });
        }

        const [duplicate] = await pool.query(
            "SELECT id FROM companies WHERE business_name = ? AND id != ? LIMIT 1",
            [business_name.trim(), companyId]
        );

        if (duplicate.length > 0) {
            return res.status(409).json({ message: "Another company with this name already exists" });
        }

        await pool.query(
            "UPDATE companies SET business_name = ?, business_id = ?, type = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [business_name.trim(), business_id || null, type || 'admin', description || null, companyId]
        );

        const [companies] = await pool.query(
            "SELECT id, business_name, business_id, type, description, department_id, created_at FROM companies WHERE id = ?",
            [companyId]
        );

        res.json({
            message: "Company updated successfully",
            company: companies[0]
        });
    } catch (error) {
        console.error("Update company error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

export const deleteCompany = async (req, res) => {
    try {
        const userRole = req.user.role;
        const requesterCompanyId = req.user.company_id;
        const { companyId } = req.params;

        if (userRole !== 'super_admin') {
            return res.status(403).json({ message: "Only super admins can delete companies" });
        }

        const [existing] = await pool.query("SELECT id FROM companies WHERE id = ? LIMIT 1", [companyId]);
        if (existing.length === 0) {
            return res.status(404).json({ message: "Company not found" });
        }

        await pool.query("DELETE FROM companies WHERE id = ?", [companyId]);
        res.json({ message: "Company deleted successfully" });
    } catch (error) {
        console.error("Delete company error:", error);
        res.status(500).json({ message: "Server error" });
    }
};
