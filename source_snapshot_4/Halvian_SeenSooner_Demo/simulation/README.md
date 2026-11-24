# SeenSooner Paired W2 Reduction Simulation

This directory contains a **paired discrete-event simulation** comparing a hypothetical existing workflow (Baseline) with SeenSooner. It **does not retrain or overwrite** the W2 or LWBS models.

## Reproduce on Windows

From the simulation directory, using a configured Python environment:

```powershell
python simulate_w2_reduction.py --source-dir source_data --out-dir outputs_fixed --seed 20261122 --primary-replicates 30 --sensitivity-replicates 15
python validate_simulation_outputs.py --out-dir outputs_fixed
```

Or use the parent demo folder's `.\run-verification.ps1` script to verify included outputs.

## Clinical and data rules

- `W2 = room_entered_at - triage_completed_at`.
- Being called to a room does **not** end W2.
- Lower ESI numbers indicate higher clinical priority; within the same ESI, prioritize the longer wait, subject to nurse judgment.
- Nurse-confirmed room requirements remain fixed. Treatment room pools have capacities of 32 Regular ED, 8 Fast Track, 4 Resuscitation/Trauma and 4 Behavioral Health.
- Room states are `Available` and `Occupied`; turnover is included in the assumed occupied duration.
- Baseline and SeenSooner use identical synthetic arrivals, patient profiles, room types, initial capacity, service durations and random seeds. Only explicitly specified workflow/coordination assumptions differ.
- Formal missed-call recalls use a 30-minute window. Returned patients are placed back in the queue only after nurse reassessment, without automatic restoration of their previous position.
- LWBS events are handled as censored observations, without inventing completed W2 or assuming a causal LWBS benefit.

## Outputs

- `outputs_fixed/simulation_assumptions.csv` — distinguishes source case facts from synthetic and scenario assumptions.
- `outputs_fixed/baseline_vs_intervention.csv` — neutral normal-day Faster KPIs.
- `outputs_fixed/peak_hour_comparison.csv` — normal weekday, Monday peak, weekend and winter surge results.
- `outputs_fixed/esi_fairness_comparison.csv` — stratified ESI, insurance, mobile-access and room-type results.
- `outputs_fixed/esi12_extreme_delay_audit.csv` — individual ESI-1/ESI-2 longer-wait exceptions.
- `outputs_fixed/simulation_events_sample.csv` — paired event timelines.
- `outputs_fixed/sensitivity_analysis.csv` — conservative, neutral, high-pressure, immediate-skip and equal-process controls.
- `outputs_fixed/lwbs_censored_summary.csv` — separately censored LWBS reference analysis.
- `outputs_fixed/independent_validation_checks.csv` and `outputs_fixed/simulation_validation_checks.csv` — simulation checks.

## Key limitations

The original 200-row fixture spans multiple dates and is a **feature/edge-case sample**, not a representative single-day queue. Exact room-type demand shares, room occupation lengths, turnover, no-response rates and coordination delays are not specified in the challenge case. These values are declared scenario assumptions and tested for sensitivity. Absolute simulated W2 is not a validated hospital estimate; paired differences are exploratory. **ESI-2 longer-wait outliers remain and require clinical review.**

See `../reports/SeenSooner_Integration_Validation_Report_EN.md` for the complete English report.
