"""Exposure inventory for the TENGER targets. Metadata only.

What the team has already opened ("exposed") is collected from:
  * every committed version of static/data/<key>/meta.json (published on the public site),
  * names of processed frame caches under data/frames/<job id>/ (current and in git history),
  * the earlier audit's downloaded cutouts (docs/tenger-context/context/verification-results.json).

With --network the script also lists current-release observations from public services:
  * IRSA SIA v2 for the DR1/QR3 wide and deep collections (listing rows only),
  * JPL Horizons ephemerides for Makemake and Pluto (object-following search),
  * the official IRSA 3I/ATLAS observation table (VOTable).

It never requests an access_url, a cutout or any pixels. Exposure is keyed by obs_id, not by
(obs_id, detector): SPHEREx's six arrays see the same field at the same time, so opening one array
reveals the target's position at that time for the other five.

Usage: python -m scripts.exposure_inventory --network --out docs/exposure
"""
import argparse
import concurrent.futures
import csv
import hashlib
import io
import json
import math
import re
import subprocess
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import httpx
from astropy.time import Time

from backend.coords import propagate
from backend.jobs import job_id
from backend.presets import PRESETS

ROOT = Path(__file__).resolve().parent.parent
SIA_URL = "https://irsa.ipac.caltech.edu/SIA"
HORIZONS_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"
COMET_TABLE_URL = "https://irsa.ipac.caltech.edu/data/SPHEREx/docs/comet3iatlas/obscore_3I_Atlas.vot"
AUDIT_FILE = ROOT / "docs/tenger-context/context/verification-results.json"
SCHEMA = "tenger.exposure_inventory/1"
SIA_COLUMNS = (
    "obs_id", "energy_bandpassname", "em_min", "em_max", "t_min", "t_max", "t_exptime",
    "obs_collection", "s_region", "access_url", "obs_release_date", "obs_publisher_did",
)
CURRENT_COLLECTIONS = ("spherex_dr1", "spherex_dr1_deep", "spherex_qr3", "spherex_qr3_deep")
FIXED_RADIUS_DEG = 0.005
MOVING_WINDOW_DAYS = 20
EPHEMERIS_START = "2025-04-15"
VISIT_GAP_DAYS = 10.0  # observations closer than this are treated as one visit
SOLAR_SYSTEM = {
    "makemake": {"name": "Makemake", "horizons": "136472", "kind": "dwarfplanet"},
    "pluto": {"name": "Pluto", "horizons": "999", "kind": "dwarfplanet"},
}
COMET = {"key": "3i_atlas", "name": "3I/ATLAS", "kind": "comet"}
CACHE_NAME = re.compile(r"^(?P<obs>.+)_D(?P<det>[1-6])_(?P<rel>-?\d+)\.npz$")
AUDIT_URL = re.compile(r"/spherex/(?P<rel>\w+)/level2/.+/level2_(?P<obs>.+)D(?P<det>[1-6])_spx")
METRES_TO_UM = 1e6


def utc(mjd: float) -> str:
    return Time(mjd, format="mjd", scale="utc").isot[:19] + "Z"


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout


# ---------------------------------------------------------------- exposed set (offline)

def bundled_frames(key: str) -> dict[str, dict]:
    """Every frame in any committed or working-tree version of the target's meta.json."""
    path = f"static/data/{key}/meta.json"
    versions = []
    commits = git("log", "--all", "--format=%H", "--", path).split()
    for commit in commits:
        try:
            versions.append((f"git:{commit[:7]}", json.loads(git("show", f"{commit}:{path}"))))
        except (subprocess.CalledProcessError, json.JSONDecodeError):
            continue
    working = ROOT / path
    if working.exists():
        versions.append(("working-tree", json.loads(working.read_text())))
    found: dict[str, dict] = {}
    for label, meta in versions:
        for frame in meta.get("frames", []):
            entry = found.setdefault(frame["obsId"], {
                "obs_id": frame["obsId"], "mjd": frame["mjd"], "detectors": set(), "releases": set(),
                "wavelengths_um": set(), "sources": set(),
            })
            entry["detectors"].add(frame["detector"])
            entry["releases"].add(frame.get("release", "unknown"))
            if frame.get("wavelength") is not None:
                entry["wavelengths_um"].add(round(frame["wavelength"], 3))
            entry["sources"].add("bundled_static_data")
    return found, len(versions), [c[:7] for c in commits]


