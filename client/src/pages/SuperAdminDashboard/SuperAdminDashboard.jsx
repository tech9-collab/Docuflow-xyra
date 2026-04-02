import React from "react";
import "./SuperAdminDashboard.css";

export default function SuperAdminDashboard() {
    return (
        <div className="super-admin-dashboard">
            <h1>Super Admin Dashboard</h1>
            <p>Welcome, System Administrator. You have full access to all departments and companies.</p>

            <div className="stats-grid">
                <div className="stat-card">
                    <h3>Total Companies</h3>
                    <p className="value">12</p>
                </div>
                <div className="stat-card">
                    <h3>Total Users</h3>
                    <p className="value">150</p>
                </div>
                <div className="stat-card">
                    <h3>System Load</h3>
                    <p className="value">Normal</p>
                </div>
            </div>
        </div>
    );
}
