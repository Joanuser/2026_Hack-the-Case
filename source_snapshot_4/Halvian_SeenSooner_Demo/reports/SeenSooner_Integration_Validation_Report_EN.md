# Halvian SeenSooner: Faster Simulation and Three-Portal Integration Validation Report

**Report date:** November 22, 2026  
**Environment:** Local synthetic-data prototype. No connection to real hospital systems, public deployment, or GitHub publication was performed as part of the original validation.  
**Edition:** English-language reviewer copy. Numerical results and limitations are preserved from the completed local validation report.

## 1. Executive findings

The two requested workstreams were completed in an isolated copy: **(1) Faster W2 simulation correction** and **(2) three-portal integration with the Python remaining-W2 model**.

- The earlier anomalous simulation distribution (median **2.00 minutes**, mean **125.52 minutes**) was corrected. Under the revised neutral normal-weekday scenario, Baseline W2 was **26.67 minutes median**, **35.10 minutes mean**, and **55.86 minutes P90**.
- In that same simulated scenario, SeenSooner reduced median W2 by **1.63 minutes**, mean W2 by **1.85 minutes**, and P90 W2 by **1.95 minutes**. These are outputs of a **paired synthetic simulation**, not results observed at a hospital and not proof of clinical effectiveness.
- The patient portal, nurse dashboard and waiting-room display use the same local Python API and the latest Remaining W2 model. The original validation recorded **45/45 passing backend integration checks** and **12/12 passing independent simulation checks**; three frontend production builds also passed.
- Original browser testing opened the three portals, submitted a synthetic patient registration (`A-031`), and observed the shared nurse state and anonymous public queue/remaining W2 display.
- **Unresolved safety limitation:** of **1,132** matched ESI-2 patients with completed room entry, **14 (1.24%)** had longer W2 under SeenSooner, and the worst individual increase was **69.50 minutes**. The returned-patient requeue logic was corrected, but the simulation can still shift room-release timing. A clinically approved escalation or maximum-delay policy is needed before real use.

## 2. Source boundaries and synthetic-data assumptions

### 2.1 Facts from the supplied challenge PDF

| Case parameter | Value |
|---|---:|
| Annual emergency department visits | 85,000 |
| Regular ED rooms | 32 |
| Fast Track rooms | 8 |
| Resuscitation & Trauma rooms | 4 |
| Behavioral Health rooms | 4 |
| Waiting-room seats | 40 |
| Nurses, day/evening/night | 14 / 14 / 9 |
| Arrival pattern | Monday busiest; weekday morning/evening peaks |
| Winter arrivals | Approximately 20% higher |
| Door-to-provider median | 55 minutes |
| LWBS baseline | 4.0% |
| Admission rate | Approximately 16% |
| Boarding median | 3.5 hours |

The nurse counts combine triage and bedside nursing. They were not treated as a dedicated room-staffing capacity. **Door-to-provider time is not the same outcome as W2**, which is measured from completion of nurse triage to physical treatment-room entry.

### 2.2 Existing synthetic W2/LWBS reference data and models

The `annual_85000_w2_model_ready.csv` contains **85,000 synthetic encounters**. It was retained unchanged and serves as a reference for arrival patterns, ESI distributions and a historical prediction fallback. No existing W2 or LWBS model was retrained during the integration work.

| Existing model result | Synthetic holdout metric |
|---|---:|
| Total W2 model MAE | 9.82 min |
| ESI historical W2 baseline MAE | 10.22 min |
| W2 RMSE | 12.30 min |
| W2 R-squared | 0.361 |
| Independently calibrated P10–P90 interval coverage | 79.93% |
| Remaining W2 MAE after 25 min elapsed | 8.60 min |
| Remaining W2 historical baseline MAE after 25 min | 8.77 min |
| Remaining W2 MAE after 60 min elapsed | ~5.43 min (similar to baseline) |
| Static LWBS ROC-AUC | 0.861 |
| Static LWBS PR-AUC | 0.259 |
| Static LWBS Brier score | 0.0381 |

Remaining W2 uses a conditional distribution derived from similar **completed room-entry** records. It is **not a formal survival model** and may be biased by patients who left before room entry. The LWBS classifier is only an **offline, static prototype**. Its score is not presented to patients and does not update dynamically every 60 seconds.

### 2.3 New simulation assumptions

The challenge PDF does **not** specify patient-level room demand, room occupancy or turnover distributions, missed-call frequencies, coordination delays, or nurse reassessment durations. These were therefore declared in `simulation_assumptions.csv` and explored under conservative, neutral, high-pressure, immediate-skip and equal-process/null sensitivity scenarios.

Neutral-case assumptions include:

- Room-demand shares: Regular ED **62%**, Fast Track **27%**, Resuscitation/Trauma **6%**, Behavioral Health **5%**.
- Mean room occupation: **150 / 75 / 210 / 240 minutes** by room type, respectively.
- Room turnover: **8 minutes**.
- No-response rate: **8%**.
- Baseline vs SeenSooner unanswered-call hold: **5 vs 1 minutes**.
- A shared non-room process delay with a median of **22 minutes** is applied to both scenarios. Because it is identical across paired runs, it does not by itself create a Faster benefit.

