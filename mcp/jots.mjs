// Read-only access to the desktop app's jot files and PNG rendering.
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { jotToSVG } from '../app/src/export.js';
import { normalizeJot } from '../app/src/store.js';

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Where the desktop app keeps jots on this platform (JOTTED_DATA_DIR overrides). */
export function defaultJotsDir() {
  if (process.env.JOTTED_JOTS_DIR) return process.env.JOTTED_JOTS_DIR;
  if (process.env.JOTTED_DATA_DIR) return join(process.env.JOTTED_DATA_DIR, 'jots');
  // Electron's userData folder is named after the package name ("jotted").
  const root = process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support')
    : process.platform === 'win32'
      ? (process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'))
      : (process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'));
  for (const name of ['jotted', 'Jotted']) {
    const dir = join(root, name, 'jots');
    if (existsSync(dir)) return dir;
  }
  return join(root, 'jotted', 'jots');
}

export async function listJots(dir) {
  const names = (await readdir(dir).catch(() => [])).filter((n) => /^[0-9A-HJKMNP-TV-Z]{26}\.json$/.test(n));
  const jots = [];
  for (const n of names) {
    try {
      const jot = normalizeJot(JSON.parse(await readFile(join(dir, n), 'utf8')), n.slice(0, 26));
      if (jot) jots.push(jot);
    } catch { /* skip corrupt files */ }
  }
  return jots.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function summarize(jot) {
  return {
    id: jot.id,
    name: jot.name,
    updatedAt: new Date(jot.updatedAt).toISOString(),
    strokes: jot.strokes.length,
    images: jot.images.length,
    theme: jot.theme,
  };
}

/** Find a jot by exact id, exact name, or unique case-insensitive name prefix. */
export async function findJot(dir, ref) {
  const jots = await listJots(dir);
  const q = String(ref ?? '').trim();
  if (!q) return { jot: jots[0] ?? null, candidates: [] };
  if (ULID_RE.test(q.toUpperCase())) {
    const hit = jots.find((j) => j.id === q.toUpperCase());
    return { jot: hit ?? null, candidates: [] };
  }
  const lower = q.toLowerCase();
  const exact = jots.find((j) => j.name.toLowerCase() === lower);
  if (exact) return { jot: exact, candidates: [] };
  const matches = jots.filter((j) => j.name.toLowerCase().includes(lower));
  return matches.length === 1 ? { jot: matches[0], candidates: [] } : { jot: null, candidates: matches };
}

/** Render a jot to PNG bytes, scaled so the longest side is at most maxPx. */
export function renderPng(jot, maxPx = 1600) {
  const svg = jotToSVG(jot);
  const [w, h] = svg.match(/width="(\d+)" height="(\d+)"/).slice(1).map(Number);
  const fitTo = w >= h ? { mode: 'width', value: Math.min(w, maxPx) } : { mode: 'height', value: Math.min(h, maxPx) };
  const resvg = new Resvg(svg, { fitTo, background: jot.theme === 'light' ? '#ffffff' : '#000000' });
  return resvg.render().asPng();
}
