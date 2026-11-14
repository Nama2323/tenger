"""Build static/data/<key>/investigation.json, epoch previews and the viewer bundle for one target.

Usage: python -m scripts.build_investigation <target-key> [--out static/data]

Reads exposures already processed into the cache by scripts/acquire.py (it downloads
any that are missing, so run it only for targets that may be opened, see
docs/EXPOSURE.md). Measurements use the native products; the viewer bundle and the
previews are made from the display frames of the same exposures.
"""
import argparse
import gzip
import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from backend import astrometry, config, context as survey_context, gaia, investigation as inv
from backend.coords import mjd_to_year
from backend.flags import MASK_POLICY
from backend.jobs import Job
from backend.presets import ALL_TARGETS
from backend.processing import load_product, native_aperture_photometry, response_at
from backend.spectral import MATCH_FRACTION_OF_BANDWIDTH
from scripts.build_site import ENCODE_STEP, encode, soft_scale_of

DATASET_VERSION = "a3-2026-11-14"
VIEWER_MIN_COVERAGE = 0.92  # the viewer drops frames below this (static/js/stack.js wellCovered)
VIEWER_COVERAGE_STRIDE = 7
VIEWER_MAX_FRAMES = 240
PREVIEW_SIZE = 240
FIELD_RADIUS_FACTOR = 0.75  # Gaia query radius as a fraction of the field width
MOVERS = {"barnard", "wise0855", "epsindib"}
# Known blends at SPHEREx resolution (6.15 arcsec pixels).
TARGET_LIMITS = {"rwaur": ["limit.blended-binary"], "epsindib": ["limit.blended-binary"]}
# Targets Gaia DR3 does not list: SIMBAD (CDS first, CfA mirror fallback), with bibcodes.
SIMBAD_FALLBACK = {"wise0855": "WISE J085510.83-071442.5", "epsindib": "eps Ind B"}
CATALOGUE_FALLBACK = {"wise0855": {"source": "preset (inherited SPHEREx Blink values)", "parallax_mas": None}}


def simbad_star(identifier: str) -> dict | None:
    """SIMBAD astrometry (J2000 position, motion, parallax) moved to epoch 2016.0."""
    import csv
    import io

    from backend import catalogs
    from backend.coords import propagate

    escaped = identifier.replace("'", "''")
    query = ("SELECT b.ra, b.dec, b.pmra, b.pmdec, b.plx_value, b.plx_err, b.pm_err_maj, b.coo_bibcode, "
             "b.pm_bibcode, b.plx_bibcode FROM basic AS b JOIN ident AS i ON i.oidref = b.oid "
             f"WHERE i.id = '{escaped}'")
    try:
        text, url = catalogs.simbad_tap(query)
    except Exception:  # noqa: BLE001 - fall back to the preset
        return None
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows or not rows[0].get("pmra"):
        return None
    row = rows[0]
    pmra, pmdec = float(row["pmra"]), float(row["pmdec"])
    ra16, dec16 = propagate(float(row["ra"]), float(row["dec"]), pmra, pmdec, 2000.0, 57388.5)
    plx = float(row["plx_value"]) if row.get("plx_value") else None
    return {"source_id": None, "ra": ra16, "dec": dec16, "pmra": pmra, "pmdec": pmdec, "parallax": plx,
            "parallax_error": float(row["plx_err"]) if row.get("plx_err") else None,
            "pmra_error": None, "pmdec_error": None, "phot_g_mean_mag": None,
            "source": (f"SIMBAD via {url.split('/')[2]}: position {row.get('coo_bibcode')}, motion "
                       f"{row.get('pm_bibcode')}, parallax {row.get('plx_bibcode')}; moved to 2016.0")}


def json_bytes(obj) -> bytes:
    return (json.dumps(obj, indent=2, ensure_ascii=False) + "\n").encode()


def find_target_star(preset, stars: list[dict]) -> dict | None:
    """The Gaia source matching the preset: within 5 arcsec at 2016.0 and similar motion."""
    from backend.coords import propagate

    ra16, dec16 = propagate(preset.ra, preset.dec, preset.pmra, preset.pmdec, preset.epoch, 57388.5)
    best = None
    for star in stars:
        separation = inv._sep_arcsec(star, {"ra": ra16, "dec": dec16})
        if separation > 5:
            continue
        if preset.key in MOVERS and star.get("pmra") is not None:
            if math.hypot(star["pmra"] - preset.pmra, star["pmdec"] - preset.pmdec) > 500:
                continue
        if best is None or separation < best[0]:
            best = (separation, star)
    return best[1] if best else None


def preset_star(preset) -> dict:
    """The preset as a catalogue row (epoch moved to 2016.0 so the shared code applies)."""
    from backend.coords import propagate

    ra16, dec16 = propagate(preset.ra, preset.dec, preset.pmra, preset.pmdec, preset.epoch, 57388.5)
    return {"source_id": None, "ra": ra16, "dec": dec16, "pmra": preset.pmra, "pmdec": preset.pmdec,
            "parallax": CATALOGUE_FALLBACK.get(preset.key, {}).get("parallax_mas"), "phot_g_mean_mag": None,
            "pmra_error": None, "pmdec_error": None}


