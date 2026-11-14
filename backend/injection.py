"""Injection-recovery on native SPHEREx cutouts (Task A8). In memory only: nothing here writes pixels.

PSF. DR1 and QR3 products (software >= 7.0) carry the ePSF as the binary-table extension ``EPSF``: one
row per detector zone with BINX, BINY, XCENTER, YCENTER (0-indexed parent-image pixels) and an
oversampled ePSF (OVSMPX x OVSMPY). The ePSF is a pixel-convolved PSF: sampled at native pixel centres it
gives pixel values (IRSA tutorial "Understanding and Extracting the ePSF Extension in a SPHEREx
Cutout"). Rows are ordered "x-fast then y" (header ORDERING), so zone (bx, by) is row ``by * nx + bx``
(0-based). That is the ordering of the older QR1/QR2 PSF-cube rule ``iplane = y * 11 + x + 1``
(1-based, 11 x 11 zones); the DR1 table has 21 x 21 zones, 5x oversampling. ``zone_row`` picks the zone
whose centre is nearest the source; ``test_psf_mapping`` in scripts/planetx.py checks it on real stars.

Detection uses the site's own measurement, ``backend.astrometry.fit_position`` (pixel-integrated
Gaussian, VARIANCE-weighted, 15" fit radius), with the S/N threshold set for the call. The file is not
edited (its hash is part of frozen forecasts); only the module constant is set inside ``snr_threshold``.
"""
import math
from contextlib import contextmanager
from dataclasses import dataclass, replace

import numpy as np
from astropy.io import fits
from scipy.ndimage import map_coordinates

from . import astrometry
from .processing import NativeProduct, _open, load_product

AB_ZERO_JY = 3631.0
ARCSEC2_PER_SR = (180.0 / math.pi * 3600.0) ** 2
WILSON_Z95 = 1.959963984540054
STAMP_HALF = 5  # native pixels each side of the source; the DR1 ePSF reaches 3.3 px


@dataclass(frozen=True)
class EPSFTable:
    binx: np.ndarray
    biny: np.ndarray
    xcenter: np.ndarray
    ycenter: np.ndarray
    cube: np.ndarray  # (zones, ny, nx), oversampled, row = y
    oversampling: int
    ordering: str
    nx: int
    ny: int
    cwave: np.ndarray
    calibration: str


@dataclass(frozen=True)
class Cutout:
    product: NativeProduct
    header: fits.Header  # IMAGE header (CRPIX1A/CRPIX2A give the parent-image position)
    epsf: EPSFTable


@dataclass(frozen=True)
class Recovery:
    found: bool
    snr: float | None
    offset_px: float | None
    reason_key: str | None
    ra_deg: float | None = None
    dec_deg: float | None = None


def read_epsf(hdus: fits.HDUList) -> EPSFTable:
    names = [hdu.name for hdu in hdus]
    if "EPSF" not in names:
        raise ValueError("no EPSF extension: product older than software 7.0")
    hdu = hdus["EPSF"]
    header, table = hdu.header, hdu.data
    over_x, over_y = int(header["OVSMPX"]), int(header["OVSMPY"])
    if over_x != over_y:
        raise ValueError("unequal ePSF oversampling")
    cube = np.asarray(table["EPSF"], dtype=np.float64)
    binx, biny = np.asarray(table["BINX"], int), np.asarray(table["BINY"], int)
    calibration = next((str(card).split(":", 1)[1].strip() for card in header.get("HISTORY", [])
                        if "Calibration source file" in str(card)), "")
    return EPSFTable(binx, biny, np.asarray(table["XCENTER"], float), np.asarray(table["YCENTER"], float),
                     cube, over_x, str(header.get("ORDERING", "")), int(binx.max() + 1), int(biny.max() + 1),
                     np.asarray(table["CWAVE"], float), calibration)


def load_cutout(fits_bytes: bytes) -> Cutout:
    product = load_product(fits_bytes)
    with _open(fits_bytes) as hdus:
        header = hdus["IMAGE"].header.copy()
        epsf = read_epsf(hdus)
    return Cutout(product, header, epsf)


def parent_pixel(header: fits.Header, x: float, y: float) -> tuple[float, float]:
    """0-indexed cutout pixel -> parent-image pixel, as in the IRSA tutorial (1 + x - CRPIX1A)."""
    return 1.0 + x - float(header["CRPIX1A"]), 1.0 + y - float(header["CRPIX2A"])


def row_for_bin(epsf: EPSFTable, bx: int, by: int) -> int | None:
    """Table row holding zone (bx, by), looked up by its BINX/BINY columns."""
    hits = np.nonzero((epsf.binx == bx) & (epsf.biny == by))[0]
    return int(hits[0]) if len(hits) else None


def ordering_consistent(epsf: EPSFTable) -> bool:
    """True when every row r holds zone (r % nx, r // nx): the stated 'x-fast then y' ordering."""
    rows = np.arange(len(epsf.binx))
    return bool(epsf.ordering == "x-fast then y" and np.all(rows == epsf.biny * epsf.nx + epsf.binx))