def cached_frames(preset) -> dict[str, dict]:
    """Processed NPZ frames in data/frames for this target's job, now or in git history."""
    ra, dec = preset.centre()
    folder = f"data/frames/{job_id(ra, dec, preset.fov)}"
    names = set(git("log", "--all", "--name-only", "--format=", "--", folder).split())
    names |= {f"{folder}/{p.name}" for p in (ROOT / folder).glob("*.npz")}
    found: dict[str, dict] = {}
    for name in names:
        match = CACHE_NAME.match(Path(name).name)
        if not match:
            continue
        rel = int(match["rel"])
        entry = found.setdefault(match["obs"], {
            "obs_id": match["obs"], "detectors": set(), "releases": set(), "sources": set(),
        })
        entry["detectors"].add(int(match["det"]))
        entry["releases"].add(f"spherex_qr{rel}" if rel >= 0 else "non-qr (release number -1)")
        entry["sources"].add("processed_frame_cache")
    return found, folder


def audit_cutouts() -> list[dict]:
    if not AUDIT_FILE.exists():
        return []
    record = json.loads(AUDIT_FILE.read_text())
    found = []
    for cutout in record.get("cutouts", []):
        match = AUDIT_URL.search(cutout.get("url", ""))
        if match and str(cutout.get("http")) == "200":
            centre = re.search(r"center=([-\d.]+),([-\d.]+)", cutout["url"])
            found.append({
                "obs_id": match["obs"], "detector": int(match["det"]), "release": match["rel"],
                "ra": float(centre[1]), "dec": float(centre[2]), "url": cutout["url"],
            })
    return found


def search_cache_mjds(preset) -> dict[str, float]:
    """MJD per obs_id from the cached search listing (metadata only, not an exposure)."""
    ra, dec = preset.centre()
    path = ROOT / "data/search" / f"{ra:.4f}_{dec:.4f}.json"
    if not path.exists():
        return {}
    return {row["obs_id"]: row["mjd"] for row in json.loads(path.read_text())}


# ---------------------------------------------------------------- geometry

def unit(ra: float, dec: float) -> tuple[float, float, float]:
    a, d = math.radians(ra), math.radians(dec)
    return (math.cos(d) * math.cos(a), math.cos(d) * math.sin(a), math.sin(d))


def separation_deg(ra1, dec1, ra2, dec2) -> float:
    u, v = unit(ra1, dec1), unit(ra2, dec2)
    dot = max(-1.0, min(1.0, sum(a * b for a, b in zip(u, v))))
    return math.degrees(math.acos(dot))


def parse_polygon(region: str) -> list[tuple[float, float]]:
    numbers = [float(x) for x in re.findall(r"[-+]?\d+\.?\d*(?:[eE][-+]?\d+)?", region)]
    return list(zip(numbers[0::2], numbers[1::2]))


def inside_polygon(ra: float, dec: float, vertices: list[tuple[float, float]]) -> bool:
    """Gnomonic projection about the polygon centre, then even-odd ray casting."""
    if len(vertices) < 3:
        return False
    vectors = [unit(*v) for v in vertices]
    cx, cy, cz = (sum(c) for c in zip(*vectors))
    norm = math.sqrt(cx * cx + cy * cy + cz * cz)
    c = (cx / norm, cy / norm, cz / norm)
    east = (-c[1], c[0], 0.0)
    east_norm = math.hypot(east[0], east[1]) or 1e-12
    east = (east[0] / east_norm, east[1] / east_norm, 0.0)
    north = (c[1] * east[2] - c[2] * east[1], c[2] * east[0] - c[0] * east[2], c[0] * east[1] - c[1] * east[0])

    def project(v):
        depth = sum(a * b for a, b in zip(v, c))
        if depth <= 0:
            return None
        return (sum(a * b for a, b in zip(v, east)) / depth, sum(a * b for a, b in zip(v, north)) / depth)

    points = [project(v) for v in vectors]
    target = project(unit(ra, dec))
    if target is None or any(p is None for p in points):
        return False
    x, y = target
    inside = False
    for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


