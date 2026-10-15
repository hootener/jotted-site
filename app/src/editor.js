// Jot editor: full-screen pen canvas with pan/zoom, undo, autosave.
import { View, fitCanvas, beginFrame, drawStrokes, drawStroke, drawImages, drawRedactions, drawShapes, drawPaper, createImageCache, PAPER_MODES } from './canvas.js?v=98e8dfa53d';
import { normalizeRect, pointInRect } from './redact.js?v=98e8dfa53d';
import { hitTestShape, moveShape, shapeBounds, textLines, textLineHeight, TEXT_FONT, TEXT_SIZES } from './shapes.js?v=98e8dfa53d';
import { fitPlacement, pointInImage, imageId, blobToImageData, loadImage } from './images.js?v=98e8dfa53d';
import { createSmoother, simulatePressure, hitTestStroke, strokeBounds, PEN_SIZES } from './stroke.js?v=98e8dfa53d';
import { PALETTE, colorForTheme } from './palette.js?v=98e8dfa53d';
import { jotToSVG, jotToPNG, downloadBlob, bakeRedactions } from './export.js?v=98e8dfa53d';
import { cleanName, defaultName } from './names.js?v=98e8dfa53d';
import { toggleShortcuts } from './shortcuts.js?v=98e8dfa53d';

const SAVE_DELAY_MS = 400;
// Platform convention: Cmd on macOS, Ctrl elsewhere.
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform) || navigator.userAgentData?.platform === 'macOS';
const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl+';
const CAP = (k) => (IS_MAC ? `⇧⌘${k}` : `Ctrl+Shift+${k}`);
const PREFS_KEY = 'jotted:prefs';

