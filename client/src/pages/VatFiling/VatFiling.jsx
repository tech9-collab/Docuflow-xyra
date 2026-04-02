// src/pages/VatFiling/VatFiling.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, FileText } from "lucide-react";
import { fetchCustomers } from "../../helper/helper";
import "./VatFiling.css";

const PAGE_SIZE = 10;

export default function VatFiling() {
  const navigate = useNavigate();

  const [customers, setCustomers] = useState([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [customerError, setCustomerError] = useState("");

  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    document.title = "DocuFlow - VAT Filing";
  }, []);

  // Load customers
  useEffect(() => {
    (async () => {
      try {
        setLoadingCustomers(true);
        const data = await fetchCustomers();
        setCustomers(Array.isArray(data) ? data : []);
        setCustomerError("");
      } catch (err) {
        console.error("Failed to load customers:", err);
        setCustomerError(err.message || "Failed to load customers");
      } finally {
        setLoadingCustomers(false);
      }
    })();
  }, []);

  // Filtered customers by search
  const filteredCustomers = useMemo(() => {
    if (!search.trim()) return customers;
    const s = search.toLowerCase();
    return customers.filter((c) => {
      return (
        (c.customer_name || "").toLowerCase().includes(s) ||
        (c.email || "").toLowerCase().includes(s) ||
        (c.mobile || "").toLowerCase().includes(s) ||
        (c.country || "").toLowerCase().includes(s)
      );
    });
  }, [customers, search]);

  const totalItems = filteredCustomers.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

  const pageData = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    return filteredCustomers.slice(start, end);
  }, [filteredCustomers, currentPage]);

  const from = totalItems === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const to =
    totalItems === 0 ? 0 : Math.min(currentPage * PAGE_SIZE, totalItems);

  const handlePrev = () => setCurrentPage((p) => (p > 1 ? p - 1 : p));
  const handleNext = () => setCurrentPage((p) => (p < totalPages ? p + 1 : p));

  const formatDate = (d) => {
    if (!d) return "-";
    try {
      return new Date(d).toLocaleDateString();
    } catch {
      return d;
    }
  };

  const handleGoToPeriods = (customer) => {
    if (!customer?.id) return;
    navigate(`/projects/vat-filing/periods/${customer.id}`);
  };

  return (
    <div className="vat-filing-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h2>VAT Filing</h2>
          <p>Select a customer to manage VAT filing periods.</p>
        </div>
      </div>

      {/* Customers table only */}
      <div className="vf-customers-only">
        <div className="vf-search-wrap">
          <div className="vf-search-input">
            <Search size={16} />
            <input
              type="text"
              placeholder="Search customer by name, email, mobile, country..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>
          <p className="vf-small-muted">
            Total customers: {customers.length} | Showing {from}-{to} of{" "}
            {totalItems}
          </p>
        </div>

        {customerError && (
          <div className="prj-error" style={{ marginTop: 8 }}>
            {customerError}
          </div>
        )}

        <div className="tbl-scroller">
          <table className="tbl nice customers-table">
            <thead>
              <tr>
                <th className="col-no">No</th>
                <th>Customer Name</th>
                <th>Email</th>
                <th>Mobile</th>
                <th>Country</th>
                <th>Created</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loadingCustomers ? (
                <tr>
                  <td colSpan={7} className="customers-no-data">
                    Loading customers...
                  </td>
                </tr>
              ) : pageData.length === 0 ? (
                <tr>
                  <td colSpan={7} className="customers-no-data">
                    No customers found.
                  </td>
                </tr>
              ) : (
                pageData.map((customer, index) => {
                  const serial = (currentPage - 1) * PAGE_SIZE + index + 1;
                  return (
                    <tr key={customer.id}>
                      <td className="col-no">{serial}</td>
                      <td>{customer.customer_name}</td>
                      <td>{customer.email}</td>
                      <td>{customer.mobile}</td>
                      <td>{customer.country}</td>
                      <td>{formatDate(customer.created_at)}</td>
                      <td>
                        <button
                          type="button"
                          className="prj-icon-btn"
                          onClick={() => handleGoToPeriods(customer)}
                          title="Manage VAT Filing"
                          aria-label="Manage VAT Filing"
                        >
                          <FileText size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

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
