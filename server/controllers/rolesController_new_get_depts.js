export const getAllDepartments = async (req, res) => {
    try {
        const { companyId: qCompanyId } = req.query;
        const userRole = await getUserRole(req.user.id);
        const isSuperAdmin = userRole?.name === 'super_admin';

        let targetCompanyId = isSuperAdmin ? (qCompanyId || null) : await getRequesterCompanyId(req.user.id);

        const [tableColumns] = await pool.query("SHOW COLUMNS FROM departments");
        const existingColumns = tableColumns.map(col => col.Field);

        let selectCols = ['d.id', 'd.name', 'd.created_at', 'd.updated_at'];
        if (existingColumns.includes('company_id')) selectCols.push('d.company_id');
        if (existingColumns.includes('description')) selectCols.push('d.description');
        if (existingColumns.includes('location')) selectCols.push('d.location');
        if (existingColumns.includes('manager')) selectCols.push('d.manager');
        if (existingColumns.includes('budget')) selectCols.push('d.budget');
        if (existingColumns.includes('status')) selectCols.push('d.status');

        let queryContext = `
            SELECT ${selectCols.join(', ')}, COUNT(u.id) as employee_count
            FROM departments d
            LEFT JOIN users u ON d.id = u.department_id
        `;

        const params = [];
        if (targetCompanyId) {
            queryContext += ` WHERE d.company_id = ?`;
            params.push(targetCompanyId);
        } else if (!isSuperAdmin) {
            // For safety, non-super admins MUST have a company context
            return res.json({ departments: [] });
        }

        queryContext += ` GROUP BY ${selectCols.join(', ')} ORDER BY d.created_at DESC`;
        const [departments] = await pool.query(queryContext, params);

        res.json({ departments });
    } catch (error) {
        console.error("Get all departments error:", error);
        res.status(500).json({ message: "Server error" });
    }
};
