"""Pluto open forecast v2 and the matching exploratory hindcast (Task A7).

Usage:
  python -m scripts.forecast_v2 freeze              # training.json + trial.json for both v2 forecasts
  python -m scripts.forecast_v2 predict             # prediction.json (reads only each trial folder)
  python -m scripts.forecast_v2 receipt             # receipts (after the prediction commit is pushed)
  python -m scripts.forecast_v2 hindcast            # exploratory: method v2 on training visits only -> 2026 visit

Method v2 (lessons of docs/postmortem-pluto.md):
- barycentric two-body orbit (solar-system mass at the barycentre); observer = Earth + spacecraft;
- uncertainty from whole (visit x array) groups: Monte Carlo with an independent offset per group
  (sigma_g = max(RMS of per-group mean residuals, 0.2 arcsec)) plus resampling exposures within each
  group, and a leave-one-group-out jackknife; the larger (trace) is used, then sigma_g^2 is added for
  the new visit's own offset and the unknown spacecraft position for future times;
- along-track and cross-track sizes reported separately.
Nothing here edits a v1 file. Open forecasts are never counted in the scoreboard.
"""
import argparse
import hashlib
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from backend import astrometry, orbit
from backend.astrometry import tangent_offsets_arcsec, tangent_to_sky
from scripts import postmortem, predict

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "static" / "data"
TRIALS = DATA / "trials"
V1_TRIAL = "pluto-position-2026b"
V1_OPEN = "pluto-position-open-2027a"
CODE_FILES = ("scripts/forecast_v2.py", "scripts/postmortem.py", "backend/orbit.py", "backend/astrometry.py")
SIGMA_G_FLOOR_ARCSEC = 0.2
MC_DRAWS = 300
SEED = 20261115
LABEL = "made after the 2026 miss, using its lessons; check when IRSA releases the data"
FORECASTS = {
    "pluto-position-open-2027a-v2": {"reference_mjd": 61520.0, "window_mjd": [61490.0, 61550.0],
                                      "check_after_utc": "2027-05-15",
                                      "cadence_note": "Pluto visits so far start near 04-25 and 09-29 each year"},
    "pluto-position-open-2027b-v2": {"reference_mjd": 61677.0, "window_mjd": [61647.0, 61707.0],
                                      "check_after_utc": "2027-10-20",
                                      "cadence_note": "Pluto visits so far start near 04-25 and 09-29 each year"},
}
STEP_DAYS = 5.0


def code_sha256() -> str:
    digest = hashlib.sha256()
    for name in CODE_FILES:
        digest.update(name.encode() + b"\0" + (ROOT / name).read_bytes())
    return digest.hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _r(value, digits=6):
    return None if value is None else round(float(value), digits)


def _cov(matrix):
    return [[round(float(v), 6) for v in row] for row in np.asarray(matrix, float)]


# ------------------------------------------------------------------ data


def evaluation_points() -> list[dict]:
    """The 4 identified 2026 detections, re-measured from the cached native products (same pipeline)."""
    from backend import config
    from backend.processing import load_product

    verification = json.loads((TRIALS / V1_TRIAL / "verification.json").read_text())
    identified = {c["obs_key"]: next(x for x in c["candidates"] if x["passes"])
                  for c in verification["candidates"] if any(x["passes"] for x in c["candidates"])}
    points = []
    for key in verification["observed"]["obs_keys"]:
        meta = json.loads((config.CACHE_DIR / "bodies" / "pluto-eval" / f"{key.replace(':', '__')}.json").read_text())
        product = load_product((config.CACHE_DIR / meta["native"]).read_bytes())
        found = identified[key]
        position = astrometry.fit_position(product, found["ra_deg"], found["dec_deg"], product.info.get("PSF_FWHM"))
        spacecraft = [product.info.get(axis) for axis in ("X_SC", "Y_SC", "Z_SC")]
        points.append({"t_mjd": round(float(product.info.get("MJD-AVG", meta["t_min_mjd"])), 6),
                       "ra_deg": position.ra_deg, "dec_deg": position.dec_deg, "cov_arcsec2": position.cov_arcsec2,
                       "obs_keys": [key], "visit": 3, "detector": meta["detector"],
                       "spacecraft_km": [round(float(v), 3) for v in spacecraft], "content_type": "measured",
                       "source": "A5 verification (identified), re-measured with the A3 fit"})
    return points


