"""Builds one investigation manifest (docs/DATA-CONTRACT.md V1 §5, V3) from processed exposures.

Everything here is a pure function of its inputs (frames, native products, catalogue
rows), so the same cache gives the same bytes. Network and file I/O live in
scripts/build_investigation.py.
"""
import hashlib
import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import astrometry, config, spectral
from .coords import propagate
from .flags import MASK_POLICY
from .processing import NativeProduct, native_aperture_photometry, response_at

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = "tenger.investigation/1"
CONTRACT_EXTENSIONS = 3  # fields added by DATA-CONTRACT version 3
WING_RADIUS_ARCSEC = 35.0
CORE_RADIUS_ARCSEC = 15.0
CORE_REJECTED_SHARE = 0.25
CONTROL_MIN_G, CONTROL_MAX_G = 10.0, 15.5
CONTROL_ISOLATION_ARCSEC = 25.0
CONTROL_TARGET_CLEARANCE_ARCSEC = 60.0
CONTROL_MAX_STARS = 30
CONTROL_MIN_EPOCH_POINTS = 4
CONTROL_PASS_Z = 3.0
# A fitted position counts as the catalogue source only within this distance of its
# catalogue track (catalogue-assisted identification, documented as such).
IDENTIFICATION_GATE_ARCSEC = 3.0
# Another catalogued source this close (but not a blended companion) contaminates the fit.
CONTAMINATION_RADIUS_ARCSEC = 12.0
COMPANION_RADIUS_ARCSEC = 2.0
CONTAMINANT_DELTA_MAG = 5.0
CODE_FILES = (
    "backend/processing.py", "backend/flags.py", "backend/spectral.py", "backend/astrometry.py",
    "backend/investigation.py", "scripts/build_investigation.py",
)


@dataclass(frozen=True)
class Exposure:
    """One processed exposure: its frame metadata (as stored by jobs) and its native product."""

    meta: dict
    product: NativeProduct


def code_sha256() -> str:
    digest = hashlib.sha256()
    for name in CODE_FILES:
        path = ROOT / name
        if path.exists():
            digest.update(name.encode() + b"\0" + path.read_bytes())
    return digest.hexdigest()


def config_sha256(settings: dict) -> str:
    return hashlib.sha256(json.dumps(settings, sort_keys=True).encode()).hexdigest()


def mjd_to_utc(mjd: float) -> str:
    from astropy.time import Time

    return Time(mjd, format="mjd", scale="utc").isot[:19] + "Z"


def _round(value, digits=6):
    if value is None:
        return None
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return round(float(value), digits)


# ---------------------------------------------------------------- per exposure


def quality_gate(exposure: Exposure, ra: float, dec: float) -> tuple[bool, str | None]:
    """Whether an exposure may enter measurements, with the first failing reason."""
    info = exposure.product.info
    if info.get("L2DQAFLG") not in (None, "Pass"):
        return False, "quality.l2-dqa-not-pass"
    x, y = exposure.product.wcs.all_world2pix(ra, dec, 0)
    height, width = exposure.product.image.shape
    if not (np.isfinite(x) and np.isfinite(y) and 0 <= x < width and 0 <= y < height):
        return False, "quality.target-outside-cutout"
    return True, None


def observation_record(exposure: Exposure, ra: float, dec: float, gate: tuple[bool, str | None]) -> dict:
    meta, product = exposure.meta, exposure.product
    response = response_at(product, ra, dec, meta["detector"])
    source = meta.get("source") or {}
    collection, obs_id, detector = meta["release"], meta["obsId"], meta["detector"]
    covered = np.isfinite(product.image)
    return {
        "obs_key": meta.get("obsKey") or f"{collection}:{obs_id}:D{detector}",
        "obs_id": obs_id,
        "detector": detector,
        "collection": collection,
        "processing": meta.get("processing"),
        "t_start_mjd": _round(product.info.get("MJD-BEG", meta["mjd"]), 6),
        "t_end_mjd": _round(product.info.get("MJD-END", meta.get("mjdEnd")), 6),
        "time_scale": product.info.get("TIMESYS", "UTC"),
        "t_start_utc": mjd_to_utc(product.info.get("MJD-BEG", meta["mjd"])),
        "exposure_s": _round(product.info.get("XPOSURE"), 3),
        "response": {"centre_um": _round(response.centre_um), "width_um": _round(response.width_um),
                     "source": response.source} if response else None,
        "file": source.get("url", "").split("?")[0].rsplit("/", 1)[-1] or None,
        "url": source.get("url"),
        "source_sha256": source.get("sha256"),
        "source_bytes": source.get("bytes"),
        "software": product.software_version,
        "flag_schema": product.flag_schema.schema,
        "mask_policy": product.flag_schema.policy,
        "flagged_fraction": _round(float(product.reject[covered].mean()) if covered.any() else None, 4),
        "quality": {"usable": gate[0], "reason_key": gate[1], "l2_dqa": product.info.get("L2DQAFLG")},
        "psf_fwhm_arcsec": _round(product.info.get("PSF_FWHM"), 3),
        "astrometry": {"fine_solution_flag": product.info.get("FINAST"),
                       "solved": product.info.get("ASTRONETSOLVED"), "matched_stars": product.info.get("MATCH_NSTARS")},
    }


