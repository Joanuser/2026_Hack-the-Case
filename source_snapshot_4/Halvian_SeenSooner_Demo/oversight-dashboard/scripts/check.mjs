import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const monthly = JSON.parse(fs.readFileSync(path.join(root, 'src/data/monthly-oversight.json'), 'utf8'));
const projection = JSON.parse(fs.readFileSync(path.join(root, 'src/data/neutral-what-if.json'), 'utf8'));
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');

const checks = [
  [monthly.datasetType === 'ILLUSTRATIVE_UI_MOCK_DATA', 'monthly fixture is explicitly illustrative'],
  [monthly.periods.length === 10, 'Baseline plus Months 1–9 are available'],
  [Object.values(monthly.metrics).every((values) => values.length === monthly.periods.length), 'all metric series align with the period selector'],
  [monthly.metrics.doorToProviderMedianMin.at(-1) === 50, 'Month 9 DTP is 50.0 minutes'],
  [monthly.metrics.lwbsRatePct.at(-1) === 3.75, 'Month 9 LWBS is 3.75%'],
  [projection.projectionType.startsWith('HYPOTHETICAL_'), 'projection is explicitly hypothetical'],
  [Number(projection.reductions.meanWMin.toFixed(2)) === 3.11, 'neutral Mean W reduction is 3.11 minutes'],
  [projection.baseline.lwbsRatePct === 4 && projection.combined.lwbsRatePct === 3.2, 'neutral LWBS is 4.00% to 3.20%'],
  [projection.status.clinicalSafety === 'NOT_VERIFIED', 'clinical safety is not verified'],
  [app.includes('Monthly Oversight') && app.includes('What-if Projection'), 'both dashboard tabs are present'],
  [app.includes('Edit selected period') && app.includes('Reset demo'), 'edit and reset interactions are present'],
  [app.includes('/api/oversight/summary') && app.includes('Aggregate-only local API'), 'dashboard uses the aggregate-only shared backend endpoint'],
  [app.includes('PROJECT TARGET · NOT AN OUTCOME') && app.includes('hypothetical neutral projection'), 'project target and hypothetical projection are kept distinct'],
  [app.includes('bundled fallback') && app.includes('BACKEND-DERIVED'), 'backend source and unavailable fallback are disclosed'],
  [css.includes('@media (max-width: 700px)'), 'mobile responsive styling is present']
];

let failed = 0;
for (const [ok, label] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
process.exitCode = failed ? 1 : 0;
