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


def main(argv: list[str]) -> int:
    stage = argv[0] if argv else ""
    if stage == "select":
        selection = select()
        print("selected:", selection["selected"])
        return 0
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
