# ETA Fixture Note

`PatientStatusView.estimatedWaitMinutes` is set to `null` because there is no validated W2 model output.

The current `PublicQueue` TypeScript contract requires a numeric `estimatedWaitMinutes`. The values in `public_queue_ui_fixture.json` are **display-only provider-wait placeholders** to let Codex test the existing screen rendering. They are not W2 estimates, not model predictions, and not derived from the PDF. Do not use them for clinical decisions or KPI calculations.

The current public display text says “Waiting for provider”. This is not semantically identical to the team's W2 endpoint (“entered Treatment Room”). Do not silently relabel one as the other.
