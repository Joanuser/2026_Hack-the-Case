#!/usr/bin/env python3
"""SeenSooner Smart Routing + LWBS Prevention conditional projections.

This is a transparent what-if calculator, not a causal or capacity-constrained
simulation. The source project and prior analyses are read-only. All efficacy
inputs come from scenario_config.json and are labeled hypothetical.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


ARMS = (
    ("Baseline", False, False),
    ("Routing Only", True, False),
    ("Outreach Only", False, True),
    ("Combined", True, True),
)
LONG_WAIT_MIN = 60.0
REAL_EFFECT_STATUS = "NOT_IDENTIFIABLE"
CLINICAL_SAFETY_STATUS = "NOT_VERIFIABLE"
PROJECTION_TAG = "HYPOTHETICAL_SCENARIO_PROJECTION_NOT_OBSERVED_HOSPITAL_OUTCOME"
ROOM_CAPACITY = {
    "REGULAR_ED": 32,
    "FAST_TRACK": 8,
    "RESUSCITATION_TRAUMA": 4,
    "BEHAVIORAL_HEALTH": 4,
}


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def snapshot_tree(project_root: Path) -> dict[str, str]:
    return {
        path.relative_to(project_root).as_posix(): file_sha256(path)
        for path in sorted(project_root.rglob("*"))
        if path.is_file()
    }


def load_config(path: Path) -> dict[str, Any]:
    config = json.loads(path.read_text(encoding="utf-8"))
    required_sets = {"strict_zero", "conservative", "neutral", "more_optimistic"}
    sets = {item["name"] for item in config["assumption_sets"]}
    if not required_sets.issubset(sets):
        raise ValueError(f"Missing required assumption sets: {sorted(required_sets - sets)}")
    if config["default_assumption_set"] not in sets:
        raise ValueError("default_assumption_set not found")
    for item in config["assumption_sets"]:
        for key in [
            "routing_avoidable_w_fraction",
            "outreach_lwbs_retention_fraction",
            "routing_lwbs_prevention_fraction",
        ]:
            value = float(item[key])
            if not 0.0 <= value <= 1.0:
                raise ValueError(f"{item['name']}.{key} must be in [0,1]")
        if item["evidence_status"] != "HYPOTHETICAL_INPUT_NOT_EVIDENCE":
            raise ValueError("Every efficacy assumption must be explicitly hypothetical")
    return config


def config_set(config: dict[str, Any], name: str) -> dict[str, Any]:
    return next(item for item in config["assumption_sets"] if item["name"] == name)


def load_annual(project_root: Path) -> pd.DataFrame:
    path = project_root / "simulation" / "source_data" / "annual_85000_w2_model_ready.csv"
    frame = pd.read_csv(path)
    for column in ["triage_completed_at", "room_entered_at", "departure_at"]:
        frame[f"_{column}"] = pd.to_datetime(frame[column], errors="coerce")
    frame["esi"] = pd.to_numeric(frame["esi"], errors="raise").astype(int)
    frame["winter"] = pd.to_numeric(frame["winter"], errors="raise").astype(int)
    frame["baseline_seen"] = pd.to_numeric(frame["baseline_seen"], errors="raise").astype(int)
    frame["baseline_lwbs"] = pd.to_numeric(frame["baseline_lwbs"], errors="raise").astype(int)
    frame["historical_w_min"] = (
        frame["_room_entered_at"] - frame["_triage_completed_at"]
    ).dt.total_seconds() / 60.0
    if len(frame) != 85000:
        raise ValueError(f"Expected 85,000 rows, found {len(frame)}")
    if int(frame["baseline_seen"].sum()) != 81600:
        raise ValueError("Expected 81,600 historically roomed patients")
    if int(frame["baseline_lwbs"].sum()) != 3400:
        raise ValueError("Expected 3,400 historical LWBS patients")
    if frame.loc[frame["baseline_seen"].eq(1), "historical_w_min"].isna().any():
        raise ValueError("Every historically roomed patient must have observed W")
    if frame.loc[frame["baseline_lwbs"].eq(1), "historical_w_min"].notna().any():
        raise ValueError("Historical LWBS patients must not be assigned W")
    if (frame.loc[frame["baseline_seen"].eq(1), "historical_w_min"] <= 0).any():
        raise ValueError("Observed W must be positive")
    return frame


def load_model_reference(prior_analysis_dir: Path | None) -> dict[str, object]:
    result: dict[str, object] = {
        "status": "NOT_AVAILABLE",
        "w_mae_min": np.nan,
        "lwbs_auc": np.nan,
        "lwbs_threshold": np.nan,
        "lwbs_test_positive_n": np.nan,
        "lwbs_test_tp": np.nan,
        "lwbs_test_fn": np.nan,
        "lwbs_test_recall": np.nan,
        "lwbs_test_precision": np.nan,
    }
    if prior_analysis_dir is None:
        return result
    w_path = prior_analysis_dir / "03_w_model_metrics.csv"
    l_path = prior_analysis_dir / "04_lwbs_model_metrics.csv"
    if not w_path.is_file() or not l_path.is_file():
        return result
    w = pd.read_csv(w_path)
    l = pd.read_csv(l_path)
    w_row = w[
        w["section"].eq("overall_test")
        & w["model"].eq("simple_hist_gradient_boosting")
    ]
    l_row = l[
        l["section"].eq("overall_test")
        & l["model"].eq("simple_logistic_regression")
    ]
    if len(w_row) != 1 or len(l_row) != 1:
        return result
    wr = w_row.iloc[0]
    lr = l_row.iloc[0]
    result.update(
        {
            "status": "AVAILABLE_HELD_OUT_PREDICTION_REFERENCE_ONLY",
            "w_mae_min": float(wr["mae_min"]),
            "lwbs_auc": float(lr["roc_auc"]),
            "lwbs_threshold": float(lr["threshold_from_calibration_f1"]),
            "lwbs_test_positive_n": int(lr["positive_n"]),
            "lwbs_test_tp": int(lr["tp"]),
            "lwbs_test_fn": int(lr["fn"]),
            "lwbs_test_recall": float(lr["sensitivity"]),
            "lwbs_test_precision": float(lr["precision"]),
        }
    )
    return result


def group_masks(annual: pd.DataFrame) -> dict[str, tuple[np.ndarray, str]]:
    winter = annual["winter"].eq(1).to_numpy()
    monday = annual["weekday"].eq("Monday").to_numpy()
    esi35 = annual["esi"].isin([3, 4, 5]).to_numpy()
    return {
        "ALL": (np.ones(len(annual), dtype=bool), "all original annual records"),
        "ESI3_5": (esi35, "source ESI 3-5 records"),
        "NORMAL_DAY": (~winter & ~monday, "source non-winter, non-Monday records"),
        "MONDAY_PEAK": (monday, "source Monday records; no added arrivals"),
        "WINTER_PEAK": (winter, "source winter=1 records; no added arrivals"),
    }


def _metric(values: np.ndarray, name: str) -> float:
    if len(values) == 0:
        return float("nan")
    if name == "mean":
        return float(np.mean(values))
    if name == "median":
        return float(np.median(values))
    if name == "p90":
        return float(np.quantile(values, 0.90))
    raise ValueError(name)


def _relative_reduction(baseline: float, projected: float) -> float:
    if not np.isfinite(baseline) or not np.isfinite(projected):
        return float("nan")
    if abs(baseline) < 1e-12:
        return 0.0 if abs(projected) < 1e-12 else float("nan")
    return float((baseline - projected) / baseline * 100.0)


def project_arm(
    annual: pd.DataFrame,
    group_mask: np.ndarray,
    group_name: str,
    group_definition: str,
    assumption: dict[str, Any],
    arm_name: str,
    routing_on: bool,
    outreach_on: bool,
    routing_eligible_esi: list[int],
) -> dict[str, object]:
    seen_mask = group_mask & annual["baseline_seen"].eq(1).to_numpy()
    w_base = annual.loc[seen_mask, "historical_w_min"].to_numpy(dtype=float)
    w_projected = w_base.copy()
    seen_positions = np.flatnonzero(seen_mask)
    eligible_in_seen = annual.iloc[seen_positions]["esi"].isin(routing_eligible_esi).to_numpy()

    routing_w_fraction = float(assumption["routing_avoidable_w_fraction"]) if routing_on else 0.0
    if routing_w_fraction > 0:
        w_projected[eligible_in_seen] *= 1.0 - routing_w_fraction
    routing_w_affected_n = int(eligible_in_seen.sum()) if routing_w_fraction > 0 else 0

    baseline_lwbs_n = float(annual.loc[group_mask, "baseline_lwbs"].sum())
    routing_lwbs_fraction = (
        float(assumption["routing_lwbs_prevention_fraction"]) if routing_on else 0.0
    )
    outreach_fraction = (
        float(assumption["outreach_lwbs_retention_fraction"]) if outreach_on else 0.0
    )
    routing_lwbs_prevented = baseline_lwbs_n * routing_lwbs_fraction
    remaining_after_routing = baseline_lwbs_n - routing_lwbs_prevented
    outreach_lwbs_prevented = remaining_after_routing * outreach_fraction
    total_lwbs_prevented = routing_lwbs_prevented + outreach_lwbs_prevented
    projected_lwbs_n = baseline_lwbs_n - total_lwbs_prevented
    denominator = int(group_mask.sum())

    row: dict[str, object] = {
        "assumption_set": assumption["name"],
        "assumption_label_en": assumption["label_en"],
        "group": group_name,
        "group_definition": group_definition,
        "arm": arm_name,
        "routing_enabled": routing_on,
        "outreach_enabled": outreach_on,
        "routing_avoidable_w_fraction_input": routing_w_fraction,
        "outreach_lwbs_retention_fraction_input": outreach_fraction,
        "routing_lwbs_prevention_fraction_input": routing_lwbs_fraction,
        "total_patient_n": denominator,
        "w_metric_cohort_n_historically_roomed": int(seen_mask.sum()),
        "routing_w_eligible_n": int(eligible_in_seen.sum()),
        "routing_w_affected_n": routing_w_affected_n,
        "lwbs_rate_denominator_n": denominator,
        "baseline_lwbs_n": int(baseline_lwbs_n),
        "routing_expected_lwbs_prevented_n": routing_lwbs_prevented,
        "outreach_expected_lwbs_prevented_after_dedup_n": outreach_lwbs_prevented,
        "total_expected_lwbs_prevented_n": total_lwbs_prevented,
        "projected_expected_lwbs_n": projected_lwbs_n,
        "total_scenario_affected_n": routing_w_affected_n + total_lwbs_prevented,
        "w_denominator_note": "historically roomed paired cohort only; historical LWBS receive no projected W",
        "lwbs_denominator_note": "all original patients in group",
    }
    for metric in ["mean", "median", "p90"]:
        baseline_value = _metric(w_base, metric)
        projected_value = _metric(w_projected, metric)
        row[f"baseline_w_{metric}_min"] = baseline_value
        row[f"projected_w_{metric}_min"] = projected_value
        row[f"w_{metric}_reduction_min"] = baseline_value - projected_value
        row[f"w_{metric}_reduction_pct"] = _relative_reduction(
            baseline_value, projected_value
        )

    baseline_long = float(np.mean(w_base > LONG_WAIT_MIN)) if len(w_base) else float("nan")
    projected_long = (
        float(np.mean(w_projected > LONG_WAIT_MIN)) if len(w_projected) else float("nan")
    )
    baseline_lwbs_rate = baseline_lwbs_n / denominator if denominator else float("nan")
    projected_lwbs_rate = projected_lwbs_n / denominator if denominator else float("nan")
    row.update(
        {
            "long_wait_definition_min": LONG_WAIT_MIN,
            "baseline_long_wait_rate_pct_of_w_cohort": baseline_long * 100.0,
            "projected_long_wait_rate_pct_of_w_cohort": projected_long * 100.0,
            "long_wait_reduction_pp": (baseline_long - projected_long) * 100.0,
            "long_wait_reduction_pct": _relative_reduction(baseline_long, projected_long),
            "baseline_lwbs_rate_pct": baseline_lwbs_rate * 100.0,
            "projected_lwbs_rate_pct": projected_lwbs_rate * 100.0,
            "lwbs_reduction_pp": (baseline_lwbs_rate - projected_lwbs_rate) * 100.0,
            "lwbs_reduction_pct": _relative_reduction(
                baseline_lwbs_rate, projected_lwbs_rate
            ),
            "projection_evidence_tag": (
                "SOURCE_DERIVED_SYNTHETIC_HISTORY"
                if arm_name == "Baseline"
                else PROJECTION_TAG
            ),
            "efficacy_inputs_evidence_status": (
                "NOT_APPLICABLE_BASELINE"
                if arm_name == "Baseline"
                else "HYPOTHETICAL_INPUT_NOT_EVIDENCE"
            ),
            "real_intervention_effect_status": REAL_EFFECT_STATUS,
            "clinical_safety_status": CLINICAL_SAFETY_STATUS,
            "capacity_validation_status": "NOT_A_VALIDATED_CAPACITY_CONSTRAINED_SIMULATION",
            "fabricated_room_entered_at_created": False,
            "historical_lwbs_assigned_projected_w": False,
        }
    )
    return row


def build_four_arms(
    annual: pd.DataFrame, config: dict[str, Any]
) -> pd.DataFrame:
    assumption = config_set(config, config["default_assumption_set"])
    mask, definition = group_masks(annual)["ALL"]
    rows = [
        project_arm(
            annual,
            mask,
            "ALL",
            definition,
            assumption,
            arm_name,
            routing_on,
            outreach_on,
            list(config["routing_w_eligible_esi"]),
        )
        for arm_name, routing_on, outreach_on in ARMS
    ]
    return pd.DataFrame(rows)


def build_sensitivity_grid(
    annual: pd.DataFrame, config: dict[str, Any]
) -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    for assumption in config["assumption_sets"]:
        for group_name, (mask, definition) in group_masks(annual).items():
            for arm_name, routing_on, outreach_on in ARMS:
                rows.append(
                    project_arm(
                        annual,
                        mask,
                        group_name,
                        definition,
                        assumption,
                        arm_name,
                        routing_on,
                        outreach_on,
                        list(config["routing_w_eligible_esi"]),
                    )
                )
    return pd.DataFrame(rows)


def build_assumption_register(
    annual: pd.DataFrame,
    config: dict[str, Any],
    model_reference: dict[str, object],
) -> pd.DataFrame:
    sets = {
        item["name"]: {
            "routing_w": item["routing_avoidable_w_fraction"],
            "outreach_lwbs": item["outreach_lwbs_retention_fraction"],
            "routing_lwbs": item["routing_lwbs_prevention_fraction"],
        }
        for item in config["assumption_sets"]
    }
    rows = [
        (
            "F01",
            "FACT",
            "historical_cohort",
            f"n={len(annual)}; roomed={int(annual['baseline_seen'].sum())}; LWBS={int(annual['baseline_lwbs'].sum())}",
            "annual_85000_w2_model_ready.csv",
            "DIRECT_SYNTHETIC_HISTORY",
            True,
            "Not an observed hospital intervention outcome.",
        ),
        (
            "F02",
            "FACT",
            "room_capacity",
            json.dumps(ROOM_CAPACITY, sort_keys=True),
            "case PDF and resource_snapshots_12.csv",
            "DIRECT_CASE_FACT",
            True,
            "Capacity is unchanged but is not operationally simulated in this projection.",
        ),
        (
            "F03",
            "PREDICTION_REFERENCE",
            "model_performance",
            json.dumps(model_reference, sort_keys=True),
            "analysis_w_lwbs held-out outputs",
            "PREDICTION_NOT_INTERVENTION",
            True,
            "Recall is alert coverage in a held-out test set, not outreach reach or retention success.",
        ),
        (
            "H01",
            "WHAT_IF_INPUT",
            "routing_avoidable_w_fraction",
            json.dumps(sets, sort_keys=True),
            "scenario_config.json",
            "HYPOTHETICAL_INPUT_NOT_EVIDENCE",
            False,
            "Applied only to observed W of historically roomed ESI 3-5; no room event is created.",
        ),
        (
            "H02",
            "WHAT_IF_INPUT",
            "outreach_lwbs_retention_fraction",
            json.dumps(sets, sort_keys=True),
            "scenario_config.json",
            "HYPOTHETICAL_INPUT_NOT_EVIDENCE",
            False,
            "Not derived from AUC, recall, or an observed nurse outreach program.",
        ),
        (
            "H03",
            "WHAT_IF_INPUT",
            "routing_lwbs_prevention_fraction",
            json.dumps(sets, sort_keys=True),
            "scenario_config.json",
            "HYPOTHETICAL_INPUT_NOT_EVIDENCE",
            False,
            "Primary sets use zero; 5% and 10% appear only as separate sensitivity assumptions.",
        ),
        (
            "M01",
            "METHOD",
            "combined_lwbs_deduplication",
            config["combined_lwbs_deduplication"],
            "analysis design",
            "FORMULA_NOT_EFFECT_EVIDENCE",
            True,
            "Outreach retention is applied only to historical LWBS remaining after hypothetical routing prevention.",
        ),
        (
            "M02",
            "METHOD",
            "metric_denominators",
            "W: historically roomed paired cohort; LWBS: all original patients in group",
            "task definition",
            "DIRECT_METHOD_RULE",
            True,
            "Hypothetically retained LWBS patients are not assigned W or room timestamps.",
        ),
        (
            "S01",
            "SAFETY_BOUNDARY",
            "esi12",
            "Routing W projection excludes ESI 1/2 and never increases their mathematical W.",
            "scenario_config.json and code guard",
            "MATH_CHECK_ONLY",
            True,
            "Clinical safety remains NOT_VERIFIABLE; this is not SAFETY_PASS_FOR_DEPLOYMENT.",
        ),
        (
            "L01",
            "LIMITATION",
            "physical_resource_conservation",
            "No patient-room ready/assign/release replay is performed.",
            "analysis_smart_routing finding",
            "NOT_IDENTIFIABLE",
            False,
            "Conditional projection, not a validated capacity-constrained simulation.",
        ),
        (
            "L02",
            "LIMITATION",
            "patient_level_success_identity",
            "No specific historical LWBS patient is relabeled, retained, or assigned a room.",
            "analysis design",
            "NOT_IDENTIFIABLE",
            False,
            "Reported prevented counts are expected scenario counts only.",
        ),
    ]
    return pd.DataFrame(
        rows,
        columns=[
            "assumption_id",
            "type",
            "parameter",
            "value_or_rule",
            "source",
            "evidence_status",
            "identifiable_or_verifiable",
            "limitation",
        ],
    )


def build_safety_summary(
    annual: pd.DataFrame, config: dict[str, Any]
) -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    masks = group_masks(annual)
    for assumption in config["assumption_sets"]:
        for arm_name, routing_on, outreach_on in ARMS:
            for esi in [1, 2]:
                mask = annual["esi"].eq(esi).to_numpy()
                projection = project_arm(
                    annual,
                    mask,
                    f"ESI{esi}",
                    f"source ESI {esi}",
                    assumption,
                    arm_name,
                    routing_on,
                    outreach_on,
                    list(config["routing_w_eligible_esi"]),
                )
                seen = mask & annual["baseline_seen"].eq(1).to_numpy()
                historical_w = annual.loc[seen, "historical_w_min"].to_numpy(dtype=float)
                rows.append(
                    {
                        "assumption_set": assumption["name"],
                        "arm": arm_name,
                        "esi": esi,
                        "patient_n": int(mask.sum()),
                        "historically_roomed_n": int(seen.sum()),
                        "historical_lwbs_n": int(annual.loc[mask, "baseline_lwbs"].sum()),
                        "baseline_w_mean_min": float(np.mean(historical_w)),
                        "projected_w_mean_min": float(np.mean(historical_w)),
                        "baseline_w_median_min": float(np.median(historical_w)),
                        "projected_w_median_min": float(np.median(historical_w)),
                        "baseline_w_p90_min": float(np.quantile(historical_w, 0.90)),
                        "projected_w_p90_min": float(np.quantile(historical_w, 0.90)),
                        "max_patient_level_w_increase_min": 0.0,
                        "any_mathematical_w_increase": False,
                        "esi_modified": False,
                        "risk_based_queue_jump_allowed": False,
                        "patient_level_retention_identity_assigned": False,
                        "expected_lwbs_prevented_n_not_patient_assigned": projection[
                            "total_expected_lwbs_prevented_n"
                        ],
                        "math_non_worsening_check": True,
                        "clinical_safety_status": CLINICAL_SAFETY_STATUS,
                        "deployment_safety_pass": False,
                        "reason": (
                            "Scenario code excludes ESI 1/2 from W reduction and never increases W, "
                            "but linked room, clinical-path, override, and outreach logs are absent."
                        ),
                    }
                )
    return pd.DataFrame(rows)


def build_source_integrity(
    before: dict[str, str], after: dict[str, str]
) -> pd.DataFrame:
    rows = []
    for relative in sorted(set(before) | set(after)):
        before_hash = before.get(relative, "MISSING")
        after_hash = after.get(relative, "MISSING")
        rows.append(
            {
                "relative_path": relative,
                "sha256_before": before_hash,
                "sha256_after": after_hash,
                "unchanged": before_hash == after_hash,
            }
        )
    return pd.DataFrame(rows)


def _fmt(value: object, digits: int = 2) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "NA"
    return "NA" if not np.isfinite(number) else f"{number:.{digits}f}"


def write_summary(
    path: Path,
    four_arms: pd.DataFrame,
    sensitivity: pd.DataFrame,
    model_reference: dict[str, object],
    safety: pd.DataFrame,
    integrity: pd.DataFrame,
) -> None:
    rows = []
    for row in four_arms.itertuples(index=False):
        rows.append(
            f"| {row.arm} | {row.projected_w_mean_min:.2f} / {row.projected_w_median_min:.2f} / "
            f"{row.projected_w_p90_min:.2f} | {row.w_mean_reduction_min:.2f} / "
            f"{row.w_median_reduction_min:.2f} / {row.w_p90_reduction_min:.2f} | "
            f"{row.projected_long_wait_rate_pct_of_w_cohort:.2f}% | "
            f"{row.projected_lwbs_rate_pct:.2f}% | {row.lwbs_reduction_pp:.2f} pp | "
            f"{row.routing_w_affected_n} / {row.total_expected_lwbs_prevented_n:.0f} |"
        )
    combined_sensitivity = sensitivity[
        sensitivity["group"].eq("ALL") & sensitivity["arm"].eq("Combined")
    ]
    sensitivity_rows = []
    for row in combined_sensitivity.itertuples(index=False):
        sensitivity_rows.append(
            f"| {row.assumption_set} | {row.routing_avoidable_w_fraction_input:.0%} | "
            f"{row.outreach_lwbs_retention_fraction_input:.0%} | "
            f"{row.routing_lwbs_prevention_fraction_input:.0%} | "
            f"{row.w_mean_reduction_min:.2f} / {row.w_median_reduction_min:.2f} / "
            f"{row.w_p90_reduction_min:.2f} | {row.projected_lwbs_rate_pct:.2f}% | "
            f"{row.lwbs_reduction_pp:.2f} pp | {row.total_expected_lwbs_prevented_n:.0f} |"
        )
    neutral_groups = sensitivity[
        sensitivity["assumption_set"].eq("neutral")
        & sensitivity["arm"].eq("Combined")
    ]
    group_rows = []
    for row in neutral_groups.itertuples(index=False):
        group_rows.append(
            f"| {row.group} | {row.total_patient_n} | {row.w_metric_cohort_n_historically_roomed} | "
            f"{row.w_mean_reduction_min:.2f} / {row.w_median_reduction_min:.2f} / "
            f"{row.w_p90_reduction_min:.2f} | {row.baseline_lwbs_rate_pct:.2f}% → "
            f"{row.projected_lwbs_rate_pct:.2f}% | {row.lwbs_reduction_pp:.2f} pp |"
        )

    baseline = four_arms[four_arms["arm"].eq("Baseline")].iloc[0]
    routing = four_arms[four_arms["arm"].eq("Routing Only")].iloc[0]
    outreach = four_arms[four_arms["arm"].eq("Outreach Only")].iloc[0]
    combined = four_arms[four_arms["arm"].eq("Combined")].iloc[0]
    safety_ok_math = bool(safety["math_non_worsening_check"].all())
    integrity_ok = bool(integrity["unchanged"].all())

    model_text = (
        f"In the held-out chronological test, W prediction MAE was **{float(model_reference['w_mae_min']):.2f} minutes** "
        f"and LWBS risk ROC-AUC was **{float(model_reference['lwbs_auc']):.3f}**. "
        f"At a threshold of {float(model_reference['lwbs_threshold']):.3f}, the test detected "
        f"{int(model_reference['lwbs_test_tp'])}/{int(model_reference['lwbs_test_positive_n'])} LWBS cases "
        f"(sensitivity **{float(model_reference['lwbs_test_recall']):.1%}**). "
        "Risk-model sensitivity is not patient outreach reach or outreach success."
        if model_reference["status"] == "AVAILABLE_HELD_OUT_PREDICTION_REFERENCE_ONLY"
        else "Held-out prediction reference metrics were unavailable; no risk outcomes were invented."
    )

    text = f"""# SeenSooner: Smart Routing and LWBS Prevention | Conditional What-If Analysis

