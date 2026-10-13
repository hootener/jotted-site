import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listJots, findJot, renderPng } from '../jots.mjs';

const A = '01ARZ3NDEKTSV4RRFFQ69G5FAA';
const B = '01ARZ3NDEKTSV4RRFFQ69G5FAB';
const mk = (id, name, updatedAt, extra = {}) => ({ id, name, createdAt: 1, updatedAt, theme: 'dark', paper: 'none', images: [],
  strokes: [{ color: '#FF8AC2', size: 6, points: [[10, 10, 0.5], [120, 40, 0.8], [200, 10, 0.3]] }], ...extra });

async function withJots(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'jotted-mcp-'));
  await writeFile(join(dir, `${A}.json`), JSON.stringify(mk(A, 'excited-gullible-hippo', 100)));
  await writeFile(join(dir, `${B}.json`), JSON.stringify(mk(B, 'sleepy-tidy-otter', 200, { theme: 'light' })));
  await writeFile(join(dir, 'junk.txt'), 'x');
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('listJots returns newest first and ignores junk', () =>
  withJots(async (dir) => {
    const jots = await listJots(dir);
    assert.deepEqual(jots.map((j) => j.name), ['sleepy-tidy-otter', 'excited-gullible-hippo']);
  }));

test('findJot by id, exact name, partial name, default latest, ambiguity', () =>
  withJots(async (dir) => {
    assert.equal((await findJot(dir, A)).jot.name, 'excited-gullible-hippo');
    assert.equal((await findJot(dir, 'sleepy-tidy-otter')).jot.id, B);
    assert.equal((await findJot(dir, 'hippo')).jot.id, A);
    assert.equal((await findJot(dir, '')).jot.id, B);
    const amb = await findJot(dir, 'i');
    assert.equal(amb.jot, null);
    assert.equal(amb.candidates.length, 2);
  }));

test('renderPng produces a PNG of the requested size', () =>
  withJots(async (dir) => {
    const [jot] = await listJots(dir);
    const size = (png) => Math.max(png.readUInt32BE(16), png.readUInt32BE(20));
    const full = renderPng(jot, 4096);
    assert.deepEqual([...full.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.ok(size(full) > 200 && size(full) < 400); // natural size, never upscaled
    assert.equal(size(renderPng(jot, 100)), 100); // downscaled to the cap
  }));
