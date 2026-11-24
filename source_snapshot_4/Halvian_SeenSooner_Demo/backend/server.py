#!/usr/bin/env python3
"""Local synthetic SeenSooner API.

The service keeps one shared in-memory state for the three demo apps and calls
the repaired W2 bundle for Remaining W2. It is deliberately local-only and is
not an EHR, identity provider, production data store, or clinical device.
"""
from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import json
import mimetypes
import os
import queue
import re
import secrets
import statistics
import threading
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from predictor import RemainingW2Predictor


ROOT = Path(__file__).resolve().parent
DEMO_ROOT = ROOT.parent
SUBMISSION_ROOT = DEMO_ROOT.parent.parent
ROOM_TYPES = {
    "REGULAR_ED",
    "FAST_TRACK",
    "RESUSCITATION_TRAUMA",
    "BEHAVIORAL_HEALTH",
}
STAFF_TOKEN = os.getenv("SEENSOONER_STAFF_TOKEN", "demo-staff-token")
DEV_KEY = os.getenv("SEENSOONER_DEV_KEY", "demo-reset-key")
ALLOWED_ORIGINS = {
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5175",
    "http://localhost:5176",
    "http://127.0.0.1:5176",
}
# Extra allowed origins for a hosted deployment (comma-separated). Not needed when the
# four built frontends are served by this same server (same-origin requests).
ALLOWED_ORIGINS.update(o.strip().rstrip("/") for o in os.getenv("SEENSOONER_EXTRA_ORIGINS", "").split(",") if o.strip())
# Optional folder of built frontends (see build-web.sh). When it exists, this server also
# serves the landing page at / and the apps at /patient/, /nurse/, /display/, /oversight/.
WEB_ROOT = Path(os.getenv("SEENSOONER_WEB_ROOT", str(DEMO_ROOT / "web-dist"))).resolve()
WEB_APPS = {"patient", "nurse", "display", "oversight", "tablet"}
# The check-in tablet runs the patient app in kiosk mode at /tablet/.
WEB_ALIASES = {"tablet": "patient"}

PROJECT_LWBS_TARGET = {
    "baselineRatePct": 4.0,
    "targetRatePct": 3.5,
    "differencePp": 0.5,
    "evidenceTag": "PROJECT_TARGET_NOT_OBSERVED_OUTCOME",
}


def parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def iso(value: datetime | None) -> str | None:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if value else None


def minutes_between(start: datetime | None, end: datetime | None) -> float:
    if not start or not end:
        return 0.0
    return max(0.0, (end - start).total_seconds() / 60.0)


def shift_iso(value: str | None, delta: timedelta) -> str | None:
    parsed = parse_dt(value)
    return iso(parsed + delta) if parsed else None


def _read_csv_rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def _as_float(row: dict[str, str], key: str) -> float | None:
    value = row.get(key)
    return float(value) if value not in (None, "") else None


def _percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return ordered[lower] * (1.0 - weight) + ordered[upper] * weight


