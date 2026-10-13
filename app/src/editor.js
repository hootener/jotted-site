// Jot editor: full-screen pen canvas with pan/zoom, undo, autosave.
import { View, fitCanvas, beginFrame, drawStrokes, drawStroke, drawImages, drawPaper, createImageCache, PAPER_MODES } from './canvas.js?v=dcdba868ef';
import { fitPlacement, pointInImage, imageId, blobToImageData } from './images.js?v=dcdba868ef';
import { createSmoother, simulatePressure, hitTestStroke, PEN_SIZES } from './stroke.js?v=dcdba868ef';
import { PALETTE, colorForTheme } from './palette.js?v=dcdba868ef';
import { jotToSVG, jotToPNG, downloadBlob } from './export.js?v=dcdba868ef';

const SAVE_DELAY_MS = 400;
// Platform convention: Cmd on macOS, Ctrl elsewhere.
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform) || navigator.userAgentData?.platform === 'macOS';
const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl+';
const PREFS_KEY = 'jotted:prefs';

export function mountEditor(root, store, jot) {
  const prefs = loadPrefs();
  const view = new View(jot.view);
  const strokes = jot.strokes;
  // actions: { type: 'add', stroke } | { type: 'clear', strokes }
  //        | { type: 'erase', items: [{ index, stroke }] } | { type: 'move', dx, dy }
  //        | { type: 'image', image } | { type: 'images', images }
  //        | { type: 'removeImage', image, index }
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
        <span class="jot-id" title="${jot.id}">${jot.id.slice(-6)}</span>
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
          <span class="divider"></span>
          <div class="group tools">
            <button class="btn icon pick pick-size" title="Pen size" aria-haspopup="true" aria-expanded="false"><span class="dot"></span></button>
            <div class="sizes popover" role="radiogroup" aria-label="Pen size"></div>
            <span class="divider"></span>
            <button class="btn icon undo" title="Undo (${MOD_LABEL}Z)" aria-label="Undo">↶</button>
            <button class="btn icon redo" title="Redo (Shift+${MOD_LABEL}Z)" aria-label="Redo">↷</button>
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
            <span class="divider"></span>
            <button class="btn clear" title="Clear this jot (Delete)">Clear</button>
            <div class="more-wrap">
              <button class="btn icon more-btn" title="More" aria-label="More" aria-haspopup="true" aria-expanded="false">⋯</button>
              <div class="more-menu popover" role="menu">
                <button class="btn" data-more="paper" role="menuitem">Paper</button>
                <button class="btn" data-more="theme" role="menuitem">Light canvas</button>
                <button class="btn" data-more="add" role="menuitem">Add image or PDF…</button>
                <button class="btn" data-more="png" role="menuitem">Export PNG</button>
                <button class="btn" data-more="svg" role="menuitem">Export SVG</button>
                <button class="btn danger" data-more="clear" role="menuitem">Clear jot</button>
              </div>
            </div>
          </div>
        </div>
      </footer>
      <div class="toast" aria-live="polite"></div>
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
  const pickColor = el.querySelector('.pick-color');
  const pickSize = el.querySelector('.pick-size');
  const themeBtn = el.querySelector('.theme-btn');
  const exportBtn = el.querySelector('.export-btn');
  const exportWrap = el.querySelector('.export-wrap');
  const addBtn = el.querySelector('.add-btn');
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
    b.title = `${key[0].toUpperCase()}${key.slice(1)} pen`;
    b.setAttribute('role', 'radio');
    b.dataset.size = key;
    b.innerHTML = `<span style="--d:${PEN_SIZES[key] * 2}px"></span>`;
    b.addEventListener('click', () => setSize(key));
    sizes.append(b);
  }
  themeBtn.addEventListener('click', () => setTheme(jot.theme === 'light' ? 'dark' : 'light'));
  exportBtn.addEventListener('click', () => togglePopover(exportWrap));
  addBtn.addEventListener('click', () => togglePopover(addWrap));
  moreBtn.addEventListener('click', () => togglePopover(moreWrap));
  for (const b of el.querySelectorAll('.more-menu button')) {
    b.addEventListener('click', () => {
      const what = b.dataset.more;
      if (what === 'paper') { cyclePaper(1); return; } // stays open so the label is visible
      closePopovers();
      if (what === 'theme') setTheme(jot.theme === 'light' ? 'dark' : 'light');
      else if (what === 'add') fileInput.click();
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

  let tool = 'pen'; // 'pen' | 'eraser'
  function setTool(next) {
    tool = next;
    const erasing = tool === 'eraser';
    el.classList.toggle('erasing-mode', erasing);
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
    const name = `jotted-${jot.id.slice(-6).toLowerCase()}`;
    if (format === 'svg') {
      downloadBlob(new Blob([jotToSVG(jot)], { type: 'image/svg+xml' }), `${name}.svg`);
    } else {
      const blob = await jotToPNG(jot, drawStroke);
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
          const { renderPdfPages, MAX_PAGES } = await import('./pdf.js?v=dcdba868ef');
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
    pickSize.querySelector('.dot').style.setProperty('--d', `${PEN_SIZES[key] * 2}px`);
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
      g.querySelector('.pick, .export-btn, .add-btn, .more-btn').setAttribute('aria-expanded', 'false');
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
    clearBtn.disabled = strokes.length === 0 && images.length === 0;
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
      drawStrokes(baseCtx, strokes, view, base.clientWidth, base.clientHeight, jot.theme);
      zoomBtn.textContent = `${Math.round(view.scale * 100)}%`;
    }
    if (liveDirty) {
      liveDirty = false;
      beginFrame(liveCtx, view, dpr);
      if (current) drawStroke(liveCtx, current.stroke, jot.theme);
    }
  }

  function onViewChanged() {
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
    else if (action.type === 'clear') { strokes.push(...action.strokes); images.push(...(action.images ?? [])); }
    else if (action.type === 'image') images.splice(images.indexOf(action.image), 1);
    else if (action.type === 'images') for (const im of action.images) images.splice(images.indexOf(im), 1);
    else if (action.type === 'removeImage') images.splice(action.index, 0, action.image);
    else if (action.type === 'erase') for (const { index, stroke } of action.items) strokes.splice(index, 0, stroke);
    else if (action.type === 'move') shiftAll(-action.dx, -action.dy);
    redoStack.push(action);
    afterHistoryChange();
  }
  function redo() {
    if (current || redoStack.length === 0) return;
    const action = redoStack.pop();
    if (action.type === 'add') strokes.push(action.stroke);
    else if (action.type === 'clear') { strokes.length = 0; images.length = 0; }
    else if (action.type === 'image') images.push(action.image);
    else if (action.type === 'images') images.push(...action.images);
    else if (action.type === 'removeImage') images.splice(images.indexOf(action.image), 1);
    else if (action.type === 'erase') for (const { stroke } of action.items) strokes.splice(strokes.indexOf(stroke), 1);
    else if (action.type === 'move') shiftAll(action.dx, action.dy);
    undoStack.push(action);
    afterHistoryChange();
  }

  function shiftAll(dx, dy) {
    for (const s of strokes) for (const p of s.points) { p[0] = round(p[0] + dx, 2); p[1] = round(p[1] + dy, 2); }
    for (const im of images) { im.x = round(im.x + dx, 2); im.y = round(im.y + dy, 2); }
  }

  // Shift+arrows nudge the whole jot; rapid presses merge into one undo step.
  let lastNudge = 0;
  function nudge(dx, dy) {
    if (current || (strokes.length === 0 && images.length === 0)) return;
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
    if (current || (strokes.length === 0 && images.length === 0)) return;
    commit({ type: 'clear', strokes: strokes.splice(0, strokes.length), images: images.splice(0, images.length) });
  }
  function afterHistoryChange() {
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
    const p = pressureOf(e, current.last);
    current.last = { sx: e.clientX, sy: e.clientY, t: e.timeStamp, p };
    return [wx, wy, p];
  }

  function beginStroke(e) {
    current = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      stroke: { color, size: PEN_SIZES[sizeKey], points: [] },
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
      // No stroke under the pointer: remember the image here; a tap (no drag) removes it.
      const [wx, wy] = view.screenToWorld(e.clientX, e.clientY);
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
    const { restoreTool, startImage } = erasing;
    erasing = null;
    el.classList.remove('erasing');
    if (restoreTool) setTool(restoreTool);
    if (items.length) {
      commit({ type: 'erase', items });
    } else if (startImage && e && Math.hypot(e.clientX - startImage.sx, e.clientY - startImage.sy) < 8) {
      images.splice(startImage.index, 1);
      commit({ type: 'removeImage', image: startImage.image, index: startImage.index });
      showToast('Image removed');
    }
  }

  function onPointerDown(e) {
    closePopovers();
    if (erasing) return;
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
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
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
      clearJot();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      stepSize(e.key === 'ArrowUp' ? 1 : -1);
    } else if (e.key === '0' && !mod) {
      view.reset();
      onViewChanged();
    } else if (e.key === 'Escape') {
      location.hash = '#/';
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

  // Toolbar buttons must not keep keyboard focus, otherwise Space or Enter
  // (used for panning / typing) would re-trigger the last button clicked.
  function onHudClick(e) {
    const btn = e.target.closest('button, a');
    if (btn) btn.blur();
  }

  const preventDefault = (e) => e.preventDefault();
  const onBeforeUnload = () => { if (saveTimer) saveNow(); };
  const onVisibility = () => { if (document.visibilityState === 'hidden' && saveTimer) saveNow(); };

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
  document.title = `Jotted · ${jot.id.slice(-6)}`;

  return function unmount() {
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
  };
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
