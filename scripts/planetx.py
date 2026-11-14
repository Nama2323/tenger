"""Task A8: could SPHEREx see Planet X? Single-exposure depth measured by injection-recovery.

    python -m scripts.planetx plan|fetch|catalogue|psftest|run|build|all

Fields: the five challenge-target fields and the Pluto/Makemake training fields, all already exposed
(docs/EXPOSURE.md). Never the reserved 3I/ATLAS region. Real cutouts are re-downloaded with their EPSF
extension into cache/planetx/source/ and checked against the SHA-256 recorded in each investigation.
Artificial sources exist only in memory (backend/injection.py); nothing artificial is written to data/
or cache/. Derived numbers go to cache/planetx/*.json and, labelled "artificial": true, to
static/data/planetx/.
"""
import concurrent.futures
import hashlib
import json
import math
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
import numpy as np
from scipy.optimize import least_squares

from backend import catalogs, config, injection
from backend.archive import _download, _write_atomic

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "static" / "data"
OUT = DATA / "planetx"
WORK = config.CACHE_DIR / "planetx"

FIELDS = ("barnard", "wise0855", "epsindib", "rwaur", "rdra", "pluto", "makemake")
CHALLENGE = ("barnard", "wise0855", "epsindib", "rwaur", "rdra")
BANDS = {
    "i": {"detector": 1, "window_um": (0.75, 0.87), "published_band": "Johnson I", "nominal_um": 0.80},
    "w1": {"detector": 4, "window_um": (3.25, 3.55), "published_band": "WISE W1", "nominal_um": 3.4},
    "w2": {"detector": 6, "window_um": (4.45, 4.75), "published_band": "WISE W2", "nominal_um": 4.6},
}
N_EXPOSURES = 6
N_POSITIONS = 12
N_BLANKS = 24
SEED = 20261115
MAG_STEP = 0.25
SNR_MIN = 5.0
SITE_SNR_MIN = 10.0
MAX_OFFSET_PX = 1.0
CATALOGUE_RADIUS_ARCSEC = 15.0
TARGET_RADIUS_ARCSEC = 30.0
EDGE_PX = 5
CLEAN_RADIUS_PX = 2.5


def safe(name: str) -> str:
    return name.replace(":", "_").replace("/", "_")


def write_json(path: Path, payload) -> None:
    _write_atomic(path, (json.dumps(payload, indent=1) + "\n").encode())


# ---------------------------------------------------------------- plan and fetch


def plan() -> dict:
    """Exposures per field and band: usable, in the band window, training role only, spread in time."""
    chosen = {}
    for key in FIELDS:
        investigation = json.loads((DATA / key / "investigation.json").read_text())
        for band, spec in BANDS.items():
            low, high = spec["window_um"]
            candidates = [
                o for o in investigation["observations"]
                if o.get("detector") == spec["detector"] and o.get("url") and o.get("source_sha256")
                and (o.get("response") or {}).get("centre_um") is not None
                and low <= o["response"]["centre_um"] <= high
                and (o.get("quality") or {}).get("usable", True)
                and o.get("role", "training") in ("training", None)
                and "allwise" not in o.get("collection", "")
            ]
            candidates.sort(key=lambda o: o["t_start_mjd"])
            if len(candidates) > N_EXPOSURES:
                picks = np.unique(np.linspace(0, len(candidates) - 1, N_EXPOSURES).round().astype(int))
                candidates = [candidates[i] for i in picks]
            chosen[f"{key}/{band}"] = [
                {"field_key": key, "band_id": band, "obs_key": o["obs_key"], "url": o["url"],
                 "source_sha256": o["source_sha256"], "t_mjd": o["t_start_mjd"],
                 "centre_um": o["response"]["centre_um"], "width_um": o["response"].get("width_um"),
                 "role": o.get("role", "challenge field")}
                for o in candidates
            ]
    write_json(WORK / "plan.json", chosen)
    return chosen


def source_path(entry: dict) -> Path:
    return WORK / "source" / f"{safe(entry['obs_key'])}__{entry['source_sha256'][:10]}.fits"


