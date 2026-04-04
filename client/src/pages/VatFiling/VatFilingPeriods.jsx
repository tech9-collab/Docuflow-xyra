import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CalendarPlus, Upload, Edit2, Trash2, Eye } from "lucide-react";
import {
  fetchCustomers,
  fetchVatPeriods,
  createVatPeriod,
  updateVatPeriod,
  deleteVatPeriod,
} from "../../helper/helper";
import "./VatFilingPeriods.css";

export default function VatFilingPeriods() {
  const navigate = useNavigate();
  const { customerId } = useParams();

  const [customer, setCustomer] = useState(null);
  const [loadingCustomer, setLoadingCustomer] = useState(true);
  const [customerError, setCustomerError] = useState("");

  const [periods, setPeriods] = useState([]);
  const [loadingPeriods, setLoadingPeriods] = useState(false);
  const [periodError, setPeriodError] = useState("");

  // Add / Edit Period modal state
  const [isPeriodModalOpen, setIsPeriodModalOpen] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState(null); // ✅ null = add, object = edit

  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [submitDate, setSubmitDate] = useState("");
  const [status, setStatus] = useState("not_started");

  useEffect(() => {
    document.title = "Xyra Books - VAT Filing Periods";
  }, []);

  // helper for date input format (YYYY-MM-DD)
  // We use local date components to avoid timezone shifts (June 1 becoming May 31)
  const toDateInput = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      if (typeof value === "string") return value.slice(0, 10);
      return "";
    }
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  // Load selected customer
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
          // console.log("Loaded customer in VAT periods:", found);
          setCustomer(found);
          setCustomerError("");
        }
      } catch (err) {
        console.error("Failed to load customer:", err);
        setCustomerError(err.message || "Failed to load customer");
      } finally {
        setLoadingCustomer(false);
      }
    })();
  }, [customerId]);

  // Load periods for customer
  useEffect(() => {
    if (!customer?.id) return;

    (async () => {
      try {
        setLoadingPeriods(true);
        const data = await fetchVatPeriods(customer.id);
        setPeriods(Array.isArray(data) ? data : []);
        setPeriodError("");
      } catch (err) {
        console.error("Failed to load periods:", err);
        setPeriodError(err.message || "Failed to load filing periods");
      } finally {
        setLoadingPeriods(false);
      }
    })();
  }, [customer]);

  const formatDate = (d) => {
    if (!d) return "-";
    const date = new Date(d);
    if (isNaN(date.getTime())) return d;

    // Use local components for consistent DD/MM/YYYY display
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
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

  // ✅ Open modal in ADD mode
  const openAddPeriodModal = () => {
    setEditingPeriod(null); // make sure we're in add mode
    setPeriodFrom("");
    setPeriodTo("");
    setDueDate("");
    setSubmitDate("");
    setStatus("not_started");
    setIsPeriodModalOpen(true);
  };

  // ✅ Open modal in EDIT mode with values from row
  const openEditPeriodModal = (p) => {
    setEditingPeriod(p); // store full object
    setPeriodFrom(toDateInput(p.period_from));
    setPeriodTo(toDateInput(p.period_to));
    setDueDate(toDateInput(p.due_date));
    setSubmitDate(toDateInput(p.submit_date));
    setStatus(p.status || "not_started");
    setIsPeriodModalOpen(true);
  };

  const closeAddPeriodModal = () => {
    setIsPeriodModalOpen(false);
    setEditingPeriod(null); // reset mode
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

      if (editingPeriod) {
        // ✅ EDIT MODE → update existing row
        const updated = await updateVatPeriod(editingPeriod.id, payload);
        setPeriods((prev) =>
          prev.map((row) => (row.id === updated.id ? updated : row))
        );
      } else {
        // ✅ ADD MODE → create new row
        const newPeriod = await createVatPeriod(customer.id, payload);
        setPeriods((prev) => [newPeriod, ...prev]);
      }

      closeAddPeriodModal();
    } catch (err) {
      console.error("Failed to save period:", err);
      alert(err.message || "Failed to save filing period");
    }
  };

  const openVatFilingForPeriod = (period) => {
    if (!customer) return;
    navigate(
      `/projects/vat-filing/bank-and-invoice/${customer.id}?periodId=${period.id}`
    );
  };

  const openVatPreviewForPeriod = (period) => {
    if (!customer) return;
    // New page that lists all conversions for this period
    navigate(`/projects/vat-filing/periods/${customer.id}/runs/${period.id}`);
  };

  const handleDeletePeriod = async (period) => {
    if (
      !window.confirm("Are you sure you want to delete this filing period?")
    ) {
      return;
    }

    try {
      await deleteVatPeriod(period.id);
      setPeriods((prev) => prev.filter((p) => p.id !== period.id));
    } catch (err) {
      console.error("Failed to delete period:", err);
      alert(err.message || "Failed to delete filing period");
    }
  };

  const handleBack = () => {
    navigate("/projects/vat-filing");
  };

  return (
    <div className="vat-periods-page">
      <div className="page-header">
        <div>
          <h2>VAT Filing – Periods</h2>
          <p>
            Manage filing periods for the selected customer and open Bank &amp;
            Invoice.
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
          {/* Filing periods card */}
          <div className="vf-period-card">
            <div className="vf-period-head">
              <div>
                {customer && (
                  <>
                    <h3>{customer.customer_name}</h3>
                    <p className="vf-cust-trn-inline">
                      Trn: {customer.vat_trn || "Not set"}
                    </p>
                  </>
                )}
              </div>

              <button
                type="button"
                className="btn btn-black vf-btn"
                onClick={openAddPeriodModal}
              >
                <CalendarPlus size={16} />
                Add Filing Period
              </button>
            </div>

            {periodError && <div className="prj-error">{periodError}</div>}

            {loadingPeriods ? (
              <div className="vf-empty">Loading filing periods...</div>
            ) : periods.length === 0 ? (
              <div className="vf-empty">
                No filing periods yet. Click <strong>Add Filing Period</strong>{" "}
                to create one.
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
                            {/* ✅ EDIT ICON */}
                            <button
                              type="button"
                              className="prj-icon-btn"
                              onClick={() => openEditPeriodModal(p)}
                              title="Edit Period"
                              aria-label="Edit Period"
                            >
                              <Edit2 size={15} />
                            </button>

                            {/* ✅ UPLOAD / OPEN FILING ICON */}
                            <button
                              type="button"
                              className="prj-icon-btn"
                              onClick={() => openVatFilingForPeriod(p)}
                              title="Upload / Open Filing"
                              aria-label="Upload / Open Filing"
                            >
                              <Upload size={15} />
                            </button>
                            <button
                              type="button"
                              className="prj-icon-btn"
                              onClick={() => openVatPreviewForPeriod(p)}
                              title="View Saved Filings"
                              aria-label="View Saved Filings"
                            >
                              <Eye size={15} />
                            </button>
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

      {/* Add / Edit Period Modal */}
      {isPeriodModalOpen && (
        <div className="prj-modal">
          <div className="prj-modal-card">
            <div className="prj-modal-hd">
              <h3>
                {editingPeriod ? "Edit Filing Period" : "Add Filing Period"}
              </h3>
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
    </div>
  );
}
