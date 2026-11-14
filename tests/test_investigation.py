import json

import numpy as np

from backend import investigation as inv
from backend.processing import Grid
from tests.test_astrometry import star_product


def record(obs_key, centre, width=0.037, fwhm=9.0, finast=0):
    return {"obs_key": obs_key, "response": {"centre_um": centre, "width_um": width, "source": "WCS-WAVE"},
            "psf_fwhm_arcsec": fwhm, "astrometry": {"fine_solution_flag": finast, "solved": True}}


def epoch(eid, visit, detector, keys, mjd):
    return {"id": eid, "visit": visit, "detector": detector, "obs_keys": keys, "t_start_mjd": mjd, "t_end_mjd": mjd}


def test_matched_wavelengths_give_a_quantitative_comparison_but_a_shifted_field_gives_no_difference():
    records = {"a": record("a", 4.929), "b": record("b", 4.9292)}
    epochs = [epoch("v0-d6", 0, 6, ["a"], 61000.0), epoch("v1-d6", 1, 6, ["b"], 61200.0)]
    # Same wavelength at the star, opposite gradients across the plate.
    gradients = {"a": (0.0005, 0.0), "b": (-0.0005, 0.0), "half_size_px": 60}
    [comparison] = inv.build_comparisons(epochs, records, gradients)
    assert comparison["grade"] == "quantitative"
    assert comparison["field"]["grade"] == "qualitative"
    assert "difference" not in comparison["modes"]
    gradients = {"a": (0.0001, 0.0), "b": (0.0001, 0.0), "half_size_px": 60}
    [comparison] = inv.build_comparisons(epochs, records, gradients)
    assert "difference" in comparison["modes"]


def test_shifted_wavelengths_are_never_substituted():
    records = {"a": record("a", 4.929), "b": record("b", 4.960), "c": record("c", None)}
    records["c"]["response"] = None
    epochs = [epoch("v0-d6", 0, 6, ["a"], 61000.0), epoch("v1-d6", 1, 6, ["b"], 61200.0),
              epoch("v2-d6", 2, 6, ["c"], 61300.0)]
    comparisons = {item["id"]: item for item in inv.build_comparisons(epochs, records, {"half_size_px": 60})}
    shifted = comparisons["c-v0-d6-v1-d6"]
    assert shifted["grade"] == "qualitative" and shifted["brightness"]["pairs"] == []
    assert comparisons["c-v0-d6-v2-d6"]["grade"] == "invalid"
    assert all("difference" not in item["modes"] for item in comparisons.values())


def test_arrays_are_never_compared_with_each_other():
    records = {"a": record("a", 4.929), "b": record("b", 3.9, 0.1)}
    epochs = [epoch("v0-d6", 0, 6, ["a"], 61000.0), epoch("v1-d5", 1, 5, ["b"], 61200.0)]
    assert inv.build_comparisons(epochs, records, {"half_size_px": 60}) == []


def test_quality_gate_refuses_failed_dqa_and_targets_outside():
    product = star_product(20, 20)
    exposure = inv.Exposure({"obsKey": "k", "detector": 6, "visit": 0, "mjd": 61000.0}, product)
    ra, dec = product.wcs.all_pix2world(20, 20, 0)
    assert inv.quality_gate(exposure, float(ra), float(dec)) == (True, None)
    assert inv.quality_gate(exposure, float(ra) + 1, float(dec))[1] == "quality.target-outside-cutout"
    failed = inv.Exposure(exposure.meta, star_product(20, 20).__class__(**{**product.__dict__, "info": {"L2DQAFLG": "Fail"}}))
    assert inv.quality_gate(failed, float(ra), float(dec))[1] == "quality.l2-dqa-not-pass"


def test_grid_and_cutout_are_centred_on_the_request():
    from backend.archive import Exposure, cutout_url

    grid = Grid.for_fov(269.4464797, 4.7686694, 0.1)
    centre_ra, centre_dec = grid.wcs.all_pix2world((grid.n - 1) / 2, (grid.n - 1) / 2, 0)
    assert abs(float(centre_ra) - 269.4464797) < 1e-9 and abs(float(centre_dec) - 4.7686694) < 1e-9
    exposure = Exposure("o", 6, 61000.0, 4.4, 5.0, "https://x/f.fits", "spherex_dr1")
    assert cutout_url(exposure, grid.ra, grid.dec, 0.145).endswith("center=269.44648,4.76867&size=0.145")


