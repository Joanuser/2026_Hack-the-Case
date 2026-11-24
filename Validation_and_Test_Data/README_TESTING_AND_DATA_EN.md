# Final Test Data and Validation | SeenSooner

This directory adds English-only API examples and test references to the final four-app source package. They are **synthetic demo fixtures**, not real patient records or proof of clinical effectiveness.

## Authoritative latest data

- `../source_snapshot_4/Halvian_SeenSooner_Demo/simulation/source_data/annual_85000_w2_model_ready.csv` — the unchanged 85,000-visit synthetic historical dataset.
- `../source_snapshot_4/Halvian_SeenSooner_Demo/simulation/source_data/encounters_200_w2_scenario.csv` — 200 independent room-type examples; do not join to the annual cohort by row order.
- `../source_snapshot_4/Halvian_SeenSooner_Demo/simulation/source_data/resource_snapshots_12.csv` — aggregate room availability snapshots, not patient-room events.
- `../source_snapshot_4/Halvian_SeenSooner_Demo/backend/fixtures/` — 30-patient W/event examples and staff response fixture used by the backend.
- `../analysis_w_lwbs/` — W and LWBS prediction model evaluation metrics.
- `../analysis_combined_scenarios/` — the latest combined four-arm **hypothetical** results, sensitivity grid, assumption config, safety notes, reproducible code and test suite.

## New UI/API examples in this folder

`UI_API_Fixtures/` contains synthetic patient check-ins, staff check-ins, patient status examples and a public waiting-room fixture. These examples came from the earlier three-app schema test collection. They are supplied **only for UI/API schema testing**. ETA fields may be null or placeholder values; they are not validated predictions and must not overwrite the latest model outputs.

`Schema_and_Test_Plan/` contains an English field mapping, test matrix, types reference and a **historical** fixture validation CSV. The historical report is not a new end-to-end run of the final four-app system. It is not the source for final W or LWBS impact claims.

`Latest_Validation/` provides copies of the combined-scenario test log, oversight dashboard validation evidence, and original backend integration test results. The source versions also remain in their project folders.

## Final reported scenario (not observed outcomes)

- Mean triage-to-room W: **34.87 to 31.75 minutes**, a projected decrease of **3.11 minutes**.
- Median triage-to-room W: **33.82 to 30.82 minutes**, a projected decrease of **2.99 minutes**.
- LWBS: **4.00% to 3.20%**, a projected decrease of **0.80 percentage points**.

**Explicit input assumptions:** 10% less observed W for historically roomed ESI 3–5 patients and 20% retention among historical LWBS cases through nurse outreach. These are *what-if inputs*, not effects estimated from hospital intervention data. Real impact is **NOT IDENTIFIABLE**, clinical safety is **NOT VERIFIED**, and the month-9 dashboard metrics are independent **ILLUSTRATIVE MOCK DATA**.

The old test pack's conflicting 85,000-visit summary and outdated Chinese instructions are deliberately excluded. No presentation file is bundled.
