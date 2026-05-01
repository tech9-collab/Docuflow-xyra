import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Wallet } from 'lucide-react';
import './CreatePayrollPayment.css';

export default function CreatePayrollPayment() {
    useEffect(() => {
        document.title = 'Xyra Books - Create Payroll Payment';
    }, []);

    const navigate = useNavigate();
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const [payment, setPayment] = useState({
        employeeName: '',
        employeeId: '',
        paymentDate: '',
        payPeriodFrom: '',
        payPeriodTo: '',
        amount: '',
        paymentMethod: 'bank_transfer',
        referenceNumber: '',
        description: '',
        status: 'pending',
    });

    const handleChange = (field) => (e) => {
        setPayment((prev) => ({ ...prev, [field]: e.target.value }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();

        if (!payment.employeeName.trim()) {
            setError('Employee name is required');
            return;
        }
        if (!payment.paymentDate) {
            setError('Payment date is required');
            return;
        }
        if (!payment.amount || Number(payment.amount) <= 0) {
            setError('Enter a valid payment amount');
            return;
        }

        setError('');
        setSubmitting(true);

        // UI-only flow — no API wiring per task scope
        setTimeout(() => {
            setSubmitting(false);
            setSuccess('Payroll payment created successfully');
            setTimeout(() => setSuccess(''), 3000);
        }, 400);
    };

    const handleCancel = () => {
        if (window.history.length > 1) {
            navigate(-1);
        } else {
            navigate('/admin/dashboard');
        }
    };

    return (
        <div className="payroll-payment-page">
            <div className="page-header">
                <div className="header-left">
                    <button
                        type="button"
                        className="btn-back"
                        onClick={handleCancel}
                        aria-label="Go back"
                    >
                        <ArrowLeft size={18} color="#000000" />
                    </button>
                    <div>
                        <h1>Create Payroll Payment</h1>
                        <p>Record a new salary or wage payment for an employee</p>
                    </div>
                </div>
            </div>

            {error && <div className="alert error">{error}</div>}
            {success && <div className="alert success">{success}</div>}

            <div className="payroll-form-container">
                <form className="payroll-form" onSubmit={handleSubmit}>
                    <div className="payroll-form-title">
                        <Wallet size={22} color="#000000" />
                        <h3>New Payroll Payment</h3>
                    </div>

                    <div className="form-grid two-col">
                        <div className="form-group">
                            <label>Employee Name *</label>
                            <input
                                type="text"
                                value={payment.employeeName}
                                onChange={handleChange('employeeName')}
                                placeholder="Enter employee name"
                            />
                        </div>

                        <div className="form-group">
                            <label>Employee ID</label>
                            <input
                                type="text"
                                value={payment.employeeId}
                                onChange={handleChange('employeeId')}
                                placeholder="Enter employee ID"
                            />
                        </div>

                        <div className="form-group">
                            <label>Payment Date *</label>
                            <input
                                type="date"
                                value={payment.paymentDate}
                                onChange={handleChange('paymentDate')}
                            />
                        </div>

                        <div className="form-group">
                            <label>Amount (AED) *</label>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={payment.amount}
                                onChange={handleChange('amount')}
                                placeholder="0.00"
                            />
                        </div>

                        <div className="form-group">
                            <label>Pay Period From</label>
                            <input
                                type="date"
                                value={payment.payPeriodFrom}
                                onChange={handleChange('payPeriodFrom')}
                            />
                        </div>

                        <div className="form-group">
                            <label>Pay Period To</label>
                            <input
                                type="date"
                                value={payment.payPeriodTo}
                                onChange={handleChange('payPeriodTo')}
                            />
                        </div>

                        <div className="form-group">
                            <label>Payment Method</label>
                            <select
                                value={payment.paymentMethod}
                                onChange={handleChange('paymentMethod')}
                            >
                                <option value="bank_transfer">Bank Transfer</option>
                                <option value="cheque">Cheque</option>
                                <option value="cash">Cash</option>
                                <option value="wps">WPS</option>
                            </select>
                        </div>

                        <div className="form-group">
                            <label>Reference Number</label>
                            <input
                                type="text"
                                value={payment.referenceNumber}
                                onChange={handleChange('referenceNumber')}
                                placeholder="Enter reference number"
                            />
                        </div>

                        <div className="form-group full-width">
                            <label>Description</label>
                            <textarea
                                rows={3}
                                value={payment.description}
                                onChange={handleChange('description')}
                                placeholder="Add notes for this payment"
                            />
                        </div>

                        <div className="form-group">
                            <label>Status</label>
                            <select
                                value={payment.status}
                                onChange={handleChange('status')}
                            >
                                <option value="pending">Pending</option>
                                <option value="paid">Paid</option>
                                <option value="failed">Failed</option>
                            </select>
                        </div>
                    </div>

                    <div className="form-actions">
                        <button
                            type="submit"
                            className="btn-save"
                            disabled={submitting}
                        >
                            <Save size={16} color="white" />
                            {submitting ? 'Saving...' : 'Create Payment'}
                        </button>
                        <button
                            type="button"
                            className="btn-cancel"
                            onClick={handleCancel}
                            disabled={submitting}
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
