import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Save, Plus, Trash2, UploadCloud } from "lucide-react";
import "./AddCustomer.css";
import { createCustomer } from "../../helper/helper";

export default function AddCustomer() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    // 1) Basic details
    customerName: "",
    address: "",
    email: "",
    mobile: "",
    country: "",

    // 2) Business details – Entity details & simple fields
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

    // 3) Tax & Financials
    functionalCurrency: "",

    // VAT information
    vatTaxTreatment: "", // new select instead of radios
    vatInfoCertificate: null,
    vatTrn: "",
    vatRegisteredDate: "",
    firstVatFilingPeriod: "",
    vatReturnDueDate: "",
    vatReportingPeriod: "",
    placeOfSupply: "",

    // Corporate tax information
    ctTaxTreatment: "",
    ctTrn: "",
    ctRegisteredDate: "",
    coporateTaxPeriod: "",
    firstTaxPeriodStartDate: "", // kept if you need later
    firstCtPeriodStartDate: "",
    firstCtPeriodEndDate: "",
    firstCtReturnDueDate: "",
    ctCertificateTax: null,
  });

  // Business documents (single upload + document type, multiple rows)
  const [businessDocuments, setBusinessDocuments] = useState([
    { docType: "", file: null },
  ]);

  // Shareholders
  const [shareholders, setShareholders] = useState([
    { ownerType: "", name: "", nationality: "", sharePercentage: "" },
  ]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleCheckboxChange = (e) => {
    const { name, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: checked }));
  };

  const handleFileChange = (e) => {
    const { name, files } = e.target;
    const file = files && files[0] ? files[0] : null;
    setForm((prev) => ({
      ...prev,
      [name]: file,
    }));
  };

  // Business document handlers
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

  // Shareholders table handlers
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

  const handleCancel = () => {
    navigate("/customers");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const fd = new FormData();

    // Simple fields + VAT/CT certificates etc.
    Object.entries(form).forEach(([key, value]) => {
      if (value instanceof File) {
        if (value) fd.append(key, value);
      } else {
        fd.append(key, value ?? "");
      }
    });

    // Business documents: documents[0][type], documents[0][file], etc.
    businessDocuments.forEach((doc, idx) => {
      if (!doc.docType && !doc.file) return;
      fd.append(`businessDocuments[${idx}][type]`, doc.docType || "");
      if (doc.file) {
        fd.append(`businessDocuments[${idx}][file]`, doc.file);
      }
    });

    // Shareholders as JSON
    fd.append("shareholders", JSON.stringify(shareholders));

    try {
      await createCustomer(fd);
      navigate("/customers");
    } catch (err) {
      console.error("Failed to create customer:", err);
      alert(err.message || "Failed to create customer");
    }
  };

  const showVatCertificateUpload = [
    "vat_registered",
    "vat_registered_dz",
    "gcc_vat_registered",
  ].includes(form.vatTaxTreatment);

  const showCtCertificateUpload =
    form.ctTaxTreatment === "corporate_tax_registered";

  return (
    <div className="customer-form-page">
      <div className="customer-form-head">
        <div className="customer-form-title-wrap">
          <h1 className="customer-form-title">Add Customer</h1>
          <p className="customer-form-sub">
            Capture customer, business and tax details for VAT / CT projects.
          </p>
        </div>
        <div className="customer-form-head-actions">
          <button type="button" className="btn ghost" onClick={handleCancel}>
            <ArrowLeft size={16} />
            Back
          </button>
          <button type="submit" form="customer-form" className="btn btn-black">
            <Save size={16} />
            Save Customer
          </button>
        </div>
      </div>

      <form id="customer-form" onSubmit={handleSubmit}>
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
                placeholder="Enter customer legal name"
              />
            </div>
            <div className="field">
              <label>Email ID</label>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleInputChange}
                placeholder="name@company.com"
              />
            </div>
            <div className="field full">
              <label>Address</label>
              <textarea
                name="address"
                value={form.address}
                onChange={handleInputChange}
                rows={2}
                placeholder="Office, building, city, country"
              />
            </div>
            <div className="field">
              <label>Mobile No</label>
              <input
                type="text"
                name="mobile"
                value={form.mobile}
                onChange={handleInputChange}
                placeholder="+971 ..."
              />
            </div>
            <div className="field">
              <label>Country</label>
              <input
                type="text"
                name="country"
                value={form.country}
                onChange={handleInputChange}
                placeholder="UAE"
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

          {/* i) Document Upload */}
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
                  placeholder="DED, Freezone authority, etc."
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
                  value={form.businessActivity}
                  onChange={handleInputChange}
                  rows={2}
                  placeholder="Main activities as per trade license"
                />
              </div>

              {/* checkbox full-width & styled */}
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
                    placeholder="Freezone name"
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
                    aria-label="Remove shareholder"
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

          {/* iv/v/vi) Authorised Signatories, Share Capital, FTA Credentials + Password */}
          <div className="subsection inline-fields">
            <div className="field">
              <label>Authorised Signatories</label>
              <input
                type="text"
                name="authorisedSignatories"
                value={form.authorisedSignatories}
                onChange={handleInputChange}
                placeholder="Names as per bank / license"
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
                placeholder="e.g. AED 300,000"
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
                placeholder="Username / email used for FTA"
              />
            </div>
            <div className="field">
              <label>FTA Password</label>
              <input
                type="password"
                name="ftaPassword"
                value={form.ftaPassword}
                onChange={handleInputChange}
                placeholder="Password"
              />
            </div>
          </div>
        </section>

        {/* 3) TAX & FINANCIALS */}
        <section className="card-section">
          <div className="card-section-head">
            <h2>Tax &amp; Financials</h2>
            <p>Functional currency, VAT and corporate tax details.</p>
          </div>

          {/* ii) VAT Information */}
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
                  placeholder="e.g. Jan–Mar 2024"
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

          {/* iii) Corporate Tax Information */}
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
                  placeholder="e.g. Jan–Mar 2024"
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
