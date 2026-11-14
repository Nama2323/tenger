"""Heliocentric two-body orbit fit to astrometric positions, with observer geometry.

Model: a body on a Keplerian orbit about the Sun (GM_sun only; planetary perturbations
are neglected and listed as a limitation). The fitted parameters are the heliocentric
ICRS state (position in au, velocity in au/day) at a reference time t0. The predicted
astrometric direction is body(t - light time) - observer(t), where the observer is
Earth (astropy's built-in ephemeris) plus the spacecraft's geocentric position from
the FITS header. Aberration is not modelled: SPHEREx positions are tied to Gaia stars in
the same field, so they are astrometric (relative to the stars), like JPL "astrometric"
positions.

No catalogue orbit or ephemeris is used: starting states come from a grid of trial
distances along the observed line of sight, and every converged solution is reported,
so identifiability and sensitivity to starting values are visible.
"""
import math
from dataclasses import dataclass

import numpy as np
from astropy import units as u
from astropy.coordinates import get_body_barycentric
from astropy.time import Time
from scipy.integrate import solve_ivp
from scipy.optimize import least_squares

from .astrometry import tangent_offsets_arcsec

GM_SUN = 2.9591220828559115e-04  # au^3 / day^2 (Gaussian constant squared)
C_AU_PER_DAY = 173.14463267424034
KM_PER_AU = 1.495978707e8
ARCSEC_PER_RAD = 206264.80624709636
START_DISTANCES_AU = (5.0, 10.0, 20.0, 30.0, 40.0, 50.0, 70.0, 100.0)
SAME_SOLUTION_DELTA_CHI2 = 9.0


@dataclass(frozen=True)
class Observation:
    mjd: float  # UTC
    ra_deg: float
    dec_deg: float
    cov_arcsec2: np.ndarray  # east/north
    observer_helio_au: np.ndarray


def observer_heliocentric_au(mjd_utc: float, spacecraft_km=None) -> np.ndarray:
    """Heliocentric ICRS position of the observer (Earth centre plus spacecraft offset), au."""
    time = Time(mjd_utc, format="mjd", scale="utc")
    earth = get_body_barycentric("earth", time)
    sun = get_body_barycentric("sun", time)
    position = np.array([(earth.x - sun.x).to_value(u.au), (earth.y - sun.y).to_value(u.au),
                         (earth.z - sun.z).to_value(u.au)])
    if spacecraft_km is not None:
        position = position + np.asarray(spacecraft_km, float) / KM_PER_AU
    return position


def _derivative(_, y):
    r = y[:3]
    return np.concatenate([y[3:], -GM_SUN * r / np.linalg.norm(r) ** 3])


def propagate(state: np.ndarray, t0: float, times: np.ndarray) -> np.ndarray:
    """Heliocentric positions (au) at the given times (days) for a state given at t0."""
    times = np.asarray(times, float)
    out = np.empty((times.size, 3))
    for sign in (-1, 1):
        mask = (times - t0) * sign >= 0
        if not mask.any():
            continue
        targets = times[mask]
        order = np.argsort(sign * (targets - t0))
        span = (t0, float(targets[order][-1]))
        if span[0] == span[1]:
            out[mask] = state[:3]
            continue
        solution = solve_ivp(_derivative, span, state, method="DOP853", rtol=1e-12, atol=1e-14,
                             t_eval=targets[order])
        positions = np.empty((targets.size, 3))
        positions[order] = solution.y[:3].T
        out[mask] = positions
    return out


def apparent_radec(state: np.ndarray, t0: float, mjd: float, observer: np.ndarray) -> tuple[float, float]:
    """Astrometric RA/Dec (deg) of the body seen from the observer, with light-time correction."""
    emitted = mjd
    for _ in range(3):
        body = propagate(state, t0, np.array([emitted]))[0]
        distance = np.linalg.norm(body - observer)
        emitted = mjd - distance / C_AU_PER_DAY
    vector = body - observer
    ra = math.degrees(math.atan2(vector[1], vector[0])) % 360
    dec = math.degrees(math.asin(vector[2] / np.linalg.norm(vector)))
    return ra, dec


def _whitening(cov: np.ndarray) -> np.ndarray:
    return np.linalg.cholesky(np.linalg.inv(np.asarray(cov, float)))


