// Image layer helpers (pure where possible).

export const MAX_IMAGE_PX = 2500; // longest side after import

/**
 * Where to put an image of (w, h) pixels so it fits inside the visible
 * world rect, centred at (cx, cy), never upscaled. Returns {x, y, w, h}.
 */
export function fitPlacement(w, h, viewW, viewH, cx, cy, fill = 0.9) {
  const scale = Math.min(1, (viewW * fill) / w, (viewH * fill) / h);
  const fw = w * scale;
  const fh = h * scale;
  return { x: round(cx - fw / 2), y: round(cy - fh / 2), w: round(fw), h: round(fh) };
}

export function pointInImage(img, x, y) {
  return x >= img.x && x <= img.x + img.w && y >= img.y && y <= img.y + img.h;
}

export function imageBounds(img) {
  return { minX: img.x, minY: img.y, maxX: img.x + img.w, maxY: img.y + img.h };
}

let seq = 0;
export function imageId() {
  return `${Date.now().toString(36)}${(seq++).toString(36)}`;
}

/** Browser-only: read a Blob/File into a downscaled PNG/JPEG data URL + size. */
export async function blobToImageData(blob, maxPx = MAX_IMAGE_PX) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  // Photos compress far better as JPEG; keep PNG for everything else (screenshots, text).
  const isPhoto = /jpe?g/i.test(blob.type);
  const src = isPhoto ? canvas.toDataURL('image/jpeg', 0.88) : canvas.toDataURL('image/png');
  return { src, w, h };
}

/** Browser-only: load a data URL into an HTMLImageElement. */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function round(v) {
  return Math.round(v * 100) / 100;
}