def load_exposures(job: Job) -> list[inv.Exposure]:
    exposures = []
    for frame in sorted(job.frames, key=lambda item: (item.meta["mjd"], item.meta["detector"])):
        native = (frame.meta.get("source") or {}).get("native")
        if not native:
            continue
        product = load_product((config.CACHE_DIR / native).read_bytes())
        exposures.append(inv.Exposure(frame.meta, product))
    return exposures


def preview_image(stack: np.ndarray, limits: tuple[float, float]) -> Image.Image:
    low, high = limits
    unit = np.clip((np.nan_to_num(stack, nan=low) - low) / max(high - low, 1e-9), 0, None)
    level = np.minimum(1, np.arcsinh(unit * 10) / math.asinh(10))
    grey = (level * 255).astype(np.uint8)[::-1]  # north up
    return Image.fromarray(grey, "L").resize((PREVIEW_SIZE, PREVIEW_SIZE), Image.NEAREST)


def median_stack(frames) -> np.ndarray:
    import warnings

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        stack = np.stack([np.where(frame.mask == 0, frame.pixels, np.nan) for frame in frames])
        return np.nanmedian(stack, axis=0)


def load_cached(job: Job) -> None:
    """Fill a job from the cache only (no downloads); for checks while acquisition runs."""
    import httpx

    from backend import archive, framestore
    from backend.processing import group_visits

    from backend.jobs import sample_evenly

    with httpx.Client(timeout=120, follow_redirects=True) as client:
        listed = archive.search(client, job.grid.ra, job.grid.dec)
    exposures = sample_evenly(listed, job.limit)
    job.available, job.total = len(listed), len(exposures)
    for exposure, visit in zip(exposures, group_visits([item.mjd for item in exposures])):
        frame = framestore.load(job.id, archive.exposure_key(exposure), job.cache_tag, visit)
        if frame is not None:
            job.frames.append(frame)
        else:
            job.failed += 1
    job.status = "done"


