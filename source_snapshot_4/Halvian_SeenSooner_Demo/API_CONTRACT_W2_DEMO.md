# SeenSooner Local W2 Demo API Contract

This contract describes a **local synthetic-data demonstration**, not a production-safe healthcare API. It extends the three original web app prototypes without changing their original distribution archives.

## Access boundaries

- **Staff endpoints:** require `Authorization: Bearer demo-staff-token`. This is a local demo token, not production authentication.
- **Patient endpoints:** use a distinct patient token returned at registration.
- **Public display:** only exposes anonymous queue identifiers, queue/call state, remaining ETA ranges and update timestamps. It does not return patient names, dates of birth, telephone numbers, insurance, symptoms, ESI, room types or room-internal status.
- **Development endpoints:** require `X-Dev-Key: demo-reset-key` and are restricted to the local demonstration service.
- **Oversight endpoint:** `GET /api/oversight/summary` is local and aggregate-only. It returns runtime counts, completed/current W2 aggregates, fixed-model metadata, offline evaluation metrics, a project target, and hypothetical scenario results. It never returns patient identifiers or patient-level rows.

## W2 timeline and status semantics

1. `triageCompletedAt`: recorded when the nurse confirms the clinical assessment and ESI. This **starts W2**.
2. `roomCalledAt`: records a call to the patient; **does not end W2**.
3. `roomEnteredAt`: records the patient's actual physical entry into a treatment room; **ends W2**.
4. Actual completed W2 is `roomEnteredAt - triageCompletedAt`.
5. Before room entry, the patient may receive a **remaining W2** estimate with a lower and upper bound, timestamp and prediction-source label.
6. After 60 minutes of actual ongoing W2, a nurse care reminder is due until a care check is completed.
7. A missed formal call begins a **separate 30-minute recall period**. A patient who does not return may be marked `Inactive`, which is **not equivalent to LWBS**.
8. Returning patients require nurse reassessment before re-entering the active queue. The prediction model does not change nurse-confirmed ESI or room type.

## Prediction and fallback

- The Python API uses nurse-confirmed ESI, triage completion time, elapsed W2 and synthetic arrivals during the preceding 60 minutes.
- The output distinguishes predicted total W2 from predicted **remaining** W2. The UI presents an interval, not a guaranteed time or a treatment-room identifier.
- Patient and public displays poll approximately every 60 seconds. Material status changes propagate through the shared API and server-sent events/polling.
- If the model fails, an explicitly labelled conditional historical estimate is returned (`historical_completed_w2_fallback`).
- Current static LWBS probabilities are for **offline evaluation only** and are not shown to patients.

## Data, security and scope

- Only synthetic records are permitted. There is no production authentication, persistent audit storage, HTTPS deployment, real EHR integration or clinical validation.
- Precise GPS coordinates are not stored; the demo retains only relevant location-consent metadata.
- The public display's privacy allowlist must be maintained when adding fields.
- The Oversight Dashboard keeps five evidence contexts separate: live local synthetic aggregate state, offline held-out synthetic evaluation, illustrative UI fixtures, project targets, and hypothetical scenario projections. None is labelled as an observed hospital improvement.

For endpoint-level implementation, inspect `backend/server.py`, `backend/predictor.py`, and the per-app `API_CONTRACT.md` files. Do not infer production readiness from successful local tests.
