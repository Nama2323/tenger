"""Positions on original SPHEREx pixels, and proper motion with real observer geometry.

Position: a pixel-integrated circular Gaussian plus a constant sky is fitted to the
unflagged native pixels around a guess, weighted by 1/VARIANCE. Rejected pixels
(tenger-mask-v1, e.g. a saturated core) are left out, never filled. The covariance
comes from the fit (scaled up by the reduced chi-square when it exceeds 1) and is
mapped to east/north arcsec through the file's own WCS (SIP included).

Motion: tangent-plane offsets are fitted with a linear proper motion plus annual
parallax computed from the observer's barycentric position (Earth from the JPL
ephemeris built into astropy, plus the spacecraft's geocentric position from the
FITS header). Parallax can be fixed to a catalogue value (then the result is
catalogue-assisted) or left out (a linear baseline).
"""
import math
from dataclasses import dataclass

import numpy as np
from astropy import units as u
from astropy.coordinates import get_body_barycentric
from astropy.time import Time
from scipy.optimize import least_squares
from scipy.special import erf

from .processing import NativeProduct

KM_PER_AU = 1.495978707e8
DAYS_PER_YEAR = 365.25
FWHM_PER_SIGMA = 2.0 * math.sqrt(2.0 * math.log(2.0))
DEFAULT_FWHM_ARCSEC = 9.0
FIT_RADIUS_ARCSEC = 15.0
MIN_GOOD_PIXELS = 9
MIN_SNR = 10.0
SIGMA_RANGE = (0.5, 2.5)  # allowed fitted width relative to the header PSF


@dataclass(frozen=True)
class Position:
    status: str  # "measured" or "insufficient_data"
    reason_key: str | None
    ra_deg: float | None = None
    dec_deg: float | None = None
    cov_arcsec2: tuple[tuple[float, float], tuple[float, float]] | None = None
    snr: float | None = None
    n_pixels: int = 0
    n_rejected_in_radius: int = 0
    chi2_red: float | None = None
    sigma_ratio: float | None = None

    def to_json(self) -> dict:
        return {
            "status": self.status, "reason_key": self.reason_key, "ra_deg": self.ra_deg,
            "dec_deg": self.dec_deg, "cov_arcsec2": self.cov_arcsec2, "snr": self.snr,
            "n_pixels": self.n_pixels, "n_rejected_in_radius": self.n_rejected_in_radius,
            "chi2_red": self.chi2_red, "sigma_ratio": self.sigma_ratio,
        }


def _pixel_gaussian(params, x, y):
    amplitude, x0, y0, sigma, sky = params
    scale = math.sqrt(2.0) * sigma
    gx = 0.5 * (erf((x + 0.5 - x0) / scale) - erf((x - 0.5 - x0) / scale))
    gy = 0.5 * (erf((y + 0.5 - y0) / scale) - erf((y - 0.5 - y0) / scale))
    return amplitude * gx * gy + sky


def pixel_scale_arcsec(product: NativeProduct, x: float, y: float) -> float:
    ra1, dec1 = product.wcs.all_pix2world([[x, y], [x + 1, y]], 0).T
    cos_dec = math.cos(math.radians(dec1[0]))
    return math.hypot((ra1[1] - ra1[0]) * cos_dec, dec1[1] - dec1[0]) * 3600


def _east_north_jacobian(product: NativeProduct, x: float, y: float) -> np.ndarray:
    """d(east, north arcsec) / d(x, y pixel) from the full WCS."""
    points = np.array([[x, y], [x + 0.01, y], [x, y + 0.01]])
    ra, dec = product.wcs.all_pix2world(points, 0).T
    cos_dec = math.cos(math.radians(dec[0]))
    east = ((ra - ra[0] + 180) % 360 - 180) * cos_dec * 3600
    north = (dec - dec[0]) * 3600
    return np.array([[east[1], east[2]], [north[1], north[2]]]) / 0.01


