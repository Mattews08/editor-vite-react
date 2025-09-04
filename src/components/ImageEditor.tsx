import React, { useEffect, useRef, useState } from "react";

type Tool = "pencil" | "eraser" | "line" | "rect" | "ellipse" | "polygon" | "arrow" | "crop";
type FillMode = "stroke" | "fill" | "both";

const PALETTE = [
  "#000000", "#ffffff", "#7f7f7f", "#c00000", "#ff0000", "#ffc000", "#ffff00",
  "#92d050", "#00b050", "#00b0f0", "#0070c0", "#002060", "#7030a0",
  "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#cfe2f3", "#d9d2e9", "#ead1dc"
];

export function ImageEditor({
  file,
  onSave,
  onCancel,
}: {
  file: File;
  onSave: (dataUrl: string, caption: string) => void;
  onCancel: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);

  // ferramentas/estilo
  const [tool, setTool] = useState<Tool>("pencil");
  const [thickness, setThickness] = useState(6);
  const [fillMode, setFillMode] = useState<FillMode>("stroke");
  const [primary, setPrimary] = useState("#000000");
  const [secondary, setSecondary] = useState("#ffffff");
  const [activeColorSlot, setActiveColorSlot] = useState<"primary" | "secondary">("primary");

  // legenda
  const [caption, setCaption] = useState("");

  // desenho livre
  const [isDrawing, setIsDrawing] = useState(false);
  const [last, setLast] = useState<{ x: number; y: number } | null>(null);

  // formas
  const snapshotRef = useRef<ImageData | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [polyPoints, setPolyPoints] = useState<Array<{ x: number; y: number }>>([]);

  // crop
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [isCropping, setIsCropping] = useState(false);

  // histórico
  const undoStack = useRef<ImageData[]>([]);
  const redoStack = useRef<ImageData[]>([]);

  /* ====== carregar imagem ====== */
  useEffect(() => {
    setImg(null);
    setImgError(null);
    setCaption("");
    try {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => { setImg(im); URL.revokeObjectURL(url); };
      im.onerror = () => { setImgError("Falha ao carregar a imagem."); URL.revokeObjectURL(url); };
      im.src = url;
    } catch (e) {
      console.error(e);
      setImgError("Erro ao preparar a imagem.");
    }
  }, [file]);

  /* ====== fundo + imagem ====== */
  const drawBackground = (g: CanvasRenderingContext2D, W: number, H: number) => {
    g.fillStyle = "#f4f6fb";
    g.fillRect(0, 0, W, H);
    g.fillStyle = "#e5e8f0";
    for (let y = 0; y < H; y += 16)
      for (let x = 0; x < W; x += 16)
        if (((x + y) / 16) % 2 === 0) g.fillRect(x, y, 16, 16);
  };

  const resizeAndDraw = () => {
    const canvas = canvasRef.current;
    const g = canvas?.getContext("2d");
    const wrap = wrapRef.current;
    if (!canvas || !g || !wrap) return;

    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(320, wrap.clientWidth || 800);
    const H = Math.max(300, (wrap.clientHeight || 600) - 100); // deixa espaço pra barra + legenda

    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.scale(dpr, dpr);

    drawBackground(g, W, H);

    if (img) {
      const s = Math.min(W / img.width, H / img.height);
      const dw = Math.round(img.width * s);
      const dh = Math.round(img.height * s);
      const dx = Math.floor((W - dw) / 2);
      const dy = Math.floor((H - dh) / 2);
      g.drawImage(img, dx, dy, dw, dh);
    } else {
      g.fillStyle = "#5b8cff";
      g.font = "14px ui-sans-serif, system-ui, Arial";
      g.fillText("Carregando imagem…", 16, 24);
    }
  };

  useEffect(() => { resizeAndDraw(); }, [img]);
  useEffect(() => {
    resizeAndDraw();
    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(resizeAndDraw);
      if (wrapRef.current) ro.observe(wrapRef.current);
    } catch {
      window.addEventListener("resize", resizeAndDraw);
    }
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", resizeAndDraw);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ====== helpers ====== */
  const ctx = () => canvasRef.current!.getContext("2d")!;
  const pushUndo = () => {
    const c = canvasRef.current!;
    const g = ctx();
    const snap = g.getImageData(0, 0, c.width, c.height);
    undoStack.current.push(snap);
    if (undoStack.current.length > 40) undoStack.current.shift();
  };
  const restoreSnapshot = () => { if (snapshotRef.current) ctx().putImageData(snapshotRef.current, 0, 0); };
  const strokeFillStyles = (g: CanvasRenderingContext2D) => {
    g.lineWidth = thickness; g.lineCap = "round"; g.lineJoin = "round";
    g.strokeStyle = primary; g.fillStyle = secondary;
  };
  const getXY = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  /* ====== desenho livre ====== */
  const beginFree = (x: number, y: number, pid: number) => {
    const c = canvasRef.current!;
    c.setPointerCapture(pid);
    setIsDrawing(true); redoStack.current = []; pushUndo(); setLast({ x, y });
  };
  const drawFree = (x: number, y: number) => {
    if (!isDrawing || !last) return;
    const g = ctx();
    g.save(); g.beginPath(); g.moveTo(last.x, last.y); g.lineTo(x, y);
    g.lineWidth = thickness; g.lineCap = "round"; g.lineJoin = "round";
    if (tool === "eraser") { g.globalCompositeOperation = "destination-out"; g.strokeStyle = "rgba(0,0,0,1)"; }
    else { g.globalCompositeOperation = "source-over"; g.strokeStyle = primary; }
    g.stroke(); g.restore();
    setLast({ x, y });
  };
  const endFree = (pid: number) => { setIsDrawing(false); setLast(null); try { canvasRef.current!.releasePointerCapture(pid); } catch { } };

  /* ====== shapes ====== */
  const beginShape = (x: number, y: number) => {
    const g = ctx(); const c = canvasRef.current!;
    snapshotRef.current = g.getImageData(0, 0, c.width, c.height);
    startRef.current = { x, y };
  };
  const previewShape = (x: number, y: number) => {
    if (!startRef.current) return;
    const g = ctx(); restoreSnapshot(); g.save(); strokeFillStyles(g);
    switch (tool) {
      case "line": g.beginPath(); g.moveTo(startRef.current.x, startRef.current.y); g.lineTo(x, y); g.stroke(); break;
      case "rect": drawRect(g, startRef.current.x, startRef.current.y, x - startRef.current.x, y - startRef.current.y, fillMode); break;
      case "ellipse": drawEllipse(g, startRef.current.x, startRef.current.y, x - startRef.current.x, y - startRef.current.y, fillMode); break;
      case "arrow": drawArrow(g, startRef.current.x, startRef.current.y, x, y, primary, secondary); break;
    }
    g.restore();
  };
  const commitShape = () => { if (!startRef.current || !snapshotRef.current) return; pushUndo(); snapshotRef.current = null; startRef.current = null; };

  /* ====== polígono ====== */
  const handlePolygonClick = (x: number, y: number) => {
    if (polyPoints.length === 0) {
      const g = ctx(); const c = canvasRef.current!;
      snapshotRef.current = g.getImageData(0, 0, c.width, c.height);
      pushUndo();
    }
    setPolyPoints(p => [...p, { x, y }]);
  };
  const previewPolygon = (x: number, y: number) => {
    if (polyPoints.length === 0 || !snapshotRef.current) return;
    const g = ctx(); restoreSnapshot(); g.save(); strokeFillStyles(g);
    g.beginPath(); g.moveTo(polyPoints[0].x, polyPoints[0].y);
    for (let i = 1; i < polyPoints.length; i++) g.lineTo(polyPoints[i].x, polyPoints[i].y);
    g.lineTo(x, y);
    if (fillMode !== "stroke") g.fill();
    if (fillMode !== "fill") g.stroke();
    g.restore();
  };
  const finalizePolygon = () => {
    if (polyPoints.length < 2 || !snapshotRef.current) { setPolyPoints([]); snapshotRef.current = null; return; }
    const g = ctx(); restoreSnapshot(); g.save(); strokeFillStyles(g);
    g.beginPath(); g.moveTo(polyPoints[0].x, polyPoints[0].y);
    for (let i = 1; i < polyPoints.length; i++) g.lineTo(polyPoints[i].x, polyPoints[i].y);
    g.closePath();
    if (fillMode !== "stroke") g.fill();
    if (fillMode !== "fill") g.stroke();
    g.restore();
    setPolyPoints([]); snapshotRef.current = null;
  };

  /* ====== crop ====== */
  const beginCrop = (x: number, y: number) => {
    setIsCropping(true);
    setCropRect({ x, y, w: 0, h: 0 });
  };
  const updateCrop = (x: number, y: number) => {
    setCropRect((r) => (r ? { ...r, w: x - r.x, h: y - r.y } : r));
  };
  const finishCropDrag = () => { setIsCropping(false); };
  const applyCrop = () => {
    if (!cropRect) return;
    const { x, y, w, h } = normalizeRect(cropRect);
    if (w < 2 || h < 2) { setCropRect(null); return; }

    const dpr = window.devicePixelRatio || 1;
    const c = canvasRef.current!;
    const srcX = Math.round(x * dpr), srcY = Math.round(y * dpr);
    const srcW = Math.round(w * dpr), srcH = Math.round(h * dpr);

    // recorta pixels atuais do canvas
    const off = document.createElement("canvas");
    off.width = srcW; off.height = srcH;
    const og = off.getContext("2d")!;
    og.drawImage(c, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

    // cria nova imagem e vira "img" -> editor recalcula e centraliza
    const cropped = new Image();
    cropped.onload = () => {
      setImg(cropped);
      setCropRect(null);
      // limpa histórico após cortar (novo estado base)
      undoStack.current = [];
      redoStack.current = [];
      resizeAndDraw();
    };
    cropped.src = off.toDataURL("image/png");
  };
  const cancelCrop = () => setCropRect(null);

  /* ====== eventos pointer ====== */
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = getXY(e);
    if (tool === "crop") return beginCrop(x, y);
    if (tool === "pencil" || tool === "eraser") return beginFree(x, y, e.pointerId);
    if (tool === "polygon") return handlePolygonClick(x, y);
    beginShape(x, y);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = getXY(e);
    if (tool === "crop") return isCropping ? updateCrop(x, y) : undefined;
    if (tool === "pencil" || tool === "eraser") return drawFree(x, y);
    if (tool === "polygon") return previewPolygon(x, y);
    if (startRef.current) return previewShape(x, y);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === "crop") return finishCropDrag();
    if (tool === "pencil" || tool === "eraser") return endFree(e.pointerId);
    if (tool === "polygon") return;
    commitShape();
  };

  // atalhos do polígono
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" && tool === "polygon") finalizePolygon();
      if (ev.key === "Escape" && tool === "polygon") { setPolyPoints([]); snapshotRef.current = null; resizeAndDraw(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, polyPoints.length]);

  /* ====== ações ====== */
  const undo = () => {
    if (undoStack.current.length <= 0) return;
    const g = ctx(); const c = canvasRef.current!;
    const current = g.getImageData(0, 0, c.width, c.height);
    const prev = undoStack.current.pop()!;
    redoStack.current.push(current);
    g.putImageData(prev, 0, 0);
  };
  const redo = () => {
    if (redoStack.current.length <= 0) return;
    const g = ctx(); const c = canvasRef.current!;
    const next = redoStack.current.pop()!;
    undoStack.current.push(g.getImageData(0, 0, c.width, c.height));
    g.putImageData(next, 0, 0);
  };
  const clearAll = () => { pushUndo(); resizeAndDraw(); };
  const save = () => { onSave(canvasRef.current!.toDataURL("image/png"), caption); };
  const swapColors = () => setPrimary((p) => { const s = secondary; setSecondary(p); return s; });

  const thicknessSwatches = [2, 4, 6, 10, 14, 18];

  // rect normalizado (para w/h negativos)
  const normalizeRect = (r: { x: number; y: number; w: number; h: number }) => {
    const rx = r.w < 0 ? r.x + r.w : r.x;
    const ry = r.h < 0 ? r.y + r.h : r.y;
    return { x: rx, y: ry, w: Math.abs(r.w), h: Math.abs(r.h) };
  };

  return (
    <div className="editor" ref={wrapRef}>
      <div className="editor-toolbar">
        {/* Ferramentas */}
        <div className="tool-group" title="Ferramentas">
          <button className={tool === "pencil" ? "active" : ""} onClick={() => setTool("pencil")} aria-label="Lápis">✏️</button>
          <button className={tool === "eraser" ? "active" : ""} onClick={() => setTool("eraser")} aria-label="Borracha">🧽</button>
          <button className={tool === "line" ? "active" : ""} onClick={() => setTool("line")} aria-label="Linha">／</button>
          <button className={tool === "rect" ? "active" : ""} onClick={() => setTool("rect")} aria-label="Retângulo">▭</button>
          <button className={tool === "ellipse" ? "active" : ""} onClick={() => setTool("ellipse")} aria-label="Elipse">◯</button>
          <button className={tool === "polygon" ? "active" : ""} onClick={() => setTool("polygon")} aria-label="Polígono">⬠</button>
          <button className={tool === "arrow" ? "active" : ""} onClick={() => setTool("arrow")} aria-label="Seta">➜</button>
          <button className={tool === "crop" ? "active" : ""} onClick={() => setTool("crop")} aria-label="Cortar">✂️</button>
        </div>

        {/* Espessura */}
        <div className="tool-group" title="Espessura">
          {thicknessSwatches.map(n => (
            <button key={n}
              className={`thick ${thickness === n ? "active" : ""}`}
              onClick={() => setThickness(n)}>
              <span style={{ display: "inline-block", width: 28, height: n, borderRadius: 8, background: "#e6e7ea" }} />
            </button>
          ))}
          <label className="range">
            <input type="range" min={1} max={40} value={thickness}
              onChange={(e) => setThickness(parseInt(e.target.value, 10))} />
            <span>{thickness}px</span>
          </label>
        </div>

        {/* Estilo */}
        <div className="tool-group" title="Estilo">
          <select value={fillMode} onChange={(e) => setFillMode(e.target.value as FillMode)}>
            <option value="stroke">Contorno</option>
            <option value="fill">Preenchido</option>
            <option value="both">Ambos</option>
          </select>
        </div>

        <div className="spacer" />

        {/* Cores */}
        <div className="tool-group colors">
          <div className="color-pairs">
            <div className={`color-card ${activeColorSlot === "primary" ? "sel" : ""}`} onClick={() => setActiveColorSlot("primary")}>
              <div className="swatch" style={{ background: primary }} />
              <small>Cor 1</small>
              <input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} />
            </div>
            <div className={`color-card ${activeColorSlot === "secondary" ? "sel" : ""}`} onClick={() => setActiveColorSlot("secondary")}>
              <div className="swatch" style={{ background: secondary }} />
              <small>Cor 2</small>
              <input type="color" value={secondary} onChange={(e) => setSecondary(e.target.value)} />
            </div>
            <button className="swap" onClick={swapColors} title="Trocar cores">⇄</button>
          </div>

          <div className="palette">
            {PALETTE.map((c, i) => (
              <button key={i} className="pal" onClick={() => (activeColorSlot === "primary" ? setPrimary(c) : setSecondary(c))}>
                <span style={{ background: c }} />
              </button>
            ))}
          </div>
        </div>

        <div className="spacer" />

        {/* Ações de edição */}
        <button onClick={undo} title="Desfazer">↩️</button>
        <button onClick={redo} title="Refazer">↪️</button>
        <button onClick={clearAll} title="Limpar">🧹</button>

        {/* Ações de corte quando existe seleção */}
        {cropRect && tool === "crop" && (
          <div className="tool-group" title="Corte">
            <button className="primary" onClick={applyCrop}>Aplicar corte</button>
            <button onClick={cancelCrop}>Cancelar</button>
          </div>
        )}

        <div className="sep" />
        <button className="primary" onClick={save}>💾 Salvar</button>
        <button onClick={onCancel}>✖️ Cancelar</button>
      </div>

      <div className="editor-canvas-wrap" style={{ position: "relative" }}>
        {imgError && <div style={{ position: "absolute", zIndex: 2, color: "#ff7676", padding: "8px" }}>{imgError}</div>}

        {/* Canvas */}
        <canvas
          ref={canvasRef}
          className="editor-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={() => { if (tool === "polygon") finalizePolygon(); }}
          style={{ border: "1px solid var(--border)" }}
        />

        {/* Overlay de recorte */}
        {cropRect && tool === "crop" && (
          <CropOverlay rect={cropRect} />
        )}
      </div>
      <div style={{ padding: "10px", background: "var(--panel)", borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Legenda (opcional)…"
          style={{
            flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)",
            background: "#20232c", color: "var(--text)"
          }}
        />
      </div>
    </div>
  );
}

