"""Verify frozen trials against their evaluation data (Task A5, DATA-CONTRACT V1 §9, V5, V6).

Usage:
  python -m scripts.verify acquire-pluto          # evaluation cutouts centred on the FROZEN model
  python -m scripts.verify run <trial_id> [...]    # writes trials/<id>/verification.json (never overwritten)

Rules:
- A trial is verified only if its hash chain is intact, prediction.json is byte-identical to the
  file in the receipt's commit, and the model code still has the frozen hash. Otherwise: refused.
- The frozen model and baseline are re-evaluated (never refitted on evaluation data) at the actual
  times and observer positions of the identified evaluation exposures.
- Pluto: candidates are searched around the frozen model; every candidate is kept; static sources
  are rejected using other exposures of the visit; motion must be consistent across exposures.
  JPL Horizons is consulted only after the verdict and reported separately.
"""
import argparse
import hashlib
import json
import math
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from scipy.stats import chi2 as chi2_distribution

from backend import astrometry, config, orbit
from backend.astrometry import tangent_offsets_arcsec, tangent_to_sky
from scripts import predict

ROOT = predict.ROOT
DATA = predict.DATA
TRIALS_DIR = predict.TRIALS_DIR
CHI2_95_2D = predict.CHI2_95_2D
SEARCH_RADIUS_ARCSEC = 30.0  # candidate listing: wider than every frozen 95% region
MIN_IDENTIFIED = 3
STATIC_MOVE_ARCSEC = 30.0
STATIC_SNR = 5.0
CANDIDATE_SNR = 5.0
IDENTIFY_SNR = 10.0
MOTION_CONSISTENCY_P = 0.997
PLUTO_EVAL_DIR = "bodies/pluto-eval"


