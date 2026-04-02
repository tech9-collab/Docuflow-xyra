import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Plus, Settings, Edit3, Save, X, FileText, CreditCard, PieChart } from "lucide-react";
import "./BookKeeping.css";

export default function BookKeeping() {
    // Set document title
    React.useEffect(() => {
        document.title = "DocuFlow - Book Keeping";
    }, []);

    return (
        <div className="book-keeping-page">
            <div className="page-header">
                <h2>Book Keeping</h2>
                <p>Comprehensive bookkeeping summary and analytics</p>
            </div>
            
            <div className="content-grid">
                <div className="card">
                    <h3>Financial Summary</h3>
                    <p>Overview of key financial metrics and performance indicators.</p>
                </div>
                
                <div className="card">
                    <h3>Revenue Analysis</h3>
                    <p>Detailed breakdown of revenue streams and trends.</p>
                </div>
                
                <div className="card">
                    <h3>Expense Tracking</h3>
                    <p>Comprehensive view of expenses and cost management.</p>
                </div>
                
                <div className="card">
                    <h3>Cash Flow</h3>
                    <p>Real-time cash flow monitoring and projections.</p>
                </div>
            </div>
        </div>
    );
}