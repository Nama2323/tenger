"""Task A9: a pre-registered batch of blind asteroid forecasts (rules: docs/asteroid-batch.md).

    python -m scripts.asteroids select

Integrity rule (docs/EXPOSURE.md, "A9 rule for MOST"): MOST returns JPL-predicted positions for every
exposure, including the evaluation visit. Only training rows keep their positions. Every
evaluation-visit row is reduced in memory, before anything is printed, logged or saved, to
EVAL_KEEP (exposure identifiers, times and the in-footprint flag). The evaluation-time star check runs
on the in-memory positions and keeps only pass/fail. Raw MOST tables are saved only after the freeze
push (`python -m scripts.asteroids save-raw`).
"""
import json
import math
import re
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

from backend import config

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "exposure" / "asteroids"
WORK = config.CACHE_DIR / "asteroids"

SBDB_URL = "https://ssd-api.jpl.nasa.gov/sbdb_query.api"
MOST_URL = "https://irsa.ipac.caltech.edu/cgi-bin/MOST/nph-most"
VIZIER_CFA = "https://vizier.cfa.harvard.edu/viz-bin/asu-tsv"
OBS_BEGIN, OBS_END = "2025-04-01", "2026-11-15"
H_RANGE = (9.0, 11.0)
VISIT_GAP_DAYS = 30.0
MIN_VISITS = 3
TRAINING_V_RANGE = (11.5, 16.0)  # median MOST V of every TRAINING visit (evaluation magnitudes are never read)
EVAL_WINDOW_DAYS = 1.0
MAX_EVAL_EXPOSURES = 10
MIN_EVAL_EXPOSURES = 4
STAR_RADIUS_ARCSEC = 15.0
STAR_G_MAX = 18.0
STAR_W1_MAX = 15.0
N_SELECT = 8
EXCLUDED = {
    "1000": "its full-period MOST table (all visits, with positions) was fetched into scratch files during "
            "the A9 feasibility check, 15 Nov 2026 02:34 UB, before this rule existed; files deleted",
}
RELEASES = ("/dr1/", "/qr3/")
EVAL_KEEP = ("observationid", "productid", "uri", "mjd_start", "mjd_end", "match")


class Suppressed(RuntimeError):
    """A network error whose message (it could contain coordinates) is withheld."""


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=1) + "\n")


# ---------------------------------------------------------------- pool (SBDB)


def pool() -> list[dict]:
    """Numbered main-belt asteroids (JPL class MBA) with H in H_RANGE, brightest H first, then number."""
    params = {"fields": "spkid,full_name,pdes,H,class", "sb-kind": "a", "sb-ns": "n", "sb-class": "MBA",
              "sb-cdata": json.dumps({"AND": [f"H|RG|{H_RANGE[0]}|{H_RANGE[1]}"]})}
    response = httpx.get(SBDB_URL, params=params, timeout=120)
    response.raise_for_status()
    data = response.json()
    rows = [{"number": row[2], "name": row[1].strip(), "H": float(row[3]), "class": row[4]} for row in data["data"]
            if row[3] is not None]
    return sorted(rows, key=lambda r: (r["H"], int(r["number"])))


# ---------------------------------------------------------------- MOST (in memory only)


def _parse_ipac(text: str) -> list[dict]:
    lines = text.splitlines()
    header = next(line for line in lines if line.startswith("|"))
    names = [name.strip() for name in header.split("|")[1:-1]]
    bars = [i for i, char in enumerate(header) if char == "|"]
    rows = []
    for line in lines:
        if not line.strip() or line.startswith("\\") or line.startswith("|"):
            continue
        rows.append({names[k]: line[bars[k] + 1:bars[k + 1] + 1].strip() for k in range(len(names))})
    return rows


def most_rows(number: str) -> list[dict]:
    """Every SPHEREx image whose footprint contains the object (MOST), parsed in memory and never saved."""
    params = {"catalog": "spherex", "input_type": "name_input", "obj_name": number, "obs_begin": OBS_BEGIN,
              "obs_end": OBS_END, "output_mode": "Brief"}
    for attempt in range(3):
        try:
            with httpx.Client(timeout=300) as client:
                page = client.get(MOST_URL, params=params).text
                match = re.search(r'output_url = "([^"]+)"', page)
                if not match:
                    raise Suppressed("MOST gave no output_url")
                table = client.get(match.group(1) + "/imgframes_matched_final_table.tbl")
                table.raise_for_status()
            return _parse_ipac(table.text)
        except (httpx.HTTPError, Suppressed):
            if attempt == 2:
                raise Suppressed(f"MOST failed for {number}") from None
            time.sleep(10 * (attempt + 1))
    return []


def clusters(rows: list[dict]) -> list[list[dict]]:
    ordered = sorted(rows, key=lambda r: float(r["mjd_start"]))
    out: list[list[dict]] = []
    for row in ordered:
        if out and float(row["mjd_start"]) - float(out[-1][-1]["mjd_start"]) > VISIT_GAP_DAYS:
            out.append([row])
        elif out:
            out[-1].append(row)
        else:
            out.append([row])
    return out


def dedupe(rows: list[dict]) -> list[dict]:
    """One row per exposure and detector; DR1 preferred over QR3 (the project's release priority)."""
    best: dict = {}
    for row in rows:
        key = (row.get("observationid"), row.get("productid"))
        rank = 0 if "/dr1/" in (row.get("uri") or "") else 1
        if key not in best or rank < best[key][0]:
            best[key] = (rank, row)
    return [row for _, row in best.values()]


def sanitize(row: dict) -> dict:
    return {key: row.get(key) for key in EVAL_KEEP}


def _cone_count(source: str, columns: str, column_max: tuple[int, float], ra: float, dec: float) -> int:
    params = {"-source": source, "-c": f"{ra:.6f} {dec:+.6f}", "-c.rs": f"{STAR_RADIUS_ARCSEC:.1f}",
              "-out": columns, "-out.max": "unlimited"}
    for attempt in range(3):
        try:
            response = httpx.get(VIZIER_CFA, params=params, timeout=60)
            response.raise_for_status()
            break
        except httpx.HTTPError:
            if attempt == 2:
                raise Suppressed("catalogue check failed (details withheld)") from None
            time.sleep(3 * (attempt + 1))
    rows = [line.split("\t") for line in response.text.splitlines() if line and not line.startswith("#")][3:]
    index, limit = column_max
    count = 0
    for row in rows:
        try:
            if float(row[index]) < limit:
                count += 1
        except (ValueError, IndexError):
            continue
    return count


def star_free(ra: float, dec: float) -> bool:
    """True when no Gaia DR3 source (G < 18) and no AllWISE source (W1 < 15) lies within 15 arcsec."""
    gaia = _cone_count("I/355/gaiadr3", "RA_ICRS,DE_ICRS,Gmag", (2, STAR_G_MAX), ra, dec)
    if gaia:
        return False
    return _cone_count("II/328/allwise", "RAJ2000,DEJ2000,W1mag", (2, STAR_W1_MAX), ra, dec) == 0


def evaluation_window(rows: list[dict]) -> list[dict]:
    """The EVAL_WINDOW_DAYS interval (starting at an exposure) holding the most rows; ties: earliest. Times only."""
    times = sorted(float(r["mjd_start"]) for r in rows)
    best = max(range(len(times)), key=lambda i: (sum(1 for t in times if times[i] <= t < times[i] + EVAL_WINDOW_DAYS), -i))
    start = times[best]
    return sorted([r for r in rows if start <= float(r["mjd_start"]) < start + EVAL_WINDOW_DAYS],
                  key=lambda r: float(r["mjd_start"]))


