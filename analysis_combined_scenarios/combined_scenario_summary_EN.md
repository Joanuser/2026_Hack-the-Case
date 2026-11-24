# SeenSooner: Smart Routing and LWBS Prevention | Conditional What-If Analysis

**Evidence classification: HYPOTHETICAL SCENARIO PROJECTION, NOT OBSERVED HOSPITAL OUTCOMES.**
The true intervention effect is `NOT_IDENTIFIABLE`. The neutral illustration assumes a 10% reduction in recorded W for historically roomed ESI 3–5 patients and a 20% outreach-retention fraction among historical LWBS patients. The primary routing scenario assumes no additional LWBS effect.

Under those assumptions, routing alone projects mean/median/P90 W decreases of **3.11 / 2.99 / 5.36 minutes** with unchanged LWBS. Outreach alone holds W constant and projects LWBS **4.00% to 3.20%**, a **0.80-percentage-point** decrease. The combined scenario applies these independent mechanisms without claiming an experimentally validated interaction.

## A. Data-supported baseline and prediction references

- Fixed historical synthetic cohort: 85,000 visits, of which 81,600 have an observed room-entry time and 3,400 are LWBS (historical LWBS rate **4.00%**).
- Historical W among roomed patients: mean **34.87 min**, median **33.82 min**, and P90 **55.27 min**.
- In the held-out chronological test, W prediction MAE was **9.81 minutes** and LWBS risk ROC-AUC was **0.863**. At a threshold of 0.233, the test detected 246/786 LWBS cases (sensitivity **31.3%**). Risk-model sensitivity is not patient outreach reach or outreach success.
- The real routing effect, outreach retention effect, and patient-level clinical safety are not identifiable or verified with these source records.

## B. Neutral illustration: four-arm comparison

W is evaluated only for the fixed cohort of 81,600 patients who historically entered a room. Historical LWBS patients are not assigned hypothetical room-entry timestamps or W. LWBS uses all 85,000 records as its denominator.

| Arm | Projected W mean / median / P90 (min) | W reduction mean / median / P90 (min) | W > 60 min | Projected LWBS | LWBS reduction | W affected / expected LWBS prevented |
|---|---:|---:|---:|---:|---:|---:|
| Baseline | 34.87 / 33.82 / 55.27 | 0.00 / 0.00 / 0.00 | 6.14% | 4.00% | 0.00 pp | 0 / 0 |
| Routing Only | 31.75 / 30.82 / 49.91 | 3.11 / 2.99 / 5.36 | 2.92% | 4.00% | 0.00 pp | 67159 / 0 |
| Outreach Only | 34.87 / 33.82 / 55.27 | 0.00 / 0.00 / 0.00 | 6.14% | 3.20% | 0.80 pp | 0 / 680 |
| Combined | 31.75 / 30.82 / 49.91 | 3.11 / 2.99 / 5.36 | 2.92% | 3.20% | 0.80 pp | 67159 / 680 |

The four arms change only transparent, user-editable mathematical inputs in `scenario_config.json`. No new room-entry events are generated. Neither prediction MAE nor AUC is converted into time saved or outreach success.

## C. Sensitivity assumptions: combined arm, all patients

| Assumption set | W reduction input | Outreach retention input | Routing LWBS prevention input | W mean / median / P90 reduction (min) | Projected LWBS | Reduction | Expected LWBS prevented |
|---|---:|---:|---:|---:|---:|---:|---:|
| strict_zero | 0% | 0% | 0% | 0.00 / 0.00 / 0.00 | 4.00% | 0.00 pp | 0 |
| conservative | 5% | 10% | 0% | 1.56 / 1.50 / 2.70 | 3.60% | 0.40 pp | 340 |
| neutral | 10% | 20% | 0% | 3.11 / 2.99 / 5.36 | 3.20% | 0.80 pp | 680 |
| more_optimistic | 20% | 30% | 0% | 6.23 / 6.00 / 10.65 | 2.80% | 1.20 pp | 1020 |
| neutral_routing_lwbs_5 | 10% | 20% | 5% | 3.11 / 2.99 / 5.36 | 3.04% | 0.96 pp | 816 |
| neutral_routing_lwbs_10 | 10% | 20% | 10% | 3.11 / 2.99 / 5.36 | 2.88% | 1.12 pp | 952 |