export function mountEditor(root, store, jot) {
  const prefs = loadPrefs();
  const view = new View(jot.view);
  const strokes = jot.strokes;
  // actions: { type: 'add', stroke } | { type: 'clear', strokes }
  //        | { type: 'erase', items: [{ index, stroke }] } | { type: 'move', dx, dy }
  //        | { type: 'image', image } | { type: 'images', images }
  //        | { type: 'removeImage', image, index }
  //        | { type: 'redact', redaction } | { type: 'unredact', redaction, index }
  //        | { type: 'shape', shape } | { type: 'removeShape', shape, index }
  //        | { type: 'moveShape', shape, dx, dy } | { type: 'editText', shape, before, after }
  //        | { type: 'moveItem', sel: { kind, item }, dx, dy }
  //        | { type: 'imageEdit', image, before: {x,y,w,h,src}, after }
  const undoStack = [];
  const redoStack = [];
  let color = prefs.color;
  let sizeKey = prefs.size;

  root.innerHTML = `
    <div class="editor">
      <canvas class="layer paper"></canvas>
      <canvas class="layer base"></canvas>
      <canvas class="layer live"></canvas>
      <header class="hud top">
        <a class="btn ghost" href="#/" title="All jots (Esc)">‹ Jots</a>
        <input class="jot-name" type="text" value="" title="Jot name (click to rename)" aria-label="Jot name" spellcheck="false" maxlength="80">
        <span class="spacer"></span>
        <span class="save-state" aria-live="polite"></span>
        <button class="btn ghost zoom" title="Reset view (0)">100%</button>
      </header>
      <footer class="hud bottom">
        <div class="toolbar">
          <div class="group colors">
            <button class="btn icon pick pick-color" title="Color" aria-haspopup="true" aria-expanded="false"><span class="dot"></span></button>
            <div class="swatches popover" role="radiogroup" aria-label="Pen color"></div>
          </div>
          <div class="group sizes-group">
            <button class="btn icon pick pick-size" title="Pen size" aria-haspopup="true" aria-expanded="false"><span class="dot"></span></button>
            <div class="sizes popover" role="radiogroup" aria-label="Pen size"></div>
          </div>
          <span class="divider"></span>
          <div class="group shapes" role="group" aria-label="Annotations">
            <button class="btn icon pick pick-annot" title="Box, arrow, text, pixelate" aria-haspopup="true" aria-expanded="false" aria-pressed="false"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></button>
            <div class="annot-menu popover" role="menu">
              <button class="btn icon shape-btn" data-tool="rect" title="Box (B)" aria-pressed="false"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></button>
              <button class="btn icon shape-btn" data-tool="arrow" title="Arrow (A)" aria-pressed="false"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2 13.5L10.8 5.2M13.5 2.5l-1 5.2-4.2-4.2z" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
              <button class="btn icon shape-btn" data-tool="text" title="Text (T)" aria-pressed="false"><span class="glyph-t" aria-hidden="true">T</span></button>
              <button class="btn icon shape-btn" data-tool="redact" title="Pixelate: drag a box over an image (R)" aria-pressed="false"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="2" y="2" width="5" height="5" fill="currentColor"/><rect x="9" y="2" width="5" height="5" fill="currentColor" opacity=".55"/><rect x="2" y="9" width="5" height="5" fill="currentColor" opacity=".55"/><rect x="9" y="9" width="5" height="5" fill="currentColor"/></svg></button>
            </div>
            <button class="btn icon shape-btn" data-tool="select" title="Select and move (V)" aria-pressed="false"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 1.5l9.5 8.2-4.2.6 2.4 4.4-1.8 1-2.4-4.5L3 14z" fill="currentColor" stroke="currentColor" stroke-width="0.6" stroke-linejoin="round"/></svg></button>
          </div>
          <span class="divider"></span>
          <div class="group history">
            <button class="btn icon undo" title="Undo (${MOD_LABEL}Z)" aria-label="Undo">↶</button>
            <button class="btn icon redo" title="Redo (Shift+${MOD_LABEL}Z)" aria-label="Redo">↷</button>
          </div>
          <div class="group capture" hidden>
            <span class="divider"></span>
            <button class="btn icon cap-btn" data-cap="area" title="Capture an area (${CAP('J')})" aria-label="Capture area"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="5" y="5" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 1.5"/></svg></button>
            <button class="btn icon cap-btn" data-cap="full" title="Capture the full screen (${CAP('F')})" aria-label="Capture full screen"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5.5 14h5M8 11.5V14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
            <button class="btn cap-delay" title="Capture delay: wait this long before the shot" aria-label="Capture delay">0s</button>
            <button class="btn icon cap-btn" data-cap="again" title="Capture the last area again (${CAP('R')})" aria-label="Capture last area again"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3.2 9.2A5 5 0 1 0 4.5 4.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M4.2 1.8v3.3h3.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          </div>
          <span class="divider"></span>
          <div class="group actions">
            <button class="btn paper-btn" title="Paper: none / grid / lines / dots (G)"></button>
            <button class="btn icon theme-btn" title="Light / dark canvas (L)" aria-label="Toggle light canvas"></button>
            <div class="add-wrap">
              <button class="btn add-btn" title="Add an image, PDF or web page" aria-haspopup="true" aria-expanded="false">Add</button>
              <div class="add-menu popover" role="menu">
                <button class="btn" data-add="file" role="menuitem">Image or PDF…</button>
                <button class="btn" data-add="snapshot" role="menuitem" hidden>Web page…</button>
              </div>
              <input class="file-input" type="file" accept="image/*,application/pdf" multiple hidden>
            </div>
            <div class="export-wrap">
              <button class="btn export-btn" title="Export (${MOD_LABEL}E for PNG, Shift+${MOD_LABEL}E for SVG)" aria-haspopup="true" aria-expanded="false">Export</button>
              <div class="export-menu popover" role="menu">
                <button class="btn" data-format="png" role="menuitem">PNG</button>
                <button class="btn" data-format="svg" role="menuitem">SVG</button>
              </div>
            </div>
            <button class="btn icon help-btn" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">?</button>
            <span class="divider"></span>
            <button class="btn clear" title="Clear this jot (Delete)">Clear</button>
            <div class="more-wrap">
              <button class="btn icon more-btn" title="More" aria-label="More" aria-haspopup="true" aria-expanded="false">⋯</button>
              <div class="more-menu popover" role="menu">
                <button class="btn" data-more="paper" role="menuitem">Paper</button>
                <button class="btn" data-more="theme" role="menuitem">Light canvas</button>
                <button class="btn" data-more="add" role="menuitem">Add image or PDF…</button>
                <button class="btn cap-only" data-more="cap-area" role="menuitem" hidden>Capture an area</button>
                <button class="btn cap-only" data-more="cap-full" role="menuitem" hidden>Capture full screen</button>
                <button class="btn cap-only" data-more="cap-again" role="menuitem" hidden>Capture last area again</button>
                <button class="btn cap-only" data-more="cap-delay" role="menuitem" hidden>Capture delay: 0s</button>
                <button class="btn" data-more="png" role="menuitem">Export PNG</button>
                <button class="btn" data-more="svg" role="menuitem">Export SVG</button>
                <button class="btn" data-more="shortcuts" role="menuitem">Keyboard shortcuts</button>
                <button class="btn danger" data-more="clear" role="menuitem">Clear jot</button>
              </div>
            </div>
          </div>
        </div>
      </footer>
      <div class="toast" aria-live="polite"></div>
      <textarea class="text-editor" hidden rows="1" spellcheck="false" aria-label="Annotation text"></textarea>
      <div class="img-tools" hidden>
        <button class="btn icon" data-imgtool="resize" title="Resize"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 14V9M2 14h5M14 2v5M14 2H9M2 14L14 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button class="btn icon" data-imgtool="crop" title="Crop"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 1v11h11M1 4h11v11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>
      <div class="drop-hint" hidden>Drop to add</div>
      <form class="snapshot-dialog" hidden>
        <label>Web page URL <input name="url" type="url" placeholder="https://example.com" required autocomplete="off"></label>
        <label>Width
          <select name="width"><option value="1280">Desktop (1280)</option><option value="390">Phone (390)</option></select>
        </label>
        <div class="row"><button type="button" class="btn cancel">Cancel</button><button type="submit" class="btn primary">Snapshot</button></div>
      </form>
    </div>`;

  const el = root.firstElementChild;
  const paper = el.querySelector('.layer.paper');
  const paperCtx = paper.getContext('2d');
  const base = el.querySelector('.base');
  const live = el.querySelector('.live');
  const baseCtx = base.getContext('2d');
  const liveCtx = live.getContext('2d');
  const zoomBtn = el.querySelector('.zoom');
  const saveState = el.querySelector('.save-state');
  const undoBtn = el.querySelector('.undo');
  const redoBtn = el.querySelector('.redo');
  const clearBtn = el.querySelector('.clear');
  const paperBtn = el.querySelector('.paper-btn');
  const toast = el.querySelector('.toast');
  const nameInput = el.querySelector('.jot-name');
  const pickColor = el.querySelector('.pick-color');
  const pickSize = el.querySelector('.pick-size');
  const themeBtn = el.querySelector('.theme-btn');
  const exportBtn = el.querySelector('.export-btn');
  const exportWrap = el.querySelector('.export-wrap');
  const addBtn = el.querySelector('.add-btn');
  const pickAnnot = el.querySelector('.pick-annot');
  const annotWrap = pickAnnot.parentElement;
  const redactions = jot.redactions;
  const moreWrap = el.querySelector('.more-wrap');
  const moreBtn = el.querySelector('.more-btn');
  const addWrap = el.querySelector('.add-wrap');
  const fileInput = el.querySelector('.file-input');
  const dropHint = el.querySelector('.drop-hint');
  const snapDialog = el.querySelector('.snapshot-dialog');
  const images = jot.images;
  const imageCache = createImageCache(() => { baseDirty = true; requestRender(); });
  const swatches = el.querySelector('.swatches');
  const sizes = el.querySelector('.sizes');

  // ---- Toolbar -----------------------------------------------------------
  PALETTE.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.title = `${c.name} (${i + 1})`;
    b.setAttribute('role', 'radio');
    b.dataset.hex = c.hex;
    b.addEventListener('click', () => setColor(c.hex));
    swatches.append(b);
  });
  const eraserSwatch = document.createElement('button');
  eraserSwatch.className = 'swatch eraser-swatch';
  eraserSwatch.title = 'Eraser: tap or drag over strokes (E; or hold right-click or Alt)';
  eraserSwatch.setAttribute('role', 'radio');
  eraserSwatch.setAttribute('aria-label', 'Eraser');
  eraserSwatch.addEventListener('click', () => {
    setTool('eraser');
    closePopovers();
  });
  swatches.append(eraserSwatch);
  for (const key of Object.keys(PEN_SIZES)) {
    const b = document.createElement('button');
    b.className = 'size';
    b.title = key === 'highlight' ? 'Highlighter' : `${key[0].toUpperCase()}${key.slice(1)} pen`;
    b.setAttribute('role', 'radio');
    b.dataset.size = key;
    b.innerHTML = `<span style="--d:${PEN_SIZES[key] * 2}px"></span>`;
    b.addEventListener('click', () => setSize(key));
    sizes.append(b);
  }
  themeBtn.addEventListener('click', () => setTheme(jot.theme === 'light' ? 'dark' : 'light'));
  exportBtn.addEventListener('click', () => togglePopover(exportWrap));
  addBtn.addEventListener('click', () => togglePopover(addWrap));
  for (const b of el.querySelectorAll('.shape-btn')) {
    b.addEventListener('click', () => {
      setTool(tool === b.dataset.tool ? 'pen' : b.dataset.tool);
      closePopovers();
    });
  }
  pickAnnot.addEventListener('click', () => togglePopover(annotWrap));
  el.querySelector('.help-btn').addEventListener('click', () => toggleShortcuts(true));
  // Capture delay (desktop): 0 / 3 / 5 / 10 seconds, remembered.
  const DELAYS = [0, 3, 5, 10];
  let captureDelay = Number(localStorage.getItem('jotted:captureDelay')) || 0;
  function renderCaptureDelay() {
    const label = `${captureDelay}s`;
    const b = el.querySelector('.cap-delay');
    b.textContent = captureDelay ? `⏱ ${label}` : label;
    b.setAttribute('aria-pressed', String(captureDelay > 0));
    el.querySelector('[data-more="cap-delay"]').textContent = `Capture delay: ${label}`;
  }
  function cycleCaptureDelay() {
    captureDelay = DELAYS[(DELAYS.indexOf(captureDelay) + 1) % DELAYS.length];
    try { localStorage.setItem('jotted:captureDelay', String(captureDelay)); } catch { /* ignore */ }
    globalThis.jotted?.setCaptureDelay?.(captureDelay);
    renderCaptureDelay();
  }
  if (globalThis.jotted?.captureArea) {
    el.querySelector('.group.capture').hidden = false;
    el.querySelector('.cap-delay').addEventListener('click', cycleCaptureDelay);
    globalThis.jotted.setCaptureDelay?.(captureDelay);
    renderCaptureDelay();
    for (const b of el.querySelectorAll('.cap-only')) b.hidden = false;
    const fns = { area: () => globalThis.jotted.captureArea(), full: () => globalThis.jotted.captureFull(), again: () => globalThis.jotted.captureAgain() };
    for (const b of el.querySelectorAll('.cap-btn')) b.addEventListener('click', () => { closePopovers(); fns[b.dataset.cap](); });
  }
  const shapes = jot.shapes;
  const textEditor = el.querySelector('.text-editor');
  const imgTools = el.querySelector('.img-tools');
  moreBtn.addEventListener('click', () => togglePopover(moreWrap));
  for (const b of el.querySelectorAll('.more-menu button')) {
    b.addEventListener('click', () => {
      const what = b.dataset.more;
      if (what === 'paper') { cyclePaper(1); return; } // stays open so the label is visible
      closePopovers();
      if (what === 'theme') setTheme(jot.theme === 'light' ? 'dark' : 'light');
      else if (what === 'add') fileInput.click();
      else if (what === 'shortcuts') toggleShortcuts(true);
      else if (what === 'cap-area') globalThis.jotted?.captureArea();
      else if (what === 'cap-full') globalThis.jotted?.captureFull();
      else if (what === 'cap-again') globalThis.jotted?.captureAgain();
      else if (what === 'cap-delay') { cycleCaptureDelay(); return; } // stays open to show the new value

      else if (what === 'png' || what === 'svg') exportJot(what);
      else if (what === 'clear') clearJot();
    });
  }
  el.querySelector('[data-add="file"]').addEventListener('click', () => { closePopovers(); fileInput.click(); });
  const snapItem = el.querySelector('[data-add="snapshot"]');
  if (globalThis.jotted?.snapshot) {
    snapItem.hidden = false;
    snapItem.addEventListener('click', () => { closePopovers(); openSnapshotDialog(); });
  }
  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    await addFiles(files);
  });
  snapDialog.querySelector('.cancel').addEventListener('click', () => { snapDialog.hidden = true; });
  snapDialog.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = snapDialog.url.value.trim();
    const width = Number(snapDialog.width.value);
    snapDialog.hidden = true;
    await addSnapshot(url, width);
  });
  for (const b of el.querySelectorAll('.export-menu button')) {
    b.addEventListener('click', () => exportJot(b.dataset.format));
  }
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);
  clearBtn.addEventListener('click', clearJot);
  paperBtn.addEventListener('click', () => cyclePaper(1));
  zoomBtn.addEventListener('click', () => {
    view.reset();
    onViewChanged();
  });

  let tool = 'pen'; // 'pen' | 'eraser' | 'redact' | 'rect' | 'arrow' | 'text' | 'select'
  const SHAPE_TOOLS = ['rect', 'arrow', 'text'];
  function setTool(next) {
    if (tool === 'text' && next !== 'text') commitTextEdit();
    if (next !== 'select') setSelected(null);
    tool = next;
    el.classList.toggle('select-mode', tool === 'select');
    positionImageTools();
    const erasing = tool === 'eraser';
    el.classList.toggle('erasing-mode', erasing);
    el.classList.toggle('redact-mode', tool === 'redact');
    el.classList.toggle('shape-mode', SHAPE_TOOLS.includes(tool));
    for (const b of el.querySelectorAll('.shape-btn')) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    // The mobile annotation picker shows the last-used annotation tool's icon.
    const annotTools = ['rect', 'arrow', 'text', 'redact'];
    if (annotTools.includes(tool)) pickAnnot.innerHTML = el.querySelector(`.annot-menu [data-tool="${tool}"]`).innerHTML;
    pickAnnot.setAttribute('aria-pressed', String(annotTools.includes(tool)));
    eraserSwatch.setAttribute('aria-checked', String(erasing));
    for (const b of swatches.querySelectorAll('.swatch:not(.eraser-swatch)')) {
      b.setAttribute('aria-checked', String(!erasing && b.dataset.hex === color));
    }
    pickColor.classList.toggle('erase', erasing);
  }

  function applyTheme() {
    const theme = jot.theme ?? 'dark';
    el.dataset.theme = theme;
    themeBtn.textContent = theme === 'light' ? '☾' : '☀';
    el.querySelector('[data-more="theme"]').textContent = theme === 'light' ? 'Dark canvas' : 'Light canvas';
    for (const b of swatches.querySelectorAll('.swatch:not(.eraser-swatch)')) b.style.setProperty('--c', colorForTheme(b.dataset.hex, theme));
    pickColor.querySelector('.dot').style.background = colorForTheme(color, theme);
  }
  function setTheme(theme) {
    jot.theme = theme;
    applyTheme();
    paperDirty = true;
    baseDirty = true;
    liveDirty = true;
    requestRender();
    scheduleSave();
  }

  async function exportJot(format) {
    closePopovers();
    const name = jot.name.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || `jotted-${jot.id.slice(-6).toLowerCase()}`;
    const baked = await bakeRedactions(jot);
    if (format === 'svg') {
      downloadBlob(new Blob([jotToSVG(baked)], { type: 'image/svg+xml' }), `${name}.svg`);
    } else {
      const blob = await jotToPNG(baked, drawStroke, 2, drawShapes);
      if (blob) downloadBlob(blob, `${name}.png`);
    }
    showToast(`Exported ${format.toUpperCase()}`);
  }

  // ---- Image layers ------------------------------------------------------
  function viewportWorld() {
    const [x0, y0] = view.screenToWorld(0, 0);
    const [x1, y1] = view.screenToWorld(live.clientWidth, live.clientHeight);
    return { w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }
  /** Add one image at a world point (defaults to the viewport centre). */
  function placeImage({ src, w, h }, at = null) {
    const vp = viewportWorld();
    const cx = at ? at[0] : vp.cx;
    const cy = at ? at[1] : vp.cy;
    const im = { id: imageId(), src, ...fitPlacement(w, h, vp.w, vp.h, cx, cy) };
    images.push(im);
    commit({ type: 'image', image: im });
    return im;
  }
  /** Stack several pages top to bottom, centred in the viewport. */
  function placeStack(pages) {
    const vp = viewportWorld();
    const first = fitPlacement(pages[0].w, pages[0].h, vp.w, vp.h, vp.cx, vp.cy);
    const scale = first.w / pages[0].w;
    const gap = 24;
    let y = first.y;
    const added = [];
    for (const pg of pages) {
      const im = { id: imageId(), src: pg.src, x: first.x, y: Math.round(y * 100) / 100, w: pg.w * scale, h: pg.h * scale };
      images.push(im);
      added.push(im);
      y += pg.h * scale + gap;
    }
    commit({ type: 'images', images: added });
  }
  async function addFiles(files, at = null) {
    for (const file of files) {
      try {
        if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
          showToast('Rendering PDF…');
          const { renderPdfPages, MAX_PAGES } = await import('./pdf.js?v=98e8dfa53d');
          const { pages, total } = await renderPdfPages(file, (i, n) => showToast(`Rendering page ${i} of ${n}…`));
          if (pages.length) placeStack(pages);
          showToast(total > MAX_PAGES ? `Added first ${MAX_PAGES} of ${total} pages` : `Added ${pages.length} page${pages.length === 1 ? '' : 's'}`);
        } else if (file.type.startsWith('image/')) {
          placeImage(await blobToImageData(file), at);
          showToast('Image added');
        }
      } catch (err) {
        console.error(err);
        showToast(`Couldn't add ${file.name || 'that file'}`);
      }
    }
  }
  async function addSnapshot(url, width) {
    showToast('Snapshotting page…');
    try {
      const shot = await globalThis.jotted.snapshot(url, width);
      placeImage(shot);
      showToast(`Added ${shot.title || url}`);
    } catch (err) {
      console.error(err);
      showToast("Couldn't snapshot that page");
    }
  }
  function openSnapshotDialog() {
    snapDialog.hidden = false;
    snapDialog.url.value = '';
    snapDialog.url.focus();
  }
  function onPaste(e) {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf');
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
  }
  function onDragOver(e) {
    if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    dropHint.hidden = false;
  }
  function onDragLeave() {
    dropHint.hidden = true;
  }
  function onDrop(e) {
    dropHint.hidden = true;
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files, view.screenToWorld(e.clientX, e.clientY));
  }

  function setColor(hex) {
    color = hex;
    setTool('pen');
    for (const b of swatches.querySelectorAll('.swatch:not(.eraser-swatch)')) b.setAttribute('aria-checked', String(b.dataset.hex === hex));
    pickColor.querySelector('.dot').style.background = colorForTheme(hex, jot.theme);
    closePopovers();
    savePrefs();
  }
  function setSize(key) {
    sizeKey = key;
    for (const b of sizes.children) b.setAttribute('aria-checked', String(b.dataset.size === key));
    pickSize.querySelector('.dot').style.setProperty('--d', `${Math.min(24, PEN_SIZES[key] * 2)}px`);
    pickSize.classList.toggle('highlight', key === 'highlight');
    closePopovers();
    savePrefs();
  }

  // Narrow-screen popovers: the color and size pickers collapse into one
  // button each and expand upward on tap.
  function togglePopover(group) {
    const open = !group.classList.contains('open');
    closePopovers();
    group.classList.toggle('open', open);
    group.querySelector('.pick, .export-btn, .add-btn, .more-btn').setAttribute('aria-expanded', String(open));
  }
  function closePopovers() {
    for (const g of el.querySelectorAll('.group.open, .export-wrap.open, .add-wrap.open, .more-wrap.open')) {
      g.classList.remove('open');
      g.querySelector('.pick, .export-btn, .add-btn, .more-btn')?.setAttribute('aria-expanded', 'false');
    }
  }
  pickColor.addEventListener('click', () => togglePopover(pickColor.parentElement));
  pickSize.addEventListener('click', () => togglePopover(pickSize.parentElement));
  const PAPER_LABELS = { none: 'Plain', grid: 'Grid', lines: 'Lines', dots: 'Dots' };
  function setPaper(mode) {
    jot.paper = PAPER_MODES.includes(mode) ? mode : 'none';
    paperBtn.textContent = PAPER_LABELS[jot.paper];
    paperBtn.setAttribute('aria-pressed', String(jot.paper !== 'none'));
    el.querySelector('[data-more="paper"]').textContent = `Paper: ${PAPER_LABELS[jot.paper]}`;
    paperDirty = true;
    requestRender();
    scheduleSave();
  }
  function cyclePaper(dir) {
    const i = PAPER_MODES.indexOf(jot.paper);
    setPaper(PAPER_MODES[(i + dir + PAPER_MODES.length) % PAPER_MODES.length]);
  }
  // H hides every bit of UI (for screenshares); H again brings it back.
  let toastTimer = 0;
  function showToast(text) {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
  }
  function toggleUi() {
    const hidden = el.classList.toggle('ui-hidden');
    showToast(hidden ? 'Interface hidden. Press H to bring it back.' : 'Interface shown.');
  }
  function cycleColor(dir) {
    const i = PALETTE.findIndex((c) => c.hex === color);
    setColor(PALETTE[(i + dir + PALETTE.length) % PALETTE.length].hex);
  }
  function stepSize(dir) {
    const keys = Object.keys(PEN_SIZES); // small → large
    const i = Math.min(keys.length - 1, Math.max(0, keys.indexOf(sizeKey) + dir));
    setSize(keys[i]);
  }
  function updateHistoryButtons() {
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
    clearBtn.disabled = strokes.length === 0 && images.length === 0 && shapes.length === 0;
  }
  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ color, size: sizeKey }));
    } catch { /* ignore */ }
  }

  // ---- Rendering ---------------------------------------------------------
  let dpr = 1;
  let paperDirty = true;
  let baseDirty = true;
  let liveDirty = false;
  let frame = 0;

  function resize() {
    dpr = fitCanvas(base);
    fitCanvas(live);
    fitCanvas(paper);
    paperDirty = true;
    baseDirty = true;
    requestRender();
  }

  function requestRender() {
    if (frame) return;
    frame = requestAnimationFrame(render);
  }

  function render() {
    frame = 0;
    if (paperDirty) {
      paperDirty = false;
      drawPaper(paperCtx, view, jot.paper, paper.clientWidth, paper.clientHeight, dpr, jot.theme);
    }
    if (baseDirty) {
      baseDirty = false;
      beginFrame(baseCtx, view, dpr);
      drawImages(baseCtx, images, view, base.clientWidth, base.clientHeight, imageCache);
      drawRedactions(baseCtx, images, redactions, imageCache);
      drawShapes(baseCtx, shapes.filter((sh) => !sh.hidden), jot.theme);
      drawStrokes(baseCtx, strokes, view, base.clientWidth, base.clientHeight, jot.theme);
      zoomBtn.textContent = `${Math.round(view.scale * 100)}%`;
    }
    if (liveDirty) {
      liveDirty = false;
      beginFrame(liveCtx, view, dpr);
      if (current) drawStroke(liveCtx, current.stroke, jot.theme);
      if (shaping?.draft) drawShapes(liveCtx, [shaping.draft], jot.theme);
      if (selected) drawSelection(liveCtx);
      drawImageEdit(liveCtx);
      if (redacting) {
        const r = normalizeRect(redacting.x0, redacting.y0, redacting.x1, redacting.y1);
        liveCtx.save();
        liveCtx.setLineDash([6 / view.scale, 4 / view.scale]);
        liveCtx.lineWidth = 1.5 / view.scale;
        liveCtx.strokeStyle = jot.theme === 'light' ? '#1c7fd6' : '#7fd4ff';
        liveCtx.fillStyle = 'rgba(127, 212, 255, 0.12)';
        liveCtx.fillRect(r.x, r.y, r.w, r.h);
        liveCtx.strokeRect(r.x, r.y, r.w, r.h);
        liveCtx.restore();
      }
    }
  }

  function onViewChanged() {
    if (editing) positionTextEditor();
    positionImageTools();
    paperDirty = true;
    baseDirty = true;
    if (current) liveDirty = true;
    requestRender();
    scheduleSave();
  }

  // ---- Persistence -------------------------------------------------------
  let saveTimer = 0;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveState.textContent = '';
    saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    jot.view = view.toJSON();
    const pending = store.saveJot(jot).then(
      () => {
        saveState.textContent = 'Saved';
        saveState.classList.remove('error');
      },
      (err) => {
        saveState.textContent = 'Not saved';
        saveState.classList.add('error');
        console.error(err);
      },
    );
    return pending;
  }

  // ---- Undo / redo -------------------------------------------------------
  function undo() {
    if (current || undoStack.length === 0) return;
    const action = undoStack.pop();
    if (action.type === 'add') strokes.pop();
    else if (action.type === 'clear') { strokes.push(...action.strokes); images.push(...(action.images ?? [])); redactions.push(...(action.redactions ?? [])); shapes.push(...(action.shapes ?? [])); }
    else if (action.type === 'image') images.splice(images.indexOf(action.image), 1);
    else if (action.type === 'images') for (const im of action.images) images.splice(images.indexOf(im), 1);
    else if (action.type === 'removeImage') images.splice(action.index, 0, action.image);
    else if (action.type === 'erase') for (const { index, stroke } of action.items) strokes.splice(index, 0, stroke);
    else if (action.type === 'move') shiftAll(-action.dx, -action.dy);
    else if (action.type === 'redact') redactions.splice(redactions.indexOf(action.redaction), 1);
    else if (action.type === 'unredact') redactions.splice(action.index, 0, action.redaction);
    else if (action.type === 'shape') shapes.splice(shapes.indexOf(action.shape), 1);
    else if (action.type === 'removeShape') shapes.splice(action.index, 0, action.shape);
    else if (action.type === 'moveShape') moveShape(action.shape, -action.dx, -action.dy);
    else if (action.type === 'editText') Object.assign(action.shape, action.before);
    else if (action.type === 'moveItem') moveItem(action.sel, -action.dx, -action.dy);
    else if (action.type === 'imageEdit') Object.assign(action.image, action.before);
    redoStack.push(action);
    afterHistoryChange();
  }
  function redo() {
    if (current || redoStack.length === 0) return;
    const action = redoStack.pop();
    if (action.type === 'add') strokes.push(action.stroke);
    else if (action.type === 'clear') { strokes.length = 0; images.length = 0; redactions.length = 0; shapes.length = 0; }
    else if (action.type === 'image') images.push(action.image);
    else if (action.type === 'images') images.push(...action.images);
    else if (action.type === 'removeImage') images.splice(images.indexOf(action.image), 1);
    else if (action.type === 'erase') for (const { stroke } of action.items) strokes.splice(strokes.indexOf(stroke), 1);
    else if (action.type === 'move') shiftAll(action.dx, action.dy);
    else if (action.type === 'redact') redactions.push(action.redaction);
    else if (action.type === 'unredact') redactions.splice(redactions.indexOf(action.redaction), 1);
    else if (action.type === 'shape') shapes.push(action.shape);
    else if (action.type === 'removeShape') shapes.splice(shapes.indexOf(action.shape), 1);
    else if (action.type === 'moveShape') moveShape(action.shape, action.dx, action.dy);
    else if (action.type === 'editText') Object.assign(action.shape, action.after);
    else if (action.type === 'moveItem') moveItem(action.sel, action.dx, action.dy);
    else if (action.type === 'imageEdit') Object.assign(action.image, action.after);
    undoStack.push(action);
    afterHistoryChange();
  }

  function shiftAll(dx, dy) {
    for (const s of strokes) for (const p of s.points) { p[0] = round(p[0] + dx, 2); p[1] = round(p[1] + dy, 2); }
    for (const im of images) { im.x = round(im.x + dx, 2); im.y = round(im.y + dy, 2); }
    for (const r of redactions) { r.x = round(r.x + dx, 2); r.y = round(r.y + dy, 2); }
    for (const sh of shapes) moveShape(sh, dx, dy);
  }

  // Shift+arrows nudge the whole jot; rapid presses merge into one undo step.
  let lastNudge = 0;
  function nudge(dx, dy) {
    if (current || (strokes.length === 0 && images.length === 0 && shapes.length === 0)) return;
    shiftAll(dx, dy);
    const last = undoStack[undoStack.length - 1];
    if (last?.type === 'move' && performance.now() - lastNudge < 800) {
      last.dx += dx;
      last.dy += dy;
      afterHistoryChange();
    } else {
      commit({ type: 'move', dx, dy });
    }
    lastNudge = performance.now();
  }
  function commit(action) {
    undoStack.push(action);
    redoStack.length = 0;
    afterHistoryChange();
  }

  function clearJot() {
    if (current || (strokes.length === 0 && images.length === 0 && shapes.length === 0)) return;
    commit({ type: 'clear', strokes: strokes.splice(0, strokes.length), images: images.splice(0, images.length), redactions: redactions.splice(0, redactions.length), shapes: shapes.splice(0, shapes.length) });
  }
  function afterHistoryChange() {
    if (imageEdit) imageEdit.crop = { x: imageEdit.image.x, y: imageEdit.image.y, w: imageEdit.image.w, h: imageEdit.image.h };
    positionImageTools();
    if (selected) {
      const list = { image: images, shape: shapes, stroke: strokes, redaction: redactions }[selected.kind];
      if (!list.includes(selected.item)) selected = null;
    }
    liveDirty = true;
    baseDirty = true;
    requestRender();
    updateHistoryButtons();
    scheduleSave();
  }

  // ---- Pen input ---------------------------------------------------------
  function capture(pointerId) {
    try {
      live.setPointerCapture(pointerId);
    } catch { /* synthetic or already-released pointer */ }
  }

  let current = null; // { pointerId, pointerType, stroke, smoother, last }

  function pressureOf(e, prev) {
    if (e.pointerType === 'pen' && e.pressure > 0) return e.pressure;
    if (!prev) return 0.55;
    const dt = Math.max(1, e.timeStamp - prev.t);
    const speed = Math.hypot(e.clientX - prev.sx, e.clientY - prev.sy) / dt;
    return simulatePressure(prev.p, speed);
  }

  function rawPoint(e) {
    const [wx, wy] = view.screenToWorld(e.clientX, e.clientY);
    const p = current.stroke.kind === 'highlight' ? 0.5 : pressureOf(e, current.last);
    current.last = { sx: e.clientX, sy: e.clientY, t: e.timeStamp, p };
    return [wx, wy, p];
  }

  function beginStroke(e) {
    current = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      stroke: { color, size: PEN_SIZES[sizeKey], points: [], ...(sizeKey === 'highlight' ? { kind: 'highlight' } : {}) },
      smoother: createSmoother({ streamline: e.pointerType === 'pen' ? 0.4 : 0.3, minDist: 0.5 / view.scale }),
      last: null,
    };
    capture(e.pointerId);
    const pt = current.smoother.push(rawPoint(e));
    if (pt) current.stroke.points.push(pt);
    liveDirty = true;
    requestRender();
  }

  function extendStroke(e) {
    const events = e.getCoalescedEvents?.() ?? [];
    if (events.length === 0) events.push(e);
    for (const ev of events) {
      const pt = current.smoother.push(rawPoint(ev));
      if (pt) current.stroke.points.push(pt);
    }
    liveDirty = true;
    requestRender();
  }

  function endStroke(e, cancelled = false) {
    const c = current;
    current = null;
    if (!cancelled) {
      c.stroke.points.push(...c.smoother.finish(rawPointFor(c, e)));
      c.stroke.points = c.stroke.points.map(([x, y, p]) => [round(x, 2), round(y, 2), round(p, 3)]);
      strokes.push(c.stroke);
      commit({ type: 'add', stroke: c.stroke });
    }
    baseDirty = true;
    liveDirty = true;
    requestRender();
  }

  function rawPointFor(c, e) {
    const [wx, wy] = view.screenToWorld(e.clientX, e.clientY);
    return [wx, wy, c.last ? c.last.p : 0.55];
  }

  // ---- Pan / zoom input --------------------------------------------------
  const touches = new Map(); // pointerId -> {x, y}
  let mousePan = null; // { pointerId, x, y }
  let spaceHeld = false;

  function panStart(e) {
    mousePan = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
    capture(e.pointerId);
    el.classList.add('panning');
  }

  // ---- Select / move (pointer tool) ----------------------------------------
  let selected = null; // { kind: 'shape' | 'stroke' | 'redaction' | 'image', item }
  let selecting = null; // drag in progress: { pointerId, x0, y0, sx, sy, dx, dy, moved }

  function setSelected(sel) {
    if (!sel || sel.item !== imageEdit?.image) imageEdit = null;
    selected = sel;
    liveDirty = true;
    positionImageTools();
    requestRender();
  }
  function selectionBounds() {
    if (!selected) return null;
    const it = selected.item;
    if (selected.kind === 'image' || selected.kind === 'redaction') {
      return { minX: it.x, minY: it.y, maxX: it.x + it.w, maxY: it.y + it.h };
    }
    if (selected.kind === 'stroke') return strokeBounds(it);
    return shapeBounds(it);
  }
  /** Topmost thing under the pointer: shapes, then ink, then pixelation, then images. */
  function itemAt(wx, wy) {
    const shape = shapeAt(wx, wy, null);
    if (shape) return { kind: 'shape', item: shape };
    const tol = 6 / view.scale;
    for (let i = strokes.length - 1; i >= 0; i--) {
      if (hitTestStroke(strokes[i], wx, wy, tol)) return { kind: 'stroke', item: strokes[i] };
    }
    for (let i = redactions.length - 1; i >= 0; i--) {
      if (pointInRect(redactions[i], wx, wy)) return { kind: 'redaction', item: redactions[i] };
    }
    for (let i = images.length - 1; i >= 0; i--) {
      if (pointInImage(images[i], wx, wy)) return { kind: 'image', item: images[i] };
    }
    return null;
  }
  function shiftStroke(stroke, dx, dy) {
    for (const p of stroke.points) { p[0] = round(p[0] + dx, 2); p[1] = round(p[1] + dy, 2); }
  }
  function moveItem(sel, dx, dy) {
    const it = sel.item;
    if (sel.kind === 'image' || sel.kind === 'redaction') { it.x = round(it.x + dx, 2); it.y = round(it.y + dy, 2); }
    else if (sel.kind === 'stroke') shiftStroke(it, dx, dy);
    else moveShape(it, dx, dy);
  }
  function beginSelect(e) {
    const [wx, wy] = view.screenToWorld(e.clientX, e.clientY);
    const hit = itemAt(wx, wy);
    setSelected(hit);
    if (!hit) return;
    capture(e.pointerId);
    selecting = { pointerId: e.pointerId, x0: wx, y0: wy, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0, moved: false };
  }
  function moveSelect(e) {
    const [wx, wy] = view.screenToWorld(e.clientX, e.clientY);
    const dx = wx - selecting.x0, dy = wy - selecting.y0;
    moveItem(selected, dx, dy);
    selecting.dx += dx; selecting.dy += dy;
    selecting.x0 = wx; selecting.y0 = wy;
    if (Math.hypot(e.clientX - selecting.sx, e.clientY - selecting.sy) > 4) selecting.moved = true;
    baseDirty = true;
    liveDirty = true;
    requestRender();
  }
  function endSelect() {
    const sel = selecting;
    selecting = null;
    positionImageTools();
    if (!sel || !selected) return;
    if (sel.moved) {
      commit({ type: 'moveItem', sel: selected, dx: sel.dx, dy: sel.dy });
    } else if (selected.kind === 'shape' && selected.item.type === 'text' && sel.dblclick) {
      openTextEditor(selected.item);
    }
  }
  function deleteSelected() {
    if (!selected) return false;
    const sel = selected;
    setSelected(null);
    if (sel.kind === 'image') {
      const index = images.indexOf(sel.item);
      images.splice(index, 1);
      commit({ type: 'removeImage', image: sel.item, index });
    } else if (sel.kind === 'stroke') {
      const index = strokes.indexOf(sel.item);
      strokes.splice(index, 1);
      commit({ type: 'erase', items: [{ index, stroke: sel.item }] });
    } else if (sel.kind === 'redaction') {
      const index = redactions.indexOf(sel.item);
      redactions.splice(index, 1);
      commit({ type: 'unredact', redaction: sel.item, index });
    } else {
      const index = shapes.indexOf(sel.item);
      shapes.splice(index, 1);
      commit({ type: 'removeShape', shape: sel.item, index });
    }
    return true;
  }
  function drawSelection(ctx) {
    const b = selectionBounds();
    if (!b) return;
    const pad = 6 / view.scale;
    ctx.save();
    ctx.setLineDash([6 / view.scale, 4 / view.scale]);
    ctx.lineWidth = 1.5 / view.scale;
    ctx.strokeStyle = jot.theme === 'light' ? '#1c7fd6' : '#7fd4ff';
    ctx.strokeRect(b.minX - pad, b.minY - pad, b.maxX - b.minX + pad * 2, b.maxY - b.minY + pad * 2);
    ctx.restore();
  }

  // ---- Image resize / crop -------------------------------------------------
  let imageEdit = null; // { mode: 'resize' | 'crop', image, crop: {x,y,w,h} }
  let handleDrag = null; // { pointerId, handle, before, startW: [wx, wy], dragging }
  const HANDLE_PX = 7;

  function setImageEdit(mode) {
    if (!selected || selected.kind !== 'image') return;
    imageEdit = mode ? { mode, image: selected.item, crop: { x: selected.item.x, y: selected.item.y, w: selected.item.w, h: selected.item.h } } : null;
    if (!mode) live.style.cursor = '';
    for (const b of imgTools.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.imgtool === mode));
    liveDirty = true;
    requestRender();
  }
  function positionImageTools() {
    const show = selected?.kind === 'image' && tool === 'select' && !selecting && !handleDrag;
    imgTools.hidden = !show;
    if (!show) return;
    const im = selected.item;
    const [sx, sy] = view.worldToScreen(im.x, im.y);
    imgTools.style.left = `${Math.max(4, sx + 8)}px`;
    imgTools.style.top = `${Math.max(4, sy + 8)}px`;
  }
  /** Handle positions (world) for the active edit mode. */
  function editHandles() {
    if (!imageEdit) return [];
    const r = imageEdit.mode === 'crop' ? imageEdit.crop : imageEdit.image;
    const { x, y, w, h } = r;
    const corners = [
      { id: 'nw', x, y }, { id: 'ne', x: x + w, y }, { id: 'se', x: x + w, y: y + h }, { id: 'sw', x, y: y + h },
    ];
    if (imageEdit.mode === 'crop') return corners;
    return [...corners, { id: 'n', x: x + w / 2, y }, { id: 'e', x: x + w, y: y + h / 2 }, { id: 's', x: x + w / 2, y: y + h }, { id: 'w', x, y: y + h / 2 }];
  }
  const RESIZE_CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
  const CROP_CURSOR = `url("data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'20\' height=\'20\' viewBox=\'0 0 20 20\'><path d=\'M5 1v14h14M1 5h14v14\' fill=\'none\' stroke=\'black\' stroke-width=\'4\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/><path d=\'M5 1v14h14M1 5h14v14\' fill=\'none\' stroke=\'white\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/></svg>')}") 10 10, crosshair`;
  function updateHandleCursor(e) {
    if (!imageEdit || handleDrag) return;
    const h = handleAt(e.clientX, e.clientY);
    live.style.cursor = h ? (imageEdit.mode === 'crop' ? CROP_CURSOR : RESIZE_CURSORS[h]) : '';
  }
  function handleAt(sx, sy) {
    const reach = imageEdit?.mode === 'crop' ? 16 : 12;
    for (const hnd of editHandles()) {
      const [hx, hy] = view.worldToScreen(hnd.x, hnd.y);
      if (Math.hypot(hx - sx, hy - sy) <= reach) return hnd.id;
    }
    return null;
  }
  function beginHandleDrag(e, handle) {
    const im = imageEdit.image;
    live.style.cursor = imageEdit.mode === 'crop' ? CROP_CURSOR : RESIZE_CURSORS[handle];
    handleDrag = { pointerId: e.pointerId, handle, before: { x: im.x, y: im.y, w: im.w, h: im.h, src: im.src }, crop0: { ...imageEdit.crop }, dragging: true };
    capture(e.pointerId);
    positionImageTools();
  }
  function moveHandleDrag(e) {
    const [wx, wy] = view.screenToWorld(e.clientX, e.clientY);
    const h = handleDrag.handle;
    if (imageEdit.mode === 'resize') {
      const b = handleDrag.before;
      const aspect = b.w / b.h;
      let { x, y, w, hgt } = { x: b.x, y: b.y, w: b.w, hgt: b.h };
      const minW = 16 / view.scale;
      if (h.includes('e')) w = Math.max(minW, wx - b.x);
      if (h.includes('s')) hgt = Math.max(minW, wy - b.y);
      if (h.includes('w')) { w = Math.max(minW, b.x + b.w - wx); x = b.x + b.w - w; }
      if (h.includes('n')) { hgt = Math.max(minW, b.y + b.h - wy); y = b.y + b.h - hgt; }
      if (h.length === 2) { // corners keep the aspect ratio
        if (w / hgt > aspect) w = hgt * aspect; else hgt = w / aspect;
        if (h.includes('w')) x = b.x + b.w - w;
        if (h.includes('n')) y = b.y + b.h - hgt;
      }
      Object.assign(imageEdit.image, { x: round(x, 2), y: round(y, 2), w: round(w, 2), h: round(hgt, 2) });
      imageEdit.crop = { x, y, w, h: hgt };
      baseDirty = true;
    } else {
      const im = imageEdit.image;
      const c = handleDrag.crop0;
      const cx = Math.min(Math.max(wx, im.x), im.x + im.w);
      const cy = Math.min(Math.max(wy, im.y), im.y + im.h);
      let x0 = c.x, y0 = c.y, x1 = c.x + c.w, y1 = c.y + c.h;
      if (h.includes('w')) x0 = cx; if (h.includes('e')) x1 = cx;
      if (h.includes('n')) y0 = cy; if (h.includes('s')) y1 = cy;
      const minW = 8 / view.scale;
      imageEdit.crop = { x: Math.min(x0, x1 - minW), y: Math.min(y0, y1 - minW), w: Math.max(minW, Math.abs(x1 - x0)), h: Math.max(minW, Math.abs(y1 - y0)) };
    }
    liveDirty = true;
    requestRender();
  }
  async function endHandleDrag() {
    const hd = handleDrag;
    handleDrag = null;
    live.style.cursor = '';
    if (!imageEdit) return;
    const im = imageEdit.image;
    if (imageEdit.mode === 'resize') {
      const after = { x: im.x, y: im.y, w: im.w, h: im.h, src: im.src };
      if (after.x !== hd.before.x || after.y !== hd.before.y || after.w !== hd.before.w || after.h !== hd.before.h) {
        commit({ type: 'imageEdit', image: im, before: hd.before, after });
      }
    } else {
      await applyCrop(im, imageEdit.crop, hd.before);
      imageEdit.crop = { x: im.x, y: im.y, w: im.w, h: im.h };
    }
    liveDirty = true;
    positionImageTools();
    requestRender();
  }
  /** Crop the image's pixels to `rect` (world) and commit as one undo step. */
  async function applyCrop(im, rect, before) {
    const el = await loadImage(im.src);
    const sx = el.naturalWidth / before.w;
    const sy = el.naturalHeight / before.h;
    const px = Math.round((rect.x - before.x) * sx), py = Math.round((rect.y - before.y) * sy);
    const pw = Math.max(1, Math.round(rect.w * sx)), ph = Math.max(1, Math.round(rect.h * sy));
    if (px === 0 && py === 0 && pw === el.naturalWidth && ph === el.naturalHeight) return;
    const canvas = document.createElement('canvas');
    canvas.width = pw; canvas.height = ph;
    canvas.getContext('2d').drawImage(el, px, py, pw, ph, 0, 0, pw, ph);
    const after = { x: round(rect.x, 2), y: round(rect.y, 2), w: round(rect.w, 2), h: round(rect.h, 2), src: canvas.toDataURL('image/png') };
    Object.assign(im, after);
    commit({ type: 'imageEdit', image: im, before, after });
    showToast('Cropped');
  }
  function drawImageEdit(ctx) {
    if (!imageEdit) return;
    const px = 1 / view.scale;
    ctx.save();
    if (imageEdit.mode === 'crop') {
      const im = imageEdit.image;
      const c = imageEdit.crop;
      if (handleDrag) { // darken everything outside the crop rectangle
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.beginPath();
        ctx.rect(im.x, im.y, im.w, im.h);
        ctx.rect(c.x, c.y, c.w, c.h);
        ctx.fill('evenodd');
      }
      ctx.lineWidth = 1 * px;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.strokeRect(c.x - 0.5 * px, c.y - 0.5 * px, c.w + px, c.h + px);
      ctx.strokeStyle = '#fff';
      ctx.strokeRect(c.x, c.y, c.w, c.h);
      const L = Math.min(c.w, c.h, 22 * px);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const corner = (x, y, dx, dy) => { ctx.beginPath(); ctx.moveTo(x + dx * L, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * L); ctx.stroke(); };
      const corners = () => { corner(c.x, c.y, 1, 1); corner(c.x + c.w, c.y, -1, 1); corner(c.x + c.w, c.y + c.h, -1, -1); corner(c.x, c.y + c.h, 1, -1); };
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 7 * px;
      corners();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 4 * px;
      corners();
    } else {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5 * px;
      const r = (HANDLE_PX + 2) * px;
      for (const hnd of editHandles()) {
        ctx.beginPath();
        ctx.rect(hnd.x - r / 2, hnd.y - r / 2, r, r);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  for (const b of imgTools.querySelectorAll('button')) {
    b.addEventListener('click', () => setImageEdit(imageEdit?.mode === b.dataset.imgtool ? null : b.dataset.imgtool));
  }

  // ---- Boxes, arrows, text -----------------------------------------------
  // shaping: { pointerId, mode: 'create' | 'move', draft?, shape?, sx, sy, x0, y0, moved }
  let shaping = null;
  let editing = null; // { shape | null, x, y } text being typed

  function shapeAt(wx, wy, type) {
    const tol = 6 / view.scale;
    for (let i = shapes.length - 1; i >= 0; i--) {
      if ((!type || shapes[i].type === type) && hitTestShape(shapes[i], wx, wy, tol)) return shapes[i];
    }
    return null;
  }
  function beginShape(e) {
    const [wx, wy] = view.screenToWorld(e.clientX, e.clientY);
    capture(e.pointerId);
    const existing = shapeAt(wx, wy, tool);
    if (existing) {
      shaping = { pointerId: e.pointerId, mode: 'move', shape: existing, sx: e.clientX, sy: e.clientY, x0: wx, y0: wy, moved: false, dx: 0, dy: 0 };
      return;
    }
    if (tool === 'text') {
      shaping = null;
      openTextEditor(null, wx, wy);
      return;
    }
    const base = { id: imageId(), type: tool, color, size: PEN_SIZES[sizeKey === 'highlight' ? 'large' : sizeKey] };
    const draft = tool === 'rect' ? { ...base, x: wx, y: wy, w: 0, h: 0 } : { ...base, x1: wx, y1: wy, x2: wx, y2: wy };
    shaping = { pointerId: e.pointerId, mode: 'create', draft, x0: wx, y0: wy, sx: e.clientX, sy: e.clientY };
    liveDirty = true;
    requestRender();
  }
  function moveShapeDrag(e) {
    const [wx, wy] = view.screenToWorld(e.clientX, e.clientY);
    if (shaping.mode === 'move') {
      const dx = wx - shaping.x0, dy = wy - shaping.y0;
      moveShape(shaping.shape, dx, dy);
      shaping.dx += dx; shaping.dy += dy;
      shaping.x0 = wx; shaping.y0 = wy;
      if (Math.hypot(e.clientX - shaping.sx, e.clientY - shaping.sy) > 4) shaping.moved = true;
      baseDirty = true;
    } else {
      const d = shaping.draft;
      if (d.type === 'rect') Object.assign(d, normalizeRect(shaping.x0, shaping.y0, wx, wy));
      else { d.x2 = wx; d.y2 = wy; }
      liveDirty = true;
    }
    requestRender();
  }
  function endShape(e, cancelled = false) {
    const sh = shaping;
    shaping = null;
    liveDirty = true;
    if (sh.mode === 'move') {
      if (!sh.moved) {
        moveShape(sh.shape, -sh.dx, -sh.dy); // treat as a tap
        if (sh.shape.type === 'text') openTextEditor(sh.shape);
        baseDirty = true;
        requestRender();
        return;
      }
      sh.shape.x != null && (sh.shape.x = round(sh.shape.x, 2));
      commit({ type: 'moveShape', shape: sh.shape, dx: sh.dx, dy: sh.dy });
      return;
    }
    const d = sh.draft;
    const big = d.type === 'rect' ? Math.max(d.w, d.h) * view.scale >= 6 : Math.hypot(d.x2 - d.x1, d.y2 - d.y1) * view.scale >= 10;
    if (cancelled || !big) { requestRender(); return; }
    for (const k of ['x', 'y', 'w', 'h', 'x1', 'y1', 'x2', 'y2']) if (k in d) d[k] = round(d[k], 2);
    shapes.push(d);
    commit({ type: 'shape', shape: d });
  }

  // Text editing: a textarea positioned over the canvas, in world-scaled type.
  function measureText(text, fontSize) {
    const ctx = liveCtx;
    ctx.save();
    ctx.font = `700 ${fontSize}px ${TEXT_FONT}`;
    const lines = text.split('\n');
    const w = Math.max(...lines.map((l) => ctx.measureText(l || ' ').width));
    ctx.restore();
    return { w: Math.ceil(w), h: lines.length * textLineHeight(fontSize) };
  }
  function positionTextEditor() {
    const fontSize = editing.shape?.fontSize ?? editing.fontSize;
    const [sx, sy] = view.worldToScreen(editing.x, editing.y);
    textEditor.style.left = `${sx}px`;
    textEditor.style.top = `${sy}px`;
    textEditor.style.fontSize = `${fontSize * view.scale}px`;
    textEditor.style.lineHeight = `${textLineHeight(fontSize) * view.scale}px`;
    textEditor.style.color = colorForTheme(editing.shape?.color ?? color, jot.theme);
    const m = measureText(textEditor.value || 'Type', fontSize);
    textEditor.style.width = `${Math.max(60, (m.w + 12) * view.scale)}px`;
    textEditor.rows = Math.max(1, textLines({ text: textEditor.value }).length);
  }
  function openTextEditor(shape, wx = 0, wy = 0) {
    commitTextEdit();
    editing = shape
      ? { shape, x: shape.x, y: shape.y }
      : { shape: null, x: wx, y: wy - TEXT_SIZES[sizeKey] / 2, fontSize: TEXT_SIZES[sizeKey] };
    textEditor.value = shape ? shape.text : '';
    textEditor.hidden = false;
    if (shape) { shape.hidden = true; baseDirty = true; requestRender(); }
    positionTextEditor();
    textEditor.focus();
    if (shape) textEditor.select();
  }
  function commitTextEdit() {
    if (!editing) return;
    const ed = editing;
    editing = null;
    textEditor.hidden = true;
    const text = textEditor.value.replace(/\s+$/, '');
    if (ed.shape) {
      delete ed.shape.hidden;
      const before = { text: ed.shape.text, w: ed.shape.w, h: ed.shape.h };
      if (!text) {
        const index = shapes.indexOf(ed.shape);
        shapes.splice(index, 1);
        commit({ type: 'removeShape', shape: ed.shape, index });
      } else if (text !== before.text) {
        const m = measureText(text, ed.shape.fontSize);
        const after = { text, w: m.w, h: m.h };
        Object.assign(ed.shape, after);
        commit({ type: 'editText', shape: ed.shape, before, after });
      } else {
        baseDirty = true;
        requestRender();
      }
      return;
    }
    if (!text) return;
    const m = measureText(text, ed.fontSize);
    const shape = { id: imageId(), type: 'text', text, fontSize: ed.fontSize, color, size: PEN_SIZES[sizeKey], x: round(ed.x, 2), y: round(ed.y, 2), w: m.w, h: m.h };
    shapes.push(shape);
    commit({ type: 'shape', shape });
  }
  function cancelTextEdit() {
    if (!editing) return;
    if (editing.shape) { delete editing.shape.hidden; baseDirty = true; requestRender(); }
    editing = null;
    textEditor.hidden = true;
  }
  textEditor.addEventListener('input', () => editing && positionTextEditor());
  textEditor.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitTextEdit(); }
    else if (e.key === 'Escape') cancelTextEdit();
  });
  textEditor.addEventListener('blur', () => commitTextEdit());

  // ---- Pixelate (redact) ---------------------------------------------------
  let redacting = null; // { pointerId, x0, y0, x1, y1 } in world units

  function beginRedact(e) {
    const [wx, wy] = view.screenToWorld(e.clientX, e.clientY);
    redacting = { pointerId: e.pointerId, x0: wx, y0: wy, x1: wx, y1: wy };
    capture(e.pointerId);
    liveDirty = true;
    requestRender();
  }
  function moveRedact(e) {
    [redacting.x1, redacting.y1] = view.screenToWorld(e.clientX, e.clientY);
    liveDirty = true;
    requestRender();
  }
  function endRedact(cancelled = false) {
    const r = normalizeRect(redacting.x0, redacting.y0, redacting.x1, redacting.y1);
    redacting = null;
    liveDirty = true;
    const tooSmall = r.w * view.scale < 4 || r.h * view.scale < 4;
    const coversImage = images.some((im) => pointInRect({ x: im.x - r.w, y: im.y - r.h, w: im.w + r.w, h: im.h + r.h }, r.x, r.y));
    if (cancelled || tooSmall || !coversImage) {
      if (!cancelled && !tooSmall) showToast('Nothing to pixelate there. Drag over an image.');
      requestRender();
      return;
    }
    const redaction = { id: imageId(), x: round(r.x, 2), y: round(r.y, 2), w: round(r.w, 2), h: round(r.h, 2) };
    redactions.push(redaction);
    commit({ type: 'redact', redaction });
  }

  // ---- Eraser ------------------------------------------------------------
  let erasing = null; // { pointerId, items: [{ index, stroke }] }

  function wantsErase(e) {
    if (tool === 'eraser' || e.altKey) return true;
    // Stylus eraser end or barrel button.
    return e.pointerType === 'pen' && ((e.buttons & 32) !== 0 || e.button === 5);
  }
  function beginErase(e, temporary = false) {
    erasing = { pointerId: e.pointerId, items: [], restoreTool: temporary ? tool : null, startImage: null };
    if (temporary) setTool('eraser');
    capture(e.pointerId);
    el.classList.add('erasing');
    eraseAt(e);
    if (erasing.items.length === 0) {
      // No stroke under the pointer: remember the shape, redaction or image here; a tap (no drag) removes it.
      const [wx, wy] = view.screenToWorld(e.clientX, e.clientY);
      const shape = shapeAt(wx, wy, null);
      if (shape) erasing.startShape = { shape, index: shapes.indexOf(shape), sx: e.clientX, sy: e.clientY };
      for (let i = redactions.length - 1; i >= 0; i--) {
        if (pointInRect(redactions[i], wx, wy)) { erasing.startRedaction = { redaction: redactions[i], index: i, sx: e.clientX, sy: e.clientY }; break; }
      }
      for (let i = images.length - 1; i >= 0; i--) {
        if (pointInImage(images[i], wx, wy)) { erasing.startImage = { image: images[i], index: i, sx: e.clientX, sy: e.clientY }; break; }
      }
    }
  }
  function eraseAt(e) {
    const events = e.getCoalescedEvents?.() ?? [];
    if (events.length === 0) events.push(e);
    const tol = 6 / view.scale;
    for (const ev of events) {
      const [wx, wy] = view.screenToWorld(ev.clientX, ev.clientY);
      for (let i = strokes.length - 1; i >= 0; i--) {
        if (hitTestStroke(strokes[i], wx, wy, tol)) {
          erasing.items.push({ index: i, stroke: strokes[i] });
          strokes.splice(i, 1);
          baseDirty = true;
        }
      }
    }
    requestRender();
  }
  function endErase(e) {
    const items = erasing.items.sort((a, b) => a.index - b.index);
    const { restoreTool, startImage, startRedaction, startShape } = erasing;
    erasing = null;
    el.classList.remove('erasing');
    if (restoreTool) setTool(restoreTool);
    if (items.length) {
      commit({ type: 'erase', items });
    } else if (startShape && e && Math.hypot(e.clientX - startShape.sx, e.clientY - startShape.sy) < 8) {
      shapes.splice(startShape.index, 1);
      commit({ type: 'removeShape', shape: startShape.shape, index: startShape.index });
    } else if (startRedaction && e && Math.hypot(e.clientX - startRedaction.sx, e.clientY - startRedaction.sy) < 8) {
      redactions.splice(startRedaction.index, 1);
      commit({ type: 'unredact', redaction: startRedaction.redaction, index: startRedaction.index });
      showToast('Pixelation removed');
    } else if (startImage && e && Math.hypot(e.clientX - startImage.sx, e.clientY - startImage.sy) < 8) {
      images.splice(startImage.index, 1);
      commit({ type: 'removeImage', image: startImage.image, index: startImage.index });
      showToast('Image removed');
    }
  }

  function onPointerDown(e) {
    closePopovers();
    if (erasing || redacting || shaping || selecting) return;
    // Space+drag and middle mouse pan in every mode.
    if (e.pointerType !== 'touch' && !current && !mousePan && (e.button === 1 || (e.button === 0 && spaceHeld))) {
      e.preventDefault();
      panStart(e);
      return;
    }
    if (tool === 'select' && !current && !mousePan && e.button === 0 && !e.altKey) {
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size > 1) return;
      }
      e.preventDefault();
      if (imageEdit && !handleDrag) {
        const h = handleAt(e.clientX, e.clientY);
        if (h) { beginHandleDrag(e, h); return; }
      }
      beginSelect(e);
      if (selecting) selecting.dblclick = e.detail === 2;
      return;
    }
    if (SHAPE_TOOLS.includes(tool) && !current && !mousePan && e.button === 0 && !e.altKey) {
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size > 1) return;
      }
      e.preventDefault();
      beginShape(e);
      return;
    }
    if (tool === 'redact' && !current && !mousePan && e.button === 0 && !e.altKey) {
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size > 1) return;
      }
      e.preventDefault();
      beginRedact(e);
      return;
    }
    // Right mouse button held: erase while held, back to the pen on release.
    if (e.pointerType === 'mouse' && e.button === 2 && !current && !mousePan) {
      e.preventDefault();
      beginErase(e, true);
      return;
    }
    if (e.pointerType !== 'touch' && !current && !mousePan && wantsErase(e)) {
      e.preventDefault();
      beginErase(e);
      return;
    }
    if (e.pointerType === 'touch') {
      if (tool === 'eraser' && !current && touches.size === 0) {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        beginErase(e);
        return;
      }
      if (current && current.pointerType === 'pen') return; // palm while writing with a pen
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      capture(e.pointerId);
      if (touches.size === 1 && !current && !mousePan) {
        beginStroke(e); // one finger draws
      } else if (current && current.pointerType === 'touch') {
        endStroke(e, true); // second finger: this is a pinch, not a stroke
      }
      return;
    }
    if (current || mousePan) return;
    const wantsPan = e.button === 1 || (e.button === 0 && spaceHeld);
    if (wantsPan) {
      e.preventDefault();
      panStart(e);
      return;
    }
    if (e.button === 0) {
      if (e.pointerType === 'pen') touches.clear(); // pen wins over any resting fingers
      beginStroke(e);
    }
  }

  function onPointerMove(e) {
    if (tool === 'select' && imageEdit && !handleDrag && !selecting && e.pointerType !== 'touch') updateHandleCursor(e);
    if (handleDrag && e.pointerId === handleDrag.pointerId) {
      moveHandleDrag(e);
      return;
    }
    if (selecting && e.pointerId === selecting.pointerId) {
      moveSelect(e);
      return;
    }
    if (shaping && e.pointerId === shaping.pointerId) {
      moveShapeDrag(e);
      return;
    }
    if (redacting && e.pointerId === redacting.pointerId) {
      moveRedact(e);
      return;
    }
    if (erasing && e.pointerId === erasing.pointerId) {
      eraseAt(e);
      return;
    }
    if (current && e.pointerId === current.pointerId) {
      extendStroke(e);
      return;
    }
    if (mousePan && e.pointerId === mousePan.pointerId) {
      view.panBy(e.clientX - mousePan.x, e.clientY - mousePan.y);
      mousePan.x = e.clientX;
      mousePan.y = e.clientY;
      onViewChanged();
      return;
    }
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      const prev = touches.get(e.pointerId);
      const pts = [...touches.values()];
      if (pts.length >= 2) {
        const other = [...touches.entries()].find(([id]) => id !== e.pointerId)[1];
        const c0 = [(prev.x + other.x) / 2, (prev.y + other.y) / 2];
        const d0 = Math.hypot(prev.x - other.x, prev.y - other.y) || 1;
        const c1 = [(e.clientX + other.x) / 2, (e.clientY + other.y) / 2];
        const d1 = Math.hypot(e.clientX - other.x, e.clientY - other.y) || 1;
        view.panBy(c1[0] - c0[0], c1[1] - c0[1]);
        view.zoomAt(c1[0], c1[1], d1 / d0);
      }
      prev.x = e.clientX;
      prev.y = e.clientY;
      onViewChanged();
    }
  }

  function onPointerUp(e) {
    touches.delete(e.pointerId);
    if (handleDrag && e.pointerId === handleDrag.pointerId) {
      endHandleDrag();
      return;
    }
    if (selecting && e.pointerId === selecting.pointerId) {
      endSelect();
      return;
    }
    if (shaping && e.pointerId === shaping.pointerId) {
      endShape(e, e.type === 'pointercancel');
      return;
    }
    if (redacting && e.pointerId === redacting.pointerId) {
      endRedact(e.type === 'pointercancel');
      return;
    }
    if (erasing && e.pointerId === erasing.pointerId) {
      endErase(e);
      return;
    }
    if (current && e.pointerId === current.pointerId) {
      endStroke(e, e.type === 'pointercancel');
      return;
    }
    if (mousePan && e.pointerId === mousePan.pointerId) {
      mousePan = null;
      el.classList.remove('panning');
    }
  }

  function onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.08 : 0.004));
      view.zoomAt(e.clientX, e.clientY, factor);
    } else {
      const k = e.deltaMode === 1 ? 20 : 1;
      view.panBy(-e.deltaX * k, -e.deltaY * k);
    }
    onViewChanged();
  }

  function onKeyDown(e) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) {
      if (e.key === 'Escape') snapDialog.hidden = true;
      return;
    }
    const mod = IS_MAC ? e.metaKey : e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    } else if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      spaceHeld = true;
      el.classList.add('pan-ready');
    } else if (/^[1-6]$/.test(e.key) && !mod) {
      setColor(PALETTE[Number(e.key) - 1].hex);
    } else if (mod && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      exportJot(e.shiftKey ? 'svg' : 'png');
    } else if (e.key.toLowerCase() === 'e' && !mod) {
      setTool(tool === 'eraser' ? 'pen' : 'eraser');
    } else if (e.key.toLowerCase() === 'r' && !mod) {
      setTool(tool === 'redact' ? 'pen' : 'redact');
    } else if (e.key.toLowerCase() === 'v' && !mod) {
      setTool(tool === 'select' ? 'pen' : 'select');
    } else if (e.key.toLowerCase() === 'b' && !mod) {
      setTool(tool === 'rect' ? 'pen' : 'rect');
    } else if (e.key.toLowerCase() === 'a' && !mod) {
      setTool(tool === 'arrow' ? 'pen' : 'arrow');
    } else if (e.key.toLowerCase() === 't' && !mod) {
      setTool(tool === 'text' ? 'pen' : 'text');
    } else if (e.key.toLowerCase() === 'l' && !mod) {
      setTheme(jot.theme === 'light' ? 'dark' : 'light');
    } else if (e.shiftKey && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const step = 10 / view.scale;
      nudge(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
            e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      cycleColor(e.key === 'ArrowRight' ? 1 : -1);
    } else if (e.key.toLowerCase() === 'h' && !mod) {
      toggleUi();
    } else if (e.key.toLowerCase() === 'g' && !mod) {
      cyclePaper(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (!deleteSelected()) clearJot();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      stepSize(e.key === 'ArrowUp' ? 1 : -1);
    } else if (e.key === '0' && !mod) {
      view.reset();
      onViewChanged();
    } else if (e.key === '?' && !mod) {
      toggleShortcuts();
    } else if (e.key === 'Escape') {
      if (document.querySelector('.shortcuts') && !document.querySelector('.shortcuts').hidden) toggleShortcuts(false);
      else if (imageEdit) setImageEdit(null);
      else if (selected) setSelected(null);
      else if (tool !== 'pen') setTool('pen');
      else location.hash = '#/';
    }
  }
  function onKeyUp(e) {
    if (e.code === 'Space') {
      // A focused button would treat Space-up as a click; swallow it.
      e.preventDefault();
      spaceHeld = false;
      el.classList.remove('pan-ready');
    }
  }

  // Jot name: edit in place, saved on Enter or blur.
  function fitNameInput() {
    nameInput.style.width = `${Math.max(6, Math.min(40, nameInput.value.length + 1))}ch`;
  }
  function renderName() {
    nameInput.value = jot.name;
    fitNameInput();
    document.title = `Jotted · ${jot.name}`;
  }
  nameInput.addEventListener('input', fitNameInput);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nameInput.blur();
    if (e.key === 'Escape') { nameInput.value = jot.name; nameInput.blur(); }
    e.stopPropagation();
  });
  nameInput.addEventListener('change', () => {
    jot.name = cleanName(nameInput.value, defaultName(jot.id));
    renderName();
    scheduleSave();
  });
  nameInput.addEventListener('blur', () => { nameInput.value = jot.name; fitNameInput(); });

  // Toolbar buttons must not keep keyboard focus, otherwise Space or Enter
  // (used for panning / typing) would re-trigger the last button clicked.
  function onHudClick(e) {
    const btn = e.target.closest('button, a');
    if (btn) btn.blur();
  }
  // Writing on the canvas should take focus away from the name field.
  function onCanvasPointerDown() {
    if (document.activeElement === nameInput) nameInput.blur();
  }

  const preventDefault = (e) => e.preventDefault();
  const onBeforeUnload = () => { if (saveTimer) saveNow(); };
  const onVisibility = () => { if (document.visibilityState === 'hidden' && saveTimer) saveNow(); };

  live.addEventListener('pointerdown', onCanvasPointerDown);
  live.addEventListener('pointerdown', onPointerDown);
  live.addEventListener('pointermove', onPointerMove);
  live.addEventListener('pointerup', onPointerUp);
  live.addEventListener('pointercancel', onPointerUp);
  live.addEventListener('wheel', onWheel, { passive: false });
  live.addEventListener('contextmenu', preventDefault);
  document.addEventListener('gesturestart', preventDefault);
  el.addEventListener('click', onHudClick);
  document.addEventListener('paste', onPaste);
  el.addEventListener('dragover', onDragOver);
  el.addEventListener('dragleave', onDragLeave);
  el.addEventListener('drop', onDrop);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', resize);
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('visibilitychange', onVisibility);

  applyTheme();
  setColor(color);
  setSize(sizeKey);
  paperBtn.textContent = PAPER_LABELS[jot.paper] ?? 'Plain';
  paperBtn.setAttribute('aria-pressed', String(jot.paper !== 'none'));
  el.querySelector('[data-more="paper"]').textContent = `Paper: ${PAPER_LABELS[jot.paper] ?? 'Plain'}`;
  updateHistoryButtons();
  resize();
  renderName();

  function unmount() {
    commitTextEdit();
    clearTimeout(toastTimer);
    if (saveTimer) saveNow();
    cancelAnimationFrame(frame);
    document.removeEventListener('gesturestart', preventDefault);
    document.removeEventListener('paste', onPaste);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('resize', resize);
    window.removeEventListener('beforeunload', onBeforeUnload);
    document.removeEventListener('visibilitychange', onVisibility);
    root.innerHTML = '';
  }
  /** Desktop capture arriving while this jot is open: add it as a layer and select it. */
  unmount.addImage = (data) => {
    const im = placeImage(data);
    setTool('select');
    setSelected({ kind: 'image', item: im });
    showToast('Capture added to this jot');
  };
  return unmount;
}

function loadPrefs() {
  const defaults = { color: PALETTE[0].hex, size: 'medium' };
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
    return {
      color: PALETTE.some((c) => c.hex === p.color) ? p.color : defaults.color,
      size: p.size in PEN_SIZES ? p.size : defaults.size,
    };
  } catch {
    return defaults;
  }
}

function round(v, d) {
  const m = 10 ** d;
  return Math.round(v * m) / m;
}