def build(key: str, out: Path, cached_only: bool = False) -> dict:
    preset = next(item for item in ALL_TARGETS if item.key == key)
    ra_c, dec_c = preset.centre()
    from scripts.acquire import DEFAULT_LIMIT, LIMITS

    job = Job(ra_c, dec_c, preset.fov, limit=LIMITS.get(key, DEFAULT_LIMIT))
    if cached_only:
        load_cached(job)
    else:
        job.run()
    if job.status != "done":
        raise RuntimeError(f"{key}: job {job.status}: {job.error}")
    exposures = load_exposures(job)
    frames_by_key = {frame.meta["obsKey"]: frame for frame in job.frames}

    stars = gaia.field_stars(ra_c, dec_c, preset.fov * FIELD_RADIUS_FACTOR)
    star = find_target_star(preset, stars)
    catalogue_source = "Gaia DR3"
    if star is None and key in SIMBAD_FALLBACK:
        star = simbad_star(SIMBAD_FALLBACK[key])
        catalogue_source = star["source"] if star else None
    if star is None:
        catalogue_source = CATALOGUE_FALLBACK.get(key, {}).get("source", "preset")
        star = preset_star(preset)

    # Observations and the quality gate, at the target's catalogue position at each time.
    records, usable = {}, []
    for exposure in exposures:
        mjd = inv.exposure_mid_mjd(exposure)
        ra_t, dec_t = inv.catalogue_position(star, mjd)
        gate = inv.quality_gate(exposure, ra_t, dec_t)
        record = inv.observation_record(exposure, ra_t, dec_t, gate)
        records[record["obs_key"]] = record
        if gate[0]:
            usable.append(exposure)

    # Viewer bundle: the well-covered display frames of usable exposures.
    viewer_frames = [frames_by_key[item.meta["obsKey"]] for item in usable
                     if viewer_covered(frames_by_key[item.meta["obsKey"]].pixels)]
    if len(viewer_frames) > VIEWER_MAX_FRAMES:
        keep = np.linspace(0, len(viewer_frames) - 1, VIEWER_MAX_FRAMES).astype(int)
        viewer_frames = [viewer_frames[index] for index in keep]
    viewer_index = {frame.meta["obsKey"]: index for index, frame in enumerate(viewer_frames)}

    epochs = inv.build_epochs(usable, viewer_index)
    gradients = {"half_size_px": job.grid.n / 2}
    for exposure in usable:
        meta = exposure.meta
        gradients[meta["obsKey"]] = (meta.get("waveDx", 0.0), meta.get("waveDy", 0.0)) if meta.get("response") else None
    comparisons = inv.build_comparisons(epochs, records, gradients)

    folder = out / key
    (folder / "epochs").mkdir(parents=True, exist_ok=True)
    write_previews(epochs, frames_by_key, folder, key)
    write_bundle(job, viewer_frames, folder)

    measurements, astrometry_block, explanation, limitations = [], None, [], set()
    mjd_ref = float(np.median([inv.exposure_mid_mjd(item) for item in usable])) if usable else None
    if key in MOVERS and usable:
        astrometry_block, motion_measurements, explanation = measure_motion(usable, star, stars, mjd_ref, catalogue_source)
        measurements += motion_measurements
    photometry_block, photometry_measurements = measure_brightness(usable, star, comparisons, stars)
    measurements += photometry_measurements
    if key not in MOVERS:
        ratios = [item for item in photometry_measurements if item["status"] == "measured"]
        if ratios:
            best = min(ratios, key=lambda item: item["sigma"])
            explanation.append({"key": "explain.brightness-measured", "params": {
                "measurement": best["id"], "value": best["value"], "sigma": best["sigma"], "n_ratios": len(ratios)}})
        else:
            refused = photometry_block.get("refused", {})
            explanation.append({"key": "explain.brightness-insufficient", "params": {
                "n_flagged": refused.get("measure.flagged-pixels-in-aperture", 0), "n_exposures": photometry_block["n_points"]}})
    for measurement in measurements:
        if measurement["content_type"] == "measured" and key in TARGET_LIMITS:
            measurement["limitation_keys"] = sorted(set(measurement.get("limitation_keys", [])) | set(TARGET_LIMITS[key]))
        limitations.update(measurement.get("limitation_keys", []))
    limitations.update(TARGET_LIMITS.get(key, []))

    settings = {
        "pipeline": config.PIPELINE_VERSION, "mask_policy": MASK_POLICY, "frame_schema": config.FRAME_SCHEMA,
        "match_fraction_of_bandwidth": MATCH_FRACTION_OF_BANDWIDTH, "core_radius_arcsec": inv.CORE_RADIUS_ARCSEC,
        "wing_radius_arcsec": inv.WING_RADIUS_ARCSEC, "control_g": [inv.CONTROL_MIN_G, inv.CONTROL_MAX_G],
        "release_priority": list(config.RELEASE_PRIORITY), "cutout_margin": config.CUTOUT_MARGIN,
    }
    # Only measurements of the target itself decide the status (not the field-star control).
    measured = [item for item in measurements if item["content_type"] == "measured"
                and not item["quantity"].startswith("control_") and not item.get("exploratory")]
    status = "measured" if any(item["status"] == "measured" for item in measured) else "insufficient_data"
    manifest = {
        "schema_version": inv.SCHEMA,
        "target_key": key,
        "contract_version": 3,
        "dataset_version": DATASET_VERSION,
        "pipeline": {"version": config.PIPELINE_VERSION, "config_sha256": inv.config_sha256(settings),
                     "code_sha256": inv.code_sha256(), "settings": settings},
        "request": {"ra_deg": round(ra_c, 6), "dec_deg": round(dec_c, 6), "fov_deg": preset.fov,
                    "position_epoch_mjd": 61100.0, "cutout_deg": round(preset.fov * config.CUTOUT_MARGIN, 4)},
        "coverage": {
            "available_fov_deg": preset.fov,
            "observations_listed": job.available,
            "observations_processed": len(exposures),
            "observations_used": len(usable),
            "observations_refused": dict(job.rejected),
            "observations_failed": job.failed,
            "releases": sorted({record["collection"] for record in records.values()}),
            "viewer_frames": len(viewer_frames),
        },
        "target_catalogue": {
            "source": catalogue_source, "gaia_source_id": star.get("source_id"),
            "ra_deg": star["ra"], "dec_deg": star["dec"], "epoch_jyear": 2016.0,
            "pmra_mas_yr": star.get("pmra"), "pmdec_mas_yr": star.get("pmdec"),
            "parallax_mas": star.get("parallax"), "content_type": "catalogue",
        },
        "observations": sorted(records.values(), key=lambda item: (item["t_start_mjd"], item["detector"])),
        "epochs": epochs,
        "comparisons": comparisons,
        "measurements": measurements,
        "astrometry": astrometry_block,
        "photometry": photometry_block,
        "context": survey_context.for_star(star) if key in MOVERS else None,
        "explanation": explanation,
        "capabilities": {
            "modes": ["blink", "side_by_side", "swipe"],
            "difference": any("difference" in item["modes"] for item in comparisons),
            "spectrum": False,
            "light_curve": bool(photometry_block and photometry_block.get("n_measured")),
        },
        "viewer": {
            "meta": f"{key}/meta.json", "frames": f"{key}/frames.bin.gz",
            "visits": viewer_visits(viewer_frames),
            "note": "frame_indices refer to meta.json frames; visit is the frames' 'visit' field",
        },
        "legacy": None,
        "data_status": "available" if usable else "unavailable",
        "measurement_status": status,
        "limitation_keys": sorted(limitations),
        "credits_keys": ["credit.irsa", "credit.spherex", "credit.gaia"],
    }
    payload = json_bytes(manifest)
    (folder / "investigation.json").write_bytes(payload)
    return {"key": key, "observations": len(records), "usable": len(usable), "epochs": len(epochs),
            "comparisons": len(comparisons), "status": status,
            "sha256": hashlib.sha256(payload).hexdigest()}


def viewer_covered(pixels: np.ndarray) -> bool:
    """Exactly the viewer's wellCovered test, so every bundled frame is shown."""
    sample = pixels.ravel()[::VIEWER_COVERAGE_STRIDE]
    return int(np.isfinite(sample).sum()) >= VIEWER_MIN_COVERAGE * math.ceil(pixels.size / VIEWER_COVERAGE_STRIDE)


