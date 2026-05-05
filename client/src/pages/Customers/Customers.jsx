// src/pages/Customers/Customers.jsx
import React, { useMemo, useState, useEffect } from "react";
import { Plus, Eye, Pencil, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { fetchCustomers, deleteCustomer } from "../../helper/helper";
import "./Customers.css";

const PAGE_SIZE = 10;

export default function Customers() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchCustomers();
        setCustomers(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Failed to load customers:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const totalItems = customers.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

  const pageData = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    return customers.slice(start, end);
  }, [customers, currentPage]);

  const handlePrev = () => {
    setCurrentPage((p) => (p > 1 ? p - 1 : p));
  };

  const handleNext = () => {
    setCurrentPage((p) => (p < totalPages ? p + 1 : p));
  };

  const handleAddCustomer = () => {
    navigate("/customers/create");
  };

  const handleAction = async (action, customer) => {
    if (action === "show") {
      navigate(`/customers/${customer.id}`);
    }
    if (action === "edit") {
      navigate(`/customers/${customer.id}/edit`);
    }
    if (action === "delete") {
      const ok = window.confirm(
        `Are you sure you want to delete ${customer.customer_name}?`
      );
      if (!ok) return;

      try {
        await deleteCustomer(customer.id);
        setCustomers((prev) => prev.filter((c) => c.id !== customer.id));
      } catch (err) {
        console.error("Failed to delete customer:", err);
        alert(err.message || "Failed to delete customer");
      }
    }
  };

  const from = totalItems === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const to =
    totalItems === 0 ? 0 : Math.min(currentPage * PAGE_SIZE, totalItems);

  const formatDate = (value) => {
    if (!value) return "-";
    try {
      return new Date(value).toLocaleDateString();
    } catch {
      return value;
    }
  };

  return (
    <div className="customers-page">
      {/* Header */}
      <div className="customers-head">
        <div className="customers-title-wrap">
          <h1 className="customers-title">Customers</h1>
          <p className="customers-sub">Manage your customers.</p>
        </div>
        <div className="customers-head-actions">
          <button
            type="button"
            className="customers-add-btn"
            onClick={handleAddCustomer}
          >
            <Plus size={14} />
            Add Customer
          </button>
        </div>
      </div>

      {/* Card + table */}
      <div className="customers-card">
        <div className="customers-card-head">
          <div>
            <h2 className="customers-card-title">Customer List</h2>
            <p className="customers-card-sub">
              {totalItems === 0
                ? "No customers yet."
                : `Showing ${from}-${to} of ${totalItems} customers`}
            </p>
          </div>
          <span className="customers-count">
            {totalItems} total customer{totalItems === 1 ? "" : "s"}
          </span>
        </div>

        <div className="tbl-scroller">
          <table className="tbl nice customers-table">
            <thead>
              <tr>
                <th className="col-no">No</th>
                <th>Customer Name</th>
                <th>Address</th>
                <th>Email ID</th>
                <th>Mobile No</th>
                <th>Country</th>
                <th>Date</th>
                <th className="customers-action-col">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="customers-no-data">
                    Loading customers...
                  </td>
                </tr>
              ) : pageData.length === 0 ? (
                <tr>
                  <td colSpan={8} className="customers-no-data">
                    No customers found.
                  </td>
                </tr>
              ) : (
                pageData.map((customer, index) => {
                  const serial = (currentPage - 1) * PAGE_SIZE + index + 1;

                  return (
                    <tr key={customer.id}>
                      <td className="col-no">{serial}</td>
                      {/* map DB fields -> UI */}
                      <td>{customer.customer_name}</td>
                      <td>{customer.address}</td>
                      <td>{customer.email}</td>
                      <td>{customer.mobile}</td>
                      <td>{customer.country}</td>
                      <td>{formatDate(customer.created_at)}</td>
                      <td className="customers-action-cell">
                        <div className="customers-action-buttons">
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => handleAction("show", customer)}
                            aria-label="Show customer"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => handleAction("edit", customer)}
                            aria-label="Edit customer"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn danger"
                            onClick={() => handleAction("delete", customer)}
                            aria-label="Delete customer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalItems > 0 && (
          <div className="customers-pagination">
            <div className="customers-pagination-info">
              Rows {from}-{to} of {totalItems}
            </div>
            <div className="customers-pagination-controls">
              <button
                type="button"
                className="pager-btn"
                onClick={handlePrev}
                disabled={currentPage === 1}
              >
                Prev
              </button>
              <span className="pager-page">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                className="pager-btn"
                onClick={handleNext}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