# ---------------------------------------------------------------- network (metadata only)

def sia(client: httpx.Client, collection: str, ra: float, dec: float, radius: float,
        time_range: tuple[float, float] | None = None) -> list[dict]:
    params = {
        "COLLECTION": collection, "POS": f"CIRCLE {ra} {dec} {radius}",
        "RESPONSEFORMAT": "CSV", "MAXREC": 20000,
    }
    if time_range:
        params["TIME"] = f"{time_range[0]} {time_range[1]}"
    for attempt in range(4):
        try:
            response = client.get(SIA_URL, params=params)
            response.raise_for_status()
            break
        except httpx.HTTPError:
            if attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))
    rows = []
    for row in csv.DictReader(io.StringIO(response.text)):
        rows.append({name: row.get(name) for name in SIA_COLUMNS})
    return rows


def horizons(client: httpx.Client, command: str, stop: str) -> list[tuple[float, float, float]]:
    params = {
        "format": "json", "COMMAND": f"'{command}'", "OBJ_DATA": "'NO'", "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'", "CENTER": "'500@399'", "START_TIME": f"'{EPHEMERIS_START}'",
        "STOP_TIME": f"'{stop}'", "STEP_SIZE": "'1d'", "QUANTITIES": "'1'", "ANG_FORMAT": "'DEG'",
        "CSV_FORMAT": "'YES'", "TIME_DIGITS": "'MINUTES'",
    }
    response = client.get(HORIZONS_URL, params=params)
    response.raise_for_status()
    text = response.json()["result"]
    body = text.split("$$SOE")[1].split("$$EOE")[0]
    track = []
    for line in body.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        stamp = datetime.strptime(parts[0], "%Y-%b-%d %H:%M")
        track.append((Time(stamp, scale="utc").mjd, float(parts[3]), float(parts[4])))
    return track


def interpolate(track, mjd: float) -> tuple[float, float]:
    for (t1, ra1, dec1), (t2, ra2, dec2) in zip(track, track[1:]):
        if t1 <= mjd <= t2:
            f = (mjd - t1) / (t2 - t1)
            dra = ((ra2 - ra1 + 180) % 360) - 180
            return ((ra1 + f * dra) % 360, dec1 + f * (dec2 - dec1))
    raise ValueError("time outside ephemeris")


def comet_table(client: httpx.Client) -> list[dict]:
    from astropy.io.votable import parse_single_table

    response = client.get(COMET_TABLE_URL)
    response.raise_for_status()
    table = parse_single_table(io.BytesIO(response.content)).to_table()
    rows = []
    for row in table:
        record = {name: (row[name].item() if hasattr(row[name], "item") else row[name]) for name in table.colnames}
        rows.append({k: (v.decode() if isinstance(v, bytes) else v) for k, v in record.items()})
    return rows, table.colnames


# ---------------------------------------------------------------- assembly

def row_record(row: dict, position: tuple[float, float]) -> dict:
    t_min, t_max = float(row["t_min"]), float(row["t_max"])
    det = re.match(r"SPHEREx-D([1-6])", row["energy_bandpassname"] or "")
    return {
        "obs_id": row["obs_id"],
        "detector": int(det[1]) if det else None,
        "collection": row["obs_collection"],
        "t_min_mjd": t_min,
        "t_max_mjd": t_max,
        "t_min_utc": utc(t_min),
        "em_min_um": round(float(row["em_min"]) * METRES_TO_UM, 4),
        "em_max_um": round(float(row["em_max"]) * METRES_TO_UM, 4),
        "obs_release_date": row["obs_release_date"],
        "target_ra_at_time": round(position[0], 6),
        "target_dec_at_time": round(position[1], 6),
        "access_url_not_opened": row["access_url"],
    }


def group_visits(rows: list[dict]) -> list[list[dict]]:
    ordered = sorted(rows, key=lambda r: r["t_min_mjd"])
    visits: list[list[dict]] = []
    for row in ordered:
        if visits and row["t_min_mjd"] - visits[-1][-1]["t_min_mjd"] <= VISIT_GAP_DAYS:
            visits[-1].append(row)
        else:
            visits.append([row])
    return visits


