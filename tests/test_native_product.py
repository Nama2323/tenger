"""Real DR1 data: an 11 kB copy of an already-exposed Barnard-field cutout.

Source: spherex_dr1 level2_2025W33_2C_0321_1D6_spx_l2b-v27-2026-228.fits, cutout
center=269.44648,4.76867 size=0.02 deg (12 x 12 pixels), downloaded from IRSA on
14 Nov 2026. The EPSF table was removed (see tests/fixtures/README.md).
"""
import gzip
import io
from pathlib import Path

import numpy as np
import pytest
from astropy.io import fits

from backend.flags import SCHEMA_CURRENT
from backend.processing import (
    ProductError,
    display_native,
    load_product,
    native_aperture_photometry,
    response_at,
    trim_product,
)

FIXTURE = Path(__file__).parent / "fixtures" / "spherex_dr1_2025W33_2C_0321_1_D6.fits.gz"
ORIGINAL_SHA256 = "f583dc85bf8685aba1ec699aa974ad1bfcd9b46ef274f6beaa8fa7c4a323e7c9"
CENTRE = (269.44648, 4.76867)


@pytest.fixture(scope="module")
def product():
    return load_product(FIXTURE.read_bytes())


def test_fixture_records_its_original_file(product):
    with fits.open(io.BytesIO(gzip.decompress(FIXTURE.read_bytes()))) as hdus:
        assert hdus[0].header["TGRSRC"] == ORIGINAL_SHA256
        assert hdus[0].header["TGRDROP"] == "EPSF"
        assert [hdu.name for hdu in hdus][1:] == ["IMAGE", "FLAGS", "VARIANCE", "ZODI", "WCS-WAVE"]


def test_dr1_product_keeps_every_science_extension_at_native_precision(product):
    assert product.detector == 6
    assert product.obs_id == "2025W33_2C_0321_1"
    assert product.software_version == "7.0.5"
    for array in (product.image, product.variance, product.flags, product.zodi):
        assert array.shape == (12, 12)
    assert product.image.dtype == np.dtype(">f4") and product.variance.dtype == np.dtype(">f4")
    assert np.all(product.variance[np.isfinite(product.variance)] >= 0)
    assert product.wave_wcs is not None


def test_dr1_flags_are_decoded_from_mskn_mskm(product):
    assert product.flag_schema.schema == SCHEMA_CURRENT
    names = product.flag_schema.by_name()
    assert names["OVERFLOW"].bit == 1 and names["HALO"].bit == 28
    # The old MP_-only decoder rejected 0 of these 144 pixels (audit, 14 Nov 2026).
    assert int(product.reject.sum()) == 17
    assert int(((product.flags >> 1) & 1).sum()) == 2  # two OVERFLOW pixels


def test_display_copy_cannot_unflag_a_measurement_pixel(product):
    native = display_native(product)
    assert np.array_equal(native.bad, product.reject | ~np.isfinite(native.image))


def test_response_at_the_target_comes_from_wcs_wave(product):
    response = response_at(product, *CENTRE, detector=6)
    assert response.detector == 6 and response.source == "WCS-WAVE"
    assert 4.92 < response.centre_um < 4.94
    assert 0.030 < response.width_um < 0.045  # R ~ 130 in array 6


def test_photometry_refuses_an_aperture_with_rejected_pixels(product):
    """Barnard's Star saturates array 6 here: the result is insufficient data, not a number."""
    result = native_aperture_photometry(product, *CENTRE)
    assert result["status"] == "insufficient_data"
    assert result["flux_ujy"] is None
    assert result["reason_key"] == "measure.flagged-pixels-in-aperture"
    assert result["flagged_in_aperture"]["OVERFLOW"] == 2  # both OVERFLOW pixels lie within 12 arcsec
    assert result["resolution"] == "native"


def test_photometry_on_clean_pixels_propagates_variance(product):
    rows, cols = np.nonzero(~product.reject)
    row, col = next((r, c) for r, c in zip(rows, cols) if 2 <= r <= 9 and 2 <= c <= 9)
    ra, dec = product.wcs.all_pix2world(float(col), float(row), 0)
    result = native_aperture_photometry(product, float(ra), float(dec), radius_arcsec=3.0, annulus_arcsec=(12.0, 40.0))
    assert result["status"] == "measured", result
    assert result["n_aperture"] == 1
    assert 0.5 < result["aperture_pixels"] < 1.0  # a 3 arcsec circle covers part of one 6.15 arcsec pixel
    expected_floor = np.sqrt(product.variance[row, col]) * result["aperture_pixels"] * result["pixel_sr"] * 1e12
    assert result["sigma_ujy"] >= expected_floor


def test_fractional_aperture_does_not_jump_with_sub_pixel_position():
    from tests.test_astrometry import star_product

    fluxes = []
    for shift in (0.0, 0.25, 0.5):
        synthetic = star_product(20.0 + shift, 20.0 + shift, flux=500.0, noise=0.01)
        ra, dec = synthetic.wcs.all_pix2world(20.0 + shift, 20.0 + shift, 0)
        fluxes.append(native_aperture_photometry(synthetic, float(ra), float(dec))["flux_ujy"])
    assert max(fluxes) / min(fluxes) < 1.01


def test_trimmed_product_round_trips(product):
    raw = gzip.decompress(FIXTURE.read_bytes())
    again = load_product(trim_product(raw, ORIGINAL_SHA256))
    assert np.array_equal(again.flags, product.flags)
    assert np.array_equal(again.variance, product.variance)


def test_missing_variance_or_flag_schema_is_refused():
    raw = gzip.decompress(FIXTURE.read_bytes())
    with fits.open(io.BytesIO(raw)) as hdus:
        without_variance = fits.HDUList([hdu.copy() for hdu in hdus if hdu.name != "VARIANCE"])
        buffer = io.BytesIO()
        without_variance.writeto(buffer)
    with pytest.raises(ProductError):
        load_product(buffer.getvalue())
    with fits.open(io.BytesIO(raw)) as hdus:
        copy = fits.HDUList([hdu.copy() for hdu in hdus])
        for key in list(copy["FLAGS"].header):
            if key.startswith(("MSKN", "MSKM", "MSKD")):
                del copy["FLAGS"].header[key]
        buffer = io.BytesIO()
        copy.writeto(buffer)
    with pytest.raises(ProductError):
        load_product(buffer.getvalue())


QR2 = Path(__file__).parent / "fixtures" / "spherex_qr2_2025W33_2C_0321_1_D6.fits.gz"


def test_real_qr2_product_uses_the_historical_mp_schema():
    """Same exposure as the DR1 fixture, earlier release: MP_ keys, PSF extension, older software."""
    qr2 = load_product(QR2.read_bytes())
    assert qr2.flag_schema.schema == "MP"
    names = qr2.flag_schema.by_name()
    assert names["OVERFLOW"].bit == 1 and names["SOURCE"].action == "keep"
    assert names["PHANTOM"].reason.startswith("phantom")
    assert not any(d.reason.startswith("flag name not") for d in qr2.flag_schema.definitions)
    assert qr2.software_version == "6.4+psffix1"
    assert int(qr2.reject.sum()) == 14


def test_qr2_and_dr1_products_of_one_exposure_differ_and_are_not_interchangeable(product):
    qr2 = load_product(QR2.read_bytes())
    assert qr2.obs_id == product.obs_id
    # DR1 adds BLOOM/HALO planes and reprocesses the pixels.
    assert "BLOOM" in product.flag_schema.by_name() and "BLOOM" not in qr2.flag_schema.by_name()
    assert not np.array_equal(qr2.image, product.image)
