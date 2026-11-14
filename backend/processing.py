"""Turns SPHEREx cutouts into aligned display frames and native-resolution photometry.

Two products come from one cutout and must not be confused:

* :class:`NativeProduct` keeps IMAGE, VARIANCE, FLAGS, ZODI, the celestial WCS and
  the WCS-WAVE spectral lookup at original resolution and precision. Every
  published measurement uses it (see :func:`native_aperture_photometry`).
* :class:`Native` and :func:`reproject` make the north-up preview plate
  (at most 160 pixels, background-levelled) for display only. Display resolution,
  contrast and compression never change a measurement.
"""
import gzip
import io
import math
import warnings
from dataclasses import dataclass

import numpy as np
from astropy import log as astropy_log
from astropy.io import fits
from astropy.wcs import WCS
from astropy.wcs.utils import proj_plane_pixel_area
from scipy.ndimage import map_coordinates

from . import flags as flagdefs
from .spectral import Response

warnings.filterwarnings("ignore", module="astropy.wcs")
# The spectral lookup WCS shares the SIP cards of the celestial one and astropy logs
# an INFO note about it; the SIP terms are removed explicitly below.
astropy_log.setLevel("WARNING")

# Approximate wavelength limits (um) of the six arrays. Used only to label display
# bins ("channel"); never to decide whether two exposures saw the same wavelength.
DETECTOR_RANGES = {
    1: (0.75, 1.09),
    2: (1.10, 1.62),
    3: (1.63, 2.41),
    4: (2.42, 3.82),
    5: (3.83, 4.41),
    6: (4.42, 5.00),
}
CHANNELS_PER_DETECTOR = 17
VISIT_GAP_DAYS = 30.0
VISIT_MAX_SPAN_DAYS = 75.0
PLATE_SCALE_ARCSEC = 3.0
MAX_PLATE_PIXELS = 160
MJY_SR_TO_UJY_PER_SR = 1e12
MJY_TO_UJY = 1e12
APERTURE_RADIUS_ARCSEC = 7.0
ANNULUS_ARCSEC = (24.0, 42.0)
NATIVE_PIXEL_ARCSEC = 6.15
MIN_ANNULUS_PIXELS = 5
# The median of n Gaussian values has about pi/2 times the variance of their mean.
MEDIAN_VARIANCE_FACTOR = math.pi / 2
REQUIRED_EXTENSIONS = ("IMAGE", "FLAGS", "VARIANCE", "ZODI")
WAVE_EXTENSION = "WCS-WAVE"
PSF_EXTENSIONS = ("EPSF", "PSF")


class ProductError(ValueError):
    """A cutout lacks an extension or a quality schema that measurements need."""


@dataclass(frozen=True)
class NativeProduct:
    """One exposure exactly as delivered: original pixels, units and grid."""

    image: np.ndarray  # IMAGE, MJy/sr, zodiacal light NOT subtracted
    variance: np.ndarray  # VARIANCE, (MJy/sr)^2
    flags: np.ndarray  # FLAGS, raw bits
    zodi: np.ndarray  # ZODI model, MJy/sr
    flag_schema: flagdefs.FlagSchema
    reject: np.ndarray  # measurement mask under flag_schema.policy, plus non-finite pixels
    wcs: WCS
    wave_wcs: WCS | None
    detector: int | None
    obs_id: str | None
    software_version: str | None


@dataclass(frozen=True)
class Native:
    """Display copy of one exposure: zodiacal light and a median level removed."""

    image: np.ndarray
    bad: np.ndarray
    wcs: WCS
    wave_wcs: WCS | None


@dataclass(frozen=True)
class Grid:
    """North-up, east-left tangent-plane grid shared by every frame."""

    ra: float
    dec: float
    fov: float
    n: int
    scale: float
    wcs: WCS

    @classmethod
    def for_fov(cls, ra: float, dec: float, fov: float) -> "Grid":
        wanted = math.ceil(round(fov * 3600 / PLATE_SCALE_ARCSEC, 6))
        n = min(MAX_PLATE_PIXELS, wanted)
        scale = fov / n
        wcs = WCS(naxis=2)
        wcs.wcs.ctype = ["RA---TAN", "DEC--TAN"]
        wcs.wcs.crval = [ra, dec]
        wcs.wcs.crpix = [(n + 1) / 2, (n + 1) / 2]
        wcs.wcs.cdelt = [-scale, scale]
        return cls(ra, dec, fov, n, scale, wcs)