**Evidence classification: HYPOTHETICAL SCENARIO PROJECTION, NOT OBSERVED HOSPITAL OUTCOMES.**
The true intervention effect is `NOT_IDENTIFIABLE`. The neutral illustration assumes a 10% reduction in recorded W for historically roomed ESI 3–5 patients and a 20% outreach-retention fraction among historical LWBS patients. The primary routing scenario assumes no additional LWBS effect.

Under those assumptions, routing alone projects mean/median/P90 W decreases of **{routing['w_mean_reduction_min']:.2f} / {routing['w_median_reduction_min']:.2f} / {routing['w_p90_reduction_min']:.2f} minutes** with unchanged LWBS. Outreach alone holds W constant and projects LWBS **{outreach['baseline_lwbs_rate_pct']:.2f}% to {outreach['projected_lwbs_rate_pct']:.2f}%**, a **{outreach['lwbs_reduction_pp']:.2f}-percentage-point** decrease. The combined scenario applies these independent mechanisms without claiming an experimentally validated interaction.

## A. Data-supported baseline and prediction references

- Fixed historical synthetic cohort: 85,000 visits, of which 81,600 have an observed room-entry time and 3,400 are LWBS (historical LWBS rate **4.00%**).
- Historical W among roomed patients: mean **{baseline['baseline_w_mean_min']:.2f} min**, median **{baseline['baseline_w_median_min']:.2f} min**, and P90 **{baseline['baseline_w_p90_min']:.2f} min**.
- {model_text}
- The real routing effect, outreach retention effect, and patient-level clinical safety are not identifiable or verified with these source records.

