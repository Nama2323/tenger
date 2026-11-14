"""Write static/data/reserved.json: sky regions where live loading must stay off.

Usage: python -m scripts.build_reserved [--out static/data]

Sources: docs/exposure/<key>.json (Horizons positions of every archive row, metadata
only) and the official 3I/ATLAS exposure table (metadata only). No pixels are read.
"""
import argparse
import io
import json
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
MARGIN_DEG = 2.0
COMET_TABLE = "https://irsa.ipac.caltech.edu/data/SPHEREx/docs/comet3iatlas/obscore_3I_Atlas.vot"
# Newest visit of each body: the holdout, closed until Task A4 freezes the predictions.
HOLDOUT_WINDOWS_MJD = {"makemake": (61190.0, 61205.0), "pluto": (61312.0, 61316.0)}


def _box(points: list[dict]) -> dict:
    ras = [point["ra_deg"] for point in points]
    decs = [point["dec_deg"] for point in points]
    return {"ra_deg": [round(min(ras), 4), round(max(ras), 4)], "dec_deg": [round(min(decs), 4), round(max(decs), 4)]}


def frozen_trial(key: str) -> dict | None:
    """The frozen A4 trial for this body's evaluation visit, if any (IDs and receipt only)."""
    for folder in sorted((ROOT / "static" / "data" / "trials").glob(f"{key}-position-*")):
        trial_path = folder / "trial.json"
        if not trial_path.exists() or json.loads(trial_path.read_text()).get("open_forecast"):
            continue
        receipt_path = folder / "receipt.json"
        receipt = json.loads(receipt_path.read_text()) if receipt_path.exists() else {}
        return {"trial_id": folder.name, "prediction_commit": receipt.get("commit")}
    return None


def body_region(key: str) -> dict:
    inventory = json.loads((ROOT / "docs" / "exposure" / f"{key}.json").read_text())
    low, high = HOLDOUT_WINDOWS_MJD[key]
    rows = [row for row in inventory["candidate_rows"] if low <= row["t_min_mjd"] <= high]
    points = sorted({(round(row["t_min_mjd"], 4), round(row["target_ra_at_time"], 5), round(row["target_dec_at_time"], 5))
                     for row in rows})
    path = [{"mjd": mjd, "ra_deg": ra, "dec_deg": dec} for mjd, ra, dec in points]
    trial = frozen_trial(key)
    return {
        "key": key,
        "kind": "holdout_path",
        "reason_key": "reserved.prediction-holdout",
        "until_key": "reserved.until-verified" if trial else "reserved.until-predictions-frozen",
        "frozen_trial": trial,
        "window_mjd": [round(min(p["mjd"] for p in path), 4), round(max(p["mjd"] for p in path), 4)],
        "obs_ids": len({row["obs_id"] for row in rows}),
        **_box(path),
        "path": path,
        "source": f"docs/exposure/{key}.json (JPL Horizons geocentric positions at each exposure)",
    }


def comet_region() -> dict:
    from astropy.io.votable import parse_single_table

    response = httpx.get(COMET_TABLE, timeout=120, follow_redirects=True)
    response.raise_for_status()
    table = parse_single_table(io.BytesIO(response.content)).to_table()
    points = sorted({(round(float(row["t_min"]), 4), round(float(row["comet_ra"]), 5), round(float(row["comet_dec"]), 5))
                     for row in table})
    path = [{"mjd": mjd, "ra_deg": ra, "dec_deg": dec} for mjd, ra, dec in points]
    return {
        "key": "3i-atlas",
        "kind": "see_only_path",
        "reason_key": "reserved.see-only",
        "until_key": None,
        "window_mjd": [path[0]["mjd"], path[-1]["mjd"]],
        "obs_ids": len({str(row["obs_id"]) for row in table}),
        **_box(path),
        "path": path,
        "source": COMET_TABLE,
    }


def build(out: Path) -> dict:
    regions = [body_region("makemake"), body_region("pluto"), comet_region()]
    document = {
        "schema_version": "tenger.reserved/1",
        "margin_deg": MARGIN_DEG,
        "rule_key": "reserved.rule",
        "note": "A live request is refused when its centre lies within margin_deg plus half the field diagonal of a path point or box.",
        "regions": regions,
    }
    out.mkdir(parents=True, exist_ok=True)
    (out / "reserved.json").write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n")
    return {region["key"]: len(region["path"]) for region in regions}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="static/data")
    print(build(Path(parser.parse_args().out)))
