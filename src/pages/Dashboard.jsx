import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

const COVER_COLORS = [
  { bg: "#1a2744", text: "#7eb8f7" },
  { bg: "#1a2d28", text: "#6dd4a8" },
  { bg: "#251e40", text: "#a78bf6" },
  { bg: "#2d2215", text: "#e4b96a" },
  { bg: "#2d1a1a", text: "#f4837a" },
];

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export default function Dashboard() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState(null);
  const fileInputRef = useRef();
  const navigate = useNavigate();

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleFile = (f) => {
    if (!f) return;
    if (f.type !== "application/pdf") {
      showToast("Please select a PDF file", "error");
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      showToast("File must be under 50 MB", "error");
      return;
    }
    setFile(f);
    setProgress(0);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const handleUpload = async () => {
    if (!file) return;
    try {
      setLoading(true);
      setProgress(10);

      const fileName = `${Date.now()}-${file.name}`;
      const { error } = await supabase.storage
        .from("books")
        .upload(fileName, file);

      if (error) throw error;
      setProgress(60);

      const fileUrl = supabase.storage
        .from("books")
        .getPublicUrl(fileName).data.publicUrl;

      setProgress(80);

      const colorPick = COVER_COLORS[Math.floor(Math.random() * COVER_COLORS.length)];
      const { error: dbError } = await supabase.from("books").insert([{
        title: file.name.replace(".pdf", ""),
        file_url: fileUrl,
        total_pages: 0,
        cover_color: colorPick.bg,
        cover_text_color: colorPick.text,
      }]);

      if (dbError) throw dbError;
      setProgress(100);
      showToast("Book uploaded successfully!");
      setTimeout(() => navigate("/library"), 1000);
    } catch (err) {
      console.error(err);
      showToast(err.message || "Upload failed", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page page-sm">
      <h1 className="page-heading">Upload a book</h1>
      <p className="page-subheading">Add a PDF to your personal library</p>

      <div
        className={`upload-zone${dragOver ? " drag-over" : ""}`}
        onClick={() => !file && fileInputRef.current.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="file-input-hidden"
          onChange={(e) => handleFile(e.target.files[0])}
        />

        <div className="upload-icon-wrap">
          <svg viewBox="0 0 24 24">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>

        <div className="upload-title">
          {dragOver ? "Drop it here" : "Drop your PDF here"}
        </div>
        <div className="upload-subtitle">
          or <span>click to browse</span> · PDF up to 50 MB
        </div>

        {!file && (
          <button
            className="btn btn-ghost"
            onClick={(e) => { e.stopPropagation(); fileInputRef.current.click(); }}
          >
            Choose file
          </button>
        )}

        {file && (
          <div className="file-selected" onClick={(e) => e.stopPropagation()}>
            <div className="file-icon">
              <svg viewBox="0 0 24 24">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="file-name">{file.name}</div>
              <div className="file-size">{formatSize(file.size)}</div>
            </div>
            <button
              className="btn btn-icon"
              onClick={() => { setFile(null); setProgress(0); }}
              title="Remove"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        )}
      </div>

      {loading && (
        <div className="progress-wrap mt-sm">
          <div className="progress-label">
            <span>Uploading…</span>
            <span>{progress}%</span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {file && !loading && (
        <div className="mt-md flex gap-sm">
          <button className="btn btn-primary" onClick={handleUpload} style={{ flex: 1 }}>
            <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
            Upload to library
          </button>
          <button className="btn btn-ghost" onClick={() => setFile(null)}>
            Cancel
          </button>
        </div>
      )}

      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === "success"
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          }
          {toast.msg}
        </div>
      )}
    </div>
  );
}