## B. Neutral illustration: four-arm comparison

W is evaluated only for the fixed cohort of 81,600 patients who historically entered a room. Historical LWBS patients are not assigned hypothetical room-entry timestamps or W. LWBS uses all 85,000 records as its denominator.

| Arm | Projected W mean / median / P90 (min) | W reduction mean / median / P90 (min) | W > 60 min | Projected LWBS | LWBS reduction | W affected / expected LWBS prevented |
|---|---:|---:|---:|---:|---:|---:|
{chr(10).join(rows)}

The four arms change only transparent, user-editable mathematical inputs in `scenario_config.json`. No new room-entry events are generated. Neither prediction MAE nor AUC is converted into time saved or outreach success.

## C. Sensitivity assumptions: combined arm, all patients

| Assumption set | W reduction input | Outreach retention input | Routing LWBS prevention input | W mean / median / P90 reduction (min) | Projected LWBS | Reduction | Expected LWBS prevented |
|---|---:|---:|---:|---:|---:|---:|---:|
{chr(10).join(sensitivity_rows)}

- `strict_zero` is a zero-benefit reference scenario.
- `conservative`, `neutral`, and `more_optimistic` reflect explicitly hypothetical efficacy inputs, not statistical confidence intervals.
- The optional `neutral_routing_lwbs_5` and `_10` cases add a separate hypothetical routing-to-LWBS effect. Outreach is applied only to the remaining LWBS cases; prevented patients are not double counted.
- No efficacy setting has been selected or calibrated from measured intervention effects.

