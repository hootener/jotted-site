#!/usr/bin/env node
// MCP server (stdio) exposing Jotted jots to Claude as images.
//   claude mcp add jotted -- node /path/to/jotted/mcp/server.mjs
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { defaultJotsDir, listJots, findJot, renderPng, summarize } from './jots.mjs';

const dir = defaultJotsDir();
const server = new McpServer({ name: 'jotted', version: '0.1.0' });

function imageResult(jot, maxPx) {
  const png = renderPng(jot, maxPx);
  return {
    content: [
      { type: 'text', text: `Jot "${jot.name}" (${jot.id}), updated ${new Date(jot.updatedAt).toISOString()}, ${jot.strokes.length} strokes, ${jot.images.length} images.` },
      { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
    ],
  };
}

server.registerTool(
  'list_jots',
  {
    title: 'List jots',
    description: 'List recent Jotted jots (handwritten notes, possibly annotated screenshots), newest first.',
    inputSchema: { limit: z.number().int().min(1).max(100).default(20).describe('How many to return') },
  },
  async ({ limit }) => {
    const jots = (await listJots(dir)).slice(0, limit);
    if (jots.length === 0) return { content: [{ type: 'text', text: `No jots found in ${dir}.` }] };
    return { content: [{ type: 'text', text: JSON.stringify(jots.map(summarize), null, 2) }] };
  },
);

server.registerTool(
  'get_jot',
  {
    title: 'Get jot as image',
    description: 'Render a jot to a PNG so you can look at it. Identify it by name (e.g. "excited-gullible-hippo", or a unique part of it) or by ULID. Omit to get the most recent jot.',
    inputSchema: {
      jot: z.string().optional().describe('Jot name, part of a name, or ULID. Defaults to the latest jot.'),
      maxPx: z.number().int().min(256).max(4096).default(1600).describe('Longest side of the rendered image in pixels'),
    },
  },
  async ({ jot: ref, maxPx }) => {
    const { jot, candidates } = await findJot(dir, ref);
    if (jot) return imageResult(jot, maxPx);
    if (candidates.length > 1) {
      return { content: [{ type: 'text', text: `Several jots match "${ref}": ${candidates.map((j) => j.name).join(', ')}. Be more specific.` }], isError: true };
    }
    return { content: [{ type: 'text', text: ref ? `No jot matches "${ref}".` : `No jots found in ${dir}.` }], isError: true };
  },
);

server.registerTool(
  'get_latest_jot',
  {
    title: 'Get the most recent jot as image',
    description: 'Render the most recently updated jot to a PNG. Use this when the user says "look at my jot" or "my latest jot".',
    inputSchema: { maxPx: z.number().int().min(256).max(4096).default(1600) },
  },
  async ({ maxPx }) => {
    const [jot] = await listJots(dir);
    if (!jot) return { content: [{ type: 'text', text: `No jots found in ${dir}.` }], isError: true };
    return imageResult(jot, maxPx);
  },
);

await server.connect(new StdioServerTransport());
