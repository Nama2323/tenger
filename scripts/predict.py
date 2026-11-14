"""Freeze trials, predict, write receipts, check the hash chain (Task A4, DATA-CONTRACT V1 §6-8, V5).

Usage:
  python -m scripts.predict freeze <trial_id|all>      # training.json + trial.json (never overwritten)
  python -m scripts.predict predict <trial_id> [--created-utc ISO]
  python -m scripts.predict receipt <trial_id>
  python -m scripts.predict check [<trial_id> ...]

Input isolation: `predict` reads only trials/<id>/trial.json and trials/<id>/training.json.
It never reads evaluation pixels, the exposure inventory positions, reserved.json, the
cache or the network. Freezing reads the published investigation files and keeps only
training-visit measurements; for the evaluation visit it keeps observation IDs and times.
"""
import argparse
import hashlib
import json
import math
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "static" / "data"
TRIALS_DIR = DATA / "trials"
MODEL_FILES = ("backend/orbit.py", "backend/astrometry.py", "scripts/predict.py", "scripts/trials.py")
CHI2_95_2D = 5.991464547107979
MIN_TRAINING_POINTS = 6
MIN_TRAINING_VISITS = 2
SPACECRAFT_KM = 7071.0  # SPHEREx orbit radius (about 700 km altitude), for the unknown future position


class FrozenError(RuntimeError):
    pass


def json_bytes(obj) -> bytes:
    return (json.dumps(obj, indent=2, ensure_ascii=False) + "\n").encode()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def model_code_sha256() -> str:
    digest = hashlib.sha256()
    for name in MODEL_FILES:
        digest.update(name.encode() + b"\0" + (ROOT / name).read_bytes())
    return digest.hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _r(value, digits=6):
    return None if value is None else round(float(value), digits)


def _cov(matrix) -> list:
    return [[round(float(value), 6) for value in row] for row in np.asarray(matrix, float)]


# ------------------------------------------------------------------ training extraction


def investigation(target: str) -> tuple[dict, bytes]:
    data = (DATA / target / "investigation.json").read_bytes()
    return json.loads(data), data


def holdout_star_keys(doc: dict, visit: int) -> set[str]:
    return {key for epoch in doc["epochs"] if epoch.get("visit") == visit for key in epoch["obs_keys"]}


def star_training(spec: dict, doc: dict) -> list[dict]:
    astrometry_block = doc.get("astrometry") or {}
    holdout = holdout_star_keys(doc, spec["holdout_visit"])
    points = []
    for row in astrometry_block.get("per_exposure", []):
        if row["obs_key"] in holdout or row.get("visit") == spec["holdout_visit"]:
            continue
        if row.get("status") != "measured" or not row.get("identified"):
            continue
        points.append({"t_mjd": row["mjd"], "ra_deg": row["ra_deg"], "dec_deg": row["dec_deg"],
                       "cov_arcsec2": row["cov_arcsec2"], "obs_keys": [row["obs_key"]],
                       "visit": row["visit"], "detector": row["detector"], "spacecraft_km": None,
                       "content_type": "measured"})
    return points


def body_training(spec: dict, doc: dict) -> list[dict]:
    low = spec["holdout_window_mjd"][0]
    points = []
    for row in (doc.get("astrometry") or {}).get("per_exposure", []):
        if row.get("identification") != "body" or row["mjd"] >= low - 1.0:
            continue
        points.append({"t_mjd": row["mjd"], "ra_deg": row["ra_deg"], "dec_deg": row["dec_deg"],
                       "cov_arcsec2": row["cov_arcsec2"], "obs_keys": [row["obs_key"]],
                       "visit": row["visit"], "detector": row["detector"],
                       "spacecraft_km": row.get("spacecraft_km"), "content_type": "measured"})
    return points


def brightness_training(spec: dict, doc: dict) -> list[dict]:
    holdout = holdout_star_keys(doc, spec["holdout_visit"])
    points = []
    for row in (doc.get("photometry") or {}).get("points", []):
        if row["obs_key"] in holdout or row.get("status") != "measured":
            continue
        points.append({"t_mjd": row["mjd"], "flux_ujy": row["flux_ujy"], "sigma_ujy": row["sigma_ujy"],
                       "obs_keys": [row["obs_key"]], "detector": row["detector"], "content_type": "measured"})
    return points


def training_document(trial_id: str, spec: dict, doc: dict, doc_bytes: bytes) -> dict:
    kind = spec["kind"]
    points = (body_training if kind == "orbit" else star_training if kind == "star" else brightness_training)(spec, doc)
    points.sort(key=lambda item: (item["t_mjd"], item["obs_keys"][0]))
    return {
        "schema_version": "tenger.training/1",
        "contract_version": 5,
        "trial_id": trial_id,
        "target_key": spec["target"],
        "source": {"path": f"{spec['target']}/investigation.json", "sha256": sha256(doc_bytes)},
        "selection": ("identified single-exposure detections before the holdout window" if kind == "orbit"
                      else "identified single-exposure positions outside the holdout visit" if kind == "star"
                      else "measured single-exposure fluxes outside the holdout visit"),
        "points": points,
    }