class VerifyRefused(RuntimeError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _r(value, digits=6):
    return None if value is None else round(float(value), digits)


# ------------------------------------------------------------------ integrity


def integrity_problems(trial_id: str, root: Path = TRIALS_DIR, git_root: Path = ROOT) -> list[str]:
    folder = root / trial_id
    problems = predict.check(trial_id, root)
    receipt_path = folder / "receipt.json"
    if not receipt_path.exists():
        return problems + ["no receipt"]
    receipt = json.loads(receipt_path.read_text())
    data = (folder / "prediction.json").read_bytes()
    if _sha(data) != receipt.get("prediction_sha256"):
        problems.append("prediction.json hash differs from the receipt")
    relative = (folder / "prediction.json").resolve().relative_to(git_root.resolve())
    committed = subprocess.run(["git", "show", f"{receipt.get('commit')}:{relative}"], cwd=git_root,
                               capture_output=True)
    if committed.returncode != 0 or committed.stdout != data:
        problems.append("prediction.json differs from the bytes in the receipt's commit")
    trial = json.loads((folder / "trial.json").read_text())
    if predict.model_code_sha256() != trial["model"]["code_sha256"]:
        problems.append("model code changed since the trial was frozen")
    return problems


def require_intact(trial_id: str, root: Path = TRIALS_DIR) -> None:
    problems = integrity_problems(trial_id, root)
    if problems:
        raise VerifyRefused(f"{trial_id}: refused: {problems}")


# ------------------------------------------------------------------ frozen model evaluation


def load(trial_id: str, root: Path = TRIALS_DIR):
    folder = root / trial_id
    trial, trial_bytes, training = predict.load_frozen(folder)
    prediction = json.loads((folder / "prediction.json").read_text())
    return trial, trial_bytes, training, prediction


def star_model_at(trial: dict, trial_bytes: bytes, points: list[dict], t: float) -> tuple[float, float, np.ndarray]:
    """The frozen star model and its C_pred at time t (same code and training data, other time)."""
    moved = json.loads(json.dumps(trial))
    moved["holdout"]["t_mjd"] = t
    document = predict._predict_star(moved, trial_bytes, points, "verification")
    model = document["model"]
    return model["ra_deg"], model["dec_deg"], np.array(model["cov_arcsec2"])


def baseline_at(points: list[dict], t: float) -> tuple[float, float, np.ndarray]:
    row = predict._baseline_linear(points, [t])[0][0]
    return row["ra_deg"], row["dec_deg"], np.array(row["cov_arcsec2"])


def orbit_solution(prediction: dict) -> dict:
    state = prediction["model_state"]
    return {"state": np.array(state["state_au_au_per_day"]), "t0": state["t0_mjd_utc"],
            "covariance": np.array(state["covariance"]), "chi2_red": 1.0}  # covariance is already scaled


def orbit_model_at(prediction: dict, t: float, observer: np.ndarray) -> tuple[float, float, np.ndarray]:
    sigma_sys = prediction["model_state"]["sigma_sys_arcsec"]
    result = orbit.predict(orbit_solution(prediction), t, observer, extra_sigma_arcsec=sigma_sys)
    return result["ra_deg"], result["dec_deg"], np.array(result["cov_arcsec2"])


# ------------------------------------------------------------------ scoring


def score(residuals: np.ndarray, fit_covs: np.ndarray, c_pred: np.ndarray) -> dict:
    """Mean residual, C_obs and D^2 exactly as frozen (trial.scoring)."""
    n = len(residuals)
    if n < MIN_IDENTIFIED:
        return {"status": "insufficient_data", "status_reason_key": "verify.fewer-than-3", "n": n}
    mean = residuals.mean(axis=0)
    sample = np.cov(residuals.T, ddof=1) / n
    floor = fit_covs.mean(axis=0) / n
    c_obs = sample if np.trace(sample) >= np.trace(floor) else floor
    total = c_pred + c_obs
    eigenvalues = np.linalg.eigvalsh(total)
    if not np.all(np.isfinite(total)) or eigenvalues.min() <= 0:
        return {"status": "invalid_comparison", "status_reason_key": "verify.singular-covariance", "n": n}
    d2 = float(mean @ np.linalg.inv(total) @ mean)
    return {"status": "hit" if d2 <= CHI2_95_2D else "miss", "status_reason_key": None, "n": n,
            "mean": mean, "c_obs": c_obs, "c_obs_basis": "sample" if c_obs is sample else "fit-floor",
            "d2": d2, "error_arcsec": float(math.hypot(*mean))}


def _cov(matrix) -> list:
    return [[round(float(value), 6) for value in row] for row in np.asarray(matrix, float)]


def residual_block(reference: tuple, c_pred: np.ndarray, scored: dict, t_mean: float) -> dict:
    return {"reference": {"ra_deg": _r(reference[0], 8), "dec_deg": _r(reference[1], 8), "t_mjd": _r(t_mean)},
            "c_pred_arcsec2": _cov(c_pred),
            "east_arcsec": _r(scored["mean"][0], 4), "north_arcsec": _r(scored["mean"][1], 4),
            "d2": _r(scored["d2"], 4), "error_arcsec": _r(scored["error_arcsec"], 4),
            "status": scored["status"], "c_obs_basis": scored["c_obs_basis"]}


# ------------------------------------------------------------------ stars (holdout visit measured in A3)


def star_observations(trial: dict) -> tuple[list[dict], dict]:
    """Holdout-visit positions from the A3 evidence file: the same pipeline as the training data."""
    data = (DATA / trial["target_key"] / "investigation.json").read_bytes()
    doc = json.loads(data)
    holdout = {item["obs_key"] for item in trial["holdout"]["obs"]}
    quality = {item["obs_key"]: item["quality"]["usable"] for item in doc["observations"]}
    rows, excluded = [], {}
    for row in doc["astrometry"]["per_exposure"]:
        if row["obs_key"] not in holdout:
            continue
        reason = None
        if not quality.get(row["obs_key"], False):
            reason = "exclude.quality-gate"
        elif row["status"] != "measured":
            reason = row.get("reason_key") or "exclude.not-measured"
        elif not row.get("identified"):
            reason = row.get("identification_reason_key") or "exclude.identification"
        if reason:
            excluded[reason] = excluded.get(reason, 0) + 1
        else:
            rows.append(row)
    return rows, {"path": f"{trial['target_key']}/investigation.json", "sha256": _sha(data), "excluded": excluded}


def verify_star(trial_id: str, root: Path = TRIALS_DIR) -> dict:
    trial, trial_bytes, training, prediction = load(trial_id, root)
    points = training["points"]
    rows, source = star_observations(trial)
    model_res, base_res, fit_covs, times = [], [], [], []
    for row in rows:
        t = row["mjd"]
        model = star_model_at(trial, trial_bytes, points, t)
        base = baseline_at(points, t)
        model_res.append(tangent_offsets_arcsec(model[0], model[1], row["ra_deg"], row["dec_deg"]))
        base_res.append(tangent_offsets_arcsec(base[0], base[1], row["ra_deg"], row["dec_deg"]))
        fit_covs.append(np.array(row["cov_arcsec2"]))
        times.append(t)
    return assemble(trial, prediction, rows, np.array(model_res), np.array(base_res), np.array(fit_covs), times,
                    lambda t: star_model_at(trial, trial_bytes, points, t), lambda t: baseline_at(points, t),
                    {"measurement_source": source, "identification": {"method_key": "ident.catalogue-gate"},
                     "image": star_image(trial, rows)})


def star_image(trial: dict, rows: list[dict]) -> dict | None:
    """The holdout visit's epoch preview (A3) for the array with the most identified exposures."""
    doc = json.loads((DATA / trial["target_key"] / "investigation.json").read_text())
    used = {row["obs_key"] for row in rows}
    epochs = [epoch for epoch in doc["epochs"] if epoch.get("visit") == trial["holdout"]["visit"]
              and epoch["assets"].get("preview")]
    if not epochs:
        return None
    best = max(epochs, key=lambda epoch: (len(used & set(epoch["obs_keys"])), epoch["detector"]))
    request = doc["request"]
    return {"path": best["assets"]["preview"], "content_type": "processed", "epoch_id": best["id"],
            "centre_ra_deg": request["ra_deg"], "centre_dec_deg": request["dec_deg"],
            "scale_arcsec_px": round(request["fov_deg"] * 3600 / 240, 6), "width_px": 240, "height_px": 240,
            "north_up": True, "east_left": True}


def pluto_image(identified: list[dict], key: str = "pluto") -> dict | None:
    """One identified evaluation exposure (highest S/N), as a 240 px preview with its geometry."""
    from scripts.build_investigation import preview_image

    if not identified:
        return None
    best = max(identified, key=lambda item: item["identified"]["snr"])
    stored = np.load(config.CACHE_DIR / Path(best["native"]).with_suffix(".npz"))
    pixels = np.where(stored["mask"] == 0, stored["pixels"], np.nan)
    finite = pixels[np.isfinite(pixels)]
    low, high = np.percentile(finite, [25, 99.8]) if finite.size else (0.0, 1.0)
    folder = DATA / key / "verification"
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{best['obs_key'].replace(':', '_')}.webp"
    preview_image(pixels, (float(low), float(max(high, low + 1e-6)))).save(folder / name, quality=85)
    grid = best["grid"]
    return {"path": f"{key}/verification/{name}", "content_type": "processed", "epoch_id": None,
            "obs_key": best["obs_key"], "centre_ra_deg": grid["ra"], "centre_dec_deg": grid["dec"],
            "scale_arcsec_px": round(grid["fov"] * 3600 / 240, 6), "width_px": 240, "height_px": 240,
            "north_up": True, "east_left": True}


def assemble(trial, prediction, rows, model_res, base_res, fit_covs, times, model_at, base_at, extra) -> dict:
    """verification.json from residuals; observed = model reference shifted by the mean residual."""
    base = {
        "schema_version": "tenger.verification/1", "contract_version": 6, "trial_id": trial["trial_id"],
        "prediction_sha256": _sha((TRIALS_DIR / trial["trial_id"] / "prediction.json").read_bytes()),
        "revealed_utc": _now(), "category": trial["category"], "labels": trial["labels"],
        **({"confirmation_pending": True} if trial.get("confirmation_pending") else {}),
    }
    if len(rows) < MIN_IDENTIFIED:
        return {**base, "observed": None, "residuals": None, "status": "insufficient_data",
                "status_reason_key": "verify.fewer-than-3", "n_identified": len(rows), **extra}
    t_mean = float(np.mean(times))
    model_ref = model_at(t_mean)
    base_ref = base_at(t_mean)
    model_scored = score(model_res, fit_covs, model_ref[2])
    base_scored = score(base_res, fit_covs, base_ref[2])
    if model_scored["status"] in ("insufficient_data", "invalid_comparison"):
        return {**base, "observed": None, "residuals": None, "status": model_scored["status"],
                "status_reason_key": model_scored["status_reason_key"], "n_identified": len(rows), **extra}
    observed_ra, observed_dec = tangent_to_sky(model_ref[0], model_ref[1], *model_scored["mean"])
    return {
        **base,
        "t_mjd": _r(t_mean),
        "observed": {"ra_deg": _r(observed_ra, 8), "dec_deg": _r(observed_dec, 8),
                     "cov_arcsec2": _cov(model_scored["c_obs"]), "obs_keys": [row["obs_key"] for row in rows],
                     "n_exposures": len(rows), "content_type": "measured", "image": extra.pop("image", None)},
        "residuals": {"model": residual_block(model_ref, model_ref[2], model_scored, t_mean),
                      "baseline": residual_block(base_ref, base_ref[2], base_scored, t_mean)},
        "per_exposure": [{"obs_key": row["obs_key"], "t_mjd": _r(t, 6),
                          "model_residual_arcsec": [_r(v, 4) for v in m],
                          "baseline_residual_arcsec": [_r(v, 4) for v in b]}
                         for row, t, m, b in zip(rows, times, model_res, base_res)],
        "status": model_scored["status"],
        "status_reason_key": None,
        **extra,
    }


# ------------------------------------------------------------------ Pluto: acquisition and recovery


def pluto_evaluation_rows(trial: dict) -> list[dict]:
    """Evaluation rows: IDs, times and file URLs only (the listing's positions are never read)."""
    inventory = json.loads((ROOT / "docs" / "exposure" / "pluto.json").read_text())
    wanted = {item["obs_key"] for item in trial["holdout"]["obs"]}
    rows = []
    for row in inventory["candidate_rows"]:
        key = f"{row['collection']}:{row['obs_id']}:D{row['detector']}"
        if key in wanted:
            rows.append({"obs_key": key, "obs_id": row["obs_id"], "detector": row["detector"],
                         "collection": row["collection"], "t_min_mjd": row["t_min_mjd"], "t_max_mjd": row["t_max_mjd"],
                         "em_min_um": row["em_min_um"], "em_max_um": row["em_max_um"],
                         "url": row["access_url_not_opened"]})
    return sorted(rows, key=lambda item: (item["t_min_mjd"], item["detector"]))


def acquire_pluto(trial_id: str = "pluto-position-2026b") -> dict:
    """Download the evaluation cutouts centred on the frozen model position (geocentric, for centring only)."""
    from concurrent.futures import ThreadPoolExecutor

    import httpx

    from backend import archive
    from backend.processing import Grid, display_native, load_product, reproject, trim_product

    require_intact(trial_id)
    trial, _, _, prediction = load(trial_id)
    folder = config.CACHE_DIR / PLUTO_EVAL_DIR
    folder.mkdir(parents=True, exist_ok=True)
    rows = pluto_evaluation_rows(trial)

    def one(client, row):
        target = folder / f"{row['obs_key'].replace(':', '__')}.json"
        if target.exists():
            return json.loads(target.read_text())
        ra, dec, _ = orbit_model_at(prediction, row["t_min_mjd"], orbit.observer_heliocentric_au(row["t_min_mjd"], None))
        exposure = archive.Exposure(row["obs_id"], row["detector"], row["t_min_mjd"], row["em_min_um"],
                                    row["em_max_um"], row["url"], row["collection"], mjd_end=row["t_max_mjd"],
                                    processing=archive.parse_processing(row["url"]))
        size = 0.05 * config.CUTOUT_MARGIN
        payload = archive.fetch_cutout(client, exposure, ra, dec, size)
        sha = _sha(payload)
        product = load_product(payload)
        native_path = folder / f"{row['obs_key'].replace(':', '__')}.fits"
        native_path.write_bytes(trim_product(payload, sha))
        grid = Grid.for_fov(ra, dec, 0.05)
        pixels, mask = reproject(display_native(product), grid)
        np.savez_compressed(native_path.with_suffix(".npz"), pixels=pixels, mask=mask)
        meta = {**row, "centre": {"ra_deg": ra, "dec_deg": dec, "source": "frozen model (geocentric)"},
                "cutout_url": archive.cutout_url(exposure, ra, dec, size), "sha256": sha, "bytes": len(payload),
                "native": str(native_path.relative_to(config.CACHE_DIR)), "l2dqa": product.info.get("L2DQAFLG"),
                "grid": {"ra": grid.ra, "dec": grid.dec, "fov": grid.fov, "n": grid.n, "scale": grid.scale}}
        target.write_text(json.dumps(meta))
        return meta

    with httpx.Client(timeout=config.HTTP_TIMEOUT_SECONDS, follow_redirects=True) as client:
        with ThreadPoolExecutor(4) as pool:
            results = list(pool.map(lambda row: one(client, row), rows))
    return {"rows": len(rows), "acquired": len(results)}


def local_peaks(product, ra: float, dec: float, radius_arcsec: float) -> list[tuple[float, float, float]]:
    """Sky positions of local maxima with S/N >= CANDIDATE_SNR within the radius (unflagged pixels)."""
    from scipy.ndimage import maximum_filter

    snr = (product.image.astype(float) - product.zodi.astype(float)) / np.sqrt(np.maximum(product.variance.astype(float), 1e-30))
    snr = np.where(product.reject | ~np.isfinite(snr), -np.inf, snr)
    x0, y0 = (float(v) for v in product.wcs.all_world2pix(ra, dec, 0))
    scale = astrometry.pixel_scale_arcsec(product, x0, y0)
    rows, cols = np.mgrid[:snr.shape[0], :snr.shape[1]]
    inside = np.hypot(cols - x0, rows - y0) * scale <= radius_arcsec
    peaks = (snr == maximum_filter(snr, size=3)) & inside & (snr >= CANDIDATE_SNR)
    found = []
    for row, col in zip(*np.nonzero(peaks)):
        sky_ra, sky_dec = (float(v) for v in product.wcs.all_pix2world(col, row, 0))
        found.append((sky_ra, sky_dec, float(snr[row, col])))
    return sorted(found, key=lambda item: -item[2])


def candidates_for(product, model_ra: float, model_dec: float, fwhm: float | None) -> list[dict]:
    """Every peak (S/N >= 5) near the model, with its fit; failed fits are kept as alternatives."""
    out = []
    for ra, dec, peak in local_peaks(product, model_ra, model_dec, SEARCH_RADIUS_ARCSEC):
        position = astrometry.fit_position(product, ra, dec, fwhm)
        fitted = position.status == "measured"
        sky_ra, sky_dec = (position.ra_deg, position.dec_deg) if fitted else (ra, dec)
        east, north = tangent_offsets_arcsec(model_ra, model_dec, sky_ra, sky_dec)
        if any(math.hypot(east - item["east_arcsec"], north - item["north_arcsec"]) < 3.0 for item in out):
            continue
        out.append({"ra_deg": sky_ra, "dec_deg": sky_dec, "cov_arcsec2": position.cov_arcsec2 if fitted else None,
                    "snr": position.snr if fitted else 0.0, "fit_status": position.status,
                    "fit_reason_key": position.reason_key, "peak_snr": peak, "east_arcsec": east,
                    "north_arcsec": north, "distance_arcsec": math.hypot(east, north)})
    return out


def static_probe(candidate: dict, item: dict, others: list[dict]) -> dict:
    """Is the candidate's sky position occupied in another exposure of the same array, when the model is far?"""
    for other in others:
        if other is item or other["detector"] != item["detector"]:
            continue
        east, north = tangent_offsets_arcsec(other["model"][0], other["model"][1], candidate["ra_deg"], candidate["dec_deg"])
        if math.hypot(east, north) < STATIC_MOVE_ARCSEC:
            continue
        probe = astrometry.fit_position(other["product"], candidate["ra_deg"], candidate["dec_deg"],
                                        other["product"].info.get("PSF_FWHM"))
        if probe.reason_key == "measure.outside-cutout":
            continue
        return {"checked_against": other["obs_key"], "static_source": bool(probe.status == "measured"
                                                                           and (probe.snr or 0) >= STATIC_SNR),
                "probe_snr": _r(probe.snr, 2)}
    return {"checked_against": None, "static_source": None, "probe_snr": None}


def recover(items: list[dict], search_radius: float) -> dict:
    """Apply the pre-registered identification to every exposure; keep every candidate."""
    for item in items:
        product = item["product"]
        item["candidates"] = candidates_for(product, item["model"][0], item["model"][1], product.info.get("PSF_FWHM"))
        for candidate in item["candidates"]:
            fitted = candidate["fit_status"] == "measured"
            candidate["static_check"] = static_probe(candidate, item, items) if fitted else {
                "checked_against": None, "static_source": None, "probe_snr": None}
            candidate["passes"] = bool(fitted and candidate["snr"] >= IDENTIFY_SNR
                                       and candidate["distance_arcsec"] <= search_radius
                                       and candidate["static_check"]["static_source"] is False)
        passing = [candidate for candidate in item["candidates"] if candidate["passes"]]
        item["identification"] = ("ambiguous" if len(passing) > 1 else "identified" if passing else "none")
        item["identified"] = passing[0] if len(passing) == 1 else None
    identified = [item for item in items if item["identification"] == "identified"]
    ambiguous = [item for item in items if item["identification"] == "ambiguous"]
    motion = motion_consistency(identified)
    status = None
    if ambiguous:
        status = ("ambiguous", "verify.multiple-candidates")
    elif len(identified) < MIN_IDENTIFIED:
        status = ("insufficient_data", "verify.fewer-than-3")
    elif motion["consistent"] is False:
        status = ("ambiguous", "verify.motion-inconsistent")
    return {"identified": identified, "ambiguous": ambiguous, "motion": motion, "status": status}


def motion_consistency(identified: list[dict]) -> dict:
    """The identified positions must share one offset from the moving model (a static star would not)."""
    if len(identified) < 2:
        return {"consistent": None, "chi2": None, "dof": None}
    offsets = np.array([[item["identified"]["east_arcsec"], item["identified"]["north_arcsec"]] for item in identified])
    covs = [np.array(item["identified"]["cov_arcsec2"]) + np.eye(2) * 0.3**2 for item in identified]
    mean = offsets.mean(axis=0)
    chi2 = float(sum((offset - mean) @ np.linalg.inv(cov) @ (offset - mean) for offset, cov in zip(offsets, covs)))
    dof = 2 * (len(identified) - 1)
    limit = float(chi2_distribution.ppf(MOTION_CONSISTENCY_P, dof))
    return {"consistent": bool(chi2 <= limit), "chi2": _r(chi2, 3), "dof": dof, "limit": _r(limit, 3),
            "spread_arcsec": [_r(v, 3) for v in offsets.std(axis=0)], "systematic_allowance_arcsec": 0.3}


def load_pluto_items(prediction: dict) -> list[dict]:
    from backend.processing import load_product

    folder = config.CACHE_DIR / PLUTO_EVAL_DIR
    items = []
    for path in sorted(folder.glob("*.json")):
        meta = json.loads(path.read_text())
        product = load_product((config.CACHE_DIR / meta["native"]).read_bytes())
        t = float(product.info.get("MJD-AVG", meta["t_min_mjd"]))
        spacecraft = [product.info.get(axis) for axis in ("X_SC", "Y_SC", "Z_SC")]
        observer = orbit.observer_heliocentric_au(t, None if None in spacecraft else spacecraft)
        items.append({**meta, "product": product, "t": t, "observer": observer,
                      "model": orbit_model_at(prediction, t, observer), "quality_ok": meta["l2dqa"] in (None, "Pass")})
    return sorted(items, key=lambda item: (item["t"], item["detector"]))


def verify_pluto(trial_id: str = "pluto-position-2026b") -> dict:
    trial, _, training, prediction = load(trial_id)
    points = training["points"]
    items = [item for item in load_pluto_items(prediction) if item["quality_ok"]]
    c_pred_max = math.sqrt(np.linalg.eigvalsh(np.array(prediction["model"]["cov_arcsec2"])).max())
    search_radius = max(15.0, 3 * c_pred_max)  # frozen rule (trial.identification)
    recovery = recover(items, search_radius)
    candidates_record = [{
        "obs_key": item["obs_key"], "t_mjd": _r(item["t"]), "detector": item["detector"],
        "model": {"ra_deg": _r(item["model"][0], 8), "dec_deg": _r(item["model"][1], 8)},
        "identification": item["identification"],
        "candidates": [{"ra_deg": _r(c["ra_deg"], 8), "dec_deg": _r(c["dec_deg"], 8), "snr": _r(c["snr"], 2),
                        "peak_snr": _r(c["peak_snr"], 2), "fit_status": c["fit_status"],
                        "fit_reason_key": c["fit_reason_key"],
                        "offset_east_arcsec": _r(c["east_arcsec"], 3), "offset_north_arcsec": _r(c["north_arcsec"], 3),
                        "distance_arcsec": _r(c["distance_arcsec"], 3), "static_check": c["static_check"],
                        "passes": c["passes"]} for c in item["candidates"]],
        "source_sha256": item["sha256"], "cutout_url": item["cutout_url"],
    } for item in items]
    extra = {"identification": {"method_key": "ident.frozen-model-search", "search_radius_arcsec": _r(search_radius, 3),
                                "listing_radius_arcsec": SEARCH_RADIUS_ARCSEC, "min_snr": IDENTIFY_SNR,
                                "static_snr": STATIC_SNR, "static_move_arcsec": STATIC_MOVE_ARCSEC,
                                "motion": recovery["motion"],
                                "added_at_verification": ["motion consistency across exposures (A5 task instruction)"],
                                "n_exposures_searched": len(items),
                                "n_identified": len(recovery["identified"]), "n_ambiguous": len(recovery["ambiguous"])},
             "candidates": candidates_record,
             "exposure_note": "a teammate saw the evaluation visit's archive listing (metadata that may include "
                              "JPL-predicted positions) but no pixels; the forecast did not use it (docs/EXPOSURE.md)"}
    identified = recovery["identified"]
    if recovery["status"]:
        status, reason = recovery["status"]
        return {"schema_version": "tenger.verification/1", "contract_version": 6, "trial_id": trial_id,
                "prediction_sha256": _sha((TRIALS_DIR / trial_id / "prediction.json").read_bytes()),
                "revealed_utc": _now(), "category": trial["category"], "labels": trial["labels"],
                "confirmation_pending": True, "observed": None, "residuals": None,
                "status": status, "status_reason_key": reason, **extra}
    model_res, base_res, fit_covs, times = [], [], [], []
    for item in identified:
        found = item["identified"]
        base = baseline_at(points, item["t"])
        model_res.append(tangent_offsets_arcsec(item["model"][0], item["model"][1], found["ra_deg"], found["dec_deg"]))
        base_res.append(tangent_offsets_arcsec(base[0], base[1], found["ra_deg"], found["dec_deg"]))
        fit_covs.append(np.array(found["cov_arcsec2"]))
        times.append(item["t"])
    mean_observer = np.mean([item["observer"] for item in identified], axis=0)
    rows = [{"obs_key": item["obs_key"]} for item in identified]
    extra["image"] = pluto_image(identified)
    return assemble(trial, prediction, rows, np.array(model_res), np.array(base_res), np.array(fit_covs), times,
                    lambda t: orbit_model_at(prediction, t, mean_observer), lambda t: baseline_at(points, t), extra)


# ------------------------------------------------------------------ after the verdict: Horizons


def horizons_comparison(verification: dict, prediction: dict) -> dict:
    """JPL Horizons (geocentric, corrected to the spacecraft) vs observed and vs the frozen model."""
    import httpx

    from backend.processing import load_product

    folder = config.CACHE_DIR / PLUTO_EVAL_DIR
    rows = []
    for key in verification["observed"]["obs_keys"]:
        meta = json.loads((folder / f"{key.replace(':', '__')}.json").read_text())
        product = load_product((config.CACHE_DIR / meta["native"]).read_bytes())
        t = float(product.info.get("MJD-AVG", meta["t_min_mjd"]))
        spacecraft = np.array([product.info["X_SC"], product.info["Y_SC"], product.info["Z_SC"]], float)
        rows.append((key, t, spacecraft))
    params = {"format": "json", "COMMAND": "'999'", "EPHEM_TYPE": "OBSERVER", "CENTER": "'500@399'",
              "TLIST": " ".join(f"'{t + 2400000.5:.8f}'" for _, t, _ in rows), "TIME_TYPE": "UT",
              "QUANTITIES": "'1,20'", "ANG_FORMAT": "DEG", "EXTRA_PREC": "YES", "CSV_FORMAT": "YES"}
    response = httpx.get("https://ssd.jpl.nasa.gov/api/horizons.api", params=params, timeout=120)
    response.raise_for_status()
    result = response.json()["result"]
    header_block, body = result.split("$$SOE")
    header = [name.strip() for name in header_block.strip().splitlines()[-2].split(",")]
    columns = {name: index for index, name in enumerate(header)}
    ra_col = next(index for name, index in columns.items() if name.startswith("R.A."))
    dec_col = next(index for name, index in columns.items() if name.startswith("DEC"))
    delta_col = columns["delta"]
    lines = [line for line in body.split("$$EOE")[0].strip().splitlines() if line.strip()]
    per = []
    for (key, t, spacecraft), line in zip(rows, lines):
        fields = [field.strip() for field in line.split(",")]
        ra, dec, delta = float(fields[ra_col]), float(fields[dec_col]), float(fields[delta_col])
        a, d = math.radians(ra), math.radians(dec)
        east_vec = np.array([-math.sin(a), math.cos(a), 0.0])
        north_vec = np.array([-math.sin(d) * math.cos(a), -math.sin(d) * math.sin(a), math.cos(d)])
        s_au = spacecraft / orbit.KM_PER_AU
        shift = (-float(s_au @ east_vec) / delta * orbit.ARCSEC_PER_RAD, -float(s_au @ north_vec) / delta * orbit.ARCSEC_PER_RAD)
        ra_sc, dec_sc = tangent_to_sky(ra, dec, *shift)
        per.append({"obs_key": key, "t_mjd": _r(t), "horizons_ra_deg": _r(ra_sc, 8), "horizons_dec_deg": _r(dec_sc, 8)})
    reference = verification["residuals"]["model"]["reference"]
    t_mean = reference["t_mjd"]
    h_ra = float(np.mean([row["horizons_ra_deg"] for row in per]))
    h_dec = float(np.mean([row["horizons_dec_deg"] for row in per]))
    observed = verification["observed"]
    model_minus_h = tangent_offsets_arcsec(h_ra, h_dec, reference["ra_deg"], reference["dec_deg"])
    observed_minus_h = tangent_offsets_arcsec(h_ra, h_dec, observed["ra_deg"], observed["dec_deg"])
    return {"source": "JPL Horizons API, COMMAND 999 (Pluto), geocentric astrometric RA/Dec, moved to the "
                      "spacecraft with the FITS header position and Horizons delta",
            "queried_utc": _now(), "after_verdict": True, "t_mjd": _r(t_mean),
            "frozen_model_minus_horizons_arcsec": [_r(v, 3) for v in model_minus_h],
            "observed_minus_horizons_arcsec": [_r(v, 3) for v in observed_minus_h],
            "note": "reported separately; it does not change the status",
            "per_exposure": per}


def _is_number(text: str) -> bool:
    try:
        float(text)
        return True
    except ValueError:
        return False


# ------------------------------------------------------------------ main


def write(trial_id: str, document: dict, root: Path = TRIALS_DIR) -> Path:
    path = root / trial_id / "verification.json"
    if path.exists():
        raise VerifyRefused(f"{trial_id}: verification.json already exists and is never rewritten")
    path.write_bytes(predict.json_bytes(document))
    return path


def run(trial_id: str) -> dict:
    require_intact(trial_id)
    _, _, _, prediction = load(trial_id)
    if prediction.get("prediction_status") != "predicted":
        raise VerifyRefused(f"{trial_id}: frozen as {prediction.get('prediction_status')}; nothing to verify")
    if trial_id.startswith("pluto-"):
        document = verify_pluto(trial_id)
        if document.get("observed"):
            try:
                document["after_verdict_comparison"] = horizons_comparison(document, prediction)
            except Exception as error:  # noqa: BLE001 - the comparison never changes the verdict
                document["after_verdict_comparison"] = {"status": "unavailable", "error": str(error)[:200]}
    else:
        document = verify_star(trial_id)
    return document


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["acquire-pluto", "run", "dry-run"])
    parser.add_argument("trial_ids", nargs="*")
    args = parser.parse_args(argv)
    if args.action == "acquire-pluto":
        print(acquire_pluto())
        return 0
    for trial_id in args.trial_ids:
        document = run(trial_id)
        if args.action == "run":
            print(write(trial_id, document))
        print(trial_id, document["status"], document.get("status_reason_key"),
              (document.get("residuals") or {}).get("model", {}).get("d2"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
