# Put the SeenSooner demo online (for judges)

One Docker service runs the Python API **and** all four websites from one address:

| Page | Path |
|---|---|
| Landing page with links to all four apps | `/` |
| Patient App | `/patient/` |
| Nurse Dashboard | `/nurse/` |
| Waiting Room Display | `/display/` |
| AI Oversight Dashboard | `/oversight/` |
| API health check | `/api/health` |

## Deploy on Render (free)

1. Push this whole folder to GitHub (the `Dockerfile` must be at the repository root).
2. Sign in at <https://render.com> with GitHub.
3. **New → Web Service**, choose this repository.
4. Render detects the `Dockerfile`. Choose the **Free** instance type and click **Deploy**.
   (Or use **New → Blueprint**, which reads `render.yaml`.)
5. After the build (about 5–10 minutes the first time) you get a link such as
   `https://seensooner-demo.onrender.com`. Give that link to the judges.

## Things to know

- Free Render services sleep after about 15 minutes without visitors. The next visit takes up to a minute to wake it. Open the link yourself shortly before judging.
- Patient and queue data live in memory. They return to the synthetic starting data whenever the service restarts or wakes up.
- The nurse dashboard uses the demo staff token (`demo-staff-token`), which is built into the public page. Anyone with the link can use the nurse view. That is fine for a synthetic demo, but do not put real patient data in it. To change the token, set the environment variable `SEENSOONER_STAFF_TOKEN` on Render; the Docker build reads it as well, so redeploy after changing it.

## Run the hosted build locally (optional)

```bash
cd source_snapshot_4/Halvian_SeenSooner_Demo
./build-web.sh                       # builds the four apps into web-dist/
cd backend && python server.py       # then open http://127.0.0.1:8000/
```

The original local workflow (`setup-all` / `start-all`, ports 5173–5176 and 8000) is unchanged.
