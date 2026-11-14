"""Write static/data/index.json from the published investigation files (DATA-CONTRACT V1 §4, V3).

Usage: python -m scripts.build_index [--out static/data]

Distances for the schematic map come from the investigation files (Gaia DR3 parallax),
SIMBAD (CDS, CfA mirror fallback) or JPL Horizons, each with its source. Anything that
cannot be sourced is null.
"""
import argparse
import csv
import io
import json
import math
from datetime import datetime, timezone
from pathlib import Path

from backend import catalogs
from backend.presets import PRESETS

PLANNED = (
    {"key": "makemake", "name": "Makemake", "kind": "dwarfplanet", "role": "extra", "horizons": "136472"},
    {"key": "pluto", "name": "Pluto", "kind": "dwarfplanet", "role": "extra", "horizons": "999"},
    {"key": "3i-atlas", "name": "3I/ATLAS", "kind": "comet", "role": "extra", "horizons": None},
)
SIMBAD_IDS = {"wise0855": "WISE J085510.83-071442.5", "epsindib": "eps Ind B", "rwaur": "RW Aur", "rdra": "R Dra",
              "barnard": "Barnard's star"}
# Arbitrary, evenly spread map angles (the map is a schematic, not sky geometry).
ANGLES = {"barnard": 20.0, "wise0855": 65.0, "epsindib": 110.0, "rwaur": 155.0, "rdra": 200.0,
          "makemake": 245.0, "pluto": 290.0, "3i-atlas": 335.0}


def simbad_parallax(identifier: str) -> dict | None:
    escaped = identifier.replace("'", "''")
    query = ("SELECT b.plx_value, b.plx_err, b.plx_bibcode FROM basic AS b JOIN ident AS i ON i.oidref = b.oid "
             f"WHERE i.id = '{escaped}'")
    try:
        text, url = catalogs.simbad_tap(query)
    except Exception:  # noqa: BLE001 - a missing distance must not stop the index
        return None
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows or not rows[0].get("plx_value"):
        return None
    plx = float(rows[0]["plx_value"])
    return {"value": round(1000.0 / plx, 3), "unit": "pc", "kind": "parallax_distance",
            "source": f"SIMBAD parallax {plx} mas ({rows[0].get('plx_bibcode')}) via {url.split('/')[2]}"}


def horizons_distance(command: str) -> dict | None:
    import httpx

    params = {"format": "json", "COMMAND": f"'{command}'", "EPHEM_TYPE": "OBSERVER", "CENTER": "'500@399'",
              "START_TIME": "'2026-01-01'", "STOP_TIME": "'2026-01-02'", "STEP_SIZE": "'1d'", "QUANTITIES": "'20'"}
    try:
        response = httpx.get("https://ssd.jpl.nasa.gov/api/horizons.api", params=params, timeout=60)
        response.raise_for_status()
        result = response.json()["result"]
        block = result.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines()[0]
        delta = float(block.split()[2])
    except Exception:  # noqa: BLE001
        return None
    return {"value": round(delta, 3), "unit": "au", "kind": "geocentric_distance",
            "source": f"JPL Horizons {command}, geocentric delta at 2026-01-01 00:00 UTC"}


def prediction_summary(key: str, out: Path) -> dict:
    """Status of this target's frozen trials (from the trial folders; never typed by hand)."""
    if key == "3i-atlas":
        return {"status": "see_only", "trial_ids": [], "open_forecast_ids": []}
    trials, forecasts, statuses = [], [], []
    for folder in sorted((out / "trials").glob("*")):
        trial_path = folder / "trial.json"
        if not trial_path.exists():
            continue
        trial = json.loads(trial_path.read_text())
        if trial["target_key"] != key:
            continue
        if trial.get("open_forecast"):
            forecasts.append(trial["trial_id"])
            continue
        trials.append(trial["trial_id"])
        prediction_path = folder / "prediction.json"
        if prediction_path.exists():
            prediction = json.loads(prediction_path.read_text())
            statuses.append("insufficient_data" if prediction.get("prediction_status") == "insufficient_data" else "waiting")
    status = "waiting" if "waiting" in statuses else ("insufficient_data" if statuses else None)
    return {"status": status, "trial_ids": trials, "open_forecast_ids": forecasts}


