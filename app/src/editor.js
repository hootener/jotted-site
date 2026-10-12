// Jot editor: full-screen pen canvas with pan/zoom, undo, autosave.
import { View, fitCanvas, beginFrame, drawStrokes, drawStroke, drawPaper, PAPER_MODES } from './canvas.js';
import { createSmoother, simulatePressure, PEN_SIZES } from './stroke.js';
import { PALETTE } from './palette.js';

const SAVE_DELAY_MS = 400;
const PREFS_KEY = 'jotted:prefs';

export function mountEditor(root, store, jot) {
  const prefs = loadPrefs();
  const view = new View(jot.view);
  const strokes = jot.strokes;
  const undoStack = []; // actions: { type: 'add', stroke } | { type: 'clear', strokes }
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
          <div class="swatches" role="radiogroup" aria-label="Pen color"></div>
          <span class="divider"></span>
          <div class="sizes" role="radiogroup" aria-label="Pen size"></div>
          <span class="divider"></span>
          <button class="btn icon undo" title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
          <button class="btn icon redo" title="Redo (Shift+Ctrl+Z)" aria-label="Redo">↷</button>
          <span class="divider"></span>
          <button class="btn paper-btn" title="Paper: none / grid / lines / dots (G)"></button>
          <span class="divider"></span>
          <button class="btn clear" title="Clear this jot (Delete)">Clear</button>
        </div>
      </footer>
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
  const swatches = el.querySelector('.swatches');
  const sizes = el.querySelector('.sizes');

  // ---- Toolbar -----------------------------------------------------------
  PALETTE.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.setProperty('--c', c.hex);
    b.title = `${c.name} (${i + 1})`;
    b.setAttribute('role', 'radio');
    b.dataset.hex = c.hex;
    b.addEventListener('click', () => setColor(c.hex));
    swatches.append(b);
  });
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
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);
  clearBtn.addEventListener('click', clearJot);
  paperBtn.addEventListener('click', () => cyclePaper(1));
  zoomBtn.addEventListener('click', () => {
    view.reset();
    onViewChanged();
  });

  function setColor(hex) {
    color = hex;
    for (const b of swatches.children) b.setAttribute('aria-checked', String(b.dataset.hex === hex));
    savePrefs();
  }
  function setSize(key) {
    sizeKey = key;
    for (const b of sizes.children) b.setAttribute('aria-checked', String(b.dataset.size === key));
    savePrefs();
  }
  const PAPER_LABELS = { none: 'Plain', grid: 'Grid', lines: 'Lines', dots: 'Dots' };
  function setPaper(mode) {
    jot.paper = PAPER_MODES.includes(mode) ? mode : 'none';
    paperBtn.textContent = PAPER_LABELS[jot.paper];
    paperBtn.setAttribute('aria-pressed', String(jot.paper !== 'none'));
    paperDirty = true;
    requestRender();
    scheduleSave();
  }
  function cyclePaper(dir) {
    const i = PAPER_MODES.indexOf(jot.paper);
    setPaper(PAPER_MODES[(i + dir + PAPER_MODES.length) % PAPER_MODES.length]);
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
    clearBtn.disabled = strokes.length === 0;
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
      drawPaper(paperCtx, view, jot.paper, paper.clientWidth, paper.clientHeight, dpr);
    }
    if (baseDirty) {
      baseDirty = false;
      beginFrame(baseCtx, view, dpr);
      drawStrokes(baseCtx, strokes, view, base.clientWidth, base.clientHeight);
      zoomBtn.textContent = `${Math.round(view.scale * 100)}%`;
    }
    if (liveDirty) {
      liveDirty = false;
      beginFrame(liveCtx, view, dpr);
      if (current) drawStroke(liveCtx, current.stroke);
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
    else strokes.push(...action.strokes);
    redoStack.push(action);
    afterHistoryChange();
  }
  function redo() {
    if (current || redoStack.length === 0) return;
    const action = redoStack.pop();
    if (action.type === 'add') strokes.push(action.stroke);
    else strokes.length = 0;
    undoStack.push(action);
    afterHistoryChange();
  }
  function commit(action) {
    undoStack.push(action);
    redoStack.length = 0;
    afterHistoryChange();
  }

  function clearJot() {
    if (current || strokes.length === 0) return;
    commit({ type: 'clear', strokes: strokes.splice(0, strokes.length) });
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

  function onPointerDown(e) {
    if (e.pointerType === 'touch') {
      if (current) return; // palm while writing with a pen
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      capture(e.pointerId);
      return;
    }
    if (current || mousePan) return;
    const wantsPan = e.button === 1 || (e.button === 0 && spaceHeld) || (e.pointerType === 'pen' && e.button === 5);
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
      if (pts.length === 1) {
        view.panBy(e.clientX - prev.x, e.clientY - prev.y);
      } else if (pts.length >= 2) {
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
    if (current && e.pointerId === current.pointerId) {
      endStroke(e, e.type === 'pointercancel');
      return;
    }
    if (mousePan && e.pointerId === mousePan.pointerId) {
      mousePan = null;
      el.classList.remove('panning');
      return;
    }
    touches.delete(e.pointerId);
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
    if (e.target instanceof HTMLInputElement) return;
    const mod = e.metaKey || e.ctrlKey;
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
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      cycleColor(e.key === 'ArrowRight' ? 1 : -1);
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
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', resize);
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('visibilitychange', onVisibility);

  setColor(color);
  setSize(sizeKey);
  paperBtn.textContent = PAPER_LABELS[jot.paper] ?? 'Plain';
  paperBtn.setAttribute('aria-pressed', String(jot.paper !== 'none'));
  updateHistoryButtons();
  resize();
  document.title = `Jotted · ${jot.id.slice(-6)}`;

  return function unmount() {
    if (saveTimer) saveNow();
    cancelAnimationFrame(frame);
    document.removeEventListener('gesturestart', preventDefault);
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