def summarise_candidates(rows: list[dict], exposed_mjds: list[float]) -> dict:
    newest = max(exposed_mjds) if exposed_mjds else None
    visits = []
    for members in group_visits(rows):
        start, end = members[0]["t_min_mjd"], members[-1]["t_max_mjd"]
        gap = min((min(abs(m - start), abs(m - end)) for m in exposed_mjds), default=None)
        overlaps = any(start - VISIT_GAP_DAYS <= m <= end + VISIT_GAP_DAYS for m in exposed_mjds)
        visits.append({
            "start_utc": utc(start), "end_utc": utc(end),
            "start_mjd": start, "end_mjd": end,
            "obs_ids": len({m["obs_id"] for m in members}),
            "rows": len(members),
            "detectors": sorted({m["detector"] for m in members if m["detector"]}),
            "collections": dict(Counter(m["collection"] for m in members)),
            "nearest_exposed_days": None if gap is None else round(gap, 2),
            "shares_visit_window_with_exposed": overlaps,
            "after_newest_exposed": newest is None or start > newest,
        })
    return {
        "rows": len(rows),
        "obs_ids": len({r["obs_id"] for r in rows}),
        "after_newest_exposed_obs_ids": len({r["obs_id"] for r in rows if newest is None or r["t_min_mjd"] > newest}),
        "visits": visits,
    }


def finalise_exposed(found: dict[str, dict], mjd_lookup: dict[str, float]) -> list[dict]:
    out = []
    for obs, entry in found.items():
        mjd = entry.get("mjd") or mjd_lookup.get(obs) or _mjd_from_listing(obs, entry)
        out.append({
            "obs_id": obs,
            "mjd": mjd,
            "utc": utc(mjd) if mjd else None,
            "detectors": sorted(entry["detectors"]),
            "releases": sorted(entry["releases"]),
            "wavelengths_um": sorted(entry.get("wavelengths_um", [])),
            "sources": sorted(entry["sources"]),
        })
    return sorted(out, key=lambda e: (e["mjd"] is None, e["mjd"] or 0, e["obs_id"]))


def _mjd_from_listing(obs: str, entry: dict) -> float | None:
    return entry.get("listing_mjd")


def merge(into: dict[str, dict], extra: dict[str, dict]) -> None:
    for obs, entry in extra.items():
        held = into.setdefault(obs, {"obs_id": obs, "detectors": set(), "releases": set(),
                                     "wavelengths_um": set(), "sources": set()})
        for field in ("detectors", "wavelengths_um", "sources"):
            held.setdefault(field, set()).update(entry.get(field, set()))
        # Cache file names drop the wide/deep distinction, so they only fill an empty release list.
        if not held["releases"] or "processed_frame_cache" not in entry.get("sources", set()):
            held["releases"].update(entry.get("releases", set()))
        if entry.get("mjd") and not held.get("mjd"):
            held["mjd"] = entry["mjd"]


def nearby_bundled_fields(ra: float, dec: float, radius_deg: float = 3.0) -> list[dict]:
    targets = json.loads((ROOT / "static/data/targets.json").read_text())
    near = []
    for target in targets:
        sep = separation_deg(ra, dec, target["centreRa"], target["centreDec"])
        if sep <= radius_deg:
            near.append({"key": target["key"], "separation_deg": round(sep, 4)})
    return near


