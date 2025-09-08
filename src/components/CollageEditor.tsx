import React, { useEffect, useRef, useState } from "react";

type Tool = "pencil" | "eraser" | "line" | "rect" | "ellipse" | "polygon" | "arrow" | "crop" | "move";
type FillMode = "stroke" | "fill" | "both";
type StrokeKind = "solid" | "dashed";
type Vec2 = { x: number; y: number };

type DrawBase = {
  id: string;
  kind: "path" | "line" | "rect" | "ellipse" | "polygon" | "arrow";
  stroke: string;
  fill: string;
  fillMode: FillMode;
  thickness: number;
  dashed: boolean;
  selected?: boolean;
  [k: string]: any; // p/ borracha etc
};
type PathObj = DrawBase & { kind: "path"; points: Vec2[] };
type LineObj = DrawBase & { kind: "line"; a: Vec2; b: Vec2 };
type RectObj = DrawBase & { kind: "rect"; a: Vec2; b: Vec2 };
type EllipseObj = DrawBase & { kind: "ellipse"; a: Vec2; b: Vec2 };
type PolyObj = DrawBase & { kind: "polygon"; points: Vec2[] };
type ArrowObj = DrawBase & { kind: "arrow"; a: Vec2; b: Vec2 };
type DrawObj = PathObj | LineObj | RectObj | EllipseObj | PolyObj | ArrowObj;

type ImgLayer = {
  id: string;
  img: HTMLImageElement;
  x: number; y: number; w: number; h: number;
  crop?: { x: number; y: number; w: number; h: number };
  selected?: boolean;
};

const PALETTE = [
  "#000000", "#ffffff", "#7f7f7f", "#c00000", "#ff0000", "#ffc000", "#ffff00",
  "#92d050", "#00b050", "#00b0f0", "#0070c0", "#002060", "#7030a0",
  "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#cfe2f3", "#d9d2e9", "#ead1dc"
];

