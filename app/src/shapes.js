// Box, arrow and text annotations. Pure geometry and SVG; drawing lives in canvas.js.
import { colorForTheme, THEMES } from './palette.js?v=2457eabff9';

export const TEXT_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
export const TEXT_SIZES = { small: 18, medium: 24, large: 32, highlight: 32 };

export function rectStrokeWidth(size) {
  return Math.max(2, size * 1.1);
}

/** Polygon (world coords) for a tapered arrow: thin tail, wide shaft, big head. */
export function arrowPolygon(s) {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const headLen = Math.min(len * 0.5, Math.max(18, s.size * 4.5));
  const headW = Math.max(14, s.size * 3.2);
  const tailW = Math.max(1.5, s.size * 0.35);
  const shaftW = Math.max(4, s.size * 1.3);
  const bx = s.x2 - ux * headLen;
  const by = s.y2 - uy * headLen;
  return [
    [s.x1 + nx * tailW / 2, s.y1 + ny * tailW / 2],
    [bx + nx * shaftW / 2, by + ny * shaftW / 2],
    [bx + nx * headW / 2, by + ny * headW / 2],
    [s.x2, s.y2],
    [bx - nx * headW / 2, by - ny * headW / 2],
    [bx - nx * shaftW / 2, by - ny * shaftW / 2],
    [s.x1 - nx * tailW / 2, s.y1 - ny * tailW / 2],
  ];
}

export function shapeBounds(s) {
  if (s.type === 'arrow') {
    const pts = arrowPolygon(s);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }
  const pad = s.type === 'rect' ? rectStrokeWidth(s.size) : 0;
  return { minX: s.x - pad, minY: s.y - pad, maxX: s.x + s.w + pad, maxY: s.y + s.h + pad };
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** True if (x, y) is on the shape: a box's border, an arrow's body, a text's box. */
export function hitTestShape(s, x, y, tol = 0) {
  if (s.type === 'text') {
    return x >= s.x - tol && x <= s.x + s.w + tol && y >= s.y - tol && y <= s.y + s.h + tol;
  }
  if (s.type === 'rect') {
    const reach = rectStrokeWidth(s.size) / 2 + tol;
    const edges = [
      [s.x, s.y, s.x + s.w, s.y], [s.x + s.w, s.y, s.x + s.w, s.y + s.h],
      [s.x + s.w, s.y + s.h, s.x, s.y + s.h], [s.x, s.y + s.h, s.x, s.y],
    ];
    return edges.some(([ax, ay, bx, by]) => distToSegment(x, y, ax, ay, bx, by) <= reach);
  }
  if (s.type === 'arrow') {
    const reach = Math.max(6, s.size * 1.6) + tol;
    return distToSegment(x, y, s.x1, s.y1, s.x2, s.y2) <= reach;
  }
  return false;
}

export function moveShape(s, dx, dy) {
  if (s.type === 'arrow') { s.x1 += dx; s.y1 += dy; s.x2 += dx; s.y2 += dy; }
  else { s.x += dx; s.y += dy; }
}

export function textLines(s) {
  return String(s.text ?? '').split('\n');
}

export function textLineHeight(fontSize) {
  return Math.round(fontSize * 1.25);
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function shapeToSVG(s, theme = 'dark') {
  const color = colorForTheme(s.color, theme);
  const f = (v) => Number(v.toFixed(2));
  if (s.type === 'rect') {
    return `  <rect x="${f(s.x)}" y="${f(s.y)}" width="${f(s.w)}" height="${f(s.h)}" rx="4" fill="none" stroke="${color}" stroke-width="${f(rectStrokeWidth(s.size))}" stroke-linejoin="round"/>`;
  }
  if (s.type === 'arrow') {
    const d = arrowPolygon(s).map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('') + 'Z';
    return `  <path d="${d}" fill="${color}" stroke="${color}" stroke-width="1" stroke-linejoin="round"/>`;
  }
  if (s.type === 'text') {
    const lh = textLineHeight(s.fontSize);
    const outline = THEMES[theme].bg;
    const lines = textLines(s).map((line, i) => `<tspan x="${f(s.x)}" y="${f(s.y + s.fontSize + i * lh)}">${esc(line) || ' '}</tspan>`).join('');
    return `  <text font-family='${TEXT_FONT}' font-weight="700" font-size="${s.fontSize}" fill="${color}" stroke="${outline}" stroke-width="${f(s.fontSize * 0.14)}" stroke-linejoin="round" paint-order="stroke">${lines}</text>`;
  }
  return '';
}
