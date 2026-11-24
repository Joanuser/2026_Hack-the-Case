# SeenSooner — Start Here

The complete project guide is [README.md](README.md). This submission contains four English React/TypeScript websites, one shared local Python API, the fixed W2 model, synthetic data, analyses, and tests. No PowerPoint file is included and nothing is deployed.

## Put it online for judges

See [DEPLOY_ONLINE.md](DEPLOY_ONLINE.md): one Render web service hosts the API and all four apps at one link.

## Fast start on Windows

```powershell
cd source_snapshot_4\Halvian_SeenSooner_Demo
Set-ExecutionPolicy -Scope Process Bypass
.\setup-all.ps1
.\start-all.ps1
```

Stop with `.\stop-all.ps1`.

## Fast start on macOS or Linux

```bash
cd source_snapshot_4/Halvian_SeenSooner_Demo
chmod +x setup-all.sh start-all.sh stop-all.sh
./setup-all.sh
./start-all.sh
```

Stop with `./stop-all.sh`.

## URLs

- Patient App: <http://127.0.0.1:5173/>
- Staff Dashboard (nurses + front desk): <http://127.0.0.1:5174/>
- Waiting Room Display: <http://127.0.0.1:5175/>
- AI Oversight Dashboard: <http://127.0.0.1:5176/>
- Python API: <http://127.0.0.1:8000/api/health>

The first three apps share patient workflow state through the Python API. The Oversight Dashboard reads an aggregate-only endpoint from the same API while retaining separately labelled illustrative monthly fixtures.

## Evidence boundary

- Mean W 34.87 → 31.75 minutes and LWBS 4.00% → 3.20% are **hypothetical scenario projections**, not observed hospital outcomes.
- LWBS 4.00% → 3.50% is a separate project target, not a measured improvement.
- Real intervention effect: `NOT_IDENTIFIABLE`.
- Clinical safety: `NOT_VERIFIABLE` in the source analysis.
- W2 means triage completion to actual entry into the appropriate treatment room.

See `FINAL_INTEGRATION_TEST_RESULTS_EN.md` for actual test results and known verification limits.