def fit_position(
    product: NativeProduct,
    ra: float,
    dec: float,
    fwhm_arcsec: float | None = None,
    radius_arcsec: float = FIT_RADIUS_ARCSEC,
) -> Position:
    """Fit one point source near (ra, dec) on the native pixels."""
    x_guess, y_guess = (float(v) for v in product.wcs.all_world2pix(ra, dec, 0))
    height, width = product.image.shape
    if not (np.isfinite(x_guess) and np.isfinite(y_guess)) or not (
        0 <= x_guess < width and 0 <= y_guess < height
    ):
        return Position("insufficient_data", "measure.outside-cutout")
    scale = pixel_scale_arcsec(product, x_guess, y_guess)
    radius_px = radius_arcsec / scale
    rows, cols = np.mgrid[:height, :width]
    near = np.hypot(cols - x_guess, rows - y_guess) <= radius_px
    good = near & ~product.reject
    n_rejected = int((near & product.reject).sum())
    if good.sum() < MIN_GOOD_PIXELS:
        return Position("insufficient_data", "measure.too-few-good-pixels", n_pixels=int(good.sum()),
                        n_rejected_in_radius=n_rejected)
    data = (product.image.astype(np.float64) - product.zodi.astype(np.float64))[good]
    sigma_data = np.sqrt(product.variance.astype(np.float64)[good])
    x, y = cols[good].astype(float), rows[good].astype(float)
    fwhm = fwhm_arcsec or DEFAULT_FWHM_ARCSEC
    sigma0 = fwhm / FWHM_PER_SIGMA / scale
    sky0 = float(np.median(data))
    peak = float(np.max(data) - sky0)
    start = [max(peak, 1e-6) * 2 * math.pi * sigma0**2, x_guess, y_guess, sigma0, sky0]
    lower = [0.0, x_guess - radius_px / 2, y_guess - radius_px / 2, sigma0 * SIGMA_RANGE[0], -np.inf]
    upper = [np.inf, x_guess + radius_px / 2, y_guess + radius_px / 2, sigma0 * SIGMA_RANGE[1], np.inf]
    start = [min(max(value, lo + 1e-9), hi - 1e-9) if np.isfinite(hi) else max(value, lo + 1e-9)
             for value, lo, hi in zip(start, lower, upper)]

    def residual(params):
        return (_pixel_gaussian(params, x, y) - data) / sigma_data

    try:
        fit = least_squares(residual, start, bounds=(lower, upper), method="trf", x_scale="jac")
    except ValueError:
        return Position("insufficient_data", "measure.fit-failed", n_pixels=int(good.sum()),
                        n_rejected_in_radius=n_rejected)
    dof = max(1, good.sum() - len(start))
    chi2_red = float(np.sum(fit.fun**2) / dof)
    try:
        covariance = np.linalg.inv(fit.jac.T @ fit.jac) * max(1.0, chi2_red)
    except np.linalg.LinAlgError:
        return Position("insufficient_data", "measure.fit-singular", n_pixels=int(good.sum()),
                        n_rejected_in_radius=n_rejected)
    amplitude, x0, y0, sigma, _ = fit.x
    amplitude_error = math.sqrt(max(covariance[0, 0], 0.0))
    snr = float(amplitude / amplitude_error) if amplitude_error > 0 else 0.0
    sigma_ratio = float(sigma / sigma0)
    common = dict(n_pixels=int(good.sum()), n_rejected_in_radius=n_rejected, chi2_red=chi2_red,
                  snr=snr, sigma_ratio=sigma_ratio)
    if not fit.success:
        return Position("insufficient_data", "measure.fit-failed", **common)
    if snr < MIN_SNR:
        return Position("insufficient_data", "measure.low-snr", **common)
    at_bound = any(
        abs(value - edge) < 1e-6 * max(1.0, abs(edge))
        for value, low, high in zip(fit.x[1:3], lower[1:3], upper[1:3])
        for edge in (low, high)
    )
    if at_bound or not (SIGMA_RANGE[0] * 1.01 < sigma_ratio < SIGMA_RANGE[1] * 0.99):
        return Position("insufficient_data", "measure.fit-at-bound", **common)
    jacobian = _east_north_jacobian(product, float(x0), float(y0))
    cov_en = jacobian @ covariance[1:3, 1:3] @ jacobian.T
    fitted_ra, fitted_dec = (float(v) for v in product.wcs.all_pix2world(x0, y0, 0))
    return Position(
        "measured", None, fitted_ra, fitted_dec,
        ((float(cov_en[0, 0]), float(cov_en[0, 1])), (float(cov_en[1, 0]), float(cov_en[1, 1]))),
        **common,
    )


# ---------------------------------------------------------------- motion


def observer_barycentric_au(mjd_utc: float, spacecraft_km: tuple[float, float, float] | None) -> np.ndarray:
    """Barycentric ICRS position of the observer in au (Earth plus spacecraft offset)."""
    earth = get_body_barycentric("earth", Time(mjd_utc, format="mjd", scale="utc"))
    position = np.array([earth.x.to_value(u.au), earth.y.to_value(u.au), earth.z.to_value(u.au)])
    if spacecraft_km is not None:
        position = position + np.asarray(spacecraft_km, float) / KM_PER_AU
    return position


def parallax_factors(ra_deg: float, dec_deg: float, observer_au: np.ndarray) -> tuple[float, float]:
    """(east, north) displacement per unit parallax for an observer at observer_au."""
    a, d = math.radians(ra_deg), math.radians(dec_deg)
    x, y, z = observer_au
    east = x * math.sin(a) - y * math.cos(a)
    north = x * math.sin(d) * math.cos(a) + y * math.sin(d) * math.sin(a) - z * math.cos(d)
    return east, north


def tangent_offsets_arcsec(ra0: float, dec0: float, ra: float, dec: float) -> tuple[float, float]:
    """Gnomonic (standard coordinate) offsets of (ra, dec) from (ra0, dec0), arcsec."""
    a0, d0, a, d = (math.radians(v) for v in (ra0, dec0, ra, dec))
    cos_c = math.sin(d0) * math.sin(d) + math.cos(d0) * math.cos(d) * math.cos(a - a0)
    xi = math.cos(d) * math.sin(a - a0) / cos_c
    eta = (math.cos(d0) * math.sin(d) - math.sin(d0) * math.cos(d) * math.cos(a - a0)) / cos_c
    return math.degrees(xi) * 3600, math.degrees(eta) * 3600