def holdout_block(spec: dict, doc: dict) -> dict:
    """Evaluation observations: IDs and times only (metadata)."""
    if spec["kind"] == "orbit":
        inventory = json.loads((ROOT / "docs" / "exposure" / f"{spec['target']}.json").read_text())
        low, high = spec["holdout_window_mjd"]
        rows = [{"obs_key": f"{row['collection']}:{row['obs_id']}:D{row['detector']}",
                 "t_start_mjd": row["t_min_mjd"], "t_end_mjd": row["t_max_mjd"]}
                for row in inventory["candidate_rows"] if low <= row["t_min_mjd"] <= high]
        selection = "holdout.newest-visit-window"
    else:
        keys = holdout_star_keys(doc, spec["holdout_visit"])
        rows = [{"obs_key": obs["obs_key"], "t_start_mjd": obs["t_start_mjd"], "t_end_mjd": obs["t_end_mjd"]}
                for obs in doc["observations"] if obs["obs_key"] in keys]
        selection = "holdout.newest-visit"
    rows.sort(key=lambda item: (item["t_start_mjd"], item["obs_key"]))
    times = [row["t_start_mjd"] for row in rows]
    return {
        "visit": spec.get("holdout_visit"),
        "window_mjd": spec.get("holdout_window_mjd") or ([min(times), max(times)] if times else None),
        "obs": rows,
        "t_mjd": round(float(np.median(times)), 6) if times else None,
        "data_state": "released",
        "check_after_utc": None,
        "selection_rule_key": selection,
    }


# ------------------------------------------------------------------ trial manifest


def scoring_block(spec: dict) -> dict:
    if spec["quantity"] == "brightness":
        return {"kind": "scalar_1d_gaussian", "coverage": 0.95, "z_max": 1.959963984540054,
                "observed": "wavelength-matched flux ratio of the holdout visit to the training reference, "
                            "differential to field stars (A3 photometry rules)",
                "covariance": "sigma^2 = sigma_pred^2 + sigma_obs^2"}
    observed = ("mean over identified holdout exposures of r_i = observed_i - model(t_i, observer_i), "
                "east/north arcsec in the tangent plane at the model position")
    return {"kind": "position_2d_chi2",
            "frame": "tangent plane at the predicted position, east/north arcsec",
            "coverage": 0.95, "threshold_d2": CHI2_95_2D, "threshold_radius": 2.4477468306808166,
            "covariance": "S = C_pred + C_obs",
            "observed": observed,
            "c_obs": "sample covariance of the r_i divided by N (N >= 3), never smaller than the mean "
                     "per-exposure fit covariance divided by N",
            "c_pred": "frozen model covariance at the mean holdout time (parameter covariance scaled by "
                      "max(1, reduced chi-square)) plus sigma_sys^2 per axis for the new visit's own offset",
            "model_evaluation": "the frozen model is evaluated at each identified holdout exposure's time and "
                                "observer position (Earth plus the FITS header spacecraft position)"}


def identification_block(spec: dict) -> dict:
    if spec["kind"] == "orbit":
        return {
            "method_key": "ident.frozen-model-search",
            "rules": [
                "holdout cutouts are centred on the frozen model position at each exposure time (no ephemeris query)",
                "native Gaussian fit (A3), S/N >= 10, within max(15 arcsec, 3 x sqrt(largest C_pred eigenvalue)) of the model",
                "static-source check: the fitted sky position must be empty (S/N < 5) in another holdout exposure of "
                "the same array taken when the model position had moved more than 30 arcsec",
                "two or more distinct sources passing these rules in one exposure -> ambiguous",
                "fewer than 3 identified exposures -> insufficient_data",
            ],
            "alternatives_kept": True,
        }
    return {"method_key": "ident.catalogue-gate",
            "rules": ["A3 rules: quality gate; fit within 3 arcsec of the catalogue track; no other Gaia source "
                      "within 12 arcsec", "fewer than 3 identified exposures -> insufficient_data"],
            "alternatives_kept": True}


