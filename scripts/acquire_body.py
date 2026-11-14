"""Object-following acquisition for Makemake and Pluto: TRAINING VISITS ONLY.

Usage: python -m scripts.acquire_body <makemake|pluto> [--size 0.05]

Each cutout is centred on the body's JPL Horizons position at that exposure
(docs/exposure/<key>.json, metadata only). Rows inside the holdout window (the newest
visit, reserved for Task A4) are refused before any request is made. Also downloads a
fixed-sky pair: two exposures of one array in one visit, cut out around their midpoint.
"""
import argparse
import hashlib
import json
import math
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
import numpy as np

from backend import archive, config
from backend.processing import Grid, display_native, load_product, reproject, response_at, trim_product
from scripts.build_reserved import HOLDOUT_WINDOWS_MJD

ROOT = Path(__file__).resolve().parent.parent
FIXED_PAIR_MIN_ARCSEC, FIXED_PAIR_MAX_ARCSEC = 45.0, 150.0


class HoldoutViolation(RuntimeError):
    pass


def training_rows(key: str) -> list[dict]:
    inventory = json.loads((ROOT / "docs" / "exposure" / f"{key}.json").read_text())
    low, _ = HOLDOUT_WINDOWS_MJD[key]
    rows = [row for row in inventory["candidate_rows"] if row["t_min_mjd"] < low - 1.0]
    for row in rows:
        check_not_holdout(key, row["t_min_mjd"])
    return sorted(rows, key=lambda row: (row["t_min_mjd"], row["detector"]))


def check_not_holdout(key: str, mjd: float) -> None:
    low, high = HOLDOUT_WINDOWS_MJD[key]
    if mjd >= low - 1.0:
        raise HoldoutViolation(f"{key}: exposure at MJD {mjd} is in or after the reserved holdout window")


def to_exposure(row: dict) -> archive.Exposure:
    url = row["access_url_not_opened"]
    return archive.Exposure(
        obs_id=row["obs_id"], detector=row["detector"], mjd=row["t_min_mjd"], wave_min_um=row["em_min_um"],
        wave_max_um=row["em_max_um"], url=url, collection=row["collection"], mjd_end=row["t_max_mjd"],
        processing=archive.parse_processing(url), release_date=row.get("obs_release_date"),
    )


def folder_for(key: str) -> Path:
    return config.CACHE_DIR / "bodies" / key


def process(client, key: str, row: dict, ra: float, dec: float, size: float, kind: str) -> dict:
    check_not_holdout(key, row["t_min_mjd"])
    exposure = to_exposure(row)
    url = archive.cutout_url(exposure, ra, dec, size)
    name = f"{kind}__{archive.exposure_key(exposure)}__{hashlib.sha256(url.encode()).hexdigest()[:8]}"
    native_path = folder_for(key) / "native" / f"{name}.fits"
    frame_path = folder_for(key) / "frames" / f"{name}.npz"
    meta_path = folder_for(key) / "meta" / f"{name}.json"
    if meta_path.exists():
        return json.loads(meta_path.read_text())
    payload = archive.fetch_cutout(client, exposure, ra, dec, size)
    sha = hashlib.sha256(payload).hexdigest()
    product = load_product(payload)
    grid = Grid.for_fov(ra, dec, size / config.CUTOUT_MARGIN)
    pixels, mask = reproject(display_native(product), grid)
    response = response_at(product, ra, dec, exposure.detector)
    for path in (native_path, frame_path, meta_path):
        path.parent.mkdir(parents=True, exist_ok=True)
    native_path.write_bytes(trim_product(payload, sha))
    np.savez_compressed(frame_path, pixels=pixels, mask=mask)
    meta = {
        "kind": kind, "obsKey": exposure.obs_key, "obsId": exposure.obs_id, "detector": exposure.detector,
        "release": exposure.collection, "processing": exposure.processing, "mjd": exposure.mjd,
        "mjdEnd": exposure.mjd_end, "centre": {"ra_deg": ra, "dec_deg": dec, "source": "JPL Horizons (inventory)"},
        "grid": {"ra": grid.ra, "dec": grid.dec, "fov": grid.fov, "n": grid.n, "scale": grid.scale},
        "response": response.to_json() if response else None,
        "flagSchema": product.flag_schema.schema, "maskPolicy": product.flag_schema.policy,
        "source": {"url": url, "sha256": sha, "bytes": len(payload), "software": product.software_version,
                   "native": str(native_path.relative_to(config.CACHE_DIR))},
        "frame": str(frame_path.relative_to(config.CACHE_DIR)),
        "l2dqa": product.info.get("L2DQAFLG"),
    }
    meta_path.write_text(json.dumps(meta))
    return meta


def fixed_pair(rows: list[dict]) -> tuple[dict, dict] | None:
    """Two exposures of one array in one visit, 45-150 arcsec of body motion apart; earliest such pair."""
    for index, first in enumerate(rows):
        for second in rows[index + 1:]:
            if second["detector"] != first["detector"] or second["t_min_mjd"] - first["t_min_mjd"] > 10:
                continue
            dra = (second["target_ra_at_time"] - first["target_ra_at_time"]) * math.cos(math.radians(first["target_dec_at_time"]))
            ddec = second["target_dec_at_time"] - first["target_dec_at_time"]
            if FIXED_PAIR_MIN_ARCSEC <= math.hypot(dra, ddec) * 3600 <= FIXED_PAIR_MAX_ARCSEC:
                return first, second
    return None


def acquire(key: str, size: float) -> dict:
    rows = training_rows(key)
    done, failed = [], []
    with httpx.Client(timeout=config.HTTP_TIMEOUT_SECONDS, follow_redirects=True) as client:
        with ThreadPoolExecutor(config.DOWNLOAD_WORKERS) as pool:
            futures = [pool.submit(process, client, key, row, row["target_ra_at_time"], row["target_dec_at_time"],
                                   size, "follow") for row in rows]
            for row, future in zip(rows, futures):
                try:
                    done.append(future.result())
                except Exception as error:  # noqa: BLE001 - one bad exposure must not stop the rest
                    failed.append({"obs_key": f"{row['collection']}:{row['obs_id']}:D{row['detector']}", "error": str(error)[:200]})
        pair = fixed_pair(rows)
        pair_meta = []
        if pair:
            ra = (pair[0]["target_ra_at_time"] + pair[1]["target_ra_at_time"]) / 2
            dec = (pair[0]["target_dec_at_time"] + pair[1]["target_dec_at_time"]) / 2
            for row in pair:
                pair_meta.append(process(client, key, row, ra, dec, 0.1 * config.CUTOUT_MARGIN, "fixed"))
    summary = {"key": key, "rows": len(rows), "processed": len(done), "failed": failed, "fixed_pair": len(pair_meta),
               "mjd_range": [rows[0]["t_min_mjd"], rows[-1]["t_min_mjd"]] if rows else None}
    (folder_for(key) / "acquire-summary.json").write_text(json.dumps(summary, indent=1))
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("key", choices=sorted(HOLDOUT_WINDOWS_MJD))
    parser.add_argument("--size", type=float, default=0.05 * config.CUTOUT_MARGIN)
    args = parser.parse_args()
    result = acquire(args.key, args.size)
    print(json.dumps({k: v for k, v in result.items() if k != "failed"} | {"n_failed": len(result["failed"])}))