def training_points() -> list[dict]:
    return json.loads((TRIALS / V1_TRIAL / "training.json").read_text())["points"]


# ------------------------------------------------------------------ method v2


class MethodV2:
    def __init__(self, points: list[dict], ephemeris: postmortem.Ephemeris):
        self.points = sorted(points, key=lambda p: (p["t_mjd"], p["obs_keys"][0]))
        self.ephemeris = ephemeris
        self.model = postmortem.Model("barycentric_two_body", ephemeris)
        self.observers = [self.model.observer(p["t_mjd"], None, orbit.observer_heliocentric_au(p["t_mjd"], p.get("spacecraft_km")))
                          for p in self.points]
        self.t0 = self.points[0]["t_mjd"]

    def start_state(self, frozen_helio: np.ndarray, t0_helio: float) -> np.ndarray:
        state = orbit.propagate(frozen_helio, t0_helio, np.array([self.t0]))[0]
        # velocity at t0 from a short finite difference of the heliocentric two-body path
        ahead = orbit.propagate(frozen_helio, t0_helio, np.array([self.t0 + 0.5]))[0]
        behind = orbit.propagate(frozen_helio, t0_helio, np.array([self.t0 - 0.5]))[0]
        helio = np.concatenate([state, ahead - behind])
        return helio + np.concatenate([self.ephemeris.position("sun", self.t0), self.ephemeris.velocity("sun", self.t0)])

    def fit(self, points, observers, start) -> dict:
        return postmortem.fit(self.model, points, observers, start, self.t0)

    def radec(self, solution, t, observer_bary):
        body_at = self.model.solve(solution["state"], solution["t0"], t, t)
        return self.model.radec(body_at, t, observer_bary)

    def observer_future(self, t):
        return self.model.observer(t, None, orbit.observer_heliocentric_au(t, None))

    def motion_direction(self, solution, t, observers) -> np.ndarray:
        before = self.radec(solution, t - 0.5, self.observer_future(t - 0.5))
        after = self.radec(solution, t + 0.5, self.observer_future(t + 0.5))
        motion = np.array(tangent_offsets_arcsec(*before, *after))
        return motion / np.linalg.norm(motion)

    def groups(self):
        out = {}
        for index, point in enumerate(self.points):
            out.setdefault((point["visit"], point["detector"]), []).append(index)
        return out

    def run(self, times: list[float], start: np.ndarray, observers_at: dict | None = None) -> dict:
        """Best fit, group Monte Carlo and jackknife; predictions and covariances at every time."""
        observers_at = observers_at or {}
        best = self.fit(self.points, self.observers, start)
        residuals = []
        for point, observer in zip(self.points, self.observers):
            ra, dec = self.radec(best, point["t_mjd"], observer)
            residuals.append(tangent_offsets_arcsec(ra, dec, point["ra_deg"], point["dec_deg"]))
        residuals = np.array(residuals)
        groups = self.groups()
        group_means = {f"{visit}-d{detector}": residuals[idx].mean(axis=0) for (visit, detector), idx in groups.items()}
        rms = math.sqrt(float(np.mean([np.square(mean).mean() for mean in group_means.values()])))
        sigma_g = max(rms, SIGMA_G_FLOOR_ARCSEC)
        observers = {t: observers_at.get(t, self.observer_future(t)) for t in times}
        centre = {t: self.radec(best, t, observers[t]) for t in times}

        def predictions(solution):
            return {t: tangent_offsets_arcsec(*centre[t], *self.radec(solution, t, observers[t])) for t in times}

        rng = np.random.default_rng(SEED)
        draws = {t: [] for t in times}
        for _ in range(MC_DRAWS):
            moved_points, moved_observers = [], []
            for key, idx in groups.items():
                offset = rng.normal(0, sigma_g, 2)
                chosen = rng.choice(idx, size=len(idx), replace=True)
                for index in chosen:
                    point = self.points[index]
                    ra, dec = tangent_to_sky(point["ra_deg"], point["dec_deg"], *offset)
                    moved_points.append({**point, "ra_deg": ra, "dec_deg": dec})
                    moved_observers.append(self.observers[index])
            solution = self.fit(moved_points, moved_observers, best["state"])
            for t, value in predictions(solution).items():
                draws[t].append(value)
        jack = {t: [] for t in times}
        for key, idx in groups.items():
            keep = [i for i in range(len(self.points)) if i not in set(idx)]
            if len({self.points[i]["visit"] for i in keep}) < 2:
                continue
            solution = self.fit([self.points[i] for i in keep], [self.observers[i] for i in keep], best["state"])
            for t, value in predictions(solution).items():
                jack[t].append(value)
        out = {}
        n_groups = len(jack[times[0]])
        for t in times:
            c_mc = np.cov(np.array(draws[t]).T)
            values = np.array(jack[t])
            c_jack = (n_groups - 1) / n_groups * ((values - values.mean(axis=0)).T @ (values - values.mean(axis=0)))
            along = self.motion_direction(best, t, observers)
            cross = np.array([-along[1], along[0]])
            # Envelope: the larger of the two estimates along the track and, separately, across it.
            var_along = max(along @ c_mc @ along, along @ c_jack @ along)
            var_cross = max(cross @ c_mc @ cross, cross @ c_jack @ cross)
            chosen = var_along * np.outer(along, along) + var_cross * np.outer(cross, cross)
            basis = {"along": "monte_carlo" if along @ c_mc @ along >= along @ c_jack @ along else "jackknife",
                     "cross": "monte_carlo" if cross @ c_mc @ cross >= cross @ c_jack @ cross else "jackknife"}
            out[t] = {"ra_deg": centre[t][0], "dec_deg": centre[t][1], "c_parameters": chosen, "basis": basis,
                      "c_monte_carlo": c_mc, "c_jackknife": c_jack}
        return {"best": best, "times": out, "sigma_g": sigma_g, "group_residual_rms": rms,
                "group_means": {k: [round(float(v), 4) for v in m] for k, m in group_means.items()},
                "chi2_red": best["chi2_red"], "n_points": len(self.points), "n_groups": len(groups),
                "jackknife_groups": n_groups, "residual_rms": [round(float(v), 4) for v in np.sqrt((residuals**2).mean(axis=0))]}


