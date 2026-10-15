// View transform and canvas rendering helpers.
import { strokeOutline, strokeBounds, outlineOptions, HIGHLIGHT_ALPHA } from './stroke.js?v=94fab66aae';
import { colorForTheme, THEMES } from './palette.js?v=94fab66aae';
import { imageBounds, loadImage } from './images.js?v=94fab66aae';
import { intersectRect, blockSizeFor, pixelateRegion } from './redact.js?v=94fab66aae';
import { arrowPolygon, rectStrokeWidth, textLines, textLineHeight, shapeBounds, TEXT_FONT } from './shapes.js?v=94fab66aae';

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

export function drawStroke(ctx, stroke, theme = 'dark') {
  const outline = strokeOutline(stroke.points, outlineOptions(stroke));
  if (outline.length === 0) return;
  ctx.fillStyle = colorForTheme(stroke.color, theme);
  if (stroke.kind === 'highlight') {
    ctx.save();
    ctx.globalAlpha = HIGHLIGHT_ALPHA;
    // Multiply reads like real marker on white; plain blending works on black.
    if (theme === 'light') ctx.globalCompositeOperation = 'multiply';
    ctx.fill(pathFromOutline(outline));
    ctx.restore();
    return;
  }
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
export function drawStrokes(ctx, strokes, view, cssWidth, cssHeight, theme = 'dark') {
  const [vx0, vy0] = view.screenToWorld(0, 0);
  const [vx1, vy1] = view.screenToWorld(cssWidth, cssHeight);
  for (const s of strokes) {
    if (s.points.length === 0) continue;
    const b = strokeBounds(s);
    if (b.maxX < vx0 || b.minX > vx1 || b.maxY < vy0 || b.minY > vy1) continue;
    drawStroke(ctx, s, theme);
  }
}

/** Render a jot's strokes fitted into a small canvas for the list page. */
export function renderThumbnail(jot, width, height, cache = null) {
  const canvas = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  const theme = jot.theme ?? 'dark';
  ctx.scale(dpr, dpr);
  ctx.fillStyle = THEMES[theme].bg;
  ctx.fillRect(0, 0, width, height);
  const images = jot.images ?? [];
  const shapes = jot.shapes ?? [];
  if (jot.strokes.length === 0 && images.length === 0 && shapes.length === 0) return canvas;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of [...jot.strokes.map(strokeBounds), ...images.map(imageBounds), ...shapes.map(shapeBounds)]) {
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
  if (cache) {
    for (const im of images) {
      const el = cache.get(im.src);
      if (el) ctx.drawImage(el, im.x, im.y, im.w, im.h);
    }
    drawRedactions(ctx, images, jot.redactions ?? [], cache);
  }
  drawShapes(ctx, jot.shapes ?? [], theme);
  for (const s of jot.strokes) drawStroke(ctx, s, theme);
  return canvas;
}

export const PAPER_MODES = ['none', 'grid', 'lines', 'dots'];
const PAPER_SPACING = 40; // world units, roughly a ruled-paper line gap at 100%

/**
 * Draw subtle ruled paper behind the strokes. Rendered in screen space so
 * lines stay crisp at any zoom; spacing doubles as you zoom out so the
 * pattern never gets dense.
 */
export function drawPaper(ctx, view, mode, cssWidth, cssHeight, dpr, theme = 'dark') {
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
    ctx.fillStyle = THEMES[theme].paperDot;
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

  ctx.strokeStyle = THEMES[theme].paperLine;
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

/**
 * Image layer cache: data URL -> HTMLImageElement. Images that are still
 * loading are skipped this frame; `onLoad` is called so the caller can redraw.
 */
export function createImageCache(onLoad) {
  const cache = new Map();
  return {
    get(src) {
      const hit = cache.get(src);
      if (hit) return hit.img;
      const entry = { img: null };
      cache.set(src, entry);
      loadImage(src).then((img) => {
        entry.img = img;
        onLoad?.();
      }).catch(() => cache.delete(src));
      return null;
    },
  };
}

/** Draw image layers that intersect the visible world rect. */
export function drawImages(ctx, images, view, cssWidth, cssHeight, cache) {
  const [vx0, vy0] = view.screenToWorld(0, 0);
  const [vx1, vy1] = view.screenToWorld(cssWidth, cssHeight);
  for (const im of images) {
    const b = imageBounds(im);
    if (b.maxX < vx0 || b.minX > vx1 || b.maxY < vy0 || b.minY > vy1) continue;
    const el = cache.get(im.src);
    if (el) ctx.drawImage(el, im.x, im.y, im.w, im.h);
  }
}

/**
 * Pixelated patch for one redaction over one image, in image pixels, cached
 * by the rect's geometry so panning and zooming never recompute it.
 */
const patchCache = new Map();
function pixelPatch(el, im, sub, key) {
  const hit = patchCache.get(key);
  if (hit) return hit;
  const sx = el.naturalWidth / im.w;
  const sy = el.naturalHeight / im.h;
  const px = Math.floor((sub.x - im.x) * sx);
  const py = Math.floor((sub.y - im.y) * sy);
  const pw = Math.max(1, Math.ceil(sub.w * sx));
  const ph = Math.max(1, Math.ceil(sub.h * sy));
  const off = document.createElement('canvas');
  off.width = pw;
  off.height = ph;
  const octx = off.getContext('2d');
  octx.drawImage(el, px, py, pw, ph, 0, 0, pw, ph);
  const data = octx.getImageData(0, 0, pw, ph);
  pixelateRegion(data.data, pw, ph, 0, 0, pw, ph, blockSizeFor(pw, ph));
  octx.putImageData(data, 0, 0);
  if (patchCache.size > 200) patchCache.clear();
  patchCache.set(key, off);
  return off;
}

/** Draw every redaction's pixelated patches over the images they cover. */
export function drawRedactions(ctx, images, redactions, cache) {
  for (const r of redactions) {
    for (const im of images) {
      const sub = intersectRect(r, imageBounds(im) && { x: im.x, y: im.y, w: im.w, h: im.h });
      if (!sub) continue;
      const el = cache.get(im.src);
      if (!el) continue;
      const key = `${im.id}|${im.x},${im.y},${im.w},${im.h}|${sub.x},${sub.y},${sub.w},${sub.h}`;
      ctx.drawImage(pixelPatch(el, im, sub, key), sub.x, sub.y, sub.w, sub.h);
    }
  }
}

/** Draw box, arrow and text annotations (above images, below ink). */
export function drawShapes(ctx, shapes, theme = 'dark') {
  for (const s of shapes) {
    const color = colorForTheme(s.color, theme);
    if (s.type === 'rect') {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = rectStrokeWidth(s.size);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.roundRect(s.x, s.y, s.w, s.h, 4);
      ctx.stroke();
      ctx.restore();
    } else if (s.type === 'arrow') {
      const pts = arrowPolygon(s);
      ctx.save();
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else if (s.type === 'text') {
      ctx.save();
      ctx.font = `700 ${s.fontSize}px ${TEXT_FONT}`;
      ctx.textBaseline = 'alphabetic';
      ctx.lineJoin = 'round';
      ctx.lineWidth = s.fontSize * 0.14;
      ctx.strokeStyle = THEMES[theme].bg;
      ctx.fillStyle = color;
      const lh = textLineHeight(s.fontSize);
      textLines(s).forEach((line, i) => {
        const y = s.y + s.fontSize + i * lh;
        ctx.strokeText(line, s.x, y);
        ctx.fillText(line, s.x, y);
      });
      ctx.restore();
    }
  }
}
