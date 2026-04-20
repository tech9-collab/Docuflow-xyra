// src/pages/VatFiling/VatPeriodRuns.jsx
import React, { useEffect, useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Eye, ArrowLeft, Pencil, Trash2, Plus } from "lucide-react";
import {
  fetchVatRunsForPeriod,
  fetchCustomerById,
  deleteVatRun,
} from "../../helper/helper";
import "./VatFilingRuns.css";

export default function VatPeriodRuns() {
  const navigate = useNavigate();
  const { customerId, periodId } = useParams();

  const [customer, setCustomer] = useState(null);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "Xyra Books - VAT Filing Conversions";
  }, []);

  // Load customer + all runs for this period
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);

        const [customerRes, runsRes] = await Promise.all([
          fetchCustomerById(customerId),
          fetchVatRunsForPeriod(periodId),
        ]);

        if (cancelled) return;

        const cust = customerRes.customer || customerRes;
        setCustomer(cust || null);
        setRuns(Array.isArray(runsRes) ? runsRes : []);
        setError("");
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to load VAT runs:", err);
        setError(err.message || "Failed to load VAT filing conversions.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [customerId, periodId]);

  const handleBackToPeriods = () => {
    navigate(`/projects/vat-filing/periods/${customerId}`);
  };

  const openRunPreview = (run) => {
    navigate(
      `/vat-filing-preview/${customerId}?runId=${run.id}&periodId=${periodId}`
    );
  };

  const openRunEdit = (run) => {
    navigate(
      `/vat-filing-preview/${customerId}?runId=${run.id}&periodId=${periodId}&mode=edit`
    );
  };

  const handleDeleteRun = async (run) => {
    const confirmed = window.confirm(
      `Delete ${run.conversionLabel || "this conversion"
      }? This action cannot be undone.`
    );
    if (!confirmed) return;

    try {
      await deleteVatRun(run.id);
      // Remove from local UI
      setRuns((prev) => prev.filter((r) => r.id !== run.id));
    } catch (err) {
      console.error("Failed to delete run:", err);
      alert(err.message || "Failed to delete conversion");
    }
  };

  const formatDateTime = (d) => {
    if (!d) return "-";
    const dt = new Date(d);
    if (isNaN(dt.getTime())) {
      // If native parsing fails, try to strip time manually as fallback
      return String(d).split(/\s+/)[0];
    }

    const day = String(dt.getDate()).padStart(2, "0");
    const month = String(dt.getMonth() + 1).padStart(2, "0");
    const year = dt.getFullYear();

    return `${day}/${month}/${year}`;
  };

  const prettyStatus = (value) => {
    if (!value) return "-";
    switch (value) {
      case "draft":
        return "Draft";
      case "final":
        return "Final";
      case "submitted":
        return "Submitted";
      default:
        return value;
    }
  };

  // Label as Conversion 1, 2, 3… (runs already sorted DESC from backend)
  const labelledRuns = useMemo(() => {
    const sorted = [...runs].sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at)
    );

    return sorted.map((run, index) => ({
      ...run,
      conversionLabel: `Conversion ${index + 1}`,
    }));
  }, [runs]);

  if (loading) {
    return (
      <div className="vat-periods-page">
        <div className="vf-empty">Loading conversions...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="vat-periods-page">
        <div className="vf-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="vat-periods-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h2>VAT Filing – Conversions</h2>
          <p>All saved conversions for this filing period.</p>
          {customer && (
            <p className="vf-runs-customer">
              Customer: <strong>{customer.customer_name}</strong>{" "}
              {customer.vat_trn && (
                <span className="vf-runs-trn">TRN: {customer.vat_trn}</span>
              )}
            </p>
          )}
        </div>
        <div>
          <button
            type="button"
            className="prj-btn prj-btn-outline vf-back-btn"
            onClick={handleBackToPeriods}
          >
            <ArrowLeft size={16} style={{ marginRight: 4 }} />
            Back to periods
          </button>
        </div>
      </div>

      {/* Card with runs table */}
      <div className="vf-period-card vf-runs-card">
        {labelledRuns.length === 0 ? (
          <div className="vf-empty">
            No conversions saved yet for this period.
          </div>
        ) : (
          <div className="tbl-scroller">
            <table className="tbl nice vf-period-table vf-runs-table">
              <thead>
                <tr>
                  <th className="col-no">No</th>
                  <th>Conversion</th>
                  <th>Status</th>
                  <th>Company Name</th>
                  <th>Created</th>
                  <th>Last Updated</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {labelledRuns.map((run, idx) => (
                  <tr key={run.id}>
                    <td className="col-no">{idx + 1}</td>
                    <td>{run.conversionLabel}</td>
                    <td>
                      <span
                        className={`vf-status-pill vf-status-${run.status || "draft"
                          }`}
                      >
                        {prettyStatus(run.status)}
                      </span>
                    </td>
                    <td>{run.company_name || "-"}</td>
                    <td>{formatDateTime(run.created_at)}</td>
                    <td>{formatDateTime(run.updated_at)}</td>
                    <td>
                      <div className="vf-run-actions">
                        <button
                          type="button"
                          className="prj-icon-btn"
                          title="View this conversion"
                          aria-label="View conversion"
                          onClick={() => openRunPreview(run)}
                        >
                          <Eye size={16} />
                        </button>

                        <button
                          type="button"
                          className="prj-icon-btn"
                          title="Add Files to this conversion"
                          aria-label="Add Files"
                          onClick={() => {
                            navigate(
                              `/projects/vat-filing/bank-and-invoice/${customerId}?periodId=${periodId}&runId=${run.id}`
                            );
                          }}
                        >
                          <Plus size={16} />
                        </button>

                        <button
                          type="button"
                          className="prj-icon-btn"
                          title="Edit this conversion"
                          aria-label="Edit conversion"
                          onClick={() => openRunEdit(run)}
                        >
                          <Pencil size={16} />
                        </button>

                        <button
                          type="button"
                          className="prj-icon-btn prj-icon-danger"
                          title="Delete this conversion"
                          aria-label="Delete conversion"
                          onClick={() => handleDeleteRun(run)}
                        >
                          <Trash2 size={16} />
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
    </div>
  );
}
