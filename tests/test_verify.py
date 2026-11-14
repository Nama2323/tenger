"""Task A5: refusal on tampering, scoring edge cases, scoreboard counts, recovery with alternatives."""
import json
import math
import shutil

import numpy as np
import pytest

from backend import astrometry
from backend.processing import NativeProduct
from scripts import build_scoreboard, verify
from tests.test_astrometry import SCALE_ARCSEC, flag_schema, make_wcs

CHI2 = verify.CHI2_95_2D


# ------------------------------------------------------------------ tamper rejection


def test_published_trials_are_intact():
    for trial_id in ("barnard-position-2026b", "epsindib-position-2026b", "pluto-position-2026b"):
        assert verify.integrity_problems(trial_id) == []


def test_a_changed_prediction_is_refused(tmp_path):
    root = tmp_path / "trials"
    shutil.copytree(verify.TRIALS_DIR / "barnard-position-2026b", root / "barnard-position-2026b")
    assert verify.integrity_problems("barnard-position-2026b", root) == []
    path = root / "barnard-position-2026b" / "prediction.json"
    path.write_bytes(path.read_bytes().replace(b'"predicted"', b'"predicted" '))
    problems = verify.integrity_problems("barnard-position-2026b", root)
    assert any("receipt" in problem for problem in problems)
    assert any("commit" in problem for problem in problems)
    with pytest.raises(verify.VerifyRefused):
        verify.require_intact("barnard-position-2026b", root)


def test_a_missing_receipt_is_refused(tmp_path):
    root = tmp_path / "trials"
    shutil.copytree(verify.TRIALS_DIR / "epsindib-position-2026b", root / "epsindib-position-2026b")
    (root / "epsindib-position-2026b" / "receipt.json").unlink()
    assert "no receipt" in verify.integrity_problems("epsindib-position-2026b", root)


def test_verification_is_never_rewritten(tmp_path, monkeypatch):
    monkeypatch.setattr(verify, "TRIALS_DIR", tmp_path)
    (tmp_path / "x").mkdir()
    verify.write("x", {"status": "hit"}, tmp_path)
    with pytest.raises(verify.VerifyRefused):
        verify.write("x", {"status": "miss"}, tmp_path)


# ------------------------------------------------------------------ covariance and scoring


def test_score_uses_the_mean_residual_and_combined_covariance():
    residuals = np.array([[1.0, 0.0], [1.2, 0.1], [0.8, -0.1], [1.0, 0.0]])
    fit_covs = np.array([np.eye(2) * 0.01] * 4)
    c_pred = np.eye(2) * 0.25
    scored = verify.score(residuals, fit_covs, c_pred)
    mean = residuals.mean(axis=0)
    expected = float(mean @ np.linalg.inv(c_pred + scored["c_obs"]) @ mean)
    assert scored["d2"] == pytest.approx(expected)
    assert scored["status"] == ("hit" if expected <= CHI2 else "miss")


def test_c_obs_never_falls_below_the_fit_errors():
    identical = np.array([[0.5, 0.5]] * 3)  # zero sample scatter
    fit_covs = np.array([np.eye(2) * 0.09] * 3)
    scored = verify.score(identical, fit_covs, np.eye(2))
    assert scored["c_obs_basis"] == "fit-floor"
    assert np.allclose(scored["c_obs"], np.eye(2) * 0.03)


def test_singular_combined_covariance_is_an_invalid_comparison():
    identical = np.array([[0.5, 0.5]] * 3)
    scored = verify.score(identical, np.zeros((3, 2, 2)), np.zeros((2, 2)))
    assert scored["status"] == "invalid_comparison"
    assert scored["status_reason_key"] == "verify.singular-covariance"


def test_fewer_than_three_identified_is_insufficient():
    scored = verify.score(np.zeros((2, 2)), np.array([np.eye(2)] * 2), np.eye(2))
    assert scored["status"] == "insufficient_data"


def test_baseline_is_scored_with_the_same_observed_covariance():
    residuals = np.array([[1.0, 0.0], [5.0, 0.1], [9.0, -0.1]])  # a baseline drifting through the visit
    fit_covs = np.array([np.eye(2) * 0.01] * 3)
    model = verify.score(np.array([[0.1, 0.0], [0.0, 0.1], [-0.1, 0.0]]), fit_covs, np.eye(2))
    baseline = verify.score(residuals, fit_covs, np.eye(2), c_obs=model["c_obs"])
    assert np.allclose(baseline["c_obs"], model["c_obs"])


def test_published_d2_matches_the_published_covariances():
    for trial_id in ("barnard-position-2026b", "epsindib-position-2026b", "pluto-position-2026b"):
        document = json.loads((verify.TRIALS_DIR / trial_id / "verification.json").read_text())
        for name in ("model", "baseline"):
            block = document["residuals"][name]
            r = np.array([block["east_arcsec"], block["north_arcsec"]])
            total = np.array(block["c_pred_arcsec2"]) + np.array(document["observed"]["cov_arcsec2"])
            assert float(r @ np.linalg.inv(total) @ r) == pytest.approx(block["d2"], rel=0.02)


# ------------------------------------------------------------------ scoreboard counts