def measure_position(product: NativeProduct, ra: float, dec: float) -> tuple[astrometry.Position, bool]:
    """Fit near (ra, dec); when the core is mostly rejected (saturation), fit the wings instead."""
    fwhm = product.info.get("PSF_FWHM")
    core = astrometry.fit_position(product, ra, dec, fwhm, CORE_RADIUS_ARCSEC)
    area = core.n_pixels + core.n_rejected_in_radius
    if area and core.n_rejected_in_radius / area > CORE_REJECTED_SHARE:
        return astrometry.fit_position(product, ra, dec, fwhm, WING_RADIUS_ARCSEC), True
    return core, False


def spacecraft_km(product: NativeProduct) -> tuple[float, float, float] | None:
    info = product.info
    if all(key in info for key in ("X_SC", "Y_SC", "Z_SC")) and info.get("XYZ_SC_SYSTEM", "GEOCENTER") == "GEOCENTER":
        return float(info["X_SC"]), float(info["Y_SC"]), float(info["Z_SC"])
    return None


def exposure_mid_mjd(exposure: Exposure) -> float:
    return float(exposure.product.info.get("MJD-AVG", exposure.meta["mjd"]))


# ---------------------------------------------------------------- epochs and comparisons


def epoch_id(visit: int, detector: int) -> str:
    return f"v{visit}-d{detector}"


def build_epochs(usable: list[Exposure], viewer_index: dict[str, int]) -> list[dict]:
    groups: dict[tuple[int, int], list[Exposure]] = {}
    for exposure in usable:
        groups.setdefault((exposure.meta["visit"], exposure.meta["detector"]), []).append(exposure)
    epochs = []
    for (visit, detector), members in sorted(groups.items()):
        members.sort(key=lambda item: item.meta["mjd"])
        keys = [item.meta["obsKey"] for item in members]
        epochs.append({
            "id": epoch_id(visit, detector),
            "visit": visit,
            "detector": detector,
            "obs_keys": keys,
            "t_start_mjd": _round(min(item.product.info.get("MJD-BEG", item.meta["mjd"]) for item in members)),
            "t_end_mjd": _round(max(item.product.info.get("MJD-END", item.meta["mjd"]) for item in members)),
            "combine": "single" if len(members) == 1 else "median_stack",
            "assets": {"preview": None},
            "viewer": {"visit": visit, "frame_indices": sorted(viewer_index[key] for key in keys if key in viewer_index)},
        })
    return epochs


def _response(record: dict, detector: int) -> spectral.Response | None:
    response = record.get("response")
    if not response:
        return None
    return spectral.Response(detector, response["centre_um"], response["width_um"], response["source"])


