// Export a jot as SVG or PNG, cropped to the ink with padding.
import { strokeOutline, strokeBounds, outlineToPathData, outlineOptions, HIGHLIGHT_ALPHA } from './stroke.js?v=ba1e5667d9';
import { colorForTheme, THEMES } from './palette.js?v=ba1e5667d9';
import { imageBounds, loadImage } from './images.js?v=ba1e5667d9';
import { intersectRect, blockSizeFor, pixelateRegion } from './redact.js?v=ba1e5667d9';
import { shapeBounds, shapeToSVG } from './shapes.js?v=ba1e5667d9';

const PAD = 32;

export function jotBounds(jot) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const bounds = [...jot.strokes.filter((s) => s.points.length).map(strokeBounds), ...(jot.images ?? []).map(imageBounds), ...(jot.shapes ?? []).map(shapeBounds)];
  for (const b of bounds) {
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  return { minX: minX - PAD, minY: minY - PAD, maxX: maxX + PAD, maxY: maxY + PAD };
}

/**
 * Browser only: return a copy of the jot whose images have every redaction
 * pixelated into their pixels, so exports never carry the original data.
 */
export async function bakeRedactions(jot) {
  const redactions = jot.redactions ?? [];
  if (redactions.length === 0 || !(jot.images ?? []).length) return jot;
  const images = [];
  for (const im of jot.images) {
    const rect = { x: im.x, y: im.y, w: im.w, h: im.h };
    const subs = redactions.map((r) => intersectRect(r, rect)).filter(Boolean);
    if (subs.length === 0) { images.push(im); continue; }
    const el = await loadImage(im.src);
    const canvas = document.createElement('canvas');
    canvas.width = el.naturalWidth;
    canvas.height = el.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(el, 0, 0);
    const sx = el.naturalWidth / im.w;
    const sy = el.naturalHeight / im.h;
    for (const sub of subs) {
      const px = Math.floor((sub.x - im.x) * sx), py = Math.floor((sub.y - im.y) * sy);
      const pw = Math.ceil(sub.w * sx), ph = Math.ceil(sub.h * sy);
      const data = ctx.getImageData(px, py, pw, ph);
      pixelateRegion(data.data, pw, ph, 0, 0, pw, ph, blockSizeFor(pw, ph));
      ctx.putImageData(data, px, py);
    }
    images.push({ ...im, src: canvas.toDataURL('image/png') });
  }
  return { ...jot, images, redactions: [] };
}

/**
 * Options: `bounds` overrides the crop (so several passes line up), and
 * `transparent` omits the background rect.
 */
export function jotToSVG(jot, { bounds = null, transparent = false } = {}) {
  const theme = jot.theme ?? 'dark';
  const b = bounds ?? jotBounds(jot);
  const w = Math.ceil(b.maxX - b.minX);
  const h = Math.ceil(b.maxY - b.minY);
  const paths = jot.strokes
    .map((s) => {
      const d = outlineToPathData(strokeOutline(s.points, outlineOptions(s)));
      if (!d) return '';
      const extra = s.kind === 'highlight' ? ` fill-opacity="${HIGHLIGHT_ALPHA}"${theme === 'light' ? ' style="mix-blend-mode:multiply"' : ''}` : '';
      return `  <path fill="${colorForTheme(s.color, theme)}"${extra} d="${d}"/>`;
    })
    .filter(Boolean)
    .join('\n');
  const images = (jot.images ?? [])
    .map((im) => `  <image x="${f(im.x)}" y="${f(im.y)}" width="${f(im.w)}" height="${f(im.h)}" href="${im.src}"/>`)
    .join('\n');
  const shapes = (jot.shapes ?? []).map((sh) => shapeToSVG(sh, theme)).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${f(b.minX)} ${f(b.minY)} ${w} ${h}">
${transparent ? '' : `  <rect x="${f(b.minX)}" y="${f(b.minY)}" width="${w}" height="${h}" fill="${THEMES[theme].bg}"/>\n`}${images ? images + '\n' : ''}${shapes ? shapes + '\n' : ''}${paths}
</svg>
`;
}

/** Renders the jot to a PNG Blob at `scale` device pixels per world unit. */
export async function jotToPNG(jot, drawStroke, scale = 2, drawShapes = null) {
  const theme = jot.theme ?? 'dark';
  const b = jotBounds(jot);
  const w = Math.ceil(b.maxX - b.minX);
  const h = Math.ceil(b.maxY - b.minY);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * scale);
  canvas.height = Math.ceil(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = THEMES[theme].bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, -b.minX * scale, -b.minY * scale);
  for (const im of jot.images ?? []) {
    const el = await loadImage(im.src).catch(() => null);
    if (el) ctx.drawImage(el, im.x, im.y, im.w, im.h);
  }
  drawShapes?.(ctx, jot.shapes ?? [], theme);
  for (const s of jot.strokes) drawStroke(ctx, s, theme);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function f(v) {
  return Number(v.toFixed(2));
}
