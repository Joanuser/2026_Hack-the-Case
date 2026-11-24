# Change Log

## 2026-11-23 — Final full-stack integration

- Added unified Windows PowerShell and macOS/Linux shell setup, start, and stop scripts for the Python API and four websites.
- Standardized local ports: API 8000, Patient 5173, Nurse 5174, Display 5175, Oversight 5176.
- Added `GET /api/oversight/summary`, an aggregate-only endpoint that exposes synthetic runtime aggregates, existing model-evaluation metadata, the project LWBS target, and existing hypothetical scenario results without patient identifiers.
- Connected the Oversight Dashboard to that endpoint while preserving its layout, charts, period selector, edit/reset interactions, and illustrative monthly fixtures.
- Kept the 4.00% → 3.50% project target separate from the 4.00% → 3.20% neutral hypothetical scenario projection.
- Expanded backend integration tests from 45 to 50 checks, including oversight privacy and evidence-integrity assertions.
- Added GitHub-ready repository documentation, `.gitignore`, `.gitattributes`, `.env.example`, cross-platform instructions, and final test reporting.
- Hardened Windows shutdown identity checks with UTC tick recording and verified process-tree termination, ensuring the Python virtual-environment child process is also stopped and all five ports are released.

No original PDF, source CSV, 85,000-row record set, 200-scenario data, 12 resource snapshots, model artifact, scenario assumption, or PowerPoint was modified. No model was retrained and no dataset was regenerated. The existing patient, nurse, and waiting-display source designs were not changed.
