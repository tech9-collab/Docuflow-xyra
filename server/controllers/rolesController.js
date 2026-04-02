import { pool } from "../db.js";
import { checkUserPermission, getUserPermissions, getUserRole } from "../initDatabase.js";

// Helper: fetch the requesting user's business_name (empty string = none)
async function getRequesterBusinessName(userId) {
    const [rows] = await pool.query(
        "SELECT business_name FROM users WHERE id = ?", [userId]
    );
    return rows[0]?.business_name?.trim() || "";
}

// Helper: fetch the requesting user's company_id
async function getRequesterCompanyId(userId) {
    const [rows] = await pool.query(
        "SELECT company_id FROM users WHERE id = ?", [userId]
    );
    return rows[0]?.company_id || null;
}

// Helper: build date filter clause from query params (month/year)
// If month & year provided, filter that month. Otherwise defaults to current month.
function buildDateFilter(query) {
    const month = parseInt(query.month);
    const year = parseInt(query.year);
    if (month >= 1 && month <= 12 && year >= 2000) {
        const start = `${year}-${String(month).padStart(2, '0')}-01`;
        // Last day of the month
        const end = new Date(year, month, 0).toISOString().slice(0, 10);
        return { clause: `dc.file_uploaded_date >= '${start}' AND dc.file_uploaded_date <= '${end}'`, start, end };
    }
    // Default: current month
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const end = new Date(y, m, 0).toISOString().slice(0, 10);
    return { clause: `dc.file_uploaded_date >= '${start}' AND dc.file_uploaded_date <= '${end}'`, start, end };
}

// ===== DEPARTMENT MANAGEMENT =====

