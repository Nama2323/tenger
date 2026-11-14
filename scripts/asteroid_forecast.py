"""Task A9 forecast model (frozen with the batch; rules in docs/asteroid-batch.md section 4).

Method v2 (scripts/forecast_v2.MethodV2: group Monte Carlo + visit x detector jackknife envelope, along and
across the track) in a chosen two-body frame, started from our own positions only, plus the two-body
model error from synthetic N-body orbits and v2's spacecraft term. Inputs: training points measured by
scripts/asteroids.py and the evaluation exposure TIMES. No JPL orbit or ephemeris enters here.
"""
import math

import numpy as np

from backend import orbit
from backend.astrometry import tangent_offsets_arcsec
from scripts import forecast_v2, postmortem, predict

CODE_FILES = ("scripts/asteroid_forecast.py", "scripts/forecast_v2.py", "scripts/postmortem.py", "scripts/predict.py",
              "backend/orbit.py", "backend/astrometry.py")
DISTANCE_GRID_AU = tuple(round(0.8 + 0.2 * k, 1) for k in range(17))  # 0.8 ... 4.0
SYNTHETIC_ORBITS = 24
SYNTHETIC_TIMES = 30
SYNTHETIC_SEED = 20261115
SYNTHETIC_SIGMA_ARCSEC = 0.5
OBLIQUITY_RAD = math.radians(84381.448 / 3600)
K95 = 2.4477468306808166


def code_sha256() -> str:
    import hashlib
    digest = hashlib.sha256()
    for name in CODE_FILES:
        digest.update(name.encode() + b"\0" + (predict.ROOT / name).read_bytes())
    return digest.hexdigest()


class Method(forecast_v2.MethodV2):
    """forecast_v2.MethodV2 with the two-body frame as a parameter (v2 itself fixes the barycentric one)."""

    def __init__(self, points: list[dict], ephemeris: postmortem.Ephemeris, mode: str):
        self.points = sorted(points, key=lambda p: (p["t_mjd"], p["obs_keys"][0]))
        self.ephemeris = ephemeris
        self.mode = mode
        self.model = postmortem.Model(mode, ephemeris)
        self.observers = [self.model.observer(p["t_mjd"], None, orbit.observer_heliocentric_au(p["t_mjd"], p.get("spacecraft_km")))
                          for p in self.points]
        self.t0 = self.points[0]["t_mjd"]

    def to_frame(self, helio_state: np.ndarray, t: float) -> np.ndarray:
        if self.mode == "heliocentric_two_body":
            return helio_state
        return helio_state + np.concatenate([self.ephemeris.position("sun", t), self.ephemeris.velocity("sun", t)])


def _unit(ra: float, dec: float) -> np.ndarray:
    a, d = math.radians(ra), math.radians(dec)
    return np.array([math.cos(d) * math.cos(a), math.cos(d) * math.sin(a), math.sin(d)])


def starting_states(method: Method) -> list[tuple[float, np.ndarray]]:
    """Heliocentric states at t0 from the first visit's own positions and mean motion, one per trial distance."""
    first_visit = min(p["visit"] for p in method.points)
    visit = [p for p in method.points if p["visit"] == first_visit]
    ra0, dec0 = visit[0]["ra_deg"], visit[0]["dec_deg"]
    times = np.array([p["t_mjd"] for p in visit]) - method.t0
    offsets = np.array([tangent_offsets_arcsec(ra0, dec0, p["ra_deg"], p["dec_deg"]) for p in visit])
    if len(visit) >= 2 and np.ptp(times) > 0:
        rate = np.polyfit(times, offsets, 1)[0]  # arcsec/day east, north
        at_t0 = np.polyfit(times, offsets, 1)[1]
    else:
        rate, at_t0 = np.zeros(2), np.zeros(2)
    start_ra, start_dec = predict_offset(ra0, dec0, at_t0)
    u = _unit(start_ra, start_dec)
    east = np.array([-math.sin(math.radians(start_ra)), math.cos(math.radians(start_ra)), 0.0])
    north = np.cross(u, east)
    du = (rate[0] * east + rate[1] * north) / orbit.ARCSEC_PER_RAD
    observer = orbit.observer_heliocentric_au(method.t0, None)
    observer_v = (orbit.observer_heliocentric_au(method.t0 + 0.5, None) - orbit.observer_heliocentric_au(method.t0 - 0.5, None))
    return [(distance, np.concatenate([observer + distance * u, observer_v + distance * du])) for distance in DISTANCE_GRID_AU]


def predict_offset(ra0: float, dec0: float, offset) -> tuple[float, float]:
    from backend.astrometry import tangent_to_sky
    return tangent_to_sky(ra0, dec0, float(offset[0]), float(offset[1]))


