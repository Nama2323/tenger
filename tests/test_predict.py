"""Task A4: orbit fit, freezing, input isolation, determinism and tamper detection."""
import json
import math
import shutil

import httpx
import numpy as np
import pytest

from backend import config, orbit
from backend.astrometry import tangent_offsets_arcsec
from scripts import predict
from scripts.trials import labels_for

CREATED = "2026-11-14T15:00:00Z"


def synthetic_observations(state, t0, times, noise_arcsec=0.2, seed=7):
    rng = np.random.default_rng(seed)
    out = []
    for t in times:
        observer = orbit.observer_heliocentric_au(t, None)
        ra, dec = orbit.apparent_radec(state, t0, t, observer)
        east, north = rng.normal(0, noise_arcsec, 2)
        dec_n = dec + north / 3600
        ra_n = ra + east / 3600 / math.cos(math.radians(dec))
        out.append(orbit.Observation(t, ra_n, dec_n, np.eye(2) * noise_arcsec**2, observer))
    return out


def pluto_like_state():
    # 35 au from the Sun near RA 304 deg, Dec -23 deg, with a speed of about 4.7 km/s.
    direction = np.array([0.45, -0.80, -0.39])
    direction /= np.linalg.norm(direction)
    position = 35.0 * direction
    velocity = np.cross([0, 0, 1], direction)
    velocity = velocity / np.linalg.norm(velocity) * math.sqrt(orbit.GM_SUN / 35.0) * 0.95
    return np.concatenate([position, velocity])


def two_visit_times():
    return [60945.0 + 0.6 * i for i in range(20)] + [61155.0 + 0.4 * i for i in range(20)]


def test_orbit_fit_recovers_a_synthetic_body_and_predicts_within_its_region():
    truth, t0 = pluto_like_state(), 60945.0
    observations = synthetic_observations(truth, t0, two_visit_times())
    search = orbit.multistart(observations)
    assert search["status"] == "fitted"
    best = search["best"]
    assert best["chi2_red"] < 2.0
    assert abs(best["heliocentric_distance_au"] - 35.0) < 1.0
    t_eval = 61314.0
    observer = orbit.observer_heliocentric_au(t_eval, None)
    predicted = orbit.predict(best, t_eval, observer)
    ra, dec = orbit.apparent_radec(truth, t0, t_eval, observer)
    residual = np.array(tangent_offsets_arcsec(predicted["ra_deg"], predicted["dec_deg"], ra, dec))
    d2 = float(residual @ np.linalg.inv(predicted["cov_arcsec2"]) @ residual)
    assert d2 < 13.8  # 99.9% for 2 dof: a real failure, not noise


def test_all_starting_distances_reach_the_same_solution_for_two_visits():
    observations = synthetic_observations(pluto_like_state(), 60945.0, two_visit_times())
    search = orbit.multistart(observations)
    distances = {round(solution["heliocentric_distance_au"], 2) for solution in search["near_best"]}
    assert len(search["near_best"]) >= 4 and max(distances) - min(distances) < 0.05


def test_a_single_visit_arc_gives_a_huge_forecast_region():
    observations = synthetic_observations(pluto_like_state(), 60945.0, two_visit_times()[:20])
    search = orbit.multistart(observations)
    predicted = orbit.predict(search["best"], 61314.0, orbit.observer_heliocentric_au(61314.0, None))
    assert math.sqrt(np.linalg.eigvalsh(predicted["cov_arcsec2"]).max()) > 100


def test_category_labels_and_precedence():
    assert labels_for("pluto", []) == (["prospective_unexposed"], "prospective_unexposed")
    assert labels_for("makemake", []) == (["retrospective_holdout"], "retrospective_holdout")
    gaia = [{"name": "Gaia DR3 parallax", "used_for": "fixed parallax"}]
    assert labels_for("barnard", gaia) == (["retrospective_holdout", "catalogue_assisted"], "retrospective_holdout")
    assert labels_for("makemake", [], open_forecast=True)[1] == "prospective_unexposed"


def test_star_training_never_contains_holdout_rows():
    def row(visit, value):
        return {"obs_key": f"k{visit}-{value}", "visit": visit, "detector": 6, "mjd": 61000.0 + visit * 100 + value,
                "status": "measured", "identified": True, "ra_deg": 10.0 + value, "dec_deg": 0.0,
                "cov_arcsec2": [[0.01, 0], [0, 0.01]]}
    doc = {"epochs": [{"visit": 2, "obs_keys": ["k2-0", "k2-1"]}],
           "astrometry": {"per_exposure": [row(0, 0), row(1, 1), row(2, 0), row(2, 1)]}}
    clean = predict.star_training({"holdout_visit": 2}, doc)
    doc["astrometry"]["per_exposure"][2]["ra_deg"] = float("nan")  # poison the holdout
    assert predict.star_training({"holdout_visit": 2}, doc) == clean
    assert {point["visit"] for point in clean} == {0, 1}


