# SeenSooner Smart Routing + LWBS Prevention: Combined Conditional Scenario

**The real intervention effect remains `NOT_IDENTIFIABLE`. All results are hypothetical scenario projections, not observed hospital improvements or clinically validated outcomes.**

The default neutral example assumes that observed Waiting Time is reduced by 10% for historically roomed ESI 3-5 patients, nurse outreach retains 20% of historical LWBS patients, and Routing has no additional direct LWBS effect.

| Arm | Projected W mean / median / P90 (min) | W mean reduction | Projected LWBS | LWBS reduction | Scenario-affected patients |
|---|---:|---:|---:|---:|---:|
| Baseline | 34.87 / 33.82 / 55.27 | 0.00 min | 4.00% | 0.00 pp | 0 |
| Routing Only | 31.75 / 30.82 / 49.91 | 3.11 min | 4.00% | 0.00 pp | 67,159 |
| Outreach Only | 34.87 / 33.82 / 55.27 | 0.00 min | 3.20% | 0.80 pp | 680 expected retentions |
| Combined | 31.75 / 30.82 / 49.91 | 3.11 min | 3.20% | 0.80 pp | 67,159 W-affected plus 680 expected retentions |

W uses only the fixed cohort of 81,600 historically roomed patients. Historical LWBS patients receive no fabricated room-entry time or projected W. LWBS uses all 85,000 original records as its denominator.

Sensitivity results range from the required strict-zero scenario to explicitly hypothetical conservative, neutral, and more-optimistic inputs. Optional 5% and 10% Routing-LWBS assumptions are reported separately and are sequentially deduplicated from outreach retention.

ESI 1/2 receive no mathematical W reduction or risk-based queue jump, and their projected W never increases. Clinical safety nevertheless remains `NOT_VERIFIABLE`, because patient-level room, clinical-path, override, outreach, and outcome logs are absent.

The projection is not a validated capacity-constrained simulation. All 322 source-project files remained hash-identical, and no web application, PDF, source CSV, backend, API, trained model, prior analysis, or PPT was modified.

For complete methods, assumptions, subgroup results, and sensitivity results, see the English content in `combined_scenario_summary_CN.md`, retained under its legacy filename for reproducibility-test compatibility.