def initial_orbit(method: Method) -> dict:
    """Least-squares fits from every starting distance; the lowest chi-square wins (our positions only)."""
    tried = []
    for distance, helio in starting_states(method):
        try:
            solution = method.fit(method.points, method.observers, method.to_frame(helio, method.t0))
            tried.append({"distance_au": distance, "chi2_red": solution["chi2_red"], "solution": solution})
        except Exception:  # a start far from any orbit can fail to integrate; it is listed as failed
            tried.append({"distance_au": distance, "chi2_red": None, "solution": None})
    good = [t for t in tried if t["chi2_red"] is not None and np.isfinite(t["chi2_red"])]
    if not good:
        raise RuntimeError("no starting distance converged")
    best = min(good, key=lambda t: t["chi2_red"])
    return {"start_state": best["solution"]["state"], "chi2_red": best["chi2_red"], "distance_au": best["distance_au"],
            "grid": [{"distance_au": t["distance_au"], "chi2_red": None if t["chi2_red"] is None else round(float(t["chi2_red"]), 4)}
                     for t in tried]}


def osculating_elements(helio_state: np.ndarray) -> dict:
    """a, e, i (ecliptic) of a heliocentric ICRS state (AU, AU/day)."""
    rotation = np.array([[1, 0, 0], [0, math.cos(OBLIQUITY_RAD), math.sin(OBLIQUITY_RAD)],
                         [0, -math.sin(OBLIQUITY_RAD), math.cos(OBLIQUITY_RAD)]])
    r, v = rotation @ helio_state[:3], rotation @ helio_state[3:]
    gm = orbit.GM_SUN
    h = np.cross(r, v)
    e_vec = np.cross(v, h) / gm - r / np.linalg.norm(r)
    energy = v @ v / 2 - gm / np.linalg.norm(r)
    return {"a_au": float(-gm / (2 * energy)), "e": float(np.linalg.norm(e_vec)),
            "i_deg": float(math.degrees(math.acos(h[2] / np.linalg.norm(h))))}


def state_from_elements(a: float, e: float, inc: float, node: float, peri: float, mean_anomaly: float) -> np.ndarray:
    gm = orbit.GM_SUN
    anomaly = mean_anomaly
    for _ in range(60):
        anomaly -= (anomaly - e * math.sin(anomaly) - mean_anomaly) / (1 - e * math.cos(anomaly))
    x, y = a * (math.cos(anomaly) - e), a * math.sqrt(1 - e * e) * math.sin(anomaly)
    n = math.sqrt(gm / a ** 3)
    factor = 1 - e * math.cos(anomaly)
    vx, vy = -a * n * math.sin(anomaly) / factor, a * n * math.sqrt(1 - e * e) * math.cos(anomaly) / factor
    co, so, ci, si, cw, sw = (math.cos(node), math.sin(node), math.cos(inc), math.sin(inc), math.cos(peri), math.sin(peri))
    perifocal = np.array([[co * cw - so * sw * ci, -co * sw - so * cw * ci], [so * cw + co * sw * ci, -so * sw + co * cw * ci],
                          [sw * si, cw * si]])
    to_icrs = np.array([[1, 0, 0], [0, math.cos(OBLIQUITY_RAD), -math.sin(OBLIQUITY_RAD)],
                        [0, math.sin(OBLIQUITY_RAD), math.cos(OBLIQUITY_RAD)]])
    return np.concatenate([to_icrs @ perifocal @ np.array([x, y]), to_icrs @ perifocal @ np.array([vx, vy])])