These are transparent **hypotheses for a synthetic workflow**, not empirically observed operational facts.

## 3. Corrected Faster comparison

### 3.1 Primary simulation KPIs

All times are in minutes. Baseline and SeenSooner are paired on the same simulated patient cohort and resources.

| Scenario | Baseline median W2 | SeenSooner median W2 | Median reduction | Baseline mean W2 | SeenSooner mean W2 | Mean reduction | P90 reduction |
|---|---:|---:|---:|---:|---:|---:|---:|
| 200-case validation | 25.07 | 23.48 | 1.58 | 30.52 | 28.85 | 1.67 | 1.72 |
| Normal weekday | 26.67 | 25.04 | 1.63 | 35.10 | 33.24 | 1.85 | 1.95 |
| Monday peak | 29.04 | 27.31 | 1.73 | 45.33 | 42.93 | 2.40 | 3.85 |
| Weekend | 25.41 | 23.88 | 1.53 | 31.48 | 29.80 | 1.68 | 1.60 |
| Winter surge | 32.15 | 30.36 | 1.78 | 58.30 | 55.07 | 3.22 | 6.61 |

Other findings:

- For a neutral normal weekday, the proportion of completed W2 greater than **60 minutes** changed from **8.29%** to **7.62%**.
- Simulated idle time attributable to unanswered calls changed from **82.83 to 16.57 minutes/day**.
- Under winter surge assumptions, W2 over 60 minutes changed from **21.37%** to **20.21%**.
- Mean and P90 improvements are larger under Monday-peak and winter-surge stress, but it would be incorrect to say that **every** patient or every high-volume hour benefits more. Within the normal weekday, the peak-hour median improvement was **1.61 minutes**, similar to the **1.63-minute** all-day median improvement.

### 3.2 Correction of distorted room-demand composition

The original 200-patient edge-case fixture overrepresented certain room demand categories, particularly Behavioral Health, and was not a representative one-day hospital cohort. The earlier simulation had a highly skewed distribution with near-zero median waiting for many patients and extremely long waits for a smaller set.

The revised simulation treats the 200 cases as a **source of synthetic patient features**, then explicitly samples profiles using assumed room-demand proportions. Required room types are not changed by the W2 predictive model. In the neutral primary cohort, the Behavioral Health paired group comprised **340 records** and its median W2 went from **30.95 to 29.40 minutes**, a **1.55-minute** reduction.

A high-pressure test uses **10%** Behavioral Health demand and a **300-minute** mean room occupation **as a stress assumption**, not a case fact. Absolute W2 values still depend on these synthetic parameters. Paired differences are useful for exploring avoidable workflow delays but remain **unvalidated hospital predictions**.

## 4. ESI safety and patient recall

### 4.1 Reassessment after an unanswered call

The 30-minute recall window is maintained. A returning patient must undergo **nurse reassessment and confirmation** before being eligible for room assignment again. The simulation uses the time of renewed confirmation to establish their new queue time; it does **not automatically restore the prior place in line**. The model cannot change nurse-confirmed ESI.

All **4,082** simulated return events passed the nurse-reassessment/requeue check.

### 4.2 Matched ESI-1 and ESI-2 outcomes

| Group | Matched completed encounters | Individual cases with longer W2 | Maximum increase |
|---|---:|---:|---:|
| ESI 1 | 62 | 0 | 0 min |
| ESI 2 | 1,132 | 14 (1.24%) | 69.50 min |

Among **71** recalled ESI-2 patients who returned, **one** experienced longer W2, by at most **13.85 minutes**. The maximum **69.50-minute** increase involved a patient who was **not recalled** and arose from downstream resource-release timing changes, rather than erroneous automatic queue restoration.

The previous return-to-original-position flaw was addressed; the residual ESI-2 extreme-delay risk was **not** eliminated. It requires a clinically approved maximum-wait safeguard, reserved capacity, escalation process, or explicit nurse override before anything beyond synthetic demonstration is contemplated. Do not claim that this system has established patient safety or clinical noninferiority.

### 4.3 Capacity, LWBS and access fairness

- No simulated treatment-room pool exceeded its specified capacity.
- `Room Called` never marked the end of W2. Only actual `Room Entered` did.
- The 4% LWBS reference cohort remained **censored**; no completed room-entry W2 was fabricated, and no causal LWBS benefit was inferred from the Faster simulation.
- No-mobile patients had a simulated median W2 reduction of **1.74 minutes** versus **1.64 minutes** for patients with mobile access. Mobile access does **not** determine clinical queue priority.
- The maximum group difference in **median** W2 by insurance shifted from about **2.65 to 2.48 minutes**; the maximum group difference in **mean** W2 increased slightly from **6.20 to 6.37 minutes** (a **0.17-minute** increase), largely due to a small synthetic Other/Unspecified tail. This is a reason for continued stratified monitoring, not proof of fairness.

## 5. Python API and three-portal workflow

### 5.1 Implemented local event flow

