from pathlib import Path

from backend.archive import (
    Exposure,
    cutout_url,
    exposure_key,
    parse_collections,
    parse_processing,
    parse_release,
    parse_sia_csv,
    select_products,
)

FIXTURES = Path(__file__).parent / "fixtures"
HEADER = "energy_bandpassname,obs_id,em_min,em_max,access_url,t_min,t_exptime,obs_collection,cloud_access,o_ucd\n"
ROW = (
    "SPHEREx-D6,2026W33_2A_0594_4,4.4e-06,5.0e-06,https://x/a.fits,61268.63,113.5,"
    'spherex_qr3,{"aws": {"bucket_name": "b","key":"k"}},\n'
)


def make_exposure(obs_id="o1", detector=1, collection="spherex_qr2", mjd=61000.0, processing=None):
    return Exposure(obs_id, detector, mjd, 0.75, 1.1, "https://x/a.fits", collection, processing=processing)


def test_parses_sia_row_into_exposure_in_micrometres():
    [exposure] = parse_sia_csv(HEADER + ROW)
    assert exposure.detector == 6
    assert exposure.obs_id == "2026W33_2A_0594_4"
    assert round(exposure.wave_min_um, 2) == 4.4
    assert exposure.collection == "spherex_qr3"


def test_skips_rows_without_a_detector_band():
    assert parse_sia_csv(HEADER + ROW.replace("SPHEREx-D6", "other")) == []


def test_skips_rows_from_collections_that_are_not_level2_images():
    assert parse_sia_csv(HEADER + ROW.replace("spherex_qr3", "spherex_dr1_cube")) == []


def test_real_dr1_rows_parse_with_release_aware_identity():
    """Two real SIA rows (metadata only) for the already-exposed DR1 exposure 2025W33_2C_0321_1."""
    rows = parse_sia_csv((FIXTURES / "sia_dr1_2025W33_2C_0321_1.csv").read_text())
    assert {row.detector for row in rows} == {3, 6}
    d6 = next(row for row in rows if row.detector == 6)
    assert d6.collection == "spherex_dr1"
    assert d6.release.kind == "dr" and d6.release.number == 1 and d6.release.field == "wide"
    assert d6.processing == "l2b-v27-2026-228"
    assert d6.obs_key == "spherex_dr1:2025W33_2C_0321_1:D6"
    assert d6.release_date == "2026-10-04 05:45:39"
    assert d6.mjd == 60902.864715 and d6.mjd_end == 60902.866047
    assert 4.41 < d6.wave_min_um < d6.wave_max_um < 5.01


def test_finds_data_and_quick_releases_but_not_cubes_in_self_description():
    xml = (
        '<OPTION value="akari"/><OPTION value="spherex_qr2"/><OPTION value="spherex_qr10_deep"/>'
        '<OPTION value="spherex_other"/><OPTION value="spherex_dr1"/><OPTION value="spherex_dr1_cube"/>'
        '<OPTION value="spherex_dr1_deep"/>'
    )
    assert parse_collections(xml) == ("spherex_qr2", "spherex_qr10_deep", "spherex_dr1", "spherex_dr1_deep")


def test_release_names_are_parsed():
    assert parse_release("spherex_dr1_deep").field == "deep"
    assert parse_release("spherex_qr3").kind == "qr"
    assert parse_release("spherex_dr1_cube") is None
    assert parse_processing("https://x/level2_2025W33_2C_0321_1D6_spx_l2b-v27-2026-228.fits") == "l2b-v27-2026-228"
    assert parse_processing("https://x/a.fits") is None


def test_newer_quick_release_replaces_same_exposure():
    old = make_exposure(collection="spherex_qr2")
    new = make_exposure(collection="spherex_qr10")
    assert select_products([old, new]) == [new]
    assert select_products([new, old]) == [new]


def test_data_release_beats_quick_release_of_the_same_exposure():
    quick = make_exposure(collection="spherex_qr3")
    data = make_exposure(collection="spherex_dr1")
    assert select_products([quick, data]) == [data]
    assert select_products([data, quick]) == [data]
    assert select_products([quick, data], priority=("qr", "dr")) == [quick]


def test_newer_processing_version_wins_within_one_release():
    old = make_exposure(collection="spherex_dr1", processing="l2b-v26-2026-100")
    new = make_exposure(collection="spherex_dr1", processing="l2b-v27-2026-228")
    assert select_products([new, old]) == [new]


def test_different_detectors_are_different_exposures():
    assert len(select_products([make_exposure(detector=1), make_exposure(detector=2)])) == 2


def test_cache_key_includes_release_and_product_version():
    dr1 = exposure_key(make_exposure(collection="spherex_dr1", processing="l2b-v27-2026-228"))
    qr3 = exposure_key(make_exposure(collection="spherex_qr3", processing="l2b-v27-2026-228"))
    assert dr1 != qr3
    assert "spherex_dr1" in dr1 and "l2b-v27-2026-228" in dr1
    assert "/" not in dr1 and ":" not in dr1


def test_cutout_url_uses_documented_center_and_size():
    url = cutout_url(make_exposure(), 133.5, -7.25, 0.1)
    assert url == "https://x/a.fits?center=133.5,-7.25&size=0.1"