def challenge_target(preset, audit, client, network: bool) -> dict:
    exposed, versions, commits = bundled_frames(preset.key)
    cached, folder = cached_frames(preset)
    merge(exposed, cached)
    ra, dec = preset.centre()
    for cut in audit:
        if separation_deg(ra, dec, cut["ra"], cut["dec"]) < 0.2:
            merge(exposed, {cut["obs_id"]: {"detectors": {cut["detector"]}, "releases": {f"spherex_{cut['release']}"},
                                            "sources": {"prior_audit_cutout"}}})
    listing = search_cache_mjds(preset)
    record = {
        "key": preset.key, "name": preset.name, "kind": preset.kind, "role": "challenge",
        "reference_position": {"ra": preset.ra, "dec": preset.dec, "pmra_mas_yr": preset.pmra,
                               "pmdec_mas_yr": preset.pmdec, "epoch": preset.epoch,
                               "source": "backend/presets.py"},
        "query_centre": {"ra": ra, "dec": dec, "note": "preset position propagated to MJD 61100"},
        "exposed_sources": {"meta_json_versions": versions, "meta_json_commits": commits,
                            "processed_cache_folder": folder, "search_cache_rows": len(listing)},
        "nearby_bundled_fields": nearby_bundled_fields(ra, dec),
    }
    archive_rows = []
    if network:
        for collection in CURRENT_COLLECTIONS:
            for row in sia(client, collection, ra, dec, FIXED_RADIUS_DEG):
                t_mid = (float(row["t_min"]) + float(row["t_max"])) / 2
                position = propagate(preset.ra, preset.dec, preset.pmra, preset.pmdec, preset.epoch, t_mid)
                if inside_polygon(*position, parse_polygon(row["s_region"] or "")):
                    archive_rows.append(row_record(row, position))
    # Fill exposure dates from the current listing for cache-only obs_ids.
    for row in archive_rows:
        listing.setdefault(row["obs_id"], row["t_min_mjd"])
    record["exposed"] = finalise_exposed(exposed, listing)
    return record, archive_rows


def moving_target(key: str, info: dict, client, stop: str) -> tuple[dict, list[dict]]:
    track = horizons(client, info["horizons"], stop)
    archive_rows: list[dict] = []
    t0, t_end = track[0][0], track[-1][0]
    windows = []
    start = t0
    while start < t_end:
        windows.append((start, min(start + MOVING_WINDOW_DAYS, t_end)))
        start += MOVING_WINDOW_DAYS

    def query(window, collection):
        mid = interpolate(track, (window[0] + window[1]) / 2)
        reach = max(separation_deg(*mid, ra, dec) for t, ra, dec in track if window[0] <= t <= window[1])
        return sia(client, collection, mid[0], mid[1], reach + 0.02, window)

    jobs = [(w, c) for w in windows for c in CURRENT_COLLECTIONS]
    seen = set()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for rows in pool.map(lambda job: query(*job), jobs):
            for row in rows:
                ident = (row["obs_id"], row["energy_bandpassname"], row["obs_collection"])
                if ident in seen:
                    continue
                seen.add(ident)
                t_mid = (float(row["t_min"]) + float(row["t_max"])) / 2
                position = interpolate(track, t_mid)
                if inside_polygon(*position, parse_polygon(row["s_region"] or "")):
                    archive_rows.append(row_record(row, position))
    record = {
        "key": key, "name": info["name"], "kind": info["kind"], "role": "extra",
        "ephemeris": {"service": "JPL Horizons", "command": info["horizons"], "center": "500@399 (geocentric)",
                      "start": EPHEMERIS_START, "stop": stop, "step": "1d", "points": len(track),
                      "note": "geocentric approximation to the SPHEREx observer; for coverage only"},
        "exposed_sources": {"meta_json_versions": 0, "processed_cache_folder": None},
        "nearby_bundled_fields": sorted({f["key"]: f for t, ra, dec in track[::10]
                                         for f in nearby_bundled_fields(ra, dec)}.values(), key=lambda f: f["key"]),
        "exposed": [],
    }
    return record, archive_rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--network", action="store_true", help="also list current archive metadata")
    parser.add_argument("--out", default="docs/exposure")
    args = parser.parse_args()
    out = ROOT / args.out
    out.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    stop = now.strftime("%Y-%m-%d")
    audit = audit_cutouts()
    summary = {
        "schema_version": SCHEMA,
        "generated_utc": now.isoformat(timespec="seconds"),
        "git_head": git("rev-parse", "HEAD").strip(),
        "network": args.network,
        "rules": {
            "exposure_key": "obs_id (all six arrays of one exposure count as exposed together)",
            "visit_gap_days": VISIT_GAP_DAYS,
            "collections_listed": list(CURRENT_COLLECTIONS),
            "fixed_target_radius_deg": FIXED_RADIUS_DEG,
            "moving_target_window_days": MOVING_WINDOW_DAYS,
            "pixels_requested": False,
        },
        "targets": {},
    }
    with httpx.Client(timeout=180, follow_redirects=True, headers={"User-Agent": "tenger-exposure-inventory"}) as client:
        for preset in PRESETS:
            record, rows = challenge_target(preset, audit, client, args.network)
            finish(record, rows, out, summary)
            print(f"{preset.key}: exposed {len(record['exposed'])} obs_ids, archive rows {len(rows)}", flush=True)
        if args.network:
            for key, info in SOLAR_SYSTEM.items():
                record, rows = moving_target(key, info, client, stop)
                finish(record, rows, out, summary)
                print(f"{key}: archive rows {len(rows)}", flush=True)
            rows, columns = comet_table(client)
            comet = {"key": COMET["key"], "name": COMET["name"], "kind": COMET["kind"], "role": "see_only",
                     "source": COMET_TABLE_URL, "columns": columns, "rows": len(rows), "exposed": [],
                     "note": "Published SPHEREx team papers (Lisse et al. 2025-2026) already show these data."}
            comet["collections"] = dict(Counter(str(r.get("obs_collection")) for r in rows))
            times = [float(r["t_min"]) for r in rows if r.get("t_min") not in (None, "")]
            if times:
                comet["t_min_utc_range"] = [utc(min(times)), utc(max(times))]
            comet["obs_ids"] = len({r.get("obs_id") for r in rows})
            (out / "3i_atlas.json").write_text(json.dumps(comet, indent=1, default=str) + "\n")
            summary["targets"]["3i_atlas"] = {k: comet[k] for k in ("name", "role", "rows", "obs_ids", "collections")
                                              if k in comet} | {"t_min_utc_range": comet.get("t_min_utc_range")}
            print(f"3i_atlas: {len(rows)} table rows", flush=True)
    (out / "summary.json").write_text(json.dumps(summary, indent=1) + "\n")
    digests = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(out.glob("*.json"))
               if p.name != "SHA256SUMS"}
    (out / "SHA256SUMS").write_text("".join(f"{d}  {n}\n" for n, d in digests.items()))


