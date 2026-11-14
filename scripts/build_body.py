"""Investigation file for a moving body (Makemake, Pluto) from its TRAINING visits only.

Usage: python -m scripts.build_body <makemake|pluto> [--out static/data]

Reads what scripts/acquire_body.py cached. Positions are fitted near the JPL Horizons
position (catalogue-assisted). A fitted source counts as the body only if the same sky
position is empty in another exposure of the same array and visit, taken when the body
had moved away (static-source check). Otherwise it stays a candidate.
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np

from backend import astrometry, config, investigation as inv, stacking
from backend.processing import group_visits, load_product
from scripts.acquire_body import HOLDOUT_WINDOWS_MJD, SEE_ONLY, check_not_holdout, folder_for
from scripts.build_investigation import json_bytes, preview_image

NAMES = {"makemake": "Makemake", "pluto": "Pluto", "3i-atlas": "3I/ATLAS"}
MOVED_ENOUGH_ARCSEC = 30.0
# Geocentric distance (au) from JPL Horizons at 2026-01-01 00:00 UTC (scripts/build_index.py);
# used only to move the geocentric ephemeris to the spacecraft (shift <0.3 arcsec, 3% accurate).
DISTANCE_AU = {"makemake": 52.743, "pluto": 36.328}
KM_PER_AU = 1.495978707e8
STATIC_SNR = 5.0


def load(key: str) -> tuple[list[dict], list[dict]]:
    follow, fixed = [], []
    for path in sorted((folder_for(key) / "meta").glob("*.json")):
        meta = json.loads(path.read_text())
        check_not_holdout(key, meta["mjd"])
        meta["product"] = load_product((config.CACHE_DIR / meta["source"]["native"]).read_bytes())
        with np.load(config.CACHE_DIR / meta["frame"]) as stored:
            meta["pixels"], meta["mask"] = stored["pixels"], stored["mask"]
        (fixed if meta["kind"] == "fixed" else follow).append(meta)
    follow.sort(key=lambda item: (item["mjd"], item["detector"]))
    fixed.sort(key=lambda item: item["mjd"])
    return follow, fixed


def static_check(item: dict, others: list[dict], position) -> dict:
    """Is there a source at this sky position when the body is elsewhere?"""
    for other in others:
        if other is item or other["detector"] != item["detector"] or abs(other["mjd"] - item["mjd"]) > 10:
            continue
        east, north = astrometry.tangent_offsets_arcsec(other["centre"]["ra_deg"], other["centre"]["dec_deg"],
                                                        position.ra_deg, position.dec_deg)
        if math.hypot(east, north) < MOVED_ENOUGH_ARCSEC:
            continue
        probe = astrometry.fit_position(other["product"], position.ra_deg, position.dec_deg,
                                        other["product"].info.get("PSF_FWHM"))
        if probe.reason_key == "measure.outside-cutout":
            continue
        static = probe.status == "measured" and (probe.snr or 0) >= STATIC_SNR
        return {"checked_against": other["obsKey"], "static_source": static, "probe_snr": probe.snr}
    return {"checked_against": None, "static_source": None, "probe_snr": None}


def build(key: str, out: Path) -> dict:
    follow, fixed = load(key)
    visits = group_visits([item["mjd"] for item in follow])
    for item, visit in zip(follow, visits):
        item["visit"] = visit
    folder = out / key
    (folder / "epochs").mkdir(parents=True, exist_ok=True)

    see_only = key in SEE_ONLY
    observations, per_exposure = [], []
    for item in follow:
        product = item["product"]
        ra, dec = item["centre"]["ra_deg"], item["centre"]["dec_deg"]
        if see_only:
            per_exposure.append({"obs_key": item["obsKey"], "identification": "not_attempted"})
        else:
            position = astrometry.fit_position(product, ra, dec, product.info.get("PSF_FWHM"))
            spacecraft = [product.info.get(axis) for axis in ("X_SC", "Y_SC", "Z_SC")]
            row = {"obs_key": item["obsKey"], "mjd": round(float(product.info.get("MJD-AVG", item["mjd"])), 6),
                   "detector": item["detector"], "visit": item["visit"], **position.to_json(),
                   "ephemeris_ra_deg": ra, "ephemeris_dec_deg": dec,
                   "spacecraft_km": None if None in spacecraft else [round(float(v), 3) for v in spacecraft]}
            if position.status == "measured":
                east, north = astrometry.tangent_offsets_arcsec(ra, dec, position.ra_deg, position.dec_deg)
                row.update(offset_east_arcsec=round(east, 3), offset_north_arcsec=round(north, 3))
                row["static_check"] = static_check(item, follow, position)
                row["identification"] = ("body" if row["static_check"]["static_source"] is False
                                         else "static_source" if row["static_check"]["static_source"] else "candidate")
            else:
                row["identification"] = "none"
            per_exposure.append(row)
        observations.append({
            "obs_key": item["obsKey"], "obs_id": item["obsId"], "detector": item["detector"],
            "collection": item["release"], "processing": item["processing"],
            "t_start_mjd": round(float(product.info.get("MJD-BEG", item["mjd"])), 6),
            "t_end_mjd": round(float(product.info.get("MJD-END", item["mjdEnd"] or item["mjd"])), 6),
            "time_scale": product.info.get("TIMESYS", "UTC"),
            "t_start_utc": inv.mjd_to_utc(float(product.info.get("MJD-BEG", item["mjd"]))),
            "response": item["response"], "file": item["source"]["url"].split("?")[0].rsplit("/", 1)[-1],
            "url": item["source"]["url"], "source_sha256": item["source"]["sha256"],
            "source_bytes": item["source"]["bytes"], "software": item["source"]["software"],
            "flag_schema": item["flagSchema"], "mask_policy": item["maskPolicy"],
            "centre": item["centre"], "role": "see_only" if see_only else "training",
            "official_collection": item.get("officialCollection"),
            "quality": {"usable": item["l2dqa"] in (None, "Pass"), "reason_key": None if item["l2dqa"] in (None, "Pass")
                        else "quality.l2-dqa-not-pass", "l2_dqa": item["l2dqa"]},
        })

    epochs = []
    groups = {}
    for item in follow:
        groups.setdefault((item["visit"], item["detector"]), []).append(item)
    for (visit, detector), members in sorted(groups.items()):
        eid = inv.epoch_id(visit, detector)
        stack = _median([member for member in members])
        values = stack[np.isfinite(stack)]
        limits = tuple(float(v) for v in np.percentile(values, [25, 99.8])) if values.size else (0.0, 1.0)
        preview_image(stack, (limits[0], max(limits[1], limits[0] + 1e-6))).save(folder / "epochs" / f"{eid}.webp", quality=85)
        epochs.append({
            "id": eid, "visit": visit, "detector": detector, "obs_keys": [member["obsKey"] for member in members],
            "t_start_mjd": round(min(member["mjd"] for member in members), 6),
            "t_end_mjd": round(max(member["mjdEnd"] or member["mjd"] for member in members), 6),
            "combine": "single" if len(members) == 1 else "median_stack",
            "frame": "body_centred",
            "assets": {"preview": f"{key}/epochs/{eid}.webp", "preview_kind": "median_stack_on_body",
                       "content_type": "processed"},
            "viewer": None,
        })

    comparisons = []
    if len(fixed) == 2:
        shared = _limits(fixed)
        for tag, item in zip("ab", fixed):
            preview_image(_masked(item), shared).save(folder / "epochs" / f"fixed-{tag}.webp", quality=85)
            epochs.append({"id": f"fixed-{tag}", "visit": None, "detector": item["detector"], "obs_keys": [item["obsKey"]],
                           "t_start_mjd": round(item["mjd"], 6), "t_end_mjd": round(item["mjdEnd"] or item["mjd"], 6),
                           "combine": "single", "frame": "fixed_sky", "centre": item["centre"],
                           "assets": {"preview": f"{key}/epochs/fixed-{tag}.webp", "preview_kind": "single",
                                      "content_type": "processed"}, "viewer": None})
            observations.append({"obs_key": item["obsKey"] + ":fixed", "obs_id": item["obsId"], "detector": item["detector"],
                                 "collection": item["release"], "processing": item["processing"],
                                 "t_start_mjd": round(item["mjd"], 6), "url": item["source"]["url"],
                                 "source_sha256": item["source"]["sha256"], "role": "training_fixed_sky",
                                 "flag_schema": item["flagSchema"], "response": item["response"]})
        comparisons.append({"id": "c-fixed", "a": "fixed-a", "b": "fixed-b", "grade": "qualitative",
                            "modes": ["blink", "side_by_side", "swipe"],
                            "checks": {"response": "not_checked", "registration": "not_checked", "psf": "not_checked",
                                       "background": "not_checked"},
                            "reason_keys": ["compare.position-different-response"],
                            "explain_key": "explain.fixed-sky-pair"})

    if see_only:
        return write_see_only(key, folder, follow, observations, epochs)
    epoch_fits = joint_epoch_fits(groups, DISTANCE_AU.get(key))
    accepted = [row for row in epoch_fits if row["identification"] == "body"]
    limitations = ["limit.ephemeris-guided", "limit.gaussian-psf-model", "limit.training-visits-only",
                   "limit.joint-fit-epochs"]
    if not accepted:
        limitations.append("limit.detection-not-validated")
    measurements = []
    for row in epoch_fits:
        mid = f"m-offset-{row['epoch']}"
        base = {"id": mid, "quantity": "position_offset_arcsec", "content_type": "measured",
                "method": "joint forced fit on native pixels, common offset from the ephemeris",
                "inputs": [row["epoch"]], "identification": row["identification"], "snr": row["snr"],
                "null_snr": row["null"]["snr"], "limitation_keys": limitations}
        if row["identification"] == "body":
            cov = np.array(row["cov_arcsec2"])
            east, north = row["offset_east_arcsec"], row["offset_north_arcsec"]
            total = math.hypot(east, north)
            sigma = math.sqrt(max(cov[0, 0], cov[1, 1]))
            measurements.append({**base, "status": "measured", "value": round(total, 3), "sigma": round(sigma, 3),
                                 "east_arcsec": round(east, 3), "north_arcsec": round(north, 3),
                                 "cov_arcsec2": [[round(v, 5) for v in line] for line in cov.tolist()]})
        else:
            reason = row.get("reason_key") or ("measure.null-test-failed" if row["identification"] == "candidate"
                                                else "measure.low-snr")
            measurements.append({**base, "status": "insufficient_data", "value": None, "sigma": None,
                                 "status_reason_key": reason})
    bodies = accepted
    low, high = HOLDOUT_WINDOWS_MJD[key]
    manifest = {
        "schema_version": inv.SCHEMA,
        "target_key": key,
        "contract_version": 3,
        "dataset_version": "a3-2026-11-14",
        "pipeline": {"version": config.PIPELINE_VERSION, "code_sha256": inv.code_sha256(),
                     "config_sha256": inv.config_sha256({"pipeline": config.PIPELINE_VERSION, "moved": MOVED_ENOUGH_ARCSEC,
                                                         "static_snr": STATIC_SNR})},
        "request": {"mode": "object_following", "ephemeris": "JPL Horizons (docs/exposure inventory)",
                    "offset_reference": "Horizons geocentric position moved to the spacecraft (FITS X_SC/Y_SC/Z_SC; "
                                        f"distance {DISTANCE_AU.get(key)} au at 2026-01-01)",
                    "cutout_deg": round(float(follow[0]["grid"]["fov"]) * config.CUTOUT_MARGIN, 4) if follow else None},
        "coverage": {"observations_listed": len(follow), "observations_used": sum(o.get("quality", {}).get("usable", False) for o in observations),
                     "training_only": True, "holdout_window_mjd_closed": [low, high],
                     "releases": sorted({item["release"] for item in follow})},
        "observations": observations,
        "epochs": epochs,
        "comparisons": comparisons,
        "measurements": measurements,
        "astrometry": {"epochs": epoch_fits, "per_exposure": per_exposure,
                       "identification_counts": {kind: sum(row["identification"] == kind for row in per_exposure)
                                                 for kind in ("body", "candidate", "static_source", "none")}},
        "photometry": None,
        "explanation": [{"key": "explain.training-only", "params": {}},
                        {"key": "explain.moving-object-cutouts", "params": {}}],
        "capabilities": {"modes": ["blink", "side_by_side", "swipe"], "difference": False, "spectrum": False,
                         "light_curve": False},
        "viewer": None,
        "legacy": None,
        "data_status": "partial" if follow else "unavailable",
        "measurement_status": "measured" if bodies else "insufficient_data",
        "limitation_keys": limitations,
        "credits_keys": ["credit.irsa", "credit.spherex", "credit.horizons"],
    }
    (folder / "investigation.json").write_bytes(json_bytes(manifest))
    return {"key": key, "observations": len(follow), "epochs": len(epochs),
            "identification": manifest["astrometry"]["identification_counts"],
            "epoch_identification": {row["epoch"]: row["identification"] for row in epoch_fits}}


def spacecraft_corrected(member: dict, distance_au: float | None) -> tuple[float, float]:
    """Geocentric ephemeris position moved to the spacecraft (header X_SC/Y_SC/Z_SC, km, GEOCENTER)."""
    ra, dec = member["centre"]["ra_deg"], member["centre"]["dec_deg"]
    info = member["product"].info
    if not distance_au or not all(key in info for key in ("X_SC", "Y_SC", "Z_SC")):
        return ra, dec
    s = np.array([info["X_SC"], info["Y_SC"], info["Z_SC"]], float) / KM_PER_AU
    a, d = math.radians(ra), math.radians(dec)
    east = np.array([-math.sin(a), math.cos(a), 0.0])
    north = np.array([-math.sin(d) * math.cos(a), -math.sin(d) * math.sin(a), math.cos(d)])
    shift_e = -float(s @ east) / distance_au * 206264.806
    shift_n = -float(s @ north) / distance_au * 206264.806
    return astrometry.tangent_to_sky(ra, dec, shift_e, shift_n)


def joint_epoch_fits(groups: dict, distance_au: float | None = None) -> list[dict]:
    """One joint forced fit per epoch, with the time-shuffled null test.

    Offsets are measured from the ephemeris moved to the spacecraft's position.
    """
    rows = []
    for (visit, detector), members in sorted(groups.items()):
        products = [member["product"] for member in members]
        positions = [spacecraft_corrected(member, distance_au) for member in members]
        fit = stacking.joint_fit(products, positions)
        null = stacking.null_test(products, positions)
        detected = fit["status"] == "measured"
        identification = ("body" if detected and null.get("passes") is True
                          else "candidate" if detected else "none")
        mjds = [float(member["product"].info.get("MJD-AVG", member["mjd"])) for member in members]
        # Absolute position at the epoch's mean time: mean reference position plus the common offset
        # (linear motion within the epoch, so the mean of the positions is the position at the mean time).
        reference = _mean_position(positions)
        absolute = None
        if fit.get("offset_east_arcsec") is not None:
            absolute = astrometry.tangent_to_sky(reference[0], reference[1], fit["offset_east_arcsec"],
                                                 fit["offset_north_arcsec"])
        spacecraft = [[member["product"].info.get(axis) for axis in ("X_SC", "Y_SC", "Z_SC")] for member in members]
        spacecraft = [row for row in spacecraft if None not in row]
        rows.append({"epoch": inv.epoch_id(visit, detector), "visit": visit, "detector": detector,
                     "mean_mjd": round(float(np.mean(mjds)), 6), "n_exposures": fit.get("n_exposures"),
                     "reference_ra_deg": round(reference[0], 8), "reference_dec_deg": round(reference[1], 8),
                     "ra_deg": round(absolute[0], 8) if absolute else None,
                     "dec_deg": round(absolute[1], 8) if absolute else None,
                     "spacecraft_km": [round(float(v), 3) for v in np.mean(spacecraft, axis=0)] if spacecraft else None,
                     "obs_keys": [member["obsKey"] for member in members],
                     "identification": identification, "reason_key": fit.get("reason_key"),
                     "snr": _r(fit.get("snr")), "offset_east_arcsec": _r(fit.get("offset_east_arcsec")),
                     "offset_north_arcsec": _r(fit.get("offset_north_arcsec")),
                     "cov_arcsec2": fit.get("cov_arcsec2"), "chi2_red": _r(fit.get("chi2_red")),
                     "null": {key: (_r(value) if isinstance(value, float) else value) for key, value in null.items()}})
    return rows


def _mean_position(positions: list[tuple[float, float]]) -> tuple[float, float]:
    """Mean of nearby sky positions through the tangent plane of the first one."""
    ra0, dec0 = positions[0]
    offsets = np.array([astrometry.tangent_offsets_arcsec(ra0, dec0, ra, dec) for ra, dec in positions])
    return astrometry.tangent_to_sky(ra0, dec0, float(offsets[:, 0].mean()), float(offsets[:, 1].mean()))


def _r(value, digits=4):
    return None if value is None else round(float(value), digits)


def write_see_only(key, folder, follow, observations, epochs) -> dict:
    summary = json.loads((folder_for(key) / "acquire-summary.json").read_text())
    unresolved = summary.get("unresolved", [])
    manifest = {
        "schema_version": inv.SCHEMA, "target_key": key, "contract_version": 3, "dataset_version": "a3-2026-11-14",
        "pipeline": {"version": config.PIPELINE_VERSION, "code_sha256": inv.code_sha256()},
        "request": {"mode": "object_following", "positions": "official SPHEREx 3I/ATLAS exposure table",
                    "cutout_deg": round(float(follow[0]["grid"]["fov"]) * config.CUTOUT_MARGIN, 4) if follow else None},
        "coverage": {"observations_listed": len(follow) + len(unresolved), "observations_used": len(follow),
                     "observations_unavailable": unresolved, "releases": sorted({item["release"] for item in follow}),
                     "official_table_collection": "spherex_qr2"},
        "observations": observations, "epochs": epochs, "comparisons": [], "measurements": [],
        "astrometry": None, "photometry": None,
        "explanation": [{"key": "explain.see-only", "params": {}}, {"key": "explain.moving-object-cutouts", "params": {}}],
        "capabilities": {"modes": ["side_by_side"], "difference": False, "spectrum": False, "light_curve": False},
        "viewer": None, "legacy": None,
        "data_status": "available" if follow else "unavailable",
        "status_reason_key": None if follow else "unavailable.no-current-product",
        "measurement_status": "not_attempted",
        "limitation_keys": ["limit.official-table-positions", "limit.see-only"],
        "credits_keys": ["credit.irsa", "credit.spherex", "credit.comet-table"],
    }
    (folder / "investigation.json").write_bytes(json_bytes(manifest))
    return {"key": key, "observations": len(follow), "unavailable": len(unresolved), "epochs": len(epochs)}


def _masked(item):
    return np.where(item["mask"] == 0, item["pixels"], np.nan)


def _median(items):
    import warnings

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanmedian(np.stack([_masked(item) for item in items]), axis=0)


def _limits(items):
    values = np.concatenate([_masked(item)[np.isfinite(_masked(item))] for item in items])
    low, high = np.percentile(values, [25, 99.8])
    return float(low), float(max(high, low + 1e-6))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("key", choices=sorted(NAMES))
    parser.add_argument("--out", default="static/data")
    args = parser.parse_args()
    print(json.dumps(build(args.key, Path(args.out))))
