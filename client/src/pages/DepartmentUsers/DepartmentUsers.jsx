import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Users, Plus, Edit2, Trash2, Save, X, UserPlus, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../helper/helper';
import './DepartmentUsers.css';

export default function DepartmentUsers() {
  // Set document title
  useEffect(() => {
    document.title = "Xyra Books - Department Users";
  }, []);

  const { departmentId } = useParams();
  const navigate = useNavigate();
  const { user, isSuperAdmin, isDepartmentAdmin } = useAuth();
  const [department, setDepartment] = useState(null);
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // CRUD states
  const [editingUser, setEditingUser] = useState(null);
  const [showUserForm, setShowUserForm] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false); // For edit form
  const [newUser, setNewUser] = useState({ 
    name: '', 
    email: '', 
    password: '', 
    roleId: ''
  });

  useEffect(() => {
    fetchData();
  }, [departmentId]);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    
    try {
      // Check if user has access to this department
      if (user.department_id !== parseInt(departmentId) && !isSuperAdmin()) {
        setError('Access denied: You do not have permission to manage users in this department');
        setLoading(false);
        return;
      }

      // For department admins, fetch only their department data
      if (isDepartmentAdmin() && !isSuperAdmin()) {
        // Fetch department info and users for department admins
        const [deptRes, usersRes, rolesRes] = await Promise.all([
          api.get(`/admin/departments/${departmentId}`),
          api.get(`/admin/departments/${departmentId}/users`),
          api.get(`/admin/departments/${departmentId}/roles`)
        ]);

        // Set department data
        const dept = deptRes.data.department || deptRes.data;
        setDepartment(dept);

        // Set users data
        const deptUsers = usersRes.data.users || usersRes.data.employees || [];
        setUsers(deptUsers);
        
        // Set roles data - only admin and user roles for this department
        const deptRoles = (rolesRes.data.roles || []).filter(role => 
          (role.name === 'admin' || role.name === 'user') && role.department_id == departmentId
        );
        setRoles(deptRoles);
      } else {
        // For super admins, fetch all data
        const [deptRes, usersRes, rolesRes] = await Promise.all([
          api.get(`/admin/departments`),
          api.get(`/admin/employees`),
          api.get(`/admin/roles`)
        ]);

        // Find the specific department
        const dept = deptRes.data.departments.find(d => d.id == departmentId);
        if (!dept) {
          setError('Department not found');
          setLoading(false);
          return;
        }
        
        setDepartment(dept);

        // Filter users for this department only
        const deptUsers = usersRes.data.employees.filter(u => u.department_id == departmentId);
        setUsers(deptUsers);
        
        // Filter roles for this department only
        const deptRoles = rolesRes.data.roles.filter(r => r.department_id == departmentId);
        setRoles(deptRoles);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  // User CRUD functions
  const createUser = async () => {
    if (!newUser.name.trim() || !newUser.email.trim() || !newUser.password.trim()) {
      setError('Name, email, and password are required');
      return;
    }
    if (!newUser.roleId) {
      setError('Role is required');
      return;
    }
    
    try {
      await api.post('/admin/employees', {
        name: newUser.name,
        email: newUser.email,
        password: newUser.password,
        roleId: newUser.roleId,
        departmentId: departmentId
      });
      setSuccess('User created successfully');
      setNewUser({ 
        name: '', 
        email: '', 
        password: '', 
        roleId: ''
      });
      setShowUserForm(false);
      fetchData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to create user');
    }
  };

  const startEditUser = (user) => {
    setEditingUser({ ...user });
    setShowEditPassword(false); // Reset password visibility when starting to edit
  };

  const cancelEditUser = () => {
    setEditingUser(null);
  };

  const saveUserChanges = async () => {
    try {
      const updateData = {
        name: editingUser.name,
        email: editingUser.email,
        roleId: editingUser.role_id,
        departmentId: departmentId
      };
      
      // Only include password if it's not empty
      if (editingUser.password && editingUser.password.trim() !== '') {
        updateData.password = editingUser.password;
      }
      
      // Only include status if it exists
      if (editingUser.status) {
        updateData.status = editingUser.status;
      }
      
      await api.put(`/admin/employees/${editingUser.id}`, updateData);
      setSuccess('User updated successfully');
      setEditingUser(null);
      fetchData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to update user');
    }
  };

  const deleteUser = async (userId) => {
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      return;
    }
    
    try {
      await api.delete(`/admin/employees/${userId}`);
      setSuccess('User deleted successfully');
      fetchData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to delete user');
    }
  };

  if (loading) {
    return <div className="department-users">Loading...</div>;
  }

  if (error) {
    return <div className="department-users error">{error}</div>;
  }

  if (!department) {
    return <div className="department-users">Department not found</div>;
  }

  // Only show to department admins and super admins
  if (!isSuperAdmin() && (!isDepartmentAdmin() || user.department_id !== parseInt(departmentId))) {
    return <div className="department-users error">Access denied: Only department admins can manage users</div>;
  }

  return (
    <div className="department-users">
      <div className="page-header">
        <div className="header-left">
          <h1>{department.name} Users</h1>
          <p>Manage team members in your department</p>
        </div>
        <div className="header-actions">
          <button 
            className="btn-primary"
            onClick={() => setShowUserForm(true)}
          >
            <UserPlus size={16} />
            Add User
          </button>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      {success && <div className="alert success">{success}</div>}

      {showUserForm && (
        <div className="user-form">
          <div>
            <h4>Create New User</h4>
            <div className="form-grid">
              <div className="form-group">
                <label>Full Name *</label>
                <input
                  type="text"
                  value={newUser.name}
                  onChange={(e) => setNewUser({...newUser, name: e.target.value})}
                  placeholder="Enter full name"
                />
              </div>
              <div className="form-group">
                <label>Email Address *</label>
                <input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                  placeholder="Enter email address"
                />
              </div>
              <div className="form-group">
                <label>Password *</label>
                <div className="password-input-container">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={newUser.password}
                    onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                    placeholder="Enter password (min 6 chars)"
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label>Role *</label>
                <select
                  value={newUser.roleId}
                  onChange={(e) => setNewUser({...newUser, roleId: e.target.value})}
                >
                  <option value="">Select Role</option>
                  {roles.map(role => (
                    <option key={role.id} value={role.id}>
                      {role.name}{role.department_name ? ` - ${role.department_name}` : ''}
                    </option>
                  ))}
                  {roles.length === 0 && (
                    <option value="" disabled>No roles available</option>
                  )}
                </select>
                {roles.length === 0 && (
                  <p className="help-text">No roles available. Please create roles first.</p>
                )}
              </div>
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
        </div>
      )}
      
      <div className="users-table-container">
        <table className="users-table">
          <thead>
            <tr>
              <th>User Name</th>
              <th>Email</th>
              <th>Department</th>
              <th>Role</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id}>
                {editingUser?.id === user.id ? (
                  // Edit Mode
                  <td colSpan="5">
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
                            value={editingUser.name}
                            onChange={(e) => setEditingUser({...editingUser, name: e.target.value})}
                          />
                        </div>
                        
                        <div className="field-group">
                          <label>Email</label>
                          <input
                            type="email"
                            value={editingUser.email}
                            onChange={(e) => setEditingUser({...editingUser, email: e.target.value})}
                          />
                        </div>
                        
                        <div className="field-group">
                          <label>Password</label>
                          <div className="password-input-container">
                            <input
                              type={showEditPassword ? "text" : "password"}
                              placeholder="Enter new password to change, leave blank to keep current"
                              onChange={(e) => setEditingUser({...editingUser, password: e.target.value})}
                            />
                            <button
                              type="button"
                              className="password-toggle"
                              onClick={() => setShowEditPassword(!showEditPassword)}
                            >
                              {showEditPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                            </button>
                          </div>
                          <div className="help-text">Leave blank to keep the current password</div>
                        </div>
                        
                        <div className="field-group">
                          <label>Status</label>
                          <select
                            value={editingUser.status || 'active'}
                            onChange={(e) => setEditingUser({...editingUser, status: e.target.value})}
                          >
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                          </select>
                        </div>
                      </div>
                      
                      <div className="edit-actions">
                        <button className="btn-save" onClick={saveUserChanges}>
                          <Save size={14} />
                          Save
                        </button>
                        <button className="btn-cancel" onClick={cancelEditUser}>
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
                        {user.name}
                      </div>
                    </td>
                    <td>
                      <span className="employee-email">
                        {user.email}
                      </span>
                    </td>
                    <td>
                      <span className="employee-department">
                        {department.name}
                      </span>
                    </td>
                    <td>
                      <span className="employee-role">
                        {user.role_name || 'No Role'}
                      </span>
                    </td>
                    <td>
                      <div className="action-buttons">
                        <button 
                          className="btn-edit"
                          onClick={() => startEditUser(user)}
                          title="Edit user"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button 
                          className="btn-delete"
                          onClick={() => deleteUser(user.id)}
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
        {users.length === 0 && (
          <div className="no-data">
            <Users size={48} />
            <p>No users found in this department</p>
          </div>
        )}
      </div>
    </div>
  );
}
