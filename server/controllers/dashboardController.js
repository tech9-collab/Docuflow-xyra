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
        const user = req.user;
        const isSuperAdmin = user.role === 'super_admin';
        const isAdmin = user.role === 'admin';
        const isUser = !isSuperAdmin && !isAdmin;

        const dateFilter = buildDateFilter(req.query, 'dc');

        // 1. Counts
        let userCountSql = "SELECT COUNT(*) as count FROM users WHERE business_id = ?";
        let deptCountSql = "SELECT COUNT(*) as count FROM departments WHERE company_id = ?";
        let roleCountSql = "SELECT COUNT(*) as count FROM roles WHERE company_id = ?";

        let userParams = [user.company_id];
        let deptParams = [user.company_id];
        let roleParams = [user.company_id];

        if (isAdmin) {
            userCountSql += " AND department_id = ?";
            userParams.push(user.department_id);
            // Count only roles available in this department?
            roleCountSql += " AND department_id = ?";
            roleParams.push(user.department_id);
            // Department admin sees only one department
            deptCountSql += " AND id = ?";
            deptParams.push(user.department_id);
        } else if (isUser) {
            userCountSql += " AND id = ?";
            userParams.push(user.id);
            // Maybe user shouldn't see these counts at all? Return 1 for consistency.
            deptCountSql += " AND id = ?";
            deptParams.push(user.department_id);
            roleCountSql += " AND id = ?";
            roleParams.push(user.role_id);
        }

        const [userCount] = await pool.query(userCountSql, userParams);
        const [deptCount] = await pool.query(deptCountSql, deptParams);
        const [roleCount] = await pool.query(roleCountSql, roleParams);

        // 2. Document & Page Counts
        let docStatsSql = `
            SELECT 
                SUM(dc.files_count) as total_documents,
                SUM(dc.page_count) as total_pages,
                SUM(dc.input_tokens) as total_input_tokens,
                SUM(dc.output_tokens) as total_output_tokens
            FROM document_count dc
            JOIN users u ON dc.user_id = u.id
            WHERE ${dateFilter.clause} AND u.business_id = ?
        `;
        const docStatsParams = [...dateFilter.params, user.company_id];

        if (isAdmin) {
            docStatsSql += " AND u.department_id = ?";
            docStatsParams.push(user.department_id);
        } else if (isUser) {
            docStatsSql += " AND u.id = ?";
            docStatsParams.push(user.id);
        }

        const [docStats] = await pool.query(docStatsSql, docStatsParams);

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
        const user = req.user;
        const isSuperAdmin = user.role === 'super_admin';
        const isAdmin = user.role === 'admin';
        const isUser = !isSuperAdmin && !isAdmin;

        const dateFilter = buildDateFilter(req.query, 'dc');

        let sql = `
            SELECT 
                d.name as department_name,
                SUM(dc.files_count) as documents,
                SUM(dc.page_count) as pages
            FROM departments d
            LEFT JOIN users u ON d.id = u.department_id
            LEFT JOIN document_count dc ON u.id = dc.user_id AND ${dateFilter.clause}
            WHERE d.company_id = ?
        `;
        const params = [...dateFilter.params, user.company_id];

        if (isAdmin || isUser) {
            sql += " AND d.id = ?";
            params.push(user.department_id);
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
        const user = req.user;
        const isSuperAdmin = user.role === 'super_admin';
        const isAdmin = user.role === 'admin';
        const isUser = !isSuperAdmin && !isAdmin;

        const dateFilter = buildDateFilter(req.query, 'dc');

        let sql = `
            SELECT 
                m.module_name,
                SUM(dc.files_count) as documents,
                SUM(dc.page_count) as pages
            FROM modules m
            LEFT JOIN document_count dc ON m.id = dc.module_id AND ${dateFilter.clause}
            LEFT JOIN users u ON dc.user_id = u.id
            WHERE u.business_id = ?
        `;
        const params = [...dateFilter.params, user.company_id];

        if (isAdmin) {
            sql += " AND u.department_id = ?";
            params.push(user.department_id);
        } else if (isUser) {
            sql += " AND u.id = ?";
            params.push(user.id);
        }

        sql += " GROUP BY m.id, m.module_name";

        const [rows] = await pool.query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error("Module stats error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

export const getDashboardSummary = async (req, res) => {
    try {
        const user = req.user;
        const isSuperAdmin = user.role === 'super_admin';
        const isAdmin = user.role === 'admin';
        const isUser = !isSuperAdmin && !isAdmin;

        const dateFilter = buildDateFilter(req.query, 'dc');
        const companyId = user.company_id;

        // 1. Employees, Roles, Departments
        let empSql = "SELECT u.id, u.name, u.email, u.role_id, u.department_id, r.name as role_name FROM users u LEFT JOIN roles r ON u.role_id = r.id";
        let roleSql = "SELECT * FROM roles";
        let deptSql = "SELECT * FROM departments";

        let empParams = [];
        let roleParams = [];
        let deptParams = [];

        const conditions = [];
        const roleConditions = [];
        const deptConditions = [];

        if (!isSuperAdmin) {
            conditions.push("u.business_id = ?");
            empParams.push(companyId);
            roleConditions.push("company_id = ?");
            roleParams.push(companyId);
            deptConditions.push("company_id = ?");
            deptParams.push(companyId);

            if (isAdmin) {
                conditions.push("u.department_id = ?");
                empParams.push(user.department_id);
                roleConditions.push("department_id = ?");
                roleParams.push(user.department_id);
                deptConditions.push("id = ?");
                deptParams.push(user.department_id);
            } else if (isUser) {
                conditions.push("u.id = ?");
                empParams.push(user.id);
                deptConditions.push("id = ?");
                deptParams.push(user.department_id);
            }
        }

        if (conditions.length) empSql += " WHERE " + conditions.join(" AND ");
        if (roleConditions.length) roleSql += " WHERE " + roleConditions.join(" AND ");
        if (deptConditions.length) deptSql += " WHERE " + deptConditions.join(" AND ");

        // 2. System Document Count
        let sysDocSql = `
            SELECT 
                SUM(dc.files_count) as totalFiles, 
                SUM(dc.page_count) as totalPages, 
                SUM(dc.file_size) as totalSize,
                SUM(dc.input_tokens) as totalInputTokens, 
                SUM(dc.output_tokens) as totalOutputTokens
            FROM document_count dc
            JOIN users u ON dc.user_id = u.id
            WHERE ${dateFilter.clause}
        `;
        const sysDocParams = [...dateFilter.params];
        if (!isSuperAdmin) {
            sysDocSql += " AND u.business_id = ?";
            sysDocParams.push(companyId);
            if (isAdmin) {
                sysDocSql += " AND u.department_id = ?";
                sysDocParams.push(user.department_id);
            } else if (isUser) {
                sysDocSql += " AND u.id = ?";
                sysDocParams.push(user.id);
            }
        }

        // 3. Department Document Counts
        let deptDocSql = `
            SELECT
                d.id as department_id,
                d.name as department_name,
                COALESCE(SUM(dc.files_count), 0) as total_documents,
                COALESCE(SUM(dc.page_count), 0) as total_pages,
                COALESCE(SUM(dc.file_size), 0) as total_size,
                COALESCE(SUM(dc.input_tokens), 0) as total_input_tokens,
                COALESCE(SUM(dc.output_tokens), 0) as total_output_tokens
            FROM departments d
            LEFT JOIN users u ON d.id = u.department_id
            LEFT JOIN document_count dc ON u.id = dc.user_id AND ${dateFilter.clause}
            WHERE 1=1
        `;
        const deptDocParams = [...dateFilter.params];
        if (!isSuperAdmin) {
            deptDocSql += " AND d.company_id = ?";
            deptDocParams.push(companyId);
            if (isAdmin || isUser) {
                deptDocSql += " AND d.id = ?";
                deptDocParams.push(user.department_id);
            }
        }
        deptDocSql += " GROUP BY d.id, d.name HAVING total_documents > 0 ORDER BY total_documents DESC";

        // 4. Aggregated User Document Counts
        let aggUserSql = `
            SELECT
                u.id as user_id,
                u.name as user_name,
                d.name as department_name,
                COALESCE(SUM(dc.files_count), 0) as total_documents,
                COALESCE(SUM(dc.page_count), 0) as total_pages,
                COALESCE(SUM(dc.file_size), 0) as total_size,
                COALESCE(SUM(dc.input_tokens), 0) as total_input_tokens,
                COALESCE(SUM(dc.output_tokens), 0) as total_output_tokens,
                COUNT(dc.id) as processing_entries
            FROM users u
            LEFT JOIN departments d ON u.department_id = d.id
            LEFT JOIN document_count dc ON u.id = dc.user_id AND ${dateFilter.clause}
            WHERE 1=1
        `;
        const aggUserParams = [...dateFilter.params];
        if (!isSuperAdmin) {
            aggUserSql += " AND u.business_id = ?";
            aggUserParams.push(companyId);
            if (isAdmin) {
                aggUserSql += " AND u.department_id = ?";
                aggUserParams.push(user.department_id);
            } else if (isUser) {
                aggUserSql += " AND u.id = ?";
                aggUserParams.push(user.id);
            }
        }
        aggUserSql += " GROUP BY u.id, u.name, d.name HAVING total_documents > 0 ORDER BY total_documents DESC";

        // 5. All Users Document Counts (Module stats)
        let allDocSql = `
            SELECT
                dc.files_count as total_documents,
                dc.page_count,
                dc.input_tokens,
                dc.output_tokens,
                m.module_name
            FROM document_count dc
            JOIN users u ON dc.user_id = u.id
            LEFT JOIN modules m ON dc.module_id = m.id
            WHERE ${dateFilter.clause}
        `;
        const allDocParams = [...dateFilter.params];
        if (!isSuperAdmin) {
            allDocSql += " AND u.business_id = ?";
            allDocParams.push(companyId);
            if (isAdmin) {
                allDocSql += " AND u.department_id = ?";
                allDocParams.push(user.department_id);
            } else if (isUser) {
                allDocSql += " AND u.id = ?";
                allDocParams.push(user.id);
            }
        }

        // 6. Monthly Summary
        let monthlySql = `
            SELECT
                YEAR(dc.file_uploaded_date) as year,
                MONTH(dc.file_uploaded_date) as month,
                SUM(dc.files_count) as total_documents,
                SUM(dc.page_count) as total_pages,
                SUM(dc.input_tokens) as total_input_tokens,
                SUM(dc.output_tokens) as total_output_tokens
            FROM document_count dc
            JOIN users u ON dc.user_id = u.id
            WHERE dc.file_uploaded_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
        `;
        const monthlyParams = [];
        if (!isSuperAdmin) {
            monthlySql += " AND u.business_id = ?";
            monthlyParams.push(companyId);
            if (isAdmin) {
                monthlySql += " AND u.department_id = ?";
                monthlyParams.push(user.department_id);
            } else if (isUser) {
                monthlySql += " AND u.id = ?";
                monthlyParams.push(user.id);
            }
        }
        monthlySql += " GROUP BY YEAR(dc.file_uploaded_date), MONTH(dc.file_uploaded_date) ORDER BY year ASC, month ASC";

        // Execute all queries in parallel
        const [
            [employees],
            [roles],
            [departments],
            [sysStats],
            [deptCounts],
            [aggUserCounts],
            [allDocDetails],
            [monthlySummary]
        ] = await Promise.all([
            pool.query(empSql, empParams),
            pool.query(roleSql, roleParams),
            pool.query(deptSql, deptParams),
            pool.query(sysDocSql, sysDocParams),
            pool.query(deptDocSql, deptDocParams),
            pool.query(aggUserSql, aggUserParams),
            pool.query(allDocSql, allDocParams),
            pool.query(monthlySql, monthlyParams)
        ]);

        res.json({
            employees,
            roles,
            departments,
            sysStats: sysStats[0] || {},
            departmentCounts: deptCounts,
            aggregatedCounts: aggUserCounts,
            documentCounts: allDocDetails,
            monthlySummary
        });
    } catch (error) {
        console.error("Dashboard summary error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

export const getUserProcessingDetails = async (req, res) => {
    try {
        const user = req.user;
        const companyId = user.company_id;

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
            WHERE ${dateFilter.clause} AND u.business_id = ?
        `;
        const params = [...dateFilter.params, companyId];

        if (user.role === 'admin') {
            sql += " AND u.department_id = ?";
            params.push(user.department_id);
        } else if (user.role !== 'super_admin') {
            sql += " AND u.id = ?";
            params.push(user.id);
        }

        sql += " ORDER BY dc.file_uploaded_date DESC LIMIT 100";

        const [rows] = await pool.query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error("User processing details error:", error);
        res.status(500).json({ message: "Server error" });
    }
};
