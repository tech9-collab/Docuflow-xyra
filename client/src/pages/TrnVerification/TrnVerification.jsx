import { useEffect } from "react";
import { CheckCircle, ExternalLink } from "lucide-react";
import "./TrnVerification.css";

export default function TrnVerification() {
  useEffect(() => {
    document.title = "Xyra Books - TRN Verification";
  }, []);

  const handleVerifyTrn = () => {
    window.open("https://tax.gov.ae/en/default.aspx", "_blank", "noopener,noreferrer");
  };

  return (
    <section className="trn-verification-page">
      <header className="page-header">
        <div className="title-wrap">
          <h2>TRN Verification</h2>
          <p className="page-kicker">Verify Tax Registration Numbers with FTA.</p>
        </div>
      </header>

      <div className="content-block">
        <div className="verification-card">
          <div className="card-icon">
            <CheckCircle size={48} />
          </div>
          <h3>TRN Verification Tool</h3>
          <p>This module allows you to verify the validity of TRNs provided by your suppliers or customers.</p>
          <button
            type="button"
            className="verify-trn-btn"
            onClick={handleVerifyTrn}
            aria-label="Verify TRN on the UAE Federal Tax Authority website"
          >
            <span>Verify TRN</span>
            <ExternalLink size={18} />
          </button>
          <p className="verify-trn-hint">Opens the official UAE Federal Tax Authority page in a new tab.</p>
        </div>
      </div>
    </section>
  );
}