export function CollageEditor({
  file,
  initialSrc,
  initialProject,
  onSave,
  onCancel,
}: {
  file?: File;                // novo arquivo para editar
  initialSrc?: string;        // reabrir só o PNG (sem projeto)
  initialProject?: string;    // reabrir com projeto JSON (volta editável!)
  onSave: (dataUrl: string, caption: string, projectJson: string) => void;
  onCancel: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // viewport
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const panningRef = useRef(false);
  const panLastRef = useRef({ x: 0, y: 0 });

  // estilo
  const [tool, setTool] = useState<Tool>("pencil");
  const [thickness, setThickness] = useState(6);
  const [fillMode, setFillMode] = useState<FillMode>("stroke");
  const [primary, setPrimary] = useState("#000000");
  const [secondary, setSecondary] = useState("#ffffff");
  const [activeColorSlot, setActiveColorSlot] = useState<"primary" | "secondary">("primary");
  const [strokeKind, setStrokeKind] = useState<StrokeKind>("solid");

  // caption
  const [caption, setCaption] = useState("");

  // dados
  const [layers, setLayers] = useState<ImgLayer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [draws, setDraws] = useState<DrawObj[]>([]);
  const [selectedDrawId, setSelectedDrawId] = useState<string | null>(null);

  // temporários
  const [polyTemp, setPolyTemp] = useState<Vec2[]>([]);
  const dragStartRef = useRef<Vec2 | null>(null);
  const lastMoveRef = useRef<Vec2 | null>(null);

  // crop
  const cropBoxRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const cropDragRef = useRef<{ start: Vec2; box: { x: number; y: number; w: number; h: number }; handle: "nw" | "ne" | "se" | "sw" } | null>(null);

  // mover objeto inteiro
  const movingRef = useRef<{ start: Vec2; orig: any } | null>(null);

  // preview de forma
  const [draft, setDraft] = useState<DrawObj | null>(null);

  // arraste de handle de linha/seta
  const handleDragRef = useRef<{ drawId: string; handle: "a" | "b" } | null>(null);

  // resize layer por handle
  const layerResizeRef = useRef<{
    layerId: string; handle: "nw" | "ne" | "se" | "sw"; start: Vec2;
    orig: { x: number; y: number; w: number; h: number }; keepRatio: boolean;
  } | null>(null);

  // undo/redo
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const snapshot = () => JSON.stringify({ layers: serializeLayers(layers), draws, scale, offset });
  const pushUndo = () => { undoStack.current.push(snapshot()); if (undoStack.current.length > 60) undoStack.current.shift(); redoStack.current = []; };
  const restoreState = (snap: string) => {
    const parsed = JSON.parse(snap) as { layers: any[]; draws: DrawObj[]; scale: number; offset: { x: number; y: number } };
    const ns: ImgLayer[] = [];
    for (const L of parsed.layers) {
      const img = new Image(); img.src = L.src;
      ns.push({ id: L.id, img, x: L.x, y: L.y, w: L.w, h: L.h, crop: L.crop });
    }
    setLayers(ns);
    setDraws(parsed.draws || []);
    setScale(parsed.scale ?? 1);
    setOffset(parsed.offset ?? { x: 0, y: 0 });
    setSelectedLayerId(null); setSelectedDrawId(null);
  };
  const undo = () => { if (!undoStack.current.length) return; const cur = snapshot(); const prev = undoStack.current.pop()!; redoStack.current.push(cur); restoreState(prev); };
  const redo = () => { if (!redoStack.current.length) return; const cur = snapshot(); const next = redoStack.current.pop()!; undoStack.current.push(cur); restoreState(next); };

  // carregar (File / initialProject / initialSrc)
  useEffect(() => {
    const makeLayerFromImage = (img: HTMLImageElement) => {
      const { W, H } = canvasClientSize();
      const s = Math.min((W * 0.7) / img.width, (H * 0.7) / img.height);
      const w = Math.round(img.width * s), h = Math.round(img.height * s);
      const x = (W - w) / 2, y = (H - h) / 2;
      setLayers([{ id: crypto.randomUUID(), img, x, y, w, h }]);
      setDraws([]); setSelectedLayerId(null); setSelectedDrawId(null);
      undoStack.current = []; redoStack.current = []; pushUndo();
    };

    if (initialProject) {
      // reabrir editável
      try {
        restoreState(initialProject);
        undoStack.current = []; redoStack.current = []; pushUndo();
        return;
      } catch { /* fall back */ }
    }

    if (file) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { makeLayerFromImage(img); URL.revokeObjectURL(url); };
      img.src = url;
      return;
    }

    if (initialSrc) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => makeLayerFromImage(img);
      img.src = initialSrc;
    }
  }, [file, initialSrc, initialProject]);

  // canvas init/resize
  useEffect(() => {
    resizeCanvasAndRedraw();
    const ro = new ResizeObserver(() => resizeCanvasAndRedraw());
    if (wrapRef.current) ro.observe(wrapRef.current);
    const onWinResize = () => resizeCanvasAndRedraw();
    window.addEventListener("resize", onWinResize);
    return () => { ro.disconnect(); window.removeEventListener("resize", onWinResize); };
  }, []);

  // redesenhar sempre que mudar estado relevante
  useEffect(() => { draw(); }, [layers, draws, draft, scale, offset, selectedLayerId, selectedDrawId, tool, fillMode]);

  const canvasClientSize = () => {
    const wrap = wrapRef.current!; const topH = toolbarRef.current?.clientHeight ?? 0; const capH = captionRef.current?.clientHeight ?? 0;
    const W = Math.max(480, wrap.clientWidth); const H = Math.max(360, wrap.clientHeight - topH - capH); return { W, H };
  };
  const resizeCanvasAndRedraw = () => {
    const c = canvasRef.current!; const dpr = window.devicePixelRatio || 1; const { W, H } = canvasClientSize();
    c.width = Math.floor(W * dpr); c.height = Math.floor(H * dpr); c.style.width = `${W}px`; c.style.height = `${H}px`; draw();
  };

  const draw = () => {
    const c = canvasRef.current!; const g = c.getContext("2d")!; const W = c.clientWidth, H = c.clientHeight;

    // reset + bg
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height); g.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    g.fillStyle = "#f4f6fb"; g.fillRect(0, 0, W, H);

    // world
    g.setTransform(1, 0, 0, 1, 0, 0); g.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    g.translate(offset.x, offset.y); g.scale(scale, scale);

    // layers
    for (const L of layers) {
      const src = L.crop ?? { x: 0, y: 0, w: L.img.width, h: L.img.height };
      g.drawImage(L.img, src.x, src.y, src.w, src.h, L.x, L.y, L.w, L.h);

      if (L.selected) {
        g.save();
        g.strokeStyle = "#5b8cff"; g.lineWidth = 1 / scale; g.setLineDash([4 / scale, 3 / scale]);
        g.strokeRect(L.x, L.y, L.w, L.h);
        g.restore();

        // handles (se não estiver no crop)
        if (tool !== "crop") {
          const s = 8 / scale;
          const corners = [{ x: L.x, y: L.y }, { x: L.x + L.w, y: L.y }, { x: L.x + L.w, y: L.y + L.h }, { x: L.x, y: L.y + L.h }];
          g.save(); g.setLineDash([]); g.fillStyle = "#5b8cff"; g.strokeStyle = "#fff"; g.lineWidth = 1 / scale;
          for (const p of corners) { g.fillRect(p.x - s / 2, p.y - s / 2, s, s); g.strokeRect(p.x - s / 2, p.y - s / 2, s, s); }
          g.restore();
        }
      }
    }

    // draws
    for (const D of draws) renderObj(g, D);

    // draft
    if (draft) {
      g.save(); g.setLineDash([6 / scale, 4 / scale]);
      const d = { ...draft, stroke: "#5b8cff", fill: "rgba(91,140,255,0.08)", thickness: Math.max(2, draft.thickness) } as DrawObj;
      renderObj(g, d); g.restore();
    }

    // crop overlay
    const L = selectedLayerId ? layers.find(l => l.id === selectedLayerId) : null;
    if (tool === "crop" && L) drawCropOverlay(g, L, cropBoxRef.current);
  };

  const renderObj = (g: CanvasRenderingContext2D, D: DrawObj) => {
    g.save();
    if ((D as any).eraser) g.globalCompositeOperation = "destination-out";
    if (D.dashed) g.setLineDash([12, 8]); else g.setLineDash([]);
    g.lineWidth = D.thickness; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = D.stroke; g.fillStyle = D.fill;

    switch (D.kind) {
      case "path": { const P = D as PathObj; g.beginPath(); P.points.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.stroke(); break; }
      case "line": { const L = D as LineObj; g.beginPath(); g.moveTo(L.a.x, L.a.y); g.lineTo(L.b.x, L.b.y); g.stroke(); break; }
      case "rect": { const R = D as RectObj; drawRect(g, R.a.x, R.a.y, R.b.x - R.a.x, R.b.y - R.a.y, D.fillMode); break; }
      case "ellipse": { const E = D as EllipseObj; drawEllipse(g, E.a.x, E.a.y, E.b.x - E.a.x, E.b.y - E.a.y, D.fillMode); break; }
      case "polygon": {
        const P = D as PolyObj; g.beginPath(); g.moveTo(P.points[0].x, P.points[0].y);
        for (let i = 1; i < P.points.length; i++) g.lineTo(P.points[i].x, P.points[i].y);
        g.closePath(); if (D.fillMode !== "stroke") g.fill(); if (D.fillMode !== "fill") g.stroke(); break;
      }
      case "arrow": { const A = D as ArrowObj; drawArrow(g, A.a, A.b, D.stroke, D.thickness, D.dashed); break; }
    }

    // handles para line/arrow
    if (D.selected && (D.kind === "line" || D.kind === "arrow")) {
      const A = (D as any).a as Vec2, B = (D as any).b as Vec2; const s = 8 / scale;
      g.save(); g.setLineDash([]); g.fillStyle = "#5b8cff"; g.strokeStyle = "#fff"; g.lineWidth = 1 / scale;
      g.fillRect(A.x - s / 2, A.y - s / 2, s, s); g.strokeRect(A.x - s / 2, A.y - s / 2, s, s);
      g.fillRect(B.x - s / 2, B.y - s / 2, s, s); g.strokeRect(B.x - s / 2, B.y - s / 2, s, s);
      g.restore();
    }

    if (D.selected) {
      const bb = bboxOf(D);
      if (bb) { g.setLineDash([4 / scale, 3 / scale]); g.strokeStyle = "#5b8cff"; g.lineWidth = 1 / scale; g.strokeRect(bb.x, bb.y, bb.w, bb.h); }
    }
    g.restore();
  };

  function drawRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, mode: FillMode) {
    const rx = w < 0 ? x + w : x, ry = h < 0 ? y + h : y; const rw = Math.abs(w), rh = Math.abs(h);
    if (mode === "fill" || mode === "both") g.fillRect(rx, ry, rw, rh);
    if (mode === "stroke" || mode === "both") { g.beginPath(); g.rect(rx, ry, rw, rh); g.stroke(); }
  }
  function drawEllipse(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, mode: FillMode) {
    g.beginPath(); g.ellipse(x + w / 2, y + h / 2, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
    if (mode === "fill" || mode === "both") g.fill(); if (mode === "stroke" || mode === "both") g.stroke();
  }
  function drawArrow(g: CanvasRenderingContext2D, a: Vec2, b: Vec2, color: string, lw: number, dashed: boolean) {
    g.save(); if (dashed) g.setLineDash([12, 8]); else g.setLineDash([]); g.lineWidth = lw; g.strokeStyle = color;
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    const dx = b.x - a.x, dy = b.y - a.y, ang = Math.atan2(dy, dx);
    const len = Math.max(18, lw * 2.2), a1 = ang + Math.PI - Math.PI / 7, a2 = ang + Math.PI + Math.PI / 7;
    const x3 = b.x + Math.cos(a1) * len, y3 = b.y + Math.sin(a1) * len, x4 = b.x + Math.cos(a2) * len, y4 = b.y + Math.sin(a2) * len;
    g.setLineDash([]); g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(x3, y3); g.lineTo(x4, y4); g.closePath(); g.fillStyle = color; g.fill(); g.restore();
  }

  function bboxOf(D: DrawObj): { x: number; y: number; w: number; h: number } | null {
    switch (D.kind) {
      case "path":
      case "polygon": {
        const pts = D.kind === "path" ? (D as PathObj).points : (D as PolyObj).points;
        if (!pts.length) return null;
        let minx = pts[0].x, miny = pts[0].y, maxx = pts[0].x, maxy = pts[0].y;
        for (const p of pts) { minx = Math.min(minx, p.x); miny = Math.min(miny, p.y); maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y); }
        return { x: minx, y: miny, w: maxx - minx, h: maxy - miny };
      }
      case "line":
      case "arrow": {
        const L = D as LineObj | ArrowObj;
        const minx = Math.min(L.a.x, L.b.x), miny = Math.min(L.a.y, L.b.y);
        const maxx = Math.max(L.a.x, L.b.x), maxy = Math.max(L.a.y, L.b.y);
        return { x: minx, y: miny, w: maxx - minx, h: maxy - miny };
      }
      case "rect":
      case "ellipse": {
        const R = D as RectObj | EllipseObj;
        return { x: Math.min(R.a.x, R.b.x), y: Math.min(R.a.y, R.b.y), w: Math.abs(R.b.x - R.a.x), h: Math.abs(R.b.y - R.a.y) };
      }
    }
  }

  const drawCropOverlay = (g: CanvasRenderingContext2D, L: ImgLayer, box: { x: number; y: number; w: number; h: number } | null) => {
    const b = box ?? { x: 0, y: 0, w: L.w, h: L.h }; const cx = L.x + b.x, cy = L.y + b.y;
    g.save();
    g.fillStyle = "rgba(0,0,0,0.35)"; g.beginPath(); g.rect(-1e5, -1e5, 2e5, 2e5); g.rect(cx, cy, b.w, b.h); g.fill("evenodd");
    g.setLineDash([6 / scale, 4 / scale]); g.strokeStyle = "#5b8cff"; g.lineWidth = 1 / scale; g.strokeRect(cx, cy, b.w, b.h);
    g.setLineDash([]); g.fillStyle = "#5b8cff";
    const s = 8 / scale, pts = [{ x: cx, y: cy }, { x: cx + b.w, y: cy }, { x: cx + b.w, y: cy + b.h }, { x: cx, y: cy + b.h }];
    for (const p of pts) g.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    g.restore();
  };

  const ensureCropBox = (L: ImgLayer) => {
    if (!cropBoxRef.current) cropBoxRef.current = { x: 0, y: 0, w: L.w, h: L.h };
    const b = cropBoxRef.current; b.x = clamp(b.x, 0, L.w - 10); b.y = clamp(b.y, 0, L.h - 10);
    b.w = clamp(b.w, 10, L.w - b.x); b.h = clamp(b.h, 10, L.h - b.y);
  };

  const applyCrop = () => {
    if (!selectedLayerId || !cropBoxRef.current) return;
    pushUndo();
    const L = layers.find(l => l.id === selectedLayerId)!; const b = cropBoxRef.current;
    const base = L.crop ?? { x: 0, y: 0, w: L.img.width, h: L.img.height };
    const srcX = base.x + (b.x / L.w) * base.w, srcY = base.y + (b.y / L.h) * base.h;
    const srcW = (b.w / L.w) * base.w, srcH = (b.h / L.h) * base.h;

    const off = document.createElement("canvas"); off.width = Math.max(1, Math.round(b.w)); off.height = Math.max(1, Math.round(b.h));
    const og = off.getContext("2d")!; og.drawImage(L.img, srcX, srcY, srcW, srcH, 0, 0, off.width, off.height);

    const nextImg = new Image();
    nextImg.onload = () => {
      setLayers(prev => prev.map(x => x.id === L.id ? { ...x, img: nextImg, crop: undefined, x: L.x + b.x, y: L.y + b.y, w: off.width, h: off.height } : x));
      cropBoxRef.current = null; cropDragRef.current = null; setSelectedLayerId(null); setTool("move");
    };
    nextImg.src = off.toDataURL("image/png");
  };

  const thicknessSwatches = [2, 4, 6, 10, 14, 18];

  const screenToWorld = (sx: number, sy: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: (sx - rect.left - offset.x) / scale, y: (sy - rect.top - offset.y) / scale };
  };

  const hitTest = (p: Vec2): { type: "draw" | "layer"; id: string } | null => {
    for (let i = draws.length - 1; i >= 0; i--) {
      const D = draws[i]; const bb = bboxOf(D); if (!bb) continue;
      if (p.x >= bb.x && p.y >= bb.y && p.x <= bb.x + bb.w && p.y <= bb.y + bb.h) return { type: "draw", id: D.id };
    }
    for (let i = layers.length - 1; i >= 0; i--) {
      const L = layers[i];
      if (p.x >= L.x && p.y >= L.y && p.x <= L.x + L.w && p.y <= L.y + L.h) return { type: "layer", id: L.id };
    }
    return null;
  };

  const layerHandleAtPoint = (L: ImgLayer, p: Vec2, tol: number): ("nw" | "ne" | "se" | "sw") | null => {
    const corners = [
      { x: L.x, y: L.y, k: "nw" as const },
      { x: L.x + L.w, y: L.y, k: "ne" as const },
      { x: L.x + L.w, y: L.y + L.h, k: "se" as const },
      { x: L.x, y: L.y + L.h, k: "sw" as const },
    ];
    const h = corners.find(c => Math.abs(p.x - c.x) <= tol && Math.abs(p.y - c.y) <= tol);
    return h?.k ?? null;
  };

  const onPointerDown: React.PointerEventHandler<HTMLCanvasElement> = (e) => {
    const p = screenToWorld(e.clientX, e.clientY);

    if (panningRef.current) { panLastRef.current = { x: e.clientX, y: e.clientY }; return; }

    // CROP
    if (tool === "crop") {
      const hit = hitTest(p);
      const L = hit?.type === "layer" ? layers.find(x => x.id === hit.id)! : (selectedLayerId ? layers.find(x => x.id === selectedLayerId)! : null);
      if (L) {
        selectOnlyLayer(L.id); ensureCropBox(L);
        const b = cropBoxRef.current!; const local = { x: p.x - L.x, y: p.y - L.y }; const s = 10 / scale;
        const handle = [
          { x: b.x, y: b.y, k: "nw" as const }, { x: b.x + b.w, y: b.y, k: "ne" as const },
          { x: b.x + b.w, y: b.y + b.h, k: "se" as const }, { x: b.x, y: b.y + b.h, k: "sw" as const },
        ].find(h => Math.abs(local.x - h.x) <= s && Math.abs(local.y - h.y) <= s)?.k;

        if (handle) { cropDragRef.current = { start: p, box: { ...b }, handle }; return; }

        if (!b.w || !b.h) { cropBoxRef.current = { x: local.x, y: local.y, w: 0, h: 0 }; cropDragRef.current = { start: p, box: { x: local.x, y: local.y, w: 0, h: 0 }, handle: "se" }; return; }
      }
      return;
    }

    // RESIZE LAYER handles (fora do crop)
    {
      const hit = hitTest(p);
      const L = hit?.type === "layer" ? layers.find(l => l.id === hit.id)! : (selectedLayerId ? layers.find(l => l.id === selectedLayerId)! : null);
      if (L) {
        selectOnlyLayer(L.id);
        const tol = 10 / scale; const h = layerHandleAtPoint(L, p, tol);
        if (h) {
          layerResizeRef.current = { layerId: L.id, handle: h, start: p, orig: { x: L.x, y: L.y, w: L.w, h: L.h }, keepRatio: e.shiftKey };
          return;
        }
      }
    }

    // PEGAR HANDLE A/B (linha/seta)
    {
      const hit = hitTest(p);
      if (hit?.type === "draw") {
        const D = draws.find(d => d.id === hit.id)!;
        if (D.kind === "line" || D.kind === "arrow") {
          const s = 10 / scale; const A = (D as any).a as Vec2, B = (D as any).b as Vec2;
          const near = (u: Vec2) => Math.abs(p.x - u.x) <= s && Math.abs(p.y - u.y) <= s;
          if (near(A)) { selectOnlyDraw(D.id); handleDragRef.current = { drawId: D.id, handle: "a" }; return; }
          if (near(B)) { selectOnlyDraw(D.id); handleDragRef.current = { drawId: D.id, handle: "b" }; return; }
        }
      }
    }

    // DESENHO
    if (tool === "eraser") {
      pushUndo();
      const id = crypto.randomUUID();
      setDraws(d => [...d, { id, kind: "path", points: [p], stroke: "#000", fill: "transparent", fillMode: "stroke", thickness, dashed: false, eraser: true } as any]);
      setSelectedDrawId(id); dragStartRef.current = p; lastMoveRef.current = p; return;
    }
    if (tool === "pencil") {
      pushUndo();
      const id = crypto.randomUUID();
      setDraws(d => [...d, { id, kind: "path", points: [p], stroke: primary, fill: "transparent", fillMode: "stroke", thickness, dashed: strokeKind === "dashed" }]);
      setSelectedDrawId(id); setSelectedLayerId(null); dragStartRef.current = p; lastMoveRef.current = p; return;
    }
    if (["line", "rect", "ellipse", "arrow"].includes(tool)) {
      pushUndo(); dragStartRef.current = p; lastMoveRef.current = p; setSelectedDrawId(null); setSelectedLayerId(null); return;
    }
    if (tool === "polygon") {
      pushUndo(); setPolyTemp(t => t.length === 0 ? [p] : [...t, p]); setSelectedDrawId(null); setSelectedLayerId(null); return;
    }

    // SELEÇÃO/MOVER
    const hit = hitTest(p);
    if (hit?.type === "draw") { selectOnlyDraw(hit.id); movingRef.current = { start: p, orig: draws.find(d => d.id === hit.id)! }; }
    else if (hit?.type === "layer") { selectOnlyLayer(hit.id); movingRef.current = { start: p, orig: layers.find(l => l.id === hit.id)! }; }
    else { clearSelection(); }
  };

  const onPointerMove: React.PointerEventHandler<HTMLCanvasElement> = (e) => {
    const p = screenToWorld(e.clientX, e.clientY);

    if (panningRef.current) {
      const dx = e.clientX - panLastRef.current.x, dy = e.clientY - panLastRef.current.y;
      panLastRef.current = { x: e.clientX, y: e.clientY }; setOffset(o => ({ x: o.x + dx, y: o.y + dy })); return;
    }

    // crop
    if (tool === "crop" && cropDragRef.current && selectedLayerId) {
      const L = layers.find(x => x.id === selectedLayerId)!; const { start, box, handle } = cropDragRef.current;
      let dx = p.x - start.x, dy = p.y - start.y;
      let nx = box.x, ny = box.y, nw = box.w, nh = box.h;
      switch (handle) {
        case "nw": nx = box.x + dx; ny = box.y + dy; nw = box.w - dx; nh = box.h - dy; break;
        case "ne": ny = box.y + dy; nw = box.w + dx; nh = box.h - dy; break;
        case "se": nw = box.w + dx; nh = box.h + dy; break;
        case "sw": nx = box.x + dx; nw = box.w - dx; nh = box.h + dy; break;
      }
      nx = clamp(nx, 0, L.w - 10); ny = clamp(ny, 0, L.h - 10); nw = clamp(nw, 10, L.w - nx); nh = clamp(nh, 10, L.h - ny);
      cropBoxRef.current = { x: nx, y: ny, w: nw, h: nh }; return;
    }

    // arraste de handle de linha/seta
    if (handleDragRef.current) {
      const { drawId, handle } = handleDragRef.current;
      setDraws(ds => ds.map(d => {
        if (d.id !== drawId) return d;
        if (d.kind !== "line" && d.kind !== "arrow") return d;
        const next = { ...d } as any; next[handle] = { x: p.x, y: p.y }; return next as DrawObj;
      }));
      return;
    }

    // resize de layer
    if (layerResizeRef.current) {
      const { layerId, handle, start, orig, keepRatio } = layerResizeRef.current;
      const dx = p.x - start.x, dy = p.y - start.y;
      setLayers(ls => ls.map(L => {
        if (L.id !== layerId) return L;
        let x = orig.x, y = orig.y, w = orig.w, h = orig.h; const aspect = orig.w / orig.h || 1;
        const applyCorner = (signX: number, signY: number) => {
          let ww = orig.w + signX * dx, hh = orig.h + signY * dy;
          if (keepRatio) {
            if (Math.abs(ww - orig.w) > Math.abs(hh - orig.h)) hh = ww / aspect; else ww = hh * aspect;
          }
          if (signX < 0) x = orig.x + (orig.w - ww);
          if (signY < 0) y = orig.y + (orig.h - hh);
          w = Math.max(10, ww); h = Math.max(10, hh);
        };
        switch (handle) {
          case "se": applyCorner(+1, +1); break;
          case "ne": applyCorner(+1, -1); break;
          case "sw": applyCorner(-1, +1); break;
          case "nw": applyCorner(-1, -1); break;
        }
        return { ...L, x, y, w, h };
      }));
      return;
    }

    // desenho livre/preview
    if ((tool === "pencil" || tool === "eraser") && dragStartRef.current) {
      setDraws(d => d.map(o => o.id === selectedDrawId ? ({ ...(o as PathObj), points: [...(o as PathObj).points, p] } as DrawObj) : o));
      lastMoveRef.current = p; return;
    }
    if (dragStartRef.current && ["line", "rect", "ellipse", "arrow"].includes(tool)) {
      const s = dragStartRef.current!;
      const base: Omit<DrawBase, "kind"> = { id: "__draft__", stroke: primary, fill: secondary, fillMode, thickness, dashed: strokeKind === "dashed" };
      const obj: DrawObj =
        tool === "line" ? ({ ...base, kind: "line", a: s, b: p } as DrawObj) :
          tool === "rect" ? ({ ...base, kind: "rect", a: s, b: p } as DrawObj) :
            tool === "ellipse" ? ({ ...base, kind: "ellipse", a: s, b: p } as DrawObj) :
              ({ ...base, kind: "arrow", a: s, b: p } as DrawObj);
      setDraft(obj); lastMoveRef.current = p; return;
    }

    // mover objeto inteiro
    if (movingRef.current) {
      const d = { x: p.x - movingRef.current.start.x, y: p.y - movingRef.current.start.y };
      if (selectedDrawId) {
        const base = movingRef.current.orig as DrawObj;
        setDraws(objs => objs.map(o => o.id !== selectedDrawId ? o : moveObj(base, d)));
      } else if (selectedLayerId) {
        const base = movingRef.current.orig as ImgLayer;
        setLayers(ls => ls.map(L => L.id !== selectedLayerId ? L : ({ ...L, x: base.x + d.x, y: base.y + d.y })));
      }
      return;
    }
  };

  const finalizePointer = () => {
    // handle setas/linhas (parar arrasto de pontas)
    if (handleDragRef.current) { handleDragRef.current = null; pushUndo(); return; }
    // finalizar resize de layer
    if (layerResizeRef.current) { layerResizeRef.current = null; pushUndo(); return; }
    // crop
    if (tool === "crop") { cropDragRef.current = null; return; }
    // finalizar formas baseadas em draft (linha/ret/elp/seta)
    if (dragStartRef.current && lastMoveRef.current && ["line", "rect", "ellipse", "arrow"].includes(tool)) {
      const finalized = { ...draft, id: crypto.randomUUID() } as DrawObj;
      if (finalized) { setDraws(d => [...d, finalized]); setSelectedDrawId(finalized.id); setSelectedLayerId(null); }
      setDraft(null); dragStartRef.current = null; lastMoveRef.current = null; return;
    }
    // lápis/borracha
    if (dragStartRef.current && (tool === "pencil" || tool === "eraser")) {
      dragStartRef.current = null; lastMoveRef.current = null; return;
    }
    // mover tudo
    if (movingRef.current) { movingRef.current = null; pushUndo(); return; }
  };

  const onPointerUp: React.PointerEventHandler<HTMLCanvasElement> = () => finalizePointer();
  const onPointerLeave: React.PointerEventHandler<HTMLCanvasElement> = () => finalizePointer();
  const onPointerCancel: React.PointerEventHandler<HTMLCanvasElement> = () => finalizePointer();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") { panningRef.current = true; canvasRef.current?.classList.add("grabbing"); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && e.key.toLowerCase() === "z") || e.key.toLowerCase() === "y")) { e.preventDefault(); redo(); }
      if (tool === "polygon" && e.key === "Enter" && polyTemp.length >= 3) {
        pushUndo();
        const id = crypto.randomUUID();
        const obj: PolyObj = { id, kind: "polygon", points: [...polyTemp], stroke: primary, fill: secondary, fillMode, thickness, dashed: strokeKind === "dashed" };
        setDraws(d => [...d, obj]); setPolyTemp([]); setSelectedDrawId(id); setSelectedLayerId(null);
      }
      if (tool === "polygon" && e.key === "Escape") { setPolyTemp([]); }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedDrawId) { pushUndo(); setDraws(d => d.filter(x => x.id !== selectedDrawId)); setSelectedDrawId(null); }
        if (selectedLayerId) { pushUndo(); setLayers(ls => ls.filter(x => x.id !== selectedLayerId)); setSelectedLayerId(null); }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === "Space") { panningRef.current = false; canvasRef.current?.classList.remove("grabbing"); } };
    window.addEventListener("keydown", onKeyDown); window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  }, [tool, polyTemp.length, primary, secondary, fillMode, thickness, strokeKind, selectedDrawId, selectedLayerId]);

  const onWheel: React.WheelEventHandler<HTMLCanvasElement> = (e) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const world = screenToWorld(e.clientX, e.clientY);
    const factor = Math.exp(-e.deltaY * 0.0015);
    const next = clamp(scale * factor, 0.25, 4);
    setScale(next);
    const screenAfter = { x: world.x * next + offset.x, y: world.y * next + offset.y };
    const dx = mouse.x - screenAfter.x, dy = mouse.y - screenAfter.y;
    setOffset(o => ({ x: o.x + dx, y: o.y + dy }));
  };

  function moveObj(base: DrawObj, d: Vec2): DrawObj {
    switch (base.kind) {
      case "path": return { ...base, points: base.points.map(p => ({ x: p.x + d.x, y: p.y + d.y })) };
      case "line": return { ...base, a: { x: base.a.x + d.x, y: base.a.y + d.y }, b: { x: base.b.x + d.x, y: base.b.y + d.y } };
      case "rect": return { ...base, a: { x: base.a.x + d.x, y: base.a.y + d.y }, b: { x: base.b.x + d.x, y: base.b.y + d.y } };
      case "ellipse": return { ...base, a: { x: base.a.x + d.x, y: base.a.y + d.y }, b: { x: base.b.x + d.x, y: base.b.y + d.y } };
      case "polygon": return { ...base, points: base.points.map(p => ({ x: p.x + d.x, y: p.y + d.y })) };
      case "arrow": return { ...base, a: { x: base.a.x + d.x, y: base.a.y + d.y }, b: { x: base.b.x + d.x, y: base.b.y + d.y } };
    }
  }
  function selectOnlyDraw(id: string) { setSelectedDrawId(id); setSelectedLayerId(null); setDraws(d => d.map(o => ({ ...o, selected: o.id === id }))); setLayers(ls => ls.map(L => ({ ...L, selected: false }))); }
  function selectOnlyLayer(id: string) { setSelectedLayerId(id); setSelectedDrawId(null); setLayers(ls => ls.map(L => ({ ...L, selected: L.id === id }))); setDraws(d => d.map(o => ({ ...o, selected: false }))); }
  function clearSelection() { setSelectedDrawId(null); setSelectedLayerId(null); setDraws(d => d.map(o => ({ ...o, selected: false }))); setLayers(ls => ls.map(L => ({ ...L, selected: false }))); }

  const addImages = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    pushUndo();
    const { W, H } = canvasClientSize();
    Array.from(files).forEach(f => {
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => {
        const s = Math.min(300 / img.width, 300 / img.height, 1);
        const w = Math.max(40, Math.round(img.width * s));
        const h = Math.max(40, Math.round(img.height * s));
        const x = (W - w) / 2 + (Math.random() * 40 - 20);
        const y = (H - h) / 2 + (Math.random() * 40 - 20);
        const id = crypto.randomUUID();
        setLayers(prev => [...prev, { id, img, x, y, w, h }]);
        setSelectedLayerId(id); setSelectedDrawId(null);
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  };

  const clearAll = () => { pushUndo(); setDraws([]); };

  const save = () => {
    const { W, H } = canvasClientSize();
    const out = document.createElement("canvas"); out.width = W; out.height = H;
    const g = out.getContext("2d")!;
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H);
    g.save(); g.translate(offset.x, offset.y); g.scale(scale, scale);
    for (const L of layers) {
      const src = L.crop ?? { x: 0, y: 0, w: L.img.width, h: L.img.height };
      g.drawImage(L.img, src.x, src.y, src.w, src.h, L.x, L.y, L.w, L.h);
    }
    for (const D of draws) renderObj(g, D);
    g.restore();

    const png = out.toDataURL("image/png");
    const projectJson = snapshot();
    onSave(png, caption, projectJson);
  };

  return (
    <div className="editor" ref={wrapRef}>
      <div className="editor-toolbar" ref={toolbarRef}>
        <div className="tool-group" title="Ferramentas">
          <button className={tool === "pencil" ? "active" : ""} onClick={() => setTool("pencil")} aria-label="Lápis">✏️</button>
          <button className={tool === "eraser" ? "active" : ""} onClick={() => setTool("eraser")} aria-label="Borracha">🧽</button>
          <button className={tool === "line" ? "active" : ""} onClick={() => setTool("line")} aria-label="Linha">／</button>
          <button className={tool === "rect" ? "active" : ""} onClick={() => setTool("rect")} aria-label="Retângulo">▭</button>
          <button className={tool === "ellipse" ? "active" : ""} onClick={() => setTool("ellipse")} aria-label="Elipse">◯</button>
          <button className={tool === "polygon" ? "active" : ""} onClick={() => { setTool("polygon"); setPolyTemp([]); }} aria-label="Polígono">⬠</button>
          <button className={tool === "arrow" ? "active" : ""} onClick={() => setTool("arrow")} aria-label="Seta">➜</button>
          <button className={tool === "crop" ? "active" : ""} onClick={() => { cropBoxRef.current = null; cropDragRef.current = null; setTool("crop"); }} aria-label="Cortar">✂️</button>
          <button className={tool === "move" ? "active" : ""} onClick={() => setTool("move")} aria-label="Mover">🖐️</button>
        </div>

        <div className="tool-group" title="Espessura">
          {[2, 4, 6, 10, 14, 18].map(n => (
            <button key={n} className={`thick ${thickness === n ? "active" : ""}`} onClick={() => setThickness(n)}>
              <span style={{ display: "inline-block", width: 28, height: n, borderRadius: 8, background: "#e6e7ea" }} />
            </button>
          ))}
          <label className="range">
            <input type="range" min={1} max={48} value={thickness} onChange={(e) => setThickness(parseInt(e.target.value, 10))} />
            <span>{thickness}px</span>
          </label>
        </div>

        <div className="tool-group" title="Estilo">
          <select value={fillMode} onChange={(e) => setFillMode(e.target.value as FillMode)}>
            <option value="stroke">Contorno</option>
            <option value="fill">Preenchido</option>
            <option value="both">Ambos</option>
          </select>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={strokeKind === "dashed"} onChange={(e) => setStrokeKind(e.target.checked ? "dashed" : "solid")} />
            Pontilhada
          </label>
        </div>

        <div className="spacer" />
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
            <button className="swap" onClick={() => setPrimary(p => { const s = secondary; setSecondary(p); return s; })} title="Trocar cores">⇄</button>
          </div>

          <div className="palette">
            {PALETTE.map((c, i) => (
              <button key={i} className="pal" onClick={() => (activeColorSlot === "primary" ? setPrimary(c) : setSecondary(c))}>
                <span style={{ background: c }} />
              </button>
            ))}
          </div>
        </div>

        {tool === "crop" && selectedLayerId && cropBoxRef.current && (
          <div className="tool-group" title="Corte">
            <button className="primary" onClick={applyCrop}>Aplicar corte</button>
            <button onClick={() => { cropBoxRef.current = null; cropDragRef.current = null; setSelectedLayerId(null); setTool("move"); }}>Cancelar</button>
          </div>
        )}

        <div className="spacer" />
        <button onClick={undo} title="Desfazer">↩️</button>
        <button onClick={redo} title="Refazer">↪️</button>
        <button onClick={clearAll} title="Limpar desenhos">🧹</button>
        <div className="spacer" />

        <label className="add-btn">
          <input type="file" accept="image/*" multiple onChange={(e) => { addImages(e.target.files); e.currentTarget.value = ""; }} />
          ➕ Adicionar imagens
        </label>

        <div className="sep" />
        <button className="primary" onClick={save}>💾 Salvar</button>
        <button onClick={onCancel}>✖️ Cancelar</button>
      </div>

      <div className="editor-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="editor-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerLeave}
          onPointerCancel={onPointerCancel}
          onWheel={onWheel}
        />
      </div>

      <div ref={captionRef} className="legend-row">
        <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Legenda da imagem (opcional)…" />
      </div>
    </div>
  );
}

function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }
function serializeLayers(layers: ImgLayer[]) {
  return layers.map(L => ({ id: L.id, x: L.x, y: L.y, w: L.w, h: L.h, crop: L.crop, src: L.img.src }));
}
