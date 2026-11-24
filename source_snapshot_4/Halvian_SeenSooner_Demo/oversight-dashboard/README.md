# SeenSooner — AI Oversight Committee Dashboard

An independent, English-language React + TypeScript + Vite dashboard for local oversight demonstrations. It does not call the SeenSooner backend and it does not alter any source patient record, model, API, PDF, CSV, presentation, or existing web app.

## Evidence boundaries

- The **Monthly Oversight** tab uses `ILLUSTRATIVE_UI_MOCK_DATA`. These values are editable demonstration fixtures, not observed hospital outcomes.
- The **What-if Projection** tab shows a `HYPOTHETICAL_SCENARIO_PROJECTION_NOT_OBSERVED_HOSPITAL_OUTCOME` derived from the existing combined scenario analysis.
- The neutral illustration reports Mean W 34.87 → 31.75 minutes (3.11 minutes lower) and LWBS 4.00% → 3.20% (0.80 percentage points lower).
- Intervention effectiveness is `NOT_IDENTIFIABLE`, clinical safety is `NOT_VERIFIED`, and the scenario is not a validated capacity-constrained simulation. It must not be used to claim real-world hospital improvement or deployment readiness.
- Door-to-provider (DTP) and Waiting Time (W) are separate measures and are never plotted on the same axis.

## Run locally

Requires Node.js 20.19 or newer.

```powershell
cd "source_snapshot_4\Halvian_SeenSooner_Demo\oversight-dashboard"
npm install
npm run dev
```

Open <http://127.0.0.1:5176>. No deployment is required.

For direct review links, use `?period=month-9` for the default monthly view or `?view=projection` for the hypothetical What-if Projection view.

## Validate

```powershell
npm test
npm run build
npm run preview
```

## Edit the demo

Use **Edit selected period** for session-only edits, or update the version-controlled JSON fixtures in `src/data/`. **Reset demo** restores the fixture values. No edit is sent to a backend or persisted after refresh.