def viewer_visits(frames) -> list[dict]:
    visits = {}
    for index, frame in enumerate(frames):
        visits.setdefault(frame.meta["visit"], []).append((index, frame.meta["mjd"]))
    rows = []
    for visit, members in sorted(visits.items()):
        mean = float(np.mean([mjd for _, mjd in members]))
        rows.append({"visit": visit, "frame_indices": [index for index, _ in members],
                     "mean_mjd": round(mean, 6), "date_utc": inv.mjd_to_utc(mean)[:10]})
    return rows


def write_previews(epochs, frames_by_key, folder: Path, key: str) -> None:
    """One median-stack preview per epoch; one stretch per array so dates compare fairly."""
    stacks = {epoch["id"]: median_stack([frames_by_key[obs] for obs in epoch["obs_keys"]]) for epoch in epochs}
    by_detector = {}
    for epoch in epochs:
        by_detector.setdefault(epoch["detector"], []).append(stacks[epoch["id"]])
    limits = {}
    for detector, members in by_detector.items():
        values = np.concatenate([item[np.isfinite(item)] for item in members]) if members else np.array([0.0])
        low, high = np.percentile(values, [25, 99.8]) if values.size else (0.0, 1.0)
        limits[detector] = (float(low), float(max(high, low + 1e-6)))
    for epoch in epochs:
        name = f"epochs/{epoch['id']}.webp"
        preview_image(stacks[epoch["id"]], limits[epoch["detector"]]).save(folder / name, quality=85)
        epoch["assets"]["preview"] = f"{key}/{name}"
        epoch["assets"]["preview_kind"] = "median_stack" if epoch["combine"] != "single" else "single"
        epoch["assets"]["content_type"] = "processed"


def write_bundle(job: Job, frames, folder: Path) -> None:
    """The viewer's meta.json + frames.bin.gz, rebuilt from the same exposures (format unchanged)."""
    scales = [soft_scale_of(frame.pixels) for frame in frames]
    pixels = b"".join(encode(frame.pixels, scale) for frame, scale in zip(frames, scales))
    masks = b"".join(frame.mask.astype(np.uint8).tobytes() for frame in frames)
    (folder / "frames.bin.gz").write_bytes(gzip.compress(pixels + masks, 9, mtime=0))
    old = json.loads((folder / "meta.json").read_text()) if (folder / "meta.json").exists() else {}
    grid = {"ra": job.grid.ra, "dec": job.grid.dec, "fov": job.grid.fov, "n": job.grid.n, "scale": job.grid.scale}
    meta = {
        "grid": grid,
        "available": job.available,
        "total": len(frames),
        "step": ENCODE_STEP,
        "frames": [{**frame.meta, "soft": scale} for frame, scale in zip(frames, scales)],
        "wise": old.get("wise"),
        "gaia": old.get("gaia") or [],
        "thumbs": old.get("thumbs"),
        "dataset_version": DATASET_VERSION,
    }
    (folder / "meta.json").write_text(json.dumps(meta, separators=(",", ":")))