def along_cross(method: MethodV2, solution, t, observer_fn, cov) -> dict:
    before = method.radec(solution, t - 0.5, observer_fn(t - 0.5))
    after = method.radec(solution, t + 0.5, observer_fn(t + 0.5))
    motion = np.array(tangent_offsets_arcsec(*before, *after))
    along = motion / np.linalg.norm(motion)
    cross = np.array([-along[1], along[0]])
    k = 2.4477468306808166
    return {"along_track_95_arcsec": _r(k * math.sqrt(along @ cov @ along), 3),
            "cross_track_95_arcsec": _r(k * math.sqrt(cross @ cov @ cross), 3),
            "motion_arcsec_per_day": _r(np.linalg.norm(motion), 3),
            "motion_position_angle_deg": _r(math.degrees(math.atan2(motion[0], motion[1])) % 360, 2)}


def spacecraft_sigma(distance_au: float) -> float:
    return predict.SPACECRAFT_KM / orbit.KM_PER_AU / distance_au * orbit.ARCSEC_PER_RAD / math.sqrt(3)


def frozen_v1_start() -> tuple[np.ndarray, float]:
    prediction = json.loads((TRIALS / V1_TRIAL / "prediction.json").read_text())
    state = prediction["model_state"]
    return np.array(state["state_au_au_per_day"]), state["t0_mjd_utc"]


# ------------------------------------------------------------------ freeze / predict / receipt