def trial_document(trial_id: str, spec: dict, training_bytes: bytes, training: dict, doc: dict,
                   frozen_utc: str, open_spec: dict | None = None) -> dict:
    from scripts.trials import EVALUATION_EXPOSURE, labels_for

    target = spec["target"]
    labels, category = labels_for(target, spec.get("priors", []), open_forecast=open_spec is not None)
    exposure = EVALUATION_EXPOSURE[target]
    inventory_path = ROOT / "docs" / "exposure" / f"{target}.json"
    visits = sorted({point.get("visit") for point in training["points"] if point.get("visit") is not None})
    if open_spec:
        holdout = {"visit": None, "window_mjd": open_spec["window_mjd"], "obs": [], "t_mjd": open_spec["reference_mjd"],
                   "data_state": "not_released", "check_after_utc": open_spec["check_after_utc"],
                   "selection_rule_key": "holdout.next-visit-forecast", "cadence_note": open_spec["cadence_note"]}
    else:
        holdout = holdout_block(spec, doc)
    obs_index = {item["obs_key"]: item for item in doc.get("observations", [])}
    training_obs = sorted({key for point in training["points"] for key in point["obs_keys"]})
    document = {
        "schema_version": "tenger.trial/1",
        "contract_version": 5,
        "trial_id": trial_id,
        "target_key": target,
        "quantity": spec["quantity"],
        "category": category,
        "labels": labels,
        "open_forecast": open_spec is not None,
        "frozen_utc": frozen_utc,
        "exposure": {
            "status": "unexposed" if open_spec else exposure["status"],
            "why": "future visit, not yet observed or released" if open_spec else exposure["why"],
            "inventory_ref": {"path": f"docs/exposure/{target}.json",
                              "sha256": sha256(inventory_path.read_bytes())} if inventory_path.exists() else None,
            "team_statement": {"path": "docs/EXPOSURE.md", "section": "Team confirmation for Task A4",
                               "other_teammates": "not answered yet"},
        },
        "training": {
            "path": f"trials/{trial_id}/training.json",
            "measurements_sha256": sha256(training_bytes),
            "n_points": len(training["points"]),
            "visits": visits,
            "obs": [{"obs_key": key, "source_sha256": (obs_index.get(key) or {}).get("source_sha256")}
                    for key in training_obs],
        },
        "holdout": holdout,
        "permitted_inputs": [
            *spec.get("priors", []),
            {"name": "observer position: Earth (astropy built-in ephemeris) plus spacecraft header position",
             "content_type": "catalogue", "used_for": "observer geometry"},
            {"name": "GM_sun and the speed of light", "content_type": "catalogue", "used_for": "physics"},
        ],
        "model": {
            "id": {"orbit": "heliocentric-two-body", "star": "linear-pm-fixed-parallax",
                   "brightness": "none"}[spec["kind"]],
            "version": "a4-2026-11-14",
            "code_sha256": model_code_sha256(),
            "uncertainty": ("parameter covariance x max(1, reduced chi-square); for stars the larger of the "
                            "exposure-level and the visit-level (per visit and array means) fit; plus "
                            "sigma_sys from the scatter of per-visit-and-array mean residuals"),
            "notes": spec.get("free_parallax_note") or spec.get("ephemeris_use") or spec.get("note"),
        },
        "baseline": {"id": "linear-tangent-plane" if spec["quantity"] == "position" else "constant-flux",
                     "description": "straight-line motion in RA and Dec fitted to the same training positions, "
                                    "no parallax and no orbit" if spec["quantity"] == "position"
                     else "the training mean flux"},
        "scoring": scoring_block(spec),
        "identification": identification_block(spec) if spec["quantity"] == "position" else None,
        "exclusion_rules_keys": ["exclude.quality-gate", "exclude.flagged-pixels", "exclude.identification",
                                 "exclude.contaminated", "exclude.fewer-than-3"],
        "exploratory": bool(spec.get("exploratory")),
        "revises": None,
    }
    if exposure.get("confirmation_pending") and not open_spec and category == "prospective_unexposed":
        document["confirmation_pending"] = True
    if spec.get("ephemeris_use"):
        document["ephemeris_use"] = spec["ephemeris_use"]
    return document


def freeze(trial_id: str, frozen_utc: str | None = None, root: Path = TRIALS_DIR) -> Path:
    from scripts.trials import OPEN_FORECASTS, TRIALS

    open_spec = OPEN_FORECASTS.get(trial_id)
    spec = TRIALS.get(trial_id) or open_spec
    if spec is None:
        raise KeyError(trial_id)
    folder = root / trial_id
    if (folder / "trial.json").exists():
        raise FrozenError(f"{trial_id}: trial.json already frozen")
    doc, doc_bytes = investigation(spec["target"])
    if open_spec:
        base = dict(spec)
        base["holdout_window_mjd"] = [open_spec["window_mjd"][0], open_spec["window_mjd"][1]]
        spec = {**base, "priors": []}
    training = training_document(trial_id, spec, doc, doc_bytes)
    training_bytes = json_bytes(training)
    trial = trial_document(trial_id, spec, training_bytes, training, doc, frozen_utc or _now(), open_spec)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "training.json").write_bytes(training_bytes)
    (folder / "trial.json").write_bytes(json_bytes(trial))
    return folder


# ------------------------------------------------------------------ prediction (reads only the trial folder)


