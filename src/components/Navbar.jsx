import { Link, useLocation } from "react-router-dom";

export default function Navbar() {
  const { pathname } = useLocation();

  const links = [
    { to: "/", label: "Home" },
    { to: "/library", label: "Library" },
    { to: "/dashboard", label: "Upload" },
  ];

  return (
    <nav className="navbar">
      <Link to="/" className="navbar-brand">
        <div className="navbar-logo">
          <svg viewBox="0 0 24 24">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
          </svg>
        </div>
        <span className="navbar-title">Folio</span>
      </Link>

      <div className="navbar-nav">
        {links.map(({ to, label }) => (
          <Link
            key={to}
            to={to}
            className={`nav-link${pathname === to ? " active" : ""}`}
          >
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
