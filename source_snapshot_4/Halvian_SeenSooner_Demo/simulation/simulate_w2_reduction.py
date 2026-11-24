#!/usr/bin/env python3
"""Paired discrete-event simulation of Baseline vs SeenSooner W2.

The program never trains or loads the W2/LWBS models. It preserves clinician-
confirmed ESI and room type, and changes only explicit workflow delays between
the paired Baseline and SeenSooner runs.
"""
from __future__ import annotations

import argparse
import heapq
import json
from dataclasses import dataclass, asdict
from pathlib import Path

import numpy as np
import pandas as pd


ROOM_CAPACITY = {
    "REGULAR_ED": 32,
    "FAST_TRACK": 8,
    "RESUSCITATION_TRAUMA": 4,
    "BEHAVIORAL_HEALTH": 4,
}
ROOM_PREFIX = {
    "REGULAR_ED": "REG",
    "FAST_TRACK": "FT",
    "RESUSCITATION_TRAUMA": "TR",
    "BEHAVIORAL_HEALTH": "BH",
}
NURSES_BY_SHIFT = {"Day": 14, "Evening": 14, "Night": 9}
PRIMARY_CASE = "neutral"
PRIMARY_DAY = "NORMAL_WEEKDAY"
BASE_SEED = 20261122


@dataclass(frozen=True)
class ParameterCase:
    name: str
    no_response_rate: float
    return_within_30m_probability: float
    baseline_no_response_hold_min: float
    intervention_reassignment_min: float
    baseline_coordination_delay_min: float
    intervention_coordination_delay_min: float
    turnover_minutes: float
    regular_service_mean_min: float
    fast_track_service_mean_min: float
    trauma_service_mean_min: float
    behavioral_service_mean_min: float
    returned_nurse_reassessment_min: float
    common_access_delay_median_min: float
    common_access_delay_sigma: float
    regular_room_share: float
    fast_track_room_share: float
    trauma_room_share: float
    behavioral_room_share: float
    admitted_boarding_hold_min: float = 210.0
    service_lognormal_sigma: float = 0.35

    def service_mean(self, room_type: str) -> float:
        return {
            "REGULAR_ED": self.regular_service_mean_min,
            "FAST_TRACK": self.fast_track_service_mean_min,
            "RESUSCITATION_TRAUMA": self.trauma_service_mean_min,
            "BEHAVIORAL_HEALTH": self.behavioral_service_mean_min,
        }[room_type]

    def room_mix(self) -> dict[str, float]:
        """Assumed daily demand mix; source profiles keep their confirmed room type."""
        return {
            "REGULAR_ED": self.regular_room_share,
            "FAST_TRACK": self.fast_track_room_share,
            "RESUSCITATION_TRAUMA": self.trauma_room_share,
            "BEHAVIORAL_HEALTH": self.behavioral_room_share,
        }


PARAMETER_CASES = {
    "conservative": ParameterCase(
        "conservative", 0.04, 0.90, 3.0, 1.0, 1.0, 0.5, 5.0,
        120.0, 60.0, 180.0, 180.0,
        4.0, 12.0, 0.35, 0.64, 0.27, 0.05, 0.04,
    ),
    "neutral": ParameterCase(
        "neutral", 0.08, 0.85, 5.0, 1.0, 2.0, 0.5, 8.0,
        150.0, 75.0, 210.0, 240.0,
        5.0, 22.0, 0.45, 0.62, 0.27, 0.06, 0.05,
    ),
    "high_pressure": ParameterCase(
        "high_pressure", 0.12, 0.80, 8.0, 2.0, 3.0, 0.75, 12.0,
        180.0, 90.0, 240.0, 300.0,
        8.0, 32.0, 0.55, 0.57, 0.26, 0.07, 0.10,
    ),
    "immediate_skip": ParameterCase(
        "immediate_skip", 0.08, 0.85, 1.0, 1.0, 2.0, 0.5, 8.0,
        150.0, 75.0, 210.0, 240.0,
        5.0, 22.0, 0.45, 0.62, 0.27, 0.06, 0.05,
    ),
    "equal_process_null": ParameterCase(
        "equal_process_null", 0.08, 0.85, 1.0, 1.0, 0.5, 0.5, 8.0,
        150.0, 75.0, 210.0, 240.0,
        5.0, 22.0, 0.45, 0.62, 0.27, 0.06, 0.05,
    ),
}


DAY_SCENARIOS = {
    "FIXTURE_200_VALIDATION": {
        "patients": 200,
        "date": "2026-11-23 07:00:00-05:00",
        "profile": "weekday",
        "winter": False,
        "source_note": "200-person fixture validation; arrival times rearranged",
    },
    "NORMAL_WEEKDAY": {
        "patients": 233,
        "date": "2026-11-23 07:00:00-05:00",
        "profile": "weekday",
        "winter": False,
        "source_note": "85,000 / 365 rounded to 233; time-of-day profile is assumed",
    },
    "MONDAY_PEAK": {
        "patients": 256,
        "date": "2026-11-23 07:00:00-05:00",
        "profile": "monday_peak",
        "winter": False,
        "source_note": "Monday 10% above annual daily average is an assumption",
    },
    "WEEKEND": {
        "patients": 210,
        "date": "2026-11-28 07:00:00-05:00",
        "profile": "weekend",
        "winter": False,
        "source_note": "Weekend 90% of annual daily average is an assumption",
    },
    "WINTER_SURGE": {
        "patients": 280,
        "date": "2026-01-05 07:00:00-05:00",
        "profile": "monday_peak",
        "winter": True,
        "source_note": "233 x 1.20 rounded to 280; +20% comes from PDF",
    },
}


MOBILE_PROBABILITY_BY_INSURANCE = {
    "Commercial": 0.92,
    "Medicaid_CHIP": 0.82,
    "Medicare": 0.78,
    "Uninsured": 0.70,
    "Other_Unspecified": 0.85,
}


def normalize_insurance(value: str) -> str:
    return {
        "Medicaid/CHIP": "Medicaid_CHIP",
        "Other/Unspecified": "Other_Unspecified",
    }.get(value, value)


def load_inputs(source_dir: Path) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    encounters = pd.read_csv(source_dir / "encounters_200_w2_scenario.csv")
    resources = pd.read_csv(source_dir / "resource_snapshots_12.csv")
    annual = pd.read_csv(source_dir / "annual_85000_w2_model_ready.csv")
    if len(encounters) != 200:
        raise ValueError(f"Expected 200 fixture encounters, found {len(encounters)}")
    if len(resources) != 12:
        raise ValueError(f"Expected 12 resource snapshots, found {len(resources)}")
    if len(annual) != 85000:
        raise ValueError(f"Expected 85,000 annual rows, found {len(annual)}")
    encounters["insurance_normalized"] = encounters["insurance_group"].map(normalize_insurance)
    arrival = pd.to_datetime(encounters["arrival_time"], utc=True)
    triage = pd.to_datetime(encounters["triage_completed_at"], utc=True)
    encounters["source_triage_delay_min"] = (
        (triage - arrival).dt.total_seconds().div(60).clip(5, 35)
    )
    annual["insurance_normalized"] = annual["insurance"].map(normalize_insurance)
    return encounters, resources, annual


