#!/usr/bin/env python3
"""Local HTTP integration tests: one complete patient, then the 30-patient seed."""
from __future__ import annotations

import csv
import json
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Any

import server


ROOT = Path(__file__).resolve().parent
REPORTS = ROOT.parent / "reports"
LOGS = ROOT.parent / "logs"
BASE = "http://127.0.0.1:8765"
STAFF_HEADERS = {"Authorization": "Bearer demo-staff-token", "X-Staff-Name": "Integration Test RN"}
DEV_HEADERS = {"X-Dev-Key": "demo-reset-key"}
results: list[dict[str, str]] = []


def request(method: str, path: str, body: Any = None, headers: dict[str, str] | None = None) -> tuple[int, Any]:
    payload = None if body is None else json.dumps(body).encode("utf-8")
    merged = {"Accept": "application/json", **(headers or {})}
    if payload is not None:
        merged["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=payload, method=method, headers=merged)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            text = response.read().decode("utf-8")
            return response.status, json.loads(text) if text else None
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8")
        return exc.code, json.loads(text) if text else None


def check(name: str, condition: bool, observed: Any, expected: Any, phase: str) -> None:
    status = "PASS" if condition else "FAIL"
    results.append(
        {
            "phase": phase,
            "test": name,
            "status": status,
            "observed": json.dumps(observed, ensure_ascii=False, default=str),
            "expected": json.dumps(expected, ensure_ascii=False, default=str),
        }
    )
    if not condition:
        raise AssertionError(f"{name}: observed={observed!r}, expected={expected!r}")


def create_patient(name: str, phone: str = "555-0199", esi: int = 3, room: str = "REGULAR_ED") -> tuple[str, str, dict[str, Any]]:
    status, response = request(
        "POST",
        "/api/checkins",
        {
            "siteCode": "ED-MAIN",
            "language": "en",
            "legalName": name,
            "dateOfBirth": "1990-01-01",
            "phone": phone,
            "insurance": "Commercial",
            "symptoms": {"mainConcern": "Synthetic test concern", "onset": "Today", "otherSymptoms": "", "painLevel": 4},
            "locationAuthorization": {"granted": True, "recordedAt": datetime.now(timezone.utc).isoformat()},
            "geo": {"lat": 40.123456, "lng": -74.123456, "accuracy": 2},
        },
    )
    check("create_checkin", status == 201, status, 201, "single_patient")
    patient_id, token = response["id"], response["accessToken"]
    status, _ = request("PATCH", f"/api/staff/patients/{patient_id}", {"status": "in_assessment"}, STAFF_HEADERS)
    check("start_assessment", status == 200, status, 200, "single_patient")
    status, staff = request(
        "PATCH",
        f"/api/staff/patients/{patient_id}",
        {"status": "waiting_provider", "nursePriority": esi, "requiredRoomType": room},
        STAFF_HEADERS,
    )
    check("complete_triage", status == 200 and staff["triageCompletedAt"] is not None, staff.get("triageCompletedAt"), "timestamp", "single_patient")
    return patient_id, token, staff


def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def single_patient_flow() -> None:
    request("POST", "/api/dev/reset", {}, DEV_HEADERS)
    patient_id, token, staff = create_patient("Integration Patient")
    patient_headers = {"Authorization": f"Bearer {token}"}

    status, patient = request("GET", f"/api/checkins/{patient_id}", headers=patient_headers)
    check("patient_eta_after_esi", status == 200 and patient["remainingW2Low"] is not None, patient, "remaining ETA range", "single_patient")
    check("remaining_nonnegative_at_start", patient["predictedRemainingW2Minutes"] >= 0, patient["predictedRemainingW2Minutes"], ">=0", "single_patient")
    check("model_does_not_change_esi", staff["nursePriority"] == 3, staff["nursePriority"], 3, "single_patient")

    _, public = request("GET", "/api/public/queue")
    item = next(row for row in public["providerQueue"] if row["waitingNumber"] == patient["waitingNumber"])
    check("public_and_patient_eta_match", item["remainingW2Low"] == patient["remainingW2Low"] and item["remainingW2High"] == patient["remainingW2High"], item, "same range", "single_patient")
    forbidden_keys = {"legalName", "dateOfBirth", "symptoms", "insurance", "phone", "requiredRoomType", "roomEnteredAt"}
    check("public_payload_no_phi_fields", not (set(item) & forbidden_keys), sorted(set(item) & forbidden_keys), [], "single_patient")

    request("POST", "/api/dev/advance-time", {"minutes": 25}, DEV_HEADERS)
    _, patient25 = request("GET", f"/api/checkins/{patient_id}", headers=patient_headers)
    check("remaining_nonnegative_at_25", patient25["w2ElapsedMinutes"] >= 25 and patient25["predictedRemainingW2Minutes"] >= 0, patient25, "elapsed>=25 and remaining>=0", "single_patient")

    request("POST", "/api/dev/advance-time", {"minutes": 36}, DEV_HEADERS)
    _, staff_list = request("GET", "/api/staff/patients", headers=STAFF_HEADERS)
    overdue = next(row for row in staff_list["patients"] if row["id"] == patient_id)
    check("care_trigger_at_60_actual_w2", overdue["careDue"] is True and overdue["w2ElapsedMinutes"] >= 60, overdue, "careDue true", "single_patient")
    request("POST", f"/api/staff/patients/{patient_id}/contacts", {"kind": "check_in", "note": "60-minute care check"}, STAFF_HEADERS)
    _, staff_list = request("GET", "/api/staff/patients", headers=STAFF_HEADERS)
    cared = next(row for row in staff_list["patients"] if row["id"] == patient_id)
    check("care_completion_clears_alert", cared["careDue"] is False, cared["careDue"], False, "single_patient")

    request("PATCH", f"/api/staff/patients/{patient_id}", {"roomEvent": "called"}, STAFF_HEADERS)
    _, called = request("GET", f"/api/checkins/{patient_id}", headers=patient_headers)
    check("room_called_does_not_end_w2", called["status"] == "waiting_provider" and called["roomEnteredAt"] is None, called, "waiting_provider; no roomEnteredAt", "single_patient")
    _, public_called = request("GET", "/api/public/queue")
    check("called_number_on_public_display", any(row["waitingNumber"] == called["waitingNumber"] for row in public_called["nowSeeing"]), public_called["nowSeeing"], called["waitingNumber"], "single_patient")

    request("PATCH", f"/api/staff/patients/{patient_id}", {"roomEvent": "entered"}, STAFF_HEADERS)
    _, entered = request("GET", f"/api/checkins/{patient_id}", headers=patient_headers)
    frozen_w2 = entered["w2ActualMinutes"]
    check("room_entered_ends_w2", entered["status"] == "with_care_team" and entered["predictedRemainingW2Minutes"] == 0, entered, "remaining=0", "single_patient")
    request("POST", "/api/dev/advance-time", {"minutes": 10}, DEV_HEADERS)
    _, entered_later = request("GET", f"/api/checkins/{patient_id}", headers=patient_headers)
    check("w2_stops_after_entry", entered_later["w2ActualMinutes"] == frozen_w2, entered_later["w2ActualMinutes"], frozen_w2, "single_patient")

    recall_id, recall_token, _ = create_patient("Recall Return")
    request("PATCH", f"/api/staff/patients/{recall_id}", {"roomEvent": "called"}, STAFF_HEADERS)
    request("PATCH", f"/api/staff/patients/{recall_id}", {"roomEvent": "no_response"}, STAFF_HEADERS)
    request("POST", "/api/dev/advance-time", {"minutes": 10}, DEV_HEADERS)
    request("PATCH", f"/api/staff/patients/{recall_id}", {"roomEvent": "returned"}, STAFF_HEADERS)
    _, returned = request("GET", f"/api/checkins/{recall_id}", headers={"Authorization": f"Bearer {recall_token}"})
    check("return_requires_reassessment", returned["status"] == "waiting_nurse" and returned["reassessmentRequired"] is True, returned, "waiting_nurse and reassessment required", "single_patient")
    request("PATCH", f"/api/staff/patients/{recall_id}", {"status": "in_assessment"}, STAFF_HEADERS)
    request("PATCH", f"/api/staff/patients/{recall_id}", {"status": "waiting_provider", "nursePriority": 3, "requiredRoomType": "REGULAR_ED"}, STAFF_HEADERS)
    _, state = request("GET", "/api/dev/state", headers=DEV_HEADERS)
    recall_state = state["patients"][recall_id]
    check("reentry_queue_time_after_reassessment", recall_state["reassessmentConfirmedAt"] is not None and parse_iso(recall_state["queueEnteredAt"]) > parse_iso(recall_state["triageCompletedAt"]), {"queue": recall_state["queueEnteredAt"], "triage": recall_state["triageCompletedAt"]}, "queue after triage", "single_patient")

    inactive_id, inactive_token, _ = create_patient("Recall Inactive")
    request("PATCH", f"/api/staff/patients/{inactive_id}", {"roomEvent": "called"}, STAFF_HEADERS)
    request("PATCH", f"/api/staff/patients/{inactive_id}", {"roomEvent": "no_response"}, STAFF_HEADERS)
    request("POST", "/api/dev/advance-time", {"minutes": 31}, DEV_HEADERS)
    _, inactive = request("GET", f"/api/checkins/{inactive_id}", headers={"Authorization": f"Bearer {inactive_token}"})
    _, state = request("GET", "/api/dev/state", headers=DEV_HEADERS)
    check("recall_30min_marks_inactive", inactive["status"] == "inactive", inactive["status"], "inactive", "single_patient")
    check("inactive_not_lwbs", state["patients"][inactive_id]["lwbsStatus"] == "NOT_LWBS_INACTIVE", state["patients"][inactive_id]["lwbsStatus"], "NOT_LWBS_INACTIVE", "single_patient")

    request("POST", "/api/dev/model-failure", {"enabled": True}, DEV_HEADERS)
    fallback_id, fallback_token, _ = create_patient("Fallback Patient", esi=4)
    _, fallback = request("GET", f"/api/checkins/{fallback_id}", headers={"Authorization": f"Bearer {fallback_token}"})
    check("model_failure_historical_fallback", fallback["predictionSource"] == "historical_completed_w2_fallback" and fallback["predictedRemainingW2Minutes"] >= 0, fallback, "historical fallback", "single_patient")
    request("POST", "/api/dev/model-failure", {"enabled": False}, DEV_HEADERS)

    _, state = request("GET", "/api/dev/state", headers=DEV_HEADERS)
    created_state = state["patients"][patient_id]
    stored_text = json.dumps(created_state).lower()
    check("exact_gps_not_stored", "geo" not in created_state and "40.123456" not in stored_text and "-74.123456" not in stored_text and created_state["gpsCoordinatesStored"] is False, created_state.get("locationAuthorization"), "authorization metadata only", "single_patient")
    status, _ = request("POST", "/api/dev/reset", {})
    check("dev_reset_requires_key", status == 403, status, 403, "single_patient")
    status, _ = request("GET", "/api/staff/patients")
    check("staff_api_requires_auth", status == 401, status, 401, "single_patient")


def thirty_patient_flow() -> None:
    request("POST", "/api/dev/reset", {}, DEV_HEADERS)
    _, staff_list = request("GET", "/api/staff/patients", headers=STAFF_HEADERS)
    patients = staff_list["patients"]
    check("seed_row_count", len(patients) == 30, len(patients), 30, "thirty_patient")
    check("seed_unique_ids", len({p["id"] for p in patients}) == 30, len({p["id"] for p in patients}), 30, "thirty_patient")
    waiting = [p for p in patients if p["status"] == "waiting_provider" and p["callStatus"] == "waiting"]
    check("seed_waiting_predictions_nonnegative", all(p["predictedRemainingW2Minutes"] is not None and p["predictedRemainingW2Minutes"] >= 0 for p in waiting), len(waiting), "all nonnegative", "thirty_patient")
    _, public = request("GET", "/api/public/queue")
    forbidden_values = [p["legalName"] for p in patients] + [p["dateOfBirth"] for p in patients]
    public_text = json.dumps(public)
    check("public_30_has_no_identity_values", not any(value and value in public_text for value in forbidden_values), "identity scan", "no names or DOBs", "thirty_patient")
    allowed_public_keys = {"updatedAt", "providerQueue", "nowSeeing", "awaitingNurse", "inAssessment", "waitingNumber", "estimatedWaitMinutes", "remainingW2Low", "remainingW2High", "predictionSource"}
    all_keys: set[str] = set()
    def collect(value: Any) -> None:
        if isinstance(value, dict):
            all_keys.update(value)
            for child in value.values():
                collect(child)
        elif isinstance(value, list):
            for child in value:
                collect(child)
    collect(public)
    check("public_schema_allowlist", all_keys <= allowed_public_keys, sorted(all_keys), sorted(allowed_public_keys), "thirty_patient")

    status, oversight = request("GET", "/api/oversight/summary")
    oversight_text = json.dumps(oversight)
    oversight_keys: set[str] = set()
    def collect_oversight_keys(value: Any) -> None:
        if isinstance(value, dict):
            oversight_keys.update(value)
            for child in value.values():
                collect_oversight_keys(child)
        elif isinstance(value, list):
            for child in value:
                collect_oversight_keys(child)
    collect_oversight_keys(oversight)
    forbidden_oversight_keys = {"id", "waitingNumber", "legalName", "dateOfBirth", "phone", "insurance", "symptoms", "accessToken"}
    check("oversight_endpoint_available", status == 200 and oversight["syntheticOnly"] is True, status, 200, "thirty_patient")
    check("oversight_aggregate_has_no_patient_identifiers", not (oversight_keys & forbidden_oversight_keys) and not any(value and value in oversight_text for value in forbidden_values), sorted(oversight_keys & forbidden_oversight_keys), [], "thirty_patient")
    check("oversight_uses_delivered_model_evaluation", oversight["model"]["loaded"] is True and oversight["evaluations"]["w2"]["model"] == "existing_delivered_model", oversight["evaluations"]["w2"], "loaded delivered model evaluation", "thirty_patient")
    check("oversight_target_separate_from_projection", oversight["projectTarget"]["targetRatePct"] == 3.5 and oversight["neutralProjection"]["combined"]["lwbsRatePct"] == 3.2, {"target": oversight["projectTarget"], "projection": oversight["neutralProjection"]["combined"]}, "3.5 target; 3.2 hypothetical projection", "thirty_patient")
    check("oversight_neutral_projection_integrity", round(oversight["neutralProjection"]["reductions"]["meanWMin"], 2) == 3.11 and round(oversight["neutralProjection"]["reductions"]["lwbsPp"], 2) == 0.80, oversight["neutralProjection"]["reductions"], "3.11 min and 0.80 pp", "thirty_patient")

    low_id, _, _ = create_patient("ESI Five First", phone="", esi=5)
    high_id, _, _ = create_patient("ESI Two Later", phone="555-0111", esi=2)
    _, public = request("GET", "/api/public/queue")
    numbers = [row["waitingNumber"] for row in public["providerQueue"]]
    _, state = request("GET", "/api/dev/state", headers=DEV_HEADERS)
    low_num = state["patients"][low_id]["waitingNumber"]
    high_num = state["patients"][high_id]["waitingNumber"]
    check("esi_priority_over_arrival_and_phone", numbers.index(high_num) < numbers.index(low_num), {"ESI2": numbers.index(high_num), "ESI5": numbers.index(low_num)}, "ESI2 ahead", "thirty_patient")

    seed = next(p for p in patients if p["status"] == "waiting_nurse")
    request("PATCH", f"/api/staff/patients/{seed['id']}", {"status": "in_assessment", "nursePriority": 2, "requiredRoomType": "RESUSCITATION_TRAUMA"}, STAFF_HEADERS)
    request("PATCH", f"/api/staff/patients/{seed['id']}", {"status": "waiting_provider", "nursePriority": 2, "requiredRoomType": "RESUSCITATION_TRAUMA"}, STAFF_HEADERS)
    _, patient = request("GET", f"/api/checkins/{seed['id']}", headers={"Authorization": f"Bearer demo-patient-{seed['id']}"})
    check("staff_update_syncs_to_patient_view", patient["status"] == "waiting_provider" and patient["triageCompletedAt"] is not None and patient["remainingW2Low"] is not None, patient, "shared backend update", "thirty_patient")


def main() -> None:
    REPORTS.mkdir(parents=True, exist_ok=True)
    LOGS.mkdir(parents=True, exist_ok=True)
    httpd = ThreadingHTTPServer(("127.0.0.1", 8765), server.ApiHandler)
    httpd.daemon_threads = True
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.2)
    try:
        single_patient_flow()
        thirty_patient_flow()
    finally:
        httpd.shutdown()
        thread.join(timeout=5)
        httpd.server_close()
        with (REPORTS / "integration_test_results.csv").open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["phase", "test", "status", "observed", "expected"])
            writer.writeheader()
            writer.writerows(results)
    failed = [row for row in results if row["status"] != "PASS"]
    lines = [f"Integration checks: {len(results)} total, {len(failed)} failed"]
    for row in results:
        lines.append(f"{row['status']:4} {row['phase']:16} {row['test']}")
    log_text = "\n".join(lines) + "\n"
    (LOGS / "integration_test_summary.txt").write_text(log_text, encoding="utf-8")
    print(log_text, end="")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
