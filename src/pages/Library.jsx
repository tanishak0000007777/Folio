import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

function getInitials(title) {
  return title
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("");
}

export default function Library() {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchBooks() {
      const { data, error } = await supabase
        .from("books")
        .select("*")
        .order("created_at", { ascending: false });
      if (!error) setBooks(data || []);
      setLoading(false);
    }
    fetchBooks();
  }, []);

  if (loading) {
    return (
      <div className="page">
        <h1 className="page-heading">Your library</h1>
        <p className="page-subheading">Loading your books…</p>
        <div className="books-grid">
          {[1, 2, 3].map((i) => (
            <div key={i} className="book-card" style={{ opacity: 0.4 }}>
              <div className="book-cover" style={{ background: "#161c2d", height: 200 }} />
              <div className="book-info">
                <div style={{ height: 12, background: "#1e293b", borderRadius: 4, marginBottom: 8 }} />
                <div style={{ height: 10, background: "#1e293b", borderRadius: 4, width: "60%" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (books.length === 0) {
    return (
      <div className="page">
        <h1 className="page-heading">Your library</h1>
        <div className="empty-state">
          <div className="empty-icon">📚</div>
          <div className="empty-title">No books yet</div>
          <div className="empty-sub">Upload your first PDF to get started</div>
          <Link to="/dashboard" className="btn btn-primary">
            <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Upload a book
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="flex" style={{ alignItems: "flex-end", justifyContent: "space-between", marginBottom: 40 }}>
        <div>
          <h1 className="page-heading">Your library</h1>
          <p className="page-subheading" style={{ marginBottom: 0 }}>
            {books.length} book{books.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Link to="/dashboard" className="btn btn-ghost text-sm">
          <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add book
        </Link>
      </div>

      <div className="books-grid">
        {books.map((book) => (
          <Link to={`/reader/${book.id}`} key={book.id} className="book-card">
            <div
              className="book-cover"
              style={{ background: book.cover_color || "#1a2744" }}
            >
              <div className="book-spine" />
              <span
                className="book-initials"
                style={{ color: book.cover_text_color || "#7eb8f7" }}
              >
                {getInitials(book.title)}
              </span>
            </div>
            <div className="book-info">
              <div className="book-title">{book.title}</div>
              <div className="book-meta">
                {book.total_pages > 0 ? `${book.total_pages} pages` : "PDF"}
              </div>
              <div className="book-progress-bar">
                <div className="book-progress-fill" style={{ width: "0%" }} />
              </div>
            </div>
          </Link>
        ))}

        <Link to="/dashboard" className="book-card-add">
          <div className="add-icon">+</div>
          <span>Add book</span>
        </Link>
      </div>
    </div>
  );
}
