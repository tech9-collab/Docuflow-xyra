import React, { useState, useEffect } from 'react';
import { Shield, Plus, Edit2, Trash2, Save, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../helper/helper';
import './RolesPermissions.css';

export default function RolesPermissions() {
    // Set document title
    useEffect(() => {
        document.title = "Xyra Books - Roles & Permissions";
    }, []);

    const { isSuperAdmin, user } = useAuth();
    const [roles, setRoles] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    // Role management states
    const [showRoleForm, setShowRoleForm] = useState(false);
    const [editingRole, setEditingRole] = useState(null);
    const [newRole, setNewRole] = useState({
        name: 'user', // Default to user role
        description: '',
        departmentId: '',
        menus: []
    });

    // Available menu options
    const availableMenus = [
        // System permissions (only for admin roles)
        { id: 'dashboard.read', name: 'Dashboard Access', category: 'System' },
        { id: 'roles.read', name: 'View Roles', category: 'Role & Permission Management' },
        { id: 'roles.create', name: 'Create Roles', category: 'Role & Permission Management' },
        { id: 'roles.update', name: 'Edit Roles', category: 'Role & Permission Management' },
        { id: 'roles.delete', name: 'Delete Roles', category: 'Role & Permission Management' },
        { id: 'employees.read', name: 'View Users', category: 'User Management' },
        { id: 'employees.create', name: 'Create Users', category: 'User Management' },
        { id: 'employees.update', name: 'Edit Users', category: 'User Management' },
        { id: 'employees.delete', name: 'Delete Users', category: 'User Management' },
        // Department permissions (only keep vat_filing and ct_filing)
        { id: 'projects.vat_filing', name: 'VAT Filing', category: 'Departments' },
        { id: 'projects.ct_filing', name: 'CT Filing', category: 'Departments' },
        // Customer Management permissions
        { id: 'customers.read', name: 'View Customers', category: 'Customer Management' },
        { id: 'customers.create', name: 'Create Customers', category: 'Customer Management' },
        { id: 'customers.update', name: 'Edit Customers', category: 'Customer Management' },
        { id: 'customers.delete', name: 'Delete Customers', category: 'Customer Management' },
        // Convert permissions
        { id: 'converts.bank_statements', name: 'Bank Statements', category: 'Converts' },
        { id: 'converts.invoices', name: 'Invoices', category: 'Converts' },
        { id: 'converts.bills', name: 'Bills', category: 'Converts' },
        { id: 'converts.emirates_id', name: 'Emirates ID', category: 'Converts' },
        { id: 'converts.passport', name: 'Passport', category: 'Converts' },
        { id: 'converts.visa', name: 'Visa', category: 'Converts' },
        { id: 'converts.trade_license', name: 'Trade License', category: 'Converts' }
    ];

    // Group menus by category
    const menusByCategory = availableMenus.reduce((acc, menu) => {
        if (!acc[menu.category]) acc[menu.category] = [];
        acc[menu.category].push(menu);
        return acc;
    }, {});

    // Check access - allow both super admins and department admins
    if (!isSuperAdmin() && (!user.department_id || !user.role_name || user.role_name !== 'admin')) {
        return (
            <div className="roles-permissions-page">
                <div className="access-denied">
                    <Shield size={64} />
                    <h2>Access Denied</h2>
                    <p>You don't have permission to access this page.</p>
                </div>
            </div>
        );
    }

    useEffect(() => {
        fetchRoles();
    }, []);

    const fetchRoles = async () => {
        setLoading(true);
        setError('');

        try {
            // Department admins can only see roles from their own department
            if (!isSuperAdmin() && user.department_id) {
                const rolesRes = await api.get(`/admin/departments/${user.department_id}/roles`);
                // Filter to only department roles (admin and user)
                const deptRoles = (rolesRes.data.roles || []).filter(
                    role => (role.name === 'admin' || role.name === 'user') && role.department_id == user.department_id
                );
                setRoles(deptRoles);

                // For department admins, only show their own department
                const departmentsRes = await api.get(`/admin/departments/${user.department_id}`);
                const deptData = departmentsRes.data.department || departmentsRes.data.departments || departmentsRes.data;
                setDepartments(Array.isArray(deptData) ? deptData : [deptData]);
            } else {
                // Super admin sees all roles and departments
                const [rolesRes, departmentsRes] = await Promise.all([
                    api.get('/admin/roles'),
                    api.get('/admin/departments')
                ]);
                // Filter to only admin and user roles
                setRoles((rolesRes.data.roles || []).filter(role => role.name === 'admin' || role.name === 'user'));
                setDepartments(departmentsRes.data.departments || []);
            }
        } catch (err) {
            setError(err.message || 'Failed to fetch data');
        } finally {
            setLoading(false);
        }
    };

    const fetchRolePermissions = async (roleId) => {
        try {
            const res = await api.get(`/admin/roles/${roleId}/permissions`);
            return res.data.permissions.map(p => p.name);
        } catch (err) {
            console.error('Failed to fetch role permissions:', err);
            return [];
        }
    };

    const createRole = async () => {
        if (!newRole.name.trim()) {
            setError('Role name is required');
            return;
        }

        // Validate role name
        if (newRole.name !== 'admin' && newRole.name !== 'user') {
            setError('Role name must be either "admin" or "user"');
            return;
        }

        // Department admins can only create roles for their own department
        const departmentId = isSuperAdmin() ? newRole.departmentId : user.department_id;

        if (!isSuperAdmin() && !departmentId) {
            setError('Department is required');
            return;
        }

        // Check if role already exists in this department
        const existingRole = roles.find(role =>
            role.name === newRole.name &&
            role.department_id == departmentId
        );

        if (existingRole) {
            setError(`A ${newRole.name} role already exists for this department`);
            return;
        }

        // Auto-assign permissions for admin roles
        let permissionsToAssign = [...newRole.menus];
        if (newRole.name === 'admin') {
            // For admin roles, automatically include essential permissions if not already selected
            // Only include project permissions that are actually selected
            const essentialPermissions = [
                'dashboard.read',
                'roles.read', 'roles.create', 'roles.update', 'roles.delete',
                'employees.read', 'employees.create', 'employees.update', 'employees.delete'
            ];

            // Add essential permissions that aren't already selected
            essentialPermissions.forEach(permission => {
                if (!permissionsToAssign.includes(permission)) {
                    permissionsToAssign.push(permission);
                }
            });
        }

        try {
            const payload = {
                name: newRole.name,
                description: newRole.description,
                departmentId: departmentId,
                permissions: permissionsToAssign
            };

            await api.post('/admin/roles', payload);
            setSuccess('Role created successfully');
            setNewRole({ name: 'user', description: '', departmentId: '', menus: [] });
            setShowRoleForm(false);
            fetchRoles();
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.message || 'Failed to create role');
        }
    };

    const updateRole = async () => {
        if (!editingRole) {
            setError('No role selected for update');
            return;
        }

        // Department admins can only update roles for their own department
        const departmentId = isSuperAdmin() ? newRole.departmentId : user.department_id;

        if (!isSuperAdmin() && !departmentId) {
            setError('Department is required');
            return;
        }

        // Auto-assign permissions for admin roles
        let permissionsToAssign = [...newRole.menus];
        if (newRole.name === 'admin') {
            // For admin roles, automatically include essential permissions if not already selected
            // Only include project permissions that are actually selected
            const essentialPermissions = [
                'dashboard.read',
                'roles.read', 'roles.create', 'roles.update', 'roles.delete',
                'employees.read', 'employees.create', 'employees.update', 'employees.delete'
            ];

            // Add essential permissions that aren't already selected
            essentialPermissions.forEach(permission => {
                if (!permissionsToAssign.includes(permission)) {
                    permissionsToAssign.push(permission);
                }
            });
        }

        try {
            await api.put(`/admin/roles/${editingRole.id}`, {
                name: newRole.name,
                description: newRole.description,
                departmentId: departmentId,
                permissions: permissionsToAssign
            });
            setSuccess('Role updated successfully');
            setNewRole({ name: 'user', description: '', departmentId: '', menus: [] });
            setEditingRole(null);
            setShowRoleForm(false);
            fetchRoles();
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.message || 'Failed to update role');
        }
    };

    const deleteRole = async (roleId) => {
        // Check if the role belongs to the department admin's department
        const roleToDelete = roles.find(r => r.id === roleId);
        // Convert both to integers for proper comparison
        if (!isSuperAdmin() && roleToDelete && parseInt(roleToDelete.department_id) !== parseInt(user.department_id)) {
            setError('You can only delete roles in your own department');
            return;
        }

        if (!confirm('Are you sure you want to delete this role? This action cannot be undone.')) {
            return;
        }

        try {
            await api.delete(`/admin/roles/${roleId}`);
            setSuccess('Role deleted successfully');
            fetchRoles();
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.message || 'Failed to delete role');
        }
    };

    const startEditRole = async (role) => {
        // Department admins can only edit roles in their own department
        // Convert both to integers for proper comparison
        if (!isSuperAdmin() && parseInt(role.department_id) !== parseInt(user.department_id)) {
            setError('You can only edit roles in your own department');
            return;
        }

        try {
            const permissions = await fetchRolePermissions(role.id);
            setEditingRole(role);
            setNewRole({
                name: role.name,
                description: role.description || '',
                departmentId: role.department_id || '',
                menus: permissions
            });
            setShowRoleForm(true);
        } catch (err) {
            setError(err.message || 'Failed to load role details');
        }
    };

    const cancelEditRole = () => {
        setEditingRole(null);
        setShowRoleForm(false);
        setNewRole({ name: 'user', description: '', departmentId: '', menus: [] });
    };

    const handleMenuChange = (menuId) => {
        setNewRole(prev => {
            const menus = [...prev.menus];
            if (menus.includes(menuId)) {
                return { ...prev, menus: menus.filter(id => id !== menuId) };
            } else {
                return { ...prev, menus: [...menus, menuId] };
            }
        });
    };

    // Select all permissions in a category
    const selectAllInCategory = (category) => {
        const categoryMenus = menusByCategory[category] || [];
        const allSelected = categoryMenus.every(menu => newRole.menus.includes(menu.id));

        if (allSelected) {
            // Deselect all
            setNewRole(prev => ({
                ...prev,
                menus: prev.menus.filter(id => !categoryMenus.some(menu => menu.id === id))
            }));
        } else {
            // Select all
            setNewRole(prev => {
                const newMenus = [...prev.menus];
                categoryMenus.forEach(menu => {
                    if (!newMenus.includes(menu.id)) {
                        newMenus.push(menu.id);
                    }
                });
                return { ...prev, menus: newMenus };
            });
        }
    };

    return (
        <div className="roles-permissions-page">
            <div className="page-header">
                <div className="header-left">
                    <h1>Role & Permission Management</h1>
                    <p>Manage roles and assign permissions</p>
                </div>
                <div className="header-actions">
                    {/* Both super admins and department admins can create roles */}
                    {(isSuperAdmin() || (user.department_id && user.role_name === 'admin')) && (
                        <button
                            className="btn-primary"
                            onClick={() => {
                                setEditingRole(null);
                                setNewRole({ name: 'user', description: '', departmentId: isSuperAdmin() ? '' : user.department_id, menus: [] });
                                setShowRoleForm(true);
                            }}
                        >
                            <Plus size={16} />
                            Add Role
                        </button>
                    )}
                </div>
            </div>

            {error && <div className="alert error">{error}</div>}
            {success && <div className="alert success">{success}</div>}

            {/* Role Creation/Edit Form */}
            {showRoleForm && (
                <div className="role-form-container">
                    <div className="role-form">
                        <h3>{editingRole ? 'Edit Role' : 'Create New Role'}</h3>

                        <div className="form-grid">
                            <div className="form-group">
                                <label>Role Name *</label>
                                <select
                                    value={newRole.name}
                                    onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
                                    disabled={editingRole} // Cannot change role name when editing
                                >
                                    <option value="user">User</option>
                                    {isSuperAdmin() && <option value="admin">Admin</option>}
                                </select>
                                <p className="help-text">Only "user" and "admin" roles are allowed</p>
                            </div>

                            <div className="form-group">
                                <label>Description</label>
                                <input
                                    type="text"
                                    value={newRole.description}
                                    onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
                                    placeholder="Enter role description"
                                />
                            </div>

                            {!isSuperAdmin() && (
                                <div className="form-group">
                                    <label>Department</label>
                                    <input
                                        type="text"
                                        value={departments.find(d => d.id == user.department_id)?.name || ''}
                                        disabled
                                    />
                                    <p className="help-text">Department is automatically set to your department</p>
                                </div>
                            )}

                            {isSuperAdmin() && (
                                <div className="form-group">
                                    <label>Department *</label>
                                    <select
                                        value={newRole.departmentId}
                                        onChange={(e) => setNewRole({ ...newRole, departmentId: e.target.value })}
                                    >
                                        <option value="">Select Department</option>
                                        {departments.map(dept => (
                                            <option key={dept.id} value={dept.id}>{dept.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                                <label>Permissions</label>
                                <div className="permissions-grid">
                                    {Object.entries(menusByCategory).map(([category, menus]) => (
                                        <div key={category} className="permission-category">
                                            <div className="category-header">
                                                <h4>{category}</h4>
                                                <button
                                                    className="select-all-btn"
                                                    onClick={() => selectAllInCategory(category)}
                                                >
                                                    {menus.every(menu => newRole.menus.includes(menu.id)) ? 'Deselect All' : 'Select All'}
                                                </button>
                                            </div>
                                            <div className="permission-list">
                                                {menus.map(menu => (
                                                    <label key={menu.id} className="permission-checkbox">
                                                        <input
                                                            type="checkbox"
                                                            checked={newRole.menus.includes(menu.id)}
                                                            onChange={() => handleMenuChange(menu.id)}
                                                        />
                                                        {menu.name}
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="form-actions">
                            <button className="btn-save" onClick={editingRole ? updateRole : createRole}>
                                <Save size={16} />
                                {editingRole ? 'Update Role' : 'Create Role'}
                            </button>
                            <button className="btn-cancel" onClick={cancelEditRole}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="roles-section">
                <div className="section-header">
                    <h3>Role Management</h3>
                    <span className="role-count">{roles.length} total roles</span>
                </div>

                {loading ? (
                    <div className="loading">Loading roles...</div>
                ) : (
                    <div className="roles-table-container">
                        <table className="roles-table">
                            <thead>
                                <tr>
                                    <th>Role Name</th>
                                    <th>Department</th>
                                    <th>Description</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {roles.map(role => (
                                    <tr key={role.id}>
                                        <td>
                                            <div className="role-name">
                                                <Shield size={16} />
                                                {role.name}
                                            </div>
                                        </td>
                                        <td>
                                            <span className="role-department">
                                                {role.department_name || 'System'}
                                            </span>
                                        </td>
                                        <td>
                                            <span className="role-description">
                                                {role.description || 'No description'}
                                            </span>
                                        </td>
                                        <td>
                                            <div className="action-buttons">
                                                <button
                                                    className="btn-edit"
                                                    onClick={() => startEditRole(role)}
                                                    title="Edit role"
                                                >
                                                    <Edit2 size={14} />
                                                </button>
                                                <button
                                                    className="btn-delete"
                                                    onClick={() => deleteRole(role.id)}
                                                    title="Delete role"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {roles.length === 0 && !loading && (
                            <div className="no-data">
                                <Shield size={48} />
                                <p>No roles found</p>
                                <p>Create your first role to get started</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