def test_scoreboard_counts_statuses_and_keeps_open_forecasts_out(tmp_path, monkeypatch):
    def trial(folder, trial_id, category, prediction_status, verification_status=None, **extra):
        path = folder / trial_id
        path.mkdir(parents=True)
        (path / "trial.json").write_text(json.dumps({"trial_id": trial_id, "target_key": "t", "quantity": "position",
                                                     "category": category, "labels": [category], **extra}))
        (path / "prediction.json").write_text(json.dumps({"prediction_status": prediction_status}))
        if verification_status:
            (path / "verification.json").write_text(json.dumps({"status": verification_status, "residuals": {}}))

    trials = tmp_path / "trials"
    trial(trials, "a", "retrospective_holdout", "predicted", "hit")
    trial(trials, "b", "retrospective_holdout", "predicted", "miss")
    trial(trials, "c", "retrospective_holdout", "insufficient_data")
    trial(trials, "d", "prospective_unexposed", "predicted", "miss", confirmation_pending=True)
    trial(trials, "e", "prospective_unexposed", "predicted", open_forecast=True)
    trial(trials, "f", "prospective_unexposed", "predicted")
    monkeypatch.setattr(build_scoreboard, "DATA", tmp_path)
    board = build_scoreboard.build("2026-11-14T00:00:00Z")
    assert board["counts"]["retrospective_holdout"] == {"waiting": 0, "hit": 1, "miss": 1, "insufficient_data": 1,
                                                        "ambiguous": 0, "invalid_comparison": 0}
    assert board["counts"]["prospective_unexposed"]["miss"] == 1
    assert board["counts"]["prospective_unexposed"]["waiting"] == 1
    assert board["open_forecasts"] == ["e"]
    assert "e" not in {row["trial_id"] for row in board["rows"]}
    pending = next(row for row in board["rows"] if row["trial_id"] == "d")
    assert pending["counts_as_prospective"] is False and pending["counts_as_prospective_if_confirmed"] is True


# ------------------------------------------------------------------ recovery with alternatives


def render(ra0, dec0, sources, n=41, noise=1.0, seed=0):
    """A cutout centred on (ra0, dec0) with point sources at sky positions [(ra, dec, flux)]."""
    rng = np.random.default_rng(seed)
    wcs = make_wcs(n, ra0, dec0)
    rows, cols = np.mgrid[:n, :n]
    image = rng.normal(0, noise, (n, n))
    for ra, dec, flux in sources:
        x, y = (float(v) for v in wcs.all_world2pix(ra, dec, 0))
        image += astrometry._pixel_gaussian([flux, x, y, 0.62, 0.0], cols.astype(float), rows.astype(float))
    return NativeProduct(image.astype(np.float32), np.full((n, n), noise**2, np.float32), np.zeros((n, n), np.int32),
                         np.zeros((n, n), np.float32), flag_schema(), np.zeros((n, n), bool), wcs, None, 3, "S", "t",
                         {"PSF_FWHM": 9.0})


def items_for(body_offsets, static_star=None, decoy=None, body_present=(True, True, True, True)):
    """Four exposures; the model moves 40 arcsec east per exposure."""
    items = []
    for index, (east, north) in enumerate(body_offsets):
        ra_model = 150.0 + index * 40 / 3600
        dec_model = 10.0
        sources = []
        if body_present[index]:
            sources.append((*astrometry.tangent_to_sky(ra_model, dec_model, east, north), 400.0))
        if static_star:
            sources.append((*static_star, 400.0))
        if decoy and index == 0:
            sources.append((*astrometry.tangent_to_sky(ra_model, dec_model, *decoy), 400.0))
        items.append({"obs_key": f"k{index}", "detector": 3, "t": 61000.0 + index,
                      "model": (ra_model, dec_model, np.eye(2)), "product": render(ra_model, dec_model, sources, seed=index)})
    return items


def test_a_static_star_near_the_forecast_is_listed_and_rejected():
    star = astrometry.tangent_to_sky(150.0, 10.0, -5.0, 4.0)  # fixed on the sky, 6 arcsec from the first forecast
    items = items_for([(1.0, -0.5)] * 4, static_star=star, body_present=(False, True, True, True))
    result = verify.recover(items, 15.0)
    first = items[0]
    assert first["identification"] == "none"
    listed = [c for c in first["candidates"] if c["fit_status"] == "measured"]
    assert listed and all(c["static_check"]["static_source"] for c in listed)
    assert result["status"] is None and len(result["identified"]) == 3
    assert result["motion"]["consistent"] is True


def test_two_passing_sources_make_the_trial_ambiguous():
    items = items_for([(-14.0, 0.0)] * 4, decoy=(14.0, 0.0))  # the decoy appears in one exposure only
    result = verify.recover(items, 15.0)
    assert items[0]["identification"] == "ambiguous"
    assert sum(c["passes"] for c in items[0]["candidates"]) == 2
    assert result["status"] == ("ambiguous", "verify.multiple-candidates")


def test_inconsistent_motion_is_ambiguous():
    items = items_for([(1.0, -0.5), (8.0, 6.0), (-8.0, -6.0), (1.0, -0.5)])
    result = verify.recover(items, 15.0)
    assert len(result["identified"]) >= 3
    assert result["status"] == ("ambiguous", "verify.motion-inconsistent")
