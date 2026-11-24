# Faster W2 Simulation — Revised Findings

The corrected neutral normal-weekday paired simulation uses 30 replicates. All time values below refer to **synthetic triage-to-room waiting (W2)**.

| Indicator | Baseline | SeenSooner | Difference |
|---|---:|---:|---:|
| Median W2 | 26.67 min | 25.04 min | 1.63 min shorter |
| Mean W2 | 35.10 min | 33.24 min | 1.85 min shorter |
| P90 W2 | 55.86 min | 53.90 min | 1.95 min shorter |
| Patients with completed W2 over 60 min | 8.29% | 7.62% | 0.67 percentage points lower |
| Simulated idle time due to unanswered calls | 82.83 min/day | 16.57 min/day | 66.26 min/day lower |

Mean W2 reductions by scenario: **Monday Peak 2.40 minutes**, **Weekend 1.68 minutes**, and **Winter Surge 3.22 minutes**. The reductions depend on assumed room demand and occupancy, call response behavior, and coordination delay. They are **not observed hospital outcomes**.

After the 30-minute recall period, returning patients must undergo **nurse reassessment** before being requeued. The system does not automatically restore the original queue position. The ESI-1 matched simulation reported no individual longer waits; however, **14 of 1,132 matched ESI-2 cases (1.24%)** experienced longer W2 with a maximum increase of **69.50 minutes**. This is an unresolved clinical safety concern, not a passed production safety criterion.

The original five ZIP archives and the 85,000-row synthetic dataset were preserved. The previously abnormal simulation (median 2 min, mean 125.52 min) is not included as the headline result. Full information about assumptions, fairness, model limitations, integration and the safety audit is in `../reports/SeenSooner_Integration_Validation_Report_EN.md`.
