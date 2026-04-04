import "./Footer.css";

export default function Footer() {
  return (
    <footer className="site-footer">
      <span>
        © {new Date().getFullYear()} XYRA - Document Processing Suite
      </span>
    </footer>
  );
}