def load_frozen(folder: Path) -> tuple[dict, bytes, dict]:
    trial_bytes = (folder / "trial.json").read_bytes()
    trial = json.loads(trial_bytes)
    training_bytes = (folder / "training.json").read_bytes()
    if sha256(training_bytes) != trial["training"]["measurements_sha256"]:
        raise FrozenError("training.json does not match the frozen trial manifest")
    if model_code_sha256() != trial["model"]["code_sha256"]:
        raise FrozenError("model code changed since the trial was frozen")
    return trial, trial_bytes, json.loads(training_bytes)


def _insufficient(trial: dict, trial_bytes: bytes, reason: str, created_utc: str, extra: dict | None = None) -> dict:
    return {
        "schema_version": "tenger.prediction/1",
        "contract_version": 5,
        "trial_id": trial["trial_id"],
        "trial_ref": {"path": f"trials/{trial['trial_id']}/trial.json", "sha256": sha256(trial_bytes)},
        "training_sha256": trial["training"]["measurements_sha256"],
        "category": trial["category"],
        "labels": trial["labels"],
        "open_forecast": trial["open_forecast"],
        "created_utc": created_utc,
        "prediction_status": "insufficient_data",
        "status_reason_key": reason,
        "t_mjd": trial["holdout"]["t_mjd"],
        "model": None,
        "baseline": None,
        "track": None,
        "diagnostics": extra or {},
        "limitation_keys": [],
    }


def predict(folder: Path, created_utc: str) -> dict:
    trial, trial_bytes, training = load_frozen(folder)
    points = training["points"]
    if trial["quantity"] == "brightness":
        reason = "predict.no-training-measurements" if not points else "predict.no-period-model"
        return _insufficient(trial, trial_bytes, reason, created_utc, {"n_training_points": len(points)})
    visits = {point.get("visit") for point in points}
    if len(points) < MIN_TRAINING_POINTS or len(visits) < MIN_TRAINING_VISITS:
        reason = "predict.no-training-positions" if not points else "predict.too-few-training-positions"
        return _insufficient(trial, trial_bytes, reason, created_utc,
                             {"n_training_points": len(points), "n_training_visits": len(visits)})
    if trial["model"]["id"] == "heliocentric-two-body":
        return _predict_orbit(trial, trial_bytes, points, created_utc)
    return _predict_star(trial, trial_bytes, points, created_utc)


def _sigma_sys(points: list[dict], residuals: np.ndarray) -> float:
    """RMS per axis of the per-(visit, array) mean residuals (conservative: includes their noise)."""
    groups = {}
    for point, residual in zip(points, residuals):
        groups.setdefault((point.get("visit"), point.get("detector")), []).append(residual)
    means = [np.mean(members, axis=0) for members in groups.values() if len(members) >= 2]
    return math.sqrt(float(np.mean(np.square(means)))) if means else 0.0


def _visit_systematic(points: list[dict], ra0: float, dec0: float, t_ref: float, parallax: float | None,
                      pm: tuple[float, float], observer) -> dict:
    """Scatter of training-visit mean positions about the catalogue track (zero point removed).

    Uses the catalogue proper motion and parallax only to estimate how far a whole visit can sit
    from a straight track; the forecast's own motion is still fitted to the training data.
    """
    from backend import astrometry
    from backend.astrometry import tangent_offsets_arcsec

    visits = {}
    for row in points:
        east, north = tangent_offsets_arcsec(ra0, dec0, row["ra_deg"], row["dec_deg"])
        tau = (row["t_mjd"] - t_ref) / 365.25
        pe, pn = astrometry.parallax_factors(ra0, dec0, observer(row["t_mjd"]))
        track = np.array([pm[0] * tau, pm[1] * tau]) + (np.array([pe, pn]) * parallax if parallax else 0.0)
        visits.setdefault(row["visit"], []).append((np.array([east, north]) - track, row))
    means = {visit: np.mean([item[0] for item in members], axis=0) for visit, members in visits.items()}
    if len(means) < 2:
        return {"sigma_visit_arcsec": None, "n_visits": len(means)}
    centre = np.mean(list(means.values()), axis=0)
    residuals = np.array([value - centre for value in means.values()])
    sigma = math.sqrt(float(np.sum(residuals**2)) / (2 * (len(means) - 1)))
    return {"sigma_visit_arcsec": sigma, "n_visits": len(means),
            "visit_offsets_arcsec": {str(visit): [round(float(v), 4) for v in residual]
                                     for visit, residual in zip(means, residuals)}}


