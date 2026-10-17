// Keyboard shortcut reference, rendered as an in-app overlay.
const IS_MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '') || globalThis.navigator?.userAgentData?.platform === 'macOS';
const MOD = IS_MAC ? '⌘' : 'Ctrl';
const SHIFT = IS_MAC ? '⇧' : 'Shift';
const k = (...parts) => parts.join(IS_MAC ? '' : '+');

export function shortcutGroups({ desktop = false } = {}) {
  const groups = [
    ['Drawing', [
      ['1 – 6', 'Pick a color'],
      ['← →', 'Previous / next color'],
      ['↑ ↓', 'Thinner / thicker pen (fourth size is the highlighter)'],
      ['E', 'Eraser (tap or drag over ink)'],
      ['Alt + drag, or right mouse button', 'Erase while held'],
      ['Shift + arrows', 'Nudge everything'],
    ]],
    ['Annotate', [
      ['V', 'Pointer: select, drag to move, double-click text to edit; a selected image gets Resize and Crop buttons'],
      ['B', 'Box'],
      ['A', 'Arrow'],
      ['T', 'Text (Enter commits, Shift+Enter new line)'],
      ['R', 'Pixelate an area of an image'],
      ['Delete', 'Remove the selection, or clear the jot if nothing is selected'],
      ['Esc', 'Deselect, leave a mode, then back to the list'],
    ]],
    ['Canvas', [
      ['Space + drag, middle mouse, two fingers', 'Pan'],
      [`${MOD} + wheel, pinch`, 'Zoom'],
      ['0', 'Reset view'],
      ['G', 'Paper: plain, grid, lines, dots (Shift+G backwards)'],
      ['L', 'Light / dark canvas'],
      ['H', 'Hide the interface'],
    ]],
    ['Jot', [
      [k(MOD, 'C') + ' / ' + k(MOD, 'X') + ' / ' + k(MOD, 'V'), 'Copy / cut / paste the selected item (pointer tool)'],
      [k(MOD, 'Z'), 'Undo'],
      [k(SHIFT, MOD, 'Z'), 'Redo'],
      [k(MOD, 'E'), 'Export PNG'],
      [k(SHIFT, MOD, 'E'), 'Export SVG'],

      ['?', 'This list'],
    ]],
  ];
  const cap = (key) => (IS_MAC ? `⇧⌘${key}` : `Ctrl+Shift+${key}`);
  groups.push([desktop ? 'Desktop app (work from any app while Jotted runs)' : 'Desktop app only', [
    [cap('J'), 'Capture a screen area into the open jot'],
    [cap('F'), 'Capture a full screen (click the monitor if you have several)'],
    [cap('L'), 'Capture the last area again'],
    ['⏱ button', 'Capture delay (0, 3, 5, 10 s); area is chosen first, then the countdown runs'],
    [k(MOD, 'N'), 'New jot'],
    [k(MOD, 'L'), 'All jots'],
    [k(MOD, '/'), 'Keyboard shortcuts'],
  ]]);
  return groups;
}

const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/** Mounts (once) and toggles the shortcuts overlay. */
export function toggleShortcuts(show = null) {
  let panel = document.querySelector('.shortcuts');
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'shortcuts';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Keyboard shortcuts');
    const desktop = !!globalThis.jotted?.captureArea;
    panel.innerHTML = `<div class="shortcuts-card">
      <header><h2>Keyboard shortcuts</h2><button class="btn ghost close" aria-label="Close">✕</button></header>
      <div class="shortcuts-cols">${shortcutGroups({ desktop }).map(([title, rows]) => `
        <section><h3>${esc(title)}</h3><table>${rows.map(([keys, what]) => `<tr><td><kbd>${esc(keys)}</kbd></td><td>${esc(what)}</td></tr>`).join('')}</table></section>`).join('')}
      </div>
    </div>`;
    panel.addEventListener('click', (e) => { if (e.target === panel || e.target.closest('.close')) toggleShortcuts(false); });
    panel.hidden = true;
    document.body.append(panel);
  }
  const next = show ?? panel.hidden;
  panel.hidden = !next;
  return next;
}