def freeze(frozen_utc: str | None = None) -> list[Path]:
    points = training_points() + evaluation_points()
    ordered = sorted(points, key=lambda p: (p["t_mjd"], p["obs_keys"][0]))
    # Starting values only (the fit converges to one solution from 5-100 au starts, A4); stored so that
    # prediction reads nothing outside the trial folder.
    helio, t0_helio = frozen_v1_start()
    start_method = MethodV2(ordered, postmortem.Ephemeris(ordered[0]["t_mjd"] - 30, ordered[-1]["t_mjd"] + 30))
    start = start_method.start_state(helio, t0_helio)
    made = []
    for trial_id, spec in FORECASTS.items():
        folder = TRIALS / trial_id
        if (folder / "trial.json").exists():
            raise predict.FrozenError(f"{trial_id}: already frozen")
        training = {"schema_version": "tenger.training/1", "contract_version": 11, "trial_id": trial_id,
                    "target_key": "pluto",
                    "source": {"training": {"path": f"trials/{V1_TRIAL}/training.json",
                                            "sha256": predict.sha256((TRIALS / V1_TRIAL / 'training.json').read_bytes())},
                               "evaluation_2026": {"path": f"trials/{V1_TRIAL}/verification.json",
                                                   "sha256": predict.sha256((TRIALS / V1_TRIAL / 'verification.json').read_bytes())}},
                    "selection": "all Pluto detections we hold: 50 training detections (2 visits) and the 4 "
                                 "identified detections of the opened 2026 evaluation visit",
                    "points": sorted(points, key=lambda p: (p["t_mjd"], p["obs_keys"][0]))}
        training_bytes = predict.json_bytes(training)
        trial = {
            "schema_version": "tenger.trial/1", "contract_version": 11, "trial_id": trial_id, "target_key": "pluto",
            "quantity": "position", "category": "prospective_unexposed", "labels": ["prospective_unexposed"],
            "open_forecast": True, "forecast_label_key": "forecast.after-2026-miss", "method_version": 2,
            "revises": V1_OPEN,
            "frozen_utc": frozen_utc or _now(),
            "exposure": {"status": "unexposed", "why": "future visit, not yet observed or released"},
            "training": {"path": f"trials/{trial_id}/training.json", "measurements_sha256": predict.sha256(training_bytes),
                         "n_points": len(training["points"]), "visits": sorted({p["visit"] for p in training["points"]})},
            "holdout": {"visit": None, "window_mjd": spec["window_mjd"], "obs": [], "t_mjd": spec["reference_mjd"],
                        "data_state": "not_released", "check_after_utc": spec["check_after_utc"],
                        "selection_rule_key": "holdout.next-visit-forecast", "cadence_note": spec["cadence_note"]},
            "permitted_inputs": [
                {"name": "observer position: Earth (astropy built-in) plus spacecraft header position", "content_type": "catalogue",
                 "used_for": "observer geometry"},
                {"name": "Sun's barycentric position (astropy built-in) and solar-system mass", "content_type": "catalogue",
                 "used_for": "barycentric frame"}],
            "model": {"id": "barycentric-two-body-group-resampled", "version": "a7-2026-11-15", "code_sha256": code_sha256(),
                      "code_files": list(CODE_FILES),
                      "uncertainty": "larger of group Monte Carlo (offset per visit x array group, sigma_g = max(RMS of "
                                     f"group mean residuals, {SIGMA_G_FLOOR_ARCSEC} arcsec), exposures resampled within "
                                     "groups) and leave-one-group-out jackknife; plus sigma_g^2 and the unknown "
                                     "spacecraft position", "lessons": "docs/postmortem-pluto.md"},
            "baseline": {"id": "linear-tangent-plane", "description": "straight line in RA/Dec fitted to the same positions"},
            "scoring": predict.scoring_block({"quantity": "position"}),
            "identification": predict.identification_block({"kind": "orbit"}),
            "exclusion_rules_keys": ["exclude.quality-gate", "exclude.flagged-pixels", "exclude.identification",
                                     "exclude.contaminated", "exclude.fewer-than-3"],
            "exploratory": False,
        }
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "training.json").write_bytes(training_bytes)
        (folder / "trial.json").write_bytes(predict.json_bytes(trial))
        made.append(folder)
    return made