## D. Neutral combined illustration by source-supported subgroup

| Group | Patients | Historically roomed W cohort | Mean / median / P90 W reduction (min) | Baseline to projected LWBS | Reduction |
|---|---:|---:|---:|---:|---:|
{chr(10).join(group_rows)}

ESI 3–5, normal day, Monday, and winter groups come from recorded synthetic cohort fields, not added demand or randomized clinical trials.

## E. Product mechanism and scientific limits

- **Routing / Faster:** SeenSooner could help nurses identify a compatible ready treatment room. Quantification here simply multiplies the observed W of historically roomed ESI 3–5 patients by a stated assumed factor; no room-ready / assignment / release event replay is performed.
- **Outreach / LWBS Prevention:** The product could help nurses explain waits, reassess symptoms, and offer support. The illustration applies an assumed retention fraction to 3,400 historical LWBS cases; no actual outreach reach, contact, or retention outcomes were observed.
- **Combined:** Both features can be represented in one product, but the two outcomes use different cohorts and denominators.
- The source hospital has 48 treatment spaces, but this analysis is **not a validated capacity-constrained simulation**. Mathematical W reductions are not evidence of physical room-resource feasibility.

## F. ESI 1 and ESI 2 safety limits

- No projected W decrease or risk-based queue jump is applied to ESI 1/2. The mathematical no-worsening check is **{safety_ok_math}**.
- This does not establish an immediate clinical pathway for ESI 1 or that ESI 2 would avoid additional severe delays in real operations.
- Patient-level clinical safety remains **`NOT_VERIFIABLE`**. This is not `SAFETY_PASS_FOR_DEPLOYMENT`; deployment cannot be recommended on these results.

