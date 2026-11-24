# SeenSooner shared API contract (v1)

All three apps (patient phone, waiting-room display, nurse dashboard) talk to **one backend** through this contract.
No backend code or API spec was supplied, so this contract was **designed for the prototype**. The bundled
`mock-server/` implements it with in-memory demo data. **No live backend has been connected or verified.**

- Base URL: `VITE_API_BASE_URL` (e.g. `https://api.example-hospital.org`). All paths below are relative to it.
- JSON everywhere, camelCase, timestamps ISO-8601 UTC. Dates of birth are `YYYY-MM-DD`.
- Errors: HTTP 4xx/5xx with body `{ "error": { "code": string, "message": string, "fields"?: { [field]: "required" | "invalid" | ... } } }`.
  Validation errors use **422** + `fields`.
- Type definitions: `src/api/types.ts` (identical in all three apps).
- The only code that knows about URLs/headers is `src/api/httpAdapter.ts`. If the real backend differs,
  change paths/mappers there and nothing else.

## Auth (what the real backend must provide)

| Caller | How it authenticates (prototype) | Real backend needs |
|---|---|---|
| Patient phone | `POST /api/checkins` returns a patient-scoped `accessToken`; sent as `Authorization: Bearer <token>` on `/api/checkins/:id/*`, and as `?token=` on the SSE URL (EventSource can't set headers). | Short-lived, single-check-in token (or signed cookie). Rate-limit check-in creation. |
| Nurse dashboard | Optional `Authorization: Bearer $VITE_STAFF_API_TOKEN` and `X-Staff-Name`. Mock accepts anything. | **Real staff SSO/session auth.** A token baked into a front-end build is not secure — replace before real use. |
| Waiting-room display | None. Endpoint returns **no PHI**. | Keep it PHI-free; optionally a device key. |

## Status model

`waiting_nurse` → `in_assessment` → `waiting_provider` → `with_care_team` → `completed`; `left` from any active stage.
`nursePriority` (1–5, ESI) is **set only by a nurse**. The AI summary is a patient-correctable **draft** and never sets priority or status.

## Endpoints

### Patient phone
| Method & path | Body | Returns |
|---|---|---|
| `POST /api/summaries/draft` | `{ symptoms: Symptoms, language }` | `{ draft, generatedBy, isDraft: true }` — AI summarizer (mock = template) |
| `POST /api/checkins` | `CheckInRequest` (name, dateOfBirth, phone?, insurance or insuranceDeferred, accessibilityNeeds[], language, siteCode, symptoms, summary{draft,text,editedByPatient}, geo?) | **201** `{ id, accessToken, waitingNumber, status: PatientStatusView }` |
| `GET /api/checkins/:id` 🔑 | — | `PatientStatusView` (status, waitingNumber, peopleAhead, estimatedWaitMinutes, insuranceMissing, symptoms, summary) |
| `PATCH /api/checkins/:id/symptoms` 🔑 | `{ symptoms, summary?, note? }` | `PatientStatusView`; sets `symptomsChanged=true` and emits `patient.symptoms_changed` |
| `PATCH /api/checkins/:id/insurance` 🔑 | `{ insurance }` | `PatientStatusView` |
| `POST /api/checkins/:id/location-exit` 🔑 | `{ left: boolean }` | `PatientStatusView`; `left:true` → status `left` |

### Nurse dashboard (staff)
| Method & path | Body | Returns |
|---|---|---|
| `GET /api/staff/patients` | — | `{ patients: StaffPatient[], updatedAt }` — includes computed `waitMinutes`, `peopleAhead`, `estimatedWaitMinutes`, `followUpStatus`, `hasLiveUpdates`, `lastContact` |
| `POST /api/staff/patients` | `StaffCreatePatientRequest` (source: `front_desk`\|`ipad`\|`staff_assisted`\|`walk_in`, name, DOB, language, location?, symptoms.mainConcern, painLevel?) | **201** `StaffPatient` — patients who did **not** use the phone |
| `PATCH /api/staff/patients/:id` | `{ status?, nursePriority?, location?, acknowledgeSymptomChange? }` | `StaffPatient`. `status:'waiting_provider'` requires a priority (422 otherwise) |
| `POST /api/staff/patients/:id/contacts` | `{ kind: 'check_in', checklist?, note?, notPresent? }` or `{ kind: 'symptoms_changed', note }` | `StaffPatient` (waiting-room follow-up actions) |

`followUpStatus` (non-mobile patients in `waiting_nurse`/`waiting_provider`): `symptoms_changed` → `needs_follow_up` (no nurse check-in yet) → `checked` (nurse check-in < 30 min ago) → `recheck` (≥ 30 min ago).

### Waiting-room display (public, no PHI)
`GET /api/public/queue` →
```json
{ "updatedAt": "...", "providerQueue": [{ "waitingNumber": "A23", "estimatedWaitMinutes": 20 }],
  "nowSeeing": [{ "waitingNumber": "A16" }], "awaitingNurse": [{ "waitingNumber": "A28" }], "inAssessment": [{ "waitingNumber": "A29" }] }
```
Must never include names, DOB, symptoms, language, seat or any other patient data.

### Realtime
`GET /api/events?channel=public|staff|patient[&checkinId=&token=]` — Server-Sent Events.
- `event: ready` on connect (clients refetch), then `event: change` with `{ type, updatedAt }`.
- **staff** channel adds `patientId` and `waitingNumber` (used for toasts: `checkin.created`, `patient.symptoms_changed`, `patient.location_exit`, `patient.updated`).
- **public/patient** channels get only `{ type: 'queue.updated', updatedAt }` — no identifiers.
- Clients refetch on each event; if SSE fails they show "Reconnecting…" and poll every 10 s. A WebSocket or push
  service works too — replace `subscribe()` in `httpAdapter.ts`.

### Dev only (mock server)
`GET /api/health`, `POST /api/dev/reset` (restore seed data).

## What the backend teammate still needs to supply
1. Real base URL(s) per environment and CORS allow-list for the three app origins.
2. Staff authentication (SSO/session) and how the dashboard obtains it; patient token format and lifetime.
3. Confirmation or mapping of each endpoint above (paths, field names, status names) — or their own spec, which we then map in `httpAdapter.ts`.
4. The waiting-number scheme (prefix, reset time, per-site numbering) and the wait-time estimate model (mock uses a placeholder: 6 min/patient for nurse, 10 + 10 min/patient for provider).
5. The AI summarization service for `POST /api/summaries/draft` (model, languages, PHI handling, retention) — must stay a draft.
6. Realtime transport (SSE as specified, or WebSocket/push) and whether it runs behind a proxy that buffers SSE.
7. Site configuration: valid QR/site codes, hospital coordinates and exit radius for the location check.
8. Integration with the EHR/registration system (e.g. "TriageGo" shown in the Figma header) so iPad/front-desk check-ins flow in automatically, not only via the dashboard's "Add in-person check-in".