def residuals(state: np.ndarray, t0: float, observations: list[Observation]) -> np.ndarray:
    out = []
    for obs in observations:
        ra, dec = apparent_radec(state, t0, obs.mjd, obs.observer_helio_au)
        east, north = tangent_offsets_arcsec(obs.ra_deg, obs.dec_deg, ra, dec)
        out.extend(_whitening(obs.cov_arcsec2).T @ np.array([east, north]))
    return np.array(out)


def starting_state(observations: list[Observation], distance_au: float) -> np.ndarray:
    """Body at a trial distance along the first and last lines of sight; velocity from their difference."""
    first, last = observations[0], observations[-1]

    def point(obs):
        a, d = math.radians(obs.ra_deg), math.radians(obs.dec_deg)
        direction = np.array([math.cos(d) * math.cos(a), math.cos(d) * math.sin(a), math.sin(d)])
        return obs.observer_helio_au + distance_au * direction

    p0, p1 = point(first), point(last)
    velocity = (p1 - p0) / max(last.mjd - first.mjd, 1.0)
    return np.concatenate([p0, velocity])


def fit(observations: list[Observation], start: np.ndarray) -> dict:
    t0 = observations[0].mjd
    scale = np.array([1.0, 1.0, 1.0, 1e-3, 1e-3, 1e-3])
    result = least_squares(lambda x: residuals(x * scale, t0, observations), start / scale,
                           method="lm", x_scale="jac", max_nfev=4000)
    state = result.x * scale
    chi2 = float(np.sum(result.fun**2))
    dof = 2 * len(observations) - 6
    try:
        jacobian = result.jac / scale  # d(residual)/d(state)
        covariance = np.linalg.inv(jacobian.T @ jacobian)
    except np.linalg.LinAlgError:
        covariance = None
    radius = float(np.linalg.norm(state[:3]))
    speed = float(np.linalg.norm(state[3:]))
    energy = 0.5 * speed**2 - GM_SUN / radius
    return {"success": bool(result.success), "state": state, "t0": t0, "chi2": chi2, "dof": dof,
            "chi2_red": chi2 / dof if dof > 0 else float("nan"), "covariance": covariance,
            "heliocentric_distance_au": radius, "bound": bool(energy < 0)}


def multistart(observations: list[Observation], distances=START_DISTANCES_AU) -> dict:
    """Fit from every starting distance; report all solutions and whether they agree."""
    solutions = []
    for distance in distances:
        try:
            solution = fit(observations, starting_state(observations, distance))
        except (ValueError, np.linalg.LinAlgError, RuntimeError):
            continue
        if solution["success"] and np.isfinite(solution["chi2"]):
            solutions.append({**solution, "start_distance_au": distance})
    if not solutions:
        return {"status": "unconstrained", "reason_key": "predict.orbit-no-solution", "solutions": []}
    best = min(solutions, key=lambda item: item["chi2"])
    near = [item for item in solutions if item["chi2"] - best["chi2"] <= SAME_SOLUTION_DELTA_CHI2]
    return {"status": "fitted", "best": best, "solutions": solutions, "near_best": near}


def predict(solution: dict, mjd: float, observer: np.ndarray, extra_sigma_arcsec: float = 0.0) -> dict:
    """Predicted RA/Dec with a 2x2 east/north covariance (arcsec^2) from the state covariance."""
    state, t0 = solution["state"], solution["t0"]
    ra, dec = apparent_radec(state, t0, mjd, observer)
    covariance = solution["covariance"] * max(1.0, solution["chi2_red"])
    jacobian = np.zeros((2, 6))
    steps = np.array([1e-6, 1e-6, 1e-6, 1e-9, 1e-9, 1e-9])
    for index in range(6):
        shifted = state.copy()
        shifted[index] += steps[index]
        ra1, dec1 = apparent_radec(shifted, t0, mjd, observer)
        jacobian[:, index] = np.array(tangent_offsets_arcsec(ra, dec, ra1, dec1)) / steps[index]
    predicted = jacobian @ covariance @ jacobian.T + np.eye(2) * extra_sigma_arcsec**2
    return {"ra_deg": ra, "dec_deg": dec, "cov_arcsec2": predicted}