def fetch(chosen: dict) -> dict:
    entries = [entry for group in chosen.values() for entry in group]
    status = {}

    def one(entry):
        path = source_path(entry)
        if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == entry["source_sha256"]:
            return entry["obs_key"], "cached"
        with httpx.Client(timeout=180, follow_redirects=True) as client:
            payload = _download(client, entry["url"])
        digest = hashlib.sha256(payload).hexdigest()
        if digest != entry["source_sha256"]:
            return entry["obs_key"], f"sha256 mismatch {digest[:12]}"
        _write_atomic(path, payload)
        return entry["obs_key"], "downloaded"

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for future in concurrent.futures.as_completed([pool.submit(one, e) for e in entries]):
            try:
                key, state = future.result()
            except Exception as error:  # network failure: record, do not stop
                key, state = "?", f"failed: {error}"
            status[key] = state
    write_json(WORK / "fetch.json", status)
    return status


# ---------------------------------------------------------------- catalogues


def cutout_centre(url: str) -> tuple[float, float, float]:
    query = parse_qs(urlparse(url).query)
    ra, dec = (float(v) for v in query["center"][0].split(","))
    return ra, dec, float(query["size"][0])


def vizier(source: str, columns: str, ra: float, dec: float, radius: float) -> tuple[list[list[str]], str]:
    """Rows of a VizieR cone search (CDS, then the CfA mirror: IRSA TAP answered 502/timeouts on 15 Nov)."""
    params = {"-source": source, "-c": f"{ra:.6f} {dec:+.6f}", "-c.rd": f"{radius:.5f}", "-out": columns,
              "-out.max": "unlimited"}
    for attempt in range(3):
        try:
            text, url = catalogs.vizier_asu(params)
            break
        except httpx.HTTPError:
            if attempt == 2:
                raise
            time.sleep(5 * (attempt + 1))
    rows = [line.split("\t") for line in text.splitlines() if line and not line.startswith("#")]
    return rows[3:], url  # header, units, dashes


def catalogue(ra: float, dec: float, size_deg: float) -> dict:
    """All Gaia DR3 and AllWISE sources over the cutout plus the exclusion radius (VizieR, cached)."""
    path = WORK / "catalogue" / f"{ra:.5f}_{dec:.5f}_{size_deg:.4f}.json"
    if path.exists():
        return json.loads(path.read_text())
    radius = size_deg / 2 * math.sqrt(2) + CATALOGUE_RADIUS_ARCSEC / 3600

    def number(value):
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    gaia, gaia_url = vizier("I/355/gaiadr3", "RA_ICRS,DE_ICRS,Gmag", ra, dec, radius)
    wise, wise_url = vizier("II/328/allwise", "RAJ2000,DEJ2000,W1mag,W2mag", ra, dec, radius)
    result = {
        "gaia": [[number(r[0]), number(r[1]), number(r[2])] for r in gaia if len(r) >= 3],
        "allwise": [[number(r[0]), number(r[1]), number(r[2]), number(r[3])] for r in wise if len(r) >= 4],
        "sources": {"gaia": f"Gaia DR3 (VizieR I/355/gaiadr3, {gaia_url})",
                    "allwise": f"AllWISE (VizieR II/328/allwise, {wise_url})"},
        "radius_deg": radius,
    }
    write_json(path, result)
    return result


def fetch_catalogues(chosen: dict) -> None:
    centres = sorted({cutout_centre(e["url"]) for group in chosen.values() for e in group})
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda c: catalogue(*c), centres))


# ---------------------------------------------------------------- per-exposure geometry


def load(entry: dict) -> injection.Cutout | None:
    path = source_path(entry)
    if not path.exists():
        return None
    return injection.load_cutout(path.read_bytes())


def catalogue_pixels(cutout: injection.Cutout, entry: dict) -> np.ndarray:
    ra, dec, size = cutout_centre(entry["url"])
    cat = catalogue(ra, dec, size)
    points = [(r[0], r[1]) for r in cat["gaia"] if r[0] is not None] + \
             [(r[0], r[1]) for r in cat["allwise"] if r[0] is not None]
    if not points:
        return np.zeros((0, 2))
    ras, decs = np.array(points).T
    x, y = cutout.product.wcs.all_world2pix(ras, decs, 0)
    return np.column_stack([x, y])