class DemoStore:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.offset = timedelta(0)
        self.force_model_failure = False
        self.clients: list[dict[str, Any]] = []
        self.predictor = RemainingW2Predictor(
            ROOT / "model" / "w2_wait_model.joblib",
            DEMO_ROOT / "simulation" / "source_data" / "annual_85000_w2_model_ready.csv",
        )
        self.patients: dict[str, dict[str, Any]] = {}
        self.reset()

    def now(self) -> datetime:
        return datetime.now(timezone.utc) + self.offset

    def reset(self) -> None:
        with self.lock:
            self.offset = timedelta(0)
            self.force_model_failure = False
            payload = json.loads((ROOT / "fixtures" / "staff_patients_response.json").read_text(encoding="utf-8"))
            with (ROOT / "fixtures" / "w2_patient_timeline_30.csv").open(
                encoding="utf-8-sig", newline=""
            ) as handle:
                timeline = {row["visit_id"]: row for row in csv.DictReader(handle)}

            source_times = [
                parse_dt(patient.get("updatedAt"))
                for patient in payload["patients"]
                if patient.get("updatedAt")
            ]
            reference = max(t for t in source_times if t is not None)
            delta = self.now() - reference
            patients: dict[str, dict[str, Any]] = {}
            for source in payload["patients"]:
                p = copy.deepcopy(source)
                for key in ("checkedInAt", "updatedAt", "assessedAt"):
                    p[key] = shift_iso(p.get(key), delta)
                for contact in p.get("contacts", []):
                    contact["at"] = shift_iso(contact.get("at"), delta)
                for update in p.get("symptomUpdates", []):
                    update["at"] = shift_iso(update.get("at"), delta)

                row = timeline.get(p["id"], {})
                mapped = {
                    "triageCompletedAt": "triage_completed_at",
                    "roomCalledAt": "room_called_at",
                    "roomEnteredAt": "room_entered_at",
                    "providerFirstSeenAt": "provider_first_seen_at",
                    "departureAt": "departure_at",
                    "firstUnansweredCallAt": "first_unanswered_call_at",
                    "returnedAt": "returned_at",
                    "inactiveAt": "inactive_at",
                    "careAlertAt": "nurse_care_alert_at",
                }
                for target, source_key in mapped.items():
                    p[target] = shift_iso(row.get(source_key), delta)
                if not p["triageCompletedAt"] and p.get("assessedAt"):
                    p["triageCompletedAt"] = p["assessedAt"]
                p["nursePriority"] = (
                    int(float(row["nurse_confirmed_esi"]))
                    if row.get("nurse_confirmed_esi")
                    else p.get("nursePriority")
                )
                p["requiredRoomType"] = row.get("required_room_type") or None
                p["insuranceMissing"] = not bool(p.get("insurance"))
                p["queueEnteredAt"] = p["triageCompletedAt"]
                p["reassessmentRequired"] = bool(p["returnedAt"] and not p["roomEnteredAt"])
                p["reassessmentConfirmedAt"] = None
                p["recallDeadlineAt"] = (
                    iso(parse_dt(p["firstUnansweredCallAt"]) + timedelta(minutes=30))
                    if p["firstUnansweredCallAt"]
                    else None
                )
                p["recallChecks"] = []
                if p["roomEnteredAt"]:
                    p["callStatus"] = "entered"
                elif p["inactiveAt"]:
                    p["callStatus"] = "inactive"
                    p["status"] = "inactive"
                elif p["firstUnansweredCallAt"] and not p["returnedAt"]:
                    p["callStatus"] = "recall_active"
                elif p["returnedAt"]:
                    p["callStatus"] = "returned_requires_reassessment"
                    p["status"] = "waiting_nurse"
                elif p["roomCalledAt"]:
                    p["callStatus"] = "called"
                else:
                    p["callStatus"] = "waiting"
                p["w2ActualMinutes"] = (
                    round(minutes_between(parse_dt(p["triageCompletedAt"]), parse_dt(p["roomEnteredAt"])), 1)
                    if p["triageCompletedAt"] and p["roomEnteredAt"]
                    else None
                )
                p["careCompletedAt"] = None
                p["careDue"] = False
                p["prediction"] = None
                p["accessToken"] = f"demo-patient-{p['id']}"
                p["lwbsStatus"] = row.get("lwbs_status") or "PENDING"
                p["departureVerified"] = str(row.get("departure_verified", "False")).lower() == "true"
                p["locationAuthorization"] = {
                    "granted": str(row.get("gps_opt_in", "False")).lower() == "true",
                    "recordedAt": p["checkedInAt"],
                }
                p["gpsCoordinatesStored"] = False
                patients[p["id"]] = p
            self.patients = patients
            self._refresh_locked()
        self.publish("dev.reset")

    def advance(self, minutes: float) -> datetime:
        with self.lock:
            self.offset += timedelta(minutes=float(minutes))
            self._refresh_locked()
            now = self.now()
        self.publish("clock.advanced")
        return now

    def publish(self, event_type: str, patient: dict[str, Any] | None = None) -> None:
        with self.lock:
            clients = list(self.clients)
        for client in clients:
            event = {"type": "queue.updated", "updatedAt": iso(self.now())}
            if client["channel"] == "staff":
                event["type"] = event_type
                if patient:
                    event["patientId"] = patient["id"]
                    event["waitingNumber"] = patient["waitingNumber"]
            try:
                client["queue"].put_nowait(event)
            except queue.Full:
                pass

    def register_client(self, channel: str, checkin_id: str | None) -> dict[str, Any]:
        client = {"channel": channel, "checkinId": checkin_id, "queue": queue.Queue(maxsize=20)}
        with self.lock:
            self.clients.append(client)
        return client

    def unregister_client(self, client: dict[str, Any]) -> None:
        with self.lock:
            if client in self.clients:
                self.clients.remove(client)

    def _arrivals_before(self, triage: datetime) -> int:
        return sum(
            1
            for patient in self.patients.values()
            if (candidate := parse_dt(patient.get("triageCompletedAt")))
            and triage - timedelta(minutes=60) <= candidate <= triage
        )

    def _queue_eligible(self, p: dict[str, Any]) -> bool:
        return (
            p.get("status") == "waiting_provider"
            and p.get("triageCompletedAt")
            and p.get("nursePriority") is not None
            and p.get("requiredRoomType") in ROOM_TYPES
            and not p.get("roomEnteredAt")
            and not p.get("reassessmentRequired")
            and p.get("callStatus") == "waiting"
        )

    def _queue_order(self) -> list[dict[str, Any]]:
        eligible = [p for p in self.patients.values() if self._queue_eligible(p)]
        return sorted(
            eligible,
            key=lambda p: (
                int(p["nursePriority"]),
                parse_dt(p.get("queueEnteredAt") or p["triageCompletedAt"]),
                p["waitingNumber"],
            ),
        )

    def _refresh_locked(self) -> None:
        now = self.now()
        changed: list[dict[str, Any]] = []
        for p in self.patients.values():
            if p.get("callStatus") == "recall_active" and parse_dt(p.get("recallDeadlineAt")):
                first = parse_dt(p["firstUnansweredCallAt"])
                elapsed = minutes_between(first, now)
                p["recallChecks"] = [
                    iso(first + timedelta(minutes=minute))
                    for minute in (10, 20, 30)
                    if elapsed >= minute
                ]
                if now >= parse_dt(p["recallDeadlineAt"]):
                    p["status"] = "inactive"
                    p["callStatus"] = "inactive"
                    p["inactiveAt"] = iso(now)
                    p["lwbsStatus"] = "NOT_LWBS_INACTIVE"
                    p["prediction"] = None
                    changed.append(p)

            triage = parse_dt(p.get("triageCompletedAt"))
            entered = parse_dt(p.get("roomEnteredAt"))
            if triage:
                end = entered or now
                p["w2ElapsedMinutes"] = round(minutes_between(triage, end), 1)
                p["careDue"] = bool(
                    not entered
                    and p.get("status") == "waiting_provider"
                    and p["w2ElapsedMinutes"] >= 60
                    and not p.get("careCompletedAt")
                )
                if p["careDue"] and not p.get("careAlertAt"):
                    p["careAlertAt"] = iso(triage + timedelta(minutes=60))
            else:
                p["w2ElapsedMinutes"] = 0.0
                p["careDue"] = False

            if self._queue_eligible(p):
                try:
                    p["prediction"] = self.predictor.predict(
                        esi=int(p["nursePriority"]),
                        triage_completed_at=triage,
                        elapsed_minutes=p["w2ElapsedMinutes"],
                        arrivals_prev_60m=self._arrivals_before(triage),
                        force_model_failure=self.force_model_failure,
                    )
                except Exception as exc:
                    p["prediction"] = {
                        "predicted_remaining_w2_minutes": None,
                        "remaining_w2_low": None,
                        "remaining_w2_high": None,
                        "generated_at": iso(now),
                        "prediction_source": "unavailable",
                        "fallback_reason": f"{type(exc).__name__}: {exc}",
                    }
            elif entered:
                p["prediction"] = {
                    "predicted_remaining_w2_minutes": 0.0,
                    "remaining_w2_low": 0.0,
                    "remaining_w2_high": 0.0,
                    "predicted_total_w2_minutes": p.get("w2ActualMinutes"),
                    "w2_elapsed_minutes_now": p.get("w2ActualMinutes"),
                    "generated_at": p.get("roomEnteredAt"),
                    "prediction_source": "w2_stopped_at_room_entry",
                    "fallback_reason": None,
                }
        for p in changed:
            p["updatedAt"] = iso(now)

    def _computed(self, p: dict[str, Any]) -> dict[str, Any]:
        result = copy.deepcopy(p)
        now = self.now()
        result["waitMinutes"] = int(minutes_between(parse_dt(p.get("checkedInAt")), now))
        contacts = p.get("contacts", [])
        result["lastContact"] = contacts[-1] if contacts else None
        if p.get("symptomsChanged"):
            result["followUpStatus"] = "symptoms_changed"
        elif p.get("hasLiveUpdates") or p.get("status") not in {"waiting_nurse", "waiting_provider"}:
            result["followUpStatus"] = None
        else:
            staff_contacts = [c for c in contacts if c.get("kind") in {"registration", "check_in", "symptoms_changed"}]
            if not staff_contacts:
                result["followUpStatus"] = "needs_follow_up"
            else:
                age = minutes_between(parse_dt(staff_contacts[-1].get("at")), now)
                result["followUpStatus"] = "recheck" if age >= 30 else "checked"
        pred = p.get("prediction") or {}
        point = pred.get("predicted_remaining_w2_minutes")
        result["estimatedWaitMinutes"] = round(point) if point is not None else None
        result["predictedRemainingW2Minutes"] = point
        result["remainingW2Low"] = pred.get("remaining_w2_low")
        result["remainingW2High"] = pred.get("remaining_w2_high")
        result["predictedTotalW2Minutes"] = pred.get("predicted_total_w2_minutes")
        result["predictionGeneratedAt"] = pred.get("generated_at")
        result["predictionSource"] = pred.get("prediction_source")
        result["predictionFallbackReason"] = pred.get("fallback_reason")
        return result

    def staff_list(self) -> dict[str, Any]:
        with self.lock:
            self._refresh_locked()
            ordered = self._queue_order()
            ranks = {p["id"]: i for i, p in enumerate(ordered)}
            patients = []
            for p in self.patients.values():
                view = self._computed(p)
                view["peopleAhead"] = ranks.get(p["id"]) if p["id"] in ranks else None
                view.pop("accessToken", None)
                patients.append(view)
            return {
                "patients": patients,
                "updatedAt": iso(self.now()),
                "config": {"recheckAfterMinutes": 30, "longWaitMinutes": 60},
            }

    def patient_view(self, patient_id: str) -> dict[str, Any]:
        with self.lock:
            self._refresh_locked()
            p = self.patients[patient_id]
            view = self._computed(p)
            ordered = self._queue_order()
            ranks = {item["id"]: i for i, item in enumerate(ordered)}
            return {
                key: view.get(key)
                for key in (
                    "id", "waitingNumber", "status", "language", "insuranceMissing",
                    "symptoms", "summary", "lastSymptomUpdateAt", "updatedAt",
                    "estimatedWaitMinutes", "predictedRemainingW2Minutes", "remainingW2Low",
                    "remainingW2High", "predictedTotalW2Minutes", "predictionGeneratedAt",
                    "predictionSource", "w2ElapsedMinutes", "triageCompletedAt", "roomCalledAt",
                    "roomEnteredAt", "w2ActualMinutes", "callStatus", "recallDeadlineAt",
                    "reassessmentRequired", "careDue",
                )
            } | {"peopleAhead": ranks.get(patient_id) if patient_id in ranks else None}

    def public_queue(self) -> dict[str, Any]:
        with self.lock:
            self._refresh_locked()
            queue_items = []
            for p in self._queue_order():
                pred = p.get("prediction") or {}
                queue_items.append(
                    {
                        "waitingNumber": p["waitingNumber"],
                        "estimatedWaitMinutes": round(pred.get("predicted_remaining_w2_minutes") or 0),
                        "remainingW2Low": pred.get("remaining_w2_low"),
                        "remainingW2High": pred.get("remaining_w2_high"),
                        "predictionSource": pred.get("prediction_source"),
                    }
                )
            return {
                "updatedAt": iso(self.now()),
                "providerQueue": queue_items,
                "nowSeeing": [
                    {"waitingNumber": p["waitingNumber"]}
                    for p in self.patients.values()
                    if p.get("callStatus") == "called" and not p.get("roomEnteredAt")
                ],
                "awaitingNurse": [
                    {"waitingNumber": p["waitingNumber"]}
                    for p in self.patients.values()
                    if p.get("status") == "waiting_nurse"
                ],
                "inAssessment": [
                    {"waitingNumber": p["waitingNumber"]}
                    for p in self.patients.values()
                    if p.get("status") == "in_assessment"
                ],
            }

    def oversight_summary(self) -> dict[str, Any]:
        """Return aggregate-only demo, evaluation, target, and projection context."""
        with self.lock:
            self._refresh_locked()
            patients = list(self.patients.values())
            status_counts: dict[str, int] = {}
            for patient in patients:
                status = str(patient.get("status") or "unknown")
                status_counts[status] = status_counts.get(status, 0) + 1

            waiting = [patient for patient in patients if self._queue_eligible(patient)]
            remaining = [
                float(patient["prediction"]["predicted_remaining_w2_minutes"])
                for patient in waiting
                if patient.get("prediction")
                and patient["prediction"].get("predicted_remaining_w2_minutes") is not None
            ]
            actual = [
                float(patient["w2ActualMinutes"])
                for patient in patients
                if patient.get("roomEnteredAt") and patient.get("w2ActualMinutes") is not None
            ]

            live = {
                "context": "LIVE_LOCAL_SYNTHETIC_RUNTIME_AGGREGATE",
                "updatedAt": iso(self.now()),
                "patientCount": len(patients),
                "statusCounts": dict(sorted(status_counts.items())),
                "eligibleProviderQueueCount": len(waiting),
                "currentRemainingW2": {
                    "n": len(remaining),
                    "meanMin": round(statistics.fmean(remaining), 2) if remaining else None,
                    "medianMin": round(statistics.median(remaining), 2) if remaining else None,
                },
                "completedW2": {
                    "n": len(actual),
                    "meanMin": round(statistics.fmean(actual), 2) if actual else None,
                    "medianMin": round(statistics.median(actual), 2) if actual else None,
                    "p90Min": round(_percentile(actual, 0.9), 2) if actual else None,
                },
            }

        errors: list[str] = []
        w2_evaluation: dict[str, Any] | None = None
        lwbs_evaluation: dict[str, Any] | None = None
        four_arms: list[dict[str, Any]] = []

        try:
            w_rows = _read_csv_rows(SUBMISSION_ROOT / "analysis_w_lwbs" / "03_w_model_metrics.csv")
            row = next(
                item for item in w_rows
                if item.get("section") == "overall_test"
                and item.get("model") == "existing_delivered_model"
            )
            w2_evaluation = {
                "context": "OFFLINE_HELD_OUT_SYNTHETIC_EVALUATION",
                "model": row["model"],
                "n": int(row["n"]),
                "maeMin": _as_float(row, "mae_min"),
                "p90AbsoluteErrorMin": _as_float(row, "p90_abs_error_min"),
                "intervalCoverage": _as_float(row, "interval_coverage"),
                "source": "analysis_w_lwbs/03_w_model_metrics.csv",
            }
        except (OSError, StopIteration, KeyError, TypeError, ValueError) as exc:
            errors.append(f"W2 evaluation unavailable: {type(exc).__name__}")

        try:
            lwbs_rows = _read_csv_rows(SUBMISSION_ROOT / "analysis_w_lwbs" / "04_lwbs_model_metrics.csv")
            row = next(
                item for item in lwbs_rows
                if item.get("section") == "overall_test"
                and item.get("model") == "simple_logistic_regression"
            )
            lwbs_evaluation = {
                "context": "OFFLINE_HELD_OUT_SYNTHETIC_EVALUATION_NOT_DEPLOYED",
                "model": row["model"],
                "n": int(row["n"]),
                "positiveN": int(row["positive_n"]),
                "rocAuc": _as_float(row, "roc_auc"),
                "prAuc": _as_float(row, "pr_auc_average_precision"),
                "brierScore": _as_float(row, "brier_score"),
                "source": "analysis_w_lwbs/04_lwbs_model_metrics.csv",
            }
        except (OSError, StopIteration, KeyError, TypeError, ValueError) as exc:
            errors.append(f"LWBS evaluation unavailable: {type(exc).__name__}")

        try:
            scenario_rows = _read_csv_rows(
                SUBMISSION_ROOT / "analysis_combined_scenarios" / "combined_four_arms.csv"
            )
            neutral_rows = [item for item in scenario_rows if item.get("assumption_set") == "neutral"]
            for row in neutral_rows:
                four_arms.append(
                    {
                        "arm": row["arm"],
                        "meanWMin": _as_float(row, "projected_w_mean_min"),
                        "medianWMin": _as_float(row, "projected_w_median_min"),
                        "p90WMin": _as_float(row, "projected_w_p90_min"),
                        "lwbsRatePct": _as_float(row, "projected_lwbs_rate_pct"),
                        "evidenceTag": row["projection_evidence_tag"],
                    }
                )
            arm_order = {"Baseline": 0, "Routing Only": 1, "Outreach Only": 2, "Combined": 3}
            four_arms.sort(key=lambda item: arm_order.get(item["arm"], 99))
            if len(four_arms) != 4:
                raise ValueError("neutral four-arm result is incomplete")
            baseline = next(item for item in neutral_rows if item["arm"] == "Baseline")
            combined = next(item for item in neutral_rows if item["arm"] == "Combined")
            projection = {
                "context": "HYPOTHETICAL_SCENARIO_PROJECTION_NOT_OBSERVED_HOSPITAL_OUTCOME",
                "assumptionSet": "neutral",
                "wDefinition": "Triage completed to entry into the appropriate treatment room",
                "baseline": {
                    "meanWMin": _as_float(baseline, "baseline_w_mean_min"),
                    "medianWMin": _as_float(baseline, "baseline_w_median_min"),
                    "p90WMin": _as_float(baseline, "baseline_w_p90_min"),
                    "lwbsRatePct": _as_float(baseline, "baseline_lwbs_rate_pct"),
                },
                "combined": {
                    "meanWMin": _as_float(combined, "projected_w_mean_min"),
                    "medianWMin": _as_float(combined, "projected_w_median_min"),
                    "p90WMin": _as_float(combined, "projected_w_p90_min"),
                    "lwbsRatePct": _as_float(combined, "projected_lwbs_rate_pct"),
                },
                "reductions": {
                    "meanWMin": _as_float(combined, "w_mean_reduction_min"),
                    "meanWPct": _as_float(combined, "w_mean_reduction_pct"),
                    "medianWMin": _as_float(combined, "w_median_reduction_min"),
                    "p90WMin": _as_float(combined, "w_p90_reduction_min"),
                    "lwbsPp": _as_float(combined, "lwbs_reduction_pp"),
                },
                "status": {
                    "realInterventionEffect": combined["real_intervention_effect_status"],
                    "clinicalSafety": combined["clinical_safety_status"],
                    "capacityValidation": combined["capacity_validation_status"],
                },
                "fourArms": four_arms,
                "source": "analysis_combined_scenarios/combined_four_arms.csv",
            }
        except (OSError, StopIteration, KeyError, TypeError, ValueError) as exc:
            projection = None
            errors.append(f"Neutral projection unavailable: {type(exc).__name__}")

        model_path = self.predictor.model_path
        model_hash = None
        try:
            model_hash = hashlib.sha256(model_path.read_bytes()).hexdigest()
        except OSError as exc:
            errors.append(f"Model hash unavailable: {type(exc).__name__}")

        return {
            "schemaVersion": 1,
            "generatedAt": iso(self.now()),
            "syntheticOnly": True,
            "containsPatientIdentifiers": False,
            "wDefinition": "Triage completed to entry into the appropriate treatment room",
            "liveRuntime": live,
            "model": {
                "context": "DEPLOYED_LOCAL_SYNTHETIC_W2_MODEL",
                "loaded": self.predictor.model_load_error is None,
                "artifact": model_path.name,
                "sha256": model_hash,
                "loadError": self.predictor.model_load_error,
                "changesNurseConfirmedEsi": False,
            },
            "evaluations": {"w2": w2_evaluation, "lwbs": lwbs_evaluation},
            "projectTarget": PROJECT_LWBS_TARGET,
            "neutralProjection": projection,
            "dataContexts": {
                "monthlyDashboard": "ILLUSTRATIVE_UI_MOCK_DATA",
                "liveRuntime": "LIVE_LOCAL_SYNTHETIC_RUNTIME_AGGREGATE",
                "modelEvaluation": "OFFLINE_HELD_OUT_SYNTHETIC_EVALUATION",
                "neutralProjection": "HYPOTHETICAL_SCENARIO_PROJECTION_NOT_OBSERVED_HOSPITAL_OUTCOME",
            },
            "errors": errors,
        }

    def create_checkin(self, body: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        with self.lock:
            number = max([int(re.sub(r"\D", "", p["waitingNumber"]) or 0) for p in self.patients.values()] + [0]) + 1
            patient_id = f"DEMO-{number:03d}"
            now = self.now()
            token = secrets.token_urlsafe(24)
            location_auth = body.get("locationAuthorization") or {}
            patient = {
                "id": patient_id,
                "waitingNumber": f"A-{number:03d}",
                "legalName": str(body.get("legalName") or "Synthetic Demo Patient"),
                "dateOfBirth": str(body.get("dateOfBirth") or "1990-01-01"),
                "phone": str(body.get("phone") or ""),
                "insurance": str(body.get("insurance") or ""),
                "insuranceDeferred": bool(body.get("insuranceDeferred")),
                "insuranceMissing": not bool(body.get("insurance")),
                "accessibilityNeeds": list(body.get("accessibilityNeeds") or []),
                "language": body.get("language") or "en",
                "source": "mobile",
                "status": "waiting_nurse",
                "symptoms": body.get("symptoms") or {"mainConcern": "Not recorded", "onset": "", "otherSymptoms": "", "painLevel": None},
                "summary": body.get("summary"),
                "location": None,
                "nursePriority": None,
                "requiredRoomType": None,
                "symptomsChanged": False,
                "symptomUpdates": [],
                "contacts": [{"kind": "registration", "label": "Registration", "note": "Synthetic local demo", "at": iso(now)}],
                "checkedInAt": iso(now),
                "updatedAt": iso(now),
                "assessedAt": None,
                "triageCompletedAt": None,
                "queueEnteredAt": None,
                "roomCalledAt": None,
                "firstUnansweredCallAt": None,
                "recallDeadlineAt": None,
                "recallChecks": [],
                "returnedAt": None,
                "inactiveAt": None,
                "roomEnteredAt": None,
                "providerFirstSeenAt": None,
                "departureAt": None,
                "departureVerified": False,
                "w2ActualMinutes": None,
                "callStatus": "waiting",
                "reassessmentRequired": False,
                "reassessmentConfirmedAt": None,
                "careAlertAt": None,
                "careCompletedAt": None,
                "careDue": False,
                "prediction": None,
                "hasLiveUpdates": bool(body.get("phone")),
                "lastSymptomUpdateAt": None,
                "accessToken": token,
                "lwbsStatus": "PENDING",
                # Exact geo coordinates are intentionally discarded.
                "locationAuthorization": {
                    "granted": bool(location_auth.get("granted")),
                    "recordedAt": location_auth.get("recordedAt") or iso(now),
                },
                "gpsCoordinatesStored": False,
            }
            self.patients[patient_id] = patient
            status = self.patient_view(patient_id)
        self.publish("checkin.created", patient)
        return patient, {"id": patient_id, "accessToken": token, "waitingNumber": patient["waitingNumber"], "status": status}

    def update_patient(self, patient_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            p = self.patients[patient_id]
            now = self.now()
            if "nursePriority" in patch:
                priority = patch["nursePriority"]
                if priority is not None and int(priority) not in range(1, 6):
                    raise ValueError("nursePriority must be 1-5")
                p["nursePriority"] = int(priority) if priority is not None else None
            if "requiredRoomType" in patch:
                room_type = patch["requiredRoomType"]
                if room_type not in ROOM_TYPES:
                    raise ValueError("requiredRoomType must be one of the four nurse-confirmed room types")
                p["requiredRoomType"] = room_type
            if "location" in patch:
                p["location"] = patch["location"]
            if patch.get("acknowledgeSymptomChange"):
                p["symptomsChanged"] = False

            status = patch.get("status")
            if status == "waiting_provider":
                if p.get("nursePriority") is None or p.get("requiredRoomType") not in ROOM_TYPES:
                    raise ValueError("nurse-confirmed ESI and room type are required before completing triage")
                if not p.get("triageCompletedAt"):
                    p["triageCompletedAt"] = iso(now)
                if p.get("reassessmentRequired"):
                    p["reassessmentConfirmedAt"] = iso(now)
                    p["reassessmentRequired"] = False
                p["queueEnteredAt"] = p.get("reassessmentConfirmedAt") or p["triageCompletedAt"]
                p["assessedAt"] = p["triageCompletedAt"]
                p["callStatus"] = "waiting"
                p["status"] = "waiting_provider"
            elif status == "in_assessment":
                p["status"] = status
            elif status == "waiting_nurse":
                if p.get("status") in {"left", "inactive"}:
                    p["reassessmentRequired"] = True
                    p["callStatus"] = "returned_requires_reassessment"
                    p["returnedAt"] = iso(now)
                    p["queueEnteredAt"] = None
                    p["prediction"] = None
                p["status"] = status
            elif status == "completed":
                p["status"] = status
            elif status == "left":
                p["status"] = "left"
                p["departureAt"] = iso(now)
                p["departureVerified"] = True
                provider_seen = parse_dt(p.get("providerFirstSeenAt"))
                p["lwbsStatus"] = "NOT_LWBS_PROVIDER_SEEN" if provider_seen and provider_seen <= now else "PENDING_LWBS_REVIEW"
            elif status == "with_care_team":
                raise ValueError("Room Called does not end W2; record roomEvent='entered' instead")
            elif status is not None:
                raise ValueError(f"unsupported status {status}")

            event = patch.get("roomEvent")
            if event == "called":
                if p.get("status") != "waiting_provider" or p.get("reassessmentRequired"):
                    raise ValueError("only a reassessed patient waiting for a room can be called")
                p["roomCalledAt"] = iso(now)
                p["callStatus"] = "called"
            elif event == "no_response":
                if p.get("callStatus") != "called":
                    raise ValueError("no-response recall starts only after a formal room call")
                p["firstUnansweredCallAt"] = iso(now)
                p["recallDeadlineAt"] = iso(now + timedelta(minutes=30))
                p["recallChecks"] = []
                p["callStatus"] = "recall_active"
            elif event == "returned":
                if p.get("callStatus") != "recall_active":
                    raise ValueError("patient is not in the recall window")
                if now > parse_dt(p.get("recallDeadlineAt")):
                    raise ValueError("30-minute recall window has ended")
                p["returnedAt"] = iso(now)
                p["status"] = "waiting_nurse"
                p["callStatus"] = "returned_requires_reassessment"
                p["reassessmentRequired"] = True
                p["queueEnteredAt"] = None
                p["prediction"] = None
            elif event == "entered":
                if p.get("callStatus") != "called" or p.get("status") != "waiting_provider":
                    raise ValueError("Room Entered requires a current formal call")
                p["roomEnteredAt"] = iso(now)
                p["status"] = "with_care_team"
                p["callStatus"] = "entered"
                p["w2ActualMinutes"] = round(minutes_between(parse_dt(p["triageCompletedAt"]), now), 1)
                p["careDue"] = False
            elif event is not None:
                raise ValueError(f"unsupported roomEvent {event}")

            p["updatedAt"] = iso(now)
            self._refresh_locked()
            result = self._computed(p)
            result.pop("accessToken", None)
        self.publish("patient.updated", p)
        return result


STORE = DemoStore()


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "SeenSoonerLocal/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"{self.address_string()} - {fmt % args}")

    def _cors_origin(self) -> str | None:
        origin = self.headers.get("Origin")
        return origin if origin in ALLOWED_ORIGINS else None

    def end_headers(self) -> None:
        origin = self._cors_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Staff-Name, X-Dev-Key")
        self.end_headers()

    def _json(self, status: int, payload: Any) -> None:
        encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _error(self, status: int, code: str, message: str, fields: dict[str, str] | None = None) -> None:
        body: dict[str, Any] = {"error": {"code": code, "message": message}}
        if fields:
            body["error"]["fields"] = fields
        self._json(status, body)

    def _body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or 0)
        return json.loads(self.rfile.read(length).decode("utf-8")) if length else {}

    def _bearer(self) -> str:
        value = self.headers.get("Authorization", "")
        return value[7:] if value.startswith("Bearer ") else ""

    def _require_staff(self) -> bool:
        if secrets.compare_digest(self._bearer(), STAFF_TOKEN):
            return True
        self._error(401, "staff_auth_required", "Valid local demo staff token required")
        return False

    def _require_dev(self) -> bool:
        if secrets.compare_digest(self.headers.get("X-Dev-Key", ""), DEV_KEY):
            return True
        self._error(403, "dev_key_required", "Local development key required")
        return False

    def _patient(self, patient_id: str) -> dict[str, Any] | None:
        with STORE.lock:
            p = STORE.patients.get(patient_id)
            if not p:
                self._error(404, "not_found", "Patient not found")
                return None
            if not secrets.compare_digest(self._bearer(), p["accessToken"]):
                self._error(401, "patient_auth_required", "Patient-scoped token required")
                return None
            return p

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/health":
            self._json(200, {"ok": True, "syntheticOnly": True, "updatedAt": iso(STORE.now()), "modelLoaded": STORE.predictor.model_load_error is None})
            return
        if path == "/api/staff/patients":
            if not self._require_staff():
                return
            self._json(200, STORE.staff_list())
            return
        if path == "/api/public/queue":
            self._json(200, STORE.public_queue())
            return
        if path == "/api/oversight/summary":
            self._json(200, STORE.oversight_summary())
            return
        match = re.fullmatch(r"/api/checkins/([^/]+)", path)
        if match:
            patient_id = match.group(1)
            if not self._patient(patient_id):
                return
            self._json(200, STORE.patient_view(patient_id))
            return
        if path == "/api/events":
            query = parse_qs(parsed.query)
            channel = query.get("channel", [""])[0]
            checkin_id = query.get("checkinId", [None])[0]
            token = query.get("token", [""])[0]
            if channel not in {"public", "staff", "patient"}:
                self._error(422, "invalid_channel", "channel must be public, staff, or patient")
                return
            if channel == "staff" and not secrets.compare_digest(self._bearer() or token, STAFF_TOKEN):
                self._error(401, "staff_auth_required", "Valid staff token required")
                return
            if channel == "patient":
                with STORE.lock:
                    p = STORE.patients.get(checkin_id or "")
                    if not p or not secrets.compare_digest(token, p["accessToken"]):
                        self._error(401, "patient_auth_required", "Valid patient token required")
                        return
            self._sse(channel, checkin_id)
            return
        if path == "/api/dev/state":
            if not self._require_dev():
                return
            with STORE.lock:
                self._json(200, {"now": iso(STORE.now()), "forceModelFailure": STORE.force_model_failure, "patients": STORE.patients})
            return
        if not path.startswith("/api/") and self._serve_static(path):
            return
        self._error(404, "not_found", "Endpoint not found")

    def _serve_static(self, path: str) -> bool:
        """Serve the built frontends from WEB_ROOT (hosted demo only)."""
        if not WEB_ROOT.is_dir():
            return False
        parts = [seg for seg in path.split("/") if seg]
        if any(seg in {".", ".."} or "\\" in seg for seg in parts):
            return False
        if parts and parts[0] in WEB_APPS and len(parts) == 1 and not path.endswith("/"):
            self.send_response(HTTPStatus.MOVED_PERMANENTLY)
            self.send_header("Location", f"/{parts[0]}/")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return True
        if parts and parts[0] in WEB_ALIASES:
            parts = [WEB_ALIASES[parts[0]], *parts[1:]]
        target = (WEB_ROOT.joinpath(*parts) if parts else WEB_ROOT).resolve()
        if target != WEB_ROOT and WEB_ROOT not in target.parents:
            return False
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            # Single-page-app fallback: unknown paths inside an app load that app's index.html.
            if parts and parts[0] in WEB_APPS and "." not in parts[-1]:
                target = WEB_ROOT / parts[0] / "index.html"
            if not target.is_file():
                return False
        data = target.read_bytes()
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in {"application/javascript", "image/svg+xml"}:
            ctype += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
        return True

    def _sse(self, channel: str, checkin_id: str | None) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        client = STORE.register_client(channel, checkin_id)
        try:
            self.wfile.write(f"event: ready\ndata: {json.dumps({'updatedAt': iso(STORE.now())})}\n\n".encode())
            self.wfile.flush()
            while True:
                try:
                    event = client["queue"].get(timeout=15)
                    message = f"event: change\ndata: {json.dumps(event)}\n\n"
                except queue.Empty:
                    message = ": keepalive\n\n"
                self.wfile.write(message.encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            STORE.unregister_client(client)

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        try:
            body = self._body()
            if path == "/api/summaries/draft":
                symptoms = body.get("symptoms") or {}
                draft = "; ".join(filter(None, [symptoms.get("mainConcern"), symptoms.get("onset"), symptoms.get("otherSymptoms")]))
                self._json(200, {"draft": draft or "Patient-reported symptoms", "generatedBy": "local-template", "isDraft": True})
                return
            if path == "/api/checkins":
                _, response = STORE.create_checkin(body)
                self._json(201, response)
                return
            if path == "/api/staff/patients":
                if not self._require_staff():
                    return
                body = dict(body)
                body["phone"] = body.get("phone") or ""
                _, response = STORE.create_checkin(body)
                patient_id = response["id"]
                with STORE.lock:
                    STORE.patients[patient_id]["source"] = body.get("source") or "staff_assisted"
                    STORE.patients[patient_id]["hasLiveUpdates"] = False
                    result = STORE._computed(STORE.patients[patient_id])
                    result.pop("accessToken", None)
                self._json(201, result)
                return
            match = re.fullmatch(r"/api/checkins/([^/]+)/location-exit", path)
            if match:
                p = self._patient(match.group(1))
                if not p:
                    return
                with STORE.lock:
                    now = STORE.now()
                    via_tablet = body.get("via") == "tablet"
                    note = ("Patient scanned slip at check-in tablet: leaving" if via_tablet else "Patient reported left") if body.get("left") else "Patient confirmed still present"
                    p["contacts"].append({"kind": "location_exit", "label": "Check-in tablet" if via_tablet else "Location check", "note": note, "at": iso(now)})
                    if body.get("left"):
                        p["status"] = "left"
                        p["departureAt"] = iso(now)
                        p["departureVerified"] = True
                        p["lwbsStatus"] = "PENDING_LWBS_REVIEW"
                    p["updatedAt"] = iso(now)
                    result = STORE.patient_view(p["id"])
                STORE.publish("patient.location_exit", p)
                self._json(200, result)
                return
            match = re.fullmatch(r"/api/staff/patients/([^/]+)/contacts", path)
            if match:
                if not self._require_staff():
                    return
                with STORE.lock:
                    p = STORE.patients.get(match.group(1))
                    if not p:
                        self._error(404, "not_found", "Patient not found")
                        return
                    now = STORE.now()
                    kind = body.get("kind") or "check_in"
                    p["contacts"].append({"kind": kind, "label": "Nurse care check" if p.get("careDue") else "Nurse check-in", "note": body.get("note") or "", "at": iso(now), "checklist": body.get("checklist") or []})
                    if p.get("careDue"):
                        p["careCompletedAt"] = iso(now)
                        p["careDue"] = False
                    if kind == "symptoms_changed":
                        p["symptomsChanged"] = True
                    p["updatedAt"] = iso(now)
                    result = STORE._computed(p)
                    result.pop("accessToken", None)
                STORE.publish("patient.updated", p)
                self._json(200, result)
                return
            if path == "/api/dev/reset":
                if not self._require_dev():
                    return
                STORE.reset()
                self._json(200, {"ok": True, "patients": len(STORE.patients)})
                return
            if path == "/api/dev/advance-time":
                if not self._require_dev():
                    return
                now = STORE.advance(float(body.get("minutes", 0)))
                self._json(200, {"ok": True, "now": iso(now)})
                return
            if path == "/api/dev/model-failure":
                if not self._require_dev():
                    return
                with STORE.lock:
                    STORE.force_model_failure = bool(body.get("enabled"))
                    STORE._refresh_locked()
                STORE.publish("prediction.mode_changed")
                self._json(200, {"ok": True, "forceModelFailure": STORE.force_model_failure})
                return
            self._error(404, "not_found", "Endpoint not found")
        except (ValueError, KeyError, json.JSONDecodeError) as exc:
            self._error(422, "validation_error", str(exc))

    def do_PATCH(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        try:
            body = self._body()
            match = re.fullmatch(r"/api/staff/patients/([^/]+)", path)
            if match:
                if not self._require_staff():
                    return
                if match.group(1) not in STORE.patients:
                    self._error(404, "not_found", "Patient not found")
                    return
                self._json(200, STORE.update_patient(match.group(1), body))
                return
            match = re.fullmatch(r"/api/checkins/([^/]+)/symptoms", path)
            if match:
                p = self._patient(match.group(1))
                if not p:
                    return
                with STORE.lock:
                    previous = copy.deepcopy(p["symptoms"])
                    p["symptoms"] = body["symptoms"]
                    if body.get("summary"):
                        p["summary"] = body["summary"]
                    p["symptomsChanged"] = True
                    p["lastSymptomUpdateAt"] = iso(STORE.now())
                    p["symptomUpdates"].append({"at": p["lastSymptomUpdateAt"], "by": "patient", "previous": previous, "symptoms": p["symptoms"], "note": body.get("note") or ""})
                    p["updatedAt"] = iso(STORE.now())
                    result = STORE.patient_view(p["id"])
                STORE.publish("patient.symptoms_changed", p)
                self._json(200, result)
                return
            match = re.fullmatch(r"/api/checkins/([^/]+)/insurance", path)
            if match:
                p = self._patient(match.group(1))
                if not p:
                    return
                with STORE.lock:
                    p["insurance"] = str(body.get("insurance") or "")
                    p["insuranceMissing"] = not bool(p["insurance"])
                    p["updatedAt"] = iso(STORE.now())
                    result = STORE.patient_view(p["id"])
                STORE.publish("patient.updated", p)
                self._json(200, result)
                return
            self._error(404, "not_found", "Endpoint not found")
        except (ValueError, KeyError, json.JSONDecodeError) as exc:
            self._error(422, "validation_error", str(exc))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=os.getenv("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "8000")))
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), ApiHandler)
    server.daemon_threads = True
    print(f"SeenSooner local synthetic API: http://{args.host}:{args.port}")
    print("Staff token and dev key are demo-only; see README.md")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
