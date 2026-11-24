#!/usr/bin/env node
// SeenSooner mock API server — zero dependencies (Node 18+).
// Implements the shared contract in API_CONTRACT.md with in-memory data.
// Run:  node mock-server/server.mjs            (port 4000)
//       PORT=4100 node mock-server/server.mjs
// NOT FOR PRODUCTION: no real auth, no persistence, demo wait-time model.

import http from 'node:http';
import { URL } from 'node:url';
import { createStore, ApiError } from './store.mjs';

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim());
const LATENCY_MS = Number(process.env.MOCK_LATENCY_MS || 150);

const store = createStore();
const clients = new Set(); // { res, channel, patientId }

store.subscribe((evt) => {
  for (const c of clients) {
    let payload;
    if (c.channel === 'staff') payload = evt;
    else payload = { type: 'queue.updated', updatedAt: evt.updatedAt }; // public + patient: no identifiers
    c.res.write(`event: change\ndata: ${JSON.stringify(payload)}\n\n`);
  }
});

function cors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes('*')) res.setHeader('Access-Control-Allow-Origin', origin || '*');
  else if (origin && ALLOWED_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Staff-Name');
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const ch of req) {
    size += ch.length;
    if (size > 100_000) throw new ApiError(413, 'too_large', 'Request body too large');
    chunks.push(ch);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'bad_json', 'Request body must be JSON'); }
}

function bearer(req, url) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return url.searchParams.get('token') || '';
}

const routes = [
  ['GET', /^\/api\/health$/, () => ({ ok: true, mode: 'mock', time: new Date().toISOString() })],
  ['POST', /^\/api\/summaries\/draft$/, (ctx) => store.draftSummary(ctx.body)],
  ['POST', /^\/api\/checkins$/, (ctx) => ctx.created(store.createCheckIn(ctx.body))],
  ['GET', /^\/api\/checkins\/([^/]+)$/, (ctx, id) => store.getPatientStatus(id, ctx.token)],
  ['PATCH', /^\/api\/checkins\/([^/]+)\/symptoms$/, (ctx, id) => store.updateSymptoms(id, ctx.token, ctx.body)],
  ['PATCH', /^\/api\/checkins\/([^/]+)\/insurance$/, (ctx, id) => store.updateInsurance(id, ctx.token, ctx.body)],
  ['POST', /^\/api\/checkins\/([^/]+)\/location-exit$/, (ctx, id) => store.reportLocationExit(id, ctx.token, ctx.body)],
  ['GET', /^\/api\/staff\/patients$/, () => store.listPatients()],
  ['POST', /^\/api\/staff\/patients$/, (ctx) => ctx.created(store.createStaffPatient(ctx.body))],
  ['PATCH', /^\/api\/staff\/patients\/([^/]+)$/, (ctx, id) => store.updatePatient(id, ctx.body, ctx.staffName)],
  ['POST', /^\/api\/staff\/patients\/([^/]+)\/contacts$/, (ctx, id) => store.recordContact(id, ctx.body, ctx.staffName)],
  ['GET', /^\/api\/public\/queue$/, () => store.publicQueue()],
  ['POST', /^\/api\/dev\/reset$/, () => { store.reset(); return { ok: true }; }],
];

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Server-Sent Events
  if (req.method === 'GET' && url.pathname === '/api/events') {
    const channel = url.searchParams.get('channel') || 'public';
    if (!['public', 'staff', 'patient'].includes(channel)) return send(res, 400, { error: { code: 'bad_channel', message: 'Unknown channel' } });
    if (channel === 'patient') {
      try { store.getPatientStatus(url.searchParams.get('checkinId') || '', bearer(req, url)); }
      catch (e) { return send(res, e.status || 401, e.toJSON ? e.toJSON() : { error: { code: 'unauthorized' } }); }
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`retry: 3000\nevent: ready\ndata: ${JSON.stringify({ updatedAt: store.getState().updatedAt })}\n\n`);
    const client = { res, channel };
    clients.add(client);
    const ping = setInterval(() => res.write(`: ping\n\n`), 20000);
    req.on('close', () => { clearInterval(ping); clients.delete(client); });
    return;
  }

  const route = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
  if (!route) return send(res, 404, { error: { code: 'not_found', message: `No route for ${req.method} ${url.pathname}` } });
  try {
    const body = ['POST', 'PATCH'].includes(req.method) ? await readJson(req) : undefined;
    let status = 200;
    const ctx = {
      body: body || {},
      token: bearer(req, url),
      staffName: String(req.headers['x-staff-name'] || 'Nurse').slice(0, 60),
      created: (v) => { status = 201; return v; },
    };
    const match = url.pathname.match(route[1]);
    const result = route[2](ctx, ...(match ? match.slice(1).map(decodeURIComponent) : []));
    if (LATENCY_MS) await new Promise((r) => setTimeout(r, LATENCY_MS));
    send(res, status, result);
  } catch (e) {
    if (e instanceof ApiError) return send(res, e.status, e.toJSON());
    console.error(e);
    send(res, 500, { error: { code: 'server_error', message: 'Unexpected server error' } });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`SeenSooner mock API listening on http://localhost:${PORT}  (MOCK DATA — not a real backend)`);
});