def clean_positions(cutout: injection.Cutout, entry: dict, rng: np.random.Generator, count: int,
                    avoid: list[tuple[float, float]] = ()) -> list[tuple[float, float]]:
    """Random positions with no rejected pixel within 2.5 px, no catalogued source within 15", away from
    the target (the cutout centre) and the edges, and at least 30" from each other."""
    product = cutout.product
    height, width = product.image.shape
    scale = injection.astrometry.pixel_scale_arcsec(product, width / 2, height / 2)
    sources = catalogue_pixels(cutout, entry)
    centre = ((width - 1) / 2, (height - 1) / 2)
    bad_y, bad_x = np.nonzero(product.reject)
    taken = list(avoid)
    out = []
    for _ in range(count * 200):
        if len(out) == count:
            break
        x = rng.uniform(EDGE_PX, width - 1 - EDGE_PX)
        y = rng.uniform(EDGE_PX, height - 1 - EDGE_PX)
        if math.hypot(x - centre[0], y - centre[1]) * scale < TARGET_RADIUS_ARCSEC:
            continue
        if len(sources) and np.min(np.hypot(sources[:, 0] - x, sources[:, 1] - y)) * scale < CATALOGUE_RADIUS_ARCSEC:
            continue
        if len(bad_x) and np.min(np.hypot(bad_x - x, bad_y - y)) < CLEAN_RADIUS_PX:
            continue
        if not np.isfinite(product.variance[int(round(y)), int(round(x))]):
            continue
        if any(math.hypot(x - a, y - b) * scale < 2 * CATALOGUE_RADIUS_ARCSEC for a, b in taken):
            continue
        taken.append((x, y))
        out.append((x, y))
    return out


# ---------------------------------------------------------------- PSF zone mapping test


def _fit_epsf(cutout, row, data, variance, ys, xs, x0, y0):
    def model(params):
        amplitude, x, y, sky = params
        stamp, sx, sy = injection.render(cutout.epsf, row, x, y)
        full = np.zeros((len(ys), len(xs)))
        ox, oy = sx[0] - xs[0], sy[0] - ys[0]
        for j in range(stamp.shape[0]):
            for i in range(stamp.shape[1]):
                if 0 <= oy + j < len(ys) and 0 <= ox + i < len(xs):
                    full[oy + j, ox + i] = stamp[j, i]
        return amplitude * full + sky

    flux0 = float(np.sum(data - np.median(data)))
    fit = least_squares(lambda p: ((model(p) - data) / np.sqrt(variance)).ravel(),
                        [max(flux0, 1e-6), x0, y0, float(np.median(data))],
                        bounds=([0, x0 - 1, y0 - 1, -np.inf], [np.inf, x0 + 1, y0 + 1, np.inf]))
    return float(np.sum(fit.fun ** 2)), fit.x