def predict_v2(trial_id: str, created_utc: str | None = None) -> Path:
    folder = TRIALS / trial_id
    if (folder / "prediction.json").exists():
        raise predict.FrozenError(f"{trial_id}: prediction.json already exists")
    trial_bytes = (folder / "trial.json").read_bytes()
    trial = json.loads(trial_bytes)
    training_bytes = (folder / "training.json").read_bytes()
    if predict.sha256(training_bytes) != trial["training"]["measurements_sha256"]:
        raise predict.FrozenError("training.json changed")
    if code_sha256() != trial["model"]["code_sha256"]:
        raise predict.FrozenError("v2 model code changed since the freeze")
    points = json.loads(training_bytes)["points"]
    low, high = trial["holdout"]["window_mjd"]
    times = [trial["holdout"]["t_mjd"], *list(np.arange(low, high + 1e-9, STEP_DAYS))]
    method = MethodV2(points, postmortem.Ephemeris(min(p["t_mjd"] for p in points) - 30, high + 30))
    result = method.run(times, np.array(trial["model"]["start_state_bary_au_au_per_day"]))
    track = []
    for t in times:
        entry = result["times"][t]
        observer = method.observer_future(t)
        body = method.model.solve(result["best"]["state"], result["best"]["t0"], t, t)(t)
        distance = float(np.linalg.norm(body - observer))
        cov = entry["c_parameters"] + np.eye(2) * (result["sigma_g"] ** 2 + spacecraft_sigma(distance) ** 2)
        track.append({"t_mjd": _r(t), "ra_deg": _r(entry["ra_deg"], 8), "dec_deg": _r(entry["dec_deg"], 8),
                      "cov_arcsec2": _cov(cov), "uncertainty_basis": entry["basis"], "distance_au": _r(distance, 4),
                      **along_cross(method, result["best"], t, method.observer_future, cov), "content_type": "modeled"})
    baseline, baseline_info = predict._baseline_linear(points, times)
    document = {
        "schema_version": "tenger.prediction/1", "contract_version": 11, "trial_id": trial_id,
        "trial_ref": {"path": f"trials/{trial_id}/trial.json", "sha256": predict.sha256(trial_bytes)},
        "training_sha256": trial["training"]["measurements_sha256"], "category": trial["category"],
        "labels": trial["labels"], "open_forecast": True, "forecast_label_key": "forecast.after-2026-miss", "method_version": 2,
        "revises": trial["revises"], "created_utc": created_utc or _now(), "prediction_status": "predicted",
        "status_reason_key": None, "t_mjd": _r(times[0]),
        "model": {key: track[0][key] for key in ("ra_deg", "dec_deg", "cov_arcsec2", "along_track_95_arcsec",
                                                 "cross_track_95_arcsec", "uncertainty_basis")} | {"content_type": "modeled",
                                                                                                    "observer": "geocentre; spacecraft offset in the covariance"},
        "baseline": {key: baseline[0][key] for key in ("ra_deg", "dec_deg", "cov_arcsec2")} | {"content_type": "modeled"},
        "track": track[1:], "baseline_track": baseline[1:],
        "model_state": {"kind": "barycentric_two_body", "frame": "ICRS barycentric", "t0_mjd_utc": _r(result["best"]["t0"]),
                        "state_au_au_per_day": [float(v) for v in result["best"]["state"]],
                        "covariance_fit": [[float(v) for v in row] for row in result["best"]["covariance"]],
                        "gm_total_au3_day2": postmortem.GM_TOTAL, "light_time": True, "aberration": False,
                        "sigma_g_arcsec": _r(result["sigma_g"], 4)},
        "diagnostics": {"n_points": result["n_points"], "n_groups": result["n_groups"], "chi2_red": _r(result["chi2_red"], 4),
                        "residual_rms_arcsec": result["residual_rms"], "group_mean_residuals_arcsec": result["group_means"],
                        "group_residual_rms_arcsec": _r(result["group_residual_rms"], 4), "monte_carlo_draws": MC_DRAWS,
                        "jackknife_groups": result["jackknife_groups"], "baseline": baseline_info},
        "limitation_keys": ["limit.two-body-only", "limit.gaussian-psf-model", "limit.ephemeris-guided-training",
                            "limit.single-group-latest-visit"],
    }
    path = folder / "prediction.json"
    path.write_bytes(predict.json_bytes(document))
    return path