def target_entry(key: str, name: str, kind: str, role: str, out: Path, distance: dict | None) -> dict:
    path = out / key / "investigation.json"
    doc = json.loads(path.read_text()) if path.exists() else None
    entry = {"key": key, "name": name, "name_key": f"target.{key}.name", "role": role, "kind": kind}
    if doc:
        cat = doc.get("target_catalogue") or {}
        entry["reference"] = {"ra_deg": cat.get("ra_deg"), "dec_deg": cat.get("dec_deg"),
                              "epoch_jyear": cat.get("epoch_jyear"), "pmra_mas_yr": cat.get("pmra_mas_yr"),
                              "pmdec_mas_yr": cat.get("pmdec_mas_yr"), "source": cat.get("source")}
        request = doc.get("request") or {}
        entry["footprint"] = {"centre_ra_deg": request.get("ra_deg"), "centre_dec_deg": request.get("dec_deg"),
                              "fov_deg": request.get("fov_deg")}
        entry["data_status"] = doc.get("data_status", "unavailable")
        entry["measurement_status"] = doc.get("measurement_status")
        entry["investigation_path"] = f"{key}/investigation.json"
        epochs = [epoch for epoch in doc.get("epochs", []) if epoch.get("assets", {}).get("preview")]
        latest = max(epochs, key=lambda epoch: (epoch.get("visit") or 0, epoch.get("detector") or 0)) if epochs else None
        entry["thumbnails"] = ([{"path": latest["assets"]["preview"], "content_type": "processed",
                                 "label_key": "thumb.spherex", "epoch_id": latest["id"],
                                 "time_utc": None}] if latest else [])
        if distance is None and cat.get("parallax_mas"):
            distance = {"value": round(1000.0 / cat["parallax_mas"], 4), "unit": "pc", "kind": "parallax_distance",
                        "source": f"{cat.get('source')} parallax {cat['parallax_mas']} mas"}
    else:
        entry.update({"reference": None, "footprint": None, "data_status": "unavailable", "measurement_status": None,
                      "investigation_path": None, "thumbnails": [],
                      "status_reason_key": "unavailable.no-validated-product"})
    entry["prediction"] = prediction_summary(key, out)
    entry["map"] = {"distance": distance, "angle_deg": ANGLES.get(key, 0.0), "angle_is_arbitrary": True}
    return entry


def build(out: Path) -> dict:
    targets = []
    for preset in PRESETS:
        distance = None
        doc_path = out / preset.key / "investigation.json"
        has_parallax = doc_path.exists() and (json.loads(doc_path.read_text()).get("target_catalogue") or {}).get("parallax_mas")
        if not has_parallax:
            distance = simbad_parallax(SIMBAD_IDS[preset.key])
        targets.append(target_entry(preset.key, preset.name, preset.kind, "challenge", out, distance))
    for planned in PLANNED:
        distance = horizons_distance(planned["horizons"]) if planned["horizons"] else None
        targets.append(target_entry(planned["key"], planned["name"], planned["kind"], planned["role"], out, distance))
    index = {
        "schema_version": "tenger.site_index/1",
        "contract_version": 3,
        "dataset_version": "a3-2026-11-14",
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "targets": targets,
        "trials": sorted(f"trials/{folder.name}/trial.json" for folder in (out / "trials").glob("*")
                         if (folder / "trial.json").exists()),
        "scoreboard_path": "scoreboard.json" if (out / "scoreboard.json").exists() else None,
        "game_rounds": sorted(f"game/{path.name}" for path in (out / "game").glob("*.json")) if (out / "game").exists() else [],
        "lessons": sorted(f"lessons/{path.name}" for path in (out / "lessons").glob("*.json")) if (out / "lessons").exists() else [],
        "reserved_path": "reserved.json",
        "strings_path": "strings.en.json",
        "releases": sorted({release for target in targets for release in _releases(out, target)}),
        "credits_keys": ["credit.irsa", "credit.spherex", "credit.gaia", "credit.horizons", "credit.base-project"],
    }
    (out / "index.json").write_text(json.dumps(index, indent=2, ensure_ascii=False) + "\n")
    return {target["key"]: target["data_status"] for target in targets}


def _releases(out: Path, target: dict) -> list[str]:
    if not target.get("investigation_path"):
        return []
    doc = json.loads((out / target["investigation_path"]).read_text())
    return doc.get("coverage", {}).get("releases", [])


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="static/data")
    print(build(Path(parser.parse_args().out)))
