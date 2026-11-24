"""Remaining-W2 inference for the local synthetic SeenSooner demo.

The loaded model predicts total W2.  Remaining W2 is then conditioned on the
patient having remained in W2 beyond the current elapsed time, using only the
calibration rows stored in the fixed model bundle.  This mirrors the repaired
training program and never changes ESI or room type.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

import joblib
import numpy as np
import pandas as pd


FEATURES = [
    "esi",
    "triage_weekday",
    "triage_shift",
    "triage_winter",
    "triage_hour",
    "arrivals_prev_60m_at_triage",
]
MIN_CONDITIONAL_CALIBRATION_ROWS = 100


class RemainingW2Predictor:
    def __init__(self, model_path: Path, historical_path: Path) -> None:
        self.model_path = model_path
        self.historical_path = historical_path
        self._lock = Lock()
        self._bundle: dict[str, Any] | None = None
        self._historical: pd.DataFrame | None = None
        self.model_load_error: str | None = None

    def _load_bundle(self) -> dict[str, Any]:
        with self._lock:
            if self._bundle is None:
                try:
                    bundle = joblib.load(self.model_path)
                    if not isinstance(bundle, dict) or "model" not in bundle or "calibration_rows" not in bundle:
                        raise ValueError("W2 bundle is missing model or calibration_rows")
                    self._bundle = bundle
                except Exception as exc:  # explicit fallback is handled by predict()
                    self.model_load_error = f"{type(exc).__name__}: {exc}"
                    raise
            return self._bundle

    def _load_historical(self) -> pd.DataFrame:
        with self._lock:
            if self._historical is None:
                frame = pd.read_csv(
                    self.historical_path,
                    usecols=["esi", "w2_actual_minutes", "room_entered_at"],
                )
                frame = frame[
                    frame["room_entered_at"].notna() & frame["w2_actual_minutes"].notna()
                ].copy()
                frame["esi"] = pd.to_numeric(frame["esi"], errors="coerce")
                frame["w2_actual_minutes"] = pd.to_numeric(
                    frame["w2_actual_minutes"], errors="coerce"
                )
                self._historical = frame.dropna()
            return self._historical

    @staticmethod
    def _features(
        esi: int,
        triage_completed_at: datetime,
        arrivals_prev_60m: int,
    ) -> pd.DataFrame:
        hour = triage_completed_at.hour
        shift = "Day" if 7 <= hour < 15 else "Evening" if 15 <= hour < 23 else "Night"
        return pd.DataFrame(
            [
                {
                    "esi": esi,
                    "triage_weekday": triage_completed_at.strftime("%A"),
                    "triage_shift": shift,
                    "triage_winter": int(triage_completed_at.month in (1, 2, 12)),
                    "triage_hour": hour,
                    "arrivals_prev_60m_at_triage": max(0, int(arrivals_prev_60m)),
                }
            ]
        )

    @staticmethod
    def _conditioned_from_calibration(
        bundle: dict[str, Any],
        features: pd.DataFrame,
        esi: int,
        elapsed: float,
    ) -> tuple[float, float, float, float, int]:
        model = bundle["model"]
        calibration = bundle["calibration_rows"]
        base_total = float(model.predict(features[FEATURES])[0])
        candidates = calibration[
            calibration["esi"].eq(esi) & calibration["w2_actual_minutes"].gt(elapsed)
        ]
        if len(candidates) < MIN_CONDITIONAL_CALIBRATION_ROWS:
            candidates = calibration[calibration["w2_actual_minutes"].gt(elapsed)]
        if candidates.empty:
            candidates = calibration

        if elapsed <= 0:
            residuals = candidates["residual_minutes"].to_numpy(dtype=float)
            q10, q50, q90 = np.quantile(residuals, [0.10, 0.50, 0.90])
            low = max(0.0, base_total + float(q10))
            point = max(0.0, base_total + float(q50))
            high = max(point, base_total + float(q90))
            return point, low, high, point, len(candidates)

        ordered = candidates.sort_values("model_total_prediction")
        base_values = ordered["model_total_prediction"].to_numpy(dtype=float)
        remaining = (
            ordered["w2_actual_minutes"].to_numpy(dtype=float) - elapsed
        )
        neighbor_n = min(len(ordered), max(MIN_CONDITIONAL_CALIBRATION_ROWS, 300))
        insertion = int(np.searchsorted(base_values, base_total))
        start = max(0, min(len(ordered) - neighbor_n, insertion - neighbor_n // 2))
        sample = remaining[start : start + neighbor_n]
        low, point, high = [float(x) for x in np.quantile(sample, [0.10, 0.50, 0.90])]
        low = max(0.0, low)
        point = max(0.0, point)
        high = max(point, high)
        return point, low, high, elapsed + point, neighbor_n

    def _historical_fallback(self, esi: int, elapsed: float) -> tuple[float, float, float, int]:
        historical = self._load_historical()
        candidates = historical[
            historical["esi"].eq(esi) & historical["w2_actual_minutes"].gt(elapsed)
        ]
        if len(candidates) < MIN_CONDITIONAL_CALIBRATION_ROWS:
            candidates = historical[historical["w2_actual_minutes"].gt(elapsed)]
        if candidates.empty:
            # Last-resort static synthetic medians; still never negative.
            total = {1: 10.8, 2: 20.7, 3: 32.4, 4: 43.1, 5: 52.4}[esi]
            point = max(0.0, total - elapsed)
            return point, max(0.0, point - 10.0), point + 15.0, 0
        remaining = candidates["w2_actual_minutes"].to_numpy(dtype=float) - elapsed
        low, point, high = [float(x) for x in np.quantile(remaining, [0.10, 0.50, 0.90])]
        return max(0.0, point), max(0.0, low), max(point, high), len(candidates)

    def predict(
        self,
        *,
        esi: int,
        triage_completed_at: datetime,
        elapsed_minutes: float,
        arrivals_prev_60m: int,
        force_model_failure: bool = False,
    ) -> dict[str, Any]:
        if not 1 <= int(esi) <= 5:
            raise ValueError("ESI must be 1-5 and nurse-confirmed")
        elapsed = max(0.0, float(elapsed_minutes))
        generated_at = datetime.now(timezone.utc).isoformat()
        features = self._features(int(esi), triage_completed_at, arrivals_prev_60m)
        try:
            if force_model_failure or os.getenv("SEENSOONER_FORCE_MODEL_FAILURE") == "1":
                raise RuntimeError("forced model failure for fallback verification")
            bundle = self._load_bundle()
            point, low, high, total, support = self._conditioned_from_calibration(
                bundle, features, int(esi), elapsed
            )
            source = "w2_model_calibration_conditioned"
            fallback_reason = None
        except Exception as exc:
            point, low, high, support = self._historical_fallback(int(esi), elapsed)
            total = elapsed + point
            source = "historical_completed_w2_fallback"
            fallback_reason = f"{type(exc).__name__}: {exc}"

        return {
            "predicted_remaining_w2_minutes": round(max(0.0, point), 1),
            "remaining_w2_low": round(max(0.0, low), 1),
            "remaining_w2_high": round(max(point, high), 1),
            "predicted_total_w2_minutes": round(max(elapsed, total), 1),
            "w2_elapsed_minutes_now": round(elapsed, 1),
            "generated_at": generated_at,
            "prediction_source": source,
            "fallback_reason": fallback_reason,
            "conditional_reference_n": int(support),
            "definition": "remaining W2 from now until Room Entered; W2 starts at Triage Completed",
        }

