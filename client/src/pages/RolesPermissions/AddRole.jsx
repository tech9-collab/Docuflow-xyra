import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Shield, Save } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../helper/helper';
import './AddRole.css';

const availableMenus = [
    { id: 'dashboard.read', name: 'Dashboard Access', category: 'System' },
    { id: 'roles.read', name: 'View Roles', category: 'Role & Permission Management' },
    { id: 'roles.create', name: 'Create Roles', category: 'Role & Permission Management' },
    { id: 'roles.update', name: 'Edit Roles', category: 'Role & Permission Management' },
    { id: 'roles.delete', name: 'Delete Roles', category: 'Role & Permission Management' },
    { id: 'employees.read', name: 'View Users', category: 'User Management' },
    { id: 'employees.create', name: 'Create Users', category: 'User Management' },
    { id: 'employees.update', name: 'Edit Users', category: 'User Management' },
    { id: 'employees.delete', name: 'Delete Users', category: 'User Management' },
    { id: 'projects.vat_filing', name: 'VAT Filing', category: 'Departments' },
    { id: 'projects.ct_filing', name: 'CT Filing', category: 'Departments' },
    { id: 'customers.read', name: 'View Customers', category: 'Customer Management' },
    { id: 'customers.create', name: 'Create Customers', category: 'Customer Management' },
    { id: 'customers.update', name: 'Edit Customers', category: 'Customer Management' },
    { id: 'customers.delete', name: 'Delete Customers', category: 'Customer Management' },
    { id: 'converts.bank_statements', name: 'Bank Statements', category: 'Converts' },
    { id: 'converts.invoices', name: 'Invoices', category: 'Converts' },
    { id: 'converts.bills', name: 'Bills', category: 'Converts' },
    { id: 'converts.emirates_id', name: 'Emirates ID', category: 'Converts' },
    { id: 'converts.passport', name: 'Passport', category: 'Converts' },
    { id: 'converts.visa', name: 'Visa', category: 'Converts' },
    { id: 'converts.trade_license', name: 'Trade License', category: 'Converts' },
];

const menusByCategory = availableMenus.reduce((acc, menu) => {
    if (!acc[menu.category]) acc[menu.category] = [];
    acc[menu.category].push(menu);
    return acc;
}, {});