/* ======= Overlay visual do recorte ======= */
function CropOverlay({ rect }: { rect: { x: number; y: number; w: number; h: number } }) {
  const { x, y, w, h } = rect;
  const n = {
    x: w < 0 ? x + w : x,
    y: h < 0 ? y + h : y,
    w: Math.abs(w),
    h: Math.abs(h),
  };
  return (
    <div
      style={{
        position: "absolute",
        left: n.x, top: n.y, width: n.w, height: n.h,
        outline: "2px dashed #5b8cff",
        boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)",
        pointerEvents: "none",
      }}
    />
  );
}

/* ======= helpers shapes ======= */
function drawRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, mode: FillMode) {
  const rx = w < 0 ? x + w : x;
  const ry = h < 0 ? y + h : y;
  const rw = Math.abs(w);
  const rh = Math.abs(h);
  if (mode === "fill" || mode === "both") g.fillRect(rx, ry, rw, rh);
  if (mode === "stroke" || mode === "both") { g.beginPath(); g.rect(rx, ry, rw, rh); g.stroke(); }
}
function drawEllipse(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, mode: FillMode) {
  g.beginPath();
  g.ellipse(x + w / 2, y + h / 2, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
  if (mode === "fill" || mode === "both") g.fill();
  if (mode === "stroke" || mode === "both") g.stroke();
}
function drawArrow(g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, stroke: string, fill: string) {
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  const dx = x2 - x1, dy = y2 - y1, ang = Math.atan2(dy, dx);
  const len = Math.max(18, g.lineWidth * 3);
  const a1 = ang + Math.PI - Math.PI / 7, a2 = ang + Math.PI + Math.PI / 7;
  const x3 = x2 + Math.cos(a1) * len, y3 = y2 + Math.sin(a1) * len;
  const x4 = x2 + Math.cos(a2) * len, y4 = y2 + Math.sin(a2) * len;
  g.save();
  g.beginPath(); g.moveTo(x2, y2); g.lineTo(x3, y3); g.lineTo(x4, y4); g.closePath();
  g.fillStyle = fill; g.fill();
  g.strokeStyle = stroke; g.stroke();
  g.restore();
}
