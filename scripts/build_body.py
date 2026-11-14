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

from backend import astrometry, config, investigation as inv
from backend.processing import group_visits, load_product
from scripts.acquire_body import HOLDOUT_WINDOWS_MJD, check_not_holdout, folder_for
from scripts.build_investigation import json_bytes, preview_image

NAMES = {"makemake": "Makemake", "pluto": "Pluto"}
MOVED_ENOUGH_ARCSEC = 30.0
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

    observations, per_exposure = [], []
    for item in follow:
        product = item["product"]
        ra, dec = item["centre"]["ra_deg"], item["centre"]["dec_deg"]
        position = astrometry.fit_position(product, ra, dec, product.info.get("PSF_FWHM"))
        row = {"obs_key": item["obsKey"], "mjd": round(float(product.info.get("MJD-AVG", item["mjd"])), 6),
               "detector": item["detector"], "visit": item["visit"], **position.to_json(),
               "ephemeris_ra_deg": ra, "ephemeris_dec_deg": dec}
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
            "centre": item["centre"], "role": "training",
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

    bodies = [row for row in per_exposure if row["identification"] == "body"]
    candidates = [row for row in per_exposure if row["identification"] in ("body", "candidate")]
    limitations = ["limit.ephemeris-guided", "limit.gaussian-psf-model", "limit.training-visits-only"]
    if not bodies:
        limitations.append("limit.detection-not-validated")
    measurements = []
    if bodies:
        offsets = np.array([[row["offset_east_arcsec"], row["offset_north_arcsec"]] for row in bodies])
        total = np.hypot(offsets[:, 0], offsets[:, 1])
        measurements.append({"id": "m-offset", "quantity": "position_offset_arcsec", "content_type": "measured",
                             "status": "measured", "value": round(float(np.median(total)), 3),
                             "sigma": round(float(1.4826 * np.median(np.abs(total - np.median(total)))), 3),
                             "method": "native-psf-fit near the ephemeris, static-source check passed",
                             "n_points": len(bodies), "inputs": sorted({inv.epoch_id(r["visit"], r["detector"]) for r in bodies}),
                             "limitation_keys": limitations})
    else:
        measurements.append({"id": "m-offset", "quantity": "position_offset_arcsec", "content_type": "measured",
                             "status": "insufficient_data", "value": None, "sigma": None,
                             "status_reason_key": "measure.low-snr" if not candidates else "measure.fit-failed",
                             "method": "native-psf-fit near the ephemeris", "inputs": [], "limitation_keys": limitations})
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
                    "cutout_deg": round(float(follow[0]["grid"]["fov"]) * config.CUTOUT_MARGIN, 4) if follow else None},
        "coverage": {"observations_listed": len(follow), "observations_used": sum(o.get("quality", {}).get("usable", False) for o in observations),
                     "training_only": True, "holdout_window_mjd_closed": [low, high],
                     "releases": sorted({item["release"] for item in follow})},
        "observations": observations,
        "epochs": epochs,
        "comparisons": comparisons,
        "measurements": measurements,
        "astrometry": {"per_exposure": per_exposure,
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
            "identification": manifest["astrometry"]["identification_counts"]}


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