def contaminated_mask(flag_values: np.ndarray, header: fits.Header) -> np.ndarray:
    """Pixels whose value must not be trusted, decoded from the file's own flag schema.

    Raises :class:`backend.flags.UnknownFlagSchema` when the header has no known schema.
    """
    return flagdefs.reject_mask(flag_values, flagdefs.decode_header(header))


def group_visits(mjds: list[float]) -> list[int]:
    """Assign each time to a visit; returned list follows the input order."""
    order = sorted(range(len(mjds)), key=lambda index: mjds[index])
    visits = [0] * len(mjds)
    current, start, previous = 0, None, None
    for index in order:
        mjd = mjds[index]
        if start is None:
            start = mjd
        elif mjd - previous > VISIT_GAP_DAYS or mjd - start > VISIT_MAX_SPAN_DAYS:
            current, start = current + 1, mjd
        visits[index], previous = current, mjd
    return visits


def channel_index(wavelength_um: float, detector: int) -> int:
    """Approximate display bin 0-101 (17 log-spaced per array). A label, not a response."""
    low, high = DETECTOR_RANGES[detector]
    fraction = math.log(wavelength_um / low) / math.log(high / low)
    within = min(CHANNELS_PER_DETECTOR - 1, max(0, int(fraction * CHANNELS_PER_DETECTOR)))
    return (detector - 1) * CHANNELS_PER_DETECTOR + within


def _open(fits_bytes: bytes) -> fits.HDUList:
    if fits_bytes[:2] == b"\x1f\x8b":
        fits_bytes = gzip.decompress(fits_bytes)
    return fits.open(io.BytesIO(fits_bytes))


def load_product(fits_bytes: bytes) -> NativeProduct:
    """Read every science extension at original resolution; fail closed on quality metadata."""
    with _open(fits_bytes) as hdus:
        names = {hdu.name for hdu in hdus}
        missing = [name for name in REQUIRED_EXTENSIONS if name not in names]
        if missing:
            raise ProductError(f"cutout lacks extensions {missing}")
        try:
            schema = flagdefs.decode_header(hdus["FLAGS"].header)
        except flagdefs.UnknownFlagSchema as error:
            raise ProductError(f"unknown flag schema: {error}") from error
        image = np.array(hdus["IMAGE"].data)
        variance = np.array(hdus["VARIANCE"].data)
        flag_values = np.array(hdus["FLAGS"].data)
        zodi = np.array(hdus["ZODI"].data)
        if not (image.shape == variance.shape == flag_values.shape == zodi.shape):
            raise ProductError("IMAGE, VARIANCE, FLAGS and ZODI differ in shape")
        header = hdus["IMAGE"].header
        wcs = WCS(header)
        wave_wcs = None
        if WAVE_EXTENSION in names:
            wave_wcs = WCS(header, fobj=hdus, key="W")
            wave_wcs.sip = None  # the spectral lookup is in raw detector pixels
        detector = header.get("DETECTOR")
        version = hdus[0].header.get("VERSION")
        obs_id = header.get("OBSID")
    finite = np.isfinite(image) & np.isfinite(variance) & np.isfinite(zodi) & (variance >= 0)
    reject = flagdefs.reject_mask(flag_values, schema) | ~finite
    return NativeProduct(
        image, variance, flag_values, zodi, schema, reject, wcs, wave_wcs,
        int(detector) if detector is not None else None,
        str(obs_id) if obs_id is not None else None,
        str(version) if version is not None else None,
    )


def display_native(product: NativeProduct) -> Native:
    """Preview copy: ZODI and the median level removed, for blinking and thumbnails only."""
    science = product.image.astype(np.float64) - product.zodi.astype(np.float64)
    finite = np.isfinite(science)
    good = finite & ~product.reject
    level = np.median(science[good]) if np.any(good) else 0.0
    return Native(np.where(finite, science - level, np.nan), product.reject | ~finite, product.wcs, product.wave_wcs)


def load_native(fits_bytes: bytes) -> Native:
    return display_native(load_product(fits_bytes))


