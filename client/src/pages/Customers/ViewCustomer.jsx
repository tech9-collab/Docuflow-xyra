// src/pages/Customers/ViewCustomer.jsx
import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Pencil } from "lucide-react";
import { fetchCustomerById } from "../../helper/helper";
import "./ViewCustomer.css";

/* Small helper to show only date */
function formatDate(value) {
  if (!value) return "-";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value; // if it's plain text, show as is
    return d.toLocaleDateString();
  } catch {
    return value;
  }
}

/** ---------- LABEL MAPPERS FOR SELECT FIELDS ---------- **/

const ENTITY_TYPE_LABELS = {
  legal_llc: "Legal Person - Incorporated (LLC)",
  legal_foreign: "Legal Person - Foreign Business",
  legal_club: "Legal Person - Club/Association/Society",
  legal_charity: "Legal Person - Charity",
  legal_federal: "Legal Person - Federal Government Entity",
  legal_emirate: "Legal Person - Emirate Government Entity",
  legal_other: "Legal Person - Other",
  partnership: "Partnership",
};

const ENTITY_SUBTYPE_LABELS = {
  uae_private: "UAE Private Company (Incl. an Establishment)",
  pjsc: "Public Joint Stock Company",
  foundation: "Foundation",
  trust: "Trust",
};

const VAT_TREATMENT_LABELS = {
  vat_registered: "VAT Registered",
  non_vat_registered: "Non VAT Registered",
  vat_registered_dz: "VAT Registered - Designated zone",
  non_vat_registered_dz: "Non VAT Registered - Designated zone",
  gcc_vat_registered: "GCC VAT Registered",
  gcc_non_vat_registered: "GCC Non VAT Registered",
};

const VAT_REPORTING_PERIOD_LABELS = {
  monthly: "Monthly",
  quarterly: "Quarterly",
};

const CT_TREATMENT_LABELS = {
  corporate_tax_registered: "Corporate Tax Registered",
  not_registered: "Not Registered",
};

// generic helper to get label or fallback
function mapLabel(map, value) {
  if (!value) return "-";
  return map[value] || value; // fallback: show code if somehow unknown
}

