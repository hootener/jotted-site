// View transform and canvas rendering helpers.
import { strokeOutline, strokeBounds } from './stroke.js';

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 16;

/** Pan/zoom state: screen = world * scale + (x, y). */
export class View {
  constructor({ x = 0, y = 0, scale = 1 } = {}) {
    this.x = x;
    this.y = y;
    this.scale = scale;
  }
  screenToWorld(sx, sy) {
    return [(sx - this.x) / this.scale, (sy - this.y) / this.scale];
  }
  worldToScreen(wx, wy) {
    return [wx * this.scale + this.x, wy * this.scale + this.y];
  }
  panBy(dx, dy) {
    this.x += dx;
    this.y += dy;
  }
  /** Zoom by `factor` keeping the screen point (sx, sy) fixed. */
  zoomAt(sx, sy, factor) {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
    const f = next / this.scale;
    this.x = sx - (sx - this.x) * f;
    this.y = sy - (sy - this.y) * f;
    this.scale = next;
  }
  reset() {
    this.x = 0;
    this.y = 0;
    this.scale = 1;
  }
  toJSON() {
    return { x: this.x, y: this.y, scale: this.scale };
  }
}

/** Build a smooth Path2D from an outline polygon using midpoint quadratics. */
export function pathFromOutline(outline) {
  const path = new Path2D();
  const n = outline.length;
  if (n < 3) return path;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let m = mid(outline[0], outline[1]);
  path.moveTo(m[0], m[1]);
  for (let i = 1; i <= n; i++) {
    const a = outline[i % n];
    const b = outline[(i + 1) % n];
    m = mid(a, b);
    path.quadraticCurveTo(a[0], a[1], m[0], m[1]);
  }
  path.closePath();
  return path;
}

export function drawStroke(ctx, stroke) {
  const outline = strokeOutline(stroke.points, { size: stroke.size });
  if (outline.length === 0) return;
  ctx.fillStyle = stroke.color;
  ctx.fill(pathFromOutline(outline));
}

/** Size a canvas to its CSS box at device pixel ratio. Returns the dpr. */
export function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return dpr;
}

/** Clear and apply the view transform (dpr-aware) to a canvas context. */
export function beginFrame(ctx, view, dpr) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y);
}

/** Draw only strokes whose bounds intersect the visible world rect. */
export function drawStrokes(ctx, strokes, view, cssWidth, cssHeight) {
  const [vx0, vy0] = view.screenToWorld(0, 0);
  const [vx1, vy1] = view.screenToWorld(cssWidth, cssHeight);
  for (const s of strokes) {
    if (s.points.length === 0) continue;
    const b = strokeBounds(s);
    if (b.maxX < vx0 || b.minX > vx1 || b.maxY < vy0 || b.minY > vy1) continue;
    drawStroke(ctx, s);
  }
}

/** Render a jot's strokes fitted into a small canvas for the list page. */
export function renderThumbnail(jot, width, height) {
  const canvas = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  if (jot.strokes.length === 0) return canvas;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of jot.strokes) {
    const b = strokeBounds(s);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  const pad = 10;
  const scale = Math.min((width - pad * 2) / (maxX - minX || 1), (height - pad * 2) / (maxY - minY || 1), 2);
  const ox = (width - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = (height - (maxY - minY) * scale) / 2 - minY * scale;
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
  for (const s of jot.strokes) drawStroke(ctx, s);
  return canvas;
}

export const PAPER_MODES = ['none', 'grid', 'lines', 'dots'];
const PAPER_SPACING = 40; // world units, roughly a ruled-paper line gap at 100%
const PAPER_LINE = 'rgba(255, 255, 255, 0.07)';
const PAPER_DOT = 'rgba(255, 255, 255, 0.22)';

/**
 * Draw subtle ruled paper behind the strokes. Rendered in screen space so
 * lines stay crisp at any zoom; spacing doubles as you zoom out so the
 * pattern never gets dense.
 */
export function drawPaper(ctx, view, mode, cssWidth, cssHeight, dpr) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  if (mode === 'none') return;

  let spacing = PAPER_SPACING;
  while (spacing * view.scale < 24) spacing *= 2;
  while (spacing * view.scale > 96) spacing /= 2;
  const step = spacing * view.scale;

  // First grid line at or before the left/top edge, in screen pixels.
  const x0 = ((view.x % step) + step) % step;
  const y0 = ((view.y % step) + step) % step;

  if (mode === 'dots') {
    ctx.fillStyle = PAPER_DOT;
    const r = Math.min(1.6, Math.max(1, step / 32));
    for (let y = y0; y <= cssHeight; y += step) {
      for (let x = x0; x <= cssWidth; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return;
  }

  ctx.strokeStyle = PAPER_LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = y0; y <= cssHeight; y += step) {
    const py = Math.round(y) + 0.5;
    ctx.moveTo(0, py);
    ctx.lineTo(cssWidth, py);
  }
  if (mode === 'grid') {
    for (let x = x0; x <= cssWidth; x += step) {
      const px = Math.round(x) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, cssHeight);
    }
  }
  ctx.stroke();
}