def _baseline_linear(points: list[dict], t_eval: list[float]) -> list[dict]:
    """Straight line in the tangent plane at the first point; weights from the fit covariances."""
    from backend.astrometry import tangent_offsets_arcsec, tangent_to_sky

    ra0, dec0 = points[0]["ra_deg"], points[0]["dec_deg"]
    t_ref = float(np.mean([point["t_mjd"] for point in points]))
    rows, values, weights = [], [], []
    for point in points:
        east, north = tangent_offsets_arcsec(ra0, dec0, point["ra_deg"], point["dec_deg"])
        tau = (point["t_mjd"] - t_ref) / 365.25
        rows += [[1, 0, tau, 0], [0, 1, 0, tau]]
        values += [east, north]
        weights.append(np.linalg.inv(np.asarray(point["cov_arcsec2"], float)))
    design, values = np.array(rows, float), np.array(values)
    weight = np.zeros((len(values), len(values)))
    for index, block in enumerate(weights):
        weight[2 * index:2 * index + 2, 2 * index:2 * index + 2] = block
    covariance = np.linalg.inv(design.T @ weight @ design)
    params = covariance @ design.T @ weight @ values
    residual = values - design @ params
    chi2_red = float(residual @ weight @ residual) / max(1, len(values) - 4)
    covariance = covariance * max(1.0, chi2_red)
    out = []
    for t in t_eval:
        tau = (t - t_ref) / 365.25
        jac = np.array([[1, 0, tau, 0], [0, 1, 0, tau]], float)
        east, north = jac @ params
        ra, dec = tangent_to_sky(ra0, dec0, float(east), float(north))
        out.append({"t_mjd": _r(t), "ra_deg": _r(ra, 8), "dec_deg": _r(dec, 8),
                    "cov_arcsec2": _cov(jac @ covariance @ jac.T), "content_type": "modeled"})
    return out, {"chi2_red": round(chi2_red, 4), "params_arcsec": [round(float(v), 5) for v in params]}


def _predict_orbit(trial: dict, trial_bytes: bytes, points: list[dict], created_utc: str) -> dict:
    from backend import orbit
    from backend.astrometry import tangent_offsets_arcsec

    observations = [orbit.Observation(point["t_mjd"], point["ra_deg"], point["dec_deg"],
                                      np.asarray(point["cov_arcsec2"], float),
                                      orbit.observer_heliocentric_au(point["t_mjd"], point.get("spacecraft_km")))
                    for point in points]
    search = orbit.multistart(observations)
    if search["status"] != "fitted" or search["best"]["covariance"] is None:
        return _insufficient(trial, trial_bytes, "predict.orbit-unconstrained", created_utc,
                             {"n_training_points": len(points)})
    best = search["best"]
    residuals = []
    for obs in observations:
        ra, dec = orbit.apparent_radec(best["state"], best["t0"], obs.mjd, obs.observer_helio_au)
        residuals.append(tangent_offsets_arcsec(ra, dec, obs.ra_deg, obs.dec_deg))
    residuals = np.array(residuals)
    sigma_sys = _sigma_sys(points, residuals)
    holdout = trial["holdout"]
    t_ref = holdout["t_mjd"]
    times = [t_ref]
    if trial["open_forecast"]:
        low, high = holdout["window_mjd"]
        times += list(np.arange(low, high + 1e-9, 5.0))
    observer_terms = []
    track = []
    for t in times:
        observer = orbit.observer_heliocentric_au(float(t), None)
        distance = None
        prediction = orbit.predict(best, float(t), observer)
        body = orbit.propagate(best["state"], best["t0"], np.array([float(t)]))[0]
        distance = float(np.linalg.norm(body - observer))
        spacecraft_sigma = SPACECRAFT_KM / orbit.KM_PER_AU / distance * orbit.ARCSEC_PER_RAD / math.sqrt(3)
        covariance = prediction["cov_arcsec2"] + np.eye(2) * (sigma_sys**2 + spacecraft_sigma**2)
        observer_terms.append(spacecraft_sigma)
        track.append({"t_mjd": _r(t), "ra_deg": _r(prediction["ra_deg"], 8), "dec_deg": _r(prediction["dec_deg"], 8),
                      "cov_arcsec2": _cov(covariance), "distance_au": _r(distance, 4), "content_type": "modeled"})
    # Sensitivity to starting values: every converged solution near the best, evaluated at t_ref.
    spread = []
    for solution in search["near_best"]:
        alt = orbit.predict(solution, t_ref, orbit.observer_heliocentric_au(t_ref, None))
        spread.append(math.hypot(*tangent_offsets_arcsec(track[0]["ra_deg"], track[0]["dec_deg"], alt["ra_deg"], alt["dec_deg"])))
    baseline, baseline_info = _baseline_linear(points, times)
    document = {
        "schema_version": "tenger.prediction/1",
        "contract_version": 5,
        "trial_id": trial["trial_id"],
        "trial_ref": {"path": f"trials/{trial['trial_id']}/trial.json", "sha256": sha256(trial_bytes)},
        "training_sha256": trial["training"]["measurements_sha256"],
        "category": trial["category"],
        "labels": trial["labels"],
        "open_forecast": trial["open_forecast"],
        "created_utc": created_utc,
        "prediction_status": "predicted",
        "status_reason_key": None,
        "t_mjd": _r(t_ref),
        "model": {**{key: track[0][key] for key in ("ra_deg", "dec_deg", "cov_arcsec2")},
                  "observer": "geocentre; spacecraft offset folded into the covariance", "content_type": "modeled"},
        "baseline": {**{key: baseline[0][key] for key in ("ra_deg", "dec_deg", "cov_arcsec2")}, "content_type": "modeled"},
        "track": track[1:] if trial["open_forecast"] else None,
        "baseline_track": baseline[1:] if trial["open_forecast"] else None,
        "model_state": {
            "kind": "heliocentric_two_body", "frame": "ICRS heliocentric", "t0_mjd_utc": _r(best["t0"]),
            "state_au_au_per_day": [float(value) for value in best["state"]],
            "covariance": [[float(value) for value in row] for row in best["covariance"] * max(1.0, best["chi2_red"])],
            "gm_sun_au3_day2": orbit.GM_SUN, "light_time": True, "aberration": False,
            "sigma_sys_arcsec": round(sigma_sys, 4),
        },
        "diagnostics": {
            "n_training_points": len(points),
            "chi2": round(best["chi2"], 4), "dof": best["dof"], "chi2_red": round(best["chi2_red"], 4),
            "heliocentric_distance_au": round(best["heliocentric_distance_au"], 4), "bound": best["bound"],
            "start_distances_au": [solution["start_distance_au"] for solution in search["solutions"]],
            "converged_chi2": [round(solution["chi2"], 3) for solution in search["solutions"]],
            "near_best_prediction_spread_arcsec": round(max(spread), 6) if spread else None,
            "training_residuals_rms_arcsec": [round(float(v), 4) for v in np.sqrt((residuals**2).mean(axis=0))],
            "baseline": baseline_info,
            "spacecraft_sigma_arcsec": round(observer_terms[0], 4),
        },
        "limitation_keys": ["limit.two-body-only", "limit.gaussian-psf-model", "limit.ephemeris-guided-training"],
    }
    return document