export default function ViewCustomer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchCustomerById(id);
        setData(res);
      } catch (err) {
        console.error(err);
        alert("Failed to load customer");
      }
    })();
  }, [id]);

  if (!data) {
    return <div className="loader">Loading...</div>;
  }

  const { customer, shareholders } = data;

  return (
    <div className="customer-view-page">
      {/* Header — back link + breadcrumb + title */}
      <button
        type="button"
        className="cv-back-link"
        onClick={() => navigate("/customers")}
      >
        <ArrowLeft size={16} />
        Back
      </button>

      <div className="cv-breadcrumb">
        <span
          className="cv-breadcrumb-link"
          onClick={() => navigate("/customers")}
        >
          Customers
        </span>
        <span className="cv-breadcrumb-sep">›</span>
        <span className="cv-breadcrumb-current">Details</span>
      </div>

      <div className="cv-title-row">
        <div>
          <h1 className="cv-page-title">Customer Details</h1>
          <p className="cv-page-sub">
            View basic, business and tax information.
          </p>
        </div>
        <button
          className="cv-edit-btn"
          onClick={() => navigate(`/customers/${id}/edit`)}
        >
          <Pencil size={14} /> Edit
        </button>
      </div>

      {/* BASIC DETAILS */}
      <section className="card-section">
        <div className="card-section-head">
          <h2>Basic details</h2>
          <p>General customer information.</p>
        </div>

        <div className="details-grid">
          {/* Row 1: Name | Email */}
          <div>
            <label>Customer name</label>
            <p className="value-text">{customer.customer_name || "-"}</p>
          </div>
          <div>
            <label>Email</label>
            <p className="value-text">{customer.email || "-"}</p>
          </div>

          {/* Row 2: Address | Country */}
          <div>
            <label>Address</label>
            <p className="value-text">{customer.address || "-"}</p>
          </div>
          <div>
            <label>Country</label>
            <p className="value-text">{customer.country || "-"}</p>
          </div>

          {/* Row 3: Mobile (full width) */}
          <div className="full">
            <label>Mobile</label>
            <p className="value-text">{customer.mobile || "-"}</p>
          </div>
        </div>
      </section>

      {/* BUSINESS DETAILS */}
      <section className="card-section">
        <div className="card-section-head">
          <h2>Business details</h2>
          <p>Legal and trade license information.</p>
        </div>

        <div className="details-grid">
          <div>
            <label>Entity type</label>
            <p className="value-text">
              {mapLabel(ENTITY_TYPE_LABELS, customer.entity_type)}
            </p>
          </div>
          <div>
            <label>Entity sub type</label>
            <p className="value-text">
              {mapLabel(ENTITY_SUBTYPE_LABELS, customer.entity_sub_type)}
            </p>
          </div>
          <div>
            <label>Date of incorporation</label>
            <p className="value-text">
              {formatDate(customer.date_of_incorporation)}
            </p>
          </div>
          <div>
            <label>Trade license authority</label>
            <p className="value-text">
              {customer.trade_license_authority || "-"}
            </p>
          </div>
          <div>
            <label>Trade license number</label>
            <p className="value-text">
              {customer.trade_license_number || "-"}
            </p>
          </div>
          <div>
            <label>License issue date</label>
            <p className="value-text">
              {formatDate(customer.license_issue_date)}
            </p>
          </div>
          <div>
            <label>License expiry date</label>
            <p className="value-text">
              {formatDate(customer.license_expiry_date)}
            </p>
          </div>

          <div className="full">
            <label>Business activity</label>
            <p className="value-text">{customer.business_activity || "-"}</p>
          </div>

          <div className="full">
            <label>Freezone</label>
            <p className="value-text">
              {customer.is_freezone ? customer.freezone_name || "Yes" : "No"}
            </p>
          </div>
        </div>

        {/* Shareholding */}
        <div className="subsection">
          <h3>Shareholding</h3>
          <table className="share-table">
            <thead>
              <tr>
                <th>Owner type</th>
                <th>Name</th>
                <th>Nationality</th>
                <th>Share %</th>
              </tr>
            </thead>
            <tbody>
              {shareholders.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ fontSize: "12px", color: "#6b7280" }}>
                    No shareholder records.
                  </td>
                </tr>
              ) : (
                shareholders.map((s) => (
                  <tr key={s.id}>
                    <td>{s.owner_type}</td>
                    <td>{s.name}</td>
                    <td>{s.nationality}</td>
                    <td>{s.share_percentage}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* TAX SECTION */}
      <section className="card-section">
        <div className="card-section-head">
          <h2>Tax information</h2>
          <p>VAT and corporate tax registration details.</p>
        </div>

        <div className="tax-sections">
          {/* VAT Information */}
          <div className="tax-section-block">
            <h3 className="tax-subtitle">VAT information</h3>
            <div className="details-grid">
              <div>
                <label>Tax treatment</label>
                <p className="value-text">
                  {mapLabel(
                    VAT_TREATMENT_LABELS,
                    customer.vat_tax_treatment
                  )}
                </p>
              </div>
              <div>
                <label>Tax registration number</label>
                <p className="value-text">{customer.vat_trn || "-"}</p>
              </div>
              <div>
                <label>VAT registered date</label>
                <p className="value-text">
                  {formatDate(customer.vat_registered_date)}
                </p>
              </div>
              <div>
                <label>First VAT return period</label>
                <p className="value-text">
                  {customer.first_vat_filing_period || "-"}
                </p>
              </div>
              <div>
                <label>VAT return due date</label>
                <p className="value-text">
                  {formatDate(customer.vat_return_due_date)}
                </p>
              </div>
              <div>
                <label>Reporting period</label>
                <p className="value-text">
                  {mapLabel(
                    VAT_REPORTING_PERIOD_LABELS,
                    customer.vat_reporting_period
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* Corporate Tax Information */}
          <div className="tax-section-block">
            <h3 className="tax-subtitle">Corporate tax information</h3>
            <div className="details-grid">
              <div>
                <label>Tax treatment</label>
                <p className="value-text">
                  {mapLabel(CT_TREATMENT_LABELS, customer.ct_tax_treatment)}
                </p>
              </div>
              <div>
                <label>Corporate tax TRN</label>
                <p className="value-text">{customer.ct_trn || "-"}</p>
              </div>
              <div>
                <label>CT registered date</label>
                <p className="value-text">
                  {formatDate(customer.ct_registered_date)}
                </p>
              </div>
              <div>
                <label>Corporate tax period</label>
                <p className="value-text">
                  {customer.corporate_tax_period || "-"}
                </p>
              </div>
              <div>
                <label>First CT period start date</label>
                <p className="value-text">
                  {formatDate(customer.first_ct_period_start_date)}
                </p>
              </div>
              <div>
                <label>First CT period end date</label>
                <p className="value-text">
                  {formatDate(customer.first_ct_period_end_date)}
                </p>
              </div>
              <div>
                <label>First CT return filing due date</label>
                <p className="value-text">
                  {formatDate(customer.first_ct_return_due_date)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
