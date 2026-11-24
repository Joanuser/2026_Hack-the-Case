# Final Package Verification | English, No Slides

Independent validation on the extracted, cleaned team package:

- **Combined what-if experiment:** 12 of 12 Python unit tests passed.
- **Source manifest:** 174 of 174 entries passed for this streamlined shareable source copy.
- **All four web applications:** React/TypeScript source present for Patient, Nurse, Waiting-room and Oversight.
- **Source dataset:** original annual 85,000-row synthetic CSV and English case PDF included.
- **Content audit:** no Chinese text in UTF-8 source, CSV, JSON, Markdown or authored file names.
- **Presentation exclusion:** no PowerPoint or slide files in this archive.
- **Full-package checksum:** generated as `PACKAGE_SHA256.csv` and verified against every bundled data file after ZIP creation.

The original Codex dashboard validation record reports 12/12 tests and successful Vite build/browser checks. These are retained separately at `oversight-dashboard/validation/TEST_RESULTS.md`; they were not independently rerun in this final packaging step.

Important: 3.11-minute shorter mean W and 0.80 percentage-point lower LWBS are **neutral hypothetical scenario calculations**. They are not observed outcomes, and clinical safety remains unverified.
