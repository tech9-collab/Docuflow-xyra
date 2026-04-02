// src/pages/CtFiling/CtFilingPeriods.jsx
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CalendarPlus, Upload, Edit2, Trash2 } from "lucide-react";
import {
  fetchCustomers,
  fetchCtPeriods,
  createCtPeriod,
  updateCtPeriod,
  deleteCtPeriod,
} from "../../helper/helper";
import "./CtFiling.css";

export default function CtFilingPeriods() {
  const navigate = useNavigate();
  const { customerId } = useParams();

  const [customer, setCustomer] = useState(null);
  const [loadingCustomer, setLoadingCustomer] = useState(true);
  const [customerError, setCustomerError] = useState("");

  const [periods, setPeriods] = useState([]);
  const [loadingPeriods, setLoadingPeriods] = useState(false);
  const [periodError, setPeriodError] = useState("");

  // Add Period modal state
  const [isPeriodModalOpen, setIsPeriodModalOpen] = useState(false);
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [submitDate, setSubmitDate] = useState("");
  const [status, setStatus] = useState("not_started");

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState(null);

  useEffect(() => {
    document.title = "DocuFlow - CT Filing Periods";
  }, []);

  // Load selected customer (same as VAT)
  useEffect(() => {
    (async () => {
      try {
        setLoadingCustomer(true);
        const data = await fetchCustomers();
        const list = Array.isArray(data) ? data : [];
        const found = list.find((c) => String(c.id) === String(customerId));
        if (!found) {
          setCustomerError("Customer not found.");
          setCustomer(null);
        } else {
          setCustomer(found);
          setCustomerError("");
        }
      } catch (err) {
        console.error("Failed to load customer (CT):", err);
        setCustomerError(err.message || "Failed to load customer");
      } finally {
        setLoadingCustomer(false);
      }
    })();
  }, [customerId]);

  // Load CT periods for customer (mirror VAT logic)
  useEffect(() => {
    if (!customer?.id) return;

    (async () => {
      try {
        setLoadingPeriods(true);
        const data = await fetchCtPeriods(customer.id);
        setPeriods(Array.isArray(data) ? data : []);
        setPeriodError("");
      } catch (err) {
        console.error("Failed to load CT periods:", err);
        setPeriodError(err.message || "Failed to load filing periods");
      } finally {
        setLoadingPeriods(false);
      }
    })();
  }, [customer]);

  const formatDate = (d) => {
    if (!d) return "-";
    try {
      return new Date(d).toLocaleDateString();
    } catch {
      return d;
    }
  };

  const prettyStatus = (value) => {
    if (!value) return "-";
    switch (value) {
      case "not_started":
        return "Not Started";
      case "in_progress":
        return "In Progress";
      case "submitted":
        return "Submitted";
      case "overdue":
        return "Overdue";
      default:
        return value;
    }
  };

  const openAddPeriodModal = () => {
    setPeriodFrom("");
    setPeriodTo("");
    setDueDate("");
    setSubmitDate("");
    setStatus("not_started");
    setIsPeriodModalOpen(true);
  };

  const closeAddPeriodModal = () => {
    setIsPeriodModalOpen(false);
  };

  const handleSavePeriod = async () => {
    if (!customer) {
      alert("Customer not loaded.");
      return;
    }
    if (!periodFrom || !periodTo) {
      alert("Period From and Period To are required.");
      return;
    }

    try {
      const payload = {
        periodFrom,
        periodTo,
        dueDate: dueDate || null,
        submitDate: submitDate || null,
        status,
      };
      const newPeriod = await createCtPeriod(customer.id, payload);
      setPeriods((prev) => [newPeriod, ...prev]);
      closeAddPeriodModal();
    } catch (err) {
      console.error("Failed to create CT period:", err);
      alert(err.message || "Failed to create CT filing period");
    }
  };

  const openEditPeriodModal = (period) => {
    setEditingPeriod(period);
    setPeriodFrom(period.period_from?.slice(0, 10) || "");
    setPeriodTo(period.period_to?.slice(0, 10) || "");
    setDueDate(period.due_date?.slice(0, 10) || "");
    setSubmitDate(period.submit_date?.slice(0, 10) || "");
    setStatus(period.status || "not_started");
    setIsEditModalOpen(true);
  };

  const closeEditModal = () => {
    setIsEditModalOpen(false);
    setEditingPeriod(null);
  };

  const handleUpdatePeriod = async () => {
    if (!editingPeriod) return;
    if (!periodFrom || !periodTo) {
      alert("Period From and Period To are required.");
      return;
    }

    try {
      const payload = {
        periodFrom,
        periodTo,
        dueDate: dueDate || null,
        submitDate: submitDate || null,
        status,
      };

      const updated = await updateCtPeriod(editingPeriod.id, payload);

      setPeriods((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p))
      );

      closeEditModal();
    } catch (err) {
      console.error("Failed to update CT period:", err);
      alert(err.message || "Failed to update CT filing period");
    }
  };

  const handleDeletePeriod = async (period) => {
    if (
      !window.confirm("Are you sure you want to delete this CT filing period?")
    ) {
      return;
    }
    try {
      await deleteCtPeriod(period.id);
      setPeriods((prev) => prev.filter((p) => p.id !== period.id));
    } catch (err) {
      console.error("Failed to delete CT period:", err);
      alert(err.message || "Failed to delete CT filing period");
    }
  };

  // 👉 CT: where do we go after selecting a period?
  // Use your CT workflow (you previously used /projects/ct-filing/types/:id)
  const openCtFilingForPeriod = (period) => {
    if (!customer) return;
    navigate(`/projects/ct-filing/types/${customer.id}?periodId=${period.id}`);
  };

  const handleBack = () => {
    navigate("/projects/ct-filing");
  };

  return (
    <div className="vat-periods-page">
      <div className="page-header">
        <div>
          <h2>CT Filing – Periods</h2>
          <p>
            Manage CT filing periods for the selected customer and open CT
            filing.
          </p>
        </div>
        <div>
          <button
            type="button"
            className="prj-btn prj-btn-outline vf-back-btn"
            onClick={handleBack}
          >
            ← Back to customers
          </button>
        </div>
      </div>

      {loadingCustomer ? (
        <div className="vf-empty">Loading customer details...</div>
      ) : customerError ? (
        <div className="prj-error">{customerError}</div>
      ) : !customer ? (
        <div className="vf-empty">
          Customer not found. Go back to customers list.
        </div>
      ) : (
        <>
          {/* Filing periods card – same look as VAT */}
          <div className="vf-period-card">
            <div className="vf-period-head">
              <div>
                <h3>{customer.customer_name}</h3>
                <p className="vf-cust-trn-inline">
                  CT TRN: {customer.ct_trn || "Not set"}
                </p>
              </div>

              <button
                type="button"
                className="btn btn-black vf-btn"
                onClick={openAddPeriodModal}
              >
                <CalendarPlus size={16} />
                Add CT Filing Period
              </button>
            </div>

            {periodError && <div className="prj-error">{periodError}</div>}

            {loadingPeriods ? (
              <div className="vf-empty">Loading filing periods...</div>
            ) : periods.length === 0 ? (
              <div className="vf-empty">
                No CT filing periods yet. Click{" "}
                <strong>Add CT Filing Period</strong> to create one.
              </div>
            ) : (
              <div className="tbl-scroller">
                <table className="tbl nice vf-period-table">
                  <thead>
                    <tr>
                      <th>Period From</th>
                      <th>Period To</th>
                      <th>Due Date</th>
                      <th>Submit Date</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periods.map((p) => (
                      <tr key={p.id}>
                        <td>{formatDate(p.period_from)}</td>
                        <td>{formatDate(p.period_to)}</td>
                        <td>{formatDate(p.due_date)}</td>
                        <td>{formatDate(p.submit_date)}</td>
                        <td>{prettyStatus(p.status)}</td>
                        <td>
                          <div className="vf-actions-cell">
                            {/* Edit period */}
                            <button
                              type="button"
                              className="prj-icon-btn"
                              onClick={() => openEditPeriodModal(p)}
                              title="Edit Period"
                              aria-label="Edit Period"
                            >
                              <Edit2 size={15} />
                            </button>

                            {/* Upload / Open CT filing */}
                            <button
                              type="button"
                              className="prj-icon-btn"
                              onClick={() => openCtFilingForPeriod(p)}
                              title="Upload / Open Filing"
                              aria-label="Upload / Open Filing"
                            >
                              <Upload size={15} />
                            </button>

                            {/* Delete period */}
                            <button
                              type="button"
                              className="prj-icon-btn prj-icon-btn-danger"
                              onClick={() => handleDeletePeriod(p)}
                              title="Delete Period"
                              aria-label="Delete Period"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Add CT Period Modal (same UI as VAT) */}
      {isPeriodModalOpen && (
        <div className="prj-modal">
          <div className="prj-modal-card">
            <div className="prj-modal-hd">
              <h3>Add CT Filing Period</h3>
              <button className="prj-icon-btn" onClick={closeAddPeriodModal}>
                ✕
              </button>
            </div>
            <div className="prj-modal-body">
              <div className="vf-field-row">
                <label className="prj-field-label">Period From</label>
                <input
                  type="date"
                  className="prj-rename"
                  value={periodFrom}
                  onChange={(e) => setPeriodFrom(e.target.value)}
                />
              </div>
              <div className="vf-field-row">
                <label className="prj-field-label">Period To</label>
                <input
                  type="date"
                  className="prj-rename"
                  value={periodTo}
                  onChange={(e) => setPeriodTo(e.target.value)}
                />
              </div>
              <div className="vf-field-row">
                <label className="prj-field-label">Due Date</label>
                <input
                  type="date"
                  className="prj-rename"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div className="vf-field-row">
                <label className="prj-field-label">Submit Date</label>
                <input
                  type="date"
                  className="prj-rename"
                  value={submitDate}
                  onChange={(e) => setSubmitDate(e.target.value)}
                />
              </div>
              <div className="vf-field-row">
                <label className="prj-field-label">Status</label>
                <select
                  className="prj-rename"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="not_started">Not Started</option>
                  <option value="in_progress">In Progress</option>
                  <option value="submitted">Submitted</option>
                  <option value="overdue">Overdue</option>
                </select>
              </div>
            </div>
            <div className="prj-modal-ft">
              <button
                className="prj-btn prj-btn-outline"
                onClick={closeAddPeriodModal}
              >
                Cancel
              </button>
              <button
                className="prj-btn prj-btn-solid"
                onClick={handleSavePeriod}
                disabled={!periodFrom || !periodTo}
              >
                Save Period
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit CT Period Modal */}
      {isEditModalOpen && (
        <div className="prj-modal">
          <div className="prj-modal-card">
            <div className="prj-modal-hd">
              <h3>Edit CT Filing Period</h3>
              <button className="prj-icon-btn" onClick={closeEditModal}>
                ✕
              </button>
            </div>
            <div className="prj-modal-body">
              <div className="vf-field-row">
                <label className="prj-field-label">Period From</label>
                <input
                  type="date"
                  className="prj-rename"
                  value={periodFrom}
                  onChange={(e) => setPeriodFrom(e.target.value)}
                />
              </div>
              <div className="vf-field-row">
                <label className="prj-field-label">Period To</label>
                <input
                  type="date"
                  className="prj-rename"
                  value={periodTo}
                  onChange={(e) => setPeriodTo(e.target.value)}
                />
              </div>
              <div className="vf-field-row">
                <label className="prj-field-label">Due Date</label>
                <input
                  type="date"
                  className="prj-rename"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div className="vf-field-row">
                <label className="prj-field-label">Submit Date</label>
                <input
                  type="date"
                  className="prj-rename"
                  value={submitDate}
                  onChange={(e) => setSubmitDate(e.target.value)}
                />
              </div>
              <div className="vf-field-row">
                <label className="prj-field-label">Status</label>
                <select
                  className="prj-rename"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="not_started">Not Started</option>
                  <option value="in_progress">In Progress</option>
                  <option value="submitted">Submitted</option>
                  <option value="overdue">Overdue</option>
                </select>
              </div>
            </div>
            <div className="prj-modal-ft">
              <button
                className="prj-btn prj-btn-outline"
                onClick={closeEditModal}
              >
                Cancel
              </button>
              <button
                className="prj-btn prj-btn-solid"
                onClick={handleUpdatePeriod}
                disabled={!periodFrom || !periodTo}
              >
                Update Period
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