def _predict_star(trial: dict, trial_bytes: bytes, points: list[dict], created_utc: str) -> dict:
    from backend import astrometry
    from backend.astrometry import tangent_offsets_arcsec, tangent_to_sky

    priors = [item for item in trial["permitted_inputs"] if item.get("used_for") == "fixed parallax"]
    parallax = float(priors[0]["value_mas"]) / 1000 if priors else None
    ra0, dec0 = points[0]["ra_deg"], points[0]["dec_deg"]
    t_ref = float(np.median([point["t_mjd"] for point in points]))

    def observer(t):
        return astrometry.observer_barycentric_au(t, None)

    def as_points(rows):
        return [astrometry.Point(row["t_mjd"], *tangent_offsets_arcsec(ra0, dec0, row["ra_deg"], row["dec_deg"]),
                                 np.asarray(row["cov_arcsec2"], float), observer(row["t_mjd"])) for row in rows]

    exposure_fit = astrometry.fit_motion(as_points(points), ra0, dec0, t_ref, parallax)
    groups = {}
    for point in points:
        groups.setdefault((point["visit"], point["detector"]), []).append(point)
    group_points = []
    for members in groups.values():
        if len(members) < 2:
            continue
        offsets = np.array([tangent_offsets_arcsec(ra0, dec0, row["ra_deg"], row["dec_deg"]) for row in members])
        mjd = float(np.mean([row["t_mjd"] for row in members]))
        mean_observer = np.mean([observer(row["t_mjd"]) for row in members], axis=0)
        group_points.append(astrometry.Point(mjd, float(offsets[:, 0].mean()), float(offsets[:, 1].mean()),
                                             np.cov(offsets.T) / len(members) + np.eye(2) * 1e-6, mean_observer))
    visit_fit = astrometry.fit_motion(group_points, ra0, dec0, t_ref, parallax) if len(group_points) >= 3 else None
    if exposure_fit.get("status") != "measured":
        return _insufficient(trial, trial_bytes, exposure_fit.get("reason_key") or "predict.fit-failed", created_utc)
    residuals = np.array(exposure_fit["residuals_arcsec"])
    sigma_sys = _sigma_sys(points, residuals)
    t_eval = trial["holdout"]["t_mjd"]

    def predicted(fit):
        tau = (t_eval - t_ref) / 365.25
        pe, pn = astrometry.parallax_factors(ra0, dec0, observer(t_eval))
        params = np.array([fit["params"][k] for k in ("east0", "north0", "pm_east_arcsec_yr", "pm_north_arcsec_yr")])
        jac = np.array([[1, 0, tau, 0], [0, 1, 0, tau]], float)
        east, north = jac @ params + (np.array([pe, pn]) * parallax if parallax else 0.0)
        covariance = jac @ (np.array(fit["cov"]) * max(1.0, fit["chi2_red"])) @ jac.T
        return float(east), float(north), covariance

    east, north, cov_exposure = predicted(exposure_fit)
    candidates = {"exposure": cov_exposure + np.eye(2) * sigma_sys**2}
    if visit_fit and visit_fit.get("status") == "measured":
        _, _, cov_visit = predicted(visit_fit)
        candidates["visit"] = cov_visit + np.eye(2) * sigma_sys**2
    track_prior = [item for item in trial["permitted_inputs"]
                   if item.get("used_for", "").startswith("visit-level systematic")]
    systematic = {"sigma_visit_arcsec": None}
    if track_prior:
        pm = (track_prior[0]["pmra_mas_yr"] / 1000, track_prior[0]["pmdec_mas_yr"] / 1000)
        systematic = _visit_systematic(points, ra0, dec0, t_ref, parallax, pm, observer)
        if systematic["sigma_visit_arcsec"]:
            candidates["visit_systematic"] = _visit_mean_covariance(points, ra0, dec0, t_ref, t_eval, parallax,
                                                                     observer, systematic["sigma_visit_arcsec"])
    basis = max(candidates, key=lambda name: np.trace(candidates[name]))
    covariance = candidates[basis]
    ra, dec = tangent_to_sky(ra0, dec0, east, north)
    baseline, baseline_info = _baseline_linear(points, [t_eval])
    return {
        "schema_version": "tenger.prediction/1",
        "contract_version": 5,
        "trial_id": trial["trial_id"],
        "trial_ref": {"path": f"trials/{trial['trial_id']}/trial.json", "sha256": sha256(trial_bytes)},
        "training_sha256": trial["training"]["measurements_sha256"],
        "category": trial["category"],
        "labels": trial["labels"],
        "open_forecast": False,
        "created_utc": created_utc,
        "prediction_status": "predicted",
        "status_reason_key": None,
        "t_mjd": _r(t_eval),
        "model": {"ra_deg": _r(ra, 8), "dec_deg": _r(dec, 8), "cov_arcsec2": _cov(covariance),
                  "observer": "geocentre (spacecraft parallax below 0.0001 arcsec for stars)", "content_type": "modeled"},
        "baseline": {key: baseline[0][key] for key in ("ra_deg", "dec_deg", "cov_arcsec2", "content_type")},
        "track": None,
        "model_state": {
            "kind": "linear_pm_fixed_parallax", "reference": {"ra_deg": ra0, "dec_deg": dec0, "t_ref_mjd": t_ref},
            "params_arcsec": {key: float(exposure_fit["params"][key]) for key in exposure_fit["params"]},
            "covariance_arcsec": [[float(v) for v in row] for row in
                                  (np.array((visit_fit if basis == "visit" else exposure_fit)["cov"])
                                   * max(1.0, (visit_fit if basis == "visit" else exposure_fit)["chi2_red"]))],
            "parallax_arcsec": parallax, "sigma_sys_arcsec": round(sigma_sys, 4), "sigma_basis": basis,
            "visit_systematic": {key: (round(value, 4) if isinstance(value, float) else value)
                                 for key, value in systematic.items()},
            "covariance_candidates_trace": {name: round(float(np.trace(value)), 5) for name, value in candidates.items()},
        },
        "diagnostics": {
            "n_training_points": len(points), "n_groups": len(group_points),
            "exposure_fit_chi2_red": round(exposure_fit["chi2_red"], 4),
            "visit_fit_chi2_red": round(visit_fit["chi2_red"], 4) if visit_fit and visit_fit.get("status") == "measured" else None,
            "pm_arcsec_yr": [round(exposure_fit["params"]["pm_east_arcsec_yr"], 5),
                             round(exposure_fit["params"]["pm_north_arcsec_yr"], 5)],
            "training_residuals_rms_arcsec": [round(float(v), 4) for v in np.sqrt((residuals**2).mean(axis=0))],
            "baseline": baseline_info,
        },
        "limitation_keys": ["limit.parallax-from-catalogue", "limit.gaussian-psf-model", "limit.catalogue-assisted-identification"],
    }


