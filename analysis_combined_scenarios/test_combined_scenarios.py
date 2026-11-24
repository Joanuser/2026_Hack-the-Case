from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd


HERE = Path(__file__).resolve().parent
WORKSPACE = HERE.parent
PROJECT_ROOT = WORKSPACE / "source_snapshot_4" / "Halvian_SeenSooner_Demo"
sys.path.insert(0, str(HERE))

from run_combined_scenarios import (  # noqa: E402
    ARMS,
    CLINICAL_SAFETY_STATUS,
    REAL_EFFECT_STATUS,
    build_four_arms,
    config_set,
    load_annual,
    load_config,
    load_model_reference,
)


class CombinedScenarioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.config = load_config(HERE / "scenario_config.json")
        cls.annual = load_annual(PROJECT_ROOT)
        cls.four = pd.read_csv(HERE / "combined_four_arms.csv")
        cls.grid = pd.read_csv(HERE / "sensitivity_grid.csv")
        cls.assumptions = pd.read_csv(HERE / "assumption_register.csv")
        cls.safety = pd.read_csv(HERE / "safety_esi12_summary.csv")
        cls.integrity = pd.read_csv(HERE / "source_integrity.csv")

    def test_baseline_exactly_reproduces_source_distribution(self) -> None:
        source_w = self.annual.loc[
            self.annual["baseline_seen"].eq(1), "historical_w_min"
        ].to_numpy(dtype=float)
        baseline = self.four[self.four["arm"].eq("Baseline")].iloc[0]
        self.assertEqual(int(baseline["total_patient_n"]), len(self.annual))
        self.assertEqual(
            int(baseline["w_metric_cohort_n_historically_roomed"]),
            int(self.annual["baseline_seen"].sum()),
        )
        self.assertEqual(int(baseline["baseline_lwbs_n"]), int(self.annual["baseline_lwbs"].sum()))
        self.assertAlmostEqual(float(baseline["projected_w_mean_min"]), float(np.mean(source_w)))
        self.assertAlmostEqual(float(baseline["projected_w_median_min"]), float(np.median(source_w)))
        self.assertAlmostEqual(
            float(baseline["projected_w_p90_min"]), float(np.quantile(source_w, 0.90))
        )
        self.assertAlmostEqual(
            float(baseline["projected_lwbs_rate_pct"]),
            float(self.annual["baseline_lwbs"].mean() * 100),
        )

    def test_strict_zero_scenario_keeps_all_four_arms_equal(self) -> None:
        zero = self.grid[
            self.grid["assumption_set"].eq("strict_zero") & self.grid["group"].eq("ALL")
        ]
        self.assertEqual(set(zero["arm"]), {item[0] for item in ARMS})
        for column in [
            "w_mean_reduction_min",
            "w_median_reduction_min",
            "w_p90_reduction_min",
            "long_wait_reduction_pp",
            "lwbs_reduction_pp",
            "total_expected_lwbs_prevented_n",
        ]:
            self.assertTrue(np.allclose(zero[column].to_numpy(dtype=float), 0.0, atol=1e-12))
        self.assertEqual(zero["projected_w_mean_min"].nunique(), 1)
        self.assertEqual(zero["projected_lwbs_rate_pct"].nunique(), 1)

    def test_default_four_arm_mechanisms_are_consistent(self) -> None:
        by_arm = self.four.set_index("arm")
        baseline = by_arm.loc["Baseline"]
        routing = by_arm.loc["Routing Only"]
        outreach = by_arm.loc["Outreach Only"]
        combined = by_arm.loc["Combined"]

        self.assertAlmostEqual(
            float(outreach["projected_w_mean_min"]), float(baseline["projected_w_mean_min"])
        )
        self.assertAlmostEqual(
            float(routing["projected_lwbs_rate_pct"]),
            float(baseline["projected_lwbs_rate_pct"]),
        )
        for metric in ["mean", "median", "p90"]:
            self.assertAlmostEqual(
                float(combined[f"projected_w_{metric}_min"]),
                float(routing[f"projected_w_{metric}_min"]),
            )
        self.assertAlmostEqual(
            float(combined["projected_lwbs_rate_pct"]),
            float(outreach["projected_lwbs_rate_pct"]),
        )
        self.assertGreater(int(routing["routing_w_affected_n"]), 0)
        self.assertEqual(int(outreach["routing_w_affected_n"]), 0)

    def test_combined_lwbs_prevention_is_sequentially_deduplicated(self) -> None:
        row = self.grid[
            self.grid["assumption_set"].eq("neutral_routing_lwbs_5")
            & self.grid["group"].eq("ALL")
            & self.grid["arm"].eq("Combined")
        ].iloc[0]
        baseline = float(row["baseline_lwbs_n"])
        routing_fraction = float(row["routing_lwbs_prevention_fraction_input"])
        outreach_fraction = float(row["outreach_lwbs_retention_fraction_input"])
        expected_routing = baseline * routing_fraction
        expected_outreach = (baseline - expected_routing) * outreach_fraction
        expected_total = expected_routing + expected_outreach
        naive_total = baseline * (routing_fraction + outreach_fraction)
        self.assertAlmostEqual(float(row["routing_expected_lwbs_prevented_n"]), expected_routing)
        self.assertAlmostEqual(
            float(row["outreach_expected_lwbs_prevented_after_dedup_n"]), expected_outreach
        )
        self.assertAlmostEqual(float(row["total_expected_lwbs_prevented_n"]), expected_total)
        self.assertLess(float(row["total_expected_lwbs_prevented_n"]), naive_total)

    def test_w_and_lwbs_denominators_remain_distinct(self) -> None:
        for row in self.grid.itertuples(index=False):
            self.assertLessEqual(row.w_metric_cohort_n_historically_roomed, row.total_patient_n)
            self.assertEqual(row.lwbs_rate_denominator_n, row.total_patient_n)
            self.assertFalse(row.fabricated_room_entered_at_created)
            self.assertFalse(row.historical_lwbs_assigned_projected_w)
        historical_lwbs = self.annual[self.annual["baseline_lwbs"].eq(1)]
        self.assertTrue(historical_lwbs["historical_w_min"].isna().all())

    def test_all_efficacy_inputs_are_explicitly_hypothetical(self) -> None:
        for item in self.config["assumption_sets"]:
            self.assertEqual(item["evidence_status"], "HYPOTHETICAL_INPUT_NOT_EVIDENCE")
        for definition in self.config["parameter_definitions"].values():
            self.assertEqual(definition["evidence_status"], "HYPOTHETICAL_INPUT_NOT_EVIDENCE")
        nonbaseline = self.four[~self.four["arm"].eq("Baseline")]
        self.assertTrue(
            nonbaseline["efficacy_inputs_evidence_status"]
            .eq("HYPOTHETICAL_INPUT_NOT_EVIDENCE")
            .all()
        )
        self.assertTrue(self.four["real_intervention_effect_status"].eq(REAL_EFFECT_STATUS).all())

    def test_sensitivity_grid_has_named_sets_groups_and_four_arms(self) -> None:
        set_names = {item["name"] for item in self.config["assumption_sets"]}
        groups = {"ALL", "ESI3_5", "NORMAL_DAY", "MONDAY_PEAK", "WINTER_PEAK"}
        arms = {item[0] for item in ARMS}
        self.assertEqual(set(self.grid["assumption_set"]), set_names)
        self.assertEqual(set(self.grid["group"]), groups)
        self.assertEqual(set(self.grid["arm"]), arms)
        self.assertEqual(len(self.grid), len(set_names) * len(groups) * len(arms))

    def test_esi12_math_never_worsens_but_clinical_safety_is_not_verifiable(self) -> None:
        self.assertEqual(set(self.safety["esi"]), {1, 2})
        self.assertTrue(self.safety["math_non_worsening_check"].all())
        self.assertFalse(self.safety["any_mathematical_w_increase"].any())
        self.assertTrue(
            np.allclose(
                self.safety["max_patient_level_w_increase_min"].to_numpy(dtype=float),
                0.0,
                atol=1e-12,
            )
        )
        self.assertFalse(self.safety["esi_modified"].any())
        self.assertFalse(self.safety["risk_based_queue_jump_allowed"].any())
        self.assertTrue(self.safety["clinical_safety_status"].eq(CLINICAL_SAFETY_STATUS).all())
        self.assertFalse(self.safety["deployment_safety_pass"].any())

    def test_missing_model_reference_is_reported_not_invented(self) -> None:
        missing = load_model_reference(None)
        self.assertEqual(missing["status"], "NOT_AVAILABLE")
        self.assertTrue(np.isnan(float(missing["w_mae_min"])))
        model_row = self.assumptions[self.assumptions["parameter"].eq("model_performance")].iloc[0]
        self.assertEqual(model_row["evidence_status"], "PREDICTION_NOT_INTERVENTION")

    def test_source_project_hashes_are_unchanged(self) -> None:
        self.assertGreater(len(self.integrity), 100)
        self.assertTrue(self.integrity["unchanged"].all())
        self.assertTrue(
            self.integrity["relative_path"].str.contains("patient-app/src/App.tsx", regex=False).any()
        )
        self.assertTrue(
            self.integrity["relative_path"].str.contains("nurse-app/src/App.tsx", regex=False).any()
        )
        self.assertTrue(
            self.integrity["relative_path"].str.contains("display-app/src/App.tsx", regex=False).any()
        )
        self.assertTrue(
            self.integrity["relative_path"]
            .str.endswith("Healthcare_AI_Hack_the_Case_Source.pdf")
            .any()
        )

    def test_pitch_language_contains_required_disclaimer(self) -> None:
        text = (HERE / "pitch_ready_result_EN.md").read_text(encoding="utf-8")
        self.assertIn("Under a hypothetical scenario where", text)
        self.assertIn("This is a scenario projection, not an observed hospital outcome.", text)
        self.assertIn("not a validated capacity-constrained simulation", text)

    def test_required_outputs_exist(self) -> None:
        expected = [
            "combined_scenario_summary_EN.md",
            "combined_four_arms.csv",
            "sensitivity_grid.csv",
            "scenario_config.json",
            "assumption_register.csv",
            "safety_esi12_summary.csv",
            "run_combined_scenarios.py",
            "test_combined_scenarios.py",
            "README_EN.md",
            "source_integrity.csv",
            "pitch_ready_result_EN.md",
        ]
        for name in expected:
            self.assertTrue((HERE / name).is_file(), name)


if __name__ == "__main__":
    unittest.main()
