import React, { useState, useEffect } from 'react';
import { Building2, Plus, Edit2, Trash2, Save, X, Shield, PlusCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../helper/helper';
import './Companies.css';

export default function Companies() {
    // Set document title
    useEffect(() => {
        document.title = "DocuFlow - Company Management";
    }, []);

    const { isSuperAdmin } = useAuth();
    const [companies, setCompanies] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    // Company management states
    const [showForm, setShowForm] = useState(false);
    const [editingCompany, setEditingCompany] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        type: 'Mainland',
        description: ''
    });

    // Check if user has access to this page - only for super admins
    if (!isSuperAdmin()) {
        return (
            <div className="companies-management-page">
                <div className="access-denied">
                    <Shield size={64} />
                    <h2>Access Denied</h2>
                    <p>You don't have permission to access this page.</p>
                </div>
            </div>
        );
    }

    useEffect(() => {
        fetchCompanies();
    }, []);

    const fetchCompanies = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await api.get('/companies');
            setCompanies(res.data.companies || []);
        } catch (err) {
            setError(err.message || 'Failed to fetch companies');
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async () => {
        if (!formData.name.trim()) {
            setError('Company name is required');
            return;
        }

        try {
            await api.post('/companies', formData);
            setSuccess('Company created successfully');
            setFormData({ name: '', type: 'Mainland', description: '' });
            setShowForm(false);
            fetchCompanies();
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.message || 'Failed to create company');
        }
    };

    const handleUpdate = async () => {
        if (!editingCompany.name.trim()) {
            setError('Company name is required');
            return;
        }

        try {
            await api.put(`/companies/${editingCompany.id}`, {
                name: editingCompany.name,
                type: editingCompany.type,
                description: editingCompany.description
            });
            setSuccess('Company updated successfully');
            setEditingCompany(null);
            fetchCompanies();
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.message || 'Failed to update company');
        }
    };

    const handleDelete = async (id) => {
        if (!confirm('Are you sure you want to delete this company? All related data may be affected.')) {
            return;
        }

        try {
            await api.delete(`/companies/${id}`);
            setSuccess('Company deleted successfully');
            fetchCompanies();
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.message || 'Failed to delete company');
        }
    };

    const startEdit = (company) => {
        setEditingCompany({ ...company });
        setShowForm(true);
    };

    const closeForm = () => {
        setShowForm(false);
        setEditingCompany(null);
        setFormData({ name: '', type: 'Mainland', description: '' });
        setError('');
    };

    return (
        <div className="companies-management-page">
            <div className="page-header">
                <div className="header-left">
                    <h1>Company Management</h1>
                    <p>Create and manage multiple companies in the system</p>
                </div>
                <div className="header-actions">
                    <button
                        className="btn-primary"
                        onClick={() => setShowForm(true)}
                    >
                        <PlusCircle size={18} />
                        Add Company
                    </button>
                </div>
            </div>

            {error && <div className="alert error">{error}</div>}
            {success && <div className="alert success">{success}</div>}

            {/* Company Modal Form */}
            {showForm && (
                <div className="form-container-overlay">
                    <div className="company-form">
                        <h3>{editingCompany ? 'Edit Company' : 'Add New Company'}</h3>

                        <div className="form-group">
                            <label>Company Name *</label>
                            <input
                                type="text"
                                value={editingCompany ? editingCompany.name : formData.name}
                                onChange={(e) => editingCompany
                                    ? setEditingCompany({ ...editingCompany, name: e.target.value })
                                    : setFormData({ ...formData, name: e.target.value })
                                }
                                placeholder="Enter company name"
                            />
                        </div>

                        <div className="form-group">
                            <label>Company Type *</label>
                            <select
                                value={editingCompany ? editingCompany.type : formData.type}
                                onChange={(e) => editingCompany
                                    ? setEditingCompany({ ...editingCompany, type: e.target.value })
                                    : setFormData({ ...formData, type: e.target.value })
                                }
                            >
                                <option value="Mainland">Mainland</option>
                                <option value="Freezone">Freezone</option>
                                <option value="Individual">Individual</option>
                                <option value="Corporate">Corporate</option>
                            </select>
                        </div>

                        <div className="form-group">
                            <label>Description</label>
                            <textarea
                                value={editingCompany ? editingCompany.description : formData.description}
                                onChange={(e) => editingCompany
                                    ? setEditingCompany({ ...editingCompany, description: e.target.value })
                                    : setFormData({ ...formData, description: e.target.value })
                                }
                                placeholder="Enter description (optional)"
                                rows="3"
                            />
                        </div>

                        <div className="form-actions">
                            <button className="btn-save" onClick={editingCompany ? handleUpdate : handleCreate}>
                                <Save size={16} />
                                {editingCompany ? 'Update Company' : 'Create Company'}
                            </button>
                            <button className="btn-cancel" onClick={closeForm}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="companies-section">
                <div className="section-header">
                    <h3>Companies List</h3>
                    <span className="company-count">{companies.length} total companies</span>
                </div>

                {loading ? (
                    <div className="loading">Loading companies...</div>
                ) : (
                    <div className="table-responsive">
                        <table className="companies-table">
                            <thead>
                                <tr>
                                    <th>Company Name</th>
                                    <th>Type</th>
                                    <th>Description</th>
                                    <th>Created At</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {companies.map(company => (
                                    <tr key={company.id}>
                                        <td>
                                            <div className="company-info">
                                                <Building2 size={16} style={{ marginRight: '8px' }} />
                                                <strong>{company.name}</strong>
                                            </div>
                                        </td>
                                        <td>
                                            <span className={`type-badge type-${company.type}`}>
                                                {company.type}
                                            </span>
                                        </td>
                                        <td>{company.description || '-'}</td>
                                        <td>{new Date(company.created_at).toLocaleDateString()}</td>
                                        <td>
                                            <div className="action-buttons">
                                                <button
                                                    className="btn-edit"
                                                    onClick={() => startEdit(company)}
                                                >
                                                    <Edit2 size={14} />
                                                </button>
                                                <button
                                                    className="btn-delete"
                                                    onClick={() => handleDelete(company.id)}
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {companies.length === 0 && (
                                    <tr>
                                        <td colSpan="5" className="no-data">
                                            No companies found. Create one to get started.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