def trim_product(fits_bytes: bytes, source_sha256: str) -> bytes:
    """The cutout without its PSF table (megabytes), for caching and fixtures.

    The primary header records the SHA-256 of the original bytes and what was removed.
    """
    with _open(fits_bytes) as hdus:
        kept = [hdu.copy() for hdu in hdus if hdu.name not in PSF_EXTENSIONS]
        dropped = [hdu.name for hdu in hdus if hdu.name in PSF_EXTENSIONS]
        primary = kept[0].header
        primary["TGRSRC"] = source_sha256  # SHA-256 of the original cutout bytes
        primary["TGRDROP"] = (",".join(dropped) or "NONE", "Extensions removed by TENGER")
        output = io.BytesIO()
        fits.HDUList(kept).writeto(output)
    return output.getvalue()


def response_at(product: NativeProduct | Native, ra: float, dec: float, detector: int) -> Response | None:
    """Central wavelength and bandwidth this exposure recorded at a sky position (WCS-WAVE)."""
    if product.wave_wcs is None:
        return None
    x, y = product.wcs.all_world2pix(ra, dec, 0)
    if not (np.isfinite(x) and np.isfinite(y)):
        return None
    wavelength, bandwidth = product.wave_wcs.pixel_to_world(float(x), float(y))
    response = Response(detector, float(wavelength.to("um").value), float(bandwidth.to("um").value))
    return response if response.is_known() else None


def wavelength_at(native: Native | NativeProduct, ra: float, dec: float) -> float | None:
    """Central wavelength (um) that this exposure recorded at a sky position."""
    response = response_at(native, ra, dec, 0)
    return response.centre_um if response else None


def native_aperture_photometry(
    product: NativeProduct,
    ra: float,
    dec: float,
    radius_arcsec: float = APERTURE_RADIUS_ARCSEC,
    annulus_arcsec: tuple[float, float] = ANNULUS_ARCSEC,
) -> dict:
    """Aperture flux (uJy) on the original pixels, with VARIANCE-propagated uncertainty.

    Whole pixels whose centres fall inside the circle are summed after removing the
    ZODI model and the median of the unflagged annulus. Any rejected pixel inside the
    aperture makes the result ``insufficient_data``; it is never silently filled.
    """
    x0, y0 = product.wcs.all_world2pix(ra, dec, 0)
    height, width = product.image.shape
    result = {
        "status": "insufficient_data", "reason_key": None, "flux_ujy": None, "sigma_ujy": None,
        "x_px": float(x0), "y_px": float(y0), "n_aperture": 0, "n_annulus": 0,
        "flagged_in_aperture": {}, "flag_policy": product.flag_schema.policy,
        "resolution": "native", "content_type": "measured",
    }
    if not (np.isfinite(x0) and np.isfinite(y0)) or not (0 <= x0 < width and 0 <= y0 < height):
        result["reason_key"] = "measure.outside-cutout"
        return result
    rows, cols = np.mgrid[:height, :width]
    ra_px, dec_px = product.wcs.all_pix2world(cols, rows, 0)
    separation = _separation_arcsec(ra, dec, ra_px, dec_px)
    aperture = separation <= radius_arcsec
    annulus = (separation >= annulus_arcsec[0]) & (separation <= annulus_arcsec[1]) & ~product.reject
    result["n_aperture"] = int(aperture.sum())
    result["n_annulus"] = int(annulus.sum())
    if not aperture.any():
        result["reason_key"] = "measure.aperture-empty"
        return result
    flagged = aperture & product.reject
    if flagged.any():
        result["flagged_in_aperture"] = flagdefs.count_by_flag(product.flags, product.flag_schema, flagged)
        result["reason_key"] = "measure.flagged-pixels-in-aperture"
        return result
    if annulus.sum() < MIN_ANNULUS_PIXELS:
        result["reason_key"] = "measure.annulus-too-small"
        return result
    corrected = product.image.astype(np.float64) - product.zodi.astype(np.float64)
    variance = product.variance.astype(np.float64)
    background = float(np.median(corrected[annulus]))
    background_variance = MEDIAN_VARIANCE_FACTOR * float(variance[annulus].sum()) / annulus.sum() ** 2
    omega = proj_plane_pixel_area(product.wcs) * (math.pi / 180) ** 2  # sr per pixel
    n_ap = int(aperture.sum())
    flux = (float(corrected[aperture].sum()) - n_ap * background) * omega * MJY_TO_UJY
    flux_variance = (float(variance[aperture].sum()) + n_ap**2 * background_variance) * omega**2
    result.update(
        status="measured", reason_key=None, flux_ujy=flux,
        sigma_ujy=math.sqrt(flux_variance) * MJY_TO_UJY, background_mjy_sr=background,
        pixel_sr=omega,
    )
    return result


