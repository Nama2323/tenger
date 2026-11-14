"""Exploratory post-mortem of the Pluto miss (Task A5b). Never re-scores the trial.

Usage: python -m scripts.postmortem            # writes static/data/trials/pluto/postmortem.json

Everything here is labelled "exploratory, after the reveal". The frozen prediction,
verification and scoreboard are only read. Alternative models are refitted to the SAME
training data and compared with the observed position, to find which assumption failed.
"""
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from astropy import units as u
from astropy.coordinates import get_body_barycentric
from astropy.time import Time
from scipy.integrate import solve_ivp
from scipy.interpolate import CubicSpline
from scipy.optimize import least_squares

from backend import orbit
from backend.astrometry import tangent_offsets_arcsec, tangent_to_sky

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "static" / "data"
TRIAL = "pluto-position-2026b"
OPEN_FORECAST = "pluto-position-open-2027a"
GM_SUN = orbit.GM_SUN
# IAU 2015 / DE-series mass ratios (Sun / planet system)
MASS_RATIO = {"jupiter": 1047.348644, "saturn": 3497.9018, "uranus": 22902.98, "neptune": 19412.26}
GM_TOTAL = GM_SUN * (1 + sum(1 / ratio for ratio in MASS_RATIO.values()))
MC_DRAWS = 200
ARRAY_SYSTEMATIC_ARCSEC = 0.4


def _json(relative: str) -> dict:
    return json.loads((DATA / relative).read_text())


# ------------------------------------------------------------------ ephemerides on a grid


class Ephemeris:
    """Barycentric Sun and giant-planet positions (astropy built-in), splined over a time span (MJD UTC)."""

    def __init__(self, start: float, stop: float, step: float = 2.0):
        grid = np.arange(start, stop + step, step)
        time = Time(grid, format="mjd", scale="utc")
        self.splines = {}
        for body in ("sun", *MASS_RATIO):
            position = get_body_barycentric(body, time)
            xyz = np.vstack([position.x.to_value(u.au), position.y.to_value(u.au), position.z.to_value(u.au)]).T
            self.splines[body] = CubicSpline(grid, xyz)

    def position(self, body: str, t) -> np.ndarray:
        return self.splines[body](t)

    def velocity(self, body: str, t) -> np.ndarray:
        return self.splines[body](t, 1)


def derivative(mode: str, ephemeris: Ephemeris):
    def heliocentric(_, y):
        r = y[:3]
        return np.concatenate([y[3:], -GM_SUN * r / np.linalg.norm(r) ** 3])

    def barycentric_total(_, y):
        r = y[:3]
        return np.concatenate([y[3:], -GM_TOTAL * r / np.linalg.norm(r) ** 3])

    def nbody(t, y):
        r = y[:3]
        acceleration = np.zeros(3)
        for body, gm in (("sun", GM_SUN), *((name, GM_SUN / ratio) for name, ratio in MASS_RATIO.items())):
            d = r - ephemeris.position(body, t)
            acceleration -= gm * d / np.linalg.norm(d) ** 3
        return np.concatenate([y[3:], acceleration])

    return {"heliocentric_two_body": heliocentric, "barycentric_two_body": barycentric_total,
            "barycentric_nbody": nbody}[mode]


class Model:
    """One orbit model: state at t0 in its own frame (heliocentric or barycentric)."""

    def __init__(self, mode: str, ephemeris: Ephemeris, light_time: bool = True):
        self.mode, self.ephemeris, self.light_time = mode, ephemeris, light_time

    def observer(self, mjd: float, spacecraft_km, heliocentric_observer: np.ndarray) -> np.ndarray:
        if self.mode == "heliocentric_two_body":
            return heliocentric_observer
        return heliocentric_observer + self.ephemeris.position("sun", mjd)  # move to the barycentre

    def solve(self, state, t0, t_min, t_max):
        span = (min(t0, t_min) - 1, max(t0, t_max) + 1)
        forward = solve_ivp(derivative(self.mode, self.ephemeris), (t0, span[1]), state, method="DOP853",
                            rtol=1e-12, atol=1e-14, dense_output=True)
        backward = solve_ivp(derivative(self.mode, self.ephemeris), (t0, span[0]), state, method="DOP853",
                             rtol=1e-12, atol=1e-14, dense_output=True)
        return lambda t: forward.sol(t)[:3] if t >= t0 else backward.sol(t)[:3]

    def radec(self, body_at, mjd: float, observer: np.ndarray) -> tuple[float, float]:
        emitted = mjd
        for _ in range(3 if self.light_time else 1):
            vector = body_at(emitted) - observer
            if self.light_time:
                emitted = mjd - np.linalg.norm(vector) / orbit.C_AU_PER_DAY
        vector = body_at(emitted) - observer
        return (math.degrees(math.atan2(vector[1], vector[0])) % 360,
                math.degrees(math.asin(vector[2] / np.linalg.norm(vector))))


