import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker?url";
import { supabase } from "../lib/supabase";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

// null = cursor (no tool active)
const TOOLS = [
  { id: "highlight", label: "Highlight" },
  { id: "pen",       label: "Pen"       },
  { id: "eraser",    label: "Eraser"    },
  { id: "text",      label: "Text"      },
];

const COLORS = [
  { hex: "#FFEB3B", label: "Yellow" },
  { hex: "#80DEEA", label: "Cyan"   },
  { hex: "#A5D6A7", label: "Green"  },
  { hex: "#EF9A9A", label: "Red"    },
  { hex: "#FFFFFF", label: "White"  },
  { hex: "#222222", label: "Black"  },
];

const LANGS = [
  { code: "hi", label: "Hindi"   },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French"  },
  { code: "ar", label: "Arabic"  },
  { code: "de", label: "German"  },
];

// ── save annotations debounced ────────────────────────────────────────────
let saveTimer = null;
function scheduleSave(fn) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(fn, 1500);
}

export default function Reader() {
  const { id } = useParams();

  const canvasRef  = useRef(null);
  const overlayRef = useRef(null);
  const wrapRef    = useRef(null);
  const ctxRef     = useRef(null);
  const drawingRef = useRef(false);
  const lastPos    = useRef(null);
  // store textbox DOM refs for current page
  const textBoxesRef = useRef([]);

  const [pdf,       setPdf]       = useState(null);
  const [pageNum,   setPageNum]   = useState(1);
  const [numPages,  setNumPages]  = useState(0);
  const [book,      setBook]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [rendering, setRendering] = useState(false);

  // null = cursor mode (default)
  const [activeTool,  setActiveTool]  = useState(null);
  const [activeColor, setActiveColor] = useState("#FFEB3B");
  const [fontSize,    setFontSize]    = useState(16);

  const [selWord,   setSelWord]   = useState("");
  const [popupPos,  setPopupPos]  = useState({ top: 0, left: 0 });
  const [showPopup, setShowPopup] = useState(false);

  const [panelOpen,    setPanelOpen]    = useState(false);
  const [panelType,    setPanelType]    = useState("meaning");
  const [panelContent, setPanelContent] = useState(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [lang,         setLang]         = useState("hi");

  const [toast, setToast] = useState(null);

  // ── load book + resume last page ─────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const { data: bookData, error } = await supabase
        .from("books").select("*").eq("id", id).single();
      if (error || !bookData) { console.error(error); return; }
      setBook(bookData);

      const { data: progress } = await supabase
        .from("reading_progress")
        .select("last_page")
        .eq("book_id", id)
        .maybeSingle();

      const startPage = progress?.last_page || 1;

      const loaded = await pdfjsLib.getDocument(bookData.file_url).promise;
      setPdf(loaded);
      setNumPages(loaded.numPages);
      setPageNum(startPage);

      if (!bookData.total_pages || bookData.total_pages === 0)
        await supabase.from("books").update({ total_pages: loaded.numPages }).eq("id", id);

      setLoading(false);
    }
    load();
  }, [id]);

  // ── save current page annotations ────────────────────────────────────────
  const saveAnnotations = useCallback(async (page) => {
    try {
      const ov = overlayRef.current;
      if (!ov) return;

      const canvasData = ov.toDataURL("image/png");

      // collect textboxes
      const boxes = textBoxesRef.current
        .filter(b => b && b.isConnected)
        .map(b => ({
          text:     b.innerText,
          html:     b.innerHTML,
          x:        parseFloat(b.style.left),
          y:        parseFloat(b.style.top),
          color:    b.style.color,
          fontSize: parseFloat(b.style.fontSize),
          width:    b.style.width  || "",
          height:   b.style.height || "",
        }))
        .filter(b => b.text.trim());

      await supabase.from("annotations").upsert([{
        book_id:     id,
        page_number: page,
        canvas_data: canvasData,
        textboxes:   boxes,
        updated_at:  new Date().toISOString(),
      }], { onConflict: "book_id,page_number" });
    } catch (err) {
      console.error("annotation save error:", err);
    }
  }, [id]);

  // ── load annotations for a page ──────────────────────────────────────────
  const loadAnnotations = useCallback(async (page) => {
    try {
      const { data } = await supabase
        .from("annotations")
        .select("canvas_data, textboxes")
        .eq("book_id", id)
        .eq("page_number", page)
        .maybeSingle();

      if (!data) return;

      // restore canvas drawing
      if (data.canvas_data && overlayRef.current) {
        const img = new Image();
        img.onload = () => {
          const ctx = overlayRef.current.getContext("2d");
          ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
          ctx.drawImage(img, 0, 0);
        };
        img.src = data.canvas_data;
      }

      // restore text boxes
      if (data.textboxes?.length && wrapRef.current) {
        data.textboxes.forEach(b => {
          const box = spawnTextBox(b.x, b.y, b.color, b.fontSize);
          box.innerHTML = b.html || b.text;
          if (b.width)  box.style.width  = b.width;
          if (b.height) box.style.height = b.height;
        });
      }
    } catch (err) {
      console.error("annotation load error:", err);
    }
  }, [id]);

  // ── render page then load saved annotations ───────────────────────────────
  useEffect(() => {
    if (!pdf) return;
    (async () => {
      setRendering(true);

      // clear old text boxes
      textBoxesRef.current = [];
      if (wrapRef.current)
        wrapRef.current.querySelectorAll("[data-textbox]").forEach(el => el.remove());

      const page     = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.6 });
      const c  = canvasRef.current;
      const ov = overlayRef.current;
      c.width  = ov.width  = viewport.width;
      c.height = ov.height = viewport.height;
      await page.render({ canvasContext: c.getContext("2d"), viewport }).promise;
      ctxRef.current = ov.getContext("2d");
      setRendering(false);

      // load saved annotations after render
      await loadAnnotations(pageNum);
    })();
  }, [pdf, pageNum, loadAnnotations]);

  // ── keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const fn = (e) => {
      if (e.target.dataset?.textbox === "true") return;
      if (e.target.contentEditable === "true")  return;

      if (e.key === "ArrowRight" || e.key === "ArrowDown")
        setPageNum(p => Math.min(numPages, p + 1));
      if (e.key === "ArrowLeft" || e.key === "ArrowUp")
        setPageNum(p => Math.max(1, p - 1));
      // Escape = drop tool back to cursor
      if (e.key === "Escape") {
        setActiveTool(null);
        setShowPopup(false);
        setPanelOpen(false);
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [numPages]);

  // ── drawing helpers ───────────────────────────────────────────────────────
  const getPos = (e) => {
    const r  = overlayRef.current.getBoundingClientRect();
    const sx = overlayRef.current.width  / r.width;
    const sy = overlayRef.current.height / r.height;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  };

  const startDraw = (e) => {
    if (!activeTool || activeTool === "text") return;
    drawingRef.current = true;
    lastPos.current    = getPos(e);
  };

  const doDraw = (e) => {
    if (!drawingRef.current || !activeTool || activeTool === "text") return;
    const ctx = ctxRef.current;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    if (activeTool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
      ctx.lineWidth   = 22;
      ctx.globalAlpha = 1;
    } else if (activeTool === "highlight") {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = activeColor;
      ctx.lineWidth   = 14;
      ctx.globalAlpha = 0.38;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = activeColor;
      ctx.lineWidth   = 2.5;
      ctx.globalAlpha = 1;
    }
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.stroke();
    lastPos.current = pos;
  };

  const stopDraw = () => {
    if (drawingRef.current) {
      drawingRef.current = false;
      // schedule save after drawing stops
      scheduleSave(() => saveAnnotations(pageNum));
    }
  };

  // ── spawn text box ────────────────────────────────────────────────────────
  const spawnTextBox = (x, y, color, fs) => {
    const box = document.createElement("div");
    box.contentEditable = "true";
    box.dataset.textbox = "true";
    Object.assign(box.style, {
      position:   "absolute",
      left:       x + "px",
      top:        y + "px",
      minWidth:   "120px",
      minHeight:  "34px",
      background: "rgba(0,0,0,0.12)",
      border:     "1.5px dashed rgba(124,106,247,.55)",
      color:      color,
      fontSize:   fs + "px",
      padding:    "5px 9px",
      outline:    "none",
      borderRadius: "5px",
      zIndex:     "15",
      fontFamily: "'DM Sans',sans-serif",
      cursor:     "text",
      userSelect: "text",
      lineHeight: "1.5",
      resize:     "both",
      overflow:   "auto",
      boxSizing:  "border-box",
      whiteSpace: "pre-wrap",
      wordBreak:  "break-word",
    });

    // drag from edge
    let dragging = false, ox = 0, oy = 0;
    box.addEventListener("mousedown", (e) => {
      const r    = box.getBoundingClientRect();
      const edge = 12;
      const onEdge =
        e.clientX < r.left + edge || e.clientX > r.right  - edge ||
        e.clientY < r.top  + edge || e.clientY > r.bottom - edge;
      if (!onEdge) return;
      e.preventDefault();
      dragging = true;
      ox = e.clientX - r.left;
      oy = e.clientY - r.top;
      box.style.cursor = "grabbing";
      const onMove = (ev) => {
        if (!dragging) return;
        const pr = wrapRef.current.getBoundingClientRect();
        box.style.left = (ev.clientX - pr.left - ox) + "px";
        box.style.top  = (ev.clientY - pr.top  - oy) + "px";
      };
      const onUp = () => {
        dragging = false;
        box.style.cursor = "text";
        scheduleSave(() => saveAnnotations(pageNum));
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup",   onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup",   onUp);
    });

    box.addEventListener("input",  () => scheduleSave(() => saveAnnotations(pageNum)));
    box.addEventListener("blur",   () => { if (!box.innerText.trim()) box.remove(); });
    box.addEventListener("focus",  () => { box.style.border = "1.5px solid #7c6af7"; });
    box.addEventListener("blur",   () => { box.style.border = "1.5px dashed rgba(124,106,247,.4)"; });

    wrapRef.current.appendChild(box);
    textBoxesRef.current.push(box);
    return box;
  };

  const handleCanvasClick = (e) => {
    if (activeTool !== "text") return;
    if (e.target.dataset?.textbox === "true") return;
    const r = wrapRef.current.getBoundingClientRect();
    const box = spawnTextBox(
      e.clientX - r.left,
      e.clientY - r.top,
      activeColor,
      fontSize
    );
    setTimeout(() => box.focus(), 0);
  };

  // ── word popup ────────────────────────────────────────────────────────────
  useEffect(() => {
    const onUp = () => {
      setTimeout(() => {
        const sel  = window.getSelection();
        const text = sel?.toString().trim();
        if (!text || text.length < 2) { setShowPopup(false); return; }
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        setSelWord(text);
        setPopupPos({
          top:  rect.top  + window.scrollY - 54,
          left: rect.left + rect.width / 2 + window.scrollX,
        });
        setShowPopup(true);
      }, 10);
    };
    const onDown = (e) => {
      if (!e.target.closest(".word-popup") && !e.target.closest(".side-panel"))
        setShowPopup(false);
    };
    document.addEventListener("mouseup",   onUp);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("mouseup",   onUp);
      document.removeEventListener("mousedown", onDown);
    };
  }, []);

  // ── meaning ───────────────────────────────────────────────────────────────
  const getMeaning = async () => {
    setShowPopup(false); setPanelType("meaning");
    setPanelOpen(true);  setPanelContent(null); setPanelLoading(true);
    try {
      const res  = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${selWord}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error();
      const info = data[0];
      setPanelContent({ word: info.word, phonetic: info.phonetic || info.phonetics?.[0]?.text || "", meanings: info.meanings });
    } catch { setPanelContent({ error: true }); }
    setPanelLoading(false);
  };

  // ── translate ─────────────────────────────────────────────────────────────
  const doTranslate = async (targetLang) => {
    setShowPopup(false); setPanelType("translate");
    setPanelOpen(true);  setPanelContent(null); setPanelLoading(true);
    try {
      const res  = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(selWord)}&langpair=en|${targetLang}`);
      const data = await res.json();
      setPanelContent({ original: selWord, translated: data.responseData.translatedText });
    } catch { setPanelContent({ error: true }); }
    setPanelLoading(false);
  };

  // ── save word ─────────────────────────────────────────────────────────────
  const saveWord = async () => {
    setShowPopup(false);
    try {
      const { data: ex } = await supabase
        .from("saved_words").select("id").eq("word", selWord).limit(1);
      if (ex?.length > 0) { showToast("Already in your notes", "info"); return; }

      let def = "";
      try {
        const res  = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${selWord}`);
        const data = await res.json();
        def = Array.isArray(data) ? data[0]?.meanings?.[0]?.definitions?.[0]?.definition || "" : "";
      } catch {}

      const { error } = await supabase.from("saved_words").insert([{
        word:        selWord,
        definition:  def,
        book_title:  book?.title || "",
        page_number: pageNum,
      }]);
      if (error) throw error;
      showToast("Word saved to notes!", "success");
    } catch (err) {
      console.error(err);
      showToast("Error saving word", "error");
    }
  };

  // ── save reading progress ─────────────────────────────────────────────────
  const saveProgress = async () => {
    try {
      const { error } = await supabase
        .from("reading_progress")
        .upsert([{ book_id: id, last_page: pageNum }], { onConflict: "book_id" });
      if (error) throw error;
      showToast(`Progress saved — page ${pageNum}`, "success");
    } catch (err) {
      console.error("progress save error:", err);
      showToast("Could not save progress", "error");
    }
  };

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  const cursorStyle =
    activeTool === "eraser"    ? "cell"      :
    activeTool === "text"      ? "crosshair" :
    activeTool === "highlight" ? "crosshair" :
    activeTool === "pen"       ? "crosshair" :
    "default";

  if (loading) return (
    <div style={{ height:"100vh", display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center", gap:16, background:"var(--bg-base)" }}>
      <div style={{ width:32, height:32, border:"2px solid var(--border)",
        borderTop:"2px solid var(--accent)", borderRadius:"50%",
        animation:"spin .8s linear infinite" }}/>
      <p style={{ fontSize:14, color:"var(--text-muted)" }}>Opening your book…</p>
    </div>
  );

  const progress = numPages > 0 ? (pageNum / numPages) * 100 : 0;

  return (
    <>
      <style>{`
        @keyframes spin         { to { transform: rotate(360deg); } }
        @keyframes fadeUp       { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes slideInRight { from { transform:translateX(320px); } to { transform:translateX(0); } }
        .tool-btn:hover  { background:var(--bg-card-hover) !important; }
        .nav-btn:hover:not(:disabled)   { background:var(--bg-card) !important; color:var(--text-primary) !important; border-color:var(--border-hover) !important; }
        .arrow-btn:hover:not(:disabled) { background:var(--bg-card-hover) !important; border-color:var(--accent-border) !important; color:var(--accent) !important; }
        .bm-btn:hover    { border-color:var(--accent-border) !important; color:var(--accent) !important; }
      `}</style>

      <div style={{ display:"flex", flexDirection:"column", height:"100vh",
        overflow:"hidden", background:"var(--bg-base)" }}>

        {/* ══ TOP BAR ══════════════════════════════════════════════════════ */}
        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 20px",
          background:"var(--bg-surface)", borderBottom:"1px solid var(--border)", flexShrink:0 }}>

          <Link to="/library"
            style={{ display:"flex", alignItems:"center", justifyContent:"center",
              width:34, height:34, borderRadius:8, border:"1px solid var(--border)",
              color:"var(--text-secondary)", textDecoration:"none", flexShrink:0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </Link>

          <span style={{ flex:1, fontFamily:"'Playfair Display',serif", fontSize:16, fontWeight:500,
            color:"var(--text-primary)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {book?.title}
          </span>

          {/* page nav */}
          <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
            <button className="nav-btn"
              onClick={() => setPageNum(p => Math.max(1, p-1))} disabled={pageNum <= 1}
              style={{ width:32, height:32, borderRadius:8, border:"1px solid var(--border)",
                background:"transparent", color:"var(--text-secondary)", cursor:"pointer",
                display:"flex", alignItems:"center", justifyContent:"center", transition:"all .15s" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            <span style={{ fontSize:13, color:"var(--text-secondary)", userSelect:"none",
              fontVariantNumeric:"tabular-nums", minWidth:64, textAlign:"center" }}>
              <span style={{ color:"var(--text-primary)", fontWeight:500 }}>{pageNum}</span>
              <span style={{ color:"var(--text-muted)" }}> / {numPages}</span>
            </span>
            <button className="nav-btn"
              onClick={() => setPageNum(p => Math.min(numPages, p+1))} disabled={pageNum >= numPages}
              style={{ width:32, height:32, borderRadius:8, border:"1px solid var(--border)",
                background:"transparent", color:"var(--text-secondary)", cursor:"pointer",
                display:"flex", alignItems:"center", justifyContent:"center", transition:"all .15s" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          </div>

          <button className="bm-btn" onClick={saveProgress}
            style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 14px",
              borderRadius:8, border:"1px solid var(--border-hover)", background:"transparent",
              color:"var(--text-secondary)", fontSize:13, cursor:"pointer",
              flexShrink:0, transition:"all .15s" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
            Save progress
          </button>
        </div>

        {/* ══ TOOLBAR ══════════════════════════════════════════════════════ */}
        <div style={{ display:"flex", alignItems:"center", gap:4, padding:"8px 20px",
          background:"var(--bg-surface)", borderBottom:"1px solid var(--border)",
          flexShrink:0, flexWrap:"wrap" }}>

          {/* cursor button */}
          <button className="tool-btn" title="Cursor (Esc)"
            onClick={() => setActiveTool(null)}
            style={{ width:34, height:34, borderRadius:8, cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center", transition:"all .15s",
              border:     activeTool === null ? "1px solid rgba(124,106,247,.4)" : "1px solid transparent",
              background: activeTool === null ? "rgba(124,106,247,.15)" : "transparent",
              color:      activeTool === null ? "#7c6af7" : "var(--text-secondary)" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M5 3l14 9-7 1-4 7z"/>
            </svg>
          </button>

          <div style={{ width:1, height:22, background:"var(--border)", margin:"0 2px", flexShrink:0 }}/>

          {TOOLS.map(t => (
            <button key={t.id} className="tool-btn" title={t.label}
              onClick={() => setActiveTool(t.id)}
              style={{ width:34, height:34, borderRadius:8, cursor:"pointer",
                display:"flex", alignItems:"center", justifyContent:"center", transition:"all .15s",
                border:     activeTool === t.id ? "1px solid rgba(124,106,247,.4)" : "1px solid transparent",
                background: activeTool === t.id ? "rgba(124,106,247,.15)" : "transparent",
                color:      activeTool === t.id ? "#7c6af7" : "var(--text-secondary)" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                {t.id === "highlight" && <><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></>}
                {t.id === "pen"       && <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>}
                {t.id === "eraser"    && <><path d="M20 20H7L3 16l10-10 7 7-3.5 3.5"/><path d="M6.5 17.5l4-4"/></>}
                {t.id === "text"      && <><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></>}
              </svg>
            </button>
          ))}

          <div style={{ width:1, height:22, background:"var(--border)", margin:"0 4px", flexShrink:0 }}/>

          {/* color swatches */}
          {COLORS.map(c => (
            <div key={c.hex} title={c.label} onClick={() => setActiveColor(c.hex)}
              style={{ width:18, height:18, borderRadius:"50%", cursor:"pointer",
                background: c.hex, flexShrink:0, transition:"all .15s",
                border:    activeColor === c.hex ? "2.5px solid white" : "2px solid rgba(255,255,255,.15)",
                transform: activeColor === c.hex ? "scale(1.25)" : "scale(1)",
                boxShadow: c.hex === "#FFFFFF" ? "inset 0 0 0 1px rgba(0,0,0,.3)" : "none" }}/>
          ))}

          {/* font size — only when text tool active */}
          {activeTool === "text" && (
            <>
              <div style={{ width:1, height:22, background:"var(--border)", margin:"0 6px", flexShrink:0 }}/>
              <span style={{ fontSize:12, color:"var(--text-muted)", flexShrink:0 }}>Size</span>
              <input type="range" min="10" max="48" value={fontSize}
                onChange={e => setFontSize(Number(e.target.value))}
                style={{ width:80, accentColor:"var(--accent)" }}/>
              <span style={{ fontSize:12, color:"var(--text-secondary)", minWidth:28, flexShrink:0 }}>
                {fontSize}px
              </span>
            </>
          )}

          <span style={{ marginLeft:"auto", fontSize:11, color:"var(--text-muted)",
            padding:"4px 10px", borderRadius:20, border:"1px solid var(--border)", flexShrink:0 }}>
            Select text → meaning / translate / save
          </span>
        </div>

        {/* ══ BODY ═════════════════════════════════════════════════════════ */}
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
          gap:20, overflow:"hidden", padding:"24px", position:"relative" }}>

          {/* left arrow */}
          <button className="arrow-btn"
            onClick={() => setPageNum(p => Math.max(1, p-1))} disabled={pageNum <= 1}
            style={{ width:44, height:44, borderRadius:"50%", border:"1px solid var(--border-hover)",
              background:"var(--bg-card)", color:"var(--text-secondary)", cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center",
              flexShrink:0, transition:"all .15s", opacity: pageNum <= 1 ? 0.2 : 1 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>

          {/* canvas wrapper */}
          <div ref={wrapRef} onClick={handleCanvasClick}
            style={{ position:"relative", boxShadow:"0 8px 60px rgba(0,0,0,.7)",
              borderRadius:4, display:"inline-flex", flexShrink:0,
              maxHeight:"calc(100vh - 182px)" }}>

            {rendering && (
              <div style={{ position:"absolute", inset:0, background:"rgba(13,10,26,.75)",
                display:"flex", alignItems:"center", justifyContent:"center",
                zIndex:5, borderRadius:4 }}>
                <div style={{ width:22, height:22, border:"2px solid var(--border)",
                  borderTop:"2px solid var(--accent)", borderRadius:"50%",
                  animation:"spin .8s linear infinite" }}/>
              </div>
            )}

            <canvas ref={canvasRef}
              style={{ display:"block", maxHeight:"calc(100vh - 182px)", borderRadius:4 }}/>

            <canvas ref={overlayRef}
              style={{ position:"absolute", inset:0, borderRadius:4, cursor: cursorStyle }}
              onMouseDown={startDraw}
              onMouseMove={doDraw}
              onMouseUp={stopDraw}
              onMouseLeave={stopDraw}/>
          </div>

          {/* right arrow */}
          <button className="arrow-btn"
            onClick={() => setPageNum(p => Math.min(numPages, p+1))} disabled={pageNum >= numPages}
            style={{ width:44, height:44, borderRadius:"50%", border:"1px solid var(--border-hover)",
              background:"var(--bg-card)", color:"var(--text-secondary)", cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center",
              flexShrink:0, transition:"all .15s", opacity: pageNum >= numPages ? 0.2 : 1 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>

          {/* ── SIDE PANEL ──────────────────────────────────────────────── */}
          {panelOpen && (
            <div className="side-panel"
              style={{ position:"absolute", right:0, top:0, bottom:0, width:320,
                background:"var(--bg-card)", borderLeft:"1px solid var(--border-hover)",
                display:"flex", flexDirection:"column", zIndex:20,
                animation:"slideInRight .25s ease" }}>

              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                padding:"16px 18px", borderBottom:"1px solid var(--border)", flexShrink:0 }}>
                <span style={{ fontFamily:"'Playfair Display',serif", fontSize:16,
                  fontWeight:500, color:"var(--text-primary)" }}>
                  {panelType === "meaning" ? "Definition" : "Translation"}
                </span>
                <button onClick={() => setPanelOpen(false)}
                  style={{ width:28, height:28, borderRadius:6, border:"1px solid var(--border)",
                    background:"transparent", color:"var(--text-secondary)", cursor:"pointer",
                    display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6"  y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>

              <div style={{ flex:1, overflowY:"auto", padding:"20px 18px" }}>
                {panelLoading && (
                  <div style={{ display:"flex", justifyContent:"center", padding:"40px 0" }}>
                    <div style={{ width:22, height:22, border:"2px solid var(--border)",
                      borderTop:"2px solid var(--accent)", borderRadius:"50%",
                      animation:"spin .8s linear infinite" }}/>
                  </div>
                )}

                {!panelLoading && panelContent?.error && (
                  <p style={{ color:"var(--text-muted)", fontSize:14, textAlign:"center", paddingTop:40 }}>
                    {panelType === "meaning" ? "Definition not found." : "Translation failed."}
                  </p>
                )}

                {!panelLoading && panelType === "meaning" && panelContent && !panelContent.error && (
                  <>
                    <p style={{ fontFamily:"'Playfair Display',serif", fontSize:28,
                      fontWeight:500, color:"var(--text-primary)", marginBottom:4 }}>
                      {panelContent.word}
                    </p>
                    {panelContent.phonetic && (
                      <p style={{ fontSize:13, color:"var(--text-muted)", marginBottom:16 }}>
                        {panelContent.phonetic}
                      </p>
                    )}
                    {panelContent.meanings?.map((m, i) => (
                      <div key={i} style={{ marginBottom:16 }}>
                        <span style={{ display:"inline-block", fontSize:11, padding:"3px 10px",
                          borderRadius:20, background:"rgba(124,106,247,.15)", color:"#a78bf6",
                          border:"1px solid rgba(124,106,247,.25)", marginBottom:10, fontWeight:500 }}>
                          {m.partOfSpeech}
                        </span>
                        {m.definitions.slice(0,2).map((d, j) => (
                          <div key={j} style={{ marginBottom:10 }}>
                            <p style={{ fontSize:14, color:"var(--text-secondary)", lineHeight:1.65 }}>{d.definition}</p>
                            {d.example && (
                              <p style={{ fontSize:13, color:"var(--text-muted)", fontStyle:"italic",
                                marginTop:6, paddingLeft:12, borderLeft:"2px solid var(--border-hover)" }}>
                                "{d.example}"
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                    <button onClick={saveWord}
                      style={{ width:"100%", padding:"9px 0", borderRadius:8, cursor:"pointer",
                        background:"rgba(124,106,247,.15)", border:"1px solid rgba(124,106,247,.3)",
                        color:"#a78bf6", fontSize:13, marginTop:16 }}>
                      Save to notes
                    </button>
                  </>
                )}

                {!panelLoading && panelType === "translate" && panelContent && !panelContent.error && (
                  <>
                    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:20 }}>
                      <span style={{ fontSize:13, color:"var(--text-secondary)", flexShrink:0 }}>Translate to:</span>
                      <select value={lang}
                        onChange={e => { setLang(e.target.value); doTranslate(e.target.value); }}
                        style={{ flex:1, padding:"7px 10px", borderRadius:8,
                          border:"1px solid var(--border-hover)", background:"var(--bg-input)",
                          color:"var(--text-primary)", fontSize:13, cursor:"pointer" }}>
                        {LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                      </select>
                    </div>
                    <p style={{ fontFamily:"'Playfair Display',serif", fontSize:22,
                      color:"var(--text-secondary)", marginBottom:8 }}>
                      {panelContent.original}
                    </p>
                    <p style={{ fontSize:20, color:"var(--text-muted)", marginBottom:8 }}>↓</p>
                    <p style={{ fontFamily:"'Playfair Display',serif", fontSize:28,
                      fontWeight:500, color:"var(--text-primary)", lineHeight:1.3 }}>
                      {panelContent.translated}
                    </p>
                    <button onClick={saveWord}
                      style={{ width:"100%", padding:"9px 0", borderRadius:8, cursor:"pointer", marginTop:20,
                        background:"rgba(228,185,106,.12)", border:"1px solid rgba(228,185,106,.3)",
                        color:"#e4b96a", fontSize:13 }}>
                      Save word to notes
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ══ PROGRESS BAR ═════════════════════════════════════════════════ */}
        <div style={{ height:2, background:"var(--border)", flexShrink:0 }}>
          <div style={{ height:"100%", background:"var(--accent)",
            width:`${progress}%`, transition:"width .3s ease", borderRadius:"0 1px 1px 0" }}/>
        </div>
      </div>

      {/* ══ WORD POPUP ═══════════════════════════════════════════════════════ */}
      {showPopup && (
        <div className="word-popup"
          style={{ position:"absolute", top:popupPos.top, left:popupPos.left,
            transform:"translateX(-50%)", background:"var(--bg-card)",
            border:"1px solid var(--border-hover)", borderRadius:12, padding:6,
            display:"flex", gap:4, zIndex:100,
            boxShadow:"0 8px 32px rgba(0,0,0,.6)", animation:"fadeUp .15s ease" }}>
          <button onClick={getMeaning}
            style={{ padding:"7px 13px", borderRadius:8, border:"none", fontSize:12,
              fontWeight:500, cursor:"pointer", background:"rgba(124,106,247,.2)", color:"#a78bf6" }}>
            Meaning
          </button>
          <button onClick={() => doTranslate(lang)}
            style={{ padding:"7px 13px", borderRadius:8, border:"none", fontSize:12,
              fontWeight:500, cursor:"pointer", background:"rgba(228,185,106,.15)", color:"#e4b96a" }}>
            Translate
          </button>
          <button onClick={saveWord}
            style={{ padding:"7px 13px", borderRadius:8, fontSize:12, fontWeight:500,
              cursor:"pointer", background:"var(--bg-surface)",
              border:"1px solid var(--border-hover)", color:"var(--text-secondary)" }}>
            Save
          </button>
          <div style={{ position:"absolute", bottom:-6, left:"50%",
            transform:"translateX(-50%) rotate(45deg)", width:10, height:10,
            background:"var(--bg-card)", border:"1px solid var(--border-hover)",
            borderTop:"none", borderLeft:"none" }}/>
        </div>
      )}

      {/* ══ TOAST ════════════════════════════════════════════════════════════ */}
      {toast && (
        <div style={{ position:"fixed", bottom:28, right:28, background:"var(--bg-card)",
          border:"1px solid var(--border-hover)", borderRadius:12, padding:"13px 20px",
          fontSize:14, color:"var(--text-primary)", zIndex:300,
          boxShadow:"0 4px 32px rgba(0,0,0,.5)", animation:"fadeUp .2s ease",
          borderLeft:`3px solid ${toast.type==="success"?"#4ade80":toast.type==="error"?"#f87171":"#7c6af7"}` }}>
          {toast.msg}
        </div>
      )}
    </>
  );
}