def measure_motion(usable, star, stars, mjd_ref, catalogue_source):
    """Target and control-star astrometry; returns (astrometry block, measurements, explanation)."""
    target_results = inv.track(usable, star, stars)
    controls = inv.isolated_control_stars(stars, star)
    control_results = {item["source_id"]: inv.track(usable, item, stars) for item in controls}
    control_stars = {item["source_id"]: item for item in controls}
    floor = inv.residual_floor(control_results, control_stars)
    floor_value = floor["floor_arcsec"] or 0.0
    control_fits = {source: inv.fit_star(results, control_stars[source], mjd_ref, floor_value, parallax=True)
                    for source, results in control_results.items()
                    if sum(item["identified"] for item in results) >= inv.CONTROL_MIN_EPOCH_POINTS}
    control = inv.control_summary(control_fits, control_stars)
    has_parallax = star.get("parallax") is not None
    fixed = inv.fit_star(target_results, star, mjd_ref, floor_value, parallax=True) if has_parallax else None
    linear = inv.fit_star(target_results, star, mjd_ref, floor_value, parallax=False)
    free = inv.fit_star(target_results, star, mjd_ref, floor_value, parallax=False, free_parallax=True)
    main = fixed or linear

    per_exposure = [{
        "obs_key": item["obs_key"], "mjd": round(item["mjd"], 6), "detector": item["detector"],
        "visit": item["visit"], "wing_fit": item["wing_fit"], **item["position"].to_json(),
        "identified": item["identified"], "identification_reason_key": item["identification_reason_key"],
        "offset_from_catalogue_arcsec": item["offset_from_catalogue_arcsec"], "contaminant": item["contaminant"],
    } for item in target_results]
    measured_points = [row for row in per_exposure if row["status"] == "measured" and row["identified"]]
    limitations = ["limit.gaussian-psf-model", "limit.parallax-from-catalogue" if has_parallax else "limit.parallax-not-modelled",
                   "limit.catalogue-assisted-identification", "limit.identification-gate"]
    if any(row["wing_fit"] for row in measured_points):
        limitations.append("limit.saturated-core-wing-fit")
    if not control.get("passes"):
        limitations.append("limit.control-not-passed")
    parallax_measurement = parallax_from_spherex(free, star)
    if parallax_measurement.get("checks", {}).get("consistent_with_catalogue") is False:
        limitations.append("limit.visit-systematics")

    visit_fit = visit_level_fit(measured_points, main, (star.get("parallax") or 0) / 1000 if has_parallax else None)

    def visit_sigma(component):
        if visit_fit.get("status") != "measured":
            return None
        if component == "total":
            return astrometry.total_motion(visit_fit)[1]
        index = {"east": 2, "north": 3}[component]
        return math.sqrt(np.array(visit_fit["cov"])[index, index] * max(1.0, visit_fit["chi2_red"]))

    def motion_measurement(mid, quantity, fit, component, method, extra_limits=()):
        if fit.get("status") != "measured":
            return {"id": mid, "quantity": quantity, "content_type": "measured", "status": "insufficient_data",
                    "value": None, "sigma": None, "method": method, "inputs": [], "status_reason_key": fit.get("reason_key"),
                    "limitation_keys": sorted(set(limitations) | set(extra_limits))}
        if component == "total":
            value, sigma = astrometry.total_motion(fit)
        else:
            index = {"east": 2, "north": 3}[component]
            value = fit["params"]["pm_east_arcsec_yr" if component == "east" else "pm_north_arcsec_yr"]
            sigma = math.sqrt(np.array(fit["cov"])[index, index] * max(1.0, fit["chi2_red"]))
        basis = "exposure"
        conservative = visit_sigma(component) if fit is main else None
        if conservative is not None and conservative > sigma:
            sigma, basis = conservative, "visit"
        return {"id": mid, "quantity": quantity, "content_type": "measured", "status": "measured",
                "value": round(value, 4), "sigma": round(sigma, 4), "sigma_basis": basis, "method": method,
                "inputs": sorted({f"v{row['visit']}-d{row['detector']}" for row in measured_points}),
                "n_points": fit["n_points"], "chi2_red": round(fit["chi2_red"], 3), "span_days": round(fit["span_days"], 2),
                "limitation_keys": sorted(set(limitations) | set(extra_limits))}

    method_fixed = "native-psf-fit+wls, parallax fixed to catalogue"
    method_linear = "native-psf-fit+wls, no parallax term"
    measurements = []
    if fixed:
        measurements += [
            motion_measurement("m-pm-total", "proper_motion_total_arcsec_yr", fixed, "total", method_fixed),
            motion_measurement("m-pm-east", "proper_motion_east_arcsec_yr", fixed, "east", method_fixed),
            motion_measurement("m-pm-north", "proper_motion_north_arcsec_yr", fixed, "north", method_fixed),
        ]
    measurements.append(motion_measurement(
        "m-pm-total-linear", "proper_motion_total_linear_arcsec_yr", linear, "total", method_linear,
        ("limit.no-parallax-baseline",)))
    pm_cat = math.hypot(star["pmra"], star["pmdec"]) / 1000
    sigma_cat = None
    if star.get("pmra_error") is not None and pm_cat > 0:
        sigma_cat = math.hypot(star["pmra"] * star["pmra_error"], star["pmdec"] * star["pmdec_error"]) / (pm_cat * 1e6)
    measurements.append({"id": "m-pm-total-catalogue", "quantity": "proper_motion_total_arcsec_yr",
                         "content_type": "catalogue", "status": "measured", "value": round(pm_cat, 5),
                         "sigma": round(sigma_cat, 6) if sigma_cat is not None else None,
                         "method": catalogue_source, "inputs": [], "limitation_keys": []})
    measurements.append(parallax_measurement)
    measurements.append({"id": "m-control", "quantity": "control_fraction_within_95pct", "content_type": "measured",
                         "status": control["status"], "value": control.get("fraction_within_95pct_region"),
                         "sigma": None, "method": "field stars fitted like the target, compared with Gaia DR3",
                         "n_stars": control.get("n_stars"), "inputs": [], "limitation_keys": []})
    agreement = None
    first = measurements[0]
    if first["status"] == "measured":
        combined = math.hypot(first["sigma"], sigma_cat or 0.0)
        z = (first["value"] - pm_cat) / combined if combined else None
        agreement = {"measured": first["id"], "catalogue": "m-pm-total-catalogue", "z": round(z, 3) if z is not None else None,
                     "within_95pct": bool(z is not None and abs(z) <= 1.959963984540054)}
    explanation = []
    if first["status"] == "measured":
        explanation.append({"key": "explain.motion-measured", "params": {
            "measurement": first["id"], "value": first["value"], "sigma": first["sigma"],
            "catalogue": round(pm_cat, 4), "n_points": first["n_points"], "days": first["span_days"]}})
    else:
        contaminated = sum(row["identification_reason_key"] == "measure.contaminated" for row in per_exposure)
        if contaminated:
            neighbour = next(row["contaminant"] for row in per_exposure if row["contaminant"])
            explanation.append({"key": "explain.motion-contaminated", "params": {
                "measurement": first["id"], "n_contaminated": contaminated,
                "neighbour_g_mag": neighbour.get("g_mag"), "neighbour_arcsec": neighbour.get("arcsec")}})
        else:
            explanation.append({"key": "explain.motion-insufficient", "params": {"measurement": first["id"]}})
    explanation.append({"key": "explain.control", "params": {
        "n_stars": control.get("n_stars"), "fraction": control.get("fraction_within_95pct_region"),
        "passes": control.get("passes")}})
    block = {
        "visit_residuals": visit_residuals(main, measured_points),
        "reference": main.get("reference"),
        "floor": floor,
        "fit_parallax_fixed": _fit_summary(fixed) if fixed else None,
        "fit_linear": _fit_summary(linear),
        "fit_parallax_free": _fit_summary(free),
        "fit_visit_level": _fit_summary(visit_fit),
        "catalogue_agreement": agreement,
        "control": control,
        "per_exposure": per_exposure,
    }
    return block, measurements, explanation


