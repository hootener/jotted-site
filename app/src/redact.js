// Pixelation ("redaction") helpers. Pure: no DOM.

export const MIN_BLOCK_PX = 12;

/** Mosaic block size for a region: about 1/8 of its shorter side, never tiny. */
export function blockSizeFor(w, h) {
  return Math.max(MIN_BLOCK_PX, Math.round(Math.min(w, h) / 8));
}

/** Intersection of two {x, y, w, h} rects, or null. */
export function intersectRect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const btm = Math.min(a.y + a.h, b.y + b.h);
  if (r - x <= 0 || btm - y <= 0) return null;
  return { x, y, w: r - x, h: btm - y };
}

export function normalizeRect(x0, y0, x1, y1) {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

export function pointInRect(r, x, y) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/**
 * Pixelate a sub-rectangle of an RGBA buffer in place. Each block becomes the
 * average color of the pixels it covers (so the result is deterministic and
 * can't be undone by zooming in).
 */
export function pixelateRegion(data, width, height, rx, ry, rw, rh, block) {
  const x0 = Math.max(0, Math.floor(rx));
  const y0 = Math.max(0, Math.floor(ry));
  const x1 = Math.min(width, Math.ceil(rx + rw));
  const y1 = Math.min(height, Math.ceil(ry + rh));
  const b = Math.max(1, Math.round(block));
  for (let by = y0; by < y1; by += b) {
    const bh = Math.min(b, y1 - by);
    for (let bx = x0; bx < x1; bx += b) {
      const bw = Math.min(b, x1 - bx);
      let r = 0, g = 0, bl = 0, a = 0, n = 0;
      for (let y = by; y < by + bh; y++) {
        let i = (y * width + bx) * 4;
        for (let x = 0; x < bw; x++, i += 4) {
          r += data[i]; g += data[i + 1]; bl += data[i + 2]; a += data[i + 3]; n++;
        }
      }
      r = Math.round(r / n); g = Math.round(g / n); bl = Math.round(bl / n); a = Math.round(a / n);
      for (let y = by; y < by + bh; y++) {
        let i = (y * width + bx) * 4;
        for (let x = 0; x < bw; x++, i += 4) {
          data[i] = r; data[i + 1] = g; data[i + 2] = bl; data[i + 3] = a;
        }
      }
    }
  }
  return data;
}