def build_comparisons(epochs: list[dict], records: dict[str, dict], gradients: dict[str, tuple]) -> list[dict]:
    """Grade every pair of epochs in the same array (source and whole field separately)."""
    comparisons = []
    by_detector: dict[int, list[dict]] = {}
    for epoch in epochs:
        by_detector.setdefault(epoch["detector"], []).append(epoch)
    for detector, members in sorted(by_detector.items()):
        members.sort(key=lambda item: item["t_start_mjd"])
        for index, first in enumerate(members):
            for second in members[index + 1:]:
                pairs_a = [(key, _response(records[key], detector)) for key in first["obs_keys"]]
                pairs_b = [(key, _response(records[key], detector)) for key in second["obs_keys"]]
                source = spectral.match_epochs(pairs_a, pairs_b, "flux")
                position = spectral.match_epochs(pairs_a, pairs_b, "position")
                field = _field_grade(source, records, gradients, detector)
                psf = _psf_check(first["obs_keys"], second["obs_keys"], records)
                registration = _registration_check([*first["obs_keys"], *second["obs_keys"]], records)
                difference = (source["grade"] == spectral.QUANTITATIVE and field["grade"] == spectral.QUANTITATIVE
                              and psf == "pass" and registration == "pass")
                modes = ["blink", "side_by_side", "swipe"] + (["difference"] if difference else [])
                reasons = {source["reason_key"], field["reason_key"]}
                if psf != "pass":
                    reasons.add("compare.psf-differs" if psf == "fail" else "compare.psf-unknown")
                if registration != "pass":
                    reasons.add("compare.registration-unverified")
                reasons = sorted(reasons)
                comparisons.append({
                    "id": f"c-{first['id']}-{second['id']}",
                    "a": first["id"],
                    "b": second["id"],
                    "grade": source["grade"],
                    "modes": modes,
                    "checks": {
                        "response": _check(source["grade"]),
                        "field_response": _check(field["grade"]),
                        "registration": registration,
                        "psf": psf,
                        "background": "not_checked",
                    },
                    "reason_keys": reasons,
                    "brightness": {"grade": source["grade"], "reason_key": source["reason_key"],
                                   "pairs": source["pairs"]},
                    "position": {"grade": position["grade"], "reason_key": position["reason_key"]},
                    "field": field,
                })
    return comparisons


PSF_MATCH_FRACTION = 0.10


def _psf_check(keys_a: list[str], keys_b: list[str], records: dict) -> str:
    """Median header PSF FWHM of the two epochs within 10% of each other."""
    a = [records[key].get("psf_fwhm_arcsec") for key in keys_a if records[key].get("psf_fwhm_arcsec")]
    b = [records[key].get("psf_fwhm_arcsec") for key in keys_b if records[key].get("psf_fwhm_arcsec")]
    if not a or not b:
        return "not_checked"
    fwhm_a, fwhm_b = float(np.median(a)), float(np.median(b))
    return "pass" if abs(fwhm_a - fwhm_b) / max(fwhm_a, fwhm_b) <= PSF_MATCH_FRACTION else "fail"


def _registration_check(keys: list[str], records: dict) -> str:
    """Every exposure has a solved fine astrometric WCS (FINAST = 0, ASTRONETSOLVED true)."""
    flags = [records[key].get("astrometry") or {} for key in keys]
    if not flags or any(item.get("fine_solution_flag") is None or item.get("solved") is None for item in flags):
        return "not_checked"
    good = all(item.get("fine_solution_flag") == 0 and item.get("solved") in (True, "True", "T") for item in flags)
    return "pass" if good else "fail"


def _check(grade: str) -> str:
    return {spectral.QUANTITATIVE: "pass", spectral.QUALITATIVE: "partial", spectral.INVALID: "fail"}[grade]


def _field_grade(source: dict, records: dict, gradients: dict, detector: int) -> dict:
    if not source["pairs"]:
        return {"grade": spectral.INVALID if source["grade"] == spectral.INVALID else spectral.QUALITATIVE,
                "reason_key": "compare.field-no-matched-pair"}
    best = None
    for pair in source["pairs"]:
        a, b = records[pair["a"]], records[pair["b"]]
        grade = spectral.grade_field(
            _response(a, detector), _response(b, detector), gradients.get(pair["a"]), gradients.get(pair["b"]),
            gradients.get("half_size_px", 60.0),
        )
        if best is None or (grade.grade == spectral.QUANTITATIVE and best.grade != spectral.QUANTITATIVE):
            best = grade
    return best.to_json()


# ---------------------------------------------------------------- astrometry and photometry