def visit_level_fit(measured_points: list[dict], fit: dict, parallax_arcsec: float | None) -> dict:
    """Refit on one mean position per visit and array (errors from the scatter inside each group).

    Exposures of one visit share systematics, so this fit's scaled uncertainty is a
    conservative check on the exposure-level one.
    """
    reference = fit.get("reference")
    if not reference:
        return {"status": "insufficient_data", "reason_key": "measure.too-few-epochs"}
    groups = {}
    for row in measured_points:
        groups.setdefault((row["visit"], row["detector"]), []).append(row)
    points = []
    for members in groups.values():
        if len(members) < 2:
            continue
        offsets = np.array([astrometry.tangent_offsets_arcsec(reference["ra_deg"], reference["dec_deg"],
                                                              row["ra_deg"], row["dec_deg"]) for row in members])
        observer = np.mean([astrometry.observer_barycentric_au(row["mjd"], None) for row in members], axis=0)
        covariance = np.cov(offsets.T) / len(members) + np.eye(2) * 1e-6
        points.append(astrometry.Point(float(np.mean([row["mjd"] for row in members])), float(offsets[:, 0].mean()),
                                       float(offsets[:, 1].mean()), covariance, observer))
    result = astrometry.fit_motion(points, reference["ra_deg"], reference["dec_deg"], reference["mjd"], parallax_arcsec)
    return result


def visit_residuals(fit: dict, measured_points: list[dict]) -> list[dict]:
    """Mean fit residual per visit and array: a check for visit-level systematics."""
    residuals = fit.get("residuals_arcsec") or []
    groups = {}
    for row, residual in zip(measured_points, residuals):
        groups.setdefault((row["visit"], row["detector"]), []).append(residual)
    rows = []
    for (visit, detector), members in sorted(groups.items()):
        values = np.array(members)
        rows.append({"visit": visit, "detector": detector, "n": len(members),
                     "mean_east_arcsec": round(float(values[:, 0].mean()), 3),
                     "mean_north_arcsec": round(float(values[:, 1].mean()), 3),
                     "sem_arcsec": round(float(values.std(ddof=1) / np.sqrt(len(values))) if len(values) > 1 else 0.0, 3)})
    return rows


def parallax_from_spherex(fit: dict, star: dict) -> dict:
    """Parallax fitted from SPHEREx positions alone (exploratory), compared with the catalogue."""
    base = {"id": "m-parallax", "quantity": "parallax_arcsec", "content_type": "measured",
            "method": "native-psf-fit+wls, parallax free", "inputs": [], "exploratory": True,
            "limitation_keys": ["limit.gaussian-psf-model", "limit.few-visits-parallax"]}
    if fit.get("status") != "measured":
        return {**base, "status": "insufficient_data", "value": None, "sigma": None,
                "status_reason_key": fit.get("reason_key")}
    variance = np.array(fit["cov"])[4, 4] * max(1.0, fit["chi2_red"])
    value, sigma = fit["params"]["parallax_arcsec"], math.sqrt(variance)
    checks = {}
    if star.get("parallax") is not None:
        catalogue = star["parallax"] / 1000
        error = (star.get("parallax_error") or 0.0) / 1000
        z = (value - catalogue) / math.hypot(sigma, error)
        checks = {"catalogue_arcsec": round(catalogue, 5), "z": round(z, 2),
                  "consistent_with_catalogue": bool(abs(z) <= 1.959963984540054)}
    return {**base, "status": "measured", "value": round(value, 4), "sigma": round(sigma, 4),
            "n_points": fit["n_points"], "chi2_red": round(fit["chi2_red"], 3), "checks": checks}


def _fit_summary(fit: dict) -> dict:
    keep = ("status", "reason_key", "params", "cov", "chi2", "dof", "chi2_red", "n_points", "span_days",
            "parallax_fixed_arcsec", "parallax_fitted", "floor_arcsec")
    return {key: fit.get(key) for key in keep}


