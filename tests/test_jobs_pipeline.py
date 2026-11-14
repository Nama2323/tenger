"""The live/bake pipeline on a real DR1 cutout, offline (no archive call)."""
from pathlib import Path

import numpy as np
import pytest

from backend import config, framestore
from backend.archive import parse_sia_csv
from backend.jobs import Job
from backend.processing import ProductError, load_product

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture()
def exposure():
    rows = parse_sia_csv((FIXTURES / "sia_dr1_2025W33_2C_0321_1.csv").read_text())
    return next(row for row in rows if row.detector == 6)


def test_frame_meta_carries_release_response_flags_and_source(tmp_path, monkeypatch, exposure):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    payload = (FIXTURES / "spherex_dr1_2025W33_2C_0321_1_D6.fits.gz").read_bytes()
    job = Job(269.44648, 4.76867, 0.02)
    frame = job._process(payload, exposure, visit=0, url="https://example/cutout")
    meta = frame.meta
    assert meta["obsKey"] == "spherex_dr1:2025W33_2C_0321_1:D6"
    assert meta["release"] == "spherex_dr1" and meta["processing"] == "l2b-v27-2026-228"
    assert meta["responseStatus"] == "known"
    assert meta["response"]["source"] == "WCS-WAVE"
    assert meta["wavelength"] == pytest.approx(meta["response"]["centre_um"])
    assert meta["flagSchema"] == "MSKN/MSKM" and meta["maskPolicy"] == "tenger-mask-v1"
    assert meta["flagCounts"]["OVERFLOW"] == 2
    assert meta["cache"]["tag"] == framestore.cache_tag(job.grid)
    assert len(meta["source"]["sha256"]) == 64
    native = load_product((tmp_path / meta["source"]["native"]).read_bytes())
    assert np.array_equal(native.flags, load_product(payload).flags)
    assert frame.mask.any()  # rejected pixels reach the display mask too


def test_unknown_flag_schema_refuses_the_exposure(monkeypatch, exposure):
    import gzip, io
    from astropy.io import fits

    raw = gzip.decompress((FIXTURES / "spherex_dr1_2025W33_2C_0321_1_D6.fits.gz").read_bytes())
    with fits.open(io.BytesIO(raw)) as hdus:
        copy = fits.HDUList([hdu.copy() for hdu in hdus])
    for key in [k for k in copy["FLAGS"].header if k.startswith(("MSKN", "MSKM", "MSKD"))]:
        del copy["FLAGS"].header[key]
    buffer = io.BytesIO()
    copy.writeto(buffer)
    job = Job(269.44648, 4.76867, 0.02)
    with pytest.raises(ProductError):
        job._process(buffer.getvalue(), exposure, visit=0)
