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
  onSave,
  onCancel,
}: {
  file: File;
  onSave: (dataUrl: string, caption: string) => void;
  onCancel: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);


  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const panningRef = useRef(false);
  const panLastRef = useRef({ x: 0, y: 0 });


  const [tool, setTool] = useState<Tool>("pencil");
  const [thickness, setThickness] = useState(6);
  const [fillMode, setFillMode] = useState<FillMode>("stroke");
  const [primary, setPrimary] = useState("#000000");
  const [secondary, setSecondary] = useState("#ffffff");
  const [activeColorSlot, setActiveColorSlot] = useState<"primary" | "secondary">("primary");
  const [strokeKind, setStrokeKind] = useState<StrokeKind>("solid");


  const [caption, setCaption] = useState("");


  const [layers, setLayers] = useState<ImgLayer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);


  const [draws, setDraws] = useState<DrawObj[]>([]);
  const [selectedDrawId, setSelectedDrawId] = useState<string | null>(null);


  const [polyTemp, setPolyTemp] = useState<Vec2[]>([]);
  const dragStartRef = useRef<Vec2 | null>(null);
  const lastMoveRef = useRef<Vec2 | null>(null);


  const cropBoxRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const cropDragRef = useRef<{ start: Vec2; box: { x: number; y: number; w: number; h: number }; handle: "nw" | "ne" | "se" | "sw" } | null>(null);


  const movingRef = useRef<{ start: Vec2; orig: any } | null>(null);


  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const snapshot = () => JSON.stringify({ layers: serializeLayers(layers), draws, scale, offset });
  const pushUndo = () => { undoStack.current.push(snapshot()); if (undoStack.current.length > 60) undoStack.current.shift(); redoStack.current = []; };
  const restoreState = (snap: string) => {
    const parsed = JSON.parse(snap) as { layers: any[]; draws: DrawObj[]; scale: number; offset: { x: number; y: number } };

    const newLayers: ImgLayer[] = [];
    for (const L of parsed.layers) {
      const img = new Image();
      img.src = L.src;
      newLayers.push({ id: L.id, img, x: L.x, y: L.y, w: L.w, h: L.h, crop: L.crop });
    }
    setLayers(newLayers);
    setDraws(parsed.draws);
    setScale(parsed.scale); setOffset(parsed.offset);
    setSelectedLayerId(null); setSelectedDrawId(null);
    draw();
  };
  const undo = () => { if (undoStack.current.length === 0) return; const cur = snapshot(); const prev = undoStack.current.pop()!; redoStack.current.push(cur); restoreState(prev); };
  const redo = () => { if (redoStack.current.length === 0) return; const cur = snapshot(); const next = redoStack.current.pop()!; undoStack.current.push(cur); restoreState(next); };


  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const { W, H } = canvasClientSize();
      const s = Math.min((W * 0.7) / img.width, (H * 0.7) / img.height);
      const w = Math.round(img.width * s);
      const h = Math.round(img.height * s);
      const x = (W - w) / 2;
      const y = (H - h) / 2;
      setLayers([{ id: crypto.randomUUID(), img, x, y, w, h }]);
      setDraws([]);
      setSelectedLayerId(null);
      setSelectedDrawId(null);
      undoStack.current = []; redoStack.current = [];
      pushUndo();
      URL.revokeObjectURL(url);
      draw();
    };
    img.src = url;

  }, [file]);


  useEffect(() => {
    const ro = new ResizeObserver(() => resizeCanvasAndRedraw());
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();

  }, []);

  const canvasClientSize = () => {
    const wrap = wrapRef.current!;
    const topH = toolbarRef.current?.clientHeight ?? 0;
    const capH = captionRef.current?.clientHeight ?? 0;
    const W = Math.max(480, wrap.clientWidth);
    const H = Math.max(360, wrap.clientHeight - topH - capH);
    return { W, H };
  };

  const resizeCanvasAndRedraw = () => {
    const c = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    const { W, H } = canvasClientSize();
    c.width = Math.floor(W * dpr);
    c.height = Math.floor(H * dpr);
    c.style.width = `${W}px`;
    c.style.height = `${H}px`;
    draw();
  };


  const draw = () => {
    const c = canvasRef.current!;
    const g = c.getContext("2d")!;
    const W = c.clientWidth, H = c.clientHeight;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    g.fillStyle = "#f4f6fb"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#e5e8f0";
    for (let y = 0; y < H; y += 16) for (let x = 0; x < W; x += 16) if (((x + y) / 16) % 2 === 0) g.fillRect(x, y, 16, 16);


    g.setTransform(1, 0, 0, 1, 0, 0);
    g.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    g.translate(offset.x, offset.y);
    g.scale(scale, scale);


    for (const L of layers) {
      const src = L.crop ?? { x: 0, y: 0, w: L.img.width, h: L.img.height };
      g.drawImage(L.img, src.x, src.y, src.w, src.h, L.x, L.y, L.w, L.h);
      if (L.selected) {
        g.save();
        g.strokeStyle = "#5b8cff"; g.lineWidth = 1 / scale; g.setLineDash([4 / scale, 3 / scale]);
        g.strokeRect(L.x, L.y, L.w, L.h);
        g.restore();
      }
    }

    for (const D of draws) renderObj(g, D);

    if (tool === "polygon" && polyTemp.length > 0) {
      g.save();
      g.setLineDash([6 / scale, 4 / scale]);
      g.strokeStyle = "#5b8cff"; g.lineWidth = Math.max(1, 2 / scale);
      g.beginPath();
      g.moveTo(polyTemp[0].x, polyTemp[0].y);
      for (let i = 1; i < polyTemp.length; i++) g.lineTo(polyTemp[i].x, polyTemp[i].y);
      g.stroke();
      g.restore();
    }

    const L = selectedLayerId ? layers.find(l => l.id === selectedLayerId) : null;
    if (tool === "crop" && L) drawCropOverlay(g, L, cropBoxRef.current);
  };

  const renderObj = (g: CanvasRenderingContext2D, D: DrawObj) => {
    g.save();
    if (D.dashed) g.setLineDash([12, 8]); else g.setLineDash([]);
    g.lineWidth = D.thickness;
    g.lineCap = "round"; g.lineJoin = "round";
    g.strokeStyle = D.stroke; g.fillStyle = D.fill;

    switch (D.kind) {
      case "path":
        g.beginPath();
        D.points.forEach((p, i) => i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y));
        g.stroke();
        break;
      case "line":
        g.beginPath(); g.moveTo(D.a.x, D.a.y); g.lineTo(D.b.x, D.b.y); g.stroke();
        break;
      case "rect":
        drawRect(g, D.a.x, D.a.y, D.b.x - D.a.x, D.b.y - D.a.y, D.fillMode);
        break;
      case "ellipse":
        drawEllipse(g, D.a.x, D.a.y, D.b.x - D.a.x, D.b.y - D.a.y, D.fillMode);
        break;
      case "polygon":
        g.beginPath();
        g.moveTo(D.points[0].x, D.points[0].y);
        for (let i = 1; i < D.points.length; i++) g.lineTo(D.points[i].x, D.points[i].y);
        g.closePath();
        if (D.fillMode !== "stroke") g.fill();
        if (D.fillMode !== "fill") g.stroke();
        break;
      case "arrow":
        drawArrow(g, D.a, D.b, D.stroke, D.thickness, D.dashed);
        break;
    }


    if (D.selected) {
      const bb = bboxOf(D);
      if (bb) {
        g.setLineDash([4 / scale, 3 / scale]);
        g.strokeStyle = "#5b8cff"; g.lineWidth = 1 / scale;
        g.strokeRect(bb.x, bb.y, bb.w, bb.h);
      }
    }
    g.restore();
  };


  function drawRect(
    g: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number, mode: FillMode
  ) {
    const rx = w < 0 ? x + w : x, ry = h < 0 ? y + h : y, rw = Math.abs(w), rh = Math.abs(h);
    if (mode === "fill" || mode === "both") g.fillRect(rx, ry, rw, rh);
    if (mode === "stroke" || mode === "both") { g.beginPath(); g.rect(rx, ry, rw, rh); g.stroke(); }
  }
  function drawEllipse(
    g: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number, mode: FillMode
  ) {
    g.beginPath();
    g.ellipse(x + w / 2, y + h / 2, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
    if (mode === "fill" || mode === "both") g.fill();
    if (mode === "stroke" || mode === "both") g.stroke();
  }
  function drawArrow(
    g: CanvasRenderingContext2D, a: Vec2, b: Vec2, color: string, lw: number, dashed: boolean
  ) {
    g.save();
    if (dashed) g.setLineDash([12, 8]); else g.setLineDash([]);
    g.lineWidth = lw; g.strokeStyle = color;
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();


    const dx = b.x - a.x, dy = b.y - a.y, ang = Math.atan2(dy, dx);
    const len = Math.max(18, lw * 2.2);
    const a1 = ang + Math.PI - Math.PI / 7, a2 = ang + Math.PI + Math.PI / 7;
    const x3 = b.x + Math.cos(a1) * len, y3 = b.y + Math.sin(a1) * len;
    const x4 = b.x + Math.cos(a2) * len, y4 = b.y + Math.sin(a2) * len;
    g.setLineDash([]);
    g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(x3, y3); g.lineTo(x4, y4); g.closePath();
    g.fillStyle = color; g.fill();
    g.restore();
  }

  function bboxOf(D: DrawObj): { x: number; y: number; w: number; h: number } | null {
    switch (D.kind) {
      case "path":
      case "polygon": {
        const pts = (D.kind === "path" ? (D as PathObj).points : (D as PolyObj).points);
        if (pts.length === 0) return null;
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
    const b = box ?? { x: 0, y: 0, w: L.w, h: L.h };
    const cx = L.x + b.x, cy = L.y + b.y;
    g.save();

    g.fillStyle = "rgba(0,0,0,0.35)";
    g.beginPath();
    g.rect(-1e5, -1e5, 2e5, 2e5);
    g.rect(cx, cy, b.w, b.h);
    g.fill("evenodd");

    g.setLineDash([6 / scale, 4 / scale]); g.strokeStyle = "#5b8cff"; g.lineWidth = 1 / scale;
    g.strokeRect(cx, cy, b.w, b.h);
    g.setLineDash([]);
    g.fillStyle = "#5b8cff";
    const s = 8 / scale;
    const pts = [{ x: cx, y: cy }, { x: cx + b.w, y: cy }, { x: cx + b.w, y: cy + b.h }, { x: cx, y: cy + b.h }];
    for (const p of pts) g.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    g.restore();
  };

  const ensureCropBox = (L: ImgLayer) => {
    if (!cropBoxRef.current) cropBoxRef.current = { x: 0, y: 0, w: L.w, h: L.h };
    const b = cropBoxRef.current;
    b.x = clamp(b.x, 0, L.w - 10);
    b.y = clamp(b.y, 0, L.h - 10);
    b.w = clamp(b.w, 10, L.w - b.x);
    b.h = clamp(b.h, 10, L.h - b.y);
  };

  const applyCrop = () => {
    if (!selectedLayerId || !cropBoxRef.current) return;
    pushUndo();
    const L = layers.find(l => l.id === selectedLayerId)!;
    const b = cropBoxRef.current;

    const base = L.crop ?? { x: 0, y: 0, w: L.img.width, h: L.img.height };
    const srcX = base.x + (b.x / L.w) * base.w;
    const srcY = base.y + (b.y / L.h) * base.h;
    const srcW = (b.w / L.w) * base.w;
    const srcH = (b.h / L.h) * base.h;


    const off = document.createElement("canvas");
    off.width = Math.max(1, Math.round(b.w));
    off.height = Math.max(1, Math.round(b.h));
    const og = off.getContext("2d")!;
    og.drawImage(L.img, srcX, srcY, srcW, srcH, 0, 0, off.width, off.height);

    const nextImg = new Image();
    nextImg.onload = () => {
      setLayers(prev => prev.map(x => x.id === L.id ? { ...x, img: nextImg, crop: undefined, x: L.x + b.x, y: L.y + b.y, w: off.width, h: off.height } : x));
      cropBoxRef.current = null; draw();
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
      const D = draws[i];
      const bb = bboxOf(D);
      if (!bb) continue;
      if (p.x >= bb.x && p.y >= bb.y && p.x <= bb.x + bb.w && p.y <= bb.y + bb.h) {
        return { type: "draw", id: D.id };
      }
    }

    for (let i = layers.length - 1; i >= 0; i--) {
      const L = layers[i];
      if (p.x >= L.x && p.y >= L.y && p.x <= L.x + L.w && p.y <= L.y + L.h) {
        return { type: "layer", id: L.id };
      }
    }
    return null;
  };

  const onPointerDown: React.PointerEventHandler<HTMLCanvasElement> = (e) => {
    const p = screenToWorld(e.clientX, e.clientY);

    if (panningRef.current) { panLastRef.current = { x: e.clientX, y: e.clientY }; return; }


    if (tool === "crop") {
      const hit = hitTest(p);
      const L = hit?.type === "layer" ? layers.find(x => x.id === hit.id)! :
        selectedLayerId ? layers.find(x => x.id === selectedLayerId)! : null;
      if (L) {
        selectOnlyLayer(L.id);
        ensureCropBox(L);
        const b = cropBoxRef.current!;
        const local = { x: p.x - L.x, y: p.y - L.y };
        const s = 10 / scale;
        const handle = [
          { x: b.x, y: b.y, k: "nw" as const }, { x: b.x + b.w, y: b.y, k: "ne" as const },
          { x: b.x + b.w, y: b.y + b.h, k: "se" as const }, { x: b.x, y: b.y + b.h, k: "sw" as const },
        ].find(h => Math.abs(local.x - h.x) <= s && Math.abs(local.y - h.y) <= s)?.k;
        if (handle) {
          cropDragRef.current = { start: p, box: { ...b }, handle };
        }
      }
      return;
    }


    if (tool === "eraser") {
      pushUndo();
      const id = crypto.randomUUID();
      setDraws(d => [...d, { id, kind: "path", points: [p], stroke: "rgba(0,0,0,1)", fill: "transparent", fillMode: "stroke", thickness, dashed: strokeKind === "dashed", selected: false }]);
      dragStartRef.current = p;
      lastMoveRef.current = p;
      return;
    }


    if (tool === "pencil") {
      pushUndo();
      const id = crypto.randomUUID();
      setDraws(d => [...d, { id, kind: "path", points: [p], stroke: primary, fill: "transparent", fillMode: "stroke", thickness, dashed: strokeKind === "dashed" }]);
      setSelectedDrawId(id); setSelectedLayerId(null);
      dragStartRef.current = p; lastMoveRef.current = p;
      return;
    }
    if (["line", "rect", "ellipse", "arrow"].includes(tool)) {
      pushUndo();
      dragStartRef.current = p; lastMoveRef.current = p;
      setSelectedDrawId(null); setSelectedLayerId(null);
      return;
    }
    if (tool === "polygon") {
      pushUndo();
      setPolyTemp(t => t.length === 0 ? [p] : [...t, p]);
      setSelectedDrawId(null); setSelectedLayerId(null);
      draw();
      return;
    }


    const hit = hitTest(p);
    if (hit?.type === "draw") {
      selectOnlyDraw(hit.id);
      movingRef.current = { start: p, orig: draws.find(d => d.id === hit.id)! };
    } else if (hit?.type === "layer") {
      selectOnlyLayer(hit.id);
      movingRef.current = { start: p, orig: layers.find(l => l.id === hit.id)! };
    } else {
      clearSelection();
    }
  };

  const onPointerMove: React.PointerEventHandler<HTMLCanvasElement> = (e) => {
    const p = screenToWorld(e.clientX, e.clientY);


    if (panningRef.current) {
      const dx = e.clientX - panLastRef.current.x;
      const dy = e.clientY - panLastRef.current.y;
      panLastRef.current = { x: e.clientX, y: e.clientY };
      setOffset(o => ({ x: o.x + dx, y: o.y + dy })); draw(); return;
    }


    if (tool === "crop" && cropDragRef.current && selectedLayerId) {
      const L = layers.find(x => x.id === selectedLayerId)!;
      let { start, box, handle } = cropDragRef.current;
      let dx = p.x - start.x, dy = p.y - start.y;
      let nx = box.x, ny = box.y, nw = box.w, nh = box.h;
      switch (handle) {
        case "nw": nx = box.x + dx; ny = box.y + dy; nw = box.w - dx; nh = box.h - dy; break;
        case "ne": ny = box.y + dy; nw = box.w + dx; nh = box.h - dy; break;
        case "se": nw = box.w + dx; nh = box.h + dy; break;
        case "sw": nx = box.x + dx; nw = box.w - dx; nh = box.h + dy; break;
      }
      nx = clamp(nx, 0, L.w - 10); ny = clamp(ny, 0, L.h - 10);
      nw = clamp(nw, 10, L.w - nx); nh = clamp(nh, 10, L.h - ny);
      cropBoxRef.current = { x: nx, y: ny, w: nw, h: nh };
      draw(); return;
    }

    if ((tool === "pencil" || tool === "eraser") && dragStartRef.current) {
      setDraws(d => d.map(o => o.id === selectedDrawId ? ({ ...(o as PathObj), points: [...(o as PathObj).points, p] }) : o));
      lastMoveRef.current = p; draw(); return;
    }

    if (dragStartRef.current && ["line", "rect", "ellipse", "arrow"].includes(tool)) {
      lastMoveRef.current = p; draw(); // apenas redesenha com a “moldura” azul? vamos adicionar um overlay rápido:
      const c = canvasRef.current!;
      const g = c.getContext("2d")!;
      g.save(); g.translate(offset.x, offset.y); g.scale(scale, scale);
      g.setLineDash([6 / scale, 4 / scale]); g.strokeStyle = "#5b8cff"; g.lineWidth = Math.max(1, 2 / scale);
      const s = dragStartRef.current;
      if (tool === "line") { g.beginPath(); g.moveTo(s!.x, s!.y); g.lineTo(p.x, p.y); g.stroke(); }
      if (tool === "rect") { g.strokeRect(s!.x, s!.y, p.x - s!.x, p.y - s!.y); }
      if (tool === "ellipse") { g.beginPath(); g.ellipse(s!.x + (p.x - s!.x) / 2, s!.y + (p.y - s!.y) / 2, Math.abs(p.x - s!.x) / 2, Math.abs(p.y - s!.y) / 2, 0, 0, Math.PI * 2); g.stroke(); }
      if (tool === "arrow") drawArrow(g, s!, p, "#5b8cff", Math.max(2, thickness / scale), false);
      g.restore();
      return;
    }

    if (movingRef.current) {
      const d = { x: p.x - movingRef.current.start.x, y: p.y - movingRef.current.start.y };
      if (selectedDrawId) {
        const base = movingRef.current.orig as DrawObj;
        setDraws(objs => objs.map(o => o.id !== selectedDrawId ? o : moveObj(base, d)));
      } else if (selectedLayerId) {
        const base = movingRef.current.orig as ImgLayer;
        setLayers(ls => ls.map(L => L.id !== selectedLayerId ? L : { ...L, x: base.x + d.x, y: base.y + d.y }));
      }
      draw(); return;
    }
  };

  const onPointerUp: React.PointerEventHandler<HTMLCanvasElement> = () => {

    if (tool === "crop") { cropDragRef.current = null; return; }

    if (dragStartRef.current && lastMoveRef.current && ["line", "rect", "ellipse", "arrow"].includes(tool)) {
      const s = dragStartRef.current, e = lastMoveRef.current;
      const id = crypto.randomUUID();
      const base: Omit<DrawBase, "kind"> = { id, stroke: primary, fill: secondary, fillMode, thickness, dashed: strokeKind === "dashed" };
      const obj: DrawObj =
        tool === "line" ? { ...base, kind: "line", a: s, b: e } :
          tool === "rect" ? { ...base, kind: "rect", a: s, b: e } :
            tool === "ellipse" ? { ...base, kind: "ellipse", a: s, b: e } :
              { ...base, kind: "arrow", a: s, b: e };
      setDraws(d => [...d, obj]);
      setSelectedDrawId(id); setSelectedLayerId(null);
      dragStartRef.current = null; lastMoveRef.current = null; draw(); return;
    }

    if (dragStartRef.current && (tool === "pencil" || tool === "eraser")) {
      dragStartRef.current = null; lastMoveRef.current = null; draw(); return;
    }


    if (movingRef.current) { movingRef.current = null; pushUndo(); return; }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") { panningRef.current = true; document.body.classList.add("cursor-grab"); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y")) { e.preventDefault(); redo(); }
      if (tool === "polygon" && e.key === "Enter" && polyTemp.length >= 3) {
        pushUndo();
        const id = crypto.randomUUID();
        const obj: PolyObj = {
          id, kind: "polygon", points: [...polyTemp], stroke: primary, fill: secondary,
          fillMode, thickness, dashed: strokeKind === "dashed"
        };
        setDraws(d => [...d, obj]); setPolyTemp([]); setSelectedDrawId(id); setSelectedLayerId(null); draw();
      }
      if (tool === "polygon" && e.key === "Escape") { setPolyTemp([]); draw(); }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedDrawId) { pushUndo(); setDraws(d => d.filter(x => x.id !== selectedDrawId)); setSelectedDrawId(null); draw(); }
        if (selectedLayerId) { pushUndo(); setLayers(ls => ls.filter(x => x.id !== selectedLayerId)); setSelectedLayerId(null); draw(); }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === "Space") { panningRef.current = false; document.body.classList.remove("cursor-grab"); } };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };

  }, [tool, polyTemp.length, primary, secondary, fillMode, thickness, strokeKind, selectedDrawId, selectedLayerId]);


  const onWheel: React.WheelEventHandler<HTMLCanvasElement> = (e) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const world = screenToWorld(e.clientX, e.clientY);
    const factor = Math.exp((-e.deltaY) * 0.0015);
    const next = clamp(scale * factor, 0.25, 4);
    setScale(next);
    const screenAfter = { x: world.x * next + offset.x, y: world.y * next + offset.y };
    const dx = mouse.x - screenAfter.x, dy = mouse.y - screenAfter.y;
    setOffset(o => ({ x: o.x + dx, y: o.y + dy }));
    draw();
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
  function selectOnlyDraw(id: string) {
    setSelectedDrawId(id); setSelectedLayerId(null);
    setDraws(d => d.map(o => ({ ...o, selected: o.id === id })));
    setLayers(ls => ls.map(L => ({ ...L, selected: false })));
    draw();
  }
  function selectOnlyLayer(id: string) {
    setSelectedLayerId(id); setSelectedDrawId(null);
    setLayers(ls => ls.map(L => ({ ...L, selected: L.id === id })));
    setDraws(d => d.map(o => ({ ...o, selected: false })));
    draw();
  }
  function clearSelection() {
    setSelectedDrawId(null); setSelectedLayerId(null);
    setDraws(d => d.map(o => ({ ...o, selected: false })));
    setLayers(ls => ls.map(L => ({ ...L, selected: false })));
    draw();
  }

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
        setLayers(prev => [...prev, { id: crypto.randomUUID(), img, x, y, w, h }]);
        URL.revokeObjectURL(url); draw();
      };
      img.src = url;
    });
  };

  const clearAll = () => { pushUndo(); setDraws([]); draw(); };

  const save = () => {

    const { W, H } = canvasClientSize();
    const out = document.createElement("canvas");
    out.width = W; out.height = H;
    const g = out.getContext("2d")!;

    g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H);

    g.save();
    g.translate(offset.x, offset.y); g.scale(scale, scale);
    for (const L of layers) {
      const src = L.crop ?? { x: 0, y: 0, w: L.img.width, h: L.img.height };
      g.drawImage(L.img, src.x, src.y, src.w, src.h, L.x, L.y, L.w, L.h);
    }
    for (const D of draws) renderObj(g, D);
    g.restore();
    onSave(out.toDataURL("image/png"), caption);
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
          <button className={tool === "crop" ? "active" : ""} onClick={() => setTool("crop")} aria-label="Cortar">✂️</button>
          <button className={tool === "move" ? "active" : ""} onClick={() => setTool("move")} aria-label="Mover">🖐️</button>
        </div>

        <div className="tool-group" title="Espessura">
          {thicknessSwatches.map(n => (
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
        <div className="spacer" />
        <button onClick={undo} title="Desfazer">↩️</button>
        <button onClick={redo} title="Refazer">↪️</button>
        <button onClick={clearAll} title="Limpar desenhos">🧹</button>
        {tool === "crop" && selectedLayerId && (
          <div className="tool-group" title="Corte">
            <button className="primary" onClick={applyCrop}>Aplicar corte</button>
            <button onClick={() => { cropBoxRef.current = null; draw(); }}>Cancelar</button>
          </div>
        )}
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
          onWheel={onWheel}
        />
      </div>
      <div ref={captionRef} className="legend-row">
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Legenda da imagem (opcional)…"
        />
      </div>
    </div>
  );
}

function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }
function serializeLayers(layers: ImgLayer[]) {
  return layers.map(L => ({
    id: L.id, x: L.x, y: L.y, w: L.w, h: L.h, crop: L.crop,
    src: L.img.src,
  }));
}