def zone_row(epsf: EPSFTable, x_parent: float, y_parent: float) -> int:
    distance = np.hypot(epsf.xcenter - x_parent, epsf.ycenter - y_parent)
    return int(np.argmin(distance))


def transposed_row(epsf: EPSFTable, row: int) -> int | None:
    """The zone a reader would pick by swapping x and y (the mislabelling the mapping test guards against)."""
    return row_for_bin(epsf, int(epsf.biny[row]), int(epsf.binx[row]))


def render(epsf: EPSFTable, row: int, x0: float, y0: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Unit-flux ePSF sampled at native pixel centres around (x0, y0).

    Returns (stamp, xs, ys): stamp[j, i] belongs to pixel (ys[j], xs[i]). The stamp sums to 1 over its full
    extent (the convention of the IRSA tutorial's unit_flux rendering); pixels off the cutout are dropped
    by the caller, so a source at an edge loses flux as a real one would.
    """
    plane = epsf.cube[row]
    centre_y, centre_x = (plane.shape[0] - 1) / 2.0, (plane.shape[1] - 1) / 2.0
    xs = np.arange(int(round(x0)) - STAMP_HALF, int(round(x0)) + STAMP_HALF + 1)
    ys = np.arange(int(round(y0)) - STAMP_HALF, int(round(y0)) + STAMP_HALF + 1)
    grid_y, grid_x = np.meshgrid(ys, xs, indexing="ij")
    u = centre_x + (grid_x - x0) * epsf.oversampling
    v = centre_y + (grid_y - y0) * epsf.oversampling
    stamp = map_coordinates(plane, [v, u], order=3, mode="constant", cval=0.0)
    total = stamp.sum()
    if not (np.isfinite(total) and total > 0):
        raise ValueError("ePSF renders to zero")
    return stamp / total, xs, ys


def pixel_solid_angle_sr(product: NativeProduct, x: float, y: float) -> float:
    jacobian = astrometry._east_north_jacobian(product, x, y)
    return abs(float(np.linalg.det(jacobian))) / ARCSEC2_PER_SR


def ab_to_jy(mag_ab: float) -> float:
    return AB_ZERO_JY * 10.0 ** (-0.4 * mag_ab)


def jy_to_ab(flux_jy: float) -> float:
    return -2.5 * math.log10(flux_jy / AB_ZERO_JY) if flux_jy > 0 else math.inf


def source_image(cutout: Cutout, x: float, y: float, mag_ab: float) -> np.ndarray:
    """MJy/sr image of one point source of AB magnitude mag_ab at 0-indexed cutout pixel (x, y)."""
    product = cutout.product
    row = zone_row(cutout.epsf, *parent_pixel(cutout.header, x, y))
    stamp, xs, ys = render(cutout.epsf, row, x, y)
    omega = pixel_solid_angle_sr(product, x, y)
    out = np.zeros(product.image.shape, dtype=np.float64)
    height, width = out.shape
    keep_y, keep_x = (ys >= 0) & (ys < height), (xs >= 0) & (xs < width)
    block = stamp[np.ix_(keep_y, keep_x)] * ab_to_jy(mag_ab) / omega / 1e6
    out[np.ix_(ys[keep_y], xs[keep_x])] += block
    return out


def inject(cutout: Cutout, sources: list[tuple[float, float, float]]) -> NativeProduct:
    """A copy of the product with artificial point sources added to IMAGE (x, y, AB mag each).

    VARIANCE is left as it is: at the magnitudes tested the source's own photon noise is small next to
    the zodiacal-light background. FLAGS, ZODI and WCS are unchanged. The input arrays are not modified.
    """
    image = cutout.product.image.astype(np.float64).copy()
    for x, y, mag in sources:
        image += source_image(cutout, x, y, mag)
    return replace(cutout.product, image=image.astype(np.float32))


@contextmanager
def snr_threshold(value: float):
    previous = astrometry.MIN_SNR
    astrometry.MIN_SNR = value
    try:
        yield
    finally:
        astrometry.MIN_SNR = previous


def recover(product: NativeProduct, x: float, y: float, snr_min: float = 5.0,
            max_offset_px: float = 1.0) -> Recovery:
    """The site's fit at the injected (or blank) position; found = measured, S/N >= snr_min, within 1 px."""
    ra, dec = (float(v) for v in product.wcs.all_pix2world(x, y, 0))
    with snr_threshold(snr_min):
        position = astrometry.fit_position(product, ra, dec, product.info.get("PSF_FWHM"))
    if position.status != "measured":
        return Recovery(False, position.snr, None, position.reason_key)
    fx, fy = (float(v) for v in product.wcs.all_world2pix(position.ra_deg, position.dec_deg, 0))
    offset = math.hypot(fx - x, fy - y)
    if offset > max_offset_px:
        return Recovery(False, position.snr, offset, "recover.offset", position.ra_deg, position.dec_deg)
    return Recovery(True, position.snr, offset, None, position.ra_deg, position.dec_deg)


PHOTOMETRY_HALF = 3  # 7 x 7 native pixels (+-18"): holds the ePSF (3.3 px) and stays near the 15" exclusion


def psf_photometry(cutout: Cutout, product: NativeProduct, x: float, y: float,
                   half: int = PHOTOMETRY_HALF) -> tuple[float, float]:
    """Flux (Jy) and its 1-sigma error from a VARIANCE-weighted linear fit of ePSF + flat sky at (x, y).

    The ePSF keeps the full-stamp normalisation (sum 1 over +-5 px) and is cropped to +-half px, so a
    smaller box loses no flux scale, only the far wings."""
    row = zone_row(cutout.epsf, *parent_pixel(cutout.header, x, y))
    stamp, xs, ys = render(cutout.epsf, row, x, y)
    cut = STAMP_HALF - half
    stamp, xs, ys = stamp[cut:len(ys) - cut, cut:len(xs) - cut], xs[cut:len(xs) - cut], ys[cut:len(ys) - cut]
    height, width = product.image.shape
    keep_y, keep_x = (ys >= 0) & (ys < height), (xs >= 0) & (xs < width)
    yy, xx = np.ix_(ys[keep_y], xs[keep_x])
    model = stamp[np.ix_(keep_y, keep_x)]
    data = product.image[yy, xx].astype(np.float64) - product.zodi[yy, xx].astype(np.float64)
    variance = product.variance[yy, xx].astype(np.float64)
    good = ~product.reject[yy, xx] & np.isfinite(data) & (variance > 0)
    design = np.column_stack([model[good], np.ones(good.sum())])
    weights = 1.0 / variance[good]
    normal = design.T @ (design * weights[:, None])
    covariance = np.linalg.inv(normal)
    solution = covariance @ (design.T @ (data[good] * weights))
    omega = pixel_solid_angle_sr(product, x, y)
    to_jy = omega * 1e6
    return float(solution[0] * to_jy), float(math.sqrt(covariance[0, 0]) * to_jy)


def matched_snr(cutout: Cutout, x: float, y: float, mag_ab: float) -> float:
    """Expected S/N of an optimal PSF fit (sqrt of sum of model^2 / variance): used only to pick the grid."""
    signal = source_image(cutout, x, y, mag_ab)
    variance = cutout.product.variance.astype(np.float64)
    good = (signal > 0) & ~cutout.product.reject & (variance > 0)
    return float(math.sqrt(np.sum(signal[good] ** 2 / variance[good])))


def wilson(k: int, n: int, z: float = WILSON_Z95) -> tuple[float, float]:
    """Wilson score interval for k successes in n trials."""
    if n <= 0:
        return 0.0, 1.0
    p = k / n
    denominator = 1.0 + z * z / n
    centre = (p + z * z / (2 * n)) / denominator
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator
    return max(0.0, centre - half), min(1.0, centre + half)


def isotonic_decreasing(values: list[float], weights: list[float]) -> list[float]:
    """Pool-adjacent-violators fit, non-increasing along the list (bright to faint)."""
    blocks = []  # [value, weight, count]
    for value, weight in zip(values, weights):
        blocks.append([value, max(weight, 1e-12), 1])
        while len(blocks) > 1 and blocks[-2][0] < blocks[-1][0]:
            v2, w2, c2 = blocks.pop()
            v1, w1, c1 = blocks.pop()
            blocks.append([(v1 * w1 + v2 * w2) / (w1 + w2), w1 + w2, c1 + c2])
    out = []
    for value, _, count in blocks:
        out.extend([value] * count)
    return out


def crossing(mags: list[float], values: list[float], level: float) -> float | None:
    """Magnitude where a non-increasing curve first drops below level (linear interpolation)."""
    if not mags or values[0] < level:
        return None
    for i in range(len(mags) - 1):
        if values[i] >= level > values[i + 1]:
            fraction = (values[i] - level) / (values[i] - values[i + 1])
            return mags[i] + fraction * (mags[i + 1] - mags[i])
    return None


def completeness(curve: list[dict], level: float) -> dict | None:
    """Depth at a completeness level, with the range where the pointwise 95% Wilson band crosses it."""
    mags = [point["mag_ab"] for point in curve]
    fit = isotonic_decreasing([point["fraction"] for point in curve], [point["injected"] for point in curve])
    lower = np.minimum.accumulate([point["interval"][0] for point in curve]).tolist()
    upper = np.maximum.accumulate([point["interval"][1] for point in curve][::-1])[::-1].tolist()
    value = crossing(mags, fit, level)
    if value is None:
        return None
    bright, faint = crossing(mags, lower, level), crossing(mags, upper, level)
    return {"value": round(value, 3),
            "interval": [round(bright, 3) if bright is not None else None,
                         round(faint, 3) if faint is not None else None]}
