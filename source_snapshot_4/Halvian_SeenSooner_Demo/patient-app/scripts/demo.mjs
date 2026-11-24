#!/usr/bin/env node
// Starts the bundled mock API (port 4000) and this app's Vite dev server together.
// If something is already listening on 4000 (e.g. another SeenSooner app's demo), it is reused.
import { spawn } from 'node:child_process';
import net from 'node:net';

const MOCK_PORT = Number(process.env.MOCK_PORT || 4000);
const inUse = await new Promise((resolve) => {
  const s = net.connect(MOCK_PORT, '127.0.0.1');
  s.on('connect', () => { s.destroy(); resolve(true); });
  s.on('error', () => resolve(false));
});

const children = [];
if (!inUse) {
  children.push(spawn(process.execPath, ['mock-server/server.mjs'], { stdio: 'inherit', env: { ...process.env, PORT: String(MOCK_PORT) } }));
} else {
  console.log(`Mock API already running on :${MOCK_PORT} — reusing it.`);
}
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
children.push(spawn(npx, ['vite'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, VITE_API_MODE: 'http', VITE_API_BASE_URL: `http://localhost:${MOCK_PORT}`, VITE_MOCK_BACKEND: 'true' },
}));
const stop = () => { children.forEach((c) => c.kill()); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach((c) => c.on('exit', (code) => { if (code) stop(); }));
