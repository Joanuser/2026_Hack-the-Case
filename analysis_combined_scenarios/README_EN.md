# Combined Smart Routing and LWBS Prevention Scenario

This folder contains a reproducible *conditional what-if projection*, **not** measured hospital improvement or a validated patient-room simulation. Real intervention effectiveness is `NOT_IDENTIFIABLE`.

## Reproduce from the handoff package root

Requirements: Python 3.11+, `numpy`, and `pandas`.

```powershell
python analysis_combined_scenarios/run_combined_scenarios.py
python -m unittest discover -s analysis_combined_scenarios -p "test_*.py" -v
```

The script reads the original 85,000-row synthetic cohort without modifying it and writes results only to `analysis_combined_scenarios`.

## Reproducible files

- `scenario_config.json`: explicit hypothetical efficacy assumptions (not evidence).
- `run_combined_scenarios.py`: original Codex calculation methods with English report generation and portable paths.
- `test_combined_scenarios.py`: unit and evidence-boundary tests.
- `combined_scenario_summary_EN.md`: complete English scenario report.
- `combined_four_arms.csv`: neutral scenario four-arm comparison.
- `sensitivity_grid.csv`: all assumption sets, subgroups, and arms.
- `assumption_register.csv`: facts, assumptions and boundaries.
- `safety_esi12_summary.csv`: mathematical ESI 1/2 checks and safety limits.
- `source_integrity.csv`: source-file hashes from the local rerun.
- `pitch_ready_result_EN.md`: English wording for presentations.

Waiting Time (W) uses only historically roomed patients. LWBS uses every patient in the corresponding group. No historical LWBS record receives an invented room-entry time.

The primary neutral assumptions are 10% shorter recorded W for historically roomed ESI 3-5 patients and 20% retention among historical LWBS patients. These are what-if efficacy *inputs*, not observed effects. ESI 1/2 clinical safety is not verified.
