# Source Integrity Audit

The final tree was compared with the SHA-256 inventory created immediately after extracting the user-supplied source ZIP and before integration changes.

## Protected source result

**74/74 protected original files are unchanged.** The protected set includes:

- the original PDF;
- the 85,000-row synthetic annual source data;
- the 200 encounter scenarios and 12 resource snapshots;
- the fixed model artifact;
- all original `analysis_w_lwbs/` and `analysis_combined_scenarios/` files;
- all original Patient App, Nurse Dashboard, and Waiting Room Display source files.

No model was retrained, no source data was regenerated, and no scenario assumption or result was edited.

## Expected integration changes

The changed original files are limited to documentation, the Python API and integration test, the Oversight Dashboard source/check script, regenerated test evidence, and generated frontend build artifacts. Three old hashed Vite asset filenames disappeared when production builds regenerated content-addressed `dist` files; `dist` is excluded from the Git repository and rebuilt with the locked dependencies.

The row-level comparison is recorded in `SOURCE_INTEGRITY_AUDIT.csv`. `UNCHANGED` means the final SHA-256 exactly matches the pre-integration SHA-256.
