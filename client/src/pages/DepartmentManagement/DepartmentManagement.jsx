import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Plus, Edit2, Trash2, Save, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../helper/helper';
import './DepartmentManagement.css';

export default function DepartmentManagement() {
    // Set document title
    useEffect(() => {
        document.title = "Xyra Books - Department Management";
    }, []);

    const navigate = useNavigate();
    const { isSuperAdmin } = useAuth();
    const [departments, setDepartments] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    
    // Department management states
    const [showDepartmentForm, setShowDepartmentForm] = useState(false);
    const [editingDepartment, setEditingDepartment] = useState(null);
    const [newDepartment, setNewDepartment] = useState({
        name: '',
        description: '',
        status: 'active'
    });

    // Check if user has access to this page
    if (!isSuperAdmin()) {
        return (
            <div className="department-management-page">
                <div className="access-denied">
                    <Building2 size={64} color="#000000" />
                    <h2>Access Denied</h2>
                    <p>Only Super Admin can access this page.</p>
                </div>
            </div>
        );
    }

    useEffect(() => {
        fetchDepartments();
    }, []);

    const fetchDepartments = async () => {
        setLoading(true);
        setError('');
        
        try {
            const response = await api.get('/admin/departments');
            setDepartments(response.data.departments || []);
        } catch (err) {
            setError(err.message || 'Failed to fetch departments');
        } finally {
            setLoading(false);
        }
    };

    const createDepartment = async () => {
        if (!newDepartment.name.trim()) {
            setError('Department name is required');
            return;
        }
        
        try {
            await api.post('/admin/departments', {
                name: newDepartment.name,
                description: newDepartment.description,
                status: newDepartment.status
            });
            setSuccess('Department created successfully');
            setNewDepartment({ 
                name: '', 
                description: '', 
                status: 'active'
            });
            setShowDepartmentForm(false);
            fetchDepartments();
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
            await api.put(`/admin/departments/${editingDepartment.id}`, {
                name: editingDepartment.name,
                description: editingDepartment.description,
                status: editingDepartment.status
            });
            setSuccess('Department updated successfully');
            setEditingDepartment(null);
            fetchDepartments();
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.message || 'Failed to update department');
        }
    };

    const deleteDepartment = async (departmentId) => {
        if (!confirm('Are you sure you want to delete this department? This action cannot be undone.')) {
            return;
        }
        
        try {
            await api.delete(`/admin/departments/${departmentId}`);
            setSuccess('Department deleted successfully');
            fetchDepartments();
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.message || 'Failed to delete department');
        }
    };

    const startEditDepartment = (department) => {
        setEditingDepartment({ ...department });
    };

    const cancelEditDepartment = () => {
        setEditingDepartment(null);
    };

    return (
        <div className="department-management-page">
            <div className="page-header">
                <div className="header-left">
                    <h1>Department Management</h1>
                    <p>Organize your company into departments for better management</p>
                </div>
                <div className="header-actions">
                    <button
                        className="btn-primary"
                        onClick={() => navigate('/admin/departments/create')}
                    >
                        <Plus size={16} color="white" />
                        Add Department
                    </button>
                </div>
            </div>

            {error && <div className="alert error">{error}</div>}
            {success && <div className="alert success">{success}</div>}

            {/* Department Creation Form */}
            {showDepartmentForm && (
                <div className="department-form-container">
                    <div className="department-form">
                        <h3>Add New Department</h3>
                        
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
                                    placeholder="Enter department description"
                                    rows={3}
                                />
                            </div>
                            
                            <div className="form-group">
                                <label>Status</label>
                                <select
                                    value={newDepartment.status}
                                    onChange={(e) => setNewDepartment({...newDepartment, status: e.target.value})}
                                >
                                    <option value="active">Active</option>
                                    <option value="inactive">Inactive</option>
                                </select>
                            </div>
                        </div>
                        
                        <div className="form-actions">
                            <button className="btn-save" onClick={createDepartment}>
                                <Save size={16} color="white" />
                                Create Department
                            </button>
                            <button className="btn-cancel" onClick={() => setShowDepartmentForm(false)}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="departments-section">
                <div className="section-header">
                    <h3>All Departments</h3>
                    <span className="department-count">{departments.length} total departments</span>
                </div>
                
                {loading ? (
                    <div className="loading">Loading departments...</div>
                ) : (
                    <div className="departments-table-container">
                        <table className="departments-table">
                            <thead>
                                <tr>
                                    <th>Department Name</th>
                                    <th>Description</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {departments.map(department => (
                                    <tr key={department.id}>
                                        {editingDepartment?.id === department.id ? (
                                            // Edit Mode
                                            <td colSpan="4">
                                                <div className="department-edit-form">
                                                    <div className="edit-header">
                                                        <Building2 size={24} color="#000000" />
                                                        <h4>Editing Department</h4>
                                                    </div>
                                                    
                                                    <div className="edit-fields">
                                                        <div className="field-group">
                                                            <label>Name</label>
                                                            <input
                                                                type="text"
                                                                value={editingDepartment.name}
                                                                onChange={(e) => setEditingDepartment({...editingDepartment, name: e.target.value})}
                                                            />
                                                        </div>
                                                        
                                                        <div className="field-group">
                                                            <label>Description</label>
                                                            <textarea
                                                                value={editingDepartment.description || ''}
                                                                onChange={(e) => setEditingDepartment({...editingDepartment, description: e.target.value})}
                                                                rows={2}
                                                            />
                                                        </div>
                                                        
                                                        <div className="field-group">
                                                            <label>Status</label>
                                                            <select
                                                                value={editingDepartment.status || 'active'}
                                                                onChange={(e) => setEditingDepartment({...editingDepartment, status: e.target.value})}
                                                            >
                                                                <option value="active">Active</option>
                                                                <option value="inactive">Inactive</option>
                                                            </select>
                                                        </div>
                                                    </div>
                                                    
                                                    <div className="edit-actions">
                                                        <button className="btn-save" onClick={updateDepartment}>
                                                            <Save size={14} color="white" />
                                                            Save
                                                        </button>
                                                        <button className="btn-cancel" onClick={cancelEditDepartment}>
                                                            <X size={14} color="#000000" />
                                                            Cancel
                                                        </button>
                                                    </div>
                                                </div>
                                            </td>
                                        ) : (
                                            // View Mode
                                            <>
                                                <td>
                                                    <div className="department-name">
                                                        <Building2 size={16} color="#000000" />
                                                        {department.name}
                                                    </div>
                                                </td>
                                                <td>
                                                    <span className="department-description">
                                                        {department.description || 'No description'}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className={`status-badge ${department.status || 'active'}`}>
                                                        {department.status || 'active'}
                                                    </span>
                                                </td>
                                                <td>
                                                    <div className="action-buttons">
                                                        <button 
                                                            className="btn-edit"
                                                            onClick={() => startEditDepartment(department)}
                                                            title="Edit department"
                                                        >
                                                            <Edit2 size={14} color="#000000" />
                                                        </button>
                                                        <button 
                                                            className="btn-delete"
                                                            onClick={() => deleteDepartment(department.id)}
                                                            title="Delete department"
                                                        >
                                                            <Trash2 size={14} color="#000000" />
                                                        </button>
                                                    </div>
                                                </td>
                                            </>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        
                        {departments.length === 0 && !loading && (
                            <div className="no-data">
                                <Building2 size={48} color="#000000" />
                                <p>No departments found</p>
                                <p>Create your first department to get started</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
