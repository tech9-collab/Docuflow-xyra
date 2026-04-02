// src/pages/Customers/EditCustomer.jsx
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Save, Plus, Trash2, UploadCloud } from "lucide-react";
import "./EditCustomer.css";
import { fetchCustomerById, updateCustomer } from "../../helper/helper";

/* --- Utility: Convert backend DATE → <input type="date"> format --- */
function toDateInput(value) {
  if (!value) return "";
  try {
    return new Date(value).toISOString().substring(0, 10);
  } catch {
    return "";
  }
}

export default function EditCustomer() {
  const navigate = useNavigate();
  const { id } = useParams();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  /* Main form state (same shape as AddCustomer) */
  const [form, setForm] = useState({
    // Basic details
    customerName: "",
    address: "",
    email: "",
    mobile: "",
    country: "",

    // Business details
    entityType: "",
    entitySubType: "",
    dateOfIncorporation: "",
    tradeLicenseAuthority: "",
    tradeLicenseNumber: "",
    licenseIssueDate: "",
    licenseExpiryDate: "",
    businessActivity: "",
    isFreezone: false,
    freezoneName: "",
    authorisedSignatories: "",
    shareCapital: "",
    ftaCredentials: "",
    ftaPassword: "",

    // Tax & Financials
    functionalCurrency: "",

    // VAT info
    vatTaxTreatment: "",
    vatInfoCertificate: null,
    vatTrn: "",
    vatRegisteredDate: "",
    firstVatFilingPeriod: "",
    vatReturnDueDate: "",
    vatReportingPeriod: "",
    placeOfSupply: "",

    // Corporate tax info
    ctTaxTreatment: "",
    ctTrn: "",
    ctRegisteredDate: "",
    coporateTaxPeriod: "",
    firstCtPeriodStartDate: "",
    firstCtPeriodEndDate: "",
    firstCtReturnDueDate: "",
    ctCertificateTax: null,
  });

  /* Shareholders (editable) */
  const [shareholders, setShareholders] = useState([
    { ownerType: "", name: "", nationality: "", sharePercentage: "" },
  ]);

  /* New business document uploads (same behaviour as AddCustomer) */
  const [businessDocuments, setBusinessDocuments] = useState([
    { docType: "", file: null },
  ]);

  /* Load customer details from API */
  useEffect(() => {
    async function load() {
      try {
        setLoading(true);

        const data = await fetchCustomerById(id);
        const c = data.customer;

        setForm({
          customerName: c.customer_name || "",
          address: c.address || "",
          email: c.email || "",
          mobile: c.mobile || "",
          country: c.country || "",

          entityType: c.entity_type || "",
          entitySubType: c.entity_sub_type || "",
          dateOfIncorporation: toDateInput(c.date_of_incorporation),
          tradeLicenseAuthority: c.trade_license_authority || "",
          tradeLicenseNumber: c.trade_license_number || "",
          licenseIssueDate: toDateInput(c.license_issue_date),
          licenseExpiryDate: toDateInput(c.license_expiry_date),
          businessActivity: c.business_activity || "",
          isFreezone: Boolean(c.is_freezone),
          freezoneName: c.freezone_name || "",
          authorisedSignatories: c.authorised_signatories || "",
          shareCapital: c.share_capital || "",
          ftaCredentials: c.fta_credentials || "",
          ftaPassword: c.fta_password || "",

          functionalCurrency: c.functional_currency || "",

          vatTaxTreatment: c.vat_tax_treatment || "",
          vatInfoCertificate: null, // cannot prefill file from server
          vatTrn: c.vat_trn || "",
          vatRegisteredDate: toDateInput(c.vat_registered_date),
          firstVatFilingPeriod: c.first_vat_filing_period || "",
          vatReturnDueDate: toDateInput(c.vat_return_due_date),
          vatReportingPeriod: c.vat_reporting_period || "",
          placeOfSupply: c.place_of_supply || "",

          ctTaxTreatment: c.ct_tax_treatment || "",
          ctTrn: c.ct_trn || "",
          ctRegisteredDate: toDateInput(c.ct_registered_date),
          coporateTaxPeriod: c.corporate_tax_period || "",
          firstCtPeriodStartDate: toDateInput(c.first_ct_period_start_date),
          firstCtPeriodEndDate: toDateInput(c.first_ct_period_end_date),
          firstCtReturnDueDate: toDateInput(c.first_ct_return_due_date),
          ctCertificateTax: null, // cannot prefill file
        });

        if (data.shareholders?.length) {
          setShareholders(
            data.shareholders.map((s) => ({
              ownerType: s.owner_type || "",
              name: s.name || "",
              nationality: s.nationality || "",
              sharePercentage: s.share_percentage || "",
            }))
          );
        }
      } catch (err) {
        console.error(err);
        setError(err.message || "Failed to load customer");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [id]);

  /* Handlers (same as AddCustomer) */
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setForm((p) => ({ ...p, [name]: value }));
  };

  const handleCheckboxChange = (e) => {
    const { name, checked } = e.target;
    setForm((p) => ({ ...p, [name]: checked }));
  };

  const handleFileChange = (e) => {
    const { name, files } = e.target;
    const file = files && files[0] ? files[0] : null;
    setForm((p) => ({ ...p, [name]: file }));
  };

  // Shareholders
  const handleShareholderChange = (index, field, value) => {
    setShareholders((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const addShareholderRow = () => {
    setShareholders((prev) => [
      ...prev,
      { ownerType: "", name: "", nationality: "", sharePercentage: "" },
    ]);
  };

  const removeShareholderRow = (index) => {
    setShareholders((prev) => prev.filter((_, i) => i !== index));
  };

  // Business documents
  const handleBusinessDocTypeChange = (index, value) => {
    setBusinessDocuments((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], docType: value };
      return next;
    });
  };

  const handleBusinessDocFileChange = (index, e) => {
    const file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
    setBusinessDocuments((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], file };
      return next;
    });
  };

  const addBusinessDocumentRow = () => {
    setBusinessDocuments((prev) => [...prev, { docType: "", file: null }]);
  };

  const removeBusinessDocumentRow = (index) => {
    setBusinessDocuments((prev) => prev.filter((_, i) => i !== index));
  };

  /* Submit */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    const fd = new FormData();

    Object.entries(form).forEach(([k, v]) => {
      if (v instanceof File) {
        if (v) fd.append(k, v);
      } else if (typeof v === "boolean") {
        fd.append(k, v ? "true" : "false");
      } else {
        fd.append(k, v ?? "");
      }
    });

    // Shareholders as JSON
    fd.append("shareholders", JSON.stringify(shareholders));

    // New business documents (same format as AddCustomer)
    businessDocuments.forEach((doc, idx) => {
      if (!doc.docType && !doc.file) return;
      fd.append(`businessDocuments[${idx}][type]`, doc.docType || "");
      if (doc.file) {
        fd.append(`businessDocuments[${idx}][file]`, doc.file);
      }
    });

    try {
      await updateCustomer(id, fd);
      navigate("/customers");
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to update customer");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => navigate("/customers");

  /* Conditional certificate upload (same logic as AddCustomer) */
  const showVatCertificateUpload = [
    "vat_registered",
    "vat_registered_dz",
    "gcc_vat_registered",
  ].includes(form.vatTaxTreatment);

  const showCtCertificateUpload =
    form.ctTaxTreatment === "corporate_tax_registered";

  if (loading) {
    return (
      <div className="customer-form-page">
        <h2>Loading customer...</h2>
      </div>
    );
  }

  return (
    <div className="customer-form-page">
      <div className="customer-form-head">
        <div className="customer-form-title-wrap">
          <h1 className="customer-form-title">Edit Customer</h1>
          <p className="customer-form-sub">
            Update customer, business and tax details.
          </p>
        </div>

        <div className="customer-form-head-actions">
          <button type="button" className="btn ghost" onClick={handleCancel}>
            <ArrowLeft size={16} /> Back
          </button>

          <button
            className="btn btn-black"
            type="submit"
            form="edit-customer-form"
            disabled={saving}
          >
            <Save size={16} /> {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <form id="edit-customer-form" onSubmit={handleSubmit}>
        {/* 1) BASIC DETAILS */}
        <section className="card-section">
          <div className="card-section-head">
            <h2>Basic Details</h2>
            <p>General customer information.</p>
          </div>

          <div className="card-grid-2">
            <div className="field">
              <label>Customer Name</label>
              <input
                type="text"
                name="customerName"
                value={form.customerName}
                onChange={handleInputChange}
              />
            </div>

            <div className="field">
              <label>Email</label>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleInputChange}
              />
            </div>

            <div className="field full">
              <label>Address</label>
              <textarea
                name="address"
                rows={2}
                value={form.address}
                onChange={handleInputChange}
              />
            </div>

            <div className="field">
              <label>Mobile</label>
              <input
                type="text"
                name="mobile"
                value={form.mobile}
                onChange={handleInputChange}
              />
            </div>

            <div className="field">
              <label>Country</label>
              <input
                type="text"
                name="country"
                value={form.country}
                onChange={handleInputChange}
              />
            </div>
          </div>
        </section>

        {/* 2) BUSINESS DETAILS */}
        <section className="card-section">
          <div className="card-section-head">
            <h2>Business Details</h2>
            <p>Documents, entity information and ownership structure.</p>
          </div>

          {/* i) Document Upload (new docs) */}
          <div className="subsection">
            <h3>Document Upload</h3>
            <div className="doc-rows">
              {businessDocuments.map((doc, index) => (
                <div className="doc-row" key={index}>
                  <div className="field">
                    <label>Document Type</label>
                    <select
                      value={doc.docType}
                      onChange={(e) =>
                        handleBusinessDocTypeChange(index, e.target.value)
                      }
                    >
                      <option value="">Select document type</option>
                      <option value="moa">Memorandum of Association</option>
                      <option value="trade_license">Trade License</option>
                      <option value="incorporation">
                        Certificate of Incorporation
                      </option>
                      <option value="vat_certificate">VAT Certificate</option>
                      <option value="ct_certificate">CT Certificate</option>
                      <option value="other">Other Supporting Documents</option>
                    </select>
                  </div>

                  <div className="field file-field">
                    <label>Upload File</label>
                    <label className="file-trigger">
                      <div className="file-trigger-main">
                        <UploadCloud size={16} />
                        <span>
                          {doc.file ? doc.file.name : "Click to upload file"}
                        </span>
                      </div>
                      <span className="file-trigger-sub">
                        PDF, JPG, PNG – max 10MB
                      </span>
                      <input
                        type="file"
                        onChange={(e) => handleBusinessDocFileChange(index, e)}
                        accept=".pdf,.jpg,.jpeg,.png"
                      />
                    </label>
                  </div>

                  <div className="doc-row-delete">
                    <button
                      type="button"
                      className="icon-btn danger"
                      onClick={() => removeBusinessDocumentRow(index)}
                      disabled={businessDocuments.length === 1}
                      aria-label="Remove document"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}

              <button
                type="button"
                className="btn-link"
                onClick={addBusinessDocumentRow}
              >
                <Plus size={14} />
                <span>Add document</span>
              </button>
            </div>
          </div>

          {/* ii) Entity Details */}
          <div className="subsection">
            <h3>Entity Details</h3>
            <div className="card-grid-3">
              <div className="field">
                <label>Entity Type</label>
                <select
                  name="entityType"
                  value={form.entityType}
                  onChange={handleInputChange}
                >
                  <option value="">Select entity type</option>
                  <option value="legal_llc">
                    Legal Person - Incorporated (LLC)
                  </option>
                  <option value="legal_foreign">
                    Legal Person - Foreign Business
                  </option>
                  <option value="legal_club">
                    Legal Person - Club/Association/Society
                  </option>
                  <option value="legal_charity">Legal Person - Charity</option>
                  <option value="legal_federal">
                    Legal Person - Federal Government Entity
                  </option>
                  <option value="legal_emirate">
                    Legal Person - Emirate Government Entity
                  </option>
                  <option value="legal_other">Legal Person - Other</option>
                  <option value="partnership">Partnership</option>
                </select>
              </div>

              <div className="field">
                <label>Entity Sub Type</label>
                <select
                  name="entitySubType"
                  value={form.entitySubType}
                  onChange={handleInputChange}
                >
                  <option value="">Select sub type</option>
                  <option value="uae_private">
                    UAE Private Company (Incl. an Establishment)
                  </option>
                  <option value="pjsc">Public Joint Stock Company</option>
                  <option value="foundation">Foundation</option>
                  <option value="trust">Trust</option>
                </select>
              </div>

              <div className="field">
                <label>Date of Incorporation</label>
                <input
                  type="date"
                  name="dateOfIncorporation"
                  value={form.dateOfIncorporation}
                  onChange={handleInputChange}
                />
              </div>

              <div className="field">
                <label>Trade License Issuing Authority</label>
                <input
                  type="text"
                  name="tradeLicenseAuthority"
                  value={form.tradeLicenseAuthority}
                  onChange={handleInputChange}
                />
              </div>

              <div className="field">
                <label>Trade License Number</label>
                <input
                  type="text"
                  name="tradeLicenseNumber"
                  value={form.tradeLicenseNumber}
                  onChange={handleInputChange}
                />
              </div>

              <div className="field">
                <label>License Issue Date</label>
                <input
                  type="date"
                  name="licenseIssueDate"
                  value={form.licenseIssueDate}
                  onChange={handleInputChange}
                />
              </div>

              <div className="field">
                <label>License Expiry Date</label>
                <input
                  type="date"
                  name="licenseExpiryDate"
                  value={form.licenseExpiryDate}
                  onChange={handleInputChange}
                />
              </div>

              <div className="field full">
                <label>Business Activity Details</label>
                <textarea
                  name="businessActivity"
                  rows={2}
                  value={form.businessActivity}
                  onChange={handleInputChange}
                />
              </div>

              <div className="field inline full">
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    name="isFreezone"
                    checked={form.isFreezone}
                    onChange={handleCheckboxChange}
                  />
                  <span>
                    Is the company located in a Freezone/Designated Freezone?
                  </span>
                </label>
              </div>

              {form.isFreezone && (
                <div className="field full">
                  <label>Name of Freezone/Designated Freezone</label>
                  <input
                    type="text"
                    name="freezoneName"
                    value={form.freezoneName}
                    onChange={handleInputChange}
                  />
                </div>
              )}
            </div>
          </div>

          {/* iii) Owner / Shareholding Details */}
          <div className="subsection">
            <h3>Owner / Shareholding Details</h3>
            <div className="shareholder-table">
              <div className="shareholder-header">
                <span>Owner Type</span>
                <span>Name</span>
                <span>Nationality</span>
                <span>Shareholding %</span>
                <span></span>
              </div>
              {shareholders.map((row, index) => (
                <div className="shareholder-row" key={index}>
                  <input
                    type="text"
                    value={row.ownerType}
                    onChange={(e) =>
                      handleShareholderChange(
                        index,
                        "ownerType",
                        e.target.value
                      )
                    }
                    placeholder="Individual / Corporate"
                  />
                  <input
                    type="text"
                    value={row.name}
                    onChange={(e) =>
                      handleShareholderChange(index, "name", e.target.value)
                    }
                    placeholder="Owner name"
                  />
                  <input
                    type="text"
                    value={row.nationality}
                    onChange={(e) =>
                      handleShareholderChange(
                        index,
                        "nationality",
                        e.target.value
                      )
                    }
                    placeholder="Nationality"
                  />
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={row.sharePercentage}
                    onChange={(e) =>
                      handleShareholderChange(
                        index,
                        "sharePercentage",
                        e.target.value
                      )
                    }
                    placeholder="%"
                  />
                  <button
                    type="button"
                    className="icon-btn danger"
                    onClick={() => removeShareholderRow(index)}
                    disabled={shareholders.length === 1}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn-link"
                onClick={addShareholderRow}
              >
                <Plus size={14} />
                <span>Add shareholder</span>
              </button>
            </div>
          </div>

          {/* iv/v/vi) Authorised Signatories, Share Capital, FTA Credentials */}
          <div className="subsection inline-fields">
            <div className="field">
              <label>Authorised Signatories</label>
              <input
                type="text"
                name="authorisedSignatories"
                value={form.authorisedSignatories}
                onChange={handleInputChange}
              />
            </div>
          </div>

          <div className="subsection inline-fields">
            <div className="field">
              <label>Share Capital</label>
              <input
                type="text"
                name="shareCapital"
                value={form.shareCapital}
                onChange={handleInputChange}
              />
            </div>
          </div>

          <div className="subsection inline-fields">
            <div className="field">
              <label>FTA Credentials</label>
              <input
                type="text"
                name="ftaCredentials"
                value={form.ftaCredentials}
                onChange={handleInputChange}
              />
            </div>
            <div className="field">
              <label>FTA Password</label>
              <input
                type="password"
                name="ftaPassword"
                value={form.ftaPassword}
                onChange={handleInputChange}
              />
            </div>
          </div>
        </section>

        {/* 3) TAX & FINANCIALS */}
        <section className="card-section">
          <div className="card-section-head">
            <h2>Tax &amp; Financials</h2>
            <p>VAT and corporate tax details.</p>
          </div>

          {/* VAT Information */}
          <div className="subsection">
            <h3>VAT Information</h3>
            <div className="card-grid-3">
              <div className="field">
                <label>Tax Treatment</label>
                <select
                  name="vatTaxTreatment"
                  value={form.vatTaxTreatment}
                  onChange={handleInputChange}
                >
                  <option value="">Select tax treatment</option>
                  <option value="vat_registered">VAT Registered</option>
                  <option value="non_vat_registered">Non VAT Registered</option>
                  <option value="vat_registered_dz">
                    VAT Registered - Designated zone
                  </option>
                  <option value="non_vat_registered_dz">
                    Non VAT Registered - Designated zone
                  </option>
                  <option value="gcc_vat_registered">GCC VAT Registered</option>
                  <option value="gcc_non_vat_registered">
                    GCC Non VAT Registered
                  </option>
                </select>
              </div>

              {showVatCertificateUpload && (
                <div className="field file-field">
                  <label>VAT Certificate</label>
                  <label className="file-trigger">
                    <div className="file-trigger-main">
                      <UploadCloud size={16} />
                      <span>
                        {form.vatInfoCertificate
                          ? form.vatInfoCertificate.name
                          : "Upload VAT certificate"}
                      </span>
                    </div>
                    <span className="file-trigger-sub">
                      PDF, JPG, PNG – max 10MB
                    </span>
                    <input
                      type="file"
                      name="vatInfoCertificate"
                      onChange={handleFileChange}
                      accept=".pdf,.jpg,.jpeg,.png"
                    />
                  </label>
                </div>
              )}

              <div className="field">
                <label>Tax Registration Number</label>
                <input
                  type="text"
                  name="vatTrn"
                  value={form.vatTrn}
                  onChange={handleInputChange}
                />
              </div>

              <div className="field">
                <label>VAT Registered Date</label>
                <input
                  type="date"
                  name="vatRegisteredDate"
                  value={form.vatRegisteredDate}
                  onChange={handleInputChange}
                />
              </div>

              <div className="field">
                <label>First VAT Return Period</label>
                <input
                  type="text"
                  name="firstVatFilingPeriod"
                  value={form.firstVatFilingPeriod}
                  onChange={handleInputChange}
                />
              </div>

              <div className="field">
                <label>VAT Return Due Date</label>
                <input
                  type="date"
                  name="vatReturnDueDate"
                  value={form.vatReturnDueDate}
                  onChange={handleInputChange}
                />
              </div>

              <div className="field">
                <label>Reporting Period</label>
                <select
                  name="vatReportingPeriod"
                  value={form.vatReportingPeriod}
                  onChange={handleInputChange}
                >
                  <option value="">Select reporting period</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                </select>
              </div>
            </div>
          </div>

          {/* Corporate Tax Information */}
          <div className="subsection">
            <h3>Corporate Tax Information</h3>
            <div className="card-grid-3">
              <div className="field">
                <label>Tax Treatment</label>
                <select
                  name="ctTaxTreatment"
                  value={form.ctTaxTreatment}
                  onChange={handleInputChange}
                >
                  <option value="">Select tax treatment</option>
                  <option value="corporate_tax_registered">
                    Corporate Tax Registered
                  </option>
                  <option value="not_registered">Not Registered</option>
                </select>
              </div>

              {showCtCertificateUpload && (
                <div className="field file-field">
                  <label>CT Certificate</label>
                  <label className="file-trigger">
                    <div className="file-trigger-main">
                      <UploadCloud size={16} />
                      <span>
                        {form.ctCertificateTax
                          ? form.ctCertificateTax.name
                          : "Upload CT certificate"}
                      </span>
                    </div>
                    <span className="file-trigger-sub">
                      PDF, JPG, PNG – max 10MB
                    </span>
                    <input
                      type="file"
                      name="ctCertificateTax"
                      onChange={handleFileChange}
                      accept=".pdf,.jpg,.jpeg,.png"
                    />
                  </label>
                </div>
              )}

              <div className="field">
                <label>Corporate Tax TRN</label>
                <input
                  type="text"
                  name="ctTrn"
                  value={form.ctTrn}
                  onChange={handleInputChange}
                />
              </div>

              <div className="field">
                <label>CT Registered Date</label>
                <input
                  type="date"
                  name="ctRegisteredDate"
                  value={form.ctRegisteredDate}
                  onChange={handleInputChange}
                />
              </div>

              <div className="field">
                <label>Corporate Tax Period</label>
                <input
                  type="text"
                  name="coporateTaxPeriod"
                  value={form.coporateTaxPeriod}
                  onChange={handleInputChange}
                />
              </div>

              <div className="field">
                <label>First Corporate Tax Period Start Date</label>
                <input
                  type="date"
                  name="firstCtPeriodStartDate"
                  value={form.firstCtPeriodStartDate}
                  onChange={handleInputChange}
                />
              </div>

              <div className="field">
                <label>First Corporate Tax Period End Date</label>
                <input
                  type="date"
                  name="firstCtPeriodEndDate"
                  value={form.firstCtPeriodEndDate}
                  onChange={handleInputChange}
                />
              </div>

              <div className="field">
                <label>First Corporate Tax Return Filing Due Date</label>
                <input
                  type="date"
                  name="firstCtReturnDueDate"
                  value={form.firstCtReturnDueDate}
                  onChange={handleInputChange}
                />
              </div>
            </div>
          </div>
        </section>
      </form>
    </div>
  );
}
