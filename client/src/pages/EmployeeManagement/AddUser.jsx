import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, Save, Eye, EyeOff, Shield } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../helper/helper';
import './AddUser.css';

export default function AddUser() {
    useEffect(() => {
        document.title = 'Xyra Books - Add User';
    }, []);

    const navigate = useNavigate();
    const { isSuperAdmin, isCompanyAdmin, user } = useAuth();

    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const [companies, setCompanies] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [roles, setRoles] = useState([]);

    const [form, setForm] = useState({
        name: '',
        email: '',
        password: '',
        companyId: isSuperAdmin() ? '' : user?.company_id || '',
        departmentId: '',
        roleId: '',
    });

    const hasAccess = isSuperAdmin() || isCompanyAdmin();

    useEffect(() => {
        if (!hasAccess) return;
        const loadInitial = async () => {
            try {
                if (isSuperAdmin()) {
                    const compRes = await api.get('/companies');
                    setCompanies(compRes.data.companies || []);
                }
                await Promise.all([
                    fetchDepartments(),
                    fetchRoles(),
                ]);
            } catch (err) {
                setError(
                    err.response?.data?.message || err.message || 'Failed to load data'
                );
            }
        };
        loadInitial();
    }, [hasAccess]);

    useEffect(() => {
        if (!hasAccess) return;
        fetchDepartments();
        fetchRoles();
    }, [form.companyId]);

    const fetchDepartments = async () => {
        try {
            const res = await api.get('/admin/departments');
            setDepartments(res.data.departments || []);
        } catch (err) {
            console.error('Failed to fetch departments:', err);
        }
    };

    const fetchRoles = async () => {
        try {
            const res = await api.get('/admin/roles');
            setRoles(
                (res.data.roles || []).filter((role) => role.name !== 'super_admin')
            );
        } catch (err) {
            console.error('Failed to fetch roles:', err);
            setRoles([]);
        }
    };

    if (!hasAccess) {
        return (
            <div className="add-user-page">
                <div className="au-access-denied">
                    <Shield size={64} />
                    <h2>Access Denied</h2>
                    <p>You don't have permission to access this page.</p>
                </div>
            </div>
        );
    }

    const handleChange = (field) => (e) => {
        const value = e.target.value;
        setForm((prev) => {
            const next = { ...prev, [field]: value };
            if (field === 'companyId') {
                next.departmentId = '';
                next.roleId = '';
            }
            if (field === 'departmentId') {
                next.roleId = '';
            }
            return next;
        });
    };

    const handleBack = () => {
        navigate('/admin/employees');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (
            !form.name.trim() ||
            !form.email.trim() ||
            !form.password.trim() ||
            !form.roleId
        ) {
            setError('Name, email, password and role are required');
            return;
        }

        setError('');
        setSubmitting(true);
        try {
            await api.post('/admin/employees', {
                name: form.name,
                email: form.email,
                password: form.password,
                roleId: form.roleId,
                departmentId: form.departmentId,
                companyId: isSuperAdmin() ? form.companyId : user.company_id,
            });
            navigate('/admin/employees');
        } catch (err) {
            setError(
                err.response?.data?.message || err.message || 'Failed to create user'
            );
        } finally {
            setSubmitting(false);
        }
    };

    const filteredRoles = form.departmentId
        ? roles.filter(
              (role) => String(role.department_id) === String(form.departmentId)
          )
        : roles;

    return (
        <div className="add-user-page">
            <button type="button" className="au-back-link" onClick={handleBack}>
                <ArrowLeft size={18} />
                <span>Back</span>
            </button>

            <div className="au-breadcrumb">
                <span
                    className="au-breadcrumb-link"
                    onClick={handleBack}
                    role="link"
                    tabIndex={0}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') handleBack();
                    }}
                >
                    User Management
                </span>
                <span className="au-breadcrumb-sep">›</span>
                <span className="au-breadcrumb-current">Create</span>
            </div>

            <h1 className="au-page-title">Create User</h1>

            {error && <div className="au-alert error">{error}</div>}

            <form className="au-form" onSubmit={handleSubmit}>
                <div className="au-section">
                    <div className="au-section-header">
                        <Users size={18} />
                        <h2>User Details</h2>
                    </div>
                    <div className="au-section-divider" />

                    <div className="au-grid">
                        <div className="au-field">
                            <label htmlFor="user-name">
                                Name<span className="au-required">*</span>
                            </label>
                            <input
                                id="user-name"
                                type="text"
                                value={form.name}
                                onChange={handleChange('name')}
                                placeholder="Enter user name"
                            />
                        </div>

                        <div className="au-field">
                            <label htmlFor="user-email">
                                Email<span className="au-required">*</span>
                            </label>
                            <input
                                id="user-email"
                                type="email"
                                value={form.email}
                                onChange={handleChange('email')}
                                placeholder="Enter user email"
                            />
                        </div>

                        <div className="au-field">
                            <label htmlFor="user-password">
                                Password<span className="au-required">*</span>
                            </label>
                            <div className="au-password-wrap">
                                <input
                                    id="user-password"
                                    type={showPassword ? 'text' : 'password'}
                                    value={form.password}
                                    onChange={handleChange('password')}
                                    placeholder="Enter password"
                                />
                                <button
                                    type="button"
                                    className="au-password-toggle"
                                    onClick={() => setShowPassword((s) => !s)}
                                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                                >
                                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>

                        {isSuperAdmin() && user?.type !== 'admin' && (
                            <div className="au-field">
                                <label htmlFor="user-company">
                                    Company<span className="au-required">*</span>
                                </label>
                                <select
                                    id="user-company"
                                    value={form.companyId}
                                    onChange={handleChange('companyId')}
                                >
                                    <option value="">Select Company</option>
                                    {companies.map((comp) => (
                                        <option key={comp.id} value={comp.id}>
                                            {comp.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>
                </div>

                <div className="au-section">
                    <div className="au-section-header">
                        <Shield size={18} />
                        <h2>Department & Role</h2>
                    </div>
                    <div className="au-section-divider" />

                    <div className="au-grid">
                        <div className="au-field">
                            <label htmlFor="user-department">
                                Department<span className="au-required">*</span>
                            </label>
                            <select
                                id="user-department"
                                value={form.departmentId}
                                onChange={handleChange('departmentId')}
                                disabled={
                                    user?.type !== 'admin' &&
                                    isSuperAdmin() &&
                                    !form.companyId
                                }
                            >
                                <option value="">Select Department</option>
                                {departments.map((dept) => (
                                    <option key={dept.id} value={dept.id}>
                                        {dept.name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="au-field">
                            <label htmlFor="user-role">
                                Role<span className="au-required">*</span>
                            </label>
                            <select
                                id="user-role"
                                value={form.roleId}
                                onChange={handleChange('roleId')}
                            >
                                <option value="">Select Role</option>
                                {filteredRoles.map((role) => (
                                    <option key={role.id} value={role.id}>
                                        {`${role.name} - ${role.department_name || 'No Department'}`}
                                    </option>
                                ))}
                                {form.departmentId && filteredRoles.length === 0 && (
                                    <option disabled>No roles available</option>
                                )}
                            </select>
                        </div>
                    </div>
                </div>

                <div className="au-actions">
                    <button
                        type="button"
                        className="au-btn au-btn-secondary"
                        onClick={handleBack}
                        disabled={submitting}
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        className="au-btn au-btn-primary"
                        disabled={submitting}
                    >
                        <Save size={16} />
                        {submitting ? 'Creating...' : 'Create User'}
                    </button>
                </div>
            </form>
        </div>
    );
}