def _visit_mean_covariance(points, ra0, dec0, t_ref, t_eval, parallax, observer, sigma_visit) -> np.ndarray:
    """Forecast covariance when each visit's mean carries an independent offset of sigma_visit.

    Weighted least squares on one mean position per training visit (offset + proper motion),
    propagated to t_eval, plus sigma_visit^2 for the evaluation visit's own offset.
    """
    from backend import astrometry
    from backend.astrometry import tangent_offsets_arcsec

    visits = {}
    for row in points:
        visits.setdefault(row["visit"], []).append(row)
    rows, weights = [], []
    for members in visits.values():
        offsets = np.array([tangent_offsets_arcsec(ra0, dec0, row["ra_deg"], row["dec_deg"]) for row in members])
        tau = (float(np.mean([row["t_mjd"] for row in members])) - t_ref) / 365.25
        statistical = np.cov(offsets.T) / len(members) if len(members) > 1 else np.eye(2) * 0.1
        rows += [[1, 0, tau, 0], [0, 1, 0, tau]]
        weights.append(np.linalg.inv(statistical + np.eye(2) * sigma_visit**2))
    design = np.array(rows, float)
    weight = np.zeros((design.shape[0], design.shape[0]))
    for index, block in enumerate(weights):
        weight[2 * index:2 * index + 2, 2 * index:2 * index + 2] = block
    parameter_cov = np.linalg.pinv(design.T @ weight @ design)
    tau = (t_eval - t_ref) / 365.25
    jac = np.array([[1, 0, tau, 0], [0, 1, 0, tau]], float)
    return jac @ parameter_cov @ jac.T + np.eye(2) * sigma_visit**2