def psf_mapping_test(chosen: dict) -> dict:
    """Real stars: (a) does the nearest-centre ePSF zone fit better than the x/y-swapped zone; (b) how much
    the zone choice could change the depth (optimal S/N with either zone); (c) does the site's own fit find
    real stars of a given measured brightness as often as it finds injected ones (realism check).

    A star is used if it is at least 6 px from the edges, has no rejected pixel in its 7 x 7 box, and has no
    catalogued neighbour within 20" that is brighter than G + 3 (Gaia) or than W1 = 15 (AllWISE, Vega)."""
    rows, tables, depth_effect = [], {}, []
    for group in chosen.values():
        for entry in group:
            cutout = load(entry)
            if cutout is None:
                continue
            epsf = cutout.epsf
            tables[entry["obs_key"]] = {"zones": [epsf.nx, epsf.ny], "oversampling": epsf.oversampling,
                                        "ordering": epsf.ordering, "ordering_consistent": injection.ordering_consistent(epsf),
                                        "calibration": epsf.calibration}
            product = cutout.product
            height, width = product.image.shape
            centre_row = injection.zone_row(epsf, *injection.parent_pixel(cutout.header, width / 2, height / 2))
            swapped_centre = injection.transposed_row(epsf, centre_row)
            if swapped_centre is not None and swapped_centre != centre_row:
                snr = []
                for row in (centre_row, swapped_centre):
                    stamp, _, _ = injection.render(epsf, row, width / 2, height / 2)
                    snr.append(float(np.sqrt(np.sum(stamp ** 2))))
                depth_effect.append({"band_id": entry["band_id"], "delta_mag": round(2.5 * math.log10(snr[0] / snr[1]), 4),
                                     "neff_ratio": round(float(snr[1] / snr[0]) ** 2, 4)})
            ra, dec, size = cutout_centre(entry["url"])
            cat = catalogue(ra, dec, size)
            gaia = np.array([r for r in cat["gaia"] if r[0] is not None and r[2] is not None])
            wise = np.array([r[:3] for r in cat["allwise"] if r[0] is not None and r[2] is not None])
            gx, gy = product.wcs.all_world2pix(gaia[:, 0], gaia[:, 1], 0) if len(gaia) else (np.array([]), np.array([]))
            wx, wy = product.wcs.all_world2pix(wise[:, 0], wise[:, 1], 0) if len(wise) else (np.array([]), np.array([]))
            scale = injection.astrometry.pixel_scale_arcsec(product, width / 2, height / 2)
            for k in range(len(gaia)):
                g = gaia[k, 2]
                if not (9.0 <= g <= 17.5):
                    continue
                x, y = float(gx[k]), float(gy[k])
                if not (6 <= x <= width - 7 and 6 <= y <= height - 7):
                    continue
                dg = np.hypot(gx - x, gy - y) * scale
                if np.any((dg > 2.0) & (dg < 20.0) & (gaia[:, 2] < g + 3.0)):
                    continue
                dw = np.hypot(wx - x, wy - y) * scale
                if np.any((dw > 3.0) & (dw < 20.0) & (wise[:, 2] < 15.0)):
                    continue
                ix, iy = int(round(x)), int(round(y))
                ys, xs = np.arange(iy - 3, iy + 4), np.arange(ix - 3, ix + 4)
                if product.reject[np.ix_(ys, xs)].any():
                    continue
                data = (product.image[np.ix_(ys, xs)] - product.zodi[np.ix_(ys, xs)]).astype(np.float64)
                variance = product.variance[np.ix_(ys, xs)].astype(np.float64)
                if not (np.all(np.isfinite(data)) and np.all(variance > 0)):
                    continue
                right = injection.zone_row(epsf, *injection.parent_pixel(cutout.header, x, y))
                swapped = injection.transposed_row(epsf, right)
                chi_right, params = _fit_epsf(cutout, right, data, variance, ys, xs, x, y)
                flux_jy = params[0] * injection.pixel_solid_angle_sr(product, params[1], params[2]) * 1e6
                site = injection.recover(product, x, y, SNR_MIN, MAX_OFFSET_PX)
                row = {"obs_key": entry["obs_key"], "band_id": entry["band_id"], "g": round(float(g), 3),
                       "zone": [int(epsf.binx[right]), int(epsf.biny[right])], "dof": 49 - 4,
                       "chi2_nearest": round(chi_right, 2),
                       "mag_ab_measured": round(injection.jy_to_ab(flux_jy), 3) if flux_jy > 0 else None,
                       "site_found": site.found, "site_reason": site.reason_key}
                if swapped is not None and swapped != right:
                    chi_swapped, _ = _fit_epsf(cutout, swapped, data, variance, ys, xs, x, y)
                    row.update({"swapped_zone": [int(epsf.binx[swapped]), int(epsf.biny[swapped])],
                                "chi2_swapped": round(chi_swapped, 2)})
                rows.append(row)
    compared = [r for r in rows if "chi2_swapped" in r]
    k, n = sum(r["chi2_nearest"] < r["chi2_swapped"] for r in compared), len(compared)
    by_band = {}
    for band in BANDS:
        sub = [r for r in compared if r["band_id"] == band]
        effects = [d["delta_mag"] for d in depth_effect if d["band_id"] == band]
        reduced = [r["chi2_nearest"] / r["dof"] for r in rows if r["band_id"] == band]
        by_band[band] = {"stars": len(sub), "nearest_better": sum(r["chi2_nearest"] < r["chi2_swapped"] for r in sub),
                         "median_chi2_dof_nearest": round(float(np.median(reduced)), 2) if reduced else None,
                         "zone_choice_depth_effect_mag": {"median_abs": round(float(np.median(np.abs(effects))), 4),
                                                           "max_abs": round(float(np.max(np.abs(effects))), 4)} if effects else None}
    ratios = [r["chi2_swapped"] / r["chi2_nearest"] for r in compared if r["chi2_nearest"] > 0]
    result = {"stars": n, "nearest_better": k, "fraction": round(k / n, 3) if n else None,
              "interval": [round(v, 3) for v in injection.wilson(k, n)] if n else None,
              "median_chi2_ratio_swapped_over_nearest": round(float(np.median(ratios)), 3) if ratios else None,
              "by_band": by_band,
              "selection": "G 9-17.5; >= 6 px from edges; no rejected pixel in 7x7; no Gaia neighbour within 20\" "
                           "brighter than G+3 and no AllWISE neighbour within 20\" brighter than W1 = 15 (Vega)",
              "tables": {"files": len(tables), "ordering_consistent": sum(t["ordering_consistent"] for t in tables.values()),
                         "zone_grids": sorted({tuple(t["zones"]) for t in tables.values()}),
                         "oversampling": sorted({t["oversampling"] for t in tables.values()}),
                         "calibrations": sorted({t["calibration"] for t in tables.values()})},
              "rows": rows}
    write_json(WORK / "psftest.json", result)
    return result