def measure_brightness(usable, star, comparisons, field=None):
    """Native aperture photometry at the catalogue position in every usable exposure.

    A brightness change is reported only through spectrally matched pairs.
    """
    points = {}
    for exposure in usable:
        mjd = inv.exposure_mid_mjd(exposure)
        ra, dec = inv.catalogue_position(star, mjd)
        result = native_aperture_photometry(exposure.product, ra, dec)
        contaminant = inv.nearest_contaminant(star, field, mjd)
        if contaminant and result["status"] == "measured":
            result = {**result, "status": "insufficient_data", "reason_key": "measure.contaminated",
                      "flux_ujy": None, "sigma_ujy": None}
        points[exposure.meta["obsKey"]] = {
            "obs_key": exposure.meta["obsKey"], "mjd": round(mjd, 6), "detector": exposure.meta["detector"],
            "status": result["status"], "reason_key": result["reason_key"],
            "flux_ujy": _r(result["flux_ujy"]), "sigma_ujy": _r(result["sigma_ujy"]),
            "flagged_in_aperture": result["flagged_in_aperture"], "contaminant": contaminant,
        }
    floor = repeatability_floor(usable, points)
    floor_fraction = floor["floor_fraction"] or 0.0
    controls = inv.isolated_control_stars(field or [], star, min_g=inv.CONTROL_MIN_G, max_g=17.0, limit=40)
    control_points = control_photometry(usable, controls, field or [])
    epochs_by_id = {}
    for exposure in usable:
        epochs_by_id.setdefault(inv.epoch_id(exposure.meta["visit"], exposure.meta["detector"]), []).append(exposure.meta["obsKey"])
    measurements = []
    for comparison in comparisons:
        pairs = comparison["brightness"]["pairs"]
        ratios = []
        for pair in pairs:
            a, b = points.get(pair["a"]), points.get(pair["b"])
            if a and b and a["status"] == b["status"] == "measured" and a["flux_ujy"] > 0 and b["flux_ujy"] > 0:
                ratio = b["flux_ujy"] / a["flux_ujy"]
                sigma = ratio * math.hypot(a["sigma_ujy"] / a["flux_ujy"], b["sigma_ujy"] / b["flux_ujy"])
                ratios.append((ratio, sigma, pair))
        if comparison["grade"] != "quantitative":
            continue
        mid = f"m-flux-{comparison['id'][2:]}"
        limits = ["limit.photometric-floor"]
        if not ratios:
            measurements.append({"id": mid, "quantity": "flux_ratio_b_over_a", "content_type": "measured",
                                 "status": "insufficient_data", "value": None, "sigma": None,
                                 "method": "native aperture photometry, matched pairs", "inputs": [comparison["a"], comparison["b"]],
                                 "comparison": comparison["id"], "status_reason_key": "measure.no-measured-matched-pair",
                                 "limitation_keys": limits})
            continue
        if floor["floor_fraction"] is None:
            measurements.append({"id": mid, "quantity": "flux_ratio_b_over_a", "content_type": "measured",
                                 "status": "insufficient_data", "value": None, "sigma": None,
                                 "method": "native aperture photometry, matched pairs", "inputs": [comparison["a"], comparison["b"]],
                                 "comparison": comparison["id"], "status_reason_key": "measure.repeatability-unknown",
                                 "limitation_keys": limits})
            continue
        weights = np.array([1 / sigma**2 for _, sigma, _ in ratios])
        values = np.array([ratio for ratio, _, _ in ratios])
        raw = float(np.sum(weights * values) / np.sum(weights))
        statistical = float(1 / math.sqrt(np.sum(weights)))
        control = control_ratio(epochs_by_id.get(comparison["a"], []), epochs_by_id.get(comparison["b"], []), control_points)
        if control["status"] != "measured":
            measurements.append({"id": mid, "quantity": "flux_ratio_b_over_a", "content_type": "measured",
                                 "status": "insufficient_data", "value": None, "sigma": None, "raw_ratio": round(raw, 4),
                                 "method": "native aperture photometry, matched pairs", "inputs": [comparison["a"], comparison["b"]],
                                 "comparison": comparison["id"], "status_reason_key": "measure.no-photometric-control",
                                 "control": control, "limitation_keys": limits})
            continue
        # Differential photometry: divide by the field stars' median ratio for the same dates.
        mean = raw / control["median_ratio"]
        # Floors are systematics: within-date repeatability and the field stars' cross-date scatter.
        sigma = mean * math.sqrt((statistical / raw) ** 2 + 2 * floor_fraction**2
                                 + control["scatter_fraction"] ** 2 + control["median_error_fraction"] ** 2)
        measurements.append({"id": mid, "quantity": "flux_ratio_b_over_a", "content_type": "measured",
                             "status": "measured", "value": round(mean, 4), "sigma": round(sigma, 4),
                             "sigma_statistical": round(mean * statistical / raw, 4), "raw_ratio": round(raw, 4),
                             "method": "native aperture photometry (12 arcsec, fractional pixels), matched pairs, "
                                       "divided by the median ratio of field stars measured the same way",
                             "inputs": [comparison["a"], comparison["b"]], "comparison": comparison["id"],
                             "n_pairs": len(ratios), "control": control,
                             "limitation_keys": limits + ["limit.differential-photometry"]})
    measured = [point for point in points.values() if point["status"] == "measured"]
    refusals = {}
    for point in points.values():
        if point["status"] != "measured":
            refusals[point["reason_key"]] = refusals.get(point["reason_key"], 0) + 1
    block = {"method": "native aperture 12 arcsec (fractional pixels), annulus 24-42 arcsec, ZODI removed, VARIANCE errors",
             "n_points": len(points), "n_measured": len(measured), "refused": refusals, "repeatability": floor,
             "points": sorted(points.values(), key=lambda item: (item["detector"], item["mjd"]))}
    return block, measurements


