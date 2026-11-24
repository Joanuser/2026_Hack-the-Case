# SeenSooner

SeenSooner is a local, synthetic emergency-department demonstration with four English web applications, one shared Python API, a fixed Remaining-W2 model, synthetic datasets, and offline W/LWBS analyses. It is research and competition software—not a clinical system, medical device, or production deployment.

> Evidence boundary: the neutral result (Mean W 34.87 → 31.75 minutes; LWBS 4.00% → 3.20%) is a **hypothetical scenario projection**, not an observed hospital improvement. The 3.50% LWBS value is a separate project target, not a measured outcome. Real intervention effect is `NOT_IDENTIFIABLE`; clinical safety is `NOT_VERIFIABLE` in the source analysis.

## Applications and ports

| Component | URL | Shared state |
|---|---|---|
| Patient App | <http://127.0.0.1:5173/> | Python API |
| Nurse Dashboard | <http://127.0.0.1:5174/> | Python API |
| Waiting Room Display | <http://127.0.0.1:5175/> | Python API, anonymous queue only |
| AI Oversight Dashboard | <http://127.0.0.1:5176/> | Aggregate-only API context plus separately labelled illustrative fixtures |
| Python API | <http://127.0.0.1:8000/api/health> | In-memory synthetic demo state |

The first three applications share registration, nurse assessment, nurse-confirmed ESI/room type, Remaining-W2 prediction, call, and room-entry state. The oversight endpoint returns only aggregate counts, evaluation metadata, project targets, and analysis results; it does not return patient identifiers.

## One-command setup and launch

Prerequisites: Python 3.11+, Node.js 20.19+, npm, and internet access for the first dependency installation.

### Windows PowerShell

```powershell
cd source_snapshot_4\Halvian_SeenSooner_Demo
Set-ExecutionPolicy -Scope Process Bypass
.\setup-all.ps1
.\start-all.ps1
```

Stop all verified project processes:

```powershell
.\stop-all.ps1
```

### macOS or Linux

```bash
cd source_snapshot_4/Halvian_SeenSooner_Demo
chmod +x setup-all.sh start-all.sh stop-all.sh
./setup-all.sh
./start-all.sh
```

Stop all verified project processes:

```bash
./stop-all.sh
```

Both launchers use project-owned PID state and process identity checks. They do not terminate an unverified process merely because it occupies a project port.

## W2 workflow and model boundary

W2 is defined only as:

**Triage completed → actual entry into the appropriate treatment room**

1. A synthetic patient registers in the Patient App.
2. A nurse starts assessment and confirms ESI (1–5) plus an allowed treatment-room type.
3. Completing triage records `triageCompletedAt` and starts W2.
4. The fixed model estimates Remaining W2 from nurse-confirmed ESI, triage time, elapsed W2, and synthetic arrivals in the preceding 60 minutes.
5. Patient, nurse, and anonymous display views synchronize through the shared API.
6. `roomCalledAt` does not end W2. Only `roomEnteredAt` freezes actual W2.

The model never changes nurse-confirmed ESI or room type. No W1 or door-to-provider value is represented as the formal W2 KPI.

## Architecture

| Layer | Implementation | Responsibility |
|---|---|---|
| Frontends | React, TypeScript, Vite | Four independent local websites |
| API | Python standard-library HTTP server | Shared synthetic state, authorization boundaries, SSE/polling, W2 events, oversight aggregates |
| W2 inference | `backend/model/w2_wait_model.joblib` | Fixed delivered model plus calibrated conditional Remaining-W2 interval |
| Historical fallback | 85,000-row synthetic annual CSV | Explicit fallback when model inference fails |
| Offline evaluation | `analysis_w_lwbs/` | Held-out W2 and LWBS model metrics; LWBS classifier is not deployed |
| Scenario analysis | `analysis_combined_scenarios/` | Four-arm hypothetical Baseline/Routing/Outreach/Combined projections |

## API overview

| Endpoint | Audience | Purpose |
|---|---|---|
| `GET /api/health` | local public | Health and model-load state |
| `POST /api/checkins` | patient | Create a synthetic check-in and patient-scoped token |
| `GET /api/checkins/{id}` | patient token | Patient-specific synchronized status |
| `GET/PATCH /api/staff/patients...` | demo staff token | Nurse workflow and room events |
| `GET /api/public/queue` | local public | Anonymous display allowlist |
| `GET /api/oversight/summary` | local public | Aggregate-only runtime/evaluation/target/scenario context |
| `GET /api/events` | scoped channel | Local SSE update notifications |

See `source_snapshot_4/Halvian_SeenSooner_Demo/API_CONTRACT_W2_DEMO.md` for exact timeline and access boundaries. The built-in `demo-staff-token` and `demo-reset-key` are public local-demo credentials, not secrets or production authentication.

## Data and evidence contexts

| Context label | Meaning |
|---|---|
| `LIVE_LOCAL_SYNTHETIC_RUNTIME_AGGREGATE` | Current in-memory demo counts and W2 aggregates |
| `OFFLINE_HELD_OUT_SYNTHETIC_EVALUATION` | Read-only evaluation of existing synthetic models |
| `ILLUSTRATIVE_UI_MOCK_DATA` | Editable monthly dashboard fixture; not observed data |
| `PROJECT_TARGET_NOT_OBSERVED_OUTCOME` | Planning target of LWBS 4.00% → 3.50% |
| `HYPOTHETICAL_SCENARIO_PROJECTION_NOT_OBSERVED_HOSPITAL_OUTCOME` | Neutral scenario including Mean W reduction 3.11 minutes and LWBS 4.00% → 3.20% |

The annual data contains 85,000 synthetic records. Additional source artifacts include 200 encounter scenarios and 12 resource snapshots. No model was retrained and no source row, PDF fact, ESI, capacity, or scenario assumption was changed during full-stack integration.

## Verification

From `source_snapshot_4/Halvian_SeenSooner_Demo`:

```powershell
.\.venv\Scripts\python.exe backend\run_integration_tests.py
npm --prefix patient-app run build
npm --prefix nurse-app run build
npm --prefix display-app run build
npm --prefix oversight-dashboard run test
npm --prefix oversight-dashboard run build
```

The integration test covers registration, nurse-confirmed triage, real model execution, cross-app API synchronization, room call, actual room entry, W2 freezing, privacy allowlists, and aggregate oversight integrity. Actual results for this delivery are recorded in `FINAL_INTEGRATION_TEST_RESULTS_EN.md`; untested platforms are identified rather than marked passed.

## Repository hygiene and collaboration

- Generated `node_modules`, `.venv`, `dist`, runtime PID state, service logs, archives, and PowerPoint files are excluded from Git.
- No real credentials or PHI are included. Only synthetic data may be entered.
- Use feature branches and pull requests for team changes. Do not commit generated dependencies.
- Keep patient/public payload allowlists narrow and add integration tests for every API field.
- Do not replace the fixed model or analysis results without a separate, reviewed evidence update.
- Before any public release, review the included case-study PDF and third-party material permissions.

## Limitations

The server is local, in-memory, and uses demo authentication. There is no EHR integration, production identity provider, durable audit store, clinical validation, capacity-validated routing intervention, or demonstrated causal LWBS effect. ESI 1/2 operational safety has not been prospectively validated. Do not deploy or use for patient care.
