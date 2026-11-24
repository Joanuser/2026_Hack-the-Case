# Combined Scenario Validation — English Team Handoff

Verification run: 2026-11-23.

## Local checks on this handoff copy

- `python analysis_combined_scenarios/run_combined_scenarios.py`: PASS.
- `python -m unittest discover -s analysis_combined_scenarios -p "test_*.py" -v`: **12/12 PASS**.
- Source-project hashes measured before and after scenario rerun: **175/175 unchanged** (including the release manifest).
- `python source_snapshot_4/Halvian_SeenSooner_Demo/verify_manifest.py`: **174/174 PASS** (the release manifest excludes precompiled font binaries).
- All 120 sensitivity rows and 4 neutral four-arm rows reproduce the original Codex numeric results in all **39 numeric columns**.
- Edited analysis reports, CSV/JSON labels, script output strings, and release documentation: no Chinese-language characters detected.
- The original Codex project validation had 322/322 source-file hashes unchanged; this release package excludes font binaries and therefore has a different file count. No original hospital PDF, synthetic visit data, API, model, or three existing frontend source implementations were edited.

## Results classification

- Historical synthetic baseline: mean W 34.87 min; median W 33.82 min; LWBS 4.00%.
- Neutral what-if: mean W 31.75 min (3.11 min lower); LWBS 3.20% (0.80 pp lower).
- Hypotheses: 10% shorter recorded W for historically roomed ESI 3–5 patients and 20% retention among historical LWBS patients.
- True intervention effects: `NOT_IDENTIFIABLE`.
- Clinical safety: `NOT_VERIFIABLE`.
- Not a capacity-constrained room assignment replay or observed hospital improvement.

The original oversight dashboard's browser and build test claims are documented separately in `source_snapshot_4/Halvian_SeenSooner_Demo/oversight-dashboard/validation/TEST_RESULTS.md`. Those browser checks were recorded by Codex for the original 2026-11-23 dashboard ZIP and were not independently rerun in this package-production pass.
