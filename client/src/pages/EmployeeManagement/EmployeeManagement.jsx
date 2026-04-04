import React, { useState, useEffect } from 'react';
import { Users, Plus, Edit2, Trash2, Save, X, Shield, UserPlus, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../helper/helper';
import './EmployeeManagement.css';

export default function EmployeeManagement() {
    // Set document title
    useEffect(() => {
        document.title = "Xyra Books - User Management";
    }, []);

    const { isSuperAdmin, user, isCompanyAdmin } = useAuth();
    const [employees, setEmployees] = useState([]);
    const [roles, setRoles] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [companies, setCompanies] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    // Employee management states
    const [showEmployeeForm, setShowEmployeeForm] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState(null);
    const [newEmployee, setNewEmployee] = useState({
        name: '',
        email: '',
        password: '',
        departmentId: '',
        roleId: '',
        companyId: ''
    });
    const [showPassword, setShowPassword] = useState(false);

    // Filter states
    const [selectedCompanyId, setSelectedCompanyId] = useState('');

    // Check if user has access to this page
    if (!isSuperAdmin() && !isCompanyAdmin()) {
        return (
            <div className="employee-management-page">
                <div className="access-denied">
                    <Shield size={64} />
                    <h2>Access Denied</h2>
                    <p>You don't have permission to access this page.</p>
                </div>
            </div>
        );
    }

    useEffect(() => {
        fetchInitialData();
    }, []);

    // Fetch departments when companyId changes (for new/edit employee)
    useEffect(() => {
        if (showEmployeeForm) {
            const compId = editingEmployee ? editingEmployee.company_id : newEmployee.companyId;
            if (compId) {
                fetchDepartments(compId);
            } else {
                setDepartments([]);
            }
        }
    }, [newEmployee.companyId, editingEmployee?.company_id, showEmployeeForm]);

    // Fetch roles when departmentId changes
    useEffect(() => {
        if (showEmployeeForm) {
            const deptId = editingEmployee ? editingEmployee.department_id : newEmployee.departmentId;
            if (deptId) {
                fetchRoles(deptId);
            } else {
                setRoles([]);
            }
        }
    }, [newEmployee.departmentId, editingEmployee?.department_id, showEmployeeForm]);

    const fetchInitialData = async () => {
        setLoading(true);
        setError('');
        try {
            const [empRes, compRes] = await Promise.all([
                api.get('/admin/employees'),
                isSuperAdmin() ? api.get('/companies') : Promise.resolve({ data: { companies: [] } })
            ]);
            setEmployees(empRes.data.employees || []);
            if (isSuperAdmin()) {
                setCompanies(compRes.data.companies || []);
            } else {
                // For company admin, we might need their company's departments сразу
                if (user.company_id) {
                    fetchDepartments(user.company_id);
                    setNewEmployee(prev => ({ ...prev, companyId: user.company_id }));
                }
            }
        } catch (err) {
            setError(err.response?.data?.message || err.message || 'Failed to fetch data');
        } finally {
            setLoading(false);
        }
    };

    const fetchDepartments = async (compId) => {
        try {
            const res = await api.get(`/admin/departments?companyId=${compId}`);
            setDepartments(res.data.departments || []);
        } catch (err) {
            console.error('Failed to fetch departments:', err);
        }
    };

    const fetchRoles = async (deptId) => {
        try {
            const res = await api.get(`/admin/roles?departmentId=${deptId}`);
            setRoles(res.data.roles || []);
        } catch (err) {
            console.error('Failed to fetch roles:', err);
        }
    };

    const fetchData = () => {
        fetchInitialData();
    };

    const createEmployee = async () => {
        if (!newEmployee.name.trim() || !newEmployee.email.trim() || !newEmployee.password.trim() || !newEmployee.roleId) {
            setError('Name, email, password and role are required');
            return;
        }

        try {
            await api.post('/admin/employees', {
                ...newEmployee,
                companyId: isSuperAdmin() ? newEmployee.companyId : user.company_id
            });
            setSuccess('User created successfully');
            setNewEmployee({ name: '', email: '', password: '', roleId: '', departmentId: '', companyId: user.company_id || '' });
            setShowEmployeeForm(false);
            fetchData();
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.response?.data?.message || err.message || 'Failed to create user');
        }
    };

    const updateEmployee = async () => {
        if (!editingEmployee.name.trim() || !editingEmployee.email.trim()) {
            setError('Name and email are required');
            return;
        }

        try {
            await api.put(`/admin/employees/${editingEmployee.id}`, {
                name: editingEmployee.name,
                email: editingEmployee.email,
                roleId: editingEmployee.role_id,
                departmentId: editingEmployee.department_id,
                companyId: editingEmployee.company_id,
                status: editingEmployee.status,
                password: editingEmployee.password || undefined
            });
            setSuccess('User updated successfully');
            setEditingEmployee(null);
            fetchData();
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.response?.data?.message || err.message || 'Failed to update user');
        }
    };

    const deleteEmployee = async (employeeId) => {
        const employee = employees.find(e => e.id === employeeId);
        if (!isSuperAdmin() && employee && parseInt(employee.company_id) !== parseInt(user.company_id)) {
            setError('You can only delete users in your own company');
            return;
        }

        if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
            return;
        }

        try {
            await api.delete(`/admin/employees/${employeeId}`);
            setSuccess('User deleted successfully');
            fetchData();
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.response?.data?.message || err.message || 'Failed to delete user');
        }
    };

    const startEditEmployee = (employee) => {
        if (!isSuperAdmin() && parseInt(employee.company_id) !== parseInt(user.company_id)) {
            setError('You can only edit users in your own company');
            return;
        }
        setEditingEmployee({ ...employee });
    };

    const cancelEditEmployee = () => {
        setEditingEmployee(null);
    };

    return (
        <div className="employee-management-page">
            <div className="page-header">
                <div className="header-left">
                    <h1>User Management</h1>
                    <p>Manage all users and their roles</p>
                </div>
                <div className="header-actions">
                    {(isSuperAdmin() || isCompanyAdmin()) && (
                        <button
                            className="btn-primary"
                            onClick={() => {
                                setEditingEmployee(null);
                                setShowEmployeeForm(true);
                                if (!isSuperAdmin()) {
                                    setNewEmployee(prev => ({ ...prev, companyId: user.company_id }));
                                }
                            }}
                        >
                            <UserPlus size={16} />
                            Add User
                        </button>
                    )}
                </div>
            </div>

            {error && <div className="alert error">{error}</div>}
            {success && <div className="alert success">{success}</div>}

            {/* Employee Creation Form */}
            {showEmployeeForm && (
                <div className="employee-form-container">
                    <div className="employee-form">
                        <h3>{editingEmployee ? 'Edit User' : 'Add New User'}</h3>

                        <div className="form-grid">
                            <div className="form-group">
                                <label>Name *</label>
                                <input
                                    type="text"
                                    value={editingEmployee ? editingEmployee.name : newEmployee.name}
                                    onChange={(e) => editingEmployee
                                        ? setEditingEmployee({ ...editingEmployee, name: e.target.value })
                                        : setNewEmployee({ ...newEmployee, name: e.target.value })
                                    }
                                    placeholder="Enter user name"
                                />
                            </div>

                            <div className="form-group">
                                <label>Email *</label>
                                <input
                                    type="email"
                                    value={editingEmployee ? editingEmployee.email : newEmployee.email}
                                    onChange={(e) => editingEmployee
                                        ? setEditingEmployee({ ...editingEmployee, email: e.target.value })
                                        : setNewEmployee({ ...newEmployee, email: e.target.value })
                                    }
                                    placeholder="Enter user email"
                                />
                            </div>

                            {!editingEmployee && (
                                <div className="form-group">
                                    <label>Password *</label>
                                    <div className="password-input-container">
                                        <input
                                            type={showPassword ? "text" : "password"}
                                            value={newEmployee.password}
                                            onChange={(e) => setNewEmployee({ ...newEmployee, password: e.target.value })}
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
                            )}

                            {!isSuperAdmin() && (
                                <div className="form-group">
                                    <label>Company</label>
                                    <input
                                        type="text"
                                        value={user.company_name || 'Your Company'}
                                        disabled
                                    />
                                    <p className="help-text">Company is automatically set to your company</p>
                                </div>
                            )}

                            {isSuperAdmin() && (
                                <div className="form-group">
                                    <label>Company *</label>
                                    <select
                                        value={editingEmployee ? editingEmployee.company_id || '' : newEmployee.companyId}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            if (editingEmployee) {
                                                setEditingEmployee({ ...editingEmployee, company_id: val, department_id: '', role_id: '' });
                                            } else {
                                                setNewEmployee({ ...newEmployee, companyId: val, departmentId: '', roleId: '' });
                                            }
                                        }}
                                        required
                                    >
                                        <option value="">Select Company</option>
                                        {companies.map(comp => (
                                            <option key={comp.id} value={comp.id}>{comp.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div className="form-group">
                                <label>Department *</label>
                                <select
                                    value={editingEmployee ? editingEmployee.department_id : newEmployee.departmentId}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (editingEmployee) {
                                            setEditingEmployee({ ...editingEmployee, department_id: val, role_id: '' });
                                        } else {
                                            setNewEmployee({ ...newEmployee, departmentId: val, roleId: '' });
                                        }
                                    }}
                                    disabled={!(editingEmployee ? editingEmployee.company_id : newEmployee.companyId)}
                                    required
                                >
                                    <option value="">Select Department</option>
                                    {departments.map(dept => (
                                        <option key={dept.id} value={dept.id}>{dept.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-group">
                                <label>Role *</label>
                                <select
                                    value={editingEmployee ? editingEmployee.role_id : newEmployee.roleId}
                                    onChange={(e) => editingEmployee
                                        ? setEditingEmployee({ ...editingEmployee, role_id: e.target.value })
                                        : setNewEmployee({ ...newEmployee, roleId: e.target.value })
                                    }
                                    disabled={!(editingEmployee ? editingEmployee.department_id : newEmployee.departmentId)}
                                    required
                                >
                                    <option value="">Select Role</option>
                                    {roles.map(role => (
                                        <option key={role.id} value={role.id}>
                                            {role.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="form-actions">
                            <button className="btn-save" onClick={editingEmployee ? updateEmployeeAction : createEmployee}>
                                <Save size={16} />
                                {editingEmployee ? 'Update User' : 'Create User'}
                            </button>
                            <button className="btn-cancel" onClick={() => {
                                setEditingEmployee(null);
                                setShowEmployeeForm(false);
                            }}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="employees-section">
                <div className="section-header">
                    <h3>User Management</h3>
                    <span className="employee-count">{employees.length} total users</span>
                </div>

                {loading ? (
                    <div className="loading">Loading users...</div>
                ) : (
                    <div className="employees-table-container">
                        <table className="employees-table">
                            <thead>
                                <tr>
                                    <th>User Name</th>
                                    <th>Email</th>
                                    <th>Department</th>
                                    <th>Company</th>
                                    <th>Role</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {employees.map(employee => (
                                    <tr key={employee.id}>
                                        {editingEmployee?.id === employee.id ? (
                                            // Edit Mode
                                            <td colSpan="6">
                                                <div className="employee-edit-form">
                                                    <div className="edit-header">
                                                        <Users size={24} />
                                                        <h4>Editing User</h4>
                                                    </div>

                                                    <div className="edit-fields">
                                                        <div className="field-group">
                                                            <label>Name</label>
                                                            <input
                                                                type="text"
                                                                value={editingEmployee.name}
                                                                onChange={(e) => setEditingEmployee({ ...editingEmployee, name: e.target.value })}
                                                            />
                                                        </div>

                                                        <div className="field-group">
                                                            <label>Email</label>
                                                            <input
                                                                type="email"
                                                                value={editingEmployee.email}
                                                                onChange={(e) => setEditingEmployee({ ...editingEmployee, email: e.target.value })}
                                                            />
                                                        </div>

                                                        <div className="field-group">
                                                            <label>Status</label>
                                                            <select
                                                                value={editingEmployee.status || 'active'}
                                                                onChange={(e) => setEditingEmployee({ ...editingEmployee, status: e.target.value })}
                                                            >
                                                                <option value="active">Active</option>
                                                                <option value="inactive">Inactive</option>
                                                            </select>
                                                        </div>

                                                        {isSuperAdmin() && (
                                                            <div className="field-group">
                                                                <label>Company</label>
                                                                <select
                                                                    value={editingEmployee.company_id || ''}
                                                                    onChange={(e) => setEditingEmployee({ ...editingEmployee, company_id: e.target.value })}
                                                                >
                                                                    <option value="">No Company</option>
                                                                    {companies.map(comp => (
                                                                        <option key={comp.id} value={comp.id}>{comp.name}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="edit-actions">
                                                        <button className="btn-save" onClick={updateEmployee}>
                                                            <Save size={14} />
                                                            Save
                                                        </button>
                                                        <button className="btn-cancel" onClick={cancelEditEmployee}>
                                                            <X size={14} />
                                                            Cancel
                                                        </button>
                                                    </div>
                                                </div>
                                            </td>
                                        ) : (
                                            // View Mode
                                            <>
                                                <td>
                                                    <div className="employee-name">
                                                        <Users size={16} />
                                                        {employee.name}
                                                    </div>
                                                </td>
                                                <td>
                                                    <span className="employee-email">
                                                        {employee.email}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className="employee-department">
                                                        {employee.department_name || 'No Department'}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className="employee-company">
                                                        {employee.company_name || 'No Company'}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className="employee-role">
                                                        {employee.role_name || 'No Role'}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className={`status-badge ${employee.status || 'active'}`}>
                                                        {employee.status || 'active'}
                                                    </span>
                                                </td>
                                                <td>
                                                    <div className="action-buttons">
                                                        <button
                                                            className="btn-edit"
                                                            onClick={() => startEditEmployee(employee)}
                                                            title="Edit user"
                                                        >
                                                            <Edit2 size={14} />
                                                        </button>
                                                        <button
                                                            className="btn-delete"
                                                            onClick={() => deleteEmployee(employee.id)}
                                                            title="Delete user"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {employees.length === 0 && !loading && (
                            <div className="no-data">
                                <Users size={48} />
                                <p>No users found</p>
                                <p>Create your first user to get started</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
