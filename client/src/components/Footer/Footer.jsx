import "./Footer.css";

export default function Footer() {
  return (
    <footer className="site-footer">
      <span>
        © {new Date().getFullYear()} Xyra Books - Account & VAT Management Suite
      </span>
    </footer>
  );
}