def _separation_arcsec(ra: float, dec: float, ra_px: np.ndarray, dec_px: np.ndarray) -> np.ndarray:
    d0, d1 = math.radians(dec), np.radians(dec_px)
    dra = np.radians(ra_px - ra)
    cosine = math.sin(d0) * np.sin(d1) + math.cos(d0) * np.cos(d1) * np.cos(dra)
    return np.degrees(np.arccos(np.clip(cosine, -1, 1))) * 3600


def reproject(native: Native, grid: Grid) -> tuple[np.ndarray, np.ndarray]:
    """Resample onto the shared grid; returns (float32 frame, uint8 bad mask)."""
    rows, cols = np.mgrid[: grid.n, : grid.n]
    ra, dec = grid.wcs.all_pix2world(cols, rows, 0)
    x, y = native.wcs.all_world2pix(ra, dec, 0)
    height, width = native.image.shape
    outside = (x < -0.5) | (y < -0.5) | (x > width - 0.5) | (y > height - 0.5)
    filled = np.nan_to_num(native.image, nan=0.0)
    frame = map_coordinates(filled, [y, x], order=1, mode="nearest").astype(np.float32)
    bad = map_coordinates(native.bad.astype(np.uint8), [y, x], order=0, mode="nearest")
    return np.where(outside, np.nan, frame).astype(np.float32), bad.astype(np.uint8)


def wavelength_gradient(native: Native, grid: Grid) -> tuple[float, float]:
    """Change in wavelength (um) per plate pixel, along plate x and plate y."""
    step = grid.fov / 4
    centre = wavelength_at(native, grid.ra, grid.dec)
    cos_dec = max(math.cos(math.radians(grid.dec)), 1e-6)
    west = wavelength_at(native, grid.ra - step / cos_dec, grid.dec)
    north = wavelength_at(native, grid.ra, grid.dec + step)
    pixels = step / grid.scale
    if centre is None or west is None or north is None:
        return 0.0, 0.0
    return (west - centre) / pixels, (north - centre) / pixels


def wavelength_on_plate(meta: dict, grid: Grid, x: float, y: float) -> float:
    """Wavelength recorded at a plate position; it changes slowly across a small field."""
    centre = (grid.n - 1) / 2
    return meta["wavelength"] + meta["waveDx"] * (x - centre) + meta["waveDy"] * (y - centre)


def aperture_flux(
    pixels: np.ndarray, mask: np.ndarray, grid: Grid, x: float, y: float
) -> tuple[float, float, bool] | None:
    """Rough flux (uJy) on the 160-pixel display plate. Display/legacy only, not a measurement.

    Published measurements use :func:`native_aperture_photometry` on original pixels.
    """
    if not (0 <= x < grid.n and 0 <= y < grid.n):
        return None
    arcsec_per_pixel = grid.scale * 3600
    rows, cols = np.mgrid[: grid.n, : grid.n]
    distance = np.hypot(cols - x, rows - y) * arcsec_per_pixel
    finite = np.isfinite(pixels)
    aperture = (distance <= max(APERTURE_RADIUS_ARCSEC, arcsec_per_pixel * 1.5)) & finite
    annulus = (distance >= ANNULUS_ARCSEC[0]) & (distance <= ANNULUS_ARCSEC[1]) & finite & (mask == 0)
    if annulus.sum() < MIN_ANNULUS_PIXELS or not aperture.any():
        return None
    values = pixels[annulus]
    to_ujy = math.radians(grid.scale) ** 2 * MJY_SR_TO_UJY_PER_SR
    flux = float(np.sum(pixels[aperture] - np.median(values)) * to_ujy)
    # Plate pixels oversample the detector, so count independent native pixels for the noise.
    independent = max(1.0, aperture.sum() * (arcsec_per_pixel / NATIVE_PIXEL_ARCSEC) ** 2)
    native_sr = math.radians(NATIVE_PIXEL_ARCSEC / 3600) ** 2
    error = float(np.std(values) * math.sqrt(independent) * native_sr * MJY_SR_TO_UJY_PER_SR)
    return flux, error, bool(np.any(mask[aperture]))
