// CtFilingTypes.jsx
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CreditCard,
  FileText,
  PieChart,
  ShieldCheck,
  ArrowRight,
  ChevronLeft,
} from "lucide-react";
import { getCompanyById } from "../../helper/helper";
import "./CtFilingTypes.css";

export default function CtFilingTypes() {
  const { companyId } = useParams();
  const navigate = useNavigate();

  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "DocuFlow - CT Filing - Select Type";
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const res = await getCompanyById(companyId);
        setCompanyName(res.company?.name || `Company ${companyId}`);
        setError("");
      } catch (e) {
        console.error("Failed to load company:", e);
        setCompanyName(`Company ${companyId}`);
        setError("Failed to load company details");
      } finally {
        setLoading(false);
      }
    }
    if (companyId) load();
  }, [companyId]);

  const goBackToCompanies = () => {
    navigate(`/projects/ct-filing/periods/${companyId}`);
  };

  const handleTypeClick = (type) => {
    switch (type) {
      case 1:
        // Type 1: Bank statement only
        navigate(`/projects/ct-filing/bank-only/${companyId}`);
        break;
      case 2:
        // Type 2: Bank + Invoices (current CtBankAndInvoice page)
        navigate(`/projects/ct-filing/bank-and-invoice/${companyId}`);
        break;
      case 3:
        // Placeholder – you will plug in later
        navigate(`/projects/ct-filing/type3/${companyId}`);
        break;
      case 4:
        // Placeholder – you will plug in later
        navigate(`/projects/ct-filing/type4/${companyId}`);
        break;
      default:
        break;
    }
  };

  return (
    <div className="ct-types-page">
      {/* Header */}
      <header className="ct-types-header">
        <div className="ct-types-header-left">
          <button className="btn-back" onClick={goBackToCompanies}>
            <ChevronLeft size={18} />
          </button>
          <div className="ct-types-title-wrap">
            <h2 className="ct-types-title">
              Corporate Tax Filing – {companyName || "Company"}
            </h2>
            <p className="ct-types-sub">
              Please select the type of documents you need to file.
            </p>
            {error && <div className="ct-types-error">{error}</div>}
          </div>
        </div>
      </header>

      {/* Loading state */}
      {loading ? (
        <div className="ct-types-loading">Loading company…</div>
      ) : (
        <main className="ct-types-grid">
          {/* TYPE 1 */}
          <button
            type="button"
            className="ct-type-card"
            onClick={() => handleTypeClick(1)}
          >
            <div className="ct-type-icon">
              <CreditCard size={24} />
            </div>
            <div className="ct-type-body">
              <div className="ct-type-label">Type 1</div>
              <div className="ct-type-title">Bank Statement</div>
              <p className="ct-type-desc">
                Upload only bank statements for CT reconciliation and cash
                matching.
              </p>
            </div>
            <div className="ct-type-arrow">
              <ArrowRight size={20} />
            </div>
          </button>

          {/* TYPE 2 */}
          <button
            type="button"
            className="ct-type-card"
            onClick={() => handleTypeClick(2)}
          >
            <div className="ct-type-icon">
              <FileText size={24} />
            </div>
            <div className="ct-type-body">
              <div className="ct-type-label">Type 2</div>
              <div className="ct-type-title">
                Bank Statement &amp; Invoices/Bills
              </div>
              <p className="ct-type-desc">
                Upload invoices and bank statements together for full CT filing,
                using your existing combined UI.
              </p>
            </div>
            <div className="ct-type-arrow">
              <ArrowRight size={20} />
            </div>
          </button>

          {/* TYPE 3 – placeholder */}
          <button
            type="button"
            className="ct-type-card"
            onClick={() => handleTypeClick(3)}
          >
            <div className="ct-type-icon">
              <PieChart size={24} />
            </div>
            <div className="ct-type-body">
              <div className="ct-type-label">Type 3</div>
              <div className="ct-type-title">Trial Balance</div>
              <p className="ct-type-desc">
                Trial balance upload for CT working. We&apos;ll plug in your
                upload page here later.
              </p>
            </div>
            <div className="ct-type-arrow">
              <ArrowRight size={20} />
            </div>
          </button>

          {/* TYPE 4 – placeholder */}
          <button
            type="button"
            className="ct-type-card"
            onClick={() => handleTypeClick(4)}
          >
            <div className="ct-type-icon">
              <ShieldCheck size={24} />
            </div>
            <div className="ct-type-body">
              <div className="ct-type-label">Type 4</div>
              <div className="ct-type-title">
                Internal &amp; External Audit Report
              </div>
              <p className="ct-type-desc">
                Upload audit reports for CT review. Design and mapping will be
                added later.
              </p>
            </div>
            <div className="ct-type-arrow">
              <ArrowRight size={20} />
            </div>
          </button>
        </main>
      )}
    </div>
  );
}
