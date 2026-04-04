import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Plus, Settings, Edit3, Save, X, FileText, CreditCard, PieChart } from "lucide-react";
import "./Registration.css";

export default function Registration() {
    // Set document title
    React.useEffect(() => {
        document.title = "Xyra Books - Registration";
    }, []);

    return (
        <div className="registration-page">
            <div className="page-header">
                <h2>Registration</h2>
                <p>Business registration and licensing management</p>
            </div>
            
            <div className="content-grid">
                <div className="card">
                    <h3>Business Registration</h3>
                    <p>Manage business registration processes and documentation.</p>
                </div>
                
                <div className="card">
                    <h3>Licensing</h3>
                    <p>Track and manage business licenses and permits.</p>
                </div>
                
                <div className="card">
                    <h3>Compliance</h3>
                    <p>Ensure compliance with registration requirements.</p>
                </div>
                
                <div className="card">
                    <h3>Renewals</h3>
                    <p>Track and manage registration renewals and deadlines.</p>
                </div>
            </div>
        </div>
    );
}
