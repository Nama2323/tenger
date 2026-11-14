"""A9 asteroid batch: selection helpers, orbit helpers and the calibration interval."""
import math

import numpy as np
import pytest

from scripts import asteroid_forecast as forecast
from scripts import asteroids


def _row(t, detector="D1", uri="ibe/data/spherex/dr1/x.fits", obs="o"):
    return {"mjd_start": str(t), "mjd_end": str(t + 0.001), "productid": detector, "uri": uri, "observationid": obs,
            "match": "1"}


def test_visits_split_after_more_than_30_days():
    rows = [_row(t) for t in (100, 110, 125, 200, 205, 400)]
    groups = asteroids.clusters(rows)
    assert [len(g) for g in groups] == [3, 2, 1]


def test_evaluation_window_is_the_busiest_day_and_uses_times_only():
    rows = [_row(t) for t in (500.0, 500.2, 501.5, 501.6, 501.7, 502.4, 503.0)]
    window = asteroids.evaluation_window(rows)
    assert [float(r["mjd_start"]) for r in window] == [501.5, 501.6, 501.7, 502.4]


def test_dedupe_prefers_dr1():
    rows = [_row(1, uri="ibe/data/spherex/qr3/a.fits", obs="x"), _row(1, uri="ibe/data/spherex/dr1/a.fits", obs="x")]
    kept = asteroids.dedupe(rows)
    assert len(kept) == 1 and "/dr1/" in kept[0]["uri"]


def test_evenly_spaced_choice():
    assert asteroids.evenly(list(range(20)), 5) == [0, 5, 10, 14, 19]
    assert asteroids.evenly([1, 2], 10) == [1, 2]


def test_clopper_pearson_known_values():
    assert asteroids.clopper_pearson(7, 8) == pytest.approx((0.47349, 0.99684), abs=1e-4)
    assert asteroids.clopper_pearson(8, 8) == pytest.approx((0.63058, 1.0), abs=1e-4)
    assert asteroids.clopper_pearson(0, 5) == pytest.approx((0.0, 0.52182), abs=1e-4)


def test_elements_round_trip():
    state = forecast.state_from_elements(2.7, 0.12, math.radians(9.0), 1.1, 2.3, 0.4)
    elements = forecast.osculating_elements(state)
    assert elements["a_au"] == pytest.approx(2.7, rel=1e-9)
    assert elements["e"] == pytest.approx(0.12, abs=1e-9)
    assert elements["i_deg"] == pytest.approx(9.0, abs=1e-7)


def test_calibration_counts_only_scored_rows():
    rows = [{"model_d2": 1.0}, {"model_d2": 7.0}, {"model_d2": None}, {"model_d2": 5.9}]
    result = asteroids.calibration(rows, "model")
    assert (result["n"], result["k_inside"]) == (3, 2)
    assert result["expected_inside"] == pytest.approx(2.85)
    assert result["interval"][0] < 2 / 3 < result["interval"][1]


def test_forecast_code_files_exist_and_hash():
    assert len(forecast.code_sha256()) == 64
    assert "scripts/asteroid_forecast.py" in forecast.CODE_FILES
    assert "scripts/asteroids.py" not in forecast.CODE_FILES  # verification code may change after the freeze