def finish(record: dict, rows: list[dict], out: Path, summary: dict) -> None:
    exposed_ids = {e["obs_id"] for e in record["exposed"]}
    exposed_mjds = [e["mjd"] for e in record["exposed"] if e["mjd"]]
    candidates = [r for r in rows if r["obs_id"] not in exposed_ids]
    reopened = [r for r in rows if r["obs_id"] in exposed_ids]
    record["archive_listing"] = {
        "rows_with_target_in_footprint": len(rows),
        "obs_ids": len({r["obs_id"] for r in rows}),
        "by_collection": dict(Counter(r["collection"] for r in rows)),
        "t_min_utc_range": [utc(min(r["t_min_mjd"] for r in rows)), utc(max(r["t_min_mjd"] for r in rows))] if rows else None,
        "rows_whose_obs_id_is_exposed": len(reopened),
    }
    record["exposed_summary"] = {
        "obs_ids": len(exposed_ids),
        "utc_range": [utc(min(exposed_mjds)), utc(max(exposed_mjds))] if exposed_mjds else None,
        "by_source": dict(Counter(s for e in record["exposed"] for s in e["sources"])),
        "by_release": dict(Counter(r for e in record["exposed"] for r in e["releases"])),
    }
    record["candidates_never_opened"] = summarise_candidates(candidates, exposed_mjds)
    record["candidate_rows"] = sorted(candidates, key=lambda r: (r["t_min_mjd"], r["detector"] or 0))
    (out / f"{record['key']}.json").write_text(json.dumps(record, indent=1) + "\n")
    summary["targets"][record["key"]] = {
        "name": record["name"], "role": record["role"],
        "exposed": record["exposed_summary"],
        "archive": record["archive_listing"],
        "candidates": {k: v for k, v in record["candidates_never_opened"].items() if k != "visits"}
        | {"visits": len(record["candidates_never_opened"]["visits"])},
        "nearby_bundled_fields": record.get("nearby_bundled_fields", []),
    }


if __name__ == "__main__":
    sys.exit(main())
