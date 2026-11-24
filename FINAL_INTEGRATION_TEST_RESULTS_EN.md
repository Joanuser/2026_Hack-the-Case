# SeenSooner Final Integration Test Results

**Test date:** 2026-11-23 (America/New_York)

**Host:** Windows 11, Python 3.14.7, Node.js 24.21.0, npm 11.19.0

**Scope:** local synthetic prototype only; no deployment and no real patient data

## Actual results

| Test | Actual result | Status |
|---|---|---|
| Clean dependency setup (`setup-all.ps1`) | Python virtual environment and locked packages installed for all four websites | PASS |
| Fresh local Git clone setup | A separate clone created its own virtual environment, four locked Node dependency trees, and four local environment files | PASS |
| Fresh local Git clone runtime | All five services returned HTTP 200; all four API CORS checks passed; backend integration passed 50/50 | PASS |
| Windows unified startup | API 8000 and websites 5173–5176 became ready | PASS |
| Windows launcher CORS checks | Patient, Nurse, Display, and aggregate Oversight endpoint accepted only their documented local origins | PASS |
| Windows safe rerun | Reported the project was already running; started no duplicates | PASS |
| Windows verified shutdown | Five tracked processes stopped; no skip/failure; all five ports released | PASS |
| Backend integration | 50/50 checks passed | PASS |
| Patient App production build | TypeScript and Vite build passed | PASS |
| Nurse Dashboard production build | TypeScript and Vite build passed | PASS |
| Waiting Room Display production build | TypeScript and Vite build passed | PASS |
| Oversight Dashboard checks | 15/15 content/evidence/interaction checks passed | PASS |
| Oversight Dashboard production build | TypeScript and Vite build passed | PASS |
| Combined scenario tests | 12/12 unit tests passed | PASS |
| Simulation output validator | 12/12 independent checks passed | PASS |
| Shell script syntax | `setup-all.sh`, `start-all.sh`, and `stop-all.sh` passed Git Bash `bash -n` | PASS |
| Shell launcher runtime on test host | Started five services, passed four CORS checks, recognized safe rerun, and stopped five verified processes | PASS (Git Bash on Windows) |
| Browser page load | All four websites loaded from their documented ports | PASS |
| Browser console | No errors captured in Patient, Nurse, Display, or Oversight tabs | PASS |
| Oversight interactions | Month selection, local edit, reset, API-connected state, and What-if tab verified | PASS |
| Oversight projection source | UI visibly reported `BACKEND-DERIVED` and read the original analysis CSV through the API | PASS |

## Full W2 workflow evidence

The 50-check backend suite created a synthetic registration and verified:

1. Nurse assessment begins without model-driven ESI changes.
2. Nurse-confirmed ESI and allowed room type are required to complete triage.
3. `triageCompletedAt` starts W2 and invokes the fixed model.
4. Patient and anonymous display Remaining-W2 intervals match.
5. A room call does not end W2.
6. The anonymous display shows the called waiting number without identity fields.
7. Actual room entry ends W2 and freezes `w2ActualMinutes`.
8. Model failure uses the explicitly labelled historical fallback.
9. Aggregate oversight data contains no patient identifiers.
10. The 3.50% project target remains distinct from the 3.20% hypothetical neutral projection.

## Browser observations

- Patient App: registration start screen recovered correctly from a stale local demo token.
- Nurse Dashboard: visibly showed `Local W2 API connected`.
- Waiting Room Display: updated from the API and showed anonymous `A-` waiting numbers.
- Oversight Dashboard: visibly showed `API CONNECTED`, aggregate runtime metrics, five existing monthly KPI cards, four existing charts, fixed-model status, offline metrics, project-target disclaimer, and clinical-safety warning.
- What-if view: Mean W 34.87 → 31.75 minutes and LWBS 4.00% → 3.20% were visibly labelled hypothetical, backend-derived, not observed, and not for deployment.

## Verification limits

- Native macOS and native Linux runtime tests were not available on this Windows host. Shell syntax passed and the scripts completed a real Git Bash runtime cycle, but native macOS/Linux is **not marked tested**.
- No real EHR, identity provider, production database, hospital network, or clinical workflow was tested.
- ESI 1/2 prospective clinical safety is not verified.
- Scenario projections do not validate capacity or establish causal intervention effects.
- Browser QA used a local in-app Chromium surface; no Safari test was performed.
- The clean-clone test used the repository's local Git origin. A remote GitHub clone could not be tested until GitHub authentication and private-repository creation are available.
