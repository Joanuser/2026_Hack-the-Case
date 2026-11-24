#!/usr/bin/env python3
"""Independent checks for generated W2 reduction simulation outputs."""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd


def validate(out_dir: Path) -> pd.DataFrame:
    required = [
        "simulation_assumptions.csv",
        "baseline_vs_intervention.csv",
        "peak_hour_comparison.csv",
        "esi_fairness_comparison.csv",
        "simulation_events_sample.csv",
        "sensitivity_analysis.csv",
        "lwbs_censored_summary.csv",
        "simulation_validation_checks.csv",
        "simulation_metadata.json",
    ]
    checks: list[dict] = []

    def add(name: str, passed: bool, observed: object, expected: object) -> None:
        checks.append(
            {
                "check": name,
                "status": "PASS" if passed else "FAIL",
                "observed": observed,
                "expected": expected,
            }
        )

    missing = [name for name in required if not (out_dir / name).exists()]
    add("required_outputs_present", not missing, missing, [])
    if missing:
        result = pd.DataFrame(checks)
        result.to_csv(out_dir / "independent_validation_checks.csv", index=False)
        raise SystemExit(1)

    kpi = pd.read_csv(out_dir / "baseline_vs_intervention.csv")
    calculated_difference = kpi["seensooner"] - kpi["baseline"]
    add(
        "kpi_difference_reconciles",
        np.allclose(calculated_difference, kpi["difference_seensooner_minus_baseline"]),
        float((calculated_difference - kpi["difference_seensooner_minus_baseline"]).abs().max()),
        0,
    )
    add(
        "kpi_reduction_reconciles",
        np.allclose(-calculated_difference, kpi["reduction_baseline_minus_seensooner"]),
        float((-calculated_difference - kpi["reduction_baseline_minus_seensooner"]).abs().max()),
        0,
    )

    assumptions = pd.read_csv(out_dir / "simulation_assumptions.csv")
    classes = set(assumptions["classification"])
    add("assumption_source_classes", {"PDF fact", "Synthetic reference", "Simulation assumption"}.issubset(classes), sorted(classes), "PDF fact + Synthetic reference + Simulation assumption")

    event_sample = pd.read_csv(out_dir / "simulation_events_sample.csv")
    required_event_fields = {
        "triage_completed_at", "required_room_type", "room_entered_at_baseline",
        "room_entered_at_seensooner", "w2_actual_minutes_baseline", "w2_actual_minutes_seensooner",
    }
    add("event_sample_fields", required_event_fields.issubset(event_sample.columns), sorted(required_event_fields - set(event_sample.columns)), [])
    nonentered_baseline = ~event_sample["status_baseline"].eq("ENTERED_ROOM")
    nonentered_seen = ~event_sample["status_seensooner"].eq("ENTERED_ROOM")
    fabricated = int(event_sample.loc[nonentered_baseline, "w2_actual_minutes_baseline"].notna().sum() + event_sample.loc[nonentered_seen, "w2_actual_minutes_seensooner"].notna().sum())
    add("sample_nonentered_has_no_complete_w2", fabricated == 0, fabricated, 0)

    sensitivity = pd.read_csv(out_dir / "sensitivity_analysis.csv")
    null_rows = sensitivity[sensitivity["parameter_case"].eq("equal_process_null")]
    null_max = float(null_rows[["median_reduction_min", "mean_reduction_min", "p90_reduction_min"]].abs().to_numpy().max())
    add("equal_process_null_has_zero_effect", null_max < 1e-9, null_max, 0)
    immediate = sensitivity[sensitivity["parameter_case"].eq("immediate_skip")]
    idle_equal = np.allclose(
        immediate["baseline_no_response_idle_min_per_day"],
        immediate["seensooner_no_response_idle_min_per_day"],
    )
    add("immediate_skip_no_response_idle_equal", idle_equal, idle_equal, True)

    lwbs = pd.read_csv(out_dir / "lwbs_censored_summary.csv")
    add("lwbs_no_complete_w2_fabricated", int(lwbs["complete_w2_values_fabricated"].sum()) == 0, int(lwbs["complete_w2_values_fabricated"].sum()), 0)
    add("lwbs_no_causal_claim", not lwbs["causal_lwbs_reduction_claimed"].astype(bool).any(), bool(lwbs["causal_lwbs_reduction_claimed"].astype(bool).any()), False)

    internal = pd.read_csv(out_dir / "simulation_validation_checks.csv")
    add("internal_simulation_checks_all_pass", internal["status"].eq("PASS").all(), int(internal["status"].eq("PASS").sum()), len(internal))
    fairness = pd.read_csv(out_dir / "esi_fairness_comparison.csv")
    esi1 = fairness[fairness["group_dimension"].eq("ESI") & fairness["group_value"].astype(str).eq("1")]
    add("esi1_no_individual_worsening_in_primary", float(esi1["share_with_longer_w2_under_seensooner"].iloc[0]) == 0.0, float(esi1["share_with_longer_w2_under_seensooner"].iloc[0]), 0)

    result = pd.DataFrame(checks)
    result.to_csv(out_dir / "independent_validation_checks.csv", index=False)
    failed = result[result["status"].eq("FAIL")]
    print(f"Independent validation: {len(result) - len(failed)}/{len(result)} PASS")
    if not failed.empty:
        print(failed.to_string(index=False))
        raise SystemExit(1)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default="outputs")
    args = parser.parse_args()
    validate(Path(args.out_dir))