export default function AddRole() {
    useEffect(() => {
        document.title = 'Xyra Books - Add Role';
    }, []);

    const navigate = useNavigate();
    const { isSuperAdmin, user } = useAuth();

    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [departments, setDepartments] = useState([]);
    const [role, setRole] = useState({
        name: 'user',
        description: '',
        departmentId: isSuperAdmin() ? '' : user?.department_id || '',
        menus: [],
    });

    const hasAccess =
        isSuperAdmin() ||
        (user?.department_id && user?.role_name === 'admin');

    useEffect(() => {
        if (!hasAccess) return;
        const loadDepartments = async () => {
            try {
                if (isSuperAdmin()) {
                    const res = await api.get('/admin/departments');
                    setDepartments(res.data.departments || []);
                } else if (user?.department_id) {
                    const res = await api.get(`/admin/departments/${user.department_id}`);
                    const dept = res.data.department || res.data.departments || res.data;
                    setDepartments(Array.isArray(dept) ? dept : [dept]);
                }
            } catch (err) {
                setError(err.message || 'Failed to load departments');
            }
        };
        loadDepartments();
    }, [hasAccess]);

    if (!hasAccess) {
        return (
            <div className="add-role-page">
                <div className="ar-access-denied">
                    <Shield size={64} />
                    <h2>Access Denied</h2>
                    <p>You don't have permission to access this page.</p>
                </div>
            </div>
        );
    }

    const handleChange = (field) => (e) => {
        setRole((prev) => ({ ...prev, [field]: e.target.value }));
    };

    const handleBack = () => {
        navigate('/admin/roles-permissions');
    };

    const toggleMenu = (menuId) => {
        setRole((prev) => {
            const menus = prev.menus.includes(menuId)
                ? prev.menus.filter((id) => id !== menuId)
                : [...prev.menus, menuId];
            return { ...prev, menus };
        });
    };

    const selectAllInCategory = (category) => {
        const categoryMenus = menusByCategory[category] || [];
        const allSelected = categoryMenus.every((menu) =>
            role.menus.includes(menu.id)
        );
        setRole((prev) => {
            if (allSelected) {
                return {
                    ...prev,
                    menus: prev.menus.filter(
                        (id) => !categoryMenus.some((m) => m.id === id)
                    ),
                };
            }
            const merged = [...prev.menus];
            categoryMenus.forEach((m) => {
                if (!merged.includes(m.id)) merged.push(m.id);
            });
            return { ...prev, menus: merged };
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!role.name.trim()) {
            setError('Role name is required');
            return;
        }
        if (role.name !== 'admin' && role.name !== 'user') {
            setError('Role name must be either "admin" or "user"');
            return;
        }

        const departmentId = isSuperAdmin() ? role.departmentId : user.department_id;
        if (!departmentId) {
            setError('Department is required');
            return;
        }

        let permissionsToAssign = [...role.menus];
        if (role.name === 'admin') {
            const essential = [
                'dashboard.read',
                'roles.read', 'roles.create', 'roles.update', 'roles.delete',
                'employees.read', 'employees.create', 'employees.update', 'employees.delete',
            ];
            essential.forEach((p) => {
                if (!permissionsToAssign.includes(p)) permissionsToAssign.push(p);
            });
        }

        setError('');
        setSubmitting(true);
        try {
            await api.post('/admin/roles', {
                name: role.name,
                description: role.description,
                departmentId,
                permissions: permissionsToAssign,
            });
            navigate('/admin/roles-permissions');
        } catch (err) {
            setError(err.message || 'Failed to create role');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="add-role-page">
            <button
                type="button"
                className="ar-back-link"
                onClick={handleBack}
            >
                <ArrowLeft size={18} />
                <span>Back</span>
            </button>

            <div className="ar-breadcrumb">
                <span
                    className="ar-breadcrumb-link"
                    onClick={handleBack}
                    role="link"
                    tabIndex={0}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') handleBack();
                    }}
                >
                    Roles & Permissions
                </span>
                <span className="ar-breadcrumb-sep">›</span>
                <span className="ar-breadcrumb-current">Create</span>
            </div>

            <h1 className="ar-page-title">Create Role</h1>

            {error && <div className="ar-alert error">{error}</div>}

            <form className="ar-form" onSubmit={handleSubmit}>
                <div className="ar-section">
                    <div className="ar-section-header">
                        <Shield size={18} />
                        <h2>Role Details</h2>
                    </div>
                    <div className="ar-section-divider" />

                    <div className="ar-grid">
                        <div className="ar-field">
                            <label htmlFor="role-name">
                                Role Name<span className="ar-required">*</span>
                            </label>
                            <select
                                id="role-name"
                                value={role.name}
                                onChange={handleChange('name')}
                            >
                                <option value="user">User</option>
                                {isSuperAdmin() && <option value="admin">Admin</option>}
                            </select>
                            <p className="ar-help">Only "user" and "admin" roles are allowed</p>
                        </div>

                        {isSuperAdmin() ? (
                            <div className="ar-field">
                                <label htmlFor="role-department">
                                    Department<span className="ar-required">*</span>
                                </label>
                                <select
                                    id="role-department"
                                    value={role.departmentId}
                                    onChange={handleChange('departmentId')}
                                >
                                    <option value="">Select Department</option>
                                    {departments.map((dept) => (
                                        <option key={dept.id} value={dept.id}>
                                            {dept.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        ) : (
                            <div className="ar-field">
                                <label htmlFor="role-department-readonly">Department</label>
                                <input
                                    id="role-department-readonly"
                                    type="text"
                                    value={
                                        departments.find((d) => d.id == user.department_id)?.name ||
                                        ''
                                    }
                                    disabled
                                />
                                <p className="ar-help">
                                    Department is automatically set to your department
                                </p>
                            </div>
                        )}

                        <div className="ar-field ar-field-full">
                            <label htmlFor="role-description">Description</label>
                            <textarea
                                id="role-description"
                                rows={3}
                                value={role.description}
                                onChange={handleChange('description')}
                                placeholder="Enter role description"
                            />
                        </div>
                    </div>
                </div>

                <div className="ar-section">
                    <div className="ar-section-header">
                        <Shield size={18} />
                        <h2>Permissions</h2>
                    </div>
                    <div className="ar-section-divider" />

                    <div className="ar-permissions-grid">
                        {Object.entries(menusByCategory).map(([category, menus]) => {
                            const allSelected = menus.every((m) =>
                                role.menus.includes(m.id)
                            );
                            return (
                                <div key={category} className="ar-permission-card">
                                    <div className="ar-permission-card-header">
                                        <h4>{category}</h4>
                                        <button
                                            type="button"
                                            className="ar-select-all"
                                            onClick={() => selectAllInCategory(category)}
                                        >
                                            {allSelected ? 'Deselect All' : 'Select All'}
                                        </button>
                                    </div>
                                    <div className="ar-permission-list">
                                        {menus.map((menu) => (
                                            <label key={menu.id} className="ar-checkbox">
                                                <input
                                                    type="checkbox"
                                                    checked={role.menus.includes(menu.id)}
                                                    onChange={() => toggleMenu(menu.id)}
                                                />
                                                <span>{menu.name}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="ar-actions">
                    <button
                        type="button"
                        className="ar-btn ar-btn-secondary"
                        onClick={handleBack}
                        disabled={submitting}
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        className="ar-btn ar-btn-primary"
                        disabled={submitting}
                    >
                        <Save size={16} />
                        {submitting ? 'Creating...' : 'Create Role'}
                    </button>
                </div>
            </form>
        </div>
    );
}