1. **Nurse assessment:** staff confirms ESI and `requiredRoomType`; backend records `triageCompletedAt`.
2. **Prediction:** Python estimates a point value and interval for **remaining W2**, using ESI, triage time, elapsed W2 and the arrival-pressure proxy.
3. **Display:** patient portal and anonymous waiting-room board display the remaining W2 interval, rather than confusing total W2 with remaining W2.
4. **Updates:** frontend polling/recalculation occurs about every 60 seconds, with significant events synchronized through a shared API and server-sent events/polling.
5. **Care reminder:** once actual ongoing W2 reaches 60 minutes, a nurse check-in reminder appears and clears when completed.
6. **Missed formal call:** starts an independent 30-minute recall. A patient who does not return is marked **Inactive**, with `lwbsStatus=NOT_LWBS_INACTIVE` rather than being labelled LWBS.
7. **Return:** nurse reassesses the patient before requeueing.
8. **Room entry:** actual physical `Room Entered` freezes the completed W2 value.
9. **Fallback:** model failure uses conditional quantiles from synthetic completed W2 observations and explicitly identifies `historical_completed_w2_fallback` as the source.
10. **Privacy boundary:** exact GPS coordinates are not retained; the local staff and reset endpoints use demonstration-only credentials.

### 5.2 Information shown by each surface

**Patient portal:** the authenticated synthetic patient sees their own information, remaining W2 interval and estimate source. It does not display an LWBS risk probability.

**Nurse dashboard:** staff can confirm ESI and room type, finish triage, make room calls, log nonresponse, complete a care check, reassess returns and record room entry. The model does not override clinical priority.

**Public display:** a strict field allowlist exposes only anonymous queue IDs, waiting/call states, remaining W2 ranges and update timestamps. It excludes names, birth dates, phone numbers, symptoms, insurance, ESI, room type and internal room status.

## 6. Recorded verification evidence

The original integrator's evidence reports the following checks:

| Test | Outcome |
|---|---|
| Three UIs opened in browser | Passed (ports 5173, 5174, 5175) |
| Patient registration appeared in nurse shared state | Passed (synthetic `A-031`) |
| Nurse ESI confirmation updated patient ETA | Passed |
| Remaining W2 stays non-negative at 25 minutes elapsed | Passed |
| Care reminder fires at 60 actual W2 minutes | Passed |
| Actual room entry ends W2 | Passed |
| Room call alone does not end W2 | Passed |
| 30-minute recall and Inactive/LWBS distinction | Passed |
| Patient and public queue ETA consistency | Passed |
| Historical fallback when model is unavailable | Passed |
| Model does not change nurse ESI | Passed |
| Public display privacy allowlist / synthetic identity scan | Passed |
| No stored precise GPS coordinates | Passed |
| Independent simulation checks | 12/12 passed |

The recorded backend integration total was **45/45 passing tests**, with per-test evidence in `reports/integration_test_results.csv`. All three frontend production builds passed in the original environment. A reviewer should still reproduce setup and validation locally before demonstrating it live.

## 7. What remains out of scope

This is **not a production healthcare system**. The following capabilities are absent or not validated:

- Production identity verification, role-based authorization, persistent clinical database, comprehensive audit trail, HTTPS deployment, secret management, disaster recovery and multi-hospital isolation.
- Real EHR/ADT/room-capacity feeds, a detailed triage-versus-bedside nurse staffing model, and calibration to observed room-demand and treatment-duration data.
- Actual hospital outcome evidence, any causal W2-to-LWBS effect, or dynamically updated LWBS risk.
- A clinically reviewed ESI-2 maximum-delay safeguard and an approved return-to-queue reassessment protocol.

Remaining-W2 intervals may be biased because only completed room-entry cases contribute to conditional calibration; LWBS cases are censored. The model does not yet incorporate live `room_available_count` or nurse-confirmed room type as predictive features, although those inputs participate in the prototype's workflow and queue logic. The API uses volatile in-memory state; restarting resets it. Demo tokens are not adequate real-world authentication.

## 8. Accurate external messaging

**Supported:**

> In a paired synthetic workflow simulation, SeenSooner reduced normal-weekday median triage-to-room W2 by 1.63 minutes and mean W2 by 1.85 minutes. Monday-peak and winter-surge mean improvements were 2.40 and 3.22 minutes, respectively. Three local web interfaces and the Python remaining-W2 API were integrated and passed recorded prototype tests. All estimates depend on synthetic assumptions and require prospective validation.

**Not supported:**

- “The model has reduced real hospital waiting times.”
- “The W2 reduction has caused LWBS to decline from 4% to 3.5%.”
- “The model is clinically safe or has eliminated ESI-2 delay outliers.”
- “This is production-ready or integrated with a hospital EHR.”
- “Patients are guaranteed to enter a room within the displayed interval.”

For LWBS, a separate nurse-outreach planning exercise estimates roughly **3.51%** under **assumed 70% contact coverage and 20% success among contacted eligible LWBS patients**. This is not an empirical or causal outcome of SeenSooner.

**Overall conclusion:** The integrated package is suitable for a **local synthetic-data hackathon demo**, subject to local reproduction. It is **not suitable for clinical deployment** without additional data, validation, security and clinical governance.
