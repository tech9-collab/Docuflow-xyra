import { pool } from "../db.js";
import { getUserRole } from "../initDatabase.js";

// Helper: build date filter clause from query params (month/year)
function buildDateFilter(query, tableAlias = 'dc') {
    const month = parseInt(query.month);
    const year = parseInt(query.year);
    if (month >= 1 && month <= 12 && year >= 2000) {
        const start = `${year}-${String(month).padStart(2, '0')}-01`;
        const end = new Date(year, month, 0).toISOString().slice(0, 10);
        return { clause: `${tableAlias}.file_uploaded_date >= ? AND ${tableAlias}.file_uploaded_date <= ?`, params: [start, end] };
    }
    // Default: current month
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const end = new Date(y, m, 0).toISOString().slice(0, 10);
    return { clause: `${tableAlias}.file_uploaded_date >= ? AND ${tableAlias}.file_uploaded_date <= ?`, params: [start, end] };
}

export const getDashboardStats = async (req, res) => {
    try {
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';
        const targetCompanyId = isSuperAdmin ? (req.query.companyId || null) : req.user.company_id;

        const dateFilter = buildDateFilter(req.query, 'dc');

        // 1. Counts
        let userCountSql = "SELECT COUNT(*) as count FROM users";
        let deptCountSql = "SELECT COUNT(*) as count FROM departments";
        let roleCountSql = "SELECT COUNT(*) as count FROM roles";
        let countsParams = [];

        if (targetCompanyId) {
            userCountSql += " WHERE company_id = ?";
            deptCountSql += " WHERE company_id = ?";
            roleCountSql += " WHERE company_id = ?";
            countsParams = [targetCompanyId];
        }

        const [userCount] = await pool.query(userCountSql, countsParams);
        const [deptCount] = await pool.query(deptCountSql, countsParams);
        const [roleCount] = await pool.query(roleCountSql, countsParams);

        // 2. Document & Page Counts
        let docStatsSql = `
            SELECT 
                SUM(dc.files_count) as total_documents,
                SUM(dc.page_count) as total_pages,
                SUM(dc.input_tokens) as total_input_tokens,
                SUM(dc.output_tokens) as total_output_tokens
            FROM document_count dc
            JOIN users u ON dc.user_id = u.id
            WHERE ${dateFilter.clause}
        `;
        const docStatsParams = [...dateFilter.params];

        if (targetCompanyId) {
            docStatsSql += " AND u.company_id = ?";
            docStatsParams.push(targetCompanyId);
        }

        const [docStats] = await pool.query(docStatsSql, docStatsParams);

        // Calculate Cost (Example: $0.15 per 1M input tokens, $0.60 per 1M output tokens for Gemini 1.5 Flash)
        // Or simplified $0.50 per 1M total tokens
        const totalInputTokens = docStats[0].total_input_tokens || 0;
        const totalOutputTokens = docStats[0].total_output_tokens || 0;
        const totalTokens = totalInputTokens + totalOutputTokens;
        const estimatedCost = (totalInputTokens * 0.00000015) + (totalOutputTokens * 0.00000060);

        res.json({
            users: userCount[0].count,
            departments: deptCount[0].count,
            roles: roleCount[0].count,
            documents: docStats[0].total_documents || 0,
            totalPages: docStats[0].total_pages || 0,
            totalTokens: totalTokens,
            estimatedCost: estimatedCost.toFixed(2)
        });
    } catch (error) {
        console.error("Dashboard stats error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

export const getDepartmentStats = async (req, res) => {
    try {
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';
        const targetCompanyId = isSuperAdmin ? (req.query.companyId || null) : req.user.company_id;

        const dateFilter = buildDateFilter(req.query, 'dc');

        let sql = `
            SELECT 
                d.name as department_name,
                SUM(dc.files_count) as documents,
                SUM(dc.page_count) as pages
            FROM departments d
            LEFT JOIN users u ON d.id = u.department_id
            LEFT JOIN document_count dc ON u.id = dc.user_id AND ${dateFilter.clause}
            WHERE 1=1
        `;
        const params = [...dateFilter.params];

        if (targetCompanyId) {
            sql += " AND d.company_id = ?";
            params.push(targetCompanyId);
        }

        sql += " GROUP BY d.id, d.name";

        const [rows] = await pool.query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error("Department stats error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

export const getModuleStats = async (req, res) => {
    try {
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';
        const targetCompanyId = isSuperAdmin ? (req.query.companyId || null) : req.user.company_id;

        const dateFilter = buildDateFilter(req.query, 'dc');

        let sql = `
            SELECT 
                m.module_name,
                SUM(dc.files_count) as documents,
                SUM(dc.page_count) as pages
            FROM modules m
            LEFT JOIN document_count dc ON m.id = dc.module_id AND ${dateFilter.clause}
            LEFT JOIN users u ON dc.user_id = u.id
            WHERE 1=1
        `;
        const params = [...dateFilter.params];

        if (targetCompanyId) {
            sql += " AND u.company_id = ?";
            params.push(targetCompanyId);
        }

        sql += " GROUP BY m.id, m.module_name";

        const [rows] = await pool.query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error("Module stats error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

export const getUserProcessingDetails = async (req, res) => {
    try {
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';
        const targetCompanyId = isSuperAdmin ? (req.query.companyId || null) : req.user.company_id;

        const dateFilter = buildDateFilter(req.query, 'dc');

        let sql = `
            SELECT 
                u.name as user_name,
                d.name as department_name,
                m.module_name,
                dc.file_name,
                dc.page_count,
                dc.file_uploaded_date as date,
                (dc.input_tokens + dc.output_tokens) as tokens
            FROM document_count dc
            JOIN users u ON dc.user_id = u.id
            LEFT JOIN departments d ON u.department_id = d.id
            LEFT JOIN modules m ON dc.module_id = m.id
            WHERE ${dateFilter.clause}
        `;
        const params = [...dateFilter.params];

        if (targetCompanyId) {
            sql += " AND u.company_id = ?";
            params.push(targetCompanyId);
        }

        sql += " ORDER BY dc.file_uploaded_date DESC LIMIT 100";

        const [rows] = await pool.query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error("User processing details error:", error);
        res.status(500).json({ message: "Server error" });
    }
};
