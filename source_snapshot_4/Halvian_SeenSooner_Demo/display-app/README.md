# SeenSooner — Waiting room display

Full-screen TV app for the waiting room, built on the 1280×720 Figma frame and scaled uniformly to any
TV resolution (1080p, 4K). Shows **waiting numbers only**: the provider queue with estimated waits, "Now seeing"
numbers, and numbers waiting for nurse assessment. It reads `GET /api/public/queue`, which contains no names,
symptoms or other private data. Live updates via SSE; shows Connecting / Reconnecting / Offline states while
keeping the last data on screen; requests a screen wake lock and hides the cursor.

This is one of three separate apps (patient phone, waiting-room display, nurse dashboard). Each builds and deploys
on its own; they share data only through the backend API described in [`API_CONTRACT.md`](API_CONTRACT.md).

> **Backend status:** no real backend was supplied, so this app ships with a mock API (`mock-server/`). Nothing here
> is connected to a live hospital system.

## Requirements
- Node.js **20.19+** (or 22.12+) and npm.

## Run locally (fastest)
```bash
npm install
npm run demo        # starts the mock API on :4000 (or reuses one already running) + this app on http://localhost:5174
```

## End-to-end demo with all three apps
Unzip the three apps side by side, `npm install` in each, then in three terminals:
```bash
cd seensooner-patient-phone        && npm run demo   # starts mock API :4000 + http://localhost:5173
cd seensooner-nurse-dashboard      && npm run demo   # reuses mock API     + http://localhost:5175
cd seensooner-waiting-room-display && npm run demo   # reuses mock API     + http://localhost:5174
```
Then: check in on the phone app (use hospital code `ED-MAIN`, or open `http://localhost:5173/?site=ED-MAIN`) →
the new number appears on the dashboard (toast + Assessment queue) and on the TV → in the dashboard **Start
assessment**, set a priority, **Complete assessment** → the phone shows "Waiting to see a provider" and the TV lists
the number → **Call to care team** → TV "Now seeing", phone "It's your turn". Reset demo data with
`curl -X POST http://localhost:4000/api/dev/reset`.

## Manual setup / scripts
```bash
cp .env.example .env    # edit values (see comments)
npm run mock-api        # mock API only (PORT=4000 by default)
npm run dev             # Vite dev server on :5174
npm run build           # type-check + production build into dist/
npm run preview         # serve dist/ locally
```
`VITE_API_MODE=memory` runs with in-browser mock data and no server (this app only — data is not shared with the other apps).

## Deploy
The build is a static site (`dist/`). Environment variables are baked in **at build time**, so set them in your host before building.
1. Set `VITE_API_MODE=http`, `VITE_API_BASE_URL=https://<your-api>` and `VITE_MOCK_BACKEND=false` (plus the app-specific values in `.env.example`).
2. `npm ci && npm run build`
3. Upload `dist/` to any static host. Examples:
   - **Netlify:** build command `npm run build`, publish directory `dist`.
   - **Vercel:** framework preset *Vite*, output `dist`.
   - **Cloudflare Pages / S3 + CloudFront / nginx:** serve `dist/` as static files (no server rewrites needed; routing uses `#/…`).
4. Serve over **HTTPS** (required for camera and location on phones).
5. On the API, allow CORS from this app's origin and make sure proxies don't buffer `text/event-stream`.

The mock server (`node mock-server/server.mjs`, zero dependencies) can be deployed for a shared online demo (e.g. Render/Fly/Railway, `PORT` env var), but it keeps data in memory, has no real auth and **must not hold real patient data**.

## Project layout
```
src/api/            ← the only backend-facing code (swap/adjust here to connect the real API)
  types.ts            shared contract types (identical in all three apps)
  httpAdapter.ts      fetch + SSE (with polling fallback) for VITE_API_BASE_URL
  memoryAdapter.ts    in-browser mock (VITE_API_MODE=memory)
  useLive.ts          fetch + realtime refresh hook (loading / error / reconnecting state)
src/ui/icons.tsx    icons redrawn from the Figma set
mock-server/        zero-dependency mock API (server.mjs) + shared demo store (store.mjs)
API_CONTRACT.md     endpoint contract and what the backend still needs to supply
```

## Running on a TV
Open the deployed URL in the TV/stick browser (or a kiosk browser such as Chrome `--kiosk`) and leave it full screen.

## Design source
Figma: "Halvian AI-Assisted Intake & Triage Prototype" (product name changed to SeenSooner throughout). Figma's exported
icon/asset URLs are temporary and couldn't be downloaded, so icons and the brand cross are redrawn as inline SVG; colors,
type (Inter), spacing and copy follow the Figma frames.
