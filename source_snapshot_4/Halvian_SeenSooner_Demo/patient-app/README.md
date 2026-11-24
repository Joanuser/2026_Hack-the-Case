# SeenSooner — Patient phone check-in

Mobile web app patients open by scanning the hospital QR code. Screens (from the Figma file, latest versions):
cover → QR scan (camera + manual hospital code) with location-permission dialog → language → information →
symptoms → review (AI-organized **draft** summary the patient can edit) → waiting status (nurse assessment /
provider stage with people-ahead + estimate) → "My symptoms have changed" update → location-exit confirmation.
Reviewer build: English-language patient portal (original multilingual prototype archived separately).

**QR code content:** encode `https://<your-patient-app-url>/?site=ED-MAIN`. Opening that URL skips the in-app scanner.
The in-app scanner (camera) needs HTTPS (or localhost).

This is one of three separate apps (patient phone, waiting-room display, nurse dashboard). Each builds and deploys
on its own; they share data only through the backend API described in [`API_CONTRACT.md`](API_CONTRACT.md).

> **Backend status:** no real backend was supplied, so this app ships with a mock API (`mock-server/`). Nothing here
> is connected to a live hospital system.

## Requirements
- Node.js **20.19+** (or 22.12+) and npm.

## Run locally (fastest)
```bash
npm install
npm run demo        # starts the mock API on :4000 (or reuses one already running) + this app on http://localhost:5173
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
npm run dev             # Vite dev server on :5173
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

## Notes
- Back buttons: every step returns to the previous step with data kept (session storage). On the waiting screen, Back opens a read-only "Your check-in" view — it never re-submits.
- The check-in session (id + patient token) is kept in `localStorage`, so a refresh returns to the waiting screen.
- In mock mode the waiting screen shows **Demo tools → Simulate leaving the hospital area** to trigger the location-exit dialog without walking 150 m.
- Spanish/Chinese/Arabic copy are working translations — have them reviewed by a qualified medical translator before clinical use.

## Design source
Figma: "Halvian AI-Assisted Intake & Triage Prototype" (product name changed to SeenSooner throughout). Figma's exported
icon/asset URLs are temporary and couldn't be downloaded, so icons and the brand cross are redrawn as inline SVG; colors,
type (Inter), spacing and copy follow the Figma frames.