# ---------------------------------------------------------------- injection-recovery


def magnitude_grid(chosen: dict) -> dict:
    """Per band, 0.25-mag steps from optimal S/N ~ 300 to ~ 2 (spans full to zero recovery for the site's fit,
    which plateaus below 100% until about 4 mag brighter than the optimal 5-sigma level)."""
    grids = {}
    for band in BANDS:
        m5 = []
        for key in FIELDS:
            for entry in chosen.get(f"{key}/{band}", []):
                cutout = load(entry)
                if cutout is None:
                    continue
                height, width = cutout.product.image.shape
                rng = np.random.default_rng(SEED)
                spots = clean_positions(cutout, entry, rng, 3)
                if not spots:
                    continue
                snr = np.median([injection.matched_snr(cutout, x, y, 16.0) for x, y in spots])
                m5.append(16.0 + 2.5 * math.log10(snr / SNR_MIN))
        low = math.floor((min(m5) - 4.5) / MAG_STEP) * MAG_STEP
        high = math.ceil((max(m5) + 1.0) / MAG_STEP) * MAG_STEP
        grids[band] = {"mags": [round(m, 2) for m in np.arange(low, high + 1e-9, MAG_STEP)],
                       "optimal_m5_range": [round(min(m5), 2), round(max(m5), 2)]}
    return grids


