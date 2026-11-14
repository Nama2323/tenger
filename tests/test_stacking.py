import math

import numpy as np

from backend import astrometry, stacking
from backend.processing import NativeProduct
from tests.test_astrometry import SCALE_ARCSEC, flag_schema, make_wcs


def exposure_with_body(index, offset=(1.2, -0.8), flux=8.0, noise=1.0, n=31):
    """A cutout centred on the 'ephemeris'; the body sits at ephemeris + offset (arcsec)."""
    rng = np.random.default_rng(100 + index)
    ra0, dec0 = 150.0 + index * 0.01, 10.0  # the body moves between exposures
    wcs = make_wcs(n, ra0, dec0)
    x = (n - 1) / 2 - offset[0] / SCALE_ARCSEC  # east is towards smaller x (cdelt1 < 0)
    y = (n - 1) / 2 + offset[1] / SCALE_ARCSEC
    rows, cols = np.mgrid[:n, :n]
    image = astrometry._pixel_gaussian([flux, x, y, 0.62, 0.0], cols.astype(float), rows.astype(float))
    image = image + rng.normal(0, noise, image.shape)
    product = NativeProduct(image.astype(np.float32), np.full(image.shape, noise**2, np.float32),
                            np.zeros(image.shape, np.int32), np.zeros(image.shape, np.float32), flag_schema(),
                            np.zeros(image.shape, bool), wcs, None, 2, f"S{index}", "test", {"PSF_FWHM": 9.0})
    return product, (ra0, dec0)


def test_joint_fit_recovers_a_body_too_faint_for_single_exposures():
    pairs = [exposure_with_body(i) for i in range(16)]
    products = [p for p, _ in pairs]
    positions = [pos for _, pos in pairs]
    single = astrometry.fit_position(products[0], *positions[0], 9.0)
    assert single.status == "insufficient_data"
    result = stacking.joint_fit(products, positions)
    assert result["status"] == "measured" and result["snr"] >= stacking.DETECTION_SNR
    sigma = math.sqrt(result["cov_arcsec2"][0][0])
    assert abs(result["offset_east_arcsec"] - 1.2) < 4 * sigma
    assert abs(result["offset_north_arcsec"] + 0.8) < 4 * sigma


def test_null_test_with_shuffled_times_finds_nothing_for_a_moving_body():
    pairs = [exposure_with_body(i, n=61) for i in range(16)]
    products = [p for p, _ in pairs]
    # Each cutout is wide enough to contain the shuffled positions, so the null fit runs.
    null = stacking.null_test(products, [pos for _, pos in pairs])
    assert null["status"] in {"insufficient_data", "inconclusive"} or null["passes"] is True


def test_no_body_means_no_detection():
    pairs = [exposure_with_body(i, flux=0.0) for i in range(12)]
    result = stacking.joint_fit([p for p, _ in pairs], [pos for _, pos in pairs])
    assert result["status"] == "insufficient_data"