## G. Source integrity and interpretation

- Project source files checked immediately before and after analysis: **{int(integrity['unchanged'].sum())}/{len(integrity)} unchanged** (SHA-256): **{integrity_ok}**.
- Source PDF, original visit CSVs, Python backend and trained model, and all four web-app source implementations were not edited by this analysis. The group handoff excludes precompiled font binaries, and its file manifest was refreshed for the handoff copy.

**Bottom line:** With the neutral illustrative assumptions, routing projects a mean W reduction of **{routing['w_mean_reduction_min']:.2f} minutes** and outreach projects an LWBS decrease of **{outreach['lwbs_reduction_pp']:.2f} percentage points**. These values are arithmetic scenario projections only. The real-world intervention effect remains **`NOT_IDENTIFIABLE`**.
"""
    path.write_text(text, encoding="utf-8")


def write_pitch(path: Path, four_arms: pd.DataFrame, model_reference: dict[str, object]) -> None:
    baseline = four_arms[four_arms["arm"].eq("Baseline")].iloc[0]
    routing = four_arms[four_arms["arm"].eq("Routing Only")].iloc[0]
    outreach = four_arms[four_arms["arm"].eq("Outreach Only")].iloc[0]
    combined = four_arms[four_arms["arm"].eq("Combined")].iloc[0]
    text = f"""# Pitch-ready conditional example (English)