def model_error(method: Method, best_state: np.ndarray, eval_times: list[float]) -> dict:
    """Second moment (bias included) of two-body forecast errors on synthetic N-body orbits, along/across track."""
    helio_best = best_state if method.mode == "heliocentric_two_body" else best_state - np.concatenate(
        [method.ephemeris.position("sun", method.t0), method.ephemeris.velocity("sun", method.t0)])
    elements = osculating_elements(helio_best)
    train_times = sorted(p["t_mjd"] for p in method.points)
    picks = np.unique(np.linspace(0, len(train_times) - 1, min(SYNTHETIC_TIMES, len(train_times))).round().astype(int))
    times = [train_times[i] for i in picks]
    t_eval = float(np.mean(eval_times))
    truth_model = postmortem.Model("barycentric_nbody", method.ephemeris)
    rng = np.random.default_rng(SYNTHETIC_SEED)
    errors, failures = [], 0
    for _ in range(SYNTHETIC_ORBITS):
        node, peri, mean = rng.uniform(0, 2 * math.pi, 3)
        helio = state_from_elements(elements["a_au"], min(elements["e"], 0.6), math.radians(elements["i_deg"]), node, peri, mean)
        sun = np.concatenate([method.ephemeris.position("sun", method.t0), method.ephemeris.velocity("sun", method.t0)])
        try:
            truth = truth_model.solve(helio + sun, method.t0, min(times), t_eval)
            observers_truth = [truth_model.observer(t, None, orbit.observer_heliocentric_au(t, None)) for t in times]
            points = []
            for t, observer in zip(times, observers_truth):
                ra, dec = truth_model.radec(truth, t, observer)
                points.append({"t_mjd": t, "ra_deg": ra, "dec_deg": dec, "obs_keys": [f"synthetic-{t}"],
                               "cov_arcsec2": [[SYNTHETIC_SIGMA_ARCSEC ** 2, 0.0], [0.0, SYNTHETIC_SIGMA_ARCSEC ** 2]]})
            observers_model = [method.model.observer(t, None, orbit.observer_heliocentric_au(t, None)) for t in times]
            start = method.to_frame(helio, method.t0)
            fit = postmortem.fit(method.model, points, observers_model, start, method.t0)
            true_ra, true_dec = truth_model.radec(truth, t_eval, truth_model.observer(t_eval, None, orbit.observer_heliocentric_au(t_eval, None)))
            body = method.model.solve(fit["state"], fit["t0"], t_eval, t_eval)
            ra, dec = method.model.radec(body, t_eval, method.model.observer(t_eval, None, orbit.observer_heliocentric_au(t_eval, None)))
            error = np.array(tangent_offsets_arcsec(ra, dec, true_ra, true_dec))
            before = truth_model.radec(truth, t_eval - 0.5, truth_model.observer(t_eval - 0.5, None, orbit.observer_heliocentric_au(t_eval - 0.5, None)))
            after = truth_model.radec(truth, t_eval + 0.5, truth_model.observer(t_eval + 0.5, None, orbit.observer_heliocentric_au(t_eval + 0.5, None)))
            motion = np.array(tangent_offsets_arcsec(*before, *after))
            along = motion / np.linalg.norm(motion)
            cross = np.array([-along[1], along[0]])
            errors.append([float(error @ along), float(error @ cross)])
        except Exception:
            failures += 1
    errors = np.array(errors)
    second = errors.T @ errors / len(errors)
    return {"elements_used": {k: round(v, 5) for k, v in elements.items()}, "orbits": SYNTHETIC_ORBITS,
            "used": len(errors), "failed": failures, "synthetic_times": len(times),
            "c_along_cross_arcsec2": second, "rms_along_arcsec": float(math.sqrt(second[0, 0])),
            "rms_cross_arcsec": float(math.sqrt(second[1, 1])),
            "median_total_arcsec": float(np.median(np.hypot(errors[:, 0], errors[:, 1]))),
            "max_total_arcsec": float(np.max(np.hypot(errors[:, 0], errors[:, 1])))}


def forecast(points: list[dict], eval_times: list[float], mode: str) -> dict:
    """The frozen forecast for one frame: positions and C_pred at every evaluation time."""
    ephemeris = postmortem.Ephemeris(min(p["t_mjd"] for p in points) - 30, max(eval_times) + 30)
    method = Method(points, ephemeris, mode)
    start = initial_orbit(method)
    result = method.run(list(eval_times), start["start_state"])
    error = model_error(method, result["best"]["state"], eval_times)
    track = []
    for t in eval_times:
        entry = result["times"][t]
        observer = method.observer_future(t)
        body = method.model.solve(result["best"]["state"], result["best"]["t0"], t, t)(t)
        distance = float(np.linalg.norm(body - observer))
        along = method.motion_direction(result["best"], t, None)
        cross = np.array([-along[1], along[0]])
        rotation = np.column_stack([along, cross])
        c_model = rotation @ error["c_along_cross_arcsec2"] @ rotation.T
        c_fit = entry["c_parameters"] + np.eye(2) * (result["sigma_g"] ** 2 + forecast_v2.spacecraft_sigma(distance) ** 2)
        cov = c_fit + c_model
        track.append({"t_mjd": t, "ra_deg": entry["ra_deg"], "dec_deg": entry["dec_deg"], "cov_arcsec2": cov,
                      "c_fit_arcsec2": c_fit, "c_model_arcsec2": c_model, "uncertainty_basis": entry["basis"],
                      "distance_au": distance,
                      **forecast_v2.along_cross(method, result["best"], t, method.observer_future, cov)})
    return {"mode": mode, "track": track, "best": result["best"], "start": start, "model_error": error,
            "sigma_g": result["sigma_g"], "diagnostics": {k: result[k] for k in (
                "n_points", "n_groups", "chi2_red", "residual_rms", "group_means", "group_residual_rms",
                "jackknife_groups")}}


def baseline(points: list[dict], eval_times: list[float]):
    return predict._baseline_linear(points, list(eval_times))
