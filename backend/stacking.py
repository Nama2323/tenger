"""Joint (shift-and-fit) position of a moving body on native pixels.

A faint body that no single exposure detects can still be measured by fitting one
model to all exposures of an epoch at once: the body sits at the ephemeris position
plus one common offset (east, north arcsec); each exposure has its own amplitude and
sky, its own WCS, VARIANCE weights and mask. Nothing is resampled. A robust loss
reduces the pull of stars that cross the body's path.

Null test: the same fit with the ephemeris positions assigned to the wrong
exposures (a fixed cyclic shift of times). A real moving body is not recovered there.
"""
import math
from dataclasses import dataclass

import numpy as np
from scipy.optimize import least_squares
from scipy.special import erf

from . import astrometry
from .processing import NativeProduct

RADIUS_ARCSEC = 15.0
MAX_OFFSET_ARCSEC = 12.0
DETECTION_SNR = 5.0
NULL_MAX_SNR = 3.0


@dataclass
class _Stamp:
    x: np.ndarray
    y: np.ndarray
    data: np.ndarray
    sigma: np.ndarray
    x0: float
    y0: float
    inverse_jacobian: np.ndarray  # d(x, y pixel) / d(east, north arcsec)
    psf_sigma_px: float


def _stamp(product: NativeProduct, ra: float, dec: float) -> _Stamp | None:
    x0, y0 = (float(v) for v in product.wcs.all_world2pix(ra, dec, 0))
    height, width = product.image.shape
    if not (np.isfinite(x0) and np.isfinite(y0) and 0 <= x0 < width and 0 <= y0 < height):
        return None
    scale = astrometry.pixel_scale_arcsec(product, x0, y0)
    rows, cols = np.mgrid[:height, :width]
    near = (np.hypot(cols - x0, rows - y0) <= RADIUS_ARCSEC / scale) & ~product.reject
    if near.sum() < 9:
        return None
    jacobian = astrometry._east_north_jacobian(product, x0, y0)
    fwhm = float(product.info.get("PSF_FWHM") or astrometry.DEFAULT_FWHM_ARCSEC)
    return _Stamp(cols[near].astype(float), rows[near].astype(float),
                  (product.image.astype(float) - product.zodi.astype(float))[near],
                  np.sqrt(product.variance.astype(float)[near]), x0, y0, np.linalg.inv(jacobian),
                  fwhm / astrometry.FWHM_PER_SIGMA / scale)


def _profile(stamp: _Stamp, east: float, north: float) -> np.ndarray:
    dx, dy = stamp.inverse_jacobian @ np.array([east, north])
    xc, yc, s = stamp.x0 + dx, stamp.y0 + dy, math.sqrt(2.0) * stamp.psf_sigma_px
    gx = 0.5 * (erf((stamp.x + 0.5 - xc) / s) - erf((stamp.x - 0.5 - xc) / s))
    gy = 0.5 * (erf((stamp.y + 0.5 - yc) / s) - erf((stamp.y - 0.5 - yc) / s))
    return gx * gy


def joint_fit(products: list[NativeProduct], positions: list[tuple[float, float]]) -> dict:
    """Fit one common offset from the given positions (ephemeris) to all exposures."""
    stamps = [stamp for stamp in (_stamp(p, ra, dec) for p, (ra, dec) in zip(products, positions)) if stamp]
    if len(stamps) < 3:
        return {"status": "insufficient_data", "reason_key": "measure.too-few-good-pixels", "n_exposures": len(stamps)}
    n = len(stamps)

    def unpack(params):
        return params[0], params[1], params[2:2 + n], params[2 + n:]

    def residual(params):
        east, north, amplitude, sky = unpack(params)
        return np.concatenate([
            (amplitude[i] * _profile(stamp, east, north) + sky[i] - stamp.data) / stamp.sigma
            for i, stamp in enumerate(stamps)
        ])

    start = np.concatenate([[0.0, 0.0], [max(float(np.max(s.data) - np.median(s.data)), 1e-3) for s in stamps],
                            [float(np.median(s.data)) for s in stamps]])
    lower = np.concatenate([[-MAX_OFFSET_ARCSEC] * 2, [-np.inf] * n, [-np.inf] * n])
    upper = np.concatenate([[MAX_OFFSET_ARCSEC] * 2, [np.inf] * n, [np.inf] * n])
    fit = least_squares(residual, start, bounds=(lower, upper), loss="soft_l1", f_scale=3.0, x_scale="jac")
    dof = max(1, fit.fun.size - fit.x.size)
    chi2_red = float(np.sum(fit.fun**2) / dof)
    try:
        covariance = np.linalg.inv(fit.jac.T @ fit.jac) * max(1.0, chi2_red)
    except np.linalg.LinAlgError:
        return {"status": "insufficient_data", "reason_key": "measure.fit-singular", "n_exposures": n}
    east, north, amplitude, _ = unpack(fit.x)
    # Total signal: inverse-variance mean amplitude and its error.
    amp_var = np.diag(covariance)[2:2 + n]
    weights = 1.0 / np.maximum(amp_var, 1e-30)
    mean_amp = float(np.sum(weights * amplitude) / np.sum(weights))
    snr = mean_amp * math.sqrt(float(np.sum(weights)))
    at_bound = max(abs(east), abs(north)) > MAX_OFFSET_ARCSEC * 0.98
    return {
        "status": "measured" if (snr >= DETECTION_SNR and not at_bound) else "insufficient_data",
        "reason_key": None if (snr >= DETECTION_SNR and not at_bound) else
        ("measure.fit-at-bound" if at_bound else "measure.low-snr"),
        "offset_east_arcsec": float(east), "offset_north_arcsec": float(north),
        "cov_arcsec2": covariance[:2, :2].tolist(), "snr": float(snr), "chi2_red": chi2_red, "n_exposures": n,
    }


def null_test(products: list[NativeProduct], positions: list[tuple[float, float]]) -> dict:
    """The same fit with positions cyclically shifted against the exposures."""
    if len(products) < 4:
        return {"status": "not_run", "snr": None}
    shift = len(products) // 2
    shuffled = positions[shift:] + positions[:shift]
    result = joint_fit(products, shuffled)
    if result.get("snr") is None:
        return {"status": "inconclusive", "snr": None, "passes": None, "n_exposures": result.get("n_exposures")}
    return {"status": result["status"], "snr": result["snr"], "passes": result["snr"] < NULL_MAX_SNR,
            "n_exposures": result.get("n_exposures")}