def evenly(items: list, count: int) -> list:
    if len(items) <= count:
        return list(items)
    step = (len(items) - 1) / (count - 1)
    return [items[round(i * step)] for i in range(count)]


def examine(candidate: dict) -> dict:
    """Apply the selection rule to one candidate. Evaluation positions never leave this function."""
    record = {**candidate, "passes": False, "reason": None}
    if candidate["number"] in EXCLUDED:
        return {**record, "reason": "excluded: " + EXCLUDED[candidate["number"]]}
    try:
        listed = most_rows(candidate["number"])
    except Suppressed:
        return {**record, "reason": "network failure at MOST (details withheld); not examined"}
    rows = dedupe([r for r in listed if r.get("match") == "1" and any(tag in (r.get("uri") or "") for tag in RELEASES)])
    del listed
    visits = clusters(rows) if rows else []
    record["n_visits"] = len(visits)
    if len(visits) < MIN_VISITS:
        return {**record, "reason": f"fewer than {MIN_VISITS} visits"}
    training, evaluation = visits[:-1], visits[-1]
    evaluation_public = [sanitize(r) for r in evaluation]  # from here on only these are kept
    window = evaluation_window(evaluation)
    clean_flags = {}
    try:
        for row in window:  # blind star check: positions used in memory, only a boolean kept
            clean_flags[(row["observationid"], row["productid"])] = star_free(float(row["ra_obj"]), float(row["dec_obj"]))
    except Suppressed:
        return {**record, "reason": "network failure at the star check (details withheld); not examined"}
    finally:
        del evaluation, window
    medians = [statistics.median(float(r["vmag"]) for r in visit) for visit in training]
    record["training_visits"] = [{"first_mjd": round(float(v[0]["mjd_start"]), 5),
                                  "last_mjd": round(float(v[-1]["mjd_start"]), 5), "exposures": len(v),
                                  "median_v": round(m, 2)} for v, m in zip(training, medians)]
    window_public = evaluation_window(evaluation_public)
    clean = [r for r in window_public if clean_flags[(r["observationid"], r["productid"])]]
    chosen = evenly(clean, MAX_EVAL_EXPOSURES)
    record["evaluation_visit"] = {
        "first_mjd": round(float(evaluation_public[0]["mjd_start"]), 5),
        "last_mjd": round(float(evaluation_public[-1]["mjd_start"]), 5),
        "exposures": len(evaluation_public),
        "window_exposures": len(window_public), "window_star_free": len(clean),
        "chosen": [{**r, "star_check": "pass"} for r in chosen],
        "star_check_note": "computed blind: positions were used only in memory; only pass/fail is kept",
    }
    if not all(TRAINING_V_RANGE[0] <= m <= TRAINING_V_RANGE[1] for m in medians):
        return {**record, "reason": "a training visit's median V is outside 11.5-16.0"}
    if len(chosen) < MIN_EVAL_EXPOSURES:
        return {**record, "reason": f"fewer than {MIN_EVAL_EXPOSURES} star-free evaluation exposures"}
    record["training_rows"] = [{k: r[k] for k in ("observationid", "productid", "uri", "mjd_start", "mjd_end",
                                                  "ra_obj", "dec_obj", "vmag", "geo_dist", "sun_dist")}
                               for visit in training for r in visit]
    return {**record, "passes": True}