def tangent_to_sky(ra0: float, dec0: float, xi_arcsec: float, eta_arcsec: float) -> tuple[float, float]:
    xi, eta = math.radians(xi_arcsec / 3600), math.radians(eta_arcsec / 3600)
    a0, d0 = math.radians(ra0), math.radians(dec0)
    rho = math.hypot(xi, eta)
    if rho == 0:
        return ra0, dec0
    c = math.atan(rho)
    dec = math.asin(math.cos(c) * math.sin(d0) + eta * math.sin(c) * math.cos(d0) / rho)
    ra = a0 + math.atan2(xi * math.sin(c), rho * math.cos(d0) * math.cos(c) - eta * math.sin(d0) * math.sin(c))
    return (math.degrees(ra) % 360, math.degrees(dec))


@dataclass(frozen=True)
class Point:
    """One measured position: time (MJD UTC), offsets (arcsec) and their covariance."""

    mjd: float
    east: float
    north: float
    cov: np.ndarray
    observer_au: np.ndarray


def fit_motion(
    points: list[Point],
    ra0: float,
    dec0: float,
    mjd_ref: float,
    parallax_arcsec: float | None,
    floor_arcsec: float = 0.0,
    fit_parallax: bool = False,
) -> dict:
    """Weighted least squares for offset + proper motion, with parallax fixed, free or absent.

    parallax_arcsec fixes the parallax (catalogue-assisted); fit_parallax=True fits it as
    a fifth parameter from the SPHEREx positions alone. Each point's covariance is
    increased by floor_arcsec**2 on both axes (systematic floor).
    """
    if len(points) < 3:
        return {"status": "insufficient_data", "reason_key": "measure.too-few-epochs", "n_points": len(points)}
    rows, values, weights_blocks = [], [], []
    for point in points:
        tau = (point.mjd - mjd_ref) / DAYS_PER_YEAR
        pe, pn = parallax_factors(ra0, dec0, point.observer_au)
        fixed = parallax_arcsec if (parallax_arcsec and not fit_parallax) else 0.0
        shift_e, shift_n = fixed * pe, fixed * pn
        if fit_parallax:
            rows += [[1.0, 0.0, tau, 0.0, pe], [0.0, 1.0, 0.0, tau, pn]]
        else:
            rows += [[1.0, 0.0, tau, 0.0], [0.0, 1.0, 0.0, tau]]
        values += [point.east - shift_e, point.north - shift_n]
        cov = np.asarray(point.cov, float) + np.eye(2) * floor_arcsec**2
        weights_blocks.append(np.linalg.inv(cov))
    design = np.array(rows)
    values = np.array(values)
    weight = np.zeros((len(values), len(values)))
    for index, block in enumerate(weights_blocks):
        weight[2 * index:2 * index + 2, 2 * index:2 * index + 2] = block
    normal = design.T @ weight @ design
    times = np.array([point.mjd for point in points])
    if np.ptp(times) < 30:
        return {"status": "insufficient_data", "reason_key": "measure.baseline-too-short", "n_points": len(points)}
    covariance = np.linalg.inv(normal)
    params = covariance @ design.T @ weight @ values
    residual = values - design @ params
    chi2 = float(residual @ weight @ residual)
    dof = max(1, len(values) - design.shape[1])
    named = {"east0": float(params[0]), "north0": float(params[1]),
             "pm_east_arcsec_yr": float(params[2]), "pm_north_arcsec_yr": float(params[3])}
    if fit_parallax:
        named["parallax_arcsec"] = float(params[4])
    return {
        "status": "measured",
        "reason_key": None,
        "params": named,
        "cov": covariance.tolist(),
        "chi2": chi2,
        "dof": dof,
        "chi2_red": chi2 / dof,
        "n_points": len(points),
        "span_days": float(np.ptp(times)),
        "residuals_arcsec": residual.reshape(-1, 2).tolist(),
        "parallax_fixed_arcsec": None if fit_parallax else parallax_arcsec,
        "parallax_fitted": fit_parallax,
        "floor_arcsec": floor_arcsec,
    }


def total_motion(fit: dict, scale_by_chi2: bool = True) -> tuple[float, float]:
    """Total proper motion (arcsec/yr) and its 1-sigma uncertainty (linearised)."""
    pe, pn = fit["params"]["pm_east_arcsec_yr"], fit["params"]["pm_north_arcsec_yr"]
    cov = np.array(fit["cov"])[2:4, 2:4]
    if scale_by_chi2:
        cov = cov * max(1.0, fit["chi2_red"])
    total = math.hypot(pe, pn)
    if total == 0:
        return 0.0, math.sqrt(np.trace(cov) / 2)
    gradient = np.array([pe, pn]) / total
    return total, float(math.sqrt(gradient @ cov @ gradient))
