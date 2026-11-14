import math

import numpy as np
import pytest
from astropy.io import fits
from astropy.wcs import WCS

from backend import astrometry
from backend.flags import decode_header
from backend.processing import NativeProduct

SCALE_ARCSEC = 6.15


def make_wcs(n=41, ra=150.0, dec=10.0):
    wcs = WCS(naxis=2)
    wcs.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    wcs.wcs.crval = [ra, dec]
    wcs.wcs.crpix = [(n + 1) / 2, (n + 1) / 2]
    wcs.wcs.cdelt = [-SCALE_ARCSEC / 3600, SCALE_ARCSEC / 3600]
    return wcs


def flag_schema():
    header = fits.Header()
    for plane, name in {1: "OVERFLOW", 21: "SOURCE"}.items():
        header[f"MSKN{plane:04d}"] = name
        header[f"MSKM{plane:04d}"] = 1 << plane
    return decode_header(header)


def star_product(x0, y0, flux=2000.0, sigma_px=0.62, noise=0.5, n=41, saturate_above=None, seed=1):
    rng = np.random.default_rng(seed)
    params = [flux, x0, y0, sigma_px, 0.0]
    rows, cols = np.mgrid[:n, :n]
    image = astrometry._pixel_gaussian(params, cols.astype(float), rows.astype(float))
    image = image + rng.normal(0, noise, image.shape)
    variance = np.full(image.shape, noise**2)
    flags = np.zeros(image.shape, np.int32)
    if saturate_above is not None:
        flags[image > saturate_above] |= 2  # OVERFLOW
        image[image > saturate_above] = saturate_above
    schema = flag_schema()
    reject = (flags & schema.reject_bits) != 0
    return NativeProduct(image.astype(np.float32), variance.astype(np.float32), flags, np.zeros_like(image, np.float32),
                         schema, reject, make_wcs(n), None, 6, "SYNTH", "test",
                         {"PSF_FWHM": sigma_px * astrometry.FWHM_PER_SIGMA * SCALE_ARCSEC})


def test_position_is_recovered_within_its_error():
    product = star_product(20.3, 19.6)
    truth_ra, truth_dec = product.wcs.all_pix2world(20.3, 19.6, 0)
    guess_ra, guess_dec = product.wcs.all_pix2world(20.0, 20.0, 0)
    result = astrometry.fit_position(product, float(guess_ra), float(guess_dec), product.info["PSF_FWHM"])
    assert result.status == "measured"
    east, north = astrometry.tangent_offsets_arcsec(float(truth_ra), float(truth_dec), result.ra_deg, result.dec_deg)
    sigma = math.sqrt(result.cov_arcsec2[0][0])
    assert abs(east) < 4 * sigma and abs(north) < 4 * sigma
    assert sigma < 0.5


def test_errors_grow_with_variance():
    quiet = astrometry.fit_position(star_product(20.0, 20.0, noise=0.2), *star_center(), 9.0)
    loud = astrometry.fit_position(star_product(20.0, 20.0, noise=2.0), *star_center(), 9.0)
    assert loud.cov_arcsec2[0][0] > 10 * quiet.cov_arcsec2[0][0]


def star_center():
    ra, dec = make_wcs().all_pix2world(20.0, 20.0, 0)
    return float(ra), float(dec)


def test_saturated_core_is_masked_and_never_used():
    product = star_product(20.2, 20.1, flux=200000.0, saturate_above=5000.0)
    assert product.reject.sum() >= 4
    core = astrometry.fit_position(product, *star_center(), 9.0, radius_arcsec=8.0)
    assert core.status == "insufficient_data"
    wing = astrometry.fit_position(product, *star_center(), 9.0, radius_arcsec=35.0)
    assert wing.status == "measured"
    assert wing.n_rejected_in_radius == int(product.reject.sum())
    truth_ra, truth_dec = product.wcs.all_pix2world(20.2, 20.1, 0)
    east, north = astrometry.tangent_offsets_arcsec(float(truth_ra), float(truth_dec), wing.ra_deg, wing.dec_deg)
    assert math.hypot(east, north) < 1.0


def test_faint_source_is_refused_not_guessed():
    result = astrometry.fit_position(star_product(20.0, 20.0, flux=3.0), *star_center(), 9.0)
    assert result.status == "insufficient_data"
    assert result.reason_key in {"measure.low-snr", "measure.fit-at-bound"}


def test_outside_cutout_is_refused():
    assert astrometry.fit_position(star_product(20, 20), 151.0, 10.0).reason_key == "measure.outside-cutout"


def test_parallax_factors_follow_the_observer():
    # Observer 1 au along +x, star on the equator at RA 90 deg: displacement is purely east.
    east, north = astrometry.parallax_factors(90.0, 0.0, np.array([1.0, 0.0, 0.0]))
    assert east == pytest.approx(1.0) and north == pytest.approx(0.0, abs=1e-12)


def test_motion_fit_recovers_motion_with_fixed_parallax():
    ra0, dec0, plx = 269.45, 4.7, 0.547
    truth = (-0.80, 10.36)
    points = []
    rng = np.random.default_rng(3)
    for mjd in (60900.0, 60905.0, 61080.0, 61085.0, 61270.0, 61275.0):
        observer = astrometry.observer_barycentric_au(mjd, None)
        pe, pn = astrometry.parallax_factors(ra0, dec0, observer)
        tau = (mjd - 61085.0) / 365.25
        east = truth[0] * tau + plx * pe + rng.normal(0, 0.05)
        north = truth[1] * tau + plx * pn + rng.normal(0, 0.05)
        points.append(astrometry.Point(mjd, east, north, np.eye(2) * 0.05**2, observer))
    fit = astrometry.fit_motion(points, ra0, dec0, 61085.0, plx)
    assert fit["status"] == "measured"
    assert fit["params"]["pm_east_arcsec_yr"] == pytest.approx(truth[0], abs=0.2)
    assert fit["params"]["pm_north_arcsec_yr"] == pytest.approx(truth[1], abs=0.2)
    total, sigma = astrometry.total_motion(fit)
    assert abs(total - math.hypot(*truth)) < 4 * sigma
    linear = astrometry.fit_motion(points, ra0, dec0, 61085.0, None)
    assert linear["chi2_red"] > fit["chi2_red"]  # ignoring the parallax is a worse model


def test_motion_fit_refuses_too_few_or_too_close_points():
    point = astrometry.Point(61000.0, 0.0, 0.0, np.eye(2), np.zeros(3))
    assert astrometry.fit_motion([point, point], 0, 0, 61000.0, None)["reason_key"] == "measure.too-few-epochs"
    close = [astrometry.Point(61000.0 + i, 0.0, 0.0, np.eye(2), np.zeros(3)) for i in range(4)]
    assert astrometry.fit_motion(close, 0, 0, 61000.0, None)["reason_key"] == "measure.baseline-too-short"


def test_tangent_round_trip():
    ra, dec = astrometry.tangent_to_sky(269.4, 4.7, 12.5, -7.25)
    east, north = astrometry.tangent_offsets_arcsec(269.4, 4.7, ra, dec)
    assert east == pytest.approx(12.5, abs=1e-6) and north == pytest.approx(-7.25, abs=1e-6)