@pytest.fixture()
def frozen_root(tmp_path):
    return tmp_path / "trials"


def test_evaluation_rows_keep_only_ids_and_times(frozen_root):
    folder = predict.freeze("pluto-position-2026b", CREATED, frozen_root)
    trial = json.loads((folder / "trial.json").read_text())
    assert trial["holdout"]["obs"], "the evaluation visit must be listed"
    assert all(set(item) == {"obs_key", "t_start_mjd", "t_end_mjd"} for item in trial["holdout"]["obs"])
    assert "ra_deg" not in (folder / "trial.json").read_text().split('"holdout"')[1].split('"permitted_inputs"')[0]
    training = json.loads((folder / "training.json").read_text())
    assert all(point["t_mjd"] < 61312.0 - 1 for point in training["points"])
    assert trial["category"] == "prospective_unexposed" and trial["confirmation_pending"] is True


def test_prediction_reads_only_its_trial_folder_and_no_network(frozen_root, tmp_path, monkeypatch):
    predict.freeze("barnard-position-2026b", CREATED, frozen_root)
    isolated = tmp_path / "isolated" / "barnard-position-2026b"
    shutil.copytree(frozen_root / "barnard-position-2026b", isolated)

    def no_network(*args, **kwargs):
        raise AssertionError("prediction must not use the network")

    monkeypatch.setattr(httpx, "get", no_network)
    monkeypatch.setattr(httpx.Client, "get", no_network)
    monkeypatch.setattr(predict, "DATA", tmp_path / "empty-data")
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path / "empty-cache")
    document = predict.predict(isolated, CREATED)
    assert document["prediction_status"] == "predicted"
    assert document["category"] == "retrospective_holdout"
    assert "catalogue_assisted" in document["labels"]


def test_prediction_is_deterministic(frozen_root):
    folder = predict.freeze("epsindib-position-2026b", CREATED, frozen_root)
    first = predict.json_bytes(predict.predict(folder, CREATED))
    second = predict.json_bytes(predict.predict(folder, CREATED))
    assert first == second


def test_tampering_is_detected_and_predictions_are_never_rewritten(frozen_root):
    folder = predict.freeze("barnard-position-2026b", CREATED, frozen_root)
    predict.write_prediction("barnard-position-2026b", CREATED, frozen_root)
    with pytest.raises(predict.FrozenError):
        predict.write_prediction("barnard-position-2026b", CREATED, frozen_root)
    with pytest.raises(predict.FrozenError):
        predict.freeze("barnard-position-2026b", CREATED, frozen_root)
    assert predict.check("barnard-position-2026b", frozen_root) == []
    prediction_bytes = (folder / "prediction.json").read_bytes()
    (folder / "receipt.json").write_bytes(predict.json_bytes({"prediction_sha256": predict.sha256(prediction_bytes)}))
    (folder / "prediction.json").write_bytes(prediction_bytes.replace(b'"predicted"', b'"predicted" '))
    assert any("receipt" in problem for problem in predict.check("barnard-position-2026b", frozen_root))
    training = folder / "training.json"
    training.write_bytes(training.read_bytes().replace(b'"measured"', b'"measured" ', 1))
    assert any("training.json" in problem for problem in predict.check("barnard-position-2026b", frozen_root))
    with pytest.raises(predict.FrozenError):
        predict.predict(folder, CREATED)
    trial = folder / "trial.json"
    trial.write_bytes(trial.read_bytes().replace(b'"position"', b'"position" ', 1))
    assert any("trial.json" in problem for problem in predict.check("barnard-position-2026b", frozen_root))


def test_targets_without_training_measurements_are_frozen_as_insufficient(frozen_root):
    for trial_id in ("wise0855-position-2026a", "rdra-brightness-2026a", "makemake-position-2026a"):
        folder = predict.freeze(trial_id, CREATED, frozen_root)
        document = predict.predict(folder, CREATED)
        assert document["prediction_status"] == "insufficient_data", trial_id
        assert document["model"] is None and document["baseline"] is None
        assert document["status_reason_key"].startswith("predict.")
