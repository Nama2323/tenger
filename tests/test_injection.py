"""Injection-recovery (Task A8): ePSF zone mapping, flux scale, recovery, Wilson intervals, blank controls."""
import gzip
import math
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

from backend import injection

FIXTURE = Path(__file__).parent / "fixtures" / "spherex_spherex_dr1_2025W46_1A_0076_2_D6_epsf.fits.gz"


@pytest.fixture(scope="module")
def cutout():
    return injection.load_cutout(gzip.decompress(FIXTURE.read_bytes()))


def clean_spot(cutout, start=(30.0, 30.0)):
    """A position near `start` with no rejected pixel within 3 px and no bright pixel nearby."""
    product = cutout.product
    science = product.image.astype(float) - product.zodi.astype(float)
    level = np.nanmedian(science[~product.reject])
    noise = np.nanmedian(np.sqrt(product.variance[~product.reject]))
    for dy in range(0, 30):
        for dx in range(0, 30):
            x, y = start[0] + dx + 0.3, start[1] + dy - 0.2
            iy, ix = int(round(y)), int(round(x))
            box = np.s_[iy - 3:iy + 4, ix - 3:ix + 4]
            if not product.reject[box].any() and np.nanmax(science[box] - level) < 3 * noise:
                return x, y
    raise AssertionError("no clean spot in the fixture")


def test_epsf_table_is_real_dr1_structure(cutout):
    epsf = cutout.epsf
    assert (epsf.nx, epsf.ny, epsf.oversampling) == (21, 21, 5)
    assert epsf.cube.shape == (441, 33, 33)
    assert injection.ordering_consistent(epsf)  # row = BINY * 21 + BINX ("x-fast then y")
    assert np.all(np.diff(epsf.xcenter[:21]) > 0) and np.all(np.diff(epsf.ycenter[::21]) > 0)


def test_zone_mapping_picks_the_zone_containing_the_source(cutout):
    epsf = cutout.epsf
    height, width = cutout.product.image.shape
    x_parent, y_parent = injection.parent_pixel(cutout.header, (width - 1) / 2, (height - 1) / 2)
    row = injection.zone_row(epsf, x_parent, y_parent)
    bx, by = int(epsf.binx[row]), int(epsf.biny[row])
    assert row == by * epsf.nx + bx
    assert abs(epsf.xcenter[row] - x_parent) <= 0.6 * (epsf.xcenter[1] - epsf.xcenter[0])
    assert abs(epsf.ycenter[row] - y_parent) <= 0.6 * (epsf.ycenter[epsf.nx] - epsf.ycenter[0])
    assert epsf.cube[row].sum() == pytest.approx(1.0, abs=1e-6)  # kept in the fixture
    swapped = injection.transposed_row(epsf, row)
    assert swapped is not None and swapped != row  # x != y here, so a transposed reading would pick another zone


def test_a_mislabelled_table_is_detected(cutout):
    epsf = cutout.epsf
    transposed = replace(epsf, binx=epsf.biny.copy(), biny=epsf.binx.copy())
    assert not injection.ordering_consistent(transposed)


def test_render_is_unit_flux_and_centred(cutout):
    row = injection.zone_row(cutout.epsf, *injection.parent_pixel(cutout.header, 40.0, 40.0))
    stamp, xs, ys = injection.render(cutout.epsf, row, 40.3, 39.8)
    assert stamp.sum() == pytest.approx(1.0)
    grid_y, grid_x = np.meshgrid(ys, xs, indexing="ij")
    assert np.sum(stamp * grid_x) == pytest.approx(40.3, abs=0.15)
    assert np.sum(stamp * grid_y) == pytest.approx(39.8, abs=0.15)


def test_injection_happens_in_memory_only(cutout):
    before = cutout.product.image.copy()
    raw = FIXTURE.read_bytes()
    injected = injection.inject(cutout, [(30.0, 30.0, 14.0)])
    assert np.array_equal(cutout.product.image, before, equal_nan=True)
    assert FIXTURE.read_bytes() == raw
    assert not np.array_equal(injected.image, before, equal_nan=True)
    assert injected.variance is cutout.product.variance and injected.flags is cutout.product.flags


def test_inject_then_measure_returns_the_input_magnitude(cutout):
    x, y = clean_spot(cutout)
    for snr_target in (20.0, 40.0, 80.0):
        mag = 16.0 + 2.5 * math.log10(injection.matched_snr(cutout, x, y, 16.0) / snr_target)
        injected = injection.inject(cutout, [(x, y, mag)])
        flux, error = injection.psf_photometry(cutout, injected, x, y)  # real noise and background included
        measured = injection.jy_to_ab(flux)
        sigma = 1.0857 * error / flux
        assert abs(measured - mag) <= 3 * sigma + 0.05
        recovered = injection.recover(injected, x, y)
        assert recovered.found and recovered.offset_px < 1.0


def test_faint_injection_is_not_recovered(cutout):
    x, y = clean_spot(cutout)
    mag = 16.0 + 2.5 * math.log10(injection.matched_snr(cutout, x, y, 16.0) / 0.5)
    assert not injection.recover(injection.inject(cutout, [(x, y, mag)]), x, y).found


def test_blank_controls_on_pure_noise(cutout):
    """The site's fit on Gaussian noise with the fixture's own variance: false detections stay rare."""
    product = cutout.product
    rng = np.random.default_rng(7)
    sigma = np.sqrt(np.where(np.isfinite(product.variance), product.variance, np.nanmedian(product.variance)))
    noise = (product.zodi.astype(float) + rng.normal(0, 1, product.image.shape) * sigma).astype(np.float32)
    blank = replace(product, image=noise, reject=np.zeros_like(product.reject))
    height, width = noise.shape
    positions = [(rng.uniform(8, width - 9), rng.uniform(8, height - 9)) for _ in range(60)]
    false = sum(injection.recover(blank, x, y).found for x, y in positions)
    low, high = injection.wilson(false, len(positions))
    assert false <= 3 and low < 0.05


def test_wilson_interval_known_values():
    assert injection.wilson(0, 10) == pytest.approx((0.0, 0.27753), abs=1e-4)
    assert injection.wilson(5, 10) == pytest.approx((0.23659, 0.76341), abs=1e-4)
    assert injection.wilson(10, 10) == pytest.approx((0.72247, 1.0), abs=1e-4)
    assert injection.wilson(0, 0) == (0.0, 1.0)


def test_completeness_depth_and_interval():
    mags = [18.0, 18.25, 18.5, 18.75, 19.0]
    counts = [(40, 40), (36, 40), (20, 40), (4, 40), (0, 40)]
    curve = [{"mag_ab": m, "injected": n, "recovered": k, "fraction": k / n,
              "interval": list(injection.wilson(k, n))} for m, (k, n) in zip(mags, counts)]
    depth = injection.completeness(curve, 0.5)
    assert depth["value"] == pytest.approx(18.5)
    assert depth["interval"][0] < 18.5 < depth["interval"][1]
    assert injection.completeness(curve, 0.9)["value"] == pytest.approx(18.25)
    assert injection.isotonic_decreasing([1.0, 0.8, 0.9, 0.1], [1, 1, 1, 1]) == pytest.approx([1.0, 0.85, 0.85, 0.1])