def run_exposure(job: tuple) -> dict:
    """One exposure: injections at every grid magnitude at each clean position, plus blank controls."""
    entry, index, mags = job
    cutout = load(entry)
    if cutout is None:
        return {"exposure": {**entry, "status": "not downloaded"}, "trials": [], "blanks": [], "photometry": []}
    rng = np.random.default_rng([SEED, FIELDS.index(entry["field_key"]), list(BANDS).index(entry["band_id"]), index])
    spots = clean_positions(cutout, entry, rng, N_POSITIONS)
    blank_spots = clean_positions(cutout, entry, rng, N_BLANKS, avoid=spots)
    product = cutout.product
    zodi = [float(product.zodi[int(round(y)), int(round(x))]) for x, y in spots + blank_spots]
    exposure = {**entry, "status": "used", "positions": len(spots), "blanks": len(blank_spots),
                "zodi_mjy_sr": round(float(np.median(zodi)), 5) if zodi else None,
                "psf_fwhm_arcsec": product.info.get("PSF_FWHM"), "epsf_calibration": cutout.epsf.calibration}
    trials, blanks, photometry = [], [], []
    for x, y in blank_spots:
        result = injection.recover(product, x, y, SNR_MIN, MAX_OFFSET_PX)
        blanks.append({"field_key": entry["field_key"], "band_id": entry["band_id"], "obs_key": entry["obs_key"],
                       "found": result.found, "snr": None if result.snr is None else round(float(result.snr), 2)})
    for x, y in spots:
        optimal_16 = injection.matched_snr(cutout, x, y, 16.0)
        checked = False
        for mag in mags:
            injected = injection.inject(cutout, [(x, y, mag)])
            result = injection.recover(injected, x, y, SNR_MIN, MAX_OFFSET_PX)
            trials.append({"field_key": entry["field_key"], "band_id": entry["band_id"], "obs_key": entry["obs_key"],
                           "mag_ab": mag, "found": result.found,
                           "found_site": bool(result.found and (result.snr or 0) >= SITE_SNR_MIN),
                           "snr": None if result.snr is None else round(float(result.snr), 2),
                           "optimal_snr": round(optimal_16 * 10 ** (-0.4 * (mag - 16.0)), 2),
                           "offset_px": None if result.offset_px is None else round(result.offset_px, 3)})
            if not checked and optimal_16 * 10 ** (-0.4 * (mag - 16.0)) <= 30:
                checked = True  # flux check at the brightest grid magnitude with optimal S/N <= 30
                flux, error = injection.psf_photometry(cutout, injected, x, y)  # noise and background included
                photometry.append({"band_id": entry["band_id"], "obs_key": entry["obs_key"], "mag_in": mag,
                                   "flux_in_ujy": round(injection.ab_to_jy(mag) * 1e6, 4),
                                   "flux_out_ujy": round(flux * 1e6, 4), "sigma_ujy": round(error * 1e6, 4),
                                   "pull": round((flux - injection.ab_to_jy(mag)) / error, 3),
                                   "mag_out": round(injection.jy_to_ab(flux), 4) if flux > 0 else None})
    return {"exposure": exposure, "trials": trials, "blanks": blanks, "photometry": photometry}


def run(chosen: dict) -> dict:
    grids = magnitude_grid(chosen)
    jobs = [(entry, index, grids[entry["band_id"]]["mags"]) for group in chosen.values()
            for index, entry in enumerate(group)]
    trials, blanks, photometry, exposures = [], [], [], []
    with concurrent.futures.ProcessPoolExecutor(max_workers=6) as pool:
        for done, part in enumerate(pool.map(run_exposure, jobs), start=1):
            exposures.append(part["exposure"])
            trials += part["trials"]
            blanks += part["blanks"]
            photometry += part["photometry"]
            if done % 10 == 0:
                print(f"{done}/{len(jobs)} exposures", flush=True)
    result = {"grids": grids, "exposures": exposures, "trials": trials, "blanks": blanks, "photometry": photometry,
              "settings": {"seed": SEED, "positions_per_exposure": N_POSITIONS, "blanks_per_exposure": N_BLANKS,
                           "snr_min": SNR_MIN, "site_snr_min": SITE_SNR_MIN, "max_offset_px": MAX_OFFSET_PX}}
    write_json(WORK / "run.json", result)
    return result


def main(argv: list[str]) -> int:
    stage = argv[0] if argv else "all"
    chosen = plan() if stage in ("plan", "all") or not (WORK / "plan.json").exists() else \
        json.loads((WORK / "plan.json").read_text())
    if stage in ("fetch", "all"):
        status = fetch(chosen)
        print({state: sum(1 for s in status.values() if s == state) for state in set(status.values())})
    if stage in ("catalogue", "all"):
        fetch_catalogues(chosen)
    if stage in ("psftest", "all"):
        result = psf_mapping_test(chosen)
        print({k: v for k, v in result.items() if k != "rows"})
    if stage in ("run", "all"):
        result = run(chosen)
        print(len(result["trials"]), "trials,", len(result["blanks"]), "blanks")
    if stage in ("build", "all"):
        from scripts import planetx_build
        planetx_build.build()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