def fit(model: Model, points: list[dict], observers: list[np.ndarray], start: np.ndarray, t0: float,
        covs: list[np.ndarray] | None = None) -> dict:
    times = [point["t_mjd"] for point in points]
    whiten = [np.linalg.cholesky(np.linalg.inv(np.asarray(cov if covs is None else covs[i], float)))
              for i, cov in enumerate(point["cov_arcsec2"] for point in points)]
    scale = np.array([1, 1, 1, 1e-3, 1e-3, 1e-3])

    def residual(x):
        body_at = model.solve(x * scale, t0, min(times), max(times))
        out = []
        for point, observer, w in zip(points, observers, whiten):
            ra, dec = model.radec(body_at, point["t_mjd"], observer)
            out.extend(w.T @ np.array(tangent_offsets_arcsec(point["ra_deg"], point["dec_deg"], ra, dec)))
        return np.array(out)

    result = least_squares(residual, start / scale, method="lm", x_scale="jac")
    chi2 = float(np.sum(result.fun**2))
    dof = 2 * len(points) - 6
    jac = result.jac / scale
    covariance = np.linalg.inv(jac.T @ jac) * max(1.0, chi2 / dof)
    return {"state": result.x * scale, "t0": t0, "chi2_red": chi2 / dof, "covariance": covariance}


def predict(model: Model, solution: dict, mjd: float, observer: np.ndarray) -> tuple[float, float, np.ndarray]:
    body_at = model.solve(solution["state"], solution["t0"], mjd, mjd)
    ra, dec = model.radec(body_at, mjd, observer)
    jac = np.zeros((2, 6))
    steps = np.array([1e-6, 1e-6, 1e-6, 1e-9, 1e-9, 1e-9])
    for index in range(6):
        shifted = solution["state"].copy()
        shifted[index] += steps[index]
        ra1, dec1 = model.radec(model.solve(shifted, solution["t0"], mjd, mjd), mjd, observer)
        jac[:, index] = np.array(tangent_offsets_arcsec(ra, dec, ra1, dec1)) / steps[index]
    return ra, dec, jac @ solution["covariance"] @ jac.T


# ------------------------------------------------------------------ analysis


def ellipse(cov: np.ndarray) -> dict:
    values, vectors = np.linalg.eigh(cov)
    major = vectors[:, 1]
    pa = math.degrees(math.atan2(major[0], major[1])) % 180  # east of north
    return {"semi_major_95_arcsec": round(math.sqrt(values[1]) * 2.4477468306808166, 3),
            "semi_minor_95_arcsec": round(math.sqrt(values[0]) * 2.4477468306808166, 3),
            "position_angle_deg_east_of_north": round(pa, 2)}


