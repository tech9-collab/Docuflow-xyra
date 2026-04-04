import React, { useState, useEffect } from 'react';
import { 
    Users, 
    Plus, 
    Edit2, 
    Trash2, 
    Save, 
    X, 
    Shield, 
    UserPlus, 
    Eye, 
    EyeOff,
    Layers,
    Key
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../helper/helper';
import './RolesPermissions.css';

export default function RolesPermissions() {
    // Set document title
    useEffect(() => {
        document.title = "Xyra Books - Roles & Permissions";
    }, []);

    const { hasPermission, isSuperAdmin, user } = useAuth();
    const [activeTab, setActiveTab] = useState('users');
    const [users, setUsers] = useState([]);
    const [roles, setRoles] = useState([]);
    const [permissions, setPermissions] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    
    // Role permissions management
    const [selectedRole, setSelectedRole] = useState(null);
    const [rolePermissions, setRolePermissions] = useState([]);
    const [expandedModules, setExpandedModules] = useState({});
    
    // CRUD states
    const [showUserForm, setShowUserForm] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const [newUser, setNewUser] = useState({
        name: '',
        email: '',
        password: '',
        phone: '',
        countryCode: '',
        roleId: '',
        departmentId: ''
    });
    const [newRole, setNewRole] = useState({ 
        name: '', 
        description: '', 
        departmentId: '',
        permissions: []
    });
    const [showRoleForm, setShowRoleForm] = useState(false);
    const [newDepartment, setNewDepartment] = useState({ name: '', description: '', managerName: '', budget: '' });
    const [showDeptForm, setShowDeptForm] = useState(false);
    const [editingDepartment, setEditingDepartment] = useState(null);
    
    // Department menu management states
    const [selectedDepartmentForMenus, setSelectedDepartmentForMenus] = useState(null);
    const [departmentMenus, setDepartmentMenus] = useState([]);
    const [availableMenuItems] = useState([
        { id: 'converts.bank_statements', name: 'Bank Statements', category: 'Converts' },
        { id: 'converts.invoices', name: 'Invoices', category: 'Converts' },
        { id: 'converts.bills', name: 'Bills', category: 'Converts' },
        { id: 'converts.emirates_id', name: 'Emirates ID', category: 'Converts' },
        { id: 'converts.passport', name: 'Passport', category: 'Converts' },
        { id: 'converts.visa', name: 'Visa', category: 'Converts' },
        { id: 'converts.trade_license', name: 'Trade License', category: 'Converts' },
        { id: 'admin.dashboard', name: 'Dashboard', category: 'Administration' },
        { id: 'admin.users', name: 'User Management', category: 'Administration' }
    ]);

    // Check if user has access to this page
    // Allow both super admins and department admins to access this page
    if (!isSuperAdmin() && (!user.department_id || !user.role_name || !user.role_name.includes('admin'))) {
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
        fetchData();
    }, [activeTab]);

    const fetchData = async () => {
        setLoading(true);
        setError('');
        
        try {
            switch (activeTab) {
                case 'users':
                    if (hasPermission('users.read')) {
                        // For department admins, only fetch users from their department
                        if (!isSuperAdmin() && user.department_id) {
                            const [usersRes, rolesRes, deptsRes] = await Promise.all([
                                api.get(`/admin/departments/${user.department_id}/users`),
                                api.get('/admin/roles'),
                                api.get('/admin/departments')
                            ]);
                            // Filter users to only those in the department admin's department
                            const deptUsers = usersRes.data.users || usersRes.data.employees || [];
                            setUsers(deptUsers);
                            // Filter roles to only those in the department admin's department
                            const deptRoles = (rolesRes.data.roles || []).filter(role => 
                                role.department_id == user.department_id || !role.department_id
                            );
                            setRoles(deptRoles);
                            // Filter departments to only the admin's department
                            const adminDept = (deptsRes.data.departments || []).filter(dept => 
                                dept.id == user.department_id
                            );
                            setDepartments(adminDept);
                        } else {
                            // Super admin sees all users
                            const [usersRes, rolesRes, deptsRes] = await Promise.all([
                                api.get('/admin/users'),
                                api.get('/admin/roles'),
                                api.get('/admin/departments')
                            ]);
                            setUsers(usersRes.data.users || []);
                            setRoles(rolesRes.data.roles || []);
                            setDepartments(deptsRes.data.departments || []);
                        }
                    }
                    break;
                case 'roles':
                    if (hasPermission('roles.read')) {
                        // For department admins, only fetch roles from their department
                        if (!isSuperAdmin() && user.department_id) {
                            const [rolesRes, permissionsRes] = await Promise.all([
                                api.get(`/admin/departments/${user.department_id}/roles`),
                                api.get('/admin/permissions')
                            ]);
                            // Filter roles to only those in the department admin's department
                            const deptRoles = (rolesRes.data.roles || []).filter(role => 
                                role.department_id == user.department_id
                            );
                            setRoles(deptRoles);
                            setPermissions(permissionsRes.data.permissions || []);
                        } else {
                            // Super admin sees all roles
                            const [rolesRes, permissionsRes] = await Promise.all([
                                api.get('/admin/roles'),
                                api.get('/admin/permissions')
                            ]);
                            setRoles(rolesRes.data.roles || []);
                            setPermissions(permissionsRes.data.permissions || []);
                        }
                    }
                    break;
                case 'departments':
                    if (hasPermission('departments.read')) {
                        // For department admins, only show their own department
                        if (!isSuperAdmin() && user.department_id) {
                            const departmentsRes = await api.get(`/admin/departments/${user.department_id}`);
                            // If the API returns a single department object, wrap it in an array
                            const deptData = departmentsRes.data.department || departmentsRes.data.departments || departmentsRes.data;
                            setDepartments(Array.isArray(deptData) ? deptData : [deptData]);
                        } else {
                            // Super admin sees all departments
                            const departmentsRes = await api.get('/admin/departments');
                            setDepartments(departmentsRes.data.departments || []);
                        }
                    }
                    break;
                case 'department-menus':
                    if (hasPermission('departments.read')) {
                        // Department admins can only manage their own department's menus
                        if (!isSuperAdmin() && user.department_id) {
                            const departmentsRes = await api.get(`/admin/departments/${user.department_id}`);
                            // If the API returns a single department object, wrap it in an array
                            const deptData = departmentsRes.data.department || departmentsRes.data.departments || departmentsRes.data;
                            setDepartments(Array.isArray(deptData) ? deptData : [deptData]);
                        } else {
                            const departmentsRes = await api.get('/admin/departments');
                            setDepartments(departmentsRes.data.departments || []);
                        }
                    }
                    break;
            }
        } catch (err) {
            setError(err.message || 'Failed to fetch data');
        } finally {
            setLoading(false);
        }
    };

    const updateUserRole = async (userId, roleId) => {
        try {
            await api.put(`/admin/users/${userId}/role`, { roleId });
            setSuccess('User role updated successfully');
            fetchData();
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.message || 'Failed to update user role');
        }
    };

    const fetchRolePermissions = async (roleId) => {
        try {
            const response = await api.get(`/admin/roles/${roleId}/permissions`);
            setRolePermissions(response.data.permissions || []);
        } catch (err) {
            setError(err.message || 'Failed to fetch role permissions');
        }
    };

    const updateRolePermissions = async (roleId, permissionIds) => {
        try {
            await api.put(`/admin/roles/${roleId}/permissions`, { permissionIds });
            setSuccess('Role permissions updated successfully');
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.message || 'Failed to update role permissions');
        }
    };

    const handleRoleSelect = (role) => {
        // Department admins can only manage roles in their own department
        if (!isSuperAdmin() && role.department_id != user.department_id) {
            setError('You can only manage roles in your own department');
            return;
        }
        
        setSelectedRole(role);
        fetchRolePermissions(role.id);
        // Expand all modules by default when selecting a role
        const moduleNames = [...new Set(permissions.map(p => p.module))];
        const expanded = {};
        moduleNames.forEach(module => {
            expanded[module] = true;
        });
        setExpandedModules(expanded);
    };

    const startEditUser = (user) => {
        setEditingUser({ ...user });
    };

    const cancelEditUser = () => {
        setEditingUser(null);
    };

    const saveUserChanges = async () => {
        try {
            await api.put(`/admin/users/${editingUser.id}/role`, { roleId: editingUser.role_id });
            setSuccess('User updated successfully');
            setEditingUser(null);
            fetchData();
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.message || 'Failed to update user');
        }
    };

    // User CRUD functions
    const createUser = async () => {
        if (!newUser.name.trim() || !newUser.email.trim() || !newUser.password.trim()) {
            setError('Name, email, and password are required');
            return;
        }
        
        try {
            await api.post('/admin/employees', newUser);
            setSuccess('User created successfully');
            setNewUser({
                name: '',
                email: '',
                password: '',
                phone: '',
                countryCode: '',
                roleId: '',
                departmentId: ''
                // Removed organizationId
            });
            setShowUserForm(false);
            fetchData();
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.message || 'Failed to create user');
        }
    };

    const deleteUser = async (userId) => {
        if (!window.confirm('Are you sure you want to delete this user?')) return;
        
        try {
            await api.delete(`/admin/employees/${userId}`);
            setSuccess('User deleted successfully');
            fetchData();
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.message || 'Failed to delete user');
        }
    };

    // Role CRUD functions
    const createRole = async () => {
        if (!newRole.name.trim()) {
            setError('Role name is required');
            return;
        }
        
        try {
            await api.post('/admin/roles', newRole);
            setSuccess('Role created successfully');
            setNewRole({ name: '', description: '', departmentId: '', permissions: [] });
            setShowRoleForm(false);
            fetchData();
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.message || 'Failed to create role');
        }
    };

    const updateRole = async () => {
        if (!selectedRole.name.trim()) {
            setError('Role name is required');
            return;
        }
        
        try {
            await api.put(`/admin/roles/${selectedRole.id}`, selectedRole);
            setSuccess('Role updated successfully');
            setSelectedRole(null);
            fetchData();
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.message || 'Failed to update role');
        }
    };

    const deleteRole = async (roleId) => {
        if (!window.confirm('Are you sure you want to delete this role?')) return;
        
        try {
            await api.delete(`/admin/roles/${roleId}`);
            setSuccess('Role deleted successfully');
            fetchData();
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.message || 'Failed to delete role');
        }
    };

    const createDepartment = async () => {
        if (!newDepartment.name.trim()) {
            setError('Department name is required');
            return;
        }
        
        try {
            // Removed organizationId from department creation
            const departmentData = {
                name: newDepartment.name,
                description: newDepartment.description,
                manager: newDepartment.managerName,
                budget: newDepartment.budget
            };
            
            await api.post('/admin/departments', departmentData);
            setSuccess('Department created successfully');
            setNewDepartment({ name: '', description: '', managerName: '', budget: '' });
            setShowDeptForm(false);
            fetchData();
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.message || 'Failed to create department');
        }
    };

    const updateDepartment = async () => {
        if (!editingDepartment.name.trim()) {
            setError('Department name is required');
            return;
        }
        
        try {
            // Removed organization_id from department update
            const departmentData = {
                name: editingDepartment.name,
                description: editingDepartment.description,
                manager: editingDepartment.manager,
                budget: editingDepartment.budget
            };
            
            await api.put(`/admin/departments/${editingDepartment.id}`, departmentData);
            setSuccess('Department updated successfully');
            setEditingDepartment(null);
            fetchData();
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.message || 'Failed to update department');
        }
    };

    const deleteDepartment = async (departmentId) => {
        if (!window.confirm('Are you sure you want to delete this department? This will also delete all roles and users in this department.')) return;
        
        try {
            await api.delete(`/admin/departments/${departmentId}`);
            setSuccess('Department deleted successfully');
            fetchData();
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.message || 'Failed to delete department');
        }
    };

    const toggleModule = (module) => {
        setExpandedModules(prev => ({
            ...prev,
            [module]: !prev[module]
        }));
    };

    // Department menu management functions
    const fetchDepartmentMenus = async (departmentId) => {
        try {
            const response = await api.get(`/admin/departments/${departmentId}/menus`);
            setDepartmentMenus(response.data.menus || []);
        } catch (err) {
            setError(err.message || 'Failed to fetch department menus');
        }
    };

    const selectDepartmentForMenus = async (department) => {
        setSelectedDepartmentForMenus(department);
        await fetchDepartmentMenus(department.id);
    };

    const updateDepartmentMenu = (menuItem, field, value) => {
        setDepartmentMenus(prev => {
            const existing = prev.find(m => m.menu_item === menuItem);
            if (existing) {
                return prev.map(m => 
                    m.menu_item === menuItem 
                        ? { ...m, [field]: value }
                        : m
                );
            } else {
                return [...prev, { menu_item: menuItem, access_level: 'read', is_active: true, [field]: value }];
            }
        });
    };

    const saveDepartmentMenus = async () => {
        if (!selectedDepartmentForMenus) return;
        
        try {
            await api.put(`/admin/departments/${selectedDepartmentForMenus.id}/menus`, {
                menus: departmentMenus
            });
            setSuccess('Department menu access updated successfully');
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.message || 'Failed to update department menus');
        }
    };

    const groupPermissionsByModule = (perms) => {
        return perms.reduce((acc, perm) => {
            if (!acc[perm.module]) {
                acc[perm.module] = [];
            }
            acc[perm.module].push(perm);
            return acc;
        }, {});
    };

    // Handle role name change to automatically set permissions
    const handleRoleNameChange = (e) => {
        const roleName = e.target.value;
        console.log('Role name changed to:', roleName); // Debug log
        setNewRole(prev => ({ ...prev, name: roleName }));
        
        // Automatically assign permissions based on role type
        if (roleName === 'admin') {
            // For admin roles, we'll assign specific permissions on the server side
            setNewRole(prev => ({ ...prev, name: roleName, permissions: [] }));
        } else if (roleName === 'user') {
            // For user roles, start with no permissions
            setNewRole(prev => ({ ...prev, name: roleName, permissions: [] }));
        }
    };

    const renderUsers = () => (
        <div className="users-section">
            <div className="section-header">
                <h3>Users</h3>
                <div className="section-actions">
                    {hasPermission('employees.create') && (
                        <button 
                            className="btn-primary"
                            onClick={() => setShowUserForm(true)}
                        >
                            <UserPlus size={16} />
                            Add User
                        </button>
                    )}
                </div>
            </div>
            
            {showUserForm && (
                <div className="user-form">
                    <h4>Create New User</h4>
                    <div className="form-grid">
                        <div className="form-group">
                            <label>Name *</label>
                            <input
                                type="text"
                                value={newUser.name}
                                onChange={(e) => setNewUser({...newUser, name: e.target.value})}
                                placeholder="Enter full name"
                            />
                        </div>
                        <div className="form-group">
                            <label>Email *</label>
                            <input
                                type="email"
                                value={newUser.email}
                                onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                                placeholder="Enter email address"
                            />
                        </div>
                        <div className="form-group">
                            <label>Password *</label>
                            <div className="password-input">
                                <input
                                    type={showPassword ? "text" : "password"}
                                    value={newUser.password}
                                    onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                                    placeholder="Enter password"
                                />
                                <button 
                                    type="button" 
                                    className="password-toggle"
                                    onClick={() => setShowPassword(!showPassword)}
                                >
                                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>
                        <div className="form-group">
                            <label>Phone</label>
                            <input
                                type="tel"
                                value={newUser.phone}
                                onChange={(e) => setNewUser({...newUser, phone: e.target.value})}
                                placeholder="Enter phone number"
                            />
                        </div>
                        <div className="form-group">
                            <label>Country Code</label>
                            <input
                                type="text"
                                value={newUser.countryCode}
                                onChange={(e) => setNewUser({...newUser, countryCode: e.target.value})}
                                placeholder="e.g., +971"
                            />
                        </div>
                        <div className="form-group">
                            <label>Role</label>
                            <select
                                value={newUser.roleId}
                                onChange={(e) => setNewUser({...newUser, roleId: e.target.value})}
                            >
                                <option value="">Select Role</option>
                                {roles.map(role => (
                                    <option key={role.id} value={role.id}>{role.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Department</label>
                            <select
                                value={newUser.departmentId}
                                onChange={(e) => setNewUser({...newUser, departmentId: e.target.value})}
                            >
                                <option value="">Select Department</option>
                                {departments.map(dept => (
                                    <option key={dept.id} value={dept.id}>{dept.name}</option>
                                ))}
                            </select>
                        </div>
                        {/* Removed organization selection */}
                    </div>
                    <div className="form-actions">
                        <button className="btn-save" onClick={createUser}>
                            <Save size={16} />
                            Create User
                        </button>
                        <button className="btn-cancel" onClick={() => setShowUserForm(false)}>
                            Cancel
                        </button>
                    </div>
                </div>
            )}
            
            {loading ? (
                <div className="loading">Loading users...</div>
            ) : (
                <div className="users-table">
                    <table>
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Email</th>
                                <th>Phone</th>
                                <th>Role</th>
                                <th>Department</th>
                                {/* Removed organization column */}
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(user => (
                                <tr key={user.id}>
                                    {editingUser?.id === user.id ? (
                                        <>
                                            <td>
                                                <input
                                                    type="text"
                                                    value={editingUser.name}
                                                    onChange={(e) => setEditingUser({...editingUser, name: e.target.value})}
                                                    className="inline-input"
                                                />
                                            </td>
                                            <td>
                                                <input
                                                    type="email"
                                                    value={editingUser.email}
                                                    onChange={(e) => setEditingUser({...editingUser, email: e.target.value})}
                                                    className="inline-input"
                                                />
                                            </td>
                                            <td>
                                                <input
                                                    type="tel"
                                                    value={editingUser.phone || ''}
                                                    onChange={(e) => setEditingUser({...editingUser, phone: e.target.value})}
                                                    className="inline-input"
                                                />
                                            </td>
                                            <td>
                                                <select
                                                    value={editingUser.role_id || ''}
                                                    onChange={(e) => setEditingUser({...editingUser, role_id: e.target.value})}
                                                    className="inline-select"
                                                >
                                                    <option value="">No Role</option>
                                                    {roles.map(role => (
                                                        <option key={role.id} value={role.id}>{role.name}</option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td>
                                                <select
                                                    value={editingUser.department_id || ''}
                                                    onChange={(e) => setEditingUser({...editingUser, department_id: e.target.value})}
                                                    className="inline-select"
                                                >
                                                    <option value="">No Department</option>
                                                    {departments.map(dept => (
                                                        <option key={dept.id} value={dept.id}>{dept.name}</option>
                                                    ))}
                                                </select>
                                            </td>
                                            {/* Removed organization editing */}
                                            <td>
                                                <div className="action-buttons">
                                                    <button className="btn-icon save" onClick={saveUserChanges}>
                                                        <Save size={16} />
                                                    </button>
                                                    <button className="btn-icon cancel" onClick={cancelEditUser}>
                                                        <X size={16} />
                                                    </button>
                                                </div>
                                            </td>
                                        </>
                                    ) : (
                                        <>
                                            <td>{user.name}</td>
                                            <td>{user.email}</td>
                                            <td>{user.phone || 'N/A'}</td>
                                            <td>
                                                <span className="role-badge">
                                                    {user.role_name || 'No Role'}
                                                </span>
                                            </td>
                                            <td>
                                                <span className="department-badge">
                                                    {user.department_name || 'No Department'}
                                                </span>
                                            </td>
                                            {/* Removed organization display */}
                                            <td>
                                                <div className="action-buttons">
                                                    {hasPermission('employees.update') && (
                                                        <button className="btn-icon edit" onClick={() => startEditUser(user)}>
                                                            <Edit2 size={16} />
                                                        </button>
                                                    )}
                                                    {hasPermission('employees.delete') && user.role_name !== 'super_admin' && (
                                                        <button className="btn-icon delete" onClick={() => deleteUser(user.id)}>
                                                            <Trash2 size={16} />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {users.length === 0 && !showUserForm && (
                        <div className="no-data">
                            <Users size={48} />
                            <p>No users found</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );

    const renderRoles = () => {
        const groupedPermissions = groupPermissionsByModule(permissions);
        
        return (
            <div className="roles-section">
                <div className="section-header">
                    <h3>Roles</h3>
                    <div className="section-actions">
                        {/* Department admins and super admins can create roles */}
                        {(isSuperAdmin() || (user.department_id && user.role_name && user.role_name.includes('admin'))) && hasPermission('roles.create') && (
                            <button 
                                className="btn-primary"
                                onClick={() => {
                                    console.log('Add Role button clicked'); // Debug log
                                    setShowRoleForm(true);
                                }}
                            >
                                <Plus size={16} />
                                Add Role
                            </button>
                        )}
                    </div>
                </div>
                
                {/* Only show role form to those with permission */}
                {(isSuperAdmin() || (user.department_id && user.role_name && user.role_name.includes('admin'))) && showRoleForm && (
                    <div className="role-form">
                        <h4>Create New Role</h4>
                        <div className="form-grid">
                            <div className="form-group">
                                <label>Role Name *</label>
                                <select
                                    value={newRole.name}
                                    onChange={handleRoleNameChange}
                                >
                                    <option value="">Select Role Type</option>
                                    <option value="admin">Admin</option>
                                    <option value="user">User</option>
                                </select>
                            </div>
                            {/* Department admins can only create roles for their own department */}
                            {isSuperAdmin() ? (
                                <div className="form-group">
                                    <label>Department</label>
                                    <select
                                        value={newRole.departmentId || (user.department_id && !isSuperAdmin() ? user.department_id : newRole.departmentId)}
                                        onChange={(e) => setNewRole({...newRole, departmentId: e.target.value})}
                                        disabled={!isSuperAdmin()}
                                    >
                                        {isSuperAdmin() ? (
                                            <>
                                                <option value="">Select Department (Optional)</option>
                                                {departments.map(dept => (
                                                    <option key={dept.id} value={dept.id}>{dept.name}</option>
                                                ))}
                                            </>
                                        ) : (
                                            <option value={user.department_id}>{user.department_name}</option>
                                        )}
                                    </select>
                                </div>
                            ) : (
                                <input type="hidden" value={user.department_id} />
                            )}
                            <div className="form-group">
                                <label>Description</label>
                                <textarea
                                    value={newRole.description}
                                    onChange={(e) => setNewRole({...newRole, description: e.target.value})}
                                    placeholder="Enter description"
                                    rows={3}
                                />
                            </div>
                        </div>
                        <div className="form-actions">
                            <button className="btn-save" onClick={createRole}>
                                <Save size={16} />
                                Create Role
                            </button>
                            <button className="btn-cancel" onClick={() => setShowRoleForm(false)}>
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
                
                <div className="roles-container">
                    <div className="roles-list">
                        <h3>Roles</h3>
                        {roles
                            .filter(role => isSuperAdmin() || role.department_id == user.department_id)
                            .map(role => (
                                <div 
                                    key={role.id} 
                                    className={`role-card ${selectedRole?.id === role.id ? 'selected' : ''}`}
                                    onClick={() => handleRoleSelect(role)}
                                >
                                    <h4>{role.name}</h4>
                                    <p>{role.description}</p>
                                    <div className="role-meta">
                                        <span className="department-badge">{role.department_name || 'No Department'}</span>
                                        <span className="user-count">{role.user_count} users</span>
                                    </div>
                                </div>
                            ))}
                    </div>
                    
                    {selectedRole && (
                        <div className="permissions-panel">
                            <h3>Permissions for {selectedRole.name}</h3>
                            <div className="permissions-tree">
                                {Object.keys(groupedPermissions).map(module => {
                                    // For 'user' role, only show 'converts' module
                                    if (selectedRole.name === 'user' && module !== 'converts') {
                                        return null;
                                    }
                                    
                                    // For 'admin' role, show all modules except super_admin specific ones
                                    if (selectedRole.name === 'admin' && module === 'super_admin') {
                                        return null;
                                    }
                                    
                                    const modulePerms = groupedPermissions[module];
                                    const isExpanded = expandedModules[module];
                                    
                                    return (
                                        <div key={module} className="permission-module">
                                            <div 
                                                className="module-header"
                                                onClick={() => toggleModule(module)}
                                            >
                                                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                                <span className="module-name">{module}</span>
                                            </div>
                                            
                                            {isExpanded && (
                                                <div className="module-permissions">
                                                    {modulePerms.map(perm => {
                                                        const hasPermission = rolePermissions.some(rp => rp.id === perm.id);
                                                        const isAdminRole = selectedRole.name === 'admin';
                                                        
                                                        return (
                                                            <label key={perm.id} className="permission-item">
                                                                <input 
                                                                    type="checkbox"
                                                                    checked={hasPermission}
                                                                    onChange={(e) => {
                                                                        // For admin roles, permissions are fixed and cannot be changed
                                                                        if (isAdminRole) return;
                                                                        
                                                                        const newPermissions = e.target.checked 
                                                                            ? [...rolePermissions, perm]
                                                                            : rolePermissions.filter(rp => rp.id !== perm.id);
                                                                        
                                                                        setRolePermissions(newPermissions);
                                                                        
                                                                        // Update on server
                                                                        const permissionIds = newPermissions.map(p => p.id);
                                                                        updateRolePermissions(selectedRole.id, permissionIds);
                                                                    }}
                                                                    // Disable editing for admin roles as permissions are fixed
                                                                    // Also disable for department admins trying to edit roles outside their department
                                                                    disabled={isAdminRole || (!isSuperAdmin() && selectedRole.department_id != user.department_id)}
                                                                />
                                                                <div className="permission-info">
                                                                    <span className="permission-name">{perm.name}</span>
                                                                    <span className="permission-desc">{perm.description}</span>
                                                                </div>
                                                            </label>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const renderOrganizations = () => (
        <div className="organizations-section">
            <div className="section-header">
                <h3>Organizations</h3>
                <div className="section-actions">
                    {hasPermission('organizations.create') && (
                        <button 
                            className="btn-primary"
                            onClick={() => setShowOrgForm(true)}
                        >
                            <Plus size={16} />
                            Add Organization
                        </button>
                    )}
                </div>
            </div>
            
            {showOrgForm && (
                <div className="organization-form">
                    <h4>Create New Organization</h4>
                    <div className="form-grid">
                        <div className="form-group">
                            <label>Organization Name *</label>
                            <input
                                type="text"
                                value={newOrganization.name}
                                onChange={(e) => setNewOrganization({...newOrganization, name: e.target.value})}
                                placeholder="Enter organization name"
                            />
                        </div>
                        <div className="form-group">
                            <label>Description</label>
                            <textarea
                                value={newOrganization.description}
                                onChange={(e) => setNewOrganization({...newOrganization, description: e.target.value})}
                                placeholder="Enter description"
                                rows={3}
                            />
                        </div>
                        <div className="form-group">
                            <label>Address</label>
                            <textarea
                                value={newOrganization.address}
                                onChange={(e) => setNewOrganization({...newOrganization, address: e.target.value})}
                                placeholder="Enter address"
                                rows={2}
                            />
                        </div>
                    </div>
                    <div className="form-actions">
                        <button className="btn-save" onClick={createOrganization}>
                            <Save size={16} />
                            Create Organization
                        </button>
                        <button className="btn-cancel" onClick={() => setShowOrgForm(false)}>
                            Cancel
                        </button>
                    </div>
                </div>
            )}
            
            {loading ? (
                <div className="loading">Loading organizations...</div>
            ) : (
                <div className="organizations-grid">
                    {organizations.map(org => (
                        <div key={org.id} className="organization-card">
                            <div className="org-header">
                                <Building2 size={24} />
                                <div className="org-title">
                                    <h4>{org.name}</h4>
                                    <span className="user-count">{org.user_count} users</span>
                                </div>
                            </div>
                            {org.description && (
                                <div className="org-description">
                                    <p>{org.description}</p>
                                </div>
                            )}
                            {org.address && (
                                <div className="org-address">
                                    <small>{org.address}</small>
                                </div>
                            )}
                            <div className="org-footer">
                                <span className="created-date">
                                    Created {new Date(org.created_at).toLocaleDateString()}
                                </span>
                            </div>
                        </div>
                    ))}
                    {organizations.length === 0 && !showOrgForm && (
                        <div className="no-data">
                            <Building2 size={48} />
                            <p>No organizations found</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );

    const renderDepartments = () => (
        <div className="departments-section">
            <div className="section-header">
                <div className="header-left">
                    <h3>Departments</h3>
                    <span className="department-count">{departments.length} total departments</span>
                </div>
                <div className="section-actions">
                    {hasPermission('departments.create') && (
                        <button 
                            className="btn-primary"
                            onClick={() => setShowDeptForm(true)}
                        >
                            <Plus size={16} />
                            Add Department
                        </button>
                    )}
                </div>
            </div>
            
            {showDeptForm && (
                <div className="department-form">
                    <h4>Create New Department</h4>
                    <div className="form-grid">
                        <div className="form-group">
                            <label>Department Name *</label>
                            <input
                                type="text"
                                value={newDepartment.name}
                                onChange={(e) => setNewDepartment({...newDepartment, name: e.target.value})}
                                placeholder="Enter department name"
                            />
                        </div>
                        <div className="form-group">
                            <label>Description</label>
                            <textarea
                                value={newDepartment.description}
                                onChange={(e) => setNewDepartment({...newDepartment, description: e.target.value})}
                                placeholder="Enter description"
                                rows={3}
                            />
                        </div>
                        <div className="form-group">
                            <label>Manager Name</label>
                            <input
                                type="text"
                                value={newDepartment.managerName}
                                onChange={(e) => setNewDepartment({...newDepartment, managerName: e.target.value})}
                                placeholder="Enter manager name"
                            />
                        </div>
                        <div className="form-group">
                            <label>Budget</label>
                            <input
                                type="number"
                                step="0.01"
                                value={newDepartment.budget}
                                onChange={(e) => setNewDepartment({...newDepartment, budget: e.target.value})}
                                placeholder="Enter budget amount"
                            />
                        </div>
                        {/* Removed organization selection */}
                    </div>
                    <div className="form-actions">
                        <button className="btn-save" onClick={createDepartment}>
                            <Save size={16} />
                            Create Department
                        </button>
                        <button className="btn-cancel" onClick={() => setShowDeptForm(false)}>
                            Cancel
                        </button>
                    </div>
                </div>
            )}
            
            {loading ? (
                <div className="loading">Loading departments...</div>
            ) : (
                <div className="departments-grid">
                    {departments.map(dept => (
                        <div key={dept.id} className="department-card">
                            {editingDepartment?.id === dept.id ? (
                                <div className="edit-form">
                                    <div className="form-group">
                                        <input
                                            type="text"
                                            value={editingDepartment.name}
                                            onChange={(e) => setEditingDepartment({...editingDepartment, name: e.target.value})}
                                            className="inline-input"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <textarea
                                            value={editingDepartment.description || ''}
                                            onChange={(e) => setEditingDepartment({...editingDepartment, description: e.target.value})}
                                            placeholder="Enter description"
                                            rows={2}
                                            className="inline-textarea"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <input
                                            type="text"
                                            value={editingDepartment.manager || ''}
                                            onChange={(e) => setEditingDepartment({...editingDepartment, manager: e.target.value})}
                                            placeholder="Enter manager name"
                                            className="inline-input"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={editingDepartment.budget || ''}
                                            onChange={(e) => setEditingDepartment({...editingDepartment, budget: e.target.value})}
                                            placeholder="Enter budget"
                                            className="inline-input"
                                        />
                                    </div>
                                    {/* Removed organization editing */}
                                    <div className="form-actions">
                                        <button className="btn-save" onClick={updateDepartment}>
                                            <Save size={16} />
                                        </button>
                                        <button className="btn-cancel" onClick={() => setEditingDepartment(null)}>
                                            <X size={16} />
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="dept-header">
                                        <div className="dept-icon">
                                            <Layers size={24} />
                                        </div>
                                        <div className="dept-title">
                                            <h4>{dept.name}</h4>
                                            <span className="user-count">{dept.employee_count || 0} users</span>
                                        </div>
                                    </div>
                                    {dept.description && (
                                        <div className="dept-description">
                                            <p>{dept.description}</p>
                                        </div>
                                    )}
                                    <div className="dept-details">
                                        {dept.manager && (
                                            <div className="dept-manager">
                                                <strong>Manager:</strong> {dept.manager}
                                            </div>
                                        )}
                                        {dept.budget && (
                                            <div className="dept-budget">
                                                <strong>Budget:</strong> ${parseFloat(dept.budget).toLocaleString()}
                                            </div>
                                        )}
                                        {/* Removed organization display */}
                                    </div>
                                    <div className="dept-footer">
                                        <span className="created-date">
                                            Created {new Date(dept.created_at).toLocaleDateString()}
                                        </span>
                                        <div className="dept-actions">
                                            {hasPermission('departments.update') && (
                                                <button 
                                                    className="btn-icon edit"
                                                    onClick={() => setEditingDepartment(dept)}
                                                >
                                                    <Edit2 size={16} />
                                                </button>
                                            )}
                                            {hasPermission('departments.delete') && (
                                                <button 
                                                    className="btn-icon delete"
                                                    onClick={() => deleteDepartment(dept.id)}
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    ))}
                    {departments.length === 0 && !showDeptForm && (
                        <div className="no-data">
                            <Layers size={48} />
                            <p>No departments found</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );

    const renderDepartmentMenus = () => (
        <div className="department-menus-section">
            <div className="section-header">
                <div className="header-left">
                    <h3>Department Menu Access</h3>
                    <span className="description">Configure which menu items each department can access</span>
                </div>
            </div>
            
            <div className="department-menus-content">
                <div className="departments-list">
                    <h4>Select Department</h4>
                    <div className="department-cards">
                        {departments.map(dept => (
                            <div 
                                key={dept.id} 
                                className={`department-card ${selectedDepartmentForMenus?.id === dept.id ? 'selected' : ''}`}
                                onClick={() => selectDepartmentForMenus(dept)}
                            >
                                <div className="dept-icon">
                                    <Briefcase size={20} />
                                </div>
                                <div className="dept-info">
                                    <h5>{dept.name}</h5>
                                    <p>{dept.user_count} users</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                
                {selectedDepartmentForMenus && (
                    <div className="menu-access-config">
                        <div className="config-header">
                            <h4>Menu Access for {selectedDepartmentForMenus.name}</h4>
                            <button className="btn-primary" onClick={saveDepartmentMenus}>
                                <Save size={16} />
                                Save Changes
                            </button>
                        </div>
                        
                        <div className="menu-items-grid">
                            {Object.entries(availableMenuItems.reduce((acc, menuItem) => {
                                if (!acc[menuItem.category]) {
                                    acc[menuItem.category] = [];
                                }
                                acc[menuItem.category].push(menuItem);
                                return acc;
                            }, {})).map(([category, items]) => (
                                <div key={category} className="menu-category">
                                    <h5>{category}</h5>
                                    <div className="menu-items">
                                        {items.map(menuItem => {
                                            const currentMenu = departmentMenus.find(m => m.menu_item === menuItem.id);
                                            return (
                                                <div key={menuItem.id} className="menu-item-config">
                                                    <div className="menu-item-info">
                                                        <span className="menu-name">{menuItem.name}</span>
                                                        <span className="menu-id">{menuItem.id}</span>
                                                    </div>
                                                    <div className="menu-controls">
                                                        <label className="checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={currentMenu?.is_active || false}
                                                                onChange={(e) => updateDepartmentMenu(menuItem.id, 'is_active', e.target.checked)}
                                                            />
                                                            <span className="checkmark"></span>
                                                            Active
                                                        </label>
                                                        <select
                                                            value={currentMenu?.access_level || 'read'}
                                                            onChange={(e) => updateDepartmentMenu(menuItem.id, 'access_level', e.target.value)}
                                                            disabled={!currentMenu?.is_active}
                                                        >
                                                            <option value="read">Read</option>
                                                            <option value="write">Write</option>
                                                            <option value="admin">Admin</option>
                                                        </select>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="roles-permissions-page">
            <div className="page-header">
                <h1>Roles & Permissions</h1>
                <p>Manage user roles, permissions, and departments</p> {/* Updated description */}
            </div>

            {error && <div className="alert error">{error}</div>}
            {success && <div className="alert success">{success}</div>}

            <div className="tabs">
                <button 
                    className={`tab ${activeTab === 'users' ? 'active' : ''}`}
                    onClick={() => setActiveTab('users')}
                    disabled={!hasPermission('users.read')}
                >
                    <Users size={18} />
                    Users
                </button>
                <button 
                    className={`tab ${activeTab === 'roles' ? 'active' : ''}`}
                    onClick={() => setActiveTab('roles')}
                    disabled={!hasPermission('roles.read')}
                >
                    <Shield size={18} />
                    Roles
                </button>
                {/* Removed organizations tab */}
                <button 
                    className={`tab ${activeTab === 'departments' ? 'active' : ''}`}
                    onClick={() => setActiveTab('departments')}
                    disabled={!hasPermission('departments.read')}
                >
                    <Layers size={18} />
                    Departments
                </button>
                <button 
                    className={`tab ${activeTab === 'department-menus' ? 'active' : ''}`}
                    onClick={() => setActiveTab('department-menus')}
                    disabled={!hasPermission('departments.update')}
                >
                    <Key size={18} />
                    Department Menus
                </button>
            </div>

            <div className="tab-content">
                {activeTab === 'users' && renderUsers()}
                {activeTab === 'roles' && renderRoles()}
                {/* Removed organizations tab content */}
                {activeTab === 'departments' && renderDepartments()}
                {activeTab === 'department-menus' && renderDepartmentMenus()}
            </div>
        </div>
    );
}
