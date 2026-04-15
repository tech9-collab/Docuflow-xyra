import { useEffect } from "react";
import {
  BookOpen,
  Shield,
  Users,
  Files,
  FileText,
  ArrowRight,
  CheckCircle2,
  Workflow,
  Database,
  Building2,
} from "lucide-react";
import "./KnowledgeBase.css";

const roles = [
  {
    title: "Super Admin",
    icon: <Shield size={18} />,
    items: [
      "Full access to administration screens",
      "Manage departments, employees, and roles/permissions",
      "View system-wide analytics in the Admin Dashboard",
    ],
  },
  {
    title: "Department Admin",
    icon: <Building2 size={18} />,
    items: [
      "Access department dashboard and user management",
      "Use features allowed by permissions",
    ],
  },
  {
    title: "Standard User",
    icon: <Users size={18} />,
    items: [
      "Access only modules granted by permissions",
      "Use conversion, customer, VAT, and CT workflows",
    ],
  },
];

const modules = [
  "Bank Statements",
  "Invoices & Bills",
  "Emirates ID",
  "Passport",
  "Visa",
  "Trade License",
  "Customers",
  "VAT Filing",
  "CT Filing",
  "Admin Dashboard",
];

const steps = [
  "Sign in to the application",
  "Load the user profile, role, and permissions",
  "Open a module from the sidebar",
  "Upload files or update customer data",
  "Submit the request to the backend",
  "Wait for AI extraction, polling, or filing preparation",
  "Review the result page or dashboard output",
  "Download the Excel file or continue to the next workflow",
];

const workflowCards = [
  {
    title: "Document Conversion",
    icon: <Files size={18} />,
    items: [
      "Upload PDF or image files",
      "Preview files in the browser",
      "Process and review extracted data",
      "Download the final Excel output",
    ],
  },
  {
    title: "Customer to Filing",
    icon: <FileText size={18} />,
    items: [
      "Create or update a customer",
      "Open VAT or CT Filing",
      "Create filing periods and runs",
      "Generate filing output when ready",
    ],
  },
  {
    title: "Admin Analytics",
    icon: <Database size={18} />,
    items: [
      "Review total users, departments, roles, and documents",
      "Inspect monthly trends",
      "Track estimated Gemini cost and usage",
    ],
  },
];

export default function KnowledgeBase() {
  useEffect(() => {
    document.title = "DocuFlow - Knowledge Base";
  }, []);

  return (
    <div className="kb-page">
      <header className="kb-hero">
        <div className="kb-hero-copy">
          <div className="kb-kicker">
            <BookOpen size={16} />
            <span>Knowledge Base</span>
          </div>
          <h1>DocuFlow Knowledge Base</h1>
          <p>
            A single in-app reference for how the platform works, what each
            module does, and how users move through the document and filing
            workflows.
          </p>
        </div>
        <div className="kb-hero-card">
          <div className="kb-stat">
            <span className="kb-stat-value">10+</span>
            <span className="kb-stat-label">Core modules</span>
          </div>
          <div className="kb-stat">
            <span className="kb-stat-value">3</span>
            <span className="kb-stat-label">User roles</span>
          </div>
          <div className="kb-stat">
            <span className="kb-stat-value">1</span>
            <span className="kb-stat-label">Unified workflow</span>
          </div>
        </div>
      </header>

      <section className="kb-grid">
        <article className="kb-panel">
          <div className="kb-panel-head">
            <Workflow size={18} />
            <h2>Application Overview</h2>
          </div>
          <ul className="kb-list">
            <li>Upload and preview PDFs and images before processing</li>
            <li>Extract data from bank statements, invoices, bills, and identity documents</li>
            <li>Separate invoice data into Sales, Purchase, and Other buckets</li>
            <li>Manage customers and store business and tax profile details</li>
            <li>Support VAT and Corporate Tax filing workflows</li>
            <li>Provide admin dashboards with usage and processing analytics</li>
          </ul>
        </article>

        <article className="kb-panel">
          <div className="kb-panel-head">
            <Database size={18} />
            <h2>Main Tech Areas</h2>
          </div>
          <ul className="kb-list">
            <li>Frontend: React, React Router, Axios, Recharts, pdf.js</li>
            <li>Backend: Node.js, Express, MySQL, Multer</li>
            <li>AI extraction: Gemini-based processing and normalization helpers</li>
            <li>Exports: Excel generation for final downloadable output</li>
          </ul>
        </article>
      </section>

      <section className="kb-section">
        <div className="kb-section-head">
          <h2>User Roles</h2>
          <p>Who can do what inside DocuFlow.</p>
        </div>
        <div className="kb-card-grid">
          {roles.map((role) => (
            <article className="kb-role-card" key={role.title}>
              <div className="kb-role-top">
                <span className="kb-role-icon">{role.icon}</span>
                <h3>{role.title}</h3>
              </div>
              <ul className="kb-list compact">
                {role.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="kb-section">
        <div className="kb-section-head">
          <h2>Main Modules</h2>
          <p>The key features exposed through the sidebar.</p>
        </div>
        <div className="kb-chip-grid">
          {modules.map((module) => (
            <span className="kb-chip" key={module}>
              <CheckCircle2 size={14} />
              {module}
            </span>
          ))}
        </div>
      </section>

      <section className="kb-section">
        <div className="kb-section-head">
          <h2>User Manual</h2>
          <p>How a normal signed-in user works through the app.</p>
        </div>
        <div className="kb-steps">
          {steps.map((step, index) => (
            <div className="kb-step" key={step}>
              <div className="kb-step-num">{String(index + 1).padStart(2, "0")}</div>
              <div className="kb-step-text">{step}</div>
              {index < steps.length - 1 ? <ArrowRight size={16} className="kb-step-arrow" /> : null}
            </div>
          ))}
        </div>
      </section>

      <section className="kb-section">
        <div className="kb-section-head">
          <h2>Functional Workflow</h2>
          <p>Three primary paths the application follows.</p>
        </div>
        <div className="kb-card-grid three">
          {workflowCards.map((card) => (
            <article className="kb-workflow-card" key={card.title}>
              <div className="kb-role-top">
                <span className="kb-role-icon">{card.icon}</span>
                <h3>{card.title}</h3>
              </div>
              <ul className="kb-list compact">
                {card.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="kb-section">
        <div className="kb-section-head">
          <h2>Operational Notes</h2>
          <p>Important behavior to remember while using the system.</p>
        </div>
        <div className="kb-notes">
          <div className="kb-note">
            The sidebar only shows features allowed by the signed-in user&apos;s permissions.
          </div>
          <div className="kb-note">
            Invoice classification is AI-assisted, so sales and purchase documents may need manual review when the source is ambiguous.
          </div>
          <div className="kb-note">
            Long-running jobs may require the tab to stay open until processing completes.
          </div>
          <div className="kb-note">
            Bank statements support a PDF password when the file is protected.
          </div>
        </div>
      </section>

      <section className="kb-section">
        <div className="kb-section-head">
          <h2>Quick Reference</h2>
          <p>Where to go for each major task.</p>
        </div>
        <div className="kb-ref-grid">
          <div className="kb-ref-item">Login for access</div>
          <div className="kb-ref-item">Customers for company setup</div>
          <div className="kb-ref-item">Invoices & Bills for invoice extraction</div>
          <div className="kb-ref-item">Bank Statements for statement extraction</div>
          <div className="kb-ref-item">VAT Filing and CT Filing for compliance workflows</div>
          <div className="kb-ref-item">Admin Dashboard for system-wide reporting</div>
        </div>
      </section>
    </div>
  );
}