def isolated_control_stars(stars: list[dict], target: dict | None, min_g: float = CONTROL_MIN_G,
                           max_g: float = CONTROL_MAX_G, limit: int = CONTROL_MAX_STARS) -> list[dict]:
    """Gaia stars for the control: moderate brightness, isolated, away from the target."""
    chosen = []
    for star in sorted(stars, key=lambda item: item["phot_g_mean_mag"] or 99):
        g = star.get("phot_g_mean_mag")
        if g is None or not (min_g <= g <= max_g) or star.get("pmra") is None:
            continue
        if target and _sep_arcsec(star, target) < CONTROL_TARGET_CLEARANCE_ARCSEC:
            continue
        crowded = any(
            other is not star and (other.get("phot_g_mean_mag") or 99) < g + 2.5
            and _sep_arcsec(star, other) < CONTROL_ISOLATION_ARCSEC
            for other in stars
        )
        if not crowded:
            chosen.append(star)
        if len(chosen) >= limit:
            break
    return chosen


def _sep_arcsec(a: dict, b: dict) -> float:
    east, north = astrometry.tangent_offsets_arcsec(a["ra"], a["dec"], b["ra"], b["dec"])
    return math.hypot(east, north)


def catalogue_position(star: dict, mjd: float) -> tuple[float, float]:
    """Gaia DR3 position at mjd: linear proper motion only (parallax handled by the motion model)."""
    return propagate(star["ra"], star["dec"], star.get("pmra") or 0.0, star.get("pmdec") or 0.0, 2016.0, mjd)


def nearest_contaminant(star: dict, field: list[dict] | None, mjd: float) -> dict | None:
    """The closest other catalogued source that could spoil a fit or an aperture at this time."""
    if not field:
        return None
    ra, dec = catalogue_position(star, mjd)
    here = {"ra": ra, "dec": dec}
    limit = (star.get("phot_g_mean_mag") or 99.0) + CONTAMINANT_DELTA_MAG
    best = None
    for other in field:
        if other.get("source_id") and other.get("source_id") == star.get("source_id"):
            continue
        if (other.get("phot_g_mean_mag") or 99.0) > limit:
            continue
        other_ra, other_dec = catalogue_position(other, mjd)
        separation = _sep_arcsec({"ra": other_ra, "dec": other_dec}, here)
        if COMPANION_RADIUS_ARCSEC < separation <= CONTAMINATION_RADIUS_ARCSEC and (best is None or separation < best["arcsec"]):
            best = {"arcsec": round(separation, 2), "g_mag": other.get("phot_g_mean_mag"), "source_id": other.get("source_id")}
    return best


def track(exposures: list[Exposure], star: dict, field: list[dict] | None = None) -> list[dict]:
    """Measure one catalogue star in every exposure; returns per-exposure results.

    A fit counts as this source ("identified") only within IDENTIFICATION_GATE_ARCSEC of
    its catalogue track and with no other catalogued source within CONTAMINATION_RADIUS_ARCSEC.
    """
    results = []
    for exposure in exposures:
        mjd = exposure_mid_mjd(exposure)
        guess = catalogue_position(star, mjd)
        position, wing = measure_position(exposure.product, *guess)
        contaminant = nearest_contaminant(star, field, mjd)
        offset = None
        if position.status == "measured":
            east, north = astrometry.tangent_offsets_arcsec(guess[0], guess[1], position.ra_deg, position.dec_deg)
            offset = math.hypot(east, north)
        identified = position.status == "measured" and offset <= IDENTIFICATION_GATE_ARCSEC and contaminant is None
        reason = None
        if position.status == "measured" and not identified:
            reason = "measure.contaminated" if contaminant else "measure.not-target"
        results.append({"obs_key": exposure.meta["obsKey"], "mjd": mjd, "detector": exposure.meta["detector"],
                        "visit": exposure.meta["visit"], "position": position, "wing_fit": wing,
                        "identified": identified, "identification_reason_key": reason,
                        "offset_from_catalogue_arcsec": round(offset, 3) if offset is not None else None,
                        "contaminant": contaminant,
                        "observer_au": astrometry.observer_barycentric_au(mjd, spacecraft_km(exposure.product))})
    return results


def motion_points(results: list[dict], ra0: float, dec0: float) -> list[astrometry.Point]:
    points = []
    for item in results:
        position = item["position"]
        if position.status != "measured" or not item.get("identified", True):
            continue
        east, north = astrometry.tangent_offsets_arcsec(ra0, dec0, position.ra_deg, position.dec_deg)
        points.append(astrometry.Point(item["mjd"], east, north, np.array(position.cov_arcsec2), item["observer_au"]))
    return points


