import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div className="home-hero">
      <div className="hero-eyebrow">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
        </svg>
        Your personal reading space
      </div>

      <h1 className="hero-title">
        Read smarter,<br />
        learn <em>deeper</em>
      </h1>

      <p className="hero-sub">
        Upload any PDF book, read it beautifully, highlight passages, and look up words — all in one place.
      </p>

      <div className="hero-actions">
        <Link to="/dashboard" className="btn btn-primary">
          <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Upload a book
        </Link>
        <Link to="/library" className="btn btn-ghost">
          Browse library
        </Link>
      </div>
    </div>
  );
}
