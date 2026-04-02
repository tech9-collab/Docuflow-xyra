import { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "../Sidebar/Sidebar";
import Navbar from "../Navbar/Navbar";
import Footer from "../Footer/Footer";
import "./Layout.css";

export default function Layout() {
  const [isOpen, setIsOpen] = useState(true); // true = visible

  return (
    <div className={`app-shell ${isOpen ? "is-open" : "is-closed"}`}>
      <Sidebar collapsed={!isOpen} />
      <div className="app-main">
        <Navbar onToggleSidebar={() => setIsOpen((v) => !v)} />
        <main className="app-content">
          <Outlet />
        </main>
        <Footer />
      </div>
    </div>
  );
}