def sampling_weights(
    encounters: pd.DataFrame, annual: pd.DataFrame, params: ParameterCase
) -> np.ndarray:
    target_esi = annual["esi"].value_counts(normalize=True)
    fixture_esi = encounters["nurse_confirmed_esi"].value_counts(normalize=True)
    target_ins = annual["insurance_normalized"].value_counts(normalize=True)
    fixture_ins = encounters["insurance_normalized"].value_counts(normalize=True)
    weights = []
    for row in encounters.itertuples(index=False):
        esi_weight = target_esi.get(row.nurse_confirmed_esi, 0) / fixture_esi.get(row.nurse_confirmed_esi, 1)
        ins_weight = target_ins.get(row.insurance_normalized, 0) / fixture_ins.get(row.insurance_normalized, 1)
        weights.append(float(esi_weight * ins_weight))
    result = np.asarray(weights, dtype=float)
    return result / result.sum()


def arrival_probabilities(profile: str) -> np.ndarray:
    minute = np.arange(1440)
    hour = ((minute + 7 * 60) // 60) % 24
    if profile == "weekend":
        intensity = np.where((hour >= 8) & (hour < 22), 1.0, 0.55)
    else:
        morning = (hour >= 7) & (hour < 11)
        evening = (hour >= 16) & (hour < 21)
        night = (hour >= 23) | (hour < 7)
        if profile == "monday_peak":
            intensity = np.where(morning | evening, 2.00, np.where(night, 0.45, 1.00))
        else:
            intensity = np.where(morning, 1.55, np.where(evening, 1.50, np.where(night, 0.50, 1.00)))
    return intensity / intensity.sum()


def shift_for_timestamp(timestamp: pd.Timestamp) -> str:
    hour = timestamp.hour
    if 7 <= hour < 15:
        return "Day"
    if 15 <= hour < 23:
        return "Evening"
    return "Night"


def is_peak_timestamp(timestamp: pd.Timestamp) -> bool:
    return (7 <= timestamp.hour < 11) or (16 <= timestamp.hour < 21)


def _weighted_choice_without_replacement(
    rng: np.random.Generator, indices: np.ndarray, n: int, weights: np.ndarray
) -> np.ndarray:
    if n == 0:
        return np.array([], dtype=int)
    normalized = weights / weights.sum()
    return rng.choice(indices, size=n, replace=False, p=normalized)


def build_cohort(
    encounters: pd.DataFrame,
    annual: pd.DataFrame,
    day_name: str,
    params: ParameterCase,
    replicate: int,
    seed: int,
) -> pd.DataFrame:
    day = DAY_SCENARIOS[day_name]
    rng = np.random.default_rng(seed)
    n = int(day["patients"])
    # The 200-row fixture is a coverage set, not an observed one-day room mix.
    # Draw explicit room-type counts, then resample only profiles already
    # confirmed for that room type. No patient's room type is reclassified.
    base_weights = sampling_weights(encounters, annual, params)
    room_names = list(ROOM_CAPACITY)
    room_probabilities = np.array([params.room_mix()[room] for room in room_names], dtype=float)
    if not np.isclose(room_probabilities.sum(), 1.0):
        raise ValueError(f"Room-demand shares must sum to 1.0, got {room_probabilities.sum()}")
    room_counts = rng.multinomial(n, room_probabilities)
    sampled_parts = []
    for room_name, count in zip(room_names, room_counts):
        candidates = np.flatnonzero(encounters["required_room_type"].eq(room_name).to_numpy())
        if len(candidates) == 0:
            raise ValueError(f"No fixture profiles available for room type {room_name}")
        local_weights = base_weights[candidates]
        sampled_parts.append(
            rng.choice(candidates, size=int(count), replace=True, p=local_weights / local_weights.sum())
        )
    source_index = np.concatenate(sampled_parts)
    rng.shuffle(source_index)
    cohort = encounters.iloc[source_index].reset_index(drop=True).copy()
    cohort["source_visit_id"] = cohort["visit_id"]
    cohort["sim_patient_id"] = [f"{day_name}-R{replicate:02d}-P{i + 1:03d}" for i in range(n)]
    cohort["replicate"] = replicate
    cohort["day_scenario"] = day_name
    cohort["parameter_case"] = params.name
    start = pd.Timestamp(day["date"])
    arrival_minute = rng.choice(1440, size=n, replace=True, p=arrival_probabilities(day["profile"]))
    arrival_second = rng.integers(0, 60, size=n)
    cohort["arrival_time_sim"] = (
        start + pd.to_timedelta(arrival_minute, unit="m") + pd.to_timedelta(arrival_second, unit="s")
    )
    cohort["triage_completed_at_sim"] = (
        cohort["arrival_time_sim"]
        + pd.to_timedelta(cohort["source_triage_delay_min"].to_numpy(dtype=float), unit="m")
    )
    cohort["triage_minute"] = (
        (cohort["triage_completed_at_sim"] - start).dt.total_seconds() / 60
    )
    cohort["esi"] = cohort["nurse_confirmed_esi"].astype(int)
    cohort["insurance"] = cohort["insurance_normalized"]
    cohort["room_type"] = cohort["required_room_type"]
    cohort["has_mobile"] = [
        rng.random() < MOBILE_PROBABILITY_BY_INSURANCE.get(value, 0.80)
        for value in cohort["insurance"]
    ]

    # Preserve a separate 4% censored LWBS reference cohort in both paired runs.
    lwbs_n = round(n * 0.04)
    eligible = cohort.index[cohort["esi"].ge(2)].to_numpy()
    lwbs_weight = (
        cohort.loc[eligible, "esi"].map({2: 0.15, 3: 1.0, 4: 2.0, 5: 3.0}).to_numpy(dtype=float)
        * cohort.loc[eligible, "insurance"].map(
            {"Commercial": 0.8, "Medicaid_CHIP": 1.2, "Medicare": 1.0, "Uninsured": 1.5, "Other_Unspecified": 1.0}
        ).to_numpy(dtype=float)
    )
    lwbs_index = _weighted_choice_without_replacement(rng, eligible, lwbs_n, lwbs_weight)
    cohort["is_lwbs_reference"] = False
    cohort.loc[lwbs_index, "is_lwbs_reference"] = True
    annual_lwbs_elapsed = annual.loc[
        annual["baseline_lwbs"].eq(1), "w2_elapsed_until_exit_min"
    ].dropna().to_numpy(dtype=float)
    cohort["lwbs_elapsed_min"] = np.nan
    cohort.loc[lwbs_index, "lwbs_elapsed_min"] = rng.choice(
        annual_lwbs_elapsed, size=lwbs_n, replace=True
    )

    no_response = (
        (rng.random(n) < params.no_response_rate)
        & cohort["esi"].ge(2).to_numpy()
        & ~cohort["is_lwbs_reference"].to_numpy()
    )
    cohort["no_response_flag"] = no_response
    cohort["returns_within_30m"] = False
    response_indices = cohort.index[no_response]
    cohort.loc[response_indices, "returns_within_30m"] = (
        rng.random(len(response_indices)) < params.return_within_30m_probability
    )
    recall_choices = rng.choice([10.0, 20.0, 30.0], size=len(response_indices), p=[0.45, 0.35, 0.20])
    cohort["return_delay_min"] = np.nan
    cohort.loc[response_indices, "return_delay_min"] = recall_choices

    # Common to both paired modes. This represents non-room operational delay
    # (staff handoff/bed coordination) not quantified by the PDF. It prevents
    # an available physical room from being treated as the only W2 constraint.
    access_delay = rng.lognormal(
        mean=np.log(params.common_access_delay_median_min),
        sigma=params.common_access_delay_sigma,
        size=n,
    )
    cohort["common_access_delay_minutes"] = np.clip(
        access_delay,
        params.common_access_delay_median_min * 0.25,
        params.common_access_delay_median_min * 3.0,
    )

    service_duration = np.empty(n, dtype=float)
    for room_type in ROOM_CAPACITY:
        mask = cohort["room_type"].eq(room_type).to_numpy()
        mean = params.service_mean(room_type)
        sigma = params.service_lognormal_sigma
        mu = np.log(mean) - 0.5 * sigma**2
        values = rng.lognormal(mu, sigma, int(mask.sum()))
        service_duration[mask] = np.clip(values, mean * 0.35, mean * 2.50)
    boarding = np.where(
        cohort["admitted_synthetic"].astype(int).to_numpy() == 1,
        params.admitted_boarding_hold_min,
        0.0,
    )
    cohort["room_occupied_minutes"] = service_duration + params.turnover_minutes + boarding
    cohort["peak_hour"] = cohort["triage_completed_at_sim"].map(is_peak_timestamp)
    cohort["triage_shift"] = cohort["triage_completed_at_sim"].map(shift_for_timestamp)
    cohort["nurses_on_duty_total_triage_and_bedside"] = cohort["triage_shift"].map(NURSES_BY_SHIFT)
    return cohort


def select_initial_snapshot(resources: pd.DataFrame, winter: bool) -> pd.Series:
    boolean = resources["winter_surge_scenario"].astype(str).str.lower().eq("true")
    candidates = resources[boolean.eq(winter) & resources["shift"].eq("Day")].copy()
    timestamps = pd.to_datetime(candidates["snapshot_time"], utc=True)
    hour = timestamps.dt.hour
    return candidates.iloc[int(np.argmin(np.abs(hour - 12)))] if not (hour == 12).any() else candidates[hour == 12].iloc[0]


def initial_room_heaps(
    resources: pd.DataFrame,
    day_name: str,
    params: ParameterCase,
    seed: int,
) -> dict[str, list[tuple[float, str]]]:
    rng = np.random.default_rng(seed)
    snapshot = select_initial_snapshot(resources, bool(DAY_SCENARIOS[day_name]["winter"]))
    occupied_columns = {
        "REGULAR_ED": "ed_treatment_occupied",
        "FAST_TRACK": "fast_track_occupied",
        "RESUSCITATION_TRAUMA": "trauma_resus_occupied",
        "BEHAVIORAL_HEALTH": "behavioral_health_occupied",
    }
    heaps: dict[str, list[tuple[float, str]]] = {}
    for room_type, capacity in ROOM_CAPACITY.items():
        occupied = int(snapshot[occupied_columns[room_type]])
        mean = params.service_mean(room_type) + params.turnover_minutes
        release = rng.uniform(mean * 0.15, mean * 1.10, size=occupied)
        values = []
        for room_index in range(capacity):
            available_at = float(release[room_index]) if room_index < occupied else 0.0
            values.append((available_at, f"{ROOM_PREFIX[room_type]}-{room_index + 1:02d}"))
        heapq.heapify(values)
        heaps[room_type] = values
    return heaps


def _minutes_to_timestamp(start: pd.Timestamp, value: float | None) -> str | None:
    if value is None or pd.isna(value):
        return None
    return (start + pd.to_timedelta(float(value), unit="m")).isoformat()


def max_waiting_room_count(events: pd.DataFrame) -> int:
    changes: list[tuple[float, int]] = []
    for row in events.itertuples(index=False):
        changes.append((float(row.triage_minute), 1))
        if row.status == "ENTERED_ROOM":
            if pd.notna(row.first_unanswered_call_minute):
                changes.append((float(row.first_unanswered_call_minute), -1))
                changes.append((float(row.returned_minute), 1))
            changes.append((float(row.room_entered_minute), -1))
        elif row.status == "INACTIVE_AFTER_RECALL":
            changes.append((float(row.first_unanswered_call_minute), -1))
        elif row.status == "CENSORED_LWBS_REFERENCE":
            changes.append((float(row.departure_minute), -1))
    total = 0
    maximum = 0
    for _, change in sorted(changes, key=lambda item: (item[0], item[1])):
        total += change
        maximum = max(maximum, total)
    return maximum


def maximum_occupancy(intervals: list[tuple[float, float]], capacity: int) -> tuple[int, int]:
    sweep = []
    for start, end in intervals:
        sweep.append((start, 1))
        sweep.append((end, -1))
    occupied = 0
    maximum = 0
    for _, change in sorted(sweep, key=lambda item: (item[0], item[1])):
        occupied += change
        maximum = max(maximum, occupied)
    return maximum, int(maximum > capacity)


def simulate_process(
    cohort: pd.DataFrame,
    resources: pd.DataFrame,
    params: ParameterCase,
    mode: str,
    day_name: str,
    replicate: int,
    initial_seed: int,
) -> tuple[pd.DataFrame, dict]:
    if mode not in {"Baseline", "SeenSooner"}:
        raise ValueError(mode)
    start = pd.Timestamp(DAY_SCENARIOS[day_name]["date"])
    heaps = initial_room_heaps(resources, day_name, params, initial_seed)
    no_response_hold = (
        params.baseline_no_response_hold_min
        if mode == "Baseline"
        else params.intervention_reassignment_min
    )
    coordination_delay = (
        params.baseline_coordination_delay_min
        if mode == "Baseline"
        else params.intervention_coordination_delay_min
    )
    results: dict[int, dict] = {}
    room_intervals: dict[str, list[tuple[float, float]]] = {room: [] for room in ROOM_CAPACITY}
    initial_copy = initial_room_heaps(resources, day_name, params, initial_seed)
    for room_type, heap in initial_copy.items():
        for release, _ in heap:
            if release > 0:
                room_intervals[room_type].append((0.0, float(release)))

    for row_index, row in cohort[cohort["is_lwbs_reference"]].iterrows():
        departure = float(row["triage_minute"] + row["lwbs_elapsed_min"])
        results[row_index] = {
            "status": "CENSORED_LWBS_REFERENCE",
            "room_id": None,
            "room_called_minute": np.nan,
            "first_unanswered_call_minute": np.nan,
            "returned_minute": np.nan,
            "nurse_reassessed_minute": np.nan,
            "queue_reentered_minute": np.nan,
            "inactive_minute": np.nan,
            "room_entered_minute": np.nan,
            "room_release_minute": np.nan,
            "departure_minute": departure,
            "w2_minutes": np.nan,
            "no_response_idle_minutes": 0.0,
            "coordination_idle_minutes": 0.0,
        }

    for room_type in ROOM_CAPACITY:
        room_patients = cohort[
            cohort["room_type"].eq(room_type) & ~cohort["is_lwbs_reference"]
        ]
        state = {}
        active = set()
        for row_index, row in room_patients.iterrows():
            state[row_index] = {
                "ready": float(row["triage_minute"] + row["common_access_delay_minutes"]),
                "queue_since": float(row["triage_minute"]),
                "missed": False,
                "first_unanswered": np.nan,
                "returned": np.nan,
                "nurse_reassessed": np.nan,
            }
            active.add(row_index)

        while active:
            room_available, room_id = heapq.heappop(heaps[room_type])
            eligible = [idx for idx in active if state[idx]["ready"] <= room_available]
            if not eligible:
                next_ready = min(state[idx]["ready"] for idx in active)
                room_available = max(room_available, next_ready)
                eligible = [idx for idx in active if state[idx]["ready"] <= room_available]
            selected = min(
                eligible,
                key=lambda idx: (
                    int(cohort.at[idx, "esi"]),
                    float(state[idx]["queue_since"]),
                    str(cohort.at[idx, "sim_patient_id"]),
                ),
            )
            row = cohort.loc[selected]
            patient_state = state[selected]
            if bool(row["no_response_flag"]) and not patient_state["missed"]:
                patient_state["missed"] = True
                patient_state["first_unanswered"] = room_available
                heapq.heappush(heaps[room_type], (room_available + no_response_hold, room_id))
                if bool(row["returns_within_30m"]):
                    returned = room_available + float(row["return_delay_min"])
                    nurse_reassessed = returned + params.returned_nurse_reassessment_min
                    patient_state["returned"] = returned
                    patient_state["nurse_reassessed"] = nurse_reassessed
                    patient_state["ready"] = nurse_reassessed
                    # Safety fix: a returned patient is not automatically
                    # restored to the old queue timestamp. A nurse reassesses
                    # and confirms before a new queue-order time is assigned.
                    patient_state["queue_since"] = nurse_reassessed
                else:
                    results[selected] = {
                        "status": "INACTIVE_AFTER_RECALL",
                        "room_id": None,
                        "room_called_minute": np.nan,
                        "first_unanswered_call_minute": room_available,
                        "returned_minute": np.nan,
                        "nurse_reassessed_minute": np.nan,
                        "queue_reentered_minute": np.nan,
                        "inactive_minute": room_available + 30.0,
                        "room_entered_minute": np.nan,
                        "room_release_minute": np.nan,
                        "departure_minute": np.nan,
                        "w2_minutes": np.nan,
                        "no_response_idle_minutes": no_response_hold,
                        "coordination_idle_minutes": 0.0,
                    }
                    active.remove(selected)
                continue

            room_entered = room_available + coordination_delay
            room_release = room_entered + float(row["room_occupied_minutes"])
            heapq.heappush(heaps[room_type], (room_release, room_id))
            room_intervals[room_type].append((room_entered, room_release))
            results[selected] = {
                "status": "ENTERED_ROOM",
                "room_id": room_id,
                "room_called_minute": room_available,
                "first_unanswered_call_minute": patient_state["first_unanswered"],
                "returned_minute": patient_state["returned"],
                "nurse_reassessed_minute": patient_state["nurse_reassessed"],
                "queue_reentered_minute": patient_state["nurse_reassessed"],
                "inactive_minute": np.nan,
                "room_entered_minute": room_entered,
                "room_release_minute": room_release,
                "departure_minute": np.nan,
                "w2_minutes": room_entered - float(row["triage_minute"]),
                "no_response_idle_minutes": no_response_hold if patient_state["missed"] else 0.0,
                "coordination_idle_minutes": coordination_delay,
            }
            active.remove(selected)

    records = []
    for row_index, row in cohort.iterrows():
        result = results[row_index]
        records.append(
            {
                "sim_patient_id": row["sim_patient_id"],
                "source_visit_id": row["source_visit_id"],
                "replicate": replicate,
                "day_scenario": day_name,
                "parameter_case": params.name,
                "mode": mode,
                "arrival_time": row["arrival_time_sim"].isoformat(),
                "triage_completed_at": row["triage_completed_at_sim"].isoformat(),
                "triage_minute": row["triage_minute"],
                "peak_hour": bool(row["peak_hour"]),
                "triage_shift": row["triage_shift"],
                "nurses_on_duty_total_triage_and_bedside": row["nurses_on_duty_total_triage_and_bedside"],
                "esi": int(row["esi"]),
                "insurance": row["insurance"],
                "has_mobile": bool(row["has_mobile"]),
                "required_room_type": row["room_type"],
                "admitted_synthetic": int(row["admitted_synthetic"]),
                "no_response_flag": bool(row["no_response_flag"]),
                "returns_within_30m": bool(row["returns_within_30m"]),
                "room_occupied_minutes": row["room_occupied_minutes"],
                "common_access_delay_minutes": row["common_access_delay_minutes"],
                "status": result["status"],
                "lwbs_status": "CONFIRMED_LWBS_REFERENCE" if result["status"] == "CENSORED_LWBS_REFERENCE" else "NOT_LWBS",
                "room_id": result["room_id"],
                "room_called_at": _minutes_to_timestamp(start, result["room_called_minute"]),
                "first_unanswered_call_at": _minutes_to_timestamp(start, result["first_unanswered_call_minute"]),
                "returned_at": _minutes_to_timestamp(start, result["returned_minute"]),
                "nurse_reassessed_at": _minutes_to_timestamp(start, result["nurse_reassessed_minute"]),
                "queue_reentered_at": _minutes_to_timestamp(start, result["queue_reentered_minute"]),
                "queue_order_basis": (
                    "NURSE_REASSESSMENT_CONFIRMED_AT"
                    if pd.notna(result["queue_reentered_minute"])
                    else "TRIAGE_COMPLETED_AT"
                ),
                "inactive_at": _minutes_to_timestamp(start, result["inactive_minute"]),
                "room_entered_at": _minutes_to_timestamp(start, result["room_entered_minute"]),
                "room_released_at": _minutes_to_timestamp(start, result["room_release_minute"]),
                "departure_at": _minutes_to_timestamp(start, result["departure_minute"]),
                "room_called_minute": result["room_called_minute"],
                "first_unanswered_call_minute": result["first_unanswered_call_minute"],
                "returned_minute": result["returned_minute"],
                "nurse_reassessed_minute": result["nurse_reassessed_minute"],
                "queue_reentered_minute": result["queue_reentered_minute"],
                "room_entered_minute": result["room_entered_minute"],
                "departure_minute": result["departure_minute"],
                "w2_actual_minutes": result["w2_minutes"],
                "no_response_idle_minutes": result["no_response_idle_minutes"],
                "coordination_idle_minutes": result["coordination_idle_minutes"],
            }
        )
    events = pd.DataFrame(records)
    capacity_violations = 0
    max_occupied = {}
    for room_type, intervals in room_intervals.items():
        maximum, violation = maximum_occupancy(intervals, ROOM_CAPACITY[room_type])
        max_occupied[room_type] = maximum
        capacity_violations += violation
    validation = {
        "max_waiting_room_count": max_waiting_room_count(events),
        "waiting_room_overflow_max": max(0, max_waiting_room_count(events) - 40),
        "capacity_violations": capacity_violations,
        "max_occupied_by_room_type": json.dumps(max_occupied, sort_keys=True),
        "no_response_idle_minutes_total": events["no_response_idle_minutes"].sum(),
        "coordination_idle_minutes_total": events["coordination_idle_minutes"].sum(),
    }
    return events, validation


def paired_run(
    encounters: pd.DataFrame,
    resources: pd.DataFrame,
    annual: pd.DataFrame,
    day_name: str,
    params: ParameterCase,
    replicate: int,
    base_seed: int,
) -> tuple[pd.DataFrame, pd.DataFrame, dict, dict]:
    cohort_seed = base_seed + replicate * 1009 + sum(ord(c) for c in day_name) + sum(ord(c) for c in params.name) * 17
    initial_seed = cohort_seed + 53
    cohort = build_cohort(encounters, annual, day_name, params, replicate, cohort_seed)
    baseline, baseline_validation = simulate_process(
        cohort, resources, params, "Baseline", day_name, replicate, initial_seed
    )
    intervention, intervention_validation = simulate_process(
        cohort, resources, params, "SeenSooner", day_name, replicate, initial_seed
    )
    return baseline, intervention, baseline_validation, intervention_validation


def w2_metrics(events: pd.DataFrame, replicate_count: int) -> dict:
    entered = events[events["status"].eq("ENTERED_ROOM")]
    peak = entered[entered["peak_hour"]]
    lower_acuity = entered[entered["esi"].between(3, 5)]
    return {
        "completed_w2_n": len(entered),
        "median_w2_min": entered["w2_actual_minutes"].median(),
        "mean_w2_min": entered["w2_actual_minutes"].mean(),
        "p90_w2_min": entered["w2_actual_minutes"].quantile(0.90),
        "peak_hour_median_w2_min": peak["w2_actual_minutes"].median(),
        "esi_3_5_median_w2_min": lower_acuity["w2_actual_minutes"].median(),
        "w2_over_60_rate": entered["w2_actual_minutes"].gt(60).mean(),
        "no_response_idle_minutes_per_day": events.groupby("replicate")["no_response_idle_minutes"].sum().mean(),
        "coordination_idle_minutes_per_day": events.groupby("replicate")["coordination_idle_minutes"].sum().mean(),
        "inactive_not_lwbs_per_day": events["status"].eq("INACTIVE_AFTER_RECALL").sum() / replicate_count,
        "censored_lwbs_reference_per_day": events["status"].eq("CENSORED_LWBS_REFERENCE").sum() / replicate_count,
    }


def compare_metrics(baseline: pd.DataFrame, intervention: pd.DataFrame, replicate_count: int) -> pd.DataFrame:
    base = w2_metrics(baseline, replicate_count)
    seen = w2_metrics(intervention, replicate_count)
    kpis = [
        ("Median W2", "median_w2_min", "minutes"),
        ("Mean W2", "mean_w2_min", "minutes"),
        ("P90 W2", "p90_w2_min", "minutes"),
        ("Peak-hour Median W2", "peak_hour_median_w2_min", "minutes"),
        ("ESI 3-5 Median W2", "esi_3_5_median_w2_min", "minutes"),
        ("W2 over 60 minutes", "w2_over_60_rate", "proportion"),
        ("No-response resource idle", "no_response_idle_minutes_per_day", "minutes_per_day"),
    ]
    rows = []
    for label, key, unit in kpis:
        rows.append(
            {
                "scope": f"Neutral normal weekday; {replicate_count} paired replicates",
                "kpi": label,
                "unit": unit,
                "baseline": base[key],
                "seensooner": seen[key],
                "difference_seensooner_minus_baseline": seen[key] - base[key],
                "reduction_baseline_minus_seensooner": base[key] - seen[key],
            }
        )
    return pd.DataFrame(rows)


def fairness_comparison(baseline: pd.DataFrame, intervention: pd.DataFrame) -> pd.DataFrame:
    b = baseline[baseline["status"].eq("ENTERED_ROOM")].copy()
    s = intervention[intervention["status"].eq("ENTERED_ROOM")].copy()
    paired = b.merge(
        s[["sim_patient_id", "w2_actual_minutes"]],
        on="sim_patient_id",
        suffixes=("_baseline", "_seensooner"),
    )
    paired["reduction_minutes"] = (
        paired["w2_actual_minutes_baseline"] - paired["w2_actual_minutes_seensooner"]
    )
    paired["worsened"] = paired["reduction_minutes"].lt(0)
    paired["w2_increase_minutes"] = np.maximum(0.0, -paired["reduction_minutes"])
    paired["mobile_access"] = np.where(paired["has_mobile"], "HAS_MOBILE", "NO_MOBILE")
    rows = []
    for dimension, column in [
        ("ESI", "esi"),
        ("INSURANCE", "insurance"),
        ("MOBILE_ACCESS", "mobile_access"),
        ("ROOM_TYPE", "required_room_type"),
    ]:
        for value, group in paired.groupby(column):
            rows.append(
                {
                    "group_dimension": dimension,
                    "group_value": value,
                    "paired_completed_n": len(group),
                    "baseline_median_w2_min": group["w2_actual_minutes_baseline"].median(),
                    "seensooner_median_w2_min": group["w2_actual_minutes_seensooner"].median(),
                    "median_reduction_min": group["w2_actual_minutes_baseline"].median() - group["w2_actual_minutes_seensooner"].median(),
                    "baseline_mean_w2_min": group["w2_actual_minutes_baseline"].mean(),
                    "seensooner_mean_w2_min": group["w2_actual_minutes_seensooner"].mean(),
                    "mean_reduction_min": group["reduction_minutes"].mean(),
                    "p90_reduction_min": group["w2_actual_minutes_baseline"].quantile(0.90) - group["w2_actual_minutes_seensooner"].quantile(0.90),
                    "share_with_longer_w2_under_seensooner": group["worsened"].mean(),
                    "p95_w2_increase_among_all_paired_min": group["w2_increase_minutes"].quantile(0.95),
                    "maximum_w2_increase_min": group["w2_increase_minutes"].max(),
                }
            )
    return pd.DataFrame(rows)


def event_sample(baseline: pd.DataFrame, intervention: pd.DataFrame) -> pd.DataFrame:
    b = baseline[baseline["replicate"].eq(0)].sort_values("triage_completed_at").head(100)
    keep = [
        "sim_patient_id", "source_visit_id", "arrival_time", "triage_completed_at", "peak_hour",
        "esi", "insurance", "has_mobile", "required_room_type", "no_response_flag",
        "returns_within_30m", "status", "room_id", "first_unanswered_call_at", "returned_at",
        "nurse_reassessed_at", "queue_reentered_at", "queue_order_basis", "inactive_at",
        "room_called_at", "room_entered_at", "room_released_at", "departure_at",
        "common_access_delay_minutes", "w2_actual_minutes", "no_response_idle_minutes",
        "coordination_idle_minutes",
    ]
    merged = b[keep].merge(
        intervention[intervention["replicate"].eq(0)][keep],
        on=["sim_patient_id", "source_visit_id", "arrival_time", "triage_completed_at", "peak_hour", "esi", "insurance", "has_mobile", "required_room_type", "no_response_flag", "returns_within_30m"],
        suffixes=("_baseline", "_seensooner"),
    )
    merged["w2_reduction_minutes"] = (
        merged["w2_actual_minutes_baseline"] - merged["w2_actual_minutes_seensooner"]
    )
    return merged


def esi12_delay_audit(baseline: pd.DataFrame, intervention: pd.DataFrame) -> pd.DataFrame:
    """Patient-level safety audit for every paired ESI 1/2 room entry."""
    keep = [
        "sim_patient_id", "source_visit_id", "replicate", "esi", "required_room_type",
        "no_response_flag", "returns_within_30m", "status", "triage_completed_at",
        "first_unanswered_call_at", "returned_at", "nurse_reassessed_at",
        "queue_reentered_at", "queue_order_basis", "room_called_at", "room_entered_at",
        "w2_actual_minutes",
    ]
    b = baseline[baseline["esi"].isin([1, 2])][keep]
    s = intervention[intervention["esi"].isin([1, 2])][keep]
    paired = b.merge(
        s,
        on=[
            "sim_patient_id", "source_visit_id", "replicate", "esi", "required_room_type",
            "no_response_flag", "returns_within_30m", "triage_completed_at",
        ],
        suffixes=("_baseline", "_seensooner"),
    )
    paired["w2_change_seensooner_minus_baseline_min"] = (
        paired["w2_actual_minutes_seensooner"] - paired["w2_actual_minutes_baseline"]
    )
    paired["worsened_under_seensooner"] = paired[
        "w2_change_seensooner_minus_baseline_min"
    ].gt(0)
    paired["clinical_priority_changed_by_simulation"] = False
    paired["returned_requires_nurse_reassessment"] = np.where(
        paired["returned_at_seensooner"].notna(),
        paired["nurse_reassessed_at_seensooner"].notna()
        & paired["queue_order_basis_seensooner"].eq("NURSE_REASSESSMENT_CONFIRMED_AT"),
        True,
    )
    return paired.sort_values(
        ["w2_change_seensooner_minus_baseline_min", "esi"], ascending=[False, True]
    )


def assumptions_table(encounters: pd.DataFrame, annual: pd.DataFrame) -> pd.DataFrame:
    rows = [
        ("annual_ed_visits", "85000", "PDF fact", "Healthcare AI Hack the Case p.1", "Defines 233 average visits/day"),
        ("room_capacity", json.dumps(ROOM_CAPACITY), "PDF fact", "PDF p.1", "Four fixed room pools"),
        ("waiting_room_seats", "40", "PDF fact", "PDF p.1", "Overflow diagnostic only"),
        ("nurses_by_shift_total", json.dumps(NURSES_BY_SHIFT), "PDF fact", "PDF p.2", "Combined triage and bedside nurses; not treated as bedside-only capacity"),
        ("weekday_peaks", "morning and evening", "PDF fact", "PDF p.1", "Exact peak hours are an assumption below"),
        ("monday_busiest", "true", "PDF fact", "PDF p.1", "Magnitude not supplied"),
        ("winter_volume_multiplier", "1.20", "PDF fact", "PDF p.1", "Applied to 233 average daily visits"),
        ("baseline_lwbs", "0.04", "PDF fact / retained reference", "PDF p.2 and repaired 85k data", "Kept separate from W2 causal claims"),
        ("normal_day_volume", "233", "Derived synthetic setup", "85000 / 365", "Not an observed day"),
        ("monday_peak_volume", "256", "Simulation assumption", "233 x 1.10", "PDF says busiest but gives no multiplier"),
        ("weekend_volume", "210", "Simulation assumption", "233 x 0.90", "PDF gives no weekend multiplier"),
        ("peak_hour_definition", "07:00-10:59 and 16:00-20:59", "Simulation assumption", "Operational definition", "PDF gives no exact hours"),
        ("fixture_rescheduling", f"{len(encounters)} profiles resampled/re-timed", "Synthetic reference", "encounters_200_w2_scenario.csv", "Original 200 rows span multiple dates"),
        ("historical_synthetic_w2_median", f"{annual.w2_actual_minutes.median():.1f}", "Synthetic reference", "annual_85000_w2_model_ready.csv", "Not forced as DES output"),
        ("mobile_access", json.dumps(MOBILE_PROBABILITY_BY_INSURANCE), "Simulation assumption", "No phone/mobile field in source", "Does not affect priority, response flag, or intervention eligibility"),
        ("lwbs_censoring", "exactly 4% per simulated day", "Simulation assumption", "Retains separate baseline", "No completed W2 is created for these rows"),
        ("no_response_return_checks", "10/20/30 minutes; 45%/35%/20%", "Simulation assumption", "Team 30-minute recall rule", "Return timing distribution not in PDF"),
        ("returned_patient_queue_priority", "nurse reassessment required; queue time resets to reassessment confirmation", "Safety-conservative simulation rule", "User instruction", "No automatic restoration of original rank; ESI remains nurse-confirmed"),
        ("room_state_model", "Available/Occupied only", "Team rule", "User request", "Turnover is included in occupied duration"),
        ("queue_priority", "ESI ascending, then triage time ascending", "Team rule", "User request", "Clinical priority before wait time"),
        ("nurse_override", "preserved conceptually", "Team rule", "User request", "Simulation does not override ESI or room type"),
    ]
    for case in PARAMETER_CASES.values():
        for key, value in asdict(case).items():
            if key == "name":
                continue
            source = "PDF p.2/p.3 anchored" if key == "admitted_boarding_hold_min" else "No direct PDF value"
            rows.append((f"{case.name}.{key}", value, "Simulation assumption", source, "Sensitivity parameter"))
    return pd.DataFrame(rows, columns=["parameter", "value", "classification", "source", "use_or_note"])


def build_validation(
    encounters: pd.DataFrame,
    resources: pd.DataFrame,
    annual: pd.DataFrame,
    baseline: pd.DataFrame,
    intervention: pd.DataFrame,
    validations: list[dict],
) -> pd.DataFrame:
    checks = []
    def add(name: str, passed: bool, observed: object, expected: object) -> None:
        checks.append({"check": name, "status": "PASS" if passed else "FAIL", "observed": observed, "expected": expected})
    add("fixture_rows", len(encounters) == 200, len(encounters), 200)
    add("resource_snapshot_rows", len(resources) == 12, len(resources), 12)
    add("annual_rows", len(annual) == 85000, len(annual), 85000)
    add("annual_unique_ids", annual["visit_id"].nunique() == 85000, annual["visit_id"].nunique(), 85000)
    add("room_capacity_pdf", ROOM_CAPACITY == {"REGULAR_ED": 32, "FAST_TRACK": 8, "RESUSCITATION_TRAUMA": 4, "BEHAVIORAL_HEALTH": 4}, ROOM_CAPACITY, "32/8/4/4")
    add("nurse_staffing_pdf", NURSES_BY_SHIFT == {"Day": 14, "Evening": 14, "Night": 9}, NURSES_BY_SHIFT, "14/14/9")
    add("capacity_violations", sum(v["capacity_violations"] for v in validations) == 0, sum(v["capacity_violations"] for v in validations), 0)
    nonentered_w2 = pd.concat([baseline, intervention]).loc[lambda x: ~x["status"].eq("ENTERED_ROOM"), "w2_actual_minutes"].notna().sum()
    add("no_complete_w2_for_nonentered", nonentered_w2 == 0, int(nonentered_w2), 0)
    entered = pd.concat([baseline, intervention]).query("status == 'ENTERED_ROOM'").copy()
    recomputed = (
        pd.to_datetime(entered["room_entered_at"], utc=True, format="mixed")
        - pd.to_datetime(entered["triage_completed_at"], utc=True, format="mixed")
    ).dt.total_seconds() / 60
    max_error = float((recomputed - entered["w2_actual_minutes"]).abs().max())
    add("w2_formula_max_error", max_error < 1e-6, max_error, "<1e-6 minute")
    pair_cols = ["sim_patient_id", "arrival_time", "triage_completed_at", "esi", "required_room_type", "room_occupied_minutes", "common_access_delay_minutes", "no_response_flag"]
    pair_equal = baseline[pair_cols].sort_values("sim_patient_id").reset_index(drop=True).equals(intervention[pair_cols].sort_values("sim_patient_id").reset_index(drop=True))
    add("paired_inputs_identical", pair_equal, pair_equal, True)
    add("room_type_preserved", baseline["required_room_type"].isin(ROOM_CAPACITY).all(), sorted(baseline["required_room_type"].unique()), sorted(ROOM_CAPACITY))
    add("esi_range", baseline["esi"].between(1, 5).all(), f"{baseline.esi.min()}-{baseline.esi.max()}", "1-5")
    returned = pd.concat([baseline, intervention]).loc[lambda x: x["returned_at"].notna()]
    reassessed = (
        returned["nurse_reassessed_at"].notna()
        & returned["queue_reentered_at"].notna()
        & returned["queue_order_basis"].eq("NURSE_REASSESSMENT_CONFIRMED_AT")
    )
    add("returned_patient_nurse_reassessment_gate", reassessed.all(), int(reassessed.sum()), len(returned))
    pair_esi = baseline[["sim_patient_id", "esi"]].merge(
        intervention[["sim_patient_id", "esi"]], on="sim_patient_id", suffixes=("_b", "_s")
    )
    add("esi_never_changed_by_simulation", pair_esi["esi_b"].eq(pair_esi["esi_s"]).all(), int(pair_esi["esi_b"].ne(pair_esi["esi_s"]).sum()), 0)
    result = pd.DataFrame(checks)
    if result["status"].eq("FAIL").any():
        raise AssertionError(result[result["status"].eq("FAIL")].to_dict("records"))
    return result


def run_simulation(source_dir: Path, out_dir: Path, seed: int, primary_replicates: int, sensitivity_replicates: int) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    encounters, resources, annual = load_inputs(source_dir)
    assumptions_table(encounters, annual).to_csv(out_dir / "simulation_assumptions.csv", index=False)

    neutral_results: dict[str, tuple[pd.DataFrame, pd.DataFrame, list[dict]]] = {}
    for day_name in DAY_SCENARIOS:
        reps = 10 if day_name == "FIXTURE_200_VALIDATION" else primary_replicates
        baseline_parts = []
        intervention_parts = []
        validations = []
        for replicate in range(reps):
            b, s, bv, sv = paired_run(
                encounters, resources, annual, day_name, PARAMETER_CASES[PRIMARY_CASE], replicate, seed
            )
            baseline_parts.append(b)
            intervention_parts.append(s)
            validations.extend([bv, sv])
        neutral_results[day_name] = (
            pd.concat(baseline_parts, ignore_index=True),
            pd.concat(intervention_parts, ignore_index=True),
            validations,
        )

    primary_baseline, primary_intervention, primary_validations = neutral_results[PRIMARY_DAY]
    compare_metrics(primary_baseline, primary_intervention, primary_replicates).to_csv(
        out_dir / "baseline_vs_intervention.csv", index=False
    )
    fairness_comparison(primary_baseline, primary_intervention).to_csv(
        out_dir / "esi_fairness_comparison.csv", index=False
    )
    esi12_delay_audit(primary_baseline, primary_intervention).to_csv(
        out_dir / "esi12_extreme_delay_audit.csv", index=False
    )
    event_sample(primary_baseline, primary_intervention).to_csv(
        out_dir / "simulation_events_sample.csv", index=False
    )

    peak_rows = []
    for day_name, (baseline, intervention, validations) in neutral_results.items():
        reps = 10 if day_name == "FIXTURE_200_VALIDATION" else primary_replicates
        b = w2_metrics(baseline, reps)
        s = w2_metrics(intervention, reps)
        base_val = validations[0::2]
        seen_val = validations[1::2]
        peak_rows.append(
            {
                "day_scenario": day_name,
                "patients_per_replication": DAY_SCENARIOS[day_name]["patients"],
                "replicates": reps,
                "baseline_median_w2_min": b["median_w2_min"],
                "seensooner_median_w2_min": s["median_w2_min"],
                "median_reduction_min": b["median_w2_min"] - s["median_w2_min"],
                "baseline_mean_w2_min": b["mean_w2_min"],
                "seensooner_mean_w2_min": s["mean_w2_min"],
                "mean_reduction_min": b["mean_w2_min"] - s["mean_w2_min"],
                "baseline_p90_w2_min": b["p90_w2_min"],
                "seensooner_p90_w2_min": s["p90_w2_min"],
                "p90_reduction_min": b["p90_w2_min"] - s["p90_w2_min"],
                "baseline_peak_hour_median_w2_min": b["peak_hour_median_w2_min"],
                "seensooner_peak_hour_median_w2_min": s["peak_hour_median_w2_min"],
                "peak_hour_median_reduction_min": b["peak_hour_median_w2_min"] - s["peak_hour_median_w2_min"],
                "baseline_w2_over_60_rate": b["w2_over_60_rate"],
                "seensooner_w2_over_60_rate": s["w2_over_60_rate"],
                "baseline_no_response_idle_min_per_day": b["no_response_idle_minutes_per_day"],
                "seensooner_no_response_idle_min_per_day": s["no_response_idle_minutes_per_day"],
                "baseline_waiting_room_max_mean": np.mean([v["max_waiting_room_count"] for v in base_val]),
                "seensooner_waiting_room_max_mean": np.mean([v["max_waiting_room_count"] for v in seen_val]),
                "baseline_waiting_room_overflow_max": max(v["waiting_room_overflow_max"] for v in base_val),
                "seensooner_waiting_room_overflow_max": max(v["waiting_room_overflow_max"] for v in seen_val),
                "realized_room_mix_json": json.dumps(
                    baseline["required_room_type"].value_counts(normalize=True).round(4).to_dict(),
                    sort_keys=True,
                ),
            }
        )
    pd.DataFrame(peak_rows).to_csv(out_dir / "peak_hour_comparison.csv", index=False)

    sensitivity_rows = []
    sensitivity_days = ["NORMAL_WEEKDAY", "MONDAY_PEAK", "WEEKEND", "WINTER_SURGE"]
    for case_name, params in PARAMETER_CASES.items():
        for day_name in sensitivity_days:
            b_parts = []
            s_parts = []
            for replicate in range(sensitivity_replicates):
                b, s, _, _ = paired_run(
                    encounters, resources, annual, day_name, params, replicate, seed + 500000
                )
                b_parts.append(b)
                s_parts.append(s)
            baseline = pd.concat(b_parts, ignore_index=True)
            intervention = pd.concat(s_parts, ignore_index=True)
            b = w2_metrics(baseline, sensitivity_replicates)
            s = w2_metrics(intervention, sensitivity_replicates)
            sensitivity_rows.append(
                {
                    "parameter_case": case_name,
                    "day_scenario": day_name,
                    "patients_per_replication": DAY_SCENARIOS[day_name]["patients"],
                    "replicates": sensitivity_replicates,
                    "no_response_rate": params.no_response_rate,
                    "baseline_no_response_hold_min": params.baseline_no_response_hold_min,
                    "seensooner_reassignment_min": params.intervention_reassignment_min,
                    "baseline_coordination_delay_min": params.baseline_coordination_delay_min,
                    "seensooner_coordination_delay_min": params.intervention_coordination_delay_min,
                    "turnover_minutes": params.turnover_minutes,
                    "regular_service_mean_min": params.regular_service_mean_min,
                    "fast_track_service_mean_min": params.fast_track_service_mean_min,
                    "trauma_service_mean_min": params.trauma_service_mean_min,
                    "behavioral_service_mean_min": params.behavioral_service_mean_min,
                    "returned_nurse_reassessment_min": params.returned_nurse_reassessment_min,
                    "common_access_delay_median_min": params.common_access_delay_median_min,
                    "regular_room_share": params.regular_room_share,
                    "fast_track_room_share": params.fast_track_room_share,
                    "trauma_room_share": params.trauma_room_share,
                    "behavioral_room_share": params.behavioral_room_share,
                    "baseline_median_w2_min": b["median_w2_min"],
                    "seensooner_median_w2_min": s["median_w2_min"],
                    "median_reduction_min": b["median_w2_min"] - s["median_w2_min"],
                    "baseline_mean_w2_min": b["mean_w2_min"],
                    "seensooner_mean_w2_min": s["mean_w2_min"],
                    "mean_reduction_min": b["mean_w2_min"] - s["mean_w2_min"],
                    "baseline_p90_w2_min": b["p90_w2_min"],
                    "seensooner_p90_w2_min": s["p90_w2_min"],
                    "p90_reduction_min": b["p90_w2_min"] - s["p90_w2_min"],
                    "baseline_w2_over_60_rate": b["w2_over_60_rate"],
                    "seensooner_w2_over_60_rate": s["w2_over_60_rate"],
                    "baseline_no_response_idle_min_per_day": b["no_response_idle_minutes_per_day"],
                    "seensooner_no_response_idle_min_per_day": s["no_response_idle_minutes_per_day"],
                }
            )
    pd.DataFrame(sensitivity_rows).to_csv(out_dir / "sensitivity_analysis.csv", index=False)

    lwbs_rows = []
    for day_name, (baseline, intervention, _) in neutral_results.items():
        for mode, events in [("Baseline", baseline), ("SeenSooner", intervention)]:
            censored = events[events["status"].eq("CENSORED_LWBS_REFERENCE")]
            elapsed = (
                pd.to_datetime(censored["departure_at"], utc=True, format="mixed")
                - pd.to_datetime(censored["triage_completed_at"], utc=True, format="mixed")
            ).dt.total_seconds() / 60
            lwbs_rows.append(
                {
                    "day_scenario": day_name,
                    "mode": mode,
                    "censored_lwbs_n": len(censored),
                    "censored_lwbs_rate": len(censored) / len(events),
                    "median_w2_elapsed_until_exit_min": elapsed.median(),
                    "complete_w2_values_fabricated": int(censored["w2_actual_minutes"].notna().sum()),
                    "causal_lwbs_reduction_claimed": False,
                }
            )
    pd.DataFrame(lwbs_rows).to_csv(out_dir / "lwbs_censored_summary.csv", index=False)

    all_neutral_baseline = pd.concat([value[0] for value in neutral_results.values()], ignore_index=True)
    all_neutral_intervention = pd.concat([value[1] for value in neutral_results.values()], ignore_index=True)
    all_validations = [item for value in neutral_results.values() for item in value[2]]
    build_validation(
        encounters, resources, annual, all_neutral_baseline, all_neutral_intervention, all_validations
    ).to_csv(out_dir / "simulation_validation_checks.csv", index=False)

    metadata = {
        "synthetic_only": True,
        "paired_random_seed": seed,
        "primary_replicates": primary_replicates,
        "sensitivity_replicates": sensitivity_replicates,
        "primary_parameter_case": PRIMARY_CASE,
        "primary_day_scenario": PRIMARY_DAY,
        "w2_definition": "room_entered_at - triage_completed_at",
        "room_called_is_not_w2_endpoint": True,
        "models_retrained": False,
        "clinical_priority": "ESI ascending, then longest waiting within same ESI",
        "room_type_changed_by_simulation": False,
        "returned_patient_queue_rule": "nurse reassessment required; new queue timestamp is reassessment confirmation",
        "room_demand_mix_warning": "Room demand shares are explicit simulation assumptions; the 200-person fixture is coverage data, not an observed daily mix.",
        "lwbs_warning": "4% is a separate censored reference cohort. No W2-to-LWBS causal effect is estimated.",
    }
    (out_dir / "simulation_metadata.json").write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print("Simulation complete")
    print(compare_metrics(primary_baseline, primary_intervention, primary_replicates).to_string(index=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", default="source_data")
    parser.add_argument("--out-dir", default="outputs")
    parser.add_argument("--seed", type=int, default=BASE_SEED)
    parser.add_argument("--primary-replicates", type=int, default=30)
    parser.add_argument("--sensitivity-replicates", type=int, default=15)
    args = parser.parse_args()
    run_simulation(
        Path(args.source_dir),
        Path(args.out_dir),
        args.seed,
        args.primary_replicates,
        args.sensitivity_replicates,
    )