def run() -> dict:
    trial = _json(f"trials/{TRIAL}/trial.json")
    training = _json(f"trials/{TRIAL}/training.json")
    prediction = _json(f"trials/{TRIAL}/prediction.json")
    verification = _json(f"trials/{TRIAL}/verification.json")
    points = training["points"]
    model_block = verification["residuals"]["model"]
    t_eval = model_block["reference"]["t_mjd"]
    residual = np.array([model_block["east_arcsec"], model_block["north_arcsec"]])
    c_pred, c_obs = np.array(model_block["c_pred_arcsec2"]), np.array(verification["observed"]["cov_arcsec2"])
    observed = (verification["observed"]["ra_deg"], verification["observed"]["dec_deg"])
    comparison = verification["after_verdict_comparison"]
    per_exposure_obs = verification["observed"]["obs_keys"]

    # Observers: training (header spacecraft) and the evaluation mean (from the exposures used).
    helio_obs = [orbit.observer_heliocentric_au(p["t_mjd"], p.get("spacecraft_km")) for p in points]
    eval_rows = [row for row in verification["per_exposure"]]
    eval_times = [row["t_mjd"] for row in eval_rows]
    eval_cache = json.loads((ROOT / "cache" / "bodies" / "pluto-eval" / f"{per_exposure_obs[0].replace(':', '__')}.json").read_text()) \
        if (ROOT / "cache").exists() else None
    eval_observer_helio = np.mean([orbit.observer_heliocentric_au(t, None) for t in eval_times], axis=0)
    ephemeris = Ephemeris(min(p["t_mjd"] for p in points) - 30, 61560.0)

    # 1. Along-track / cross-track split, using the frozen model's apparent motion at t_eval.
    frozen = {"state": np.array(prediction["model_state"]["state_au_au_per_day"]), "t0": prediction["model_state"]["t0_mjd_utc"],
              "covariance": np.array(prediction["model_state"]["covariance"]), "chi2_red": 1.0}
    before = orbit.apparent_radec(frozen["state"], frozen["t0"], t_eval - 0.5, orbit.observer_heliocentric_au(t_eval - 0.5))
    after = orbit.apparent_radec(frozen["state"], frozen["t0"], t_eval + 0.5, orbit.observer_heliocentric_au(t_eval + 0.5))
    motion = np.array(tangent_offsets_arcsec(*before, *after))
    along_unit = motion / np.linalg.norm(motion)
    cross_unit = np.array([-along_unit[1], along_unit[0]])
    split = {"east_arcsec": round(float(residual[0]), 3), "north_arcsec": round(float(residual[1]), 3),
             "along_track_arcsec": round(float(residual @ along_unit), 3),
             "cross_track_arcsec": round(float(residual @ cross_unit), 3),
             "apparent_motion_arcsec_per_day": round(float(np.linalg.norm(motion)), 3),
             "motion_position_angle_deg": round(math.degrees(math.atan2(motion[0], motion[1])) % 360, 2),
             "residual_position_angle_deg": round(math.degrees(math.atan2(residual[0], residual[1])) % 360, 2)}
    c_pred_axes = ellipse(c_pred)
    along_sigma = math.sqrt(along_unit @ (c_pred + c_obs) @ along_unit)
    cross_sigma = math.sqrt(cross_unit @ (c_pred + c_obs) @ cross_unit)
    split["along_track_sigma_arcsec"] = round(along_sigma, 3)
    split["cross_track_sigma_arcsec"] = round(cross_sigma, 3)
    split["along_track_z"] = round(split["along_track_arcsec"] / along_sigma, 2)
    split["cross_track_z"] = round(split["cross_track_arcsec"] / cross_sigma, 2)

    # 2. Alternative models refitted to the same training data; compare with the observed position.
    starts = {"heliocentric_two_body": frozen["state"]}
    sun0, sun_v0 = ephemeris.position("sun", frozen["t0"]), ephemeris.velocity("sun", frozen["t0"])
    starts["barycentric_two_body"] = frozen["state"] + np.concatenate([sun0, sun_v0])
    starts["barycentric_nbody"] = starts["barycentric_two_body"]
    models = {}
    for mode, start in starts.items():
        model = Model(mode, ephemeris)
        observers = [model.observer(p["t_mjd"], None, o) for p, o in zip(points, helio_obs)]
        solution = fit(model, points, observers, start, frozen["t0"])
        observer_eval = model.observer(t_eval, None, eval_observer_helio)
        ra, dec, cov = predict(model, solution, t_eval, observer_eval)
        miss = np.array(tangent_offsets_arcsec(ra, dec, *observed))
        total = cov + np.eye(2) * prediction["model_state"]["sigma_sys_arcsec"] ** 2 + c_obs
        models[mode] = {"chi2_red": round(solution["chi2_red"], 3), "ra_deg": round(ra, 8), "dec_deg": round(dec, 8),
                        "observed_minus_model_arcsec": [round(float(v), 3) for v in miss],
                        "error_arcsec": round(float(np.linalg.norm(miss)), 3),
                        "d2_exploratory": round(float(miss @ np.linalg.inv(total) @ miss), 3),
                        "ellipse_95": ellipse(cov)}
        if mode == "barycentric_nbody":
            models[mode]["_solution"] = solution
    # Light time and spacecraft offset: switch each off in the frozen (heliocentric) model.
    variants = {}
    for label, light_time, use_spacecraft in (("no_light_time", False, True), ("no_spacecraft_offset", True, False)):
        model = Model("heliocentric_two_body", ephemeris, light_time=light_time)
        observers = [orbit.observer_heliocentric_au(p["t_mjd"], p.get("spacecraft_km") if use_spacecraft else None)
                     for p in points]
        solution = fit(model, points, observers, frozen["state"], frozen["t0"])
        ra, dec, _ = predict(model, solution, t_eval, eval_observer_helio)
        reference = models["heliocentric_two_body"]
        shift = tangent_offsets_arcsec(reference["ra_deg"], reference["dec_deg"], ra, dec)
        variants[label] = {"prediction_shift_arcsec": [round(float(v), 3) for v in shift],
                           "chi2_red": round(solution["chi2_red"], 3)}

    # 3. Uncertainty: Monte Carlo with correlated offsets per (visit, array) group, refit each draw;
    #    evaluated at the evaluation time and at the April 2027 open-forecast reference time.
    open_prediction = _json(f"trials/{OPEN_FORECAST}/prediction.json")
    t_ref = open_prediction["t_mjd"]
    observer_ref = orbit.observer_heliocentric_au(t_ref, None)
    groups = sorted({(p["visit"], p["detector"]) for p in points})
    helio_model = Model("heliocentric_two_body", ephemeris)
    base_eval = (models["heliocentric_two_body"]["ra_deg"], models["heliocentric_two_body"]["dec_deg"])
    base_ref = orbit.apparent_radec(frozen["state"], frozen["t0"], t_ref, observer_ref)
    rng = np.random.default_rng(20261114)
    sensitivity = {}
    for sigma in (0.1, 0.2, ARRAY_SYSTEMATIC_ARCSEC):
        at_eval, at_ref = [], []
        for _ in range(MC_DRAWS):
            offsets = {group: rng.normal(0, sigma, 2) for group in groups}
            moved = []
            for p in points:
                ra, dec = tangent_to_sky(p["ra_deg"], p["dec_deg"], *offsets[(p["visit"], p["detector"])])
                moved.append({**p, "ra_deg": ra, "dec_deg": dec})
            solution = fit(helio_model, moved, helio_obs, frozen["state"], frozen["t0"])
            ra, dec = helio_model.radec(helio_model.solve(solution["state"], frozen["t0"], t_eval, t_eval), t_eval,
                                        eval_observer_helio)
            at_eval.append(tangent_offsets_arcsec(*base_eval, ra, dec))
            ra, dec = helio_model.radec(helio_model.solve(solution["state"], frozen["t0"], t_ref, t_ref), t_ref,
                                        observer_ref)
            at_ref.append(tangent_offsets_arcsec(*base_ref, ra, dec))
        c_mc, c_mc_ref = np.cov(np.array(at_eval).T), np.cov(np.array(at_ref).T)
        inflated = c_pred + c_mc + c_obs
        d2 = float(residual @ np.linalg.inv(inflated) @ residual)
        sensitivity[f"{sigma:.1f}"] = {
            "monte_carlo_ellipse_95_at_evaluation": ellipse(c_mc),
            "d2_with_inflated_covariance": round(d2, 3),
            "would_have_been": "hit" if d2 <= 5.991464547107979 else "miss",
            "monte_carlo_ellipse_95_at_2027_reference": ellipse(c_mc_ref),
        }
    # Jackknife: leave one (visit, array) group out of the training data (a training-only diagnostic).
    jackknife = []
    for group in groups:
        kept = [p for p in points if (p["visit"], p["detector"]) != group]
        kept_obs = [o for p, o in zip(points, helio_obs) if (p["visit"], p["detector"]) != group]
        solution = fit(helio_model, kept, kept_obs, frozen["state"], frozen["t0"])
        ra, dec = helio_model.radec(helio_model.solve(solution["state"], frozen["t0"], t_eval, t_eval), t_eval,
                                    eval_observer_helio)
        jackknife.append(tangent_offsets_arcsec(*base_eval, ra, dec))
    jackknife = np.array(jackknife)
    n_groups = len(groups)
    c_jack = (n_groups - 1) / n_groups * ((jackknife - jackknife.mean(axis=0)).T @ (jackknife - jackknife.mean(axis=0)))
    uncertainty = {"assumed_array_systematic_arcsec": ARRAY_SYSTEMATIC_ARCSEC, "draws_per_level": MC_DRAWS,
                   "groups": n_groups, "frozen_c_pred_ellipse_95": c_pred_axes, "sensitivity": sensitivity,
                   "jackknife_by_visit_and_array": {
                       "ellipse_95": ellipse(c_jack),
                       "shifts_arcsec": [[round(float(v), 3) for v in row] for row in jackknife],
                       "d2_with_jackknife_covariance": round(float(residual @ np.linalg.inv(c_pred + c_jack + c_obs) @ residual), 3),
                       "note": "computable from training data alone, before the freeze"}}

    # 4. Measurement: observed vs Horizons (independent of our model).
    measurement = {"observed_minus_horizons_arcsec": comparison["observed_minus_horizons_arcsec"],
                   "frozen_model_minus_horizons_arcsec": comparison["frozen_model_minus_horizons_arcsec"],
                   "observed_minus_horizons_total_arcsec": round(float(np.linalg.norm(comparison["observed_minus_horizons_arcsec"])), 3),
                   "frozen_model_minus_horizons_total_arcsec": round(float(np.linalg.norm(comparison["frozen_model_minus_horizons_arcsec"])), 3),
                   "c_obs_sigma_arcsec": [round(math.sqrt(c_obs[0, 0]), 3), round(math.sqrt(c_obs[1, 1]), 3)],
                   "exposures_used": len(per_exposure_obs)}

    # 5. The April 2027 open forecast: frozen vs the exploratory barycentric N-body refit.
    nbody_model = Model("barycentric_nbody", ephemeris)
    observer = nbody_model.observer(t_ref, None, orbit.observer_heliocentric_au(t_ref, None))
    solution = models["barycentric_nbody"].pop("_solution")
    ra, dec, cov = predict(nbody_model, solution, t_ref, observer)
    frozen_open = open_prediction["model"]
    shift = np.array(tangent_offsets_arcsec(frozen_open["ra_deg"], frozen_open["dec_deg"], ra, dec))
    frozen_cov = np.array(frozen_open["cov_arcsec2"])
    open_compare = {"t_mjd": t_ref, "frozen_ellipse_95": ellipse(frozen_cov),
                    "exploratory_nbody_minus_frozen_arcsec": [round(float(v), 3) for v in shift],
                    "exploratory_nbody_minus_frozen_total_arcsec": round(float(np.linalg.norm(shift)), 3),
                    "d2_of_shift_in_frozen_ellipse": round(float(shift @ np.linalg.inv(frozen_cov) @ shift), 3),
                    "exploratory_nbody_ellipse_95": ellipse(cov),
                    "exploratory_nbody_position": {"ra_deg": round(ra, 8), "dec_deg": round(dec, 8)}}
    for model in models.values():
        model.pop("_solution", None)
    return {
        "schema_version": "tenger.postmortem/1", "contract_version": 8, "trial_id": TRIAL,
        "label": "exploratory, after the reveal", "exploratory": True, "counts": False,
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "frozen": {"prediction_status": prediction["prediction_status"], "status": verification["status"],
                   "d2": model_block["d2"], "error_arcsec": model_block["error_arcsec"],
                   "reference": model_block["reference"], "c_pred_ellipse_95": c_pred_axes,
                   "c_obs_ellipse_95": ellipse(c_obs), "combined_ellipse_95": ellipse(c_pred + c_obs)},
        "identification": measurement, "residual_split": split, "alternative_models": models,
        "model_variants": variants, "uncertainty_test": uncertainty, "open_forecast_2027": open_compare,
        "sources": [f"trials/{TRIAL}/{name}.json" for name in ("trial", "training", "prediction", "verification")],
    }


if __name__ == "__main__":
    document = run()
    out = DATA / "trials" / "pluto" / "postmortem.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({k: document[k] for k in ("frozen", "residual_split", "alternative_models", "model_variants",
                                               "uncertainty_test", "open_forecast_2027")}, indent=1))
