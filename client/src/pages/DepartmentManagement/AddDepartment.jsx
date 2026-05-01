import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Save } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../helper/helper';
import './AddDepartment.css';

export default function AddDepartment() {
    useEffect(() => {
        document.title = 'Xyra Books - Add Department';
    }, []);

    const navigate = useNavigate();
    const { isSuperAdmin } = useAuth();

    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [department, setDepartment] = useState({
        name: '',
        description: '',
        status: 'active',
    });

    if (!isSuperAdmin()) {
        return (
            <div className="add-department-page">
                <div className="ad-access-denied">
                    <Building2 size={64} color="#000000" />
                    <h2>Access Denied</h2>
                    <p>Only Super Admin can access this page.</p>
                </div>
            </div>
        );
    }

    const handleChange = (field) => (e) => {
        setDepartment((prev) => ({ ...prev, [field]: e.target.value }));
    };

    const handleBack = () => {
        navigate('/admin/departments');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!department.name.trim()) {
            setError('Department name is required');
            return;
        }

        setError('');
        setSubmitting(true);
        try {
            await api.post('/admin/departments', {
                name: department.name,
                description: department.description,
                status: department.status,
            });
            navigate('/admin/departments');
        } catch (err) {
            setError(err.message || 'Failed to create department');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="add-department-page">
            <button
                type="button"
                className="ad-back-link"
                onClick={handleBack}
            >
                <ArrowLeft size={18} />
                <span>Back</span>
            </button>

            <div className="ad-breadcrumb">
                <span
                    className="ad-breadcrumb-link"
                    onClick={handleBack}
                    role="link"
                    tabIndex={0}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') handleBack();
                    }}
                >
                    Departments
                </span>
                <span className="ad-breadcrumb-sep">›</span>
                <span className="ad-breadcrumb-current">Create</span>
            </div>

            <h1 className="ad-page-title">Create Department</h1>

            {error && <div className="ad-alert error">{error}</div>}

            <form className="ad-form" onSubmit={handleSubmit}>
                <div className="ad-section">
                    <div className="ad-section-header">
                        <Building2 size={18} />
                        <h2>Department Details</h2>
                    </div>
                    <div className="ad-section-divider" />

                    <div className="ad-grid">
                        <div className="ad-field">
                            <label htmlFor="dept-name">
                                Department Name<span className="ad-required">*</span>
                            </label>
                            <input
                                id="dept-name"
                                type="text"
                                value={department.name}
                                onChange={handleChange('name')}
                                placeholder="Enter department name"
                            />
                        </div>

                        <div className="ad-field">
                            <label htmlFor="dept-status">Status</label>
                            <select
                                id="dept-status"
                                value={department.status}
                                onChange={handleChange('status')}
                            >
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                            </select>
                        </div>

                        <div className="ad-field ad-field-full">
                            <label htmlFor="dept-description">Description</label>
                            <textarea
                                id="dept-description"
                                rows={4}
                                value={department.description}
                                onChange={handleChange('description')}
                                placeholder="Enter department description"
                            />
                        </div>
                    </div>
                </div>

                <div className="ad-actions">
                    <button
                        type="button"
                        className="ad-btn ad-btn-secondary"
                        onClick={handleBack}
                        disabled={submitting}
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        className="ad-btn ad-btn-primary"
                        disabled={submitting}
                    >
                        <Save size={16} />
                        {submitting ? 'Creating...' : 'Create Department'}
                    </button>
                </div>
            </form>
        </div>
    );
}