def fit_star(results: list[dict], star: dict, mjd_ref: float, floor: float, parallax: bool,
             free_parallax: bool = False) -> dict:
    ra0, dec0 = catalogue_position(star, mjd_ref)
    points = motion_points(results, ra0, dec0)
    plx = (star.get("parallax") or 0.0) / 1000 if parallax else None
    fit = astrometry.fit_motion(points, ra0, dec0, mjd_ref, plx, floor, fit_parallax=free_parallax)
    fit["reference"] = {"ra_deg": ra0, "dec_deg": dec0, "mjd": mjd_ref}
    return fit


def residual_floor(control_results: dict[str, list[dict]], stars: dict[str, dict]) -> dict:
    """Per-exposure scatter of control-star positions about Gaia (with parallax) beyond the fit errors."""
    raw, variances = [], []
    for source_id, results in control_results.items():
        star = stars[source_id]
        for item in results:
            position = item["position"]
            if position.status != "measured" or not item.get("identified", True):
                continue
            ra_c, dec_c = catalogue_position(star, item["mjd"])
            plx = (star.get("parallax") or 0.0) / 1000
            pe, pn = astrometry.parallax_factors(ra_c, dec_c, item["observer_au"])
            east, north = astrometry.tangent_offsets_arcsec(ra_c, dec_c, position.ra_deg, position.dec_deg)
            cov = np.array(position.cov_arcsec2)
            raw += [east - plx * pe, north - plx * pn]
            variances += [cov[0, 0], cov[1, 1]]
    if len(raw) < 20:
        return {"floor_arcsec": None, "n_residuals": len(raw), "rms_arcsec": None, "median_offset_arcsec": None}
    raw = np.array(raw)
    robust_sigma = 1.4826 * float(np.median(np.abs(raw - np.median(raw))))
    # Scatter not explained by the fit errors is treated as a per-exposure systematic floor.
    floor = math.sqrt(max(0.0, robust_sigma**2 - float(np.median(variances))))
    return {"floor_arcsec": round(floor, 4), "n_residuals": int(raw.size), "rms_arcsec": round(robust_sigma, 4),
            "median_offset_arcsec": round(float(np.median(raw)), 4)}


def control_summary(fits: dict[str, dict], stars: dict[str, dict]) -> dict:
    """Compare each control star's fitted motion with Gaia DR3."""
    rows = []
    for source_id, fit in fits.items():
        if fit.get("status") != "measured":
            continue
        star = stars[source_id]
        cov = np.array(fit["cov"])[2:4, 2:4] * max(1.0, fit["chi2_red"])
        measured = np.array([fit["params"]["pm_east_arcsec_yr"], fit["params"]["pm_north_arcsec_yr"]])
        catalogue = np.array([star["pmra"], star["pmdec"]]) / 1000
        difference = measured - catalogue
        d2 = float(difference @ np.linalg.inv(cov) @ difference)
        rows.append({"source_id": source_id, "g_mag": _round(star["phot_g_mean_mag"], 3),
                     "pm_measured_arcsec_yr": [_round(v, 4) for v in measured],
                     "pm_catalogue_arcsec_yr": [_round(v, 5) for v in catalogue],
                     "sigma_arcsec_yr": [_round(math.sqrt(cov[0, 0]), 4), _round(math.sqrt(cov[1, 1]), 4)],
                     "d2": _round(d2, 3), "n_points": fit["n_points"], "chi2_red": _round(fit["chi2_red"], 3)})
    if not rows:
        return {"status": "insufficient_data", "n_stars": 0, "rows": []}
    d2 = np.array([row["d2"] for row in rows])
    differences = np.array([np.hypot(*(np.array(row["pm_measured_arcsec_yr"]) - np.array(row["pm_catalogue_arcsec_yr"])))
                            for row in rows])
    # Under correct errors d2 follows chi2 with 2 dof: 95% of stars below 5.99.
    within = float(np.mean(d2 <= 5.991464547107979))
    return {
        "status": "measured",
        "n_stars": len(rows),
        "median_abs_difference_arcsec_yr": _round(float(np.median(differences)), 4),
        "fraction_within_95pct_region": _round(within, 3),
        "passes": bool(within >= 0.8),
        "rows": sorted(rows, key=lambda row: row["g_mag"]),
    }