def write_prediction(trial_id: str, created_utc: str | None = None, root: Path = TRIALS_DIR) -> Path:
    folder = root / trial_id
    path = folder / "prediction.json"
    if path.exists():
        raise FrozenError(f"{trial_id}: prediction.json already exists and is never rewritten")
    document = predict(folder, created_utc or _now())
    path.write_bytes(json_bytes(document))
    return path


# ------------------------------------------------------------------ receipts and checks


def _git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()


def write_receipt(trial_id: str, remote: str = "origin", branch: str = "tenger-dev") -> Path:
    folder = TRIALS_DIR / trial_id
    if (folder / "receipt.json").exists():
        raise FrozenError(f"{trial_id}: receipt already written")
    relative = f"static/data/trials/{trial_id}/prediction.json"
    commit = _git("log", "-1", "--format=%H", "--", relative)
    if not commit:
        raise FrozenError(f"{trial_id}: prediction.json is not committed")
    committed = _git("show", "-s", "--format=%cI", commit)
    data = (folder / "prediction.json").read_bytes()
    committed_bytes = subprocess.run(["git", "show", f"{commit}:{relative}"], cwd=ROOT, check=True,
                                     capture_output=True).stdout
    if committed_bytes != data:
        raise FrozenError(f"{trial_id}: prediction.json differs from the committed bytes")
    on_remote = bool(_git("branch", "-r", "--contains", commit, "--list", f"{remote}/{branch}"))
    receipt = {
        "schema_version": "tenger.receipt/1",
        "contract_version": 5,
        "trial_id": trial_id,
        "prediction_path": f"trials/{trial_id}/prediction.json",
        "prediction_sha256": sha256(data),
        "commit": commit,
        "committed_utc": datetime.fromisoformat(committed).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "pushed": {"remote": remote, "branch": branch, "utc": _now() if on_remote else None},
    }
    (folder / "receipt.json").write_bytes(json_bytes(receipt))
    return folder / "receipt.json"


def check(trial_id: str, root: Path = TRIALS_DIR) -> list[str]:
    """Problems in the hash chain trial -> training -> prediction -> receipt (empty list = intact)."""
    folder = root / trial_id
    problems = []
    trial_bytes = (folder / "trial.json").read_bytes()
    trial = json.loads(trial_bytes)
    training_path = folder / "training.json"
    if sha256(training_path.read_bytes()) != trial["training"]["measurements_sha256"]:
        problems.append("training.json hash differs from trial.training.measurements_sha256")
    prediction_path = folder / "prediction.json"
    if prediction_path.exists():
        prediction_bytes = prediction_path.read_bytes()
        prediction = json.loads(prediction_bytes)
        if prediction["trial_ref"]["sha256"] != sha256(trial_bytes):
            problems.append("trial.json hash differs from prediction.trial_ref.sha256")
        receipt_path = folder / "receipt.json"
        if receipt_path.exists():
            receipt = json.loads(receipt_path.read_bytes())
            if receipt["prediction_sha256"] != sha256(prediction_bytes):
                problems.append("prediction.json hash differs from receipt.prediction_sha256")
    return problems


def main(argv=None) -> int:
    from scripts.trials import OPEN_FORECASTS, TRIALS

    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["freeze", "predict", "receipt", "check"])
    parser.add_argument("trial_ids", nargs="*")
    parser.add_argument("--created-utc")
    args = parser.parse_args(argv)
    ids = args.trial_ids
    if ids == ["all"] or (not ids and args.action == "check"):
        ids = sorted({*TRIALS, *OPEN_FORECASTS}) if args.action != "check" else sorted(
            path.name for path in TRIALS_DIR.iterdir() if (path / "trial.json").exists())
    status = 0
    for trial_id in ids:
        if args.action == "freeze":
            print(freeze(trial_id))
        elif args.action == "predict":
            print(write_prediction(trial_id, args.created_utc))
        elif args.action == "receipt":
            print(write_receipt(trial_id))
        else:
            problems = check(trial_id)
            print(trial_id, "intact" if not problems else problems)
            status |= bool(problems)
    return status


if __name__ == "__main__":
    sys.exit(main())