def select() -> dict:
    candidates = pool()
    examined, chosen = [], []
    batch = 4
    for start in range(0, len(candidates), batch):
        group = candidates[start:start + batch]
        with ThreadPoolExecutor(max_workers=batch) as executor:
            results = list(executor.map(examine, group))
        for result in results:  # kept in H order whatever finished first
            examined.append(result)
            if result["passes"] and len(chosen) < N_SELECT:
                chosen.append(result["number"])
            print(f"{result['number']:>6} H={result['H']:.2f} passes={result['passes']} {result['reason'] or ''}",
                  flush=True)
        if len(chosen) >= N_SELECT:
            break
    public = [{k: v for k, v in r.items() if k != "training_rows"} for r in examined]
    selection = {"rule": "docs/asteroid-batch.md (selection)", "pool_size": len(candidates),
                 "examined": public, "selected": chosen, "generated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    write_json(OUT / "selection.json", selection)
    for result in examined:
        if result["number"] in chosen:
            write_json(OUT / f"training-{result['number']}.json",
                       {"number": result["number"], "name": result["name"], "rows": result["training_rows"]})
    return selection


# ---------------------------------------------------------------- training (MOST positions: training rows only)

TRAIN_SIZE_DEG = 0.03
IDENTIFY_ARCSEC = 3.0
BLEND_ARCSEC = 12.0
MIN_POINTS_PER_VISIT = 5
DOWNLOAD_WORKERS = 8


def cutout_url(uri: str, ra: float, dec: float, size: float) -> str:
    return f"https://irsa.ipac.caltech.edu/{uri}?center={ra:.6f},{dec:.6f}&size={size}"


def fetch_cutout(url: str, path: Path) -> dict:
    """Download once; keep the trimmed product (EPSF removed) and the original's SHA-256."""
    import hashlib

    from backend.processing import trim_product

    meta_path = path.with_suffix(".json")
    if meta_path.exists() and path.exists():
        return json.loads(meta_path.read_text())
    for attempt in range(4):
        try:
            response = httpx.get(url, timeout=240, follow_redirects=True)
            response.raise_for_status()
            break
        except httpx.HTTPError:
            if attempt == 3:
                return {"url": url, "status": "download-failed"}
            time.sleep(8 * (attempt + 1))
    payload = response.content
    digest = hashlib.sha256(payload).hexdigest()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(trim_product(payload, digest))
    meta = {"url": url, "status": "ok", "source_sha256": digest, "source_bytes": len(payload),
            "downloaded_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    meta_path.write_text(json.dumps(meta))
    return meta


def training_visits(record: dict) -> list[tuple[float, float]]:
    return [(v["first_mjd"], v["last_mjd"]) for v in record["training_visits"]]


def blended(ra: float, dec: float) -> bool:
    """A Gaia DR3 source (G < 18) within 12 arcsec of a measured TRAINING position (training only)."""
    params = {"-source": "I/355/gaiadr3", "-c": f"{ra:.6f} {dec:+.6f}", "-c.rs": f"{BLEND_ARCSEC:.1f}",
              "-out": "RA_ICRS,DE_ICRS,Gmag", "-out.max": "unlimited"}
    for attempt in range(3):
        try:
            response = httpx.get(VIZIER_CFA, params=params, timeout=60)
            response.raise_for_status()
            break
        except httpx.HTTPError:
            if attempt == 2:
                raise
            time.sleep(3)
    rows = [line.split("\t") for line in response.text.splitlines() if line and not line.startswith("#")][3:]
    return any(len(r) > 2 and r[2].strip() and float(r[2]) < STAR_G_MAX for r in rows)


def measure_training(number: str) -> dict:
    """Every training exposure: download, measure with the A3 fit, apply the gates; write training points."""
    from backend import astrometry
    from backend.processing import load_product

    selection = json.loads((OUT / "selection.json").read_text())
    record = next(r for r in selection["examined"] if r["number"] == number)
    rows = json.loads((OUT / f"training-{number}.json").read_text())["rows"]
    visits = training_visits(record)
    folder = WORK / number / "train"

    def job(row):
        ra, dec = float(row["ra_obj"]), float(row["dec_obj"])
        key = f"{row['observationid']}_{row['productid']}"
        meta = fetch_cutout(cutout_url(row["uri"], ra, dec, TRAIN_SIZE_DEG), folder / f"{key}.fits")
        return row, key, meta

    with ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS) as pool:
        fetched = list(pool.map(job, rows))
    points, rejected = [], []
    for row, key, meta in fetched:
        detector = int(row["productid"][1])
        visit = next(i + 1 for i, (lo, hi) in enumerate(visits) if lo - 1 <= float(row["mjd_start"]) <= hi + 1)
        entry = {"obs_key": key, "detector": detector, "visit": visit, "url": meta["url"]}
        if meta.get("status") != "ok":
            rejected.append({**entry, "reason_key": "train.download-failed"})
            continue
        product = load_product((folder / f"{key}.fits").read_bytes())
        ra, dec = float(row["ra_obj"]), float(row["dec_obj"])
        position = astrometry.fit_position(product, ra, dec, product.info.get("PSF_FWHM"))
        quality = product.info.get("L2DQAFLG")
        if quality not in (None, "Pass", "PASS", "pass"):
            rejected.append({**entry, "reason_key": "train.l2-quality"})
            continue
        if position.status != "measured":
            rejected.append({**entry, "reason_key": position.reason_key, "snr": position.snr})
            continue
        offset = math.hypot(*astrometry.tangent_offsets_arcsec(ra, dec, position.ra_deg, position.dec_deg))
        if offset > IDENTIFY_ARCSEC:
            rejected.append({**entry, "reason_key": "train.off-track", "offset_arcsec": round(offset, 3)})
            continue
        spacecraft = [product.info.get(axis) for axis in ("X_SC", "Y_SC", "Z_SC")]
        points.append({"t_mjd": round(float(product.info.get("MJD-AVG", row["mjd_start"])), 7),
                       "ra_deg": position.ra_deg, "dec_deg": position.dec_deg, "cov_arcsec2": position.cov_arcsec2,
                       "snr": round(float(position.snr), 2), "obs_keys": [key], "visit": visit, "detector": detector,
                       "spacecraft_km": None if None in spacecraft else [round(float(v), 3) for v in spacecraft],
                       "offset_from_ephemeris_arcsec": round(offset, 3), "source_sha256": meta["source_sha256"],
                       "url": meta["url"], "content_type": "measured"})
    with ThreadPoolExecutor(max_workers=6) as pool:
        flags = list(pool.map(lambda p: blended(p["ra_deg"], p["dec_deg"]), points))
    kept = []
    for point, flag in zip(points, flags):
        if flag:
            rejected.append({"obs_key": point["obs_keys"][0], "detector": point["detector"], "visit": point["visit"],
                             "url": point["url"], "reason_key": "train.blended-gaia"})
        else:
            kept.append(point)
    counts = {v: sum(1 for p in kept if p["visit"] == v) for v in range(1, len(visits) + 1)}
    dropped_visits = [v for v, n in counts.items() if n < MIN_POINTS_PER_VISIT]
    kept = [p for p in kept if p["visit"] not in dropped_visits]
    result = {"number": number, "name": record["name"], "exposures": len(rows), "points": kept, "rejected": rejected,
              "points_per_visit": counts, "dropped_visits": dropped_visits,
              "gates": {"snr_min": 10.0, "identify_arcsec": IDENTIFY_ARCSEC, "blend_arcsec": BLEND_ARCSEC,
                        "blend_catalogue": "Gaia DR3 G < 18 (VizieR, CfA mirror)", "min_points_per_visit": MIN_POINTS_PER_VISIT,
                        "cutout_deg": TRAIN_SIZE_DEG}}
    write_json(WORK / number / "training-measured.json", result)
    return result


# ---------------------------------------------------------------- freeze (no evaluation pixels opened)

BATCH_ID = "asteroids-2026a"
TRIALS = ROOT / "static" / "data" / "trials"
CONTRACT = 13
PRIMARY, SECONDARY = "heliocentric_two_body", "barycentric_two_body"  # user decision, 05:52 UB (docs/asteroid-batch.md)


def trial_id(number: str) -> str:
    return f"asteroid-{number}-position"


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _r(value, digits=6):
    return None if value is None else round(float(value), digits)


def _cov(matrix) -> list:
    import numpy as np
    return [[round(float(v), 6) for v in row] for row in np.asarray(matrix, float)]


def write_trial(number: str, frozen_utc: str) -> dict:
    """trial.json and training.json for one object (before any prediction)."""
    from scripts import asteroid_forecast, predict

    selection = json.loads((OUT / "selection.json").read_text())
    record = next(r for r in selection["examined"] if r["number"] == number)
    measured = json.loads((WORK / number / "training-measured.json").read_text())
    folder = TRIALS / trial_id(number)
    folder.mkdir(parents=True, exist_ok=True)
    training = {"schema_version": "tenger.training/1", "contract_version": CONTRACT, "trial_id": trial_id(number),
                "target_name": record["name"], "source": "scripts/asteroids.py measure_training (A3 fit, gates below)",
                "gates": measured["gates"], "points": measured["points"], "rejected": measured["rejected"],
                "points_per_visit": measured["points_per_visit"], "dropped_visits": measured["dropped_visits"]}
    training_bytes = predict.json_bytes(training)
    (folder / "training.json").write_bytes(training_bytes)
    chosen = record["evaluation_visit"]["chosen"]
    times = [float(r["mjd_start"]) for r in chosen]
    visits_used = sorted({p["visit"] for p in measured["points"]})
    trial = {
        "schema_version": "tenger.trial/1", "contract_version": CONTRACT, "trial_id": trial_id(number),
        "target_key": f"asteroid-{number}", "target_name": record["name"], "batch_id": BATCH_ID,
        "quantity": "position", "category": "prospective_unexposed", "labels": ["prospective_unexposed"],
        "open_forecast": False, "frozen_utc": frozen_utc, "confirmation_pending": True, "team_statement_pending": True,
        "exposure": {"status": "unexposed",
                     "why": "no teammate has opened these images (statement pending); the evaluation-time ephemeris was "
                            "never printed or saved (MOST rule, docs/EXPOSURE.md)",
                     "team_statement": {"path": "docs/EXPOSURE.md", "section": "Task A9", "status": "pending"}},
        "selection": {"rule": "docs/asteroid-batch.md section 1", "record": "docs/exposure/asteroids/selection.json",
                      "H": record["H"], "order": selection["selected"].index(number) + 1},
        "training": {"path": f"trials/{trial_id(number)}/training.json",
                     "measurements_sha256": predict.sha256(training_bytes), "n_points": len(measured["points"]),
                     "visits": visits_used},
        "holdout": {"visit": len(record["training_visits"]) + 1,
                    "window_mjd": [round(min(times), 6), round(max(times), 6)],
                    "obs": [{"obs_id": r["observationid"], "detector": int(r["productid"][1]), "t_mjd": float(r["mjd_start"]),
                             "uri": r["uri"]} for r in chosen],
                    "t_mjd": round(sum(times) / len(times), 6), "data_state": "released_unopened",
                    "selection_rule_key": "holdout.newest-visit-window"},
        "permitted_inputs": [
            {"name": "our own training positions (SPHEREx pixels, A3 fit)", "content_type": "measured", "used_for": "orbit fit"},
            {"name": "observer: Earth (astropy built-in) plus spacecraft header position", "content_type": "catalogue",
             "used_for": "observer geometry"},
            {"name": "Sun and giant-planet positions (astropy built-in)", "content_type": "catalogue",
             "used_for": "frames and the synthetic N-body orbits of the model-error term"},
            {"name": "evaluation exposure times (MOST listing, identifiers and times only)", "content_type": "catalogue",
             "used_for": "forecast times"}],
        "ephemeris_use": "JPL positions (MOST) located the training images and guided the training fits (3 arcsec gate); "
                         "they never enter the orbit fit or the forecast. Evaluation-time positions were never read.",
        "model": {"id": "two-body-v2-asteroid", "version": "a9-2026-11-15", "code_sha256": asteroid_forecast.code_sha256(),
                  "code_files": list(asteroid_forecast.CODE_FILES), "primary_frame": PRIMARY, "secondary_frame": SECONDARY,
                  "uncertainty": "v2 envelope (group Monte Carlo, 300 draws, and visit x detector jackknife, along and across "
                                 "the track) + sigma_g^2 + spacecraft term + two-body model error (second moment of 24 "
                                 "synthetic N-body orbits with our fitted a, e, i)",
                  "start_source": "our first-visit positions and motion over geocentric distances 0.8-4.0 AU",
                  "rules": "docs/asteroid-batch.md section 4"},
        "baseline": {"id": "linear-tangent-plane", "description": "straight line in RA/Dec fitted to the same positions"},
        "scoring": {"kind": "position_2d_chi2", "coverage": 0.95, "threshold_d2": 5.991464547107979,
                    "threshold_radius": 2.4477468306808166, "covariance": "S = C_pred + C_obs",
                    "observed": "mean over identified evaluation exposures of observed - model(t_i), east/north arcsec",
                    "c_obs": "sample covariance of the residuals / N (N >= 3), never below the mean fit covariance / N",
                    "c_pred": "frozen primary covariance at the mean evaluation time",
                    "secondary": "the heliocentric forecast and the straight line are scored on the same positions and C_obs"},
        "identification": {"method_key": "ident.frozen-model-search", "rules": [
            "cutouts centred on the frozen primary forecast at each evaluation exposure time (no ephemeris query)",
            "every peak with S/N >= 5 within the listing radius is a candidate and is kept",
            "A3 fit S/N >= 10 within max(15 arcsec, 3 x the largest 1-sigma of C_pred) of the forecast",
            "static check: no source at S/N >= 5 at the same sky position in another exposure of the same detector "
            "taken at least 0.5 day apart (a static reference cutout)",
            "two or more passing candidates in one exposure -> ambiguous; motion consistency across exposures "
            "(chi-square, p = 0.997, 0.3 arcsec allowance)",
            "fewer than 3 identified exposures -> insufficient_data"], "alternatives_kept": True},
        "limitation_keys": ["limit.two-body-only", "limit.gaussian-psf-model", "limit.ephemeris-guided-training"],
    }
    trial_bytes = predict.json_bytes(trial)
    (folder / "trial.json").write_bytes(trial_bytes)
    return trial


def write_prediction(number: str, created_utc: str) -> dict:
    import numpy as np

    from scripts import asteroid_forecast, predict

    folder = TRIALS / trial_id(number)
    trial_bytes = (folder / "trial.json").read_bytes()
    trial = json.loads(trial_bytes)
    training = json.loads((folder / "training.json").read_bytes())
    if (folder / "prediction.json").exists():
        raise predict.FrozenError(f"{trial['trial_id']}: prediction exists")
    if asteroid_forecast.code_sha256() != trial["model"]["code_sha256"]:
        raise predict.FrozenError("model code changed since the manifest")
    points = training["points"]
    times = [o["t_mjd"] for o in trial["holdout"]["obs"]]
    t_ref = trial["holdout"]["t_mjd"]
    base = {"schema_version": "tenger.prediction/1", "contract_version": CONTRACT, "trial_id": trial["trial_id"],
            "trial_ref": {"path": f"trials/{trial['trial_id']}/trial.json", "sha256": predict.sha256(trial_bytes)},
            "training_sha256": trial["training"]["measurements_sha256"], "category": trial["category"],
            "labels": trial["labels"], "batch_id": BATCH_ID, "target_name": trial["target_name"],
            "open_forecast": False, "created_utc": created_utc, "t_mjd": t_ref}
    if len(trial["training"]["visits"]) < 2:
        document = {**base, "prediction_status": "insufficient_data", "status_reason_key": "predict.fewer-than-2-visits",
                    "model": None, "baseline": None, "limitation_keys": trial["limitation_keys"]}
        (folder / "prediction.json").write_bytes(predict.json_bytes(document))
        return document
    all_times = [t_ref, *times]

    def block(result, index):
        entry = result["track"][index]
        return {"t_mjd": _r(entry["t_mjd"]), "ra_deg": _r(entry["ra_deg"], 8), "dec_deg": _r(entry["dec_deg"], 8),
                "cov_arcsec2": _cov(entry["cov_arcsec2"]), "c_fit_arcsec2": _cov(entry["c_fit_arcsec2"]),
                "c_model_arcsec2": _cov(entry["c_model_arcsec2"]), "uncertainty_basis": entry["uncertainty_basis"],
                "distance_au": _r(entry["distance_au"], 5), "along_track_95_arcsec": entry["along_track_95_arcsec"],
                "cross_track_95_arcsec": entry["cross_track_95_arcsec"], "motion_arcsec_per_day": entry["motion_arcsec_per_day"],
                "motion_position_angle_deg": entry["motion_position_angle_deg"], "content_type": "modeled"}

    def state(result):
        return {"kind": result["mode"], "t0_mjd_utc": _r(result["best"]["t0"]),
                "state_au_au_per_day": [float(v) for v in result["best"]["state"]],
                "covariance_fit": [[float(v) for v in row] for row in result["best"]["covariance"]],
                "light_time": True, "aberration": False, "sigma_g_arcsec": _r(result["sigma_g"], 4),
                "start": {"distance_au": result["start"]["distance_au"], "chi2_red": _r(result["start"]["chi2_red"], 4),
                          "grid": result["start"]["grid"]},
                "model_error": {k: (_cov(v) if k == "c_along_cross_arcsec2" else (_r(v, 4) if isinstance(v, float) else v))
                                for k, v in result["model_error"].items()},
                "diagnostics": {**{k: (_r(v, 4) if isinstance(v, float) else v) for k, v in result["diagnostics"].items()},
                                "monte_carlo_draws": 300}}

    primary = asteroid_forecast.forecast(points, all_times, PRIMARY)
    secondary = asteroid_forecast.forecast(points, all_times, SECONDARY)
    baseline_rows, baseline_info = asteroid_forecast.baseline(points, all_times)
    document = {**base, "prediction_status": "predicted", "status_reason_key": None,
                "model": {**block(primary, 0), "frame": PRIMARY, "observer": "geocentre; spacecraft offset in the covariance"},
                "secondary_model": {**block(secondary, 0), "frame": SECONDARY,
                                    "observer": "geocentre; spacecraft offset in the covariance"},
                "baseline": {k: baseline_rows[0][k] for k in ("ra_deg", "dec_deg", "cov_arcsec2")} | {"content_type": "modeled"},
                "track": [block(primary, i) for i in range(1, len(all_times))],
                "secondary_track": [block(secondary, i) for i in range(1, len(all_times))],
                "baseline_track": baseline_rows[1:],
                "model_state": state(primary), "secondary_state": state(secondary),
                "diagnostics": {"baseline": baseline_info},
                "limitation_keys": trial["limitation_keys"]}
    (folder / "prediction.json").write_bytes(predict.json_bytes(document))
    return document


# ---------------------------------------------------------------- verification (only after the freeze push)

STATIC_MIN_DT_DAYS = 0.5
EVAL_MARGIN_ARCSEC = 60.0
EVAL_MAX_DEG = 0.5


def frozen_position(prediction: dict, which: str, t: float, observer_helio) -> tuple[float, float]:
    """The frozen orbit (model_state or secondary_state) at time t for this observer."""
    import numpy as np

    from scripts import postmortem

    state = prediction[which]
    model = postmortem.Model(state["kind"], postmortem.Ephemeris(t - 6, t + 6))
    body = model.solve(np.array(state["state_au_au_per_day"]), state["t0_mjd_utc"], t, t)
    return model.radec(body, t, model.observer(t, None, observer_helio))


def r95(entry: dict) -> float:
    import numpy as np
    return float(math.sqrt(max(np.linalg.eigvalsh(np.array(entry["cov_arcsec2"])))) * 2.4477468306808166)


def static_reference_row(ra: float, dec: float, detector: int, t: float) -> dict | None:
    """Another exposure of the same detector covering this sky position, at least 0.5 day away (SIA metadata)."""
    from scripts.exposure_inventory import CURRENT_COLLECTIONS, inside_polygon, parse_polygon, sia

    rows = []
    with httpx.Client(timeout=120) as client:
        for collection in CURRENT_COLLECTIONS:
            for row in sia(client, collection, ra, dec, 0.002):
                band = re.match(r"SPHEREx-D([1-6])", row.get("energy_bandpassname") or "")
                if not band or int(band[1]) != detector:
                    continue
                t_row = float(row["t_min"])
                if abs(t_row - t) < STATIC_MIN_DT_DAYS or not inside_polygon(ra, dec, parse_polygon(row["s_region"] or "")):
                    continue
                rows.append({"obs_id": row["obs_id"], "t_mjd": t_row, "url": row["access_url"], "collection": collection})
    return min(rows, key=lambda r: (abs(r["t_mjd"] - t), r["collection"])) if rows else None


def intact_problems(tid: str) -> list[str]:
    """verify.integrity_problems with the batch's own model-code check (its trial lists its code_files)."""
    from scripts import asteroid_forecast, verify

    problems = [p for p in verify.integrity_problems(tid) if p != "model code changed since the trial was frozen"]
    trial = json.loads((TRIALS / tid / "trial.json").read_text())
    if asteroid_forecast.code_sha256() != trial["model"]["code_sha256"]:
        problems.append("asteroid model code changed since the freeze")
    return problems


def acquire_evaluation(number: str) -> list[dict]:
    """Open the evaluation exposures: cutouts centred on the frozen primary forecast, plus static references."""
    from scripts import verify

    tid = trial_id(number)
    problems = intact_problems(tid)
    if problems:
        raise RuntimeError(f"{tid}: not intact: {problems}")
    trial = json.loads((TRIALS / tid / "trial.json").read_text())
    prediction = json.loads((TRIALS / tid / "prediction.json").read_text())
    if prediction["prediction_status"] != "predicted":
        return []
    folder = WORK / number / "eval"
    out = []
    for obs, primary, secondary in zip(trial["holdout"]["obs"], prediction["track"], prediction["secondary_track"]):
        from backend.astrometry import tangent_offsets_arcsec
        apart = math.hypot(*tangent_offsets_arcsec(primary["ra_deg"], primary["dec_deg"], secondary["ra_deg"], secondary["dec_deg"]))
        half = max(r95(primary), apart + r95(secondary)) + EVAL_MARGIN_ARCSEC
        size = round(min(EVAL_MAX_DEG, max(0.03, 2 * half / 3600)), 4)
        key = f"{obs['obs_id']}_D{obs['detector']}"
        meta = fetch_cutout(cutout_url(obs["uri"], primary["ra_deg"], primary["dec_deg"], size), folder / f"{key}.fits")
        ref = static_reference_row(primary["ra_deg"], primary["dec_deg"], obs["detector"], obs["t_mjd"])
        ref_meta = None
        if ref:
            ref_meta = fetch_cutout(f"{ref['url']}?center={primary['ra_deg']:.6f},{primary['dec_deg']:.6f}&size={size}",
                                    folder / "ref" / f"{key}.fits")
            ref_meta = {**ref_meta, "obs_id": ref["obs_id"], "t_mjd": ref["t_mjd"]}
        out.append({"key": key, "obs": obs, "size_deg": size, "meta": meta, "reference": ref_meta})
    write_json(WORK / number / "evaluation-acquired.json", out)
    return out


def verify_object(number: str) -> dict:
    import numpy as np

    from backend import astrometry, orbit
    from backend.processing import load_product
    from scripts import predict, verify

    tid = trial_id(number)
    trial_bytes = (TRIALS / tid / "trial.json").read_bytes()
    trial = json.loads(trial_bytes)
    prediction_bytes = (TRIALS / tid / "prediction.json").read_bytes()
    prediction = json.loads(prediction_bytes)
    training = json.loads((TRIALS / tid / "training.json").read_text())
    base = {"schema_version": "tenger.verification/1", "contract_version": CONTRACT, "trial_id": tid,
            "prediction_sha256": predict.sha256(prediction_bytes), "revealed_utc": _now(), "category": trial["category"],
            "labels": trial["labels"], "batch_id": BATCH_ID, "target_name": trial["target_name"],
            "confirmation_pending": True, "team_statement_pending": True}
    if prediction["prediction_status"] != "predicted":
        return {**base, "status": "insufficient_data", "status_reason_key": prediction["status_reason_key"],
                "observed": None, "residuals": None}
    acquired = json.loads((WORK / number / "evaluation-acquired.json").read_text())
    c_pred = np.array(prediction["model"]["cov_arcsec2"])
    search_radius = max(15.0, 3 * math.sqrt(max(np.linalg.eigvalsh(c_pred))))
    items, references = [], []
    for entry in acquired:
        if entry["meta"].get("status") != "ok":
            continue
        product = load_product((WORK / number / "eval" / f"{entry['key']}.fits").read_bytes())
        if product.info.get("L2DQAFLG") not in (None, "Pass", "PASS", "pass"):
            continue
        t = float(product.info.get("MJD-AVG", entry["obs"]["t_mjd"]))
        spacecraft = [product.info.get(axis) for axis in ("X_SC", "Y_SC", "Z_SC")]
        observer = orbit.observer_heliocentric_au(t, None if None in spacecraft else spacecraft)
        reference = None
        if entry["reference"] and entry["reference"].get("status") == "ok":
            reference = load_product((WORK / number / "eval" / "ref" / f"{entry['key']}.fits").read_bytes())
        items.append({"obs_key": entry["key"], "detector": entry["obs"]["detector"], "product": product, "t": t,
                      "observer": observer, "model": frozen_position(prediction, "model_state", t, observer),
                      "secondary": frozen_position(prediction, "secondary_state", t, observer),
                      "reference": reference, "reference_meta": entry["reference"], "cutout_url": entry["meta"]["url"],
                      "sha256": entry["meta"]["source_sha256"]})
    previous = verify.SEARCH_RADIUS_ARCSEC
    verify.SEARCH_RADIUS_ARCSEC = max(30.0, search_radius + 5.0)
    try:
        for item in items:
            product = item["product"]
            item["candidates"] = verify.candidates_for(product, item["model"][0], item["model"][1], product.info.get("PSF_FWHM"))
            for candidate in item["candidates"]:
                fitted = candidate["fit_status"] == "measured"
                static = {"checked_against": None, "static_source": None, "probe_snr": None}
                if fitted and item["reference"] is not None:
                    probe = astrometry.fit_position(item["reference"], candidate["ra_deg"], candidate["dec_deg"],
                                                    item["reference"].info.get("PSF_FWHM"))
                    if probe.reason_key != "measure.outside-cutout":
                        static = {"checked_against": item["reference_meta"]["obs_id"],
                                  "static_source": bool(probe.status == "measured" and (probe.snr or 0) >= verify.STATIC_SNR),
                                  "probe_snr": _r(probe.snr, 2)}
                candidate["static_check"] = static
                candidate["passes"] = bool(fitted and candidate["snr"] >= verify.IDENTIFY_SNR
                                           and candidate["distance_arcsec"] <= search_radius and static["static_source"] is False)
            passing = [c for c in item["candidates"] if c["passes"]]
            item["identification"] = "ambiguous" if len(passing) > 1 else "identified" if passing else "none"
            item["identified"] = passing[0] if len(passing) == 1 else None
    finally:
        verify.SEARCH_RADIUS_ARCSEC = previous
    identified = [item for item in items if item["identification"] == "identified"]
    ambiguous = [item for item in items if item["identification"] == "ambiguous"]
    motion = verify.motion_consistency(identified)
    candidates_record = [{
        "obs_key": item["obs_key"], "t_mjd": _r(item["t"]), "detector": item["detector"],
        "model": {"ra_deg": _r(item["model"][0], 8), "dec_deg": _r(item["model"][1], 8)},
        "identification": item["identification"], "cutout_url": item["cutout_url"], "source_sha256": item["sha256"],
        "static_reference": item["reference_meta"],
        "candidates": [{"ra_deg": _r(c["ra_deg"], 8), "dec_deg": _r(c["dec_deg"], 8), "snr": _r(c["snr"], 2),
                        "peak_snr": _r(c["peak_snr"], 2), "fit_status": c["fit_status"],
                        "offset_east_arcsec": _r(c["east_arcsec"], 3), "offset_north_arcsec": _r(c["north_arcsec"], 3),
                        "distance_arcsec": _r(c["distance_arcsec"], 3), "static_check": c["static_check"],
                        "passes": c["passes"]} for c in item["candidates"]]} for item in items]
    identification = {"method_key": "ident.frozen-model-search", "search_radius_arcsec": _r(search_radius, 3),
                      "listing_radius_arcsec": _r(max(30.0, search_radius + 5.0), 3), "min_snr": verify.IDENTIFY_SNR,
                      "static_snr": verify.STATIC_SNR, "static_min_dt_days": STATIC_MIN_DT_DAYS, "motion": motion,
                      "n_exposures_searched": len(items), "n_identified": len(identified), "n_ambiguous": len(ambiguous)}
    status = None
    if ambiguous:
        status = ("ambiguous", "verify.multiple-candidates")
    elif len(identified) < verify.MIN_IDENTIFIED:
        status = ("insufficient_data", "verify.fewer-than-3")
    elif motion["consistent"] is False:
        status = ("ambiguous", "verify.motion-inconsistent")
    if status:
        return {**base, "status": status[0], "status_reason_key": status[1], "observed": None, "residuals": None,
                "identification": identification, "candidates": candidates_record}
    times = [item["t"] for item in identified]
    t_mean = float(np.mean(times))
    observed = [(item["identified"]["ra_deg"], item["identified"]["dec_deg"]) for item in identified]
    fit_covs = np.array([item["identified"]["cov_arcsec2"] for item in identified])
    model_res = np.array([astrometry.tangent_offsets_arcsec(*item["model"], *obs) for item, obs in zip(identified, observed)])
    second_res = np.array([astrometry.tangent_offsets_arcsec(*item["secondary"], *obs) for item, obs in zip(identified, observed)])
    base_rows, _ = predict._baseline_linear(training["points"], times)
    base_res = np.array([astrometry.tangent_offsets_arcsec(row["ra_deg"], row["dec_deg"], *obs) for row, obs in zip(base_rows, observed)])
    mean_observer = np.mean([item["observer"] for item in identified], axis=0)
    model_ref = frozen_position(prediction, "model_state", t_mean, mean_observer)
    second_ref = frozen_position(prediction, "secondary_state", t_mean, mean_observer)
    base_ref_row = predict._baseline_linear(training["points"], [t_mean])[0][0]
    scored = verify.score(model_res, fit_covs, c_pred)
    if scored["status"] in ("insufficient_data", "invalid_comparison"):
        return {**base, "status": scored["status"], "status_reason_key": scored["status_reason_key"], "observed": None,
                "residuals": None, "identification": identification, "candidates": candidates_record}
    c_second = np.array(prediction["secondary_model"]["cov_arcsec2"])
    c_base = np.array(prediction["baseline"]["cov_arcsec2"])
    second_scored = verify.score(second_res, fit_covs, c_second, c_obs=scored["c_obs"])
    base_scored = verify.score(base_res, fit_covs, c_base, c_obs=scored["c_obs"])
    observed_ra, observed_dec = astrometry.tangent_to_sky(model_ref[0], model_ref[1], *scored["mean"])
    return {**base, "t_mjd": _r(t_mean),
            "observed": {"ra_deg": _r(observed_ra, 8), "dec_deg": _r(observed_dec, 8), "cov_arcsec2": _cov(scored["c_obs"]),
                         "obs_keys": [item["obs_key"] for item in identified], "n_exposures": len(identified),
                         "content_type": "measured"},
            "residuals": {"model": verify.residual_block(model_ref, c_pred, scored, t_mean),
                          "secondary": verify.residual_block(second_ref, c_second, second_scored, t_mean),
                          "baseline": verify.residual_block((base_ref_row["ra_deg"], base_ref_row["dec_deg"]), c_base,
                                                            base_scored, t_mean)},
            "c_pred_note": "frozen C_pred at the planned mean evaluation time (window <= 1 day)",
            "per_exposure": [{"obs_key": item["obs_key"], "t_mjd": _r(t, 6),
                              "model_residual_arcsec": [_r(v, 4) for v in m],
                              "secondary_residual_arcsec": [_r(v, 4) for v in s2],
                              "baseline_residual_arcsec": [_r(v, 4) for v in b]}
                             for item, t, m, s2, b in zip(identified, times, model_res, second_res, base_res)],
            "status": scored["status"], "status_reason_key": None,
            "identification": identification, "candidates": candidates_record}


def horizons_after_verdict(number: str) -> dict | None:
    """After the verdict only: JPL Horizons at every evaluation exposure, against the frozen forecasts.

    Exploratory, never a status: per exposure, Horizons (geocentric, moved to the spacecraft with the FITS
    header position) minus the frozen primary and secondary forecasts at that time and observer, and
    D^2 = r' C_pred^-1 r with the frozen C_pred (no measurement term). Also observed minus Horizons when the
    object was identified."""
    import numpy as np

    from backend import orbit
    from backend.astrometry import tangent_offsets_arcsec, tangent_to_sky
    from backend.processing import load_product

    tid = trial_id(number)
    verification = json.loads((TRIALS / tid / "verification.json").read_text())
    prediction = json.loads((TRIALS / tid / "prediction.json").read_text())
    if prediction["prediction_status"] != "predicted":
        return None
    acquired = json.loads((WORK / number / "evaluation-acquired.json").read_text())
    rows = []
    for entry in acquired:
        if entry["meta"].get("status") != "ok":
            continue
        product = load_product((WORK / number / "eval" / f"{entry['key']}.fits").read_bytes())
        t = float(product.info["MJD-AVG"])
        rows.append((entry["key"], t, np.array([product.info["X_SC"], product.info["Y_SC"], product.info["Z_SC"]], float)))
    params = {"format": "json", "COMMAND": f"'{number};'", "EPHEM_TYPE": "OBSERVER", "CENTER": "'500@399'",
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
    c_primary = np.array(prediction["model"]["cov_arcsec2"])
    c_secondary = np.array(prediction["secondary_model"]["cov_arcsec2"])
    per = []
    for (key, t, spacecraft), line in zip(rows, lines):
        fields = [field.strip() for field in line.split(",")]
        ra, dec, delta = float(fields[ra_col]), float(fields[dec_col]), float(fields[delta_col])
        a, d = math.radians(ra), math.radians(dec)
        east = np.array([-math.sin(a), math.cos(a), 0.0])
        north = np.array([-math.sin(d) * math.cos(a), -math.sin(d) * math.sin(a), math.cos(d)])
        s_au = spacecraft / orbit.KM_PER_AU
        shift = (-float(s_au @ east) / delta * orbit.ARCSEC_PER_RAD, -float(s_au @ north) / delta * orbit.ARCSEC_PER_RAD)
        ra_sc, dec_sc = tangent_to_sky(ra, dec, *shift)
        observer = orbit.observer_heliocentric_au(t, spacecraft)
        row = {"obs_key": key, "t_mjd": _r(t), "horizons_ra_deg": _r(ra_sc, 8), "horizons_dec_deg": _r(dec_sc, 8)}
        for name, state, cov in (("primary", "model_state", c_primary), ("secondary", "secondary_state", c_secondary)):
            model = frozen_position(prediction, state, t, observer)
            residual = np.array(tangent_offsets_arcsec(*model, ra_sc, dec_sc))
            row[f"horizons_minus_{name}_arcsec"] = [_r(v, 3) for v in residual]
            row[f"{name}_d2_vs_horizons"] = _r(float(residual @ np.linalg.inv(cov) @ residual), 4)
        per.append(row)
    out = {"source": f"JPL Horizons API, COMMAND '{number};', geocentric astrometric RA/Dec moved to the spacecraft "
                     "with the FITS header position and Horizons delta", "queried_utc": _now(), "after_verdict": True,
           "exploratory": True, "counts": False,
           "note": "after the verdict; it does not change the status. D^2 uses the frozen C_pred only (no measurement "
                   "term), so it asks whether the catalogue position lay inside the frozen 95% region.",
           "per_exposure": per}
    for name in ("primary", "secondary"):
        d2 = [row[f"{name}_d2_vs_horizons"] for row in per]
        errors = [math.hypot(*row[f"horizons_minus_{name}_arcsec"]) for row in per]
        out[f"{name}_median_d2_vs_horizons"] = _r(float(np.median(d2)), 4)
        out[f"{name}_median_error_vs_horizons_arcsec"] = _r(float(np.median(errors)), 3)
        out[f"{name}_inside_95_vs_horizons"] = bool(np.median(d2) <= 5.991464547107979)
    if verification.get("observed"):
        h_ra = float(np.mean([row["horizons_ra_deg"] for row in per if row["obs_key"] in verification["observed"]["obs_keys"]]))
        h_dec = float(np.mean([row["horizons_dec_deg"] for row in per if row["obs_key"] in verification["observed"]["obs_keys"]]))
        observed = verification["observed"]
        out["observed_minus_horizons_arcsec"] = [_r(v, 3) for v in tangent_offsets_arcsec(h_ra, h_dec, observed["ra_deg"], observed["dec_deg"])]
    return out


def clopper_pearson(k: int, n: int, level: float = 0.95) -> tuple[float, float]:
    from scipy.stats import beta

    alpha = 1 - level
    low = 0.0 if k == 0 else float(beta.ppf(alpha / 2, k, n - k + 1))
    high = 1.0 if k == n else float(beta.ppf(1 - alpha / 2, k + 1, n - k))
    return low, high


def calibration(rows: list[dict], key: str) -> dict:
    from backend.injection import wilson

    scored = [r for r in rows if r.get(f"{key}_d2") is not None]
    k = sum(1 for r in scored if r[f"{key}_d2"] <= 5.991464547107979)
    n = len(scored)
    exact = clopper_pearson(k, n) if n else (0.0, 1.0)
    approx = wilson(k, n)
    return {"model": key, "n": n, "k_inside": k, "level": 0.95, "expected_inside": round(0.95 * n, 2),
            "interval": [round(exact[0], 4), round(exact[1], 4)], "interval_method": "clopper_pearson",
            "wilson_interval": [round(approx[0], 4), round(approx[1], 4)],
            "independence_note_key": "batch.independence"}


def exploratory_coverage(rows: list[dict]) -> dict:
    """After the verdicts, not counted: in how many forecasts did the JPL Horizons position lie inside the frozen
    95% region (median over the evaluation exposures, C_pred only)."""
    checked = [r for r in rows if r.get("exploratory_vs_horizons")]
    out = {"exploratory": True, "counts": False, "note_key": "batch.exploratory-horizons"}
    for name in ("primary", "secondary"):
        k = sum(1 for r in checked if r["exploratory_vs_horizons"][f"{name}_inside_95"])
        out[name] = {"n": len(checked), "k_inside": k,
                     "interval": [round(v, 4) for v in clopper_pearson(k, len(checked))] if checked else None}
    return out


def build_batch(attempted: list[str]) -> dict:
    """static/data/batches/asteroids-2026a.json: the batch summary, recomputed from the trial files."""
    from scripts import predict

    selection = json.loads((OUT / "selection.json").read_text())
    rows, frozen, receipt = [], None, None
    for number in selection["selected"]:
        tid = trial_id(number)
        folder = TRIALS / tid
        if number not in attempted or not (folder / "trial.json").exists():
            continue
        trial = json.loads((folder / "trial.json").read_text())
        prediction = json.loads((folder / "prediction.json").read_text()) if (folder / "prediction.json").exists() else None
        verification = json.loads((folder / "verification.json").read_text()) if (folder / "verification.json").exists() else None
        receipt_doc = json.loads((folder / "receipt.json").read_text()) if (folder / "receipt.json").exists() else None
        frozen = frozen or trial["frozen_utc"]
        receipt = receipt or ({"commit_sha": receipt_doc["commit"], "frozen_utc": receipt_doc["committed_utc"]} if receipt_doc else None)
        residuals = (verification or {}).get("residuals") or {}
        status = ("insufficient_data" if prediction and prediction["prediction_status"] == "insufficient_data"
                  else verification["status"] if verification else "waiting")
        model = (prediction or {}).get("model") or {}
        second = (prediction or {}).get("secondary_model") or {}
        row = {"trial_id": tid, "number": number, "name": trial["target_name"], "H": trial["selection"]["H"],
               "status": status, "status_reason_key": (verification or prediction or {}).get("status_reason_key"),
               "model_95_along_arcsec": model.get("along_track_95_arcsec"), "model_95_cross_arcsec": model.get("cross_track_95_arcsec"),
               "secondary_95_along_arcsec": second.get("along_track_95_arcsec"),
               "secondary_95_cross_arcsec": second.get("cross_track_95_arcsec"), "excluded_reason_key": None}
        for name in ("model", "secondary", "baseline"):
            block = residuals.get(name) or {}
            row[f"{name}_d2"] = block.get("d2")
            row[f"{name}_d"] = round(math.sqrt(block["d2"]), 4) if block.get("d2") is not None else None
            row[f"{name}_error_arcsec"] = block.get("error_arcsec")
            row[f"{name}_inside"] = None if block.get("d2") is None else bool(block["d2"] <= 5.991464547107979)
        horizons = (verification or {}).get("horizons_after_verdict") or {}
        row["observed_minus_horizons_arcsec"] = horizons.get("observed_minus_horizons_arcsec")
        row["exploratory_vs_horizons"] = None if not horizons else {
            "primary_median_error_arcsec": horizons.get("primary_median_error_vs_horizons_arcsec"),
            "primary_median_d2": horizons.get("primary_median_d2_vs_horizons"),
            "primary_inside_95": horizons.get("primary_inside_95_vs_horizons"),
            "secondary_median_error_arcsec": horizons.get("secondary_median_error_vs_horizons_arcsec"),
            "secondary_inside_95": horizons.get("secondary_inside_95_vs_horizons"), "counts": False}
        rows.append(row)
    not_attempted = [{"number": n, "trial_id": trial_id(n), "status": "not_attempted"}
                     for n in selection["selected"] if n not in attempted]
    document = {"schema_version": "tenger.batch/1", "contract_version": CONTRACT, "batch_id": BATCH_ID,
                "title_key": "batch.asteroids.title", "category": "prospective_unexposed", "labels": ["prospective_unexposed"],
                "team_statement_pending": True, "frozen_utc": frozen, "receipt": receipt,
                "rules": "docs/asteroid-batch.md", "selection": "docs/exposure/asteroids/selection.json",
                "trial_ids": [r["trial_id"] for r in rows], "rows": rows, "not_attempted": not_attempted,
                "calibration": calibration(rows, "model"), "secondary_calibration": calibration(rows, "secondary"),
                "baseline_calibration": calibration(rows, "baseline"),
                "exploratory_horizons_coverage": exploratory_coverage(rows),
                "note_keys": ["batch.independence", "batch.small-n", "batch.model-error", "batch.ephemeris-guided-training",
                              "batch.team-statement-pending", "batch.outlier-flag"],
                "generated_utc": _now()}
    path = ROOT / "static" / "data" / "batches" / f"{BATCH_ID}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(predict.json_bytes(document))
    return document


def refresh_index() -> None:
    """index.json: the trial list (same rule as scripts/build_index.py) and batch_paths; targets untouched (offline)."""
    data = ROOT / "static" / "data"
    path = data / "index.json"
    index = json.loads(path.read_text())
    index["trials"] = sorted(f"trials/{folder.name}/trial.json" for folder in (data / "trials").glob("*")
                             if (folder / "trial.json").exists() and not (folder / "abandoned.json").exists())
    batches = sorted(f"batches/{p.name}" for p in (data / "batches").glob("*.json")) if (data / "batches").exists() else []
    index["batch_paths"] = batches
    path.write_text(json.dumps(index, indent=2, ensure_ascii=False) + "\n")


def save_raw(numbers: list[str]) -> None:
    """After the freeze push only: the full MOST tables (evaluation rows included) for the record."""
    import subprocess

    for number in numbers:
        tid = trial_id(number)
        receipt = TRIALS / tid / "receipt.json"
        if not receipt.exists():
            raise RuntimeError(f"{tid}: no receipt yet; raw MOST tables are saved only after the freeze push")
        commit = json.loads(receipt.read_text())["commit"]
        on_remote = subprocess.run(["git", "branch", "-r", "--contains", commit, "--list", "origin/tenger-dev"],
                                   cwd=ROOT, capture_output=True, text=True).stdout.strip()
        if not on_remote:
            raise RuntimeError(f"{tid}: freeze commit not on origin/tenger-dev yet")
        selection = json.loads((OUT / "selection.json").read_text())
        record = next(r for r in selection["examined"] if r["number"] == number)
        rows = dedupe([r for r in most_rows(number) if r.get("match") == "1" and any(t in (r.get("uri") or "") for t in RELEASES)])
        start = record["evaluation_visit"]["first_mjd"]
        write_json(OUT / "raw" / f"{number}.json", {
            "number": number, "saved_utc": _now(), "after_freeze_commit": commit,
            "training_rows": [r for r in rows if float(r["mjd_start"]) < start - VISIT_GAP_DAYS / 2],
            "evaluation_rows": [r for r in rows if float(r["mjd_start"]) >= start - VISIT_GAP_DAYS / 2]})


def main(argv: list[str]) -> int:
    stage = argv[0] if argv else ""
    if stage == "select":
        selection = select()
        print("selected:", selection["selected"])
        return 0
    if stage == "manifest":
        frozen = _now()
        for number in argv[1:]:
            print(write_trial(number, frozen)["trial_id"], flush=True)
        return 0
    if stage == "predict":
        created = _now()
        for number in argv[1:]:
            document = write_prediction(number, created)
            model = document.get("model") or {}
            print(number, document["prediction_status"], "along/cross 95%:", model.get("along_track_95_arcsec"),
                  model.get("cross_track_95_arcsec"), flush=True)
        return 0
    if stage == "save-raw":
        save_raw(argv[1:])
        return 0
    if stage == "evaluate":
        for number in argv[1:]:
            acquired = acquire_evaluation(number)
            print(number, "evaluation cutouts", len(acquired), "with references",
                  sum(1 for a in acquired if a["reference"]), flush=True)
        return 0
    if stage == "verify":
        from scripts import predict
        for number in argv[1:]:
            document = verify_object(number)
            (TRIALS / trial_id(number) / "verification.json").write_bytes(predict.json_bytes(document))
            residual = (document.get("residuals") or {}).get("model") or {}
            print(number, document["status"], document.get("status_reason_key"), "D2", residual.get("d2"),
                  "error", residual.get("error_arcsec"), flush=True)
        return 0
    if stage == "batch":
        document = build_batch(argv[1:])
        refresh_index()
        print(json.dumps(document["calibration"]), json.dumps(document["secondary_calibration"]))
        return 0
    if stage == "horizons":
        from scripts import predict
        for number in argv[1:]:
            path = TRIALS / trial_id(number) / "verification.json"
            document = json.loads(path.read_text())
            comparison = horizons_after_verdict(number)
            if comparison:
                document["horizons_after_verdict"] = comparison
                path.write_bytes(predict.json_bytes(document))
                print(number, document["status"], "Horizons-primary median error", comparison["primary_median_error_vs_horizons_arcsec"],
                      "D2", comparison["primary_median_d2_vs_horizons"], "inside", comparison["primary_inside_95_vs_horizons"],
                      "| secondary", comparison["secondary_median_error_vs_horizons_arcsec"],
                      comparison["secondary_inside_95_vs_horizons"], "| observed-Horizons",
                      comparison.get("observed_minus_horizons_arcsec"), flush=True)
        return 0
    if stage == "train":
        for number in argv[1:]:
            result = measure_training(number)
            print(number, "exposures", result["exposures"], "kept", len(result["points"]), "per visit",
                  result["points_per_visit"], "dropped visits", result["dropped_visits"], flush=True)
        return 0
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
