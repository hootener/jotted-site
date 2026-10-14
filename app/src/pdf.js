// Renders PDF pages to PNG data URLs using a vendored pdf.js (loaded lazily).
const PAGE_WIDTH_PX = 1600;
export const MAX_PAGES = 20;

let pdfjsPromise = null;
function pdfjs() {
  pdfjsPromise ??= import('../vendor/pdfjs/pdf.min.mjs?v=c63f95468c').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
    return lib;
  });
  return pdfjsPromise;
}

/** Returns [{src, w, h}] for up to MAX_PAGES pages. */
export async function renderPdfPages(file, onProgress) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const n = Math.min(doc.numPages, MAX_PAGES);
  const pages = [];
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: PAGE_WIDTH_PX / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push({ src: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height });
    onProgress?.(i, n);
  }
  return { pages, total: doc.numPages };
}