def test_epochs_map_to_viewer_frames_and_keep_order():
    product = star_product(20, 20)
    usable = [inv.Exposure({"obsKey": f"k{i}", "detector": 6, "visit": i // 2, "mjd": 61000.0 + i}, product)
              for i in range(4)]
    epochs = inv.build_epochs(usable, {"k0": 0, "k1": 1, "k3": 2})
    assert [item["id"] for item in epochs] == ["v0-d6", "v1-d6"]
    assert epochs[0]["viewer"]["frame_indices"] == [0, 1]
    assert epochs[1]["viewer"]["frame_indices"] == [2]
    assert epochs[0]["combine"] == "median_stack"


def test_manifest_parts_are_reproducible():
    records = {"a": record("a", 4.929), "b": record("b", 4.9292)}
    epochs = [epoch("v0-d6", 0, 6, ["a"], 61000.0), epoch("v1-d6", 1, 6, ["b"], 61200.0)]
    first = json.dumps(inv.build_comparisons(epochs, records, {"half_size_px": 60}), sort_keys=True)
    second = json.dumps(inv.build_comparisons(epochs, records, {"half_size_px": 60}), sort_keys=True)
    assert first == second
    assert inv.code_sha256() == inv.code_sha256()
    assert inv.config_sha256({"a": 1, "b": 2}) == inv.config_sha256({"b": 2, "a": 1})


def test_control_summary_flags_stars_that_disagree_with_gaia():
    stars = {"s1": {"pmra": 0.0, "pmdec": 0.0, "phot_g_mean_mag": 12.0},
             "s2": {"pmra": 0.0, "pmdec": 0.0, "phot_g_mean_mag": 13.0}}
    cov = (np.eye(4) * 0.01).tolist()
    fits = {
        "s1": {"status": "measured", "params": {"pm_east_arcsec_yr": 0.05, "pm_north_arcsec_yr": 0.0}, "cov": cov,
               "chi2_red": 1.0, "n_points": 10},
        "s2": {"status": "measured", "params": {"pm_east_arcsec_yr": 2.0, "pm_north_arcsec_yr": 0.0}, "cov": cov,
               "chi2_red": 1.0, "n_points": 10},
    }
    summary = inv.control_summary(fits, stars)
    assert summary["n_stars"] == 2
    assert summary["fraction_within_95pct_region"] == 0.5
    assert summary["passes"] is False


def test_control_stars_are_isolated_and_away_from_the_target():
    target = {"ra": 10.0, "dec": 0.0}
    stars = [
        {"source_id": "near-target", "ra": 10.0 + 30 / 3600, "dec": 0.0, "phot_g_mean_mag": 12.0, "pmra": 0.0, "pmdec": 0.0},
        {"source_id": "ok", "ra": 10.05, "dec": 0.0, "phot_g_mean_mag": 12.0, "pmra": 0.0, "pmdec": 0.0},
        {"source_id": "crowded", "ra": 10.0, "dec": 0.05, "phot_g_mean_mag": 13.0, "pmra": 0.0, "pmdec": 0.0},
        {"source_id": "neighbour", "ra": 10.0, "dec": 0.05 + 10 / 3600, "phot_g_mean_mag": 12.5, "pmra": 0.0, "pmdec": 0.0},
    ]
    chosen = [star["source_id"] for star in inv.isolated_control_stars(stars, target)]
    assert chosen == ["ok"]


def test_contamination_ignores_companions_and_faint_sources_but_flags_a_close_neighbour():
    target = {"source_id": "t", "ra": 10.0, "dec": 0.0, "pmra": 0.0, "pmdec": 0.0, "phot_g_mean_mag": 12.0}
    companion = {"source_id": "c", "ra": 10.0 + 1.2 / 3600, "dec": 0.0, "pmra": 0.0, "pmdec": 0.0, "phot_g_mean_mag": 12.5}
    faint = {"source_id": "f", "ra": 10.0, "dec": 5 / 3600, "pmra": 0.0, "pmdec": 0.0, "phot_g_mean_mag": 18.0}
    assert inv.nearest_contaminant(target, [target, companion, faint], 61000.0) is None
    neighbour = {"source_id": "n", "ra": 10.0, "dec": 6 / 3600, "pmra": 0.0, "pmdec": 0.0, "phot_g_mean_mag": 15.0}
    found = inv.nearest_contaminant(target, [target, companion, faint, neighbour], 61000.0)
    assert found["source_id"] == "n" and abs(found["arcsec"] - 6.0) < 0.01


def test_a_fit_far_from_the_catalogue_track_is_not_the_target():
    from tests.test_astrometry import star_product

    product = star_product(26.0, 20.0)  # source 6 px (~37 arcsec) east of the field centre... but fitted near the guess
    ra_star, dec_star = product.wcs.all_pix2world(26.0, 20.0, 0)
    exposure = inv.Exposure({"obsKey": "k", "detector": 6, "visit": 0, "mjd": 61000.0}, product)
    # The catalogue track sits 4 arcsec from the real source: the fit finds the source, the gate refuses it.
    track_star = {"source_id": "x", "ra": float(ra_star) + 4 / 3600, "dec": float(dec_star), "pmra": 0.0, "pmdec": 0.0}
    [result] = inv.track([exposure], track_star, [])
    assert result["position"].status == "measured"
    assert result["identified"] is False and result["identification_reason_key"] == "measure.not-target"


def test_difference_also_needs_matching_psf_and_a_solved_registration():
    epochs = [epoch("v0-d6", 0, 6, ["a"], 61000.0), epoch("v1-d6", 1, 6, ["b"], 61200.0)]
    gradients = {"a": (0.0001, 0.0), "b": (0.0001, 0.0), "half_size_px": 60}
    blurred = {"a": record("a", 4.929), "b": record("b", 4.9292, fwhm=11.0)}
    [comparison] = inv.build_comparisons(epochs, blurred, gradients)
    assert comparison["checks"]["psf"] == "fail" and "difference" not in comparison["modes"]
    unsolved = {"a": record("a", 4.929), "b": record("b", 4.9292, finast=1)}
    [comparison] = inv.build_comparisons(epochs, unsolved, gradients)
    assert comparison["checks"]["registration"] == "fail" and "difference" not in comparison["modes"]