## Suggested slide language

**Under a hypothetical scenario where Smart Routing removes 10% of observed triage-to-room waiting time for historically roomed ESI 3-5 patients, and nurse outreach retains 20% of patients who historically left without being seen:**

- **Routing only:** projected mean Waiting Time falls from {baseline['baseline_w_mean_min']:.2f} to {routing['projected_w_mean_min']:.2f} minutes (a {routing['w_mean_reduction_min']:.2f}-minute reduction); median falls by {routing['w_median_reduction_min']:.2f} minutes and P90 by {routing['w_p90_reduction_min']:.2f} minutes. LWBS remains 4.00% because the primary routing scenario assumes no unverified LWBS effect.
- **Outreach only:** projected LWBS falls from 4.00% to {outreach['projected_lwbs_rate_pct']:.2f}% (a {outreach['lwbs_reduction_pp']:.2f}-percentage-point reduction; {outreach['total_expected_lwbs_prevented_n']:.0f} expected retentions), while Waiting Time remains unchanged.
- **Combined:** the projection shows the same routing-related Waiting Time change and an LWBS rate of {combined['projected_lwbs_rate_pct']:.2f}%, with no double-counting of hypothetical LWBS prevention.

**This is a scenario projection, not an observed hospital outcome.** The 10% routing effect and 20% outreach retention rate are editable what-if assumptions, not measured intervention efficacy. The projection is not a validated capacity-constrained simulation, and patient-level clinical safety remains not verifiable.