# ------------------------------------------------------------------ exploratory hindcast


def hindcast() -> dict:
    """Method v2 trained on the two training visits only, scored on the 2026 visit (exploratory)."""
    verification = json.loads((TRIALS / V1_TRIAL / "verification.json").read_text())
    points = training_points()
    t_eval = verification["residuals"]["model"]["reference"]["t_mjd"]
    eval_points = evaluation_points()
    observer_eval = np.mean([orbit.observer_heliocentric_au(p["t_mjd"], p["spacecraft_km"]) for p in eval_points], axis=0)
    method = MethodV2(points, postmortem.Ephemeris(min(p["t_mjd"] for p in points) - 30, t_eval + 30))
    observer_bary = method.model.observer(t_eval, None, observer_eval)
    frozen_helio, t0_helio = frozen_v1_start()
    result = method.run([t_eval], method.start_state(frozen_helio, t0_helio), {t_eval: observer_bary})
    entry = result["times"][t_eval]
    c_pred = entry["c_parameters"] + np.eye(2) * result["sigma_g"] ** 2
    observed = (verification["observed"]["ra_deg"], verification["observed"]["dec_deg"])
    c_obs = np.array(verification["observed"]["cov_arcsec2"])
    residual = np.array(tangent_offsets_arcsec(entry["ra_deg"], entry["dec_deg"], *observed))
    d2 = float(residual @ np.linalg.inv(c_pred + c_obs) @ residual)
    v1 = verification["residuals"]["model"]
    shape = along_cross(method, result["best"], t_eval, lambda t: method.model.observer(t, None, orbit.observer_heliocentric_au(t, None)), c_pred)
    return {
        "schema_version": "tenger.hindcast/1", "contract_version": 11, "trial_id": V1_TRIAL,
        "label": "exploratory hindcast, after the reveal: method v2 trained on the 2025-10 and 2026-04 visits only",
        "label_key": "hindcast.v2-label",
        "exploratory": True, "counts": False, "generated_utc": _now(),
        "old_method": {"name": "v1 (frozen): heliocentric two-body, per-exposure errors x sqrt(chi2)",
                       "error_arcsec": v1["error_arcsec"], "residual_arcsec": [v1["east_arcsec"], v1["north_arcsec"]],
                       "c_pred_arcsec2": v1["c_pred_arcsec2"], "d2": v1["d2"], "result": verification["status"]},
        "new_method": {"name": "v2: barycentric two-body, uncertainty from whole visit x array groups",
                       "ra_deg": _r(entry["ra_deg"], 8), "dec_deg": _r(entry["dec_deg"], 8),
                       "residual_arcsec": [_r(v, 3) for v in residual], "error_arcsec": _r(np.linalg.norm(residual), 3),
                       "c_pred_arcsec2": _cov(c_pred), "uncertainty_basis": entry["basis"],
                       "sigma_g_arcsec": _r(result["sigma_g"], 4), **shape, "d2": _r(d2, 3),
                       "result_if_it_had_been_frozen": "hit" if d2 <= predict.CHI2_95_2D else "miss"},
        "observed": {"ra_deg": observed[0], "dec_deg": observed[1], "cov_arcsec2": verification["observed"]["cov_arcsec2"],
                     "t_mjd": t_eval},
        "note": "Designed after the miss, so it cannot count as a test; it shows whether the new method would "
                "have been honest about its uncertainty on the same data.",
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["freeze", "predict", "receipt", "hindcast"])
    args = parser.parse_args(argv)
    if args.action == "freeze":
        print(freeze())
    elif args.action == "predict":
        for trial_id in FORECASTS:
            print(predict_v2(trial_id))
    elif args.action == "receipt":
        for trial_id in FORECASTS:
            print(predict.write_receipt(trial_id))
    else:
        document = hindcast()
        path = TRIALS / "pluto" / "hindcast-v2.json"
        path.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n")
        print(json.dumps({k: document[k] for k in ("old_method", "new_method")}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
