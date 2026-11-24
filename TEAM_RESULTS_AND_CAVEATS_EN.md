# SeenSooner: Results and Evidence Status

## Recommended short statement for the team

> In a hypothetical what-if scenario based on 85,000 synthetic ED visits, the combined Smart Routing and nurse outreach concept projects mean triage-to-room waiting time of 34.87 to 31.75 minutes (3.11 minutes lower) and LWBS of 4.00% to 3.20% (0.80 percentage points lower). These numbers depend on unverified 10% routing and 20% outreach assumptions; they are not measured hospital outcomes.

## Important distinctions

**Historical synthetic baseline:** 81,600 roomed records, 3,400 LWBS, mean W 34.87 minutes, median W 33.82 minutes, historical LWBS 4.00%.

**Prediction models:** The existing W model reports an MAE around 9.81 minutes and the offline LWBS classifier reports a test ROC-AUC around 0.863. These are prediction metrics, not intervention benefits. The LWBS model test sensitivity at the calibration-derived threshold is approximately 31.3%.

**Conditional projected intervention effect:** W decreases 3.11 minutes and LWBS decreases 0.80 percentage points under the neutral numerical assumptions only. The model does not replay compatible room-ready events and does not observe outreach success.

**Oversight dashboard:** Month 9 access metrics (including DTP of 50 minutes and LWBS of 3.75%) are illustrative mock interface data, not observations. The separate What-if tab displays the neutral projections.

**Safety:** The mathematical exercise does not raise ESI 1/2 W; this does not validate a clinical ESI 1 immediate pathway or ESI 2 safety. Clinical safety remains not verified. Do not recommend clinical deployment without evidence and oversight.

**Other historical experiments:** The source project contains an earlier assumption-driven Faster simulation with different numbers. Those simulations are not the selected final combined-impact projections and must not be mixed into the presentation.