// Get all departments
export const getAllDepartments = async (req, res) => {
    try {
        const { companyId: qCompanyId } = req.query;
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';

        const targetCompanyId = isSuperAdmin ? (qCompanyId || null) : await getRequesterCompanyId(req.user.id);

        const [tableColumns] = await pool.query("SHOW COLUMNS FROM departments");
        const existingColumns = tableColumns.map(col => col.Field);

        const selectCols = ['d.id', 'd.name', 'd.created_at', 'd.updated_at'];
        if (existingColumns.includes('company_id')) selectCols.push('d.company_id');
        if (existingColumns.includes('description')) selectCols.push('d.description');
        if (existingColumns.includes('location')) selectCols.push('d.location');
        if (existingColumns.includes('manager')) selectCols.push('d.manager');
        if (existingColumns.includes('budget')) selectCols.push('d.budget');
        if (existingColumns.includes('status')) selectCols.push('d.status');

        let sql = `
            SELECT ${selectCols.join(', ')}, COUNT(u.id) as employee_count
            FROM departments d
            LEFT JOIN users u ON d.id = u.department_id
        `;

        const params = [];
        if (targetCompanyId) {
            sql += ` WHERE d.company_id = ?`;
            params.push(targetCompanyId);
        } else if (!isSuperAdmin) {
            return res.json({ departments: [] });
        }

        sql += ` GROUP BY ${selectCols.join(', ')} ORDER BY d.created_at DESC`;
        const [departments] = await pool.query(sql, params);

        res.json({ departments });
    } catch (error) {
        console.error("Get all departments error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Get department by ID
export const getDepartmentById = async (req, res) => {
    try {
        const { id } = req.params;
        const requesterCompanyId = await getRequesterCompanyId(req.user.id);
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';

        if (!isSuperAdmin) {
            const hasPermission = await checkUserPermission(req.user.id, 'departments.read');
            if (!hasPermission) return res.status(403).json({ message: "Insufficient permissions" });
        }

        let selectParams = [id];
        let whereClause = "WHERE d.id = ?";
        if (!isSuperAdmin) {
            whereClause += " AND d.company_id = ?";
            selectParams.push(requesterCompanyId);
        }

        const [tableColumns] = await pool.query("SHOW COLUMNS FROM departments");
        const existingColumns = tableColumns.map(col => col.Field);

        // Build SELECT query with only existing columns
        let selectColumns = ['d.id', 'd.name', 'd.created_at', 'd.updated_at'];
        let groupByColumns = ['d.id', 'd.name', 'd.created_at', 'd.updated_at'];

        if (existingColumns.includes('description')) {
            selectColumns.push('d.description');
            groupByColumns.push('d.description');
        }
        if (existingColumns.includes('location')) {
            selectColumns.push('d.location');
            groupByColumns.push('d.location');
        }
        if (existingColumns.includes('manager')) {
            selectColumns.push('d.manager');
            groupByColumns.push('d.manager');
        }
        if (existingColumns.includes('budget')) {
            selectColumns.push('d.budget');
            groupByColumns.push('d.budget');
        }
        if (existingColumns.includes('status')) {
            selectColumns.push('d.status');
            groupByColumns.push('d.status');
        }

        selectColumns.push('COUNT(u.id) as employee_count');

        const query = `
            SELECT ${selectColumns.join(', ')}
            FROM departments d
            LEFT JOIN users u ON d.id = u.department_id
            WHERE d.id = ?
            GROUP BY ${groupByColumns.join(', ')}
        `;

        const [departments] = await pool.query(query, [departmentId]);

        if (!departments.length) {
            return res.status(404).json({ message: "Department not found" });
        }

        res.json({ department: departments[0] });
    } catch (error) {
        console.error("Get department error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Get document count for a specific user
export const getUserDocumentCount = async (req, res) => {
    try {
        const { userId } = req.params;

        // Check if the requesting user has permission to view this data
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';
        const isDepartmentAdmin = userRole?.name === 'admin' && userRole?.department_id;

        // If not super admin or department admin, check if user is viewing their own data
        if (!isSuperAdmin && !isDepartmentAdmin && parseInt(req.user.id) !== parseInt(userId)) {
            return res.status(403).json({ message: "Insufficient permissions" });
        }

        // If department admin, check if the user belongs to their department
        if (isDepartmentAdmin) {
            // Get the department of the user whose data is being requested
            const [targetUser] = await pool.query("SELECT department_id FROM users WHERE id = ?", [userId]);
            if (!targetUser.length || targetUser[0].department_id != userRole.department_id) {
                return res.status(403).json({ message: "Department admins can only access data for users in their own department" });
            }
        }

        // Check if the new columns exist in the document_count table
        const [columns] = await pool.query("SHOW COLUMNS FROM document_count LIKE 'file_name'");
        const hasNewColumns = columns.length > 0;

        let query, params;
        const dateFilter = buildDateFilter(req.query);

        if (hasNewColumns) {
            query = `
                SELECT dc.files_count, dc.file_size, dc.file_uploaded_date, dc.file_name, dc.page_count, dc.input_tokens, dc.output_tokens, m.module_name, u.name as user_name
                FROM document_count dc
                LEFT JOIN modules m ON dc.module_id = m.id
                JOIN users u ON dc.user_id = u.id
                WHERE dc.user_id = ?
                AND ${dateFilter.clause}
                ORDER BY dc.file_uploaded_date DESC
            `;
            params = [userId];
        } else {
            query = `
                SELECT files_count, file_size, file_uploaded_date
                FROM document_count
                WHERE user_id = ?
                AND ${dateFilter.clause}
                ORDER BY file_uploaded_date DESC
            `;
            params = [userId];
        }

        const [documentCount] = await pool.query(query, params);

        res.json({ documentCount });
    } catch (error) {
        console.error("Get user document count error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Get document count for a specific department
export const getDepartmentDocumentCount = async (req, res) => {
    try {
        const { departmentId } = req.params;

        // Get user role to determine filtering
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';
        const isDepartmentAdmin = userRole?.name === 'admin' && userRole?.department_id;

        // If user is a department admin, check if they're trying to access their own department
        if (isDepartmentAdmin) {
            const [user] = await pool.query("SELECT department_id FROM users WHERE id = ?", [req.user.id]);
            // Convert both to integers for proper comparison
            if (user.length && parseInt(user[0].department_id) === parseInt(departmentId)) {
                // Department admin accessing their own department - allow access
                console.log('Allowing department admin to access their own department document count');
            } else {
                return res.status(403).json({ message: "Department admins can only access data in their own department" });
            }
        } else if (!isSuperAdmin) {
            // Regular user - check permission
            const hasPermission = await checkUserPermission(req.user.id, 'dashboard.read');
            if (!hasPermission) {
                return res.status(403).json({ message: "Insufficient permissions" });
            }

            // Check if user belongs to this department
            const [user] = await pool.query("SELECT department_id FROM users WHERE id = ?", [req.user.id]);
            if (!user.length || user[0].department_id != departmentId) {
                return res.status(403).json({ message: "Insufficient permissions" });
            }
        }
        // Super admins can access any department

        // Check if the new columns exist in the document_count table
        const [columns] = await pool.query("SHOW COLUMNS FROM document_count LIKE 'file_name'");
        const hasNewColumns = columns.length > 0;

        let query, params;
        const dateFilter = buildDateFilter(req.query);

        if (hasNewColumns) {
            query = `
                SELECT dc.files_count, dc.file_size, dc.file_uploaded_date, dc.file_name, dc.page_count, dc.input_tokens, dc.output_tokens, m.module_name, u.name as user_name
                FROM document_count dc
                JOIN users u ON dc.user_id = u.id
                LEFT JOIN modules m ON dc.module_id = m.id
                WHERE u.department_id = ?
                AND ${dateFilter.clause}
                ORDER BY dc.file_uploaded_date DESC
            `;
            params = [departmentId];
        } else {
            query = `
                SELECT dc.files_count, dc.file_size, dc.file_uploaded_date
                FROM document_count dc
                JOIN users u ON dc.user_id = u.id
                WHERE u.department_id = ?
                AND ${dateFilter.clause}
                ORDER BY dc.file_uploaded_date DESC
            `;
            params = [departmentId];
        }

        const [documentCount] = await pool.query(query, params);

        res.json({ documentCount });
    } catch (error) {
        console.error("Get department document count error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Get total document count across the entire system
export const getSystemDocumentCount = async (req, res) => {
    try {
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';
        const isDepartmentAdmin = userRole?.name === 'admin' && userRole?.department_id;
        const sysBusinessName = !isSuperAdmin && !isDepartmentAdmin
            ? await getRequesterBusinessName(req.user.id) : "";

        if (!isSuperAdmin && !sysBusinessName) {
            return res.status(403).json({ message: "Insufficient permissions" });
        }

        const dateFilter = buildDateFilter(req.query);

        let query, params;
        if (sysBusinessName) {
            query = `SELECT SUM(dc.files_count) as total_files, SUM(dc.file_size) as total_size,
                   SUM(dc.page_count) as total_pages,
                   SUM(dc.input_tokens) as total_input_tokens, SUM(dc.output_tokens) as total_output_tokens
            FROM document_count dc
            JOIN users u ON dc.user_id = u.id
            WHERE ${dateFilter.clause} AND u.business_name = ?`;
            params = [sysBusinessName];
        } else {
            query = `SELECT SUM(dc.files_count) as total_files, SUM(dc.file_size) as total_size,
                   SUM(dc.page_count) as total_pages,
                   SUM(dc.input_tokens) as total_input_tokens, SUM(dc.output_tokens) as total_output_tokens
            FROM document_count dc
            WHERE ${dateFilter.clause}`;
            params = [];
        }

        const [documentCount] = await pool.query(query, params);

        res.json({
            totalFiles: documentCount[0].total_files || 0,
            totalSize: documentCount[0].total_size || 0,
            totalPages: documentCount[0].total_pages || 0,
            totalInputTokens: documentCount[0].total_input_tokens || 0,
            totalOutputTokens: documentCount[0].total_output_tokens || 0,
        });
    } catch (error) {
        console.error("Get system document count error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Get department-wise document counts for super admin dashboard
export const getDepartmentDocumentCounts = async (req, res) => {
    try {
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';
        const isDeptAdmin2 = userRole?.name === 'admin' && userRole?.department_id;
        const deptCountBizName = !isSuperAdmin && !isDeptAdmin2
            ? await getRequesterBusinessName(req.user.id) : "";

        if (!isSuperAdmin && !deptCountBizName) {
            return res.status(403).json({ message: "Insufficient permissions" });
        }

        // Check if the new columns exist in the document_count table
        const [columns] = await pool.query("SHOW COLUMNS FROM document_count LIKE 'file_name'");
        const hasNewColumns = columns.length > 0;

        let query;
        const dateFilter = buildDateFilter(req.query);
        const bizWhere = deptCountBizName ? `AND d.business_name = '${deptCountBizName.replace(/'/g, "''")}'` : "";

        if (hasNewColumns) {
            query = `
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
                WHERE 1=1 ${bizWhere}
                GROUP BY d.id, d.name
                HAVING total_documents > 0
                ORDER BY total_documents DESC
            `;
        } else {
            query = `
                SELECT
                    d.id as department_id,
                    d.name as department_name,
                    COALESCE(SUM(dc.files_count), 0) as total_documents,
                    COALESCE(SUM(dc.file_size), 0) as total_size
                FROM departments d
                LEFT JOIN users u ON d.id = u.department_id
                LEFT JOIN document_count dc ON u.id = dc.user_id AND ${dateFilter.clause}
                WHERE 1=1 ${bizWhere}
                GROUP BY d.id, d.name
                HAVING total_documents > 0
                ORDER BY total_documents DESC
            `;
        }

        const [departmentCounts] = await pool.query(query);

        res.json({ departmentCounts });
    } catch (error) {
        console.error("Get department document counts error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Get detailed document counts for all users (for super admin dashboard)
export const getAllUsersDocumentCounts = async (req, res) => {
    try {
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';
        const isDA3 = userRole?.name === 'admin' && userRole?.department_id;
        const allUsersBizName = !isSuperAdmin && !isDA3
            ? await getRequesterBusinessName(req.user.id) : "";

        if (!isSuperAdmin && !allUsersBizName) {
            return res.status(403).json({ message: "Insufficient permissions" });
        }

        // Check if the new columns exist in the document_count table
        const [columns] = await pool.query("SHOW COLUMNS FROM document_count LIKE 'file_name'");
        const hasNewColumns = columns.length > 0;

        let query;
        const dateFilter = buildDateFilter(req.query);

        if (hasNewColumns) {
            query = `
                SELECT
                    dc.user_id,
                    u.name as user_name,
                    d.id as department_id,
                    d.name as department_name,
                    dc.files_count,
                    dc.page_count,
                    dc.file_size,
                    dc.input_tokens,
                    dc.output_tokens,
                    dc.file_uploaded_date,
                    dc.file_name,
                    m.module_name
                FROM document_count dc
                JOIN users u ON dc.user_id = u.id
                LEFT JOIN departments d ON u.department_id = d.id
                LEFT JOIN modules m ON dc.module_id = m.id
                WHERE ${dateFilter.clause}${allUsersBizName ? ` AND u.business_name = '${allUsersBizName.replace(/'/g, "''")}'` : ""}
                ORDER BY dc.file_uploaded_date DESC
            `;
        } else {
            query = `
                SELECT
                    dc.user_id,
                    u.name as user_name,
                    d.id as department_id,
                    d.name as department_name,
                    dc.files_count,
                    dc.file_size,
                    dc.file_uploaded_date
                FROM document_count dc
                JOIN users u ON dc.user_id = u.id
                LEFT JOIN departments d ON u.department_id = d.id
                WHERE ${dateFilter.clause}${allUsersBizName ? ` AND u.business_name = '${allUsersBizName.replace(/'/g, "''")}'` : ""}
                ORDER BY dc.file_uploaded_date DESC
            `;
        }

        const [documentCounts] = await pool.query(query);

        res.json({ documentCounts });
    } catch (error) {
        console.error("Get all users document counts error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Get aggregated user document counts by department (for super admin dashboard)
export const getAggregatedUserDocumentCounts = async (req, res) => {
    try {
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';
        const isDA4 = userRole?.name === 'admin' && userRole?.department_id;
        const aggBizName = !isSuperAdmin && !isDA4
            ? await getRequesterBusinessName(req.user.id) : "";

        if (!isSuperAdmin && !aggBizName) {
            return res.status(403).json({ message: "Insufficient permissions" });
        }

        // Check if the new columns exist in the document_count table
        const [columns] = await pool.query("SHOW COLUMNS FROM document_count LIKE 'file_name'");
        const hasNewColumns = columns.length > 0;

        let query;
        const dateFilter = buildDateFilter(req.query);

        if (hasNewColumns) {
            query = `
                SELECT
                    u.id as user_id,
                    u.name as user_name,
                    d.id as department_id,
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
                ${aggBizName ? `WHERE u.business_name = '${aggBizName.replace(/'/g, "''")}'` : ""}
                GROUP BY u.id, u.name, d.id, d.name
                HAVING total_documents > 0
                ORDER BY total_documents DESC
            `;
        } else {
            query = `
                SELECT
                    u.id as user_id,
                    u.name as user_name,
                    d.id as department_id,
                    d.name as department_name,
                    COALESCE(SUM(dc.files_count), 0) as total_documents,
                    COALESCE(SUM(dc.file_size), 0) as total_size,
                    COUNT(dc.id) as processing_entries
                FROM users u
                LEFT JOIN departments d ON u.department_id = d.id
                LEFT JOIN document_count dc ON u.id = dc.user_id AND ${dateFilter.clause}
                ${aggBizName ? `WHERE u.business_name = '${aggBizName.replace(/'/g, "''")}'` : ""}
                GROUP BY u.id, u.name, d.id, d.name
                HAVING total_documents > 0
                ORDER BY total_documents DESC
            `;
        }

        const [aggregatedCounts] = await pool.query(query);

        res.json({ aggregatedCounts });
    } catch (error) {
        console.error("Get aggregated user document counts error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Get monthly summary for last 12 months (super admin or business user)
export const getMonthlySummary = async (req, res) => {
    try {
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';
        const isDA5 = userRole?.name === 'admin' && userRole?.department_id;
        const monthlyBizName = !isSuperAdmin && !isDA5
            ? await getRequesterBusinessName(req.user.id) : "";

        if (!isSuperAdmin && !monthlyBizName) {
            return res.status(403).json({ message: "Insufficient permissions" });
        }

        const [columns] = await pool.query("SHOW COLUMNS FROM document_count LIKE 'page_count'");
        const hasPageCount = columns.length > 0;

        const pageSelect = hasPageCount ? ', SUM(dc.page_count) as total_pages' : ', 0 as total_pages';

        const monthlyBizFilter = monthlyBizName
            ? `AND u.business_name = '${monthlyBizName.replace(/'/g, "''")}'` : "";
        const monthlyFrom = monthlyBizName
            ? `FROM document_count dc JOIN users u ON dc.user_id = u.id`
            : `FROM document_count dc`;

        const [monthlySummary] = await pool.query(`
            SELECT
                YEAR(dc.file_uploaded_date) as year,
                MONTH(dc.file_uploaded_date) as month,
                SUM(dc.files_count) as total_documents
                ${pageSelect},
                SUM(dc.input_tokens) as total_input_tokens,
                SUM(dc.output_tokens) as total_output_tokens
            ${monthlyFrom}
            WHERE dc.file_uploaded_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
            ${monthlyBizFilter}
            GROUP BY YEAR(dc.file_uploaded_date), MONTH(dc.file_uploaded_date)
            ORDER BY year ASC, month ASC
        `);

        res.json({ monthlySummary });
    } catch (error) {
        console.error("Get monthly summary error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Get monthly summary for a specific user
export const getUserMonthlySummary = async (req, res) => {
    try {
        const { userId } = req.params;
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';
        const isDepartmentAdmin = userRole?.name === 'admin' && userRole?.department_id;

        if (!isSuperAdmin && !isDepartmentAdmin && parseInt(req.user.id) !== parseInt(userId)) {
            return res.status(403).json({ message: "Insufficient permissions" });
        }

        const [columns] = await pool.query("SHOW COLUMNS FROM document_count LIKE 'page_count'");
        const hasPageCount = columns.length > 0;
        const pageSelect = hasPageCount ? ', SUM(dc.page_count) as total_pages' : ', 0 as total_pages';

        const [monthlySummary] = await pool.query(`
            SELECT
                YEAR(dc.file_uploaded_date) as year,
                MONTH(dc.file_uploaded_date) as month,
                SUM(dc.files_count) as total_documents
                ${pageSelect},
                SUM(dc.input_tokens) as total_input_tokens,
                SUM(dc.output_tokens) as total_output_tokens
            FROM document_count dc
            WHERE dc.user_id = ?
            AND dc.file_uploaded_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
            GROUP BY YEAR(dc.file_uploaded_date), MONTH(dc.file_uploaded_date)
            ORDER BY year ASC, month ASC
        `, [userId]);

        res.json({ monthlySummary });
    } catch (error) {
        console.error("Get user monthly summary error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Get monthly summary for a department
export const getDepartmentMonthlySummary = async (req, res) => {
    try {
        const { departmentId } = req.params;
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';
        const isDepartmentAdmin = userRole?.name === 'admin' && userRole?.department_id;

        if (isDepartmentAdmin) {
            const [user] = await pool.query("SELECT department_id FROM users WHERE id = ?", [req.user.id]);
            if (!user.length || parseInt(user[0].department_id) !== parseInt(departmentId)) {
                return res.status(403).json({ message: "Department admins can only access data in their own department" });
            }
        } else if (!isSuperAdmin) {
            return res.status(403).json({ message: "Insufficient permissions" });
        }

        const [columns] = await pool.query("SHOW COLUMNS FROM document_count LIKE 'page_count'");
        const hasPageCount = columns.length > 0;
        const pageSelect = hasPageCount ? ', SUM(dc.page_count) as total_pages' : ', 0 as total_pages';

        const [monthlySummary] = await pool.query(`
            SELECT
                YEAR(dc.file_uploaded_date) as year,
                MONTH(dc.file_uploaded_date) as month,
                SUM(dc.files_count) as total_documents
                ${pageSelect},
                SUM(dc.input_tokens) as total_input_tokens,
                SUM(dc.output_tokens) as total_output_tokens
            FROM document_count dc
            JOIN users u ON dc.user_id = u.id
            WHERE u.department_id = ?
            AND dc.file_uploaded_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
            GROUP BY YEAR(dc.file_uploaded_date), MONTH(dc.file_uploaded_date)
            ORDER BY year ASC, month ASC
        `, [departmentId]);

        res.json({ monthlySummary });
    } catch (error) {
        console.error("Get department monthly summary error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Get users in a specific department
export const getDepartmentUsers = async (req, res) => {
    try {
        const { departmentId } = req.params;

        // Get user role to determine filtering
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';
        const isDepartmentAdmin = userRole?.name === 'admin' && userRole?.department_id;

        // If user is a department admin, check if they're trying to access their own department
        if (isDepartmentAdmin) {
            const [user] = await pool.query("SELECT department_id FROM users WHERE id = ?", [req.user.id]);
            // Convert both to integers for proper comparison
            if (user.length && parseInt(user[0].department_id) === parseInt(departmentId)) {
                // Department admin accessing their own department - allow access
                console.log('Allowing department admin to access their own department users');
            } else {
                return res.status(403).json({ message: "Department admins can only access users in their own department" });
            }
        } else if (!isSuperAdmin) {
            // Regular user - check permission
            const hasPermission = await checkUserPermission(req.user.id, 'employees.read');
            if (!hasPermission) {
                return res.status(403).json({ message: "Insufficient permissions" });
            }
        }
        // Super admins can access any department

        // Get users in this department with their role names
        const [users] = await pool.query(`
            SELECT u.id, u.name, u.email, u.role_id, u.department_id, u.created_at, u.updated_at, r.name as role_name
            FROM users u
            LEFT JOIN roles r ON u.role_id = r.id
            WHERE u.department_id = ?
        `, [departmentId]);

        res.json({ users });
    } catch (error) {
        console.error("Get department users error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Get department-specific permissions for a user
export const getUserDepartmentPermissions = async (req, res) => {
    try {
        const { userId } = req.params;

        // Check if user is trying to access their own data or if they're a super admin
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';
        const isOwnData = parseInt(req.user.id) === parseInt(userId);

        // If not super admin and not accessing own data, check permissions
        if (!isSuperAdmin && !isOwnData) {
            return res.status(403).json({ message: "Insufficient permissions" });
        }

        // If accessing own data, user should be able to see their own department info
        // If super admin, they can access any user's data

        // Get user's department and role
        const [user] = await pool.query(`
            SELECT u.department_id, u.role_id, d.name as department_name, r.name as role_name
            FROM users u
            LEFT JOIN departments d ON u.department_id = d.id
            LEFT JOIN roles r ON u.role_id = r.id
            WHERE u.id = ?
        `, [userId]);

        if (!user.length) {
            return res.status(404).json({ message: "User not found" });
        }

        const userData = user[0];

        // Get role-based permissions
        const rolePermissions = await getUserPermissions(userId);

        res.json({
            user: {
                id: userId,
                department_id: userData.department_id,
                department_name: userData.department_name,
                role_id: userData.role_id,
                role_name: userData.role_name
            },
            permissions: rolePermissions
        });
    } catch (error) {
        console.error("Get user department permissions error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Get roles in a specific department
export const getDepartmentRoles = async (req, res) => {
    try {
        const { departmentId } = req.params;

        // Get user role to determine filtering
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';
        const isDepartmentAdmin = userRole?.name === 'admin' && userRole?.department_id;

        // If user is a department admin, check if they're trying to access their own department
        if (isDepartmentAdmin) {
            const [user] = await pool.query("SELECT department_id FROM users WHERE id = ?", [req.user.id]);
            // Convert both to integers for proper comparison
            if (user.length && parseInt(user[0].department_id) === parseInt(departmentId)) {
                // Department admin accessing their own department - allow access
                console.log('Allowing department admin to access their own department roles');
            } else {
                return res.status(403).json({ message: "Department admins can only access roles in their own department" });
            }
        } else if (!isSuperAdmin) {
            // Regular user - check permission
            const hasPermission = await checkUserPermission(req.user.id, 'roles.read');
            if (!hasPermission) {
                return res.status(403).json({ message: "Insufficient permissions" });
            }

            // Check if user belongs to this department
            const [user] = await pool.query("SELECT department_id FROM users WHERE id = ?", [req.user.id]);
            if (!user.length || user[0].department_id != departmentId) {
                return res.status(403).json({ message: "Insufficient permissions" });
            }
        }
        // Super admins can access any department

        try {
            // Try to use the full query with department information first
            const query = `
                SELECT r.id, r.name, r.description, r.department_id, r.created_at, r.updated_at,
                       d.name as department_name,
                       COUNT(u.id) as user_count
                FROM roles r
                LEFT JOIN departments d ON r.department_id = d.id
                LEFT JOIN users u ON r.id = u.role_id
                WHERE r.department_id = ?
                GROUP BY r.id, r.name, r.description, r.department_id, r.created_at, r.updated_at, d.name
                ORDER BY r.id
            `;

            const [roles] = await pool.query(query, [departmentId]);
            return res.json({ roles });
        } catch (departmentError) {
            // If department query fails, fall back to simpler query without departments
            console.log('Department query failed, falling back to simple query:', departmentError.message);

            const query = `
                SELECT r.id, r.name, r.description, r.created_at, r.updated_at,
                       COUNT(u.id) as user_count
                FROM roles r
                LEFT JOIN users u ON r.id = u.role_id
                WHERE r.department_id = ?
                GROUP BY r.id, r.name, r.description, r.created_at, r.updated_at
                ORDER BY r.id
            `;

            const [roles] = await pool.query(query, [departmentId]);
            return res.json({ roles });
        }
    } catch (error) {
        console.error("Get department roles error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Create department
export const createDepartment = async (req, res) => {
    try {
        const { name, description, location, manager, budget, status, companyId } = req.body;
        const requesterCompanyId = await getRequesterCompanyId(req.user.id);
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';

        if (!isSuperAdmin) {
            const hasPermission = await checkUserPermission(req.user.id, 'departments.create');
            if (!hasPermission) return res.status(403).json({ message: "Insufficient permissions" });
        }

        const targetCompanyId = isSuperAdmin ? (companyId || null) : requesterCompanyId;
        if (!name || name.trim().length < 2) return res.status(422).json({ message: "Name required (2+ chars)" });

        const [exists] = await pool.query("SELECT id FROM departments WHERE name = ? AND (company_id = ? OR company_id IS NULL) LIMIT 1", [name.trim(), targetCompanyId]);
        if (exists.length) return res.status(409).json({ message: "Department name already exists in this company" });

        const [tableColumns] = await pool.query("SHOW COLUMNS FROM departments");
        const existingColumns = tableColumns.map(col => col.Field);

        const insertCols = ['name'];
        const insertVals = [name.trim()];
        const placeholders = ['?'];

        if (existingColumns.includes('company_id')) { insertCols.push('company_id'); insertVals.push(targetCompanyId); placeholders.push('?'); }
        if (description && existingColumns.includes('description')) { insertCols.push('description'); insertVals.push(description); placeholders.push('?'); }
        if (location && existingColumns.includes('location')) { insertCols.push('location'); insertVals.push(location); placeholders.push('?'); }
        if (manager && existingColumns.includes('manager')) { insertCols.push('manager'); insertVals.push(manager); placeholders.push('?'); }
        if (budget && existingColumns.includes('budget')) { insertCols.push('budget'); insertVals.push(budget); placeholders.push('?'); }
        if (status && existingColumns.includes('status')) { insertCols.push('status'); insertVals.push(status); placeholders.push('?'); }

        const [result] = await pool.query(`INSERT INTO departments (${insertCols.join(', ')}) VALUES (${placeholders.join(', ')})`, insertVals);
        res.status(201).json({ message: "Department created", department: { id: result.insertId, name: name.trim() } });
    } catch (error) {
        console.error("Create department error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

export const updateDepartment = async (req, res) => {
    try {
        const { departmentId: id } = req.params;
        const { name, description, location, manager, budget, status } = req.body;
        const requesterCompanyId = await getRequesterCompanyId(req.user.id);
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';

        if (!isSuperAdmin) {
            const hasPermission = await checkUserPermission(req.user.id, 'departments.update');
            if (!hasPermission) return res.status(403).json({ message: "Insufficient permissions" });
        }

        let checkSql = "SELECT id FROM departments WHERE id = ?";
        let checkParams = [id];
        if (!isSuperAdmin) { checkSql += " AND company_id = ?"; checkParams.push(requesterCompanyId); }

        const [existing] = await pool.query(checkSql, checkParams);
        if (!existing.length) return res.status(404).json({ message: "Department not found or access denied" });

        const [tableColumns] = await pool.query("SHOW COLUMNS FROM departments");
        const existingColumns = tableColumns.map(col => col.Field);

        const updates = [];
        const values = [];
        if (name) { updates.push('name = ?'); values.push(name.trim()); }
        if (description !== undefined && existingColumns.includes('description')) { updates.push('description = ?'); values.push(description); }
        if (location !== undefined && existingColumns.includes('location')) { updates.push('location = ?'); values.push(location); }
        if (manager !== undefined && existingColumns.includes('manager')) { updates.push('manager = ?'); values.push(manager); }
        if (budget !== undefined && existingColumns.includes('budget')) { updates.push('budget = ?'); values.push(budget); }
        if (status !== undefined && existingColumns.includes('status')) { updates.push('status = ?'); values.push(status); }

        if (updates.length === 0) return res.json({ message: "Nothing to update" });
        values.push(id);
        await pool.query(`UPDATE departments SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);
        res.json({ message: "Department updated" });
    } catch (error) {
        console.error("Update department error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Delete department
export const deleteDepartment = async (req, res) => {
    try {
        const { departmentId: id } = req.params;
        const requesterCompanyId = await getRequesterCompanyId(req.user.id);
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';

        if (!isSuperAdmin) {
            const hasPermission = await checkUserPermission(req.user.id, 'departments.delete');
            if (!hasPermission) return res.status(403).json({ message: "Insufficient permissions" });
        }

        let checkSql = "SELECT id FROM departments WHERE id = ?";
        let checkParams = [id];
        if (!isSuperAdmin) { checkSql += " AND company_id = ?"; checkParams.push(requesterCompanyId); }

        const [existing] = await pool.query(checkSql, checkParams);
        if (!existing.length) return res.status(404).json({ message: "Department not found or access denied" });

        await pool.query("DELETE FROM departments WHERE id = ?", [id]);
        res.json({ message: "Department deleted successfully" });
    } catch (error) {
        console.error("Delete department error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Update department admin role permissions
export const updateDepartmentAdminPermissions = async (req, res) => {
    try {
        const { departmentId } = req.params;
        const { selectedConverts } = req.body;

        // Check permission (only super_admin can update department admin permissions)
        const hasPermission = await checkUserPermission(req.user.id, 'roles.update');
        if (!hasPermission) {
            return res.status(403).json({ message: "Insufficient permissions" });
        }

        // Find the admin role for this department
        const [adminRoles] = await pool.query(
            'SELECT id FROM roles WHERE name = ? AND department_id = ?',
            ['admin', departmentId]
        );

        if (adminRoles.length === 0) {
            return res.status(404).json({ message: "Admin role not found for this department" });
        }

        const roleId = adminRoles[0].id;

        // Define default permissions that all department admins should have
        const defaultPermissions = [
            'dashboard.read',
            'roles.read',
            'roles.create',
            'roles.update',
            'roles.delete',
            'employees.read',
            'employees.create',
            'employees.update',
            'employees.delete'
        ];

        // Remove the duplicate declaration and unused code
        // Start transaction
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            // First, delete all existing permissions for this role
            await connection.query('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);

            // Then, insert the default permissions
            for (const permission of defaultPermissions) {
                await connection.query('INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)', [roleId, permission]);
            }

            // If there are selected conversion permissions, insert them as well
            if (selectedConverts && Array.isArray(selectedConverts)) {
                for (const permission of selectedConverts) {
                    await connection.query('INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)', [roleId, permission]);
                }
            }

            // Commit the transaction
            await connection.commit();
        } catch (error) {
            // Rollback the transaction in case of error
            await connection.rollback();
            throw error;
        } finally {
            // Release the connection
            connection.release();
        }

        res.json({ message: "Department admin permissions updated successfully" });
    } catch (error) {
        console.error("Update department admin permissions error:", error);
        res.status(500).json({ message: "Server error" });
    }
};




// ===== ROLE MANAGEMENT =====

// Get all roles
export const getAllRoles = async (req, res) => {
    try {
        const { companyId: qCompanyId, departmentId: qDepartmentId } = req.query;
        const hasPermission = await checkUserPermission(req.user.id, 'roles.read');
        if (!hasPermission) {
            return res.status(403).json({ message: "Insufficient permissions" });
        }

        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';

        const targetCompanyId = isSuperAdmin ? (qCompanyId || null) : await getRequesterCompanyId(req.user.id);

        let sql = `
            SELECT r.id, r.name, r.description, r.department_id, r.company_id, r.created_at, r.updated_at,
                   d.name as department_name, COUNT(u.id) as user_count
            FROM roles r
            LEFT JOIN departments d ON r.department_id = d.id
            LEFT JOIN users u ON r.id = u.role_id
            WHERE (r.name != 'super_admin')
        `;

        const params = [];
        if (targetCompanyId) {
            sql += ` AND r.company_id = ?`;
            params.push(targetCompanyId);
        } else if (!isSuperAdmin) {
            return res.json({ roles: [] });
        }

        if (qDepartmentId) {
            sql += ` AND r.department_id = ?`;
            params.push(qDepartmentId);
        }

        sql += ` GROUP BY r.id, r.name, r.description, r.department_id, r.company_id, r.created_at, r.updated_at, d.name ORDER BY r.id`;
        const [roles] = await pool.query(sql, params);

        res.json({ roles });
    } catch (error) {
        console.error("Get all roles error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Get all permissions
export const getAllPermissions = async (req, res) => {
    try {
        // Check permission
        const hasPermission = await checkUserPermission(req.user.id, 'roles.read');
        if (!hasPermission) {
            return res.status(403).json({ message: "Insufficient permissions" });
        }

        const [permissions] = await pool.query(`
            SELECT * FROM permissions 
            ORDER BY module, name
        `);

        res.json({ permissions });
    } catch (error) {
        console.error("Get permissions error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Get role permissions
export const getRolePermissions = async (req, res) => {
    try {
        const { roleId } = req.params;
        const requesterCompanyId = await getRequesterCompanyId(req.user.id);
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';

        if (!isSuperAdmin) {
            const hasPermission = await checkUserPermission(req.user.id, 'roles.read');
            if (!hasPermission) return res.status(403).json({ message: "Insufficient permissions" });
        }

        let sql = `
            SELECT p.id, p.name, p.description, p.module
            FROM permissions p
            JOIN role_permissions rp ON p.id = rp.permission_id
            JOIN roles r ON rp.role_id = r.id
            WHERE rp.role_id = ?
        `;
        let params = [roleId];

        if (!isSuperAdmin) {
            sql += " AND r.company_id = ?";
            params.push(requesterCompanyId);
        }

        sql += " ORDER BY p.module, p.name";
        const [permissions] = await pool.query(sql, params);

        res.json({ permissions });
    } catch (error) {
        console.error("Get role permissions error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Update role permissions
export const updateRolePermissions = async (req, res) => {
    try {
        const { roleId } = req.params;
        const { permissionIds } = req.body;

        // Check permission
        const hasPermission = await checkUserPermission(req.user.id, 'roles.update');
        if (!hasPermission) {
            return res.status(403).json({ message: "Insufficient permissions" });
        }

        // Prevent non-super-admins from modifying super_admin role
        const userRole = await getUserRole(req.user.id);
        if (userRole?.name !== 'super_admin' && parseInt(roleId) === 1) {
            return res.status(403).json({ message: "Cannot modify super admin role" });
        }

        // Start transaction
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            // Remove existing permissions
            await connection.query('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);

            // Add new permissions
            if (permissionIds && permissionIds.length > 0) {
                const values = permissionIds.map(permId => [roleId, permId]);
                await connection.query(
                    'INSERT INTO role_permissions (role_id, permission_id) VALUES ?',
                    [values]
                );
            }

            await connection.commit();
            res.json({ message: "Role permissions updated successfully" });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error("Update role permissions error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Get all employees (renamed from getAllUsers)
export const getAllEmployees = async (req, res) => {
    try {
        const hasPermission = await checkUserPermission(req.user.id, 'employees.read');
        if (!hasPermission) {
            return res.status(403).json({ message: "Insufficient permissions" });
        }

        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';
        const requesterCompanyId = await getRequesterCompanyId(req.user.id);

        let sql = `
            SELECT u.id, u.name, u.email, u.phone, u.country_code, u.status, u.company_id,
                   u.created_at, u.updated_at, r.name as role_name, r.id as role_id,
                   d.name as department_name, d.id as department_id, c.name as company_name
            FROM users u
            LEFT JOIN roles r ON u.role_id = r.id
            LEFT JOIN departments d ON u.department_id = d.id
            LEFT JOIN companies c ON u.company_id = c.id
            WHERE (r.name != 'super_admin' OR r.name IS NULL)
        `;

        const params = [];
        if (!isSuperAdmin) {
            if (requesterCompanyId) {
                sql += ` AND u.company_id = ?`;
                params.push(requesterCompanyId);
            } else {
                return res.json({ employees: [] });
            }
        }

        sql += ` ORDER BY u.created_at DESC`;
        const [employees] = await pool.query(sql, params);

        res.json({ employees });
    } catch (error) {
        console.error("Get employees error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Update user role
export const updateUserRole = async (req, res) => {
    try {
        const { userId } = req.params;
        const { roleId } = req.body;

        // Check permission
        const hasPermission = await checkUserPermission(req.user.id, 'users.update');
        if (!hasPermission) {
            return res.status(403).json({ message: "Insufficient permissions" });
        }

        // Prevent non-super-admins from assigning super_admin role
        const userRole = await getUserRole(req.user.id);
        if (userRole?.name !== 'super_admin' && parseInt(roleId) === 1) {
            return res.status(403).json({ message: "Cannot assign super admin role" });
        }

        // Prevent users from modifying their own role
        if (parseInt(userId) === req.user.id) {
            return res.status(403).json({ message: "Cannot modify your own role" });
        }

        await pool.query('UPDATE users SET role_id = ? WHERE id = ?', [roleId, userId]);

        res.json({ message: "User role updated successfully" });
    } catch (error) {
        console.error("Update user role error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Get current user profile with permissions
export const getCurrentUserProfile = async (req, res) => {
    try {
        const [user] = await pool.query(`
            SELECT u.id, u.name, u.email, u.phone, u.country_code, u.status, u.type,
                   u.business_name, u.created_at, u.department_id, u.company_id, r.name as role_name, r.id as role_id
            FROM users u
            LEFT JOIN roles r ON u.role_id = r.id
            WHERE u.id = ?
        `, [req.user.id]);

        if (!user.length) {
            return res.status(404).json({ message: "User not found" });
        }

        const permissions = await getUserPermissions(req.user.id);
        const userRole = await getUserRole(req.user.id);

        // Get department name if user has a department
        let departmentName = null;
        if (user[0].department_id) {
            const [dept] = await pool.query(
                "SELECT name FROM departments WHERE id = ?",
                [user[0].department_id]
            );
            departmentName = dept.length ? dept[0].name : null;
        }

        const userRow = user[0];
        const isSA = userRow.type === 'super_admin';

        res.json({
            user: {
                ...userRow,
                role_name: isSA ? 'super_admin' : userRow.role_name,
                department_name: departmentName
            },
            permissions: permissions.map(p => p.name),
            role: userRole
        });
    } catch (error) {
        console.error("Get current user profile error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Create employee (renamed from createUser)
export const createEmployee = async (req, res) => {
    try {
        const { name, email, password, phone, countryCode, roleId, departmentId, companyId } = req.body;

        const hasPermission = await checkUserPermission(req.user.id, 'employees.create');
        if (!hasPermission) {
            return res.status(403).json({ message: "Insufficient permissions" });
        }

        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';
        const requesterCompanyId = await getRequesterCompanyId(req.user.id);

        // Force company_id if not super admin
        const finalCompanyId = isSuperAdmin ? (companyId || null) : requesterCompanyId;

        if (!finalCompanyId && !isSuperAdmin) {
            return res.status(403).json({ message: "Requester must belong to a company to create users" });
        }

        // Validation
        if (!name || name.trim().length < 2) {
            return res.status(422).json({ message: "Name is required (2+ chars)" });
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailRegex.test(email)) {
            return res.status(422).json({ message: "Valid email is required" });
        }
        if (!password || password.length < 6) {
            return res.status(422).json({ message: "Password must be 6+ characters" });
        }

        // Check if email already exists
        const [exists] = await pool.query("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
        if (exists.length) {
            return res.status(409).json({ message: "Email already registered" });
        }

        // Prevent creating super_admin users (role 1)
        if (parseInt(roleId) === 1) {
            return res.status(403).json({ message: "Cannot create super admin user" });
        }

        // Hash password
        const bcrypt = await import('bcryptjs');
        const password_hash = await bcrypt.default.hash(password, 12);

        const [result] = await pool.query(
            `INSERT INTO users (name, email, password, phone, country_code, role_id, department_id, company_id, type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                name.trim(),
                email.toLowerCase(),
                password_hash,
                phone || null,
                countryCode || null,
                roleId || null,
                departmentId || null,
                finalCompanyId || null,
                'user' // default type
            ]
        );

        // sync user_departments
        if (departmentId) {
            let roleName = null;
            if (roleId) {
                const [r] = await pool.query('SELECT name FROM roles WHERE id = ?', [roleId]);
                roleName = r.length ? r[0].name : null;
            }
            await pool.query(
                `INSERT IGNORE INTO user_departments (user_id, department_id, role_name) VALUES (?, ?, ?)`,
                [result.insertId, departmentId, roleName]
            );
        }

        res.status(201).json({
            message: "User created successfully",
            employee: {
                id: result.insertId,
                name: name.trim(),
                email: email.toLowerCase(),
                companyId: finalCompanyId,
                departmentId,
                roleId
            }
        });
    } catch (error) {
        console.error("Create employee error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Update employee (renamed from updateUser)
export const updateEmployee = async (req, res) => {
    try {
        const { userId } = req.params;
        const { name, email, phone, countryCode, roleId, departmentId, companyId, status, password } = req.body;

        // Check permission (super_admin or department admin can update employees)
        const hasPermission = await checkUserPermission(req.user.id, 'employees.update');
        if (!hasPermission) {
            return res.status(403).json({ message: "Insufficient permissions" });
        }

        // Get user role to determine filtering
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';

        // If not super admin, check if user is department admin and can only update users in their department
        if (!isSuperAdmin) {
            // Get user's department
            const [currentUser] = await pool.query("SELECT department_id FROM users WHERE id = ?", [req.user.id]);
            const userDepartmentId = currentUser.length > 0 ? currentUser[0].department_id : null;

            // Get target user's department
            const [targetUser] = await pool.query("SELECT department_id FROM users WHERE id = ?", [userId]);
            const targetUserDepartmentId = targetUser.length > 0 ? targetUser[0].department_id : null;

            // Check if trying to update user from a different department
            // Convert both to integers for proper comparison
            if (parseInt(targetUserDepartmentId) !== parseInt(userDepartmentId)) {
                return res.status(403).json({ message: "Department admins can only update users in their own department" });
            }

            // Check if user has admin role in their department (must be exactly 'admin' and have a department_id)
            const [userRoleCheck] = await pool.query(
                `SELECT r.name FROM users u 
                 JOIN roles r ON u.role_id = r.id 
                 WHERE u.id = ? AND r.name = 'admin' AND u.department_id IS NOT NULL`,
                [req.user.id]
            );
            if (!userRoleCheck.length) {
                return res.status(403).json({ message: "Only department admins can update users" });
            }
        }

        // Validation
        if (name && name.trim().length < 2) {
            return res.status(422).json({ message: "Name must be at least 2 characters" });
        }
        if (email) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(422).json({ message: "Valid email is required" });
            }
            // Check if email is taken by another user
            const [exists] = await pool.query("SELECT id FROM users WHERE email = ? AND id != ? LIMIT 1", [email, userId]);
            if (exists.length) {
                return res.status(409).json({ message: "Email already in use" });
            }
        }
        if (phone && phone.length > 0 && phone.length < 7) {
            return res.status(422).json({ message: "Phone number must be at least 7 digits" });
        }

        // Prevent creating super_admin role
        if (roleId && parseInt(roleId) === 1) {
            return res.status(403).json({ message: "Cannot assign super admin role" });
        }

        // Prevent users from modifying their own account
        if (parseInt(userId) === req.user.id) {
            return res.status(403).json({ message: "Cannot modify your own account" });
        }

        // Build update query dynamically
        const updates = [];
        const values = [];

        if (name !== undefined) {
            updates.push('name = ?');
            values.push(name.trim());
        }
        if (email !== undefined) {
            updates.push('email = ?');
            values.push(email.toLowerCase());
        }
        if (phone !== undefined) {
            updates.push('phone = ?');
            values.push(phone || null);
        }
        if (countryCode !== undefined) {
            updates.push('country_code = ?');
            values.push(countryCode || null);
        }
        if (roleId !== undefined) {
            updates.push('role_id = ?');
            values.push(roleId);
        }
        if (departmentId !== undefined) {
            updates.push('department_id = ?');
            values.push(departmentId);
        }
        if (companyId !== undefined) {
            updates.push('company_id = ?');
            values.push(companyId);
        }
        if (status !== undefined) {
            updates.push('status = ?');
            values.push(status);
        }
        // Add password update if provided
        if (password !== undefined && password.trim() !== '') {
            // Hash the new password
            const bcrypt = await import('bcryptjs');
            const password_hash = await bcrypt.default.hash(password, 12);
            updates.push('password = ?');
            values.push(password_hash);
        }

        if (updates.length === 0) {
            return res.status(422).json({ message: "No valid fields to update" });
        }

        values.push(userId);
        const query = `UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;

        await pool.query(query, values);

        // If dept/role changed (or might have), refresh user_departments
        if (departmentId !== undefined || roleId !== undefined) {
            // read back latest dept & role
            const [[u]] = await pool.query(
                `SELECT department_id, role_id FROM users WHERE id = ?`,
                [userId]
            );

            // resolve role name (nullable)
            let roleName = null;
            if (u?.role_id) {
                const [r] = await pool.query('SELECT name FROM roles WHERE id = ?', [u.role_id]);
                roleName = r.length ? r[0].name : null;
            }

            if (u?.department_id) {
                // upsert row for this user/department
                await pool.query(
                    `INSERT INTO user_departments (user_id, department_id, role_name)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         department_id = VALUES(department_id),
         role_name     = VALUES(role_name)`,
                    [userId, u.department_id, roleName]
                );
            } else {
                // no department anymore → remove mapping
                await pool.query(`DELETE FROM user_departments WHERE user_id = ?`, [userId]);
            }
        }

        res.json({ message: "Employee updated successfully" });
    } catch (error) {
        console.error("Update employee error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Delete employee (renamed from deleteUser)
export const deleteEmployee = async (req, res) => {
    try {
        const { userId } = req.params;

        // Check permission (super_admin or department admin can delete employees)
        const hasPermission = await checkUserPermission(req.user.id, 'employees.delete');
        if (!hasPermission) {
            return res.status(403).json({ message: "Insufficient permissions" });
        }

        // Get user role to determine filtering
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';

        // If not super admin, check if user is department admin and can only delete users in their department
        if (!isSuperAdmin) {
            // Get user's department
            const [currentUser] = await pool.query("SELECT department_id FROM users WHERE id = ?", [req.user.id]);
            const userDepartmentId = currentUser.length > 0 ? currentUser[0].department_id : null;

            // Get target user's department
            const [targetUser] = await pool.query("SELECT department_id FROM users WHERE id = ?", [userId]);
            const targetUserDepartmentId = targetUser.length > 0 ? targetUser[0].department_id : null;

            // Check if trying to delete user from a different department
            // Convert both to integers for proper comparison
            if (parseInt(targetUserDepartmentId) !== parseInt(userDepartmentId)) {
                return res.status(403).json({ message: "Department admins can only delete users in their own department" });
            }

            // Check if user has admin role in their department (must be exactly 'admin' and have a department_id)
            const [userRoleCheck] = await pool.query(
                `SELECT r.name FROM users u 
                 JOIN roles r ON u.role_id = r.id 
                 WHERE u.id = ? AND r.name = 'admin' AND u.department_id IS NOT NULL`,
                [req.user.id]
            );
            if (!userRoleCheck.length) {
                return res.status(403).json({ message: "Only department admins can delete users" });
            }
        }

        // Prevent users from deleting their own account
        if (parseInt(userId) === req.user.id) {
            return res.status(403).json({ message: "Cannot delete your own account" });
        }

        // Delete user
        await pool.query("DELETE FROM users WHERE id = ?", [userId]);

        res.json({ message: "Employee deleted successfully" });
    } catch (error) {
        console.error("Delete employee error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Create custom role (with department mapping)
export const createRole = async (req, res) => {
    try {
        const { name, description, permissions, departmentId, companyId } = req.body;
        const requesterCompanyId = await getRequesterCompanyId(req.user.id);
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';

        if (!isSuperAdmin) {
            const hasPermission = await checkUserPermission(req.user.id, 'roles.create');
            if (!hasPermission) return res.status(403).json({ message: "Insufficient permissions" });
        }

        const targetCompanyId = isSuperAdmin ? (companyId || null) : requesterCompanyId;
        if (!name || name.trim().length < 2) return res.status(422).json({ message: "Name required (2+ chars)" });

        const [exists] = await pool.query(
            "SELECT id FROM roles WHERE name = ? AND (company_id = ? OR company_id IS NULL) AND (department_id = ? OR department_id IS NULL) LIMIT 1",
            [name.trim(), targetCompanyId, departmentId || null]
        );
        if (exists.length) return res.status(409).json({ message: "Role name already exists in this context" });

        const connection = await pool.getConnection();
        await connection.beginTransaction();
        try {
            const [result] = await connection.query(
                "INSERT INTO roles (name, description, department_id, company_id) VALUES (?, ?, ?, ?)",
                [name.trim(), description || null, departmentId || null, targetCompanyId]
            );
            const roleId = result.insertId;

            if (permissions && permissions.length > 0) {
                for (const pId of permissions) {
                    await connection.query("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [roleId, pId]);
                }
            }
            await connection.commit();
            res.status(201).json({ message: "Role created", roleId });
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error("Create role error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

export const deleteRole = async (req, res) => {
    try {
        const { roleId } = req.params;
        const requesterCompanyId = await getRequesterCompanyId(req.user.id);
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';

        if (!isSuperAdmin) {
            const hasPermission = await checkUserPermission(req.user.id, 'roles.delete');
            if (!hasPermission) return res.status(403).json({ message: "Insufficient permissions" });
        }

        let checkSql = "SELECT id FROM roles WHERE id = ?";
        let checkParams = [roleId];
        if (!isSuperAdmin) { checkSql += " AND company_id = ?"; checkParams.push(requesterCompanyId); }

        const [existing] = await pool.query(checkSql, checkParams);
        if (!existing.length) return res.status(404).json({ message: "Role not found or access denied" });

        if (parseInt(roleId) === 1) return res.status(403).json({ message: "Cannot delete super admin role" });

        await pool.query("DELETE FROM roles WHERE id = ?", [roleId]);
        res.json({ message: "Role deleted successfully" });
    } catch (error) {
        console.error("Delete role error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

export const updateRole = async (req, res) => {
    try {
        const { roleId } = req.params;
        const { name, description, permissions, departmentId } = req.body;

        // Check permission (only super_admin can update roles)
        const hasPermission = await checkUserPermission(req.user.id, 'roles.update');
        if (!hasPermission) {
            return res.status(403).json({ message: "Insufficient permissions" });
        }

        // Prevent updating super_admin role
        if (parseInt(roleId) === 1) {
            return res.status(403).json({ message: "Cannot update super admin role" });
        }

        // Validate input
        if (!name || name.trim().length < 2) {
            return res.status(422).json({ message: "Role name is required (2+ chars)" });
        }

        // Validate that only 'admin' and 'user' are allowed as role names
        if (name !== 'admin' && name !== 'user') {
            return res.status(422).json({ message: "Role name must be either 'admin' or 'user'" });
        }

        // Check if another role with the same name already exists in the same department
        let existingRoleQuery = "SELECT id FROM roles WHERE name = ? AND id != ?";
        let existingRoleParams = [name.trim(), roleId];

        if (departmentId) {
            existingRoleQuery += " AND department_id = ?";
            existingRoleParams.push(departmentId);
        } else {
            existingRoleQuery += " AND department_id IS NULL";
        }

        const [existingRole] = await pool.query(existingRoleQuery, existingRoleParams);
        if (existingRole.length > 0) {
            return res.status(409).json({ message: departmentId ? "Role name already exists in this department" : "System role with this name already exists" });
        }

        // Automatically assign permissions based on role type if not provided
        let permissionsToAssign = permissions || [];
        if (permissionsToAssign.length === 0) {
            if (name === 'admin') {
                // For admin roles, assign default permissions automatically:
                // - Dashboard access for that department
                // - Roles and permission management access
                // - User management access
                // - Department management access (only vat_filing and ct_filing)
                // - Company management access
                // - Customer management access
                permissionsToAssign = [
                    'dashboard.read',
                    'roles.read',
                    'roles.create',
                    'roles.update',
                    'roles.delete',
                    'employees.read',
                    'employees.create',
                    'employees.update',
                    'employees.delete',
                    'projects.vat_filing',
                    'projects.ct_filing',
                    'customers.read',
                    'customers.create',
                    'customers.update',
                    'customers.delete'
                ];
            } else if (name === 'user') {
                // For user roles, start with no permissions (admin will assign them)
                permissionsToAssign = [];
            }
        }

        // Start transaction
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            // Update the role
            await connection.query(
                "UPDATE roles SET name = ?, description = ? WHERE id = ?",
                [name.trim(), description || null, roleId]
            );

            // Update permissions - first remove all existing permissions
            await connection.query('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);

            // Add new permissions
            if (permissionsToAssign && permissionsToAssign.length > 0) {
                // Get permission IDs based on permission names
                const permissionIds = [];
                for (const permissionName of permissionsToAssign) {
                    const [permResult] = await connection.query(
                        'SELECT id FROM permissions WHERE name = ?',
                        [permissionName]
                    );
                    if (permResult.length > 0) {
                        permissionIds.push(permResult[0].id);
                    }
                }

                // Insert role-permission mappings
                if (permissionIds.length > 0) {
                    const rolePermissionValues = permissionIds.map(permId => [roleId, permId]);
                    await connection.query(
                        'INSERT INTO role_permissions (role_id, permission_id) VALUES ?',
                        [rolePermissionValues]
                    );
                }
            }

            await connection.commit();
            res.json({ message: "Role updated successfully" });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error("Update role error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// IP Address Management Functions