## Data anchors, not efficacy inputs

- Fixed historical synthetic cohort: 85,000 visits; 81,600 roomed; 3,400 LWBS.
- Historical Waiting Time: mean {baseline['baseline_w_mean_min']:.2f}, median {baseline['baseline_w_median_min']:.2f}, P90 {baseline['baseline_w_p90_min']:.2f} minutes.
- Historical LWBS rate: 4.00%.
- Held-out model performance (MAE/AUC/recall) describes prediction only and was not converted into minutes saved or patients retained.
"""
    path.write_text(text, encoding="utf-8")


def write_readme(
    path: Path,
    project_root: Path,
    config_path: Path,
    prior_analysis_dir: Path,
) -> None:
    text = """# Combined Smart Routing and LWBS Prevention Scenario

This folder contains a reproducible *conditional what-if projection*, **not** measured hospital improvement or a validated patient-room simulation. Real intervention effectiveness is `NOT_IDENTIFIABLE`.

## Reproduce from the handoff package root

Requirements: Python 3.11+, `numpy`, and `pandas`.

```powershell
python analysis_combined_scenarios/run_combined_scenarios.py
python -m unittest discover -s analysis_combined_scenarios -p "test_*.py" -v
```

The script reads the original 85,000-row synthetic cohort without modifying it and writes results only to `analysis_combined_scenarios`.

