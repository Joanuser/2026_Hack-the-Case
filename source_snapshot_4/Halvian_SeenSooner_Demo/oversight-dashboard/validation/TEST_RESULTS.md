# Oversight Dashboard Test Results

Validation date: 2026-11-23 (America/New_York)

## Automated checks

| Check | Result |
|---|---|
| `npm install --ignore-scripts` | PASS — 25 packages audited, 0 vulnerabilities |
| `npm test` | PASS — 12/12 checks |
| `npm run build` | PASS — TypeScript and Vite production build completed without errors |
| Existing project `verify_manifest.py` | PASS — 321/321 manifest entries |
| Original-source SHA-256 comparison | PASS — 322/322 original files unchanged |
| English authored-source audit | PASS — no CJK characters in authored source or documentation |

## Browser checks

Microsoft Edge was used against `http://127.0.0.1:5176/`.

| Behavior | Result |
|---|---|
| Month selector: Baseline and Months 1–9 | PASS |
| Month 9 cards, summary, actions, and chart highlight | PASS |
| Session-only KPI editor | PASS |
| Reset demo restores Month 9 fixture | PASS |
| Monthly Oversight / What-if Projection tabs | PASS |
| Four SVG charts and point descriptions/tooltips | PASS |
| Desktop viewport: 1365 × 900 | PASS — no page-level horizontal overflow |
| Mobile viewport: 375 × 812 | PASS — no page-level horizontal overflow |
| Browser console | PASS — 0 error entries |

## Exact data assertions

- Month 9 is explicitly `ILLUSTRATIVE_UI_MOCK_DATA`: DTP 50.0 min, LWBS 3.75%, uninsured gap 2.4 pp, missed high-risk 0.85%, and nurse override 14.0%.
- The neutral projection is explicitly hypothetical: Mean W 34.87 → 31.75 min (3.11 min lower) and LWBS 4.00% → 3.20% (0.80 pp lower).
- Waiting Time (W) is displayed only in the What-if Projection view and is defined as triage completion to appropriate treatment-room entry.
- DTP is displayed only as the illustrative access metric and is not presented as W.
- Clinical safety remains `NOT VERIFIED`; real intervention effect remains `NOT IDENTIFIABLE`.

No deployment was performed.