def control_photometry(usable, controls, field) -> dict:
    """Native photometry of isolated Gaia field stars in every usable exposure, with their responses."""
    measured = {}
    for exposure in usable:
        mjd = inv.exposure_mid_mjd(exposure)
        for control in controls:
            if inv.nearest_contaminant(control, field, mjd):
                continue
            ra, dec = inv.catalogue_position(control, mjd)
            result = native_aperture_photometry(exposure.product, ra, dec)
            if result["status"] != "measured" or result["flux_ujy"] <= 0:
                continue
            response = response_at(exposure.product, ra, dec, exposure.meta["detector"])
            measured[(control["source_id"], exposure.meta["obsKey"])] = (result["flux_ujy"], result["sigma_ujy"], response)
    return measured


def control_ratio(keys_a: list[str], keys_b: list[str], measured: dict) -> dict:
    """Median flux ratio (B/A) of field stars over the same two epochs, each star at matched wavelengths."""
    from backend import spectral

    stars = sorted({source for source, _ in measured})
    ratios = []
    for source in stars:
        best = None
        for key_a in keys_a:
            a = measured.get((source, key_a))
            if not a:
                continue
            for key_b in keys_b:
                b = measured.get((source, key_b))
                if not b:
                    continue
                grade = spectral.grade_pair(a[2], b[2], "flux")
                if grade.grade != spectral.QUANTITATIVE:
                    continue
                if best is None or grade.shift_um < best[0]:
                    best = (grade.shift_um, b[0] / a[0], math.hypot(a[1] / a[0], b[1] / b[0]))
        if best and best[2] < 0.2:
            ratios.append((best[1], best[2]))
    if len(ratios) < 3:
        return {"status": "insufficient_data", "n_stars": len(ratios)}
    values = np.array([ratio for ratio, _ in ratios])
    median = float(np.median(values))
    robust = 1.4826 * float(np.median(np.abs(values / median - 1)))
    expected = float(np.median([error for _, error in ratios]))
    scatter = math.sqrt(max(0.0, robust**2 - expected**2))
    return {"status": "measured", "n_stars": len(ratios), "median_ratio": round(median, 4),
            "median_error_fraction": round(1.2533 * robust / math.sqrt(len(ratios)), 4),
            "scatter_fraction": round(scatter, 4), "rms_fraction": round(robust, 4)}


def repeatability_floor(usable, points) -> dict:
    """Scatter of flux ratios between matched exposures of the SAME epoch (truth: 1.0).

    Whatever the VARIANCE errors do not explain is a per-exposure systematic floor
    (fraction of the flux), added to every brightness comparison.
    """
    from backend import spectral

    groups = {}
    for exposure in usable:
        groups.setdefault((exposure.meta["visit"], exposure.meta["detector"]), []).append(exposure)
    pulls, fractional = [], []
    for members in groups.values():
        for index, first in enumerate(members):
            for second in members[index + 1:]:
                a, b = points.get(first.meta["obsKey"]), points.get(second.meta["obsKey"])
                if not (a and b and a["status"] == b["status"] == "measured" and a["flux_ujy"] > 0 and b["flux_ujy"] > 0):
                    continue
                ra = first.meta.get("response") or {}
                rb = second.meta.get("response") or {}
                grade = spectral.grade_pair(
                    spectral.Response(first.meta["detector"], ra.get("centre_um", float("nan")), ra.get("width_um", float("nan"))),
                    spectral.Response(second.meta["detector"], rb.get("centre_um", float("nan")), rb.get("width_um", float("nan"))))
                if grade.grade != spectral.QUANTITATIVE:
                    continue
                ratio = b["flux_ujy"] / a["flux_ujy"]
                statistical = math.hypot(a["sigma_ujy"] / a["flux_ujy"], b["sigma_ujy"] / b["flux_ujy"])
                fractional.append(ratio - 1.0)
                pulls.append(statistical)
    if len(fractional) < 5:
        return {"floor_fraction": None, "n_pairs": len(fractional), "rms_fraction": None}
    values = np.array(fractional)
    robust = 1.4826 * float(np.median(np.abs(values - np.median(values))))
    expected = float(np.median(pulls))
    floor = math.sqrt(max(0.0, robust**2 - expected**2) / 2)
    return {"floor_fraction": round(floor, 4), "n_pairs": len(fractional), "rms_fraction": round(robust, 4),
            "median_statistical_fraction": round(expected, 4)}


def _r(value, digits=4):
    return None if value is None else round(float(value), digits)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("key")
    parser.add_argument("--out", default="static/data")
    parser.add_argument("--cached-only", action="store_true")
    args = parser.parse_args()
    print(json.dumps(build(args.key, Path(args.out), args.cached_only)), flush=True)
    sys.exit(0)
