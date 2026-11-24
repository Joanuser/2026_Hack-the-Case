# SeenSooner Local Full-Stack Demo

This directory contains the four web applications, shared Python API, fixed W2 model, synthetic source data, and unified launch scripts. It is a local synthetic prototype, not a clinical system.

## Launch

Windows PowerShell:

```powershell
.\setup-all.ps1
.\start-all.ps1
```

macOS/Linux:

```bash
chmod +x setup-all.sh start-all.sh stop-all.sh
./setup-all.sh
./start-all.sh
```

Stop with `stop-all.ps1` or `stop-all.sh` for the current platform.

| Application | URL |
|---|---|
| Patient App | <http://127.0.0.1:5173/> |
| Nurse Dashboard | <http://127.0.0.1:5174/> |
| Front Desk Dashboard | <http://127.0.0.1:5174/?role=frontdesk> |
| Waiting Room Display | <http://127.0.0.1:5175/> |
| AI Oversight Dashboard | <http://127.0.0.1:5176/> |
| Python API | <http://127.0.0.1:8000/api/health> |

W2 begins at nurse-confirmed triage completion and ends only at actual entry into the appropriate treatment room. A room call does not end W2. The fixed model does not change nurse-confirmed ESI or room type.

The Oversight Dashboard distinguishes live local synthetic aggregates, offline model evaluations, illustrative monthly UI data, the unobserved 3.50% LWBS project target, and the hypothetical neutral scenario (Mean W reduction 3.11 minutes; LWBS 4.00% → 3.20%).

For architecture, APIs, data, evidence labels, testing, and collaboration guidance, see the repository-level `README.md` two directories above this folder.