- `strict_zero` is a zero-benefit reference scenario.
- `conservative`, `neutral`, and `more_optimistic` reflect explicitly hypothetical efficacy inputs, not statistical confidence intervals.
- The optional `neutral_routing_lwbs_5` and `_10` cases add a separate hypothetical routing-to-LWBS effect. Outreach is applied only to the remaining LWBS cases; prevented patients are not double counted.
- No efficacy setting has been selected or calibrated from measured intervention effects.

## D. Neutral combined illustration by source-supported subgroup

| Group | Patients | Historically roomed W cohort | Mean / median / P90 W reduction (min) | Baseline to projected LWBS | Reduction |
|---|---:|---:|---:|---:|---:|
| ALL | 85000 | 81600 | 3.11 / 2.99 / 5.36 | 4.00% → 3.20% | 0.80 pp |
| ESI3_5 | 70496 | 67159 | 3.78 / 3.65 / 5.71 | 4.73% → 3.79% | 0.95 pp |
| NORMAL_DAY | 51211 | 49750 | 3.04 / 2.90 / 5.28 | 2.85% → 2.28% | 0.57 pp |
| MONDAY_PEAK | 13184 | 12514 | 3.15 / 3.00 / 5.42 | 5.08% → 4.07% | 1.02 pp |
| WINTER_PEAK | 24088 | 22530 | 3.30 / 3.22 / 5.59 | 6.47% → 5.17% | 1.29 pp |

ESI 3–5, normal day, Monday, and winter groups come from recorded synthetic cohort fields, not added demand or randomized clinical trials.

## E. Product mechanism and scientific limits

- **Routing / Faster:** SeenSooner could help nurses identify a compatible ready treatment room. Quantification here simply multiplies the observed W of historically roomed ESI 3–5 patients by a stated assumed factor; no room-ready / assignment / release event replay is performed.
- **Outreach / LWBS Prevention:** The product could help nurses explain waits, reassess symptoms, and offer support. The illustration applies an assumed retention fraction to 3,400 historical LWBS cases; no actual outreach reach, contact, or retention outcomes were observed.
- **Combined:** Both features can be represented in one product, but the two outcomes use different cohorts and denominators.
- The source hospital has 48 treatment spaces, but this analysis is **not a validated capacity-constrained simulation**. Mathematical W reductions are not evidence of physical room-resource feasibility.

## F. ESI 1 and ESI 2 safety limits

- No projected W decrease or risk-based queue jump is applied to ESI 1/2. The mathematical no-worsening check is **True**.
- This does not establish an immediate clinical pathway for ESI 1 or that ESI 2 would avoid additional severe delays in real operations.
- Patient-level clinical safety remains **`NOT_VERIFIABLE`**. This is not `SAFETY_PASS_FOR_DEPLOYMENT`; deployment cannot be recommended on these results.

## G. Source integrity and interpretation

- Project source files checked immediately before and after analysis: **175/175 unchanged** (SHA-256): **True**.
- Source PDF, original visit CSVs, Python backend and trained model, and all four web-app source implementations were not edited by this analysis. The group handoff excludes precompiled font binaries, and its file manifest was refreshed for the handoff copy.

**Bottom line:** With the neutral illustrative assumptions, routing projects a mean W reduction of **3.11 minutes** and outreach projects an LWBS decrease of **0.80 percentage points**. These values are arithmetic scenario projections only. The real-world intervention effect remains **`NOT_IDENTIFIABLE`**.
