import React, { useState, useEffect } from 'react';
import { Users, Plus, Edit2, Trash2, Save, X, Shield, UserPlus, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../helper/helper';
import './EmployeeManagement.css';

export default function EmployeeManagement() {
    const { isSuperAdmin, hasPermission } = useAuth();
    const [employees, setEmployees] = useState([]);
    const [roles, setRoles] = useState([]);
    const [departments, setDepartments] = useState([]);
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
        phone: '',
        countryCode: '+971',
        roleId: '',
        departmentId: ''
    });
    const [showPassword, setShowPassword] = useState(false);

    // Check if user has access to this page
    if (!isSuperAdmin() && !hasPermission('employees.read')) {
        return (
            <div className="employee-management-page">
                <div className="access-denied">
                    <Shield size={64} />
                    <h2>Access Denied</h2>
                    <p>You do not have permission to access this page.</p>
                </div>
            </div>
        );
    }

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        setError('');

        try {
            const [employeesRes, rolesRes, departmentsRes] = await Promise.all([
                api.get('/admin/employees'),
                api.get('/admin/roles'),
                api.get('/admin/departments')
            ]);
            setEmployees(employeesRes.data.employees || []);
            setRoles(rolesRes.data.roles || []);
            setDepartments(departmentsRes.data.departments || []);
        } catch (err) {
            setError(err.message || 'Failed to fetch data');
        } finally {
            setLoading(false);
        }
    };

    const createEmployee = async () => {
        if (!newEmployee.name.trim() || !newEmployee.email.trim() || !newEmployee.password.trim() || !newEmployee.roleId) {
            setError('Name, email, password and role are required');
            return;
        }

        try {
            await api.post('/admin/employees', newEmployee);
            setSuccess('Employee created successfully');
            setNewEmployee({ name: '', email: '', password: '', phone: '', countryCode: '+971', roleId: '', departmentId: '' });
            setShowEmployeeForm(false);
            fetchData();
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.message || 'Failed to create employee');
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
                phone: editingEmployee.phone,
                countryCode: editingEmployee.country_code,
                roleId: editingEmployee.role_id,
                status: editingEmployee.status
            });
            setSuccess('Employee updated successfully');
            setEditingEmployee(null);
            fetchData();
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.message || 'Failed to update employee');
        }
    };

    const deleteEmployee = async (employeeId) => {
        if (!confirm('Are you sure you want to delete this employee? This action cannot be undone.')) {
            return;
        }

        try {
            await api.delete(`/admin/employees/${employeeId}`);
            setSuccess('Employee deleted successfully');
            fetchData();
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.message || 'Failed to delete employee');
        }
    };

    const startEditEmployee = (employee) => {
        setEditingEmployee({ ...employee });
    };

    const cancelEditEmployee = () => {
        setEditingEmployee(null);
    };

    return (
        <div className="employee-management-page">
            <div className="page-header">
                <div className="header-left">
                    <h1>Employee Management</h1>
                    <p>Manage all employees and their roles</p>
                </div>
                <div className="header-actions">
                    {(isSuperAdmin() || hasPermission('employees.create')) && (
                        <button
                            className="btn-primary"
                            onClick={() => setShowEmployeeForm(true)}
                        >
                            <UserPlus size={16} />
                            Add Employee
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
                        <h3>Add New Employee</h3>

                        <div className="form-grid">
                            <div className="form-group">
                                <label>Full Name *</label>
                                <input
                                    type="text"
                                    value={newEmployee.name}
                                    onChange={(e) => setNewEmployee({ ...newEmployee, name: e.target.value })}
                                    placeholder="Enter employee full name"
                                />
                            </div>

                            <div className="form-group">
                                <label>Email Address *</label>
                                <input
                                    type="email"
                                    value={newEmployee.email}
                                    onChange={(e) => setNewEmployee({ ...newEmployee, email: e.target.value })}
                                    placeholder="Enter email address"
                                />
                            </div>

                            <div className="form-group">
                                <label>Password *</label>
                                <div className="password-field">
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        value={newEmployee.password}
                                        onChange={(e) => setNewEmployee({ ...newEmployee, password: e.target.value })}
                                        placeholder="Enter password (min 6 characters)"
                                    />
                                    <button
                                        type="button"
                                        className="toggle-password"
                                        onClick={() => setShowPassword(!showPassword)}
                                    >
                                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </div>

                            <div className="form-group">
                                <label>Role *</label>
                                <select
                                    value={newEmployee.roleId}
                                    onChange={(e) => setNewEmployee({ ...newEmployee, roleId: e.target.value })}
                                >
                                    <option value="">Select Role</option>
                                    {roles.filter(role => role.name !== 'super_admin').map(role => (
                                        <option key={role.id} value={role.id}>
                                            {role.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-group">
                                <label>Department</label>
                                <select
                                    value={newEmployee.departmentId}
                                    onChange={(e) => setNewEmployee({ ...newEmployee, departmentId: e.target.value })}
                                >
                                    <option value="">Select Department</option>
                                    {departments.map(department => (
                                        <option key={department.id} value={department.id}>
                                            {department.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-group">
                                <label>Country Code</label>
                                <input
                                    type="text"
                                    value={newEmployee.countryCode}
                                    onChange={(e) => setNewEmployee({ ...newEmployee, countryCode: e.target.value })}
                                    placeholder="e.g., +971"
                                />
                            </div>

                            <div className="form-group">
                                <label>Phone Number</label>
                                <input
                                    type="tel"
                                    value={newEmployee.phone}
                                    onChange={(e) => setNewEmployee({ ...newEmployee, phone: e.target.value })}
                                    placeholder="Enter phone number"
                                />
                            </div>
                        </div>

                        <div className="form-actions">
                            <button className="btn-save" onClick={createEmployee}>
                                <Save size={16} />
                                Create Employee
                            </button>
                            <button className="btn-cancel" onClick={() => setShowEmployeeForm(false)}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="employees-section">
                <div className="section-header">
                    <h3>All Employees</h3>
                    <span className="employee-count">{employees.length} total employees</span>
                </div>

                {loading ? (
                    <div className="loading">Loading employees...</div>
                ) : (
                    <div className="employees-table-container">
                        <table className="employees-table">
                            <thead>
                                <tr>
                                    <th>Employee Details</th>
                                    <th>Contact</th>
                                    <th>Department</th>
                                    <th>Role</th>
                                    <th>Status</th>
                                    <th>Created</th>
                                    {(isSuperAdmin() || hasPermission('employees.update') || hasPermission('employees.delete')) && (
                                        <th>Actions</th>
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {employees.map(employee => (
                                    <tr key={employee.id} className={editingEmployee?.id === employee.id ? 'editing' : ''}>
                                        <td>
                                            {editingEmployee?.id === employee.id ? (
                                                <div className="employee-cell">
                                                    <div className="employee-avatar">
                                                        {editingEmployee.name.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div className="employee-info">
                                                        <input
                                                            type="text"
                                                            value={editingEmployee.name}
                                                            onChange={(e) => setEditingEmployee({ ...editingEmployee, name: e.target.value })}
                                                            className="inline-input"
                                                            placeholder="Full name"
                                                        />
                                                        <input
                                                            type="email"
                                                            value={editingEmployee.email}
                                                            onChange={(e) => setEditingEmployee({ ...editingEmployee, email: e.target.value })}
                                                            className="inline-input"
                                                            placeholder="Email address"
                                                        />
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="employee-cell">
                                                    <div className="employee-avatar">
                                                        {employee.name.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div className="employee-info">
                                                        <div className="employee-name">{employee.name}</div>
                                                        <div className="employee-email">{employee.email}</div>
                                                    </div>
                                                </div>
                                            )}
                                        </td>
                                        <td>
                                            {editingEmployee?.id === employee.id ? (
                                                <div className="contact-info">
                                                    <input
                                                        type="text"
                                                        value={editingEmployee.country_code || ''}
                                                        onChange={(e) => setEditingEmployee({ ...editingEmployee, country_code: e.target.value })}
                                                        className="inline-input"
                                                        placeholder="Country code"
                                                        style={{ marginBottom: '4px', width: '80px' }}
                                                    />
                                                    <input
                                                        type="tel"
                                                        value={editingEmployee.phone || ''}
                                                        onChange={(e) => setEditingEmployee({ ...editingEmployee, phone: e.target.value })}
                                                        className="inline-input"
                                                        placeholder="Phone number"
                                                    />
                                                </div>
                                            ) : (
                                                <div className="contact-info">
                                                    {employee.phone ? (
                                                        <span>{employee.country_code} {employee.phone}</span>
                                                    ) : (
                                                        <span className="no-phone">No phone</span>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                        <td>
                                            {editingEmployee?.id === employee.id ? (
                                                <select
                                                    value={editingEmployee.department_id || ''}
                                                    onChange={(e) => setEditingEmployee({ ...editingEmployee, department_id: e.target.value })}
                                                    className="department-select"
                                                >
                                                    <option value="">No Department</option>
                                                    {departments.map(department => (
                                                        <option key={department.id} value={department.id}>
                                                            {department.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <span className="department-name">
                                                    {employee.department_name || 'No Department'}
                                                </span>
                                            )}
                                        </td>
                                        <td>
                                            {editingEmployee?.id === employee.id ? (
                                                <select
                                                    value={editingEmployee.role_id}
                                                    onChange={(e) => setEditingEmployee({ ...editingEmployee, role_id: e.target.value })}
                                                    className="role-select"
                                                >
                                                    {roles.filter(role => role.name !== 'super_admin').map(role => (
                                                        <option key={role.id} value={role.id}>
                                                            {role.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <span className={`role-badge ${employee.role_name || 'no-role'}`}>
                                                    {employee.role_name || 'No Role'}
                                                </span>
                                            )}
                                        </td>
                                        <td>
                                            {editingEmployee?.id === employee.id ? (
                                                <select
                                                    value={editingEmployee.status || 'active'}
                                                    onChange={(e) => setEditingEmployee({ ...editingEmployee, status: e.target.value })}
                                                    className="status-select"
                                                >
                                                    <option value="active">Active</option>
                                                    <option value="inactive">Inactive</option>
                                                    <option value="suspended">Suspended</option>
                                                </select>
                                            ) : (
                                                <span className={`status-badge ${employee.status || 'active'}`}>
                                                    {employee.status || 'active'}
                                                </span>
                                            )}
                                        </td>
                                        <td>
                                            <span className="created-date">
                                                {new Date(employee.created_at).toLocaleDateString()}
                                            </span>
                                        </td>
                                        {(isSuperAdmin() || hasPermission('employees.update') || hasPermission('employees.delete')) && (
                                            <td>
                                                <div className="action-buttons">
                                                    {editingEmployee?.id === employee.id ? (
                                                        <>
                                                            <button
                                                                className="btn-save"
                                                                onClick={updateEmployee}
                                                                title="Save changes"
                                                            >
                                                                <Save size={14} />
                                                            </button>
                                                            <button
                                                                className="btn-cancel"
                                                                onClick={cancelEditEmployee}
                                                                title="Cancel"
                                                            >
                                                                <X size={14} />
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            {(isSuperAdmin() || hasPermission('employees.update')) && (
                                                                <button
                                                                    className="btn-edit"
                                                                    onClick={() => startEditEmployee(employee)}
                                                                    title="Edit employee"
                                                                >
                                                                    <Edit2 size={14} />
                                                                </button>
                                                            )}
                                                            {(isSuperAdmin() || hasPermission('employees.delete')) && (
                                                                <button
                                                                    className="btn-delete"
                                                                    onClick={() => deleteEmployee(employee.id)}
                                                                    title="Delete employee"
                                                                >
                                                                    <Trash2 size={14} />
                                                                </button>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {employees.length === 0 && !loading && (
                            <div className="no-data">
                                <Users size={48} />
                                <p>No employees found</p>
                                <p>Create your first employee to get started</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}