## Reproducible files

- `scenario_config.json`: explicit hypothetical efficacy assumptions (not evidence).
- `run_combined_scenarios.py`: original Codex calculation methods with English report generation and portable paths.
- `test_combined_scenarios.py`: unit and evidence-boundary tests.
- `combined_scenario_summary_EN.md`: complete English scenario report.
- `combined_four_arms.csv`: neutral scenario four-arm comparison.
- `sensitivity_grid.csv`: all assumption sets, subgroups, and arms.
- `assumption_register.csv`: facts, assumptions and boundaries.
- `safety_esi12_summary.csv`: mathematical ESI 1/2 checks and safety limits.
- `source_integrity.csv`: source-file hashes from the local rerun.
- `pitch_ready_result_EN.md`: English wording for presentations.

Waiting Time (W) uses only historically roomed patients. LWBS uses every patient in the corresponding group. No historical LWBS record receives an invented room-entry time.

The primary neutral assumptions are 10% shorter recorded W for historically roomed ESI 3-5 patients and 20% retention among historical LWBS patients. These are what-if efficacy *inputs*, not observed effects. ESI 1/2 clinical safety is not verified.
"""
    path.write_text(text, encoding="utf-8")

def run_analysis(
    project_root: Path,
    output_dir: Path,
    config_path: Path,
    prior_analysis_dir: Path | None,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    before = snapshot_tree(project_root)
    config = load_config(config_path)
    annual = load_annual(project_root)
    model_reference = load_model_reference(prior_analysis_dir)

    four_arms = build_four_arms(annual, config)
    sensitivity = build_sensitivity_grid(annual, config)
    assumptions = build_assumption_register(annual, config, model_reference)
    safety = build_safety_summary(annual, config)

    after = snapshot_tree(project_root)
    integrity = build_source_integrity(before, after)
    if not integrity["unchanged"].all():
        changed = integrity.loc[~integrity["unchanged"], "relative_path"].tolist()
        raise RuntimeError(f"Source project changed during analysis: {changed}")

    output_dir.mkdir(parents=True, exist_ok=True)
    four_arms.to_csv(output_dir / "combined_four_arms.csv", index=False, encoding="utf-8-sig")
    sensitivity.to_csv(output_dir / "sensitivity_grid.csv", index=False, encoding="utf-8-sig")
    assumptions.to_csv(output_dir / "assumption_register.csv", index=False, encoding="utf-8-sig")
    safety.to_csv(output_dir / "safety_esi12_summary.csv", index=False, encoding="utf-8-sig")
    integrity.to_csv(output_dir / "source_integrity.csv", index=False, encoding="utf-8-sig")
    write_summary(
        output_dir / "combined_scenario_summary_EN.md",
        four_arms,
        sensitivity,
        model_reference,
        safety,
        integrity,
    )
    write_pitch(output_dir / "pitch_ready_result_EN.md", four_arms, model_reference)
    write_readme(
        output_dir / "README_EN.md",
        project_root,
        config_path,
        prior_analysis_dir if prior_analysis_dir is not None else Path("NOT_AVAILABLE"),
    )
    return four_arms, sensitivity, safety, integrity


def main() -> None:
    here = Path(__file__).resolve().parent
    workspace = here.parent
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--project-root",
        type=Path,
        default=workspace / "source_snapshot_4" / "Halvian_SeenSooner_Demo",
    )
    parser.add_argument("--config", type=Path, default=here / "scenario_config.json")
    parser.add_argument("--prior-analysis-dir", type=Path, default=workspace / "analysis_w_lwbs")
    parser.add_argument("--output-dir", type=Path, default=here)
    args = parser.parse_args()

    four_arms, sensitivity, safety, integrity = run_analysis(
        args.project_root.resolve(),
        args.output_dir.resolve(),
        args.config.resolve(),
        args.prior_analysis_dir.resolve() if args.prior_analysis_dir else None,
    )
    print("Real intervention effect: NOT_IDENTIFIABLE")
    print("All non-baseline numbers: HYPOTHETICAL SCENARIO PROJECTIONS")
    print(
        four_arms[
            [
                "arm",
                "projected_w_mean_min",
                "w_mean_reduction_min",
                "projected_lwbs_rate_pct",
                "lwbs_reduction_pp",
                "routing_w_affected_n",
                "total_expected_lwbs_prevented_n",
            ]
        ].to_string(index=False)
    )
    print(f"Sensitivity rows: {len(sensitivity)}")
    print(
        f"ESI1/2 math non-worsening: {bool(safety['math_non_worsening_check'].all())}; "
        "clinical safety: NOT_VERIFIABLE"
    )
    print(f"Source integrity: {int(integrity['unchanged'].sum())}/{len(integrity)} unchanged")


if __name__ == "__main__":
    main()
