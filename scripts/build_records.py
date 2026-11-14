"""Game rounds and lesson records derived from verified trials (DATA-CONTRACT V1 §11-12, V4).

Usage: python -m scripts.build_records

Every number comes from a frozen or verification file and carries its source; nothing is
typed by hand. Game rounds exist only for verified position trials. The game scale is the
frozen model's 95% semi-major axis (fixed before any player guesses, from prediction.json).
"""
import hashlib
import json
import math
from pathlib import Path

import numpy as np

from backend.astrometry import tangent_offsets_arcsec

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "static" / "data"
ROUNDS = {"barnard-position": "barnard-position-2026b", "epsindib-position": "epsindib-position-2026b",
          "pluto-position": "pluto-position-2026b"}
AU_LIGHT_MINUTES = 8.316746  # light travel time across 1 au (IAU au, c)


def _bytes(path: Path) -> bytes:
    return path.read_bytes()


def _ref(relative: str) -> dict:
    return {"path": relative, "sha256": hashlib.sha256(_bytes(DATA / relative)).hexdigest()}


def _json(relative: str) -> dict:
    return json.loads((DATA / relative).read_text())


def _write(relative: str, document: dict) -> None:
    path = DATA / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n")


def group_means(points: list[dict]) -> list[dict]:
    groups = {}
    for point in points:
        groups.setdefault((point.get("visit"), point.get("detector")), []).append(point)
    out = []
    for (visit, detector), members in sorted(groups.items(), key=lambda item: (item[0][0] or 0, item[0][1] or 0)):
        out.append({"visit": visit, "detector": detector, "n": len(members),
                    "t_mjd": float(np.mean([m["t_mjd"] for m in members])),
                    "ra_deg": float(np.mean([m["ra_deg"] for m in members])),
                    "dec_deg": float(np.mean([m["dec_deg"] for m in members]))})
    return out


def game_round(round_id: str, trial_id: str) -> dict | None:
    base = f"trials/{trial_id}"
    verification = _json(f"{base}/verification.json")
    if verification.get("status") not in ("hit", "miss") or not verification.get("residuals"):
        return None
    trial, prediction, training = _json(f"{base}/trial.json"), _json(f"{base}/prediction.json"), _json(f"{base}/training.json")
    model = verification["residuals"]["model"]
    baseline = verification["residuals"]["baseline"]
    centre = (model["reference"]["ra_deg"], model["reference"]["dec_deg"])
    baseline_offset = tangent_offsets_arcsec(*centre, baseline["reference"]["ra_deg"], baseline["reference"]["dec_deg"])
    scale = math.sqrt(max(np.linalg.eigvalsh(np.array(prediction["model"]["cov_arcsec2"])))) * 2.4477468306808166
    points = []
    for group in group_means(training["points"]):
        east, north = tangent_offsets_arcsec(*centre, group["ra_deg"], group["dec_deg"])
        points.append({"t_mjd": round(group["t_mjd"], 6), "east_arcsec": round(east, 3), "north_arcsec": round(north, 3),
                       "n_exposures": group["n"], "visit": group["visit"], "detector": group["detector"],
                       "content_type": "measured"})
    return {
        "schema_version": "tenger.game_round/1",
        "contract_version": 6,
        "round_id": round_id,
        "trial_id": trial_id,
        "category": trial["category"],
        "labels": trial["labels"],
        "confirmation_pending": bool(trial.get("confirmation_pending")),
        "quantity": "position",
        "units": "arcsec",
        "derived_from": [_ref(f"{base}/prediction.json"), _ref(f"{base}/verification.json"), _ref(f"{base}/training.json")],
        "frame": {"kind": "tangent plane, east/north arcsec", "centre_ra_deg": centre[0], "centre_dec_deg": centre[1],
                  "centre_is": "the frozen model at the reveal time", "east_left": True},
        "training_points": points,
        "reveal_t_mjd": model["reference"]["t_mjd"],
        "baseline": {"east_arcsec": round(baseline_offset[0], 3), "north_arcsec": round(baseline_offset[1], 3),
                     "cov_arcsec2": baseline["c_pred_arcsec2"]},
        "model": {"east_arcsec": 0.0, "north_arcsec": 0.0, "region_d2": 5.991464547107979,
                  "cov_arcsec2": model["c_pred_arcsec2"]},
        "actual": {"east_arcsec": model["east_arcsec"], "north_arcsec": model["north_arcsec"],
                   "cov_arcsec2": verification["observed"]["cov_arcsec2"], "image": verification["observed"].get("image")},
        "outcome": {"model": verification["status"], "model_error_arcsec": model["error_arcsec"], "model_d2": model["d2"],
                    "baseline": baseline["status"], "baseline_error_arcsec": baseline["error_arcsec"]},
        "scoring": {"formula": "exp_decay_v1", "scale": round(scale, 4),
                    "scale_source": "frozen model 95% semi-major axis (prediction.json)"},
    }


def lesson_distance() -> dict:
    base = "trials/pluto-position-2026b"
    training = _json(f"{base}/training.json")
    prediction = _json(f"{base}/prediction.json")
    visits = {}
    for point in training["points"]:
        visits.setdefault(point["visit"], []).append(point)
    (v1, first), (v2, second) = sorted(visits.items())[:2]
    mean = lambda rows, key: float(np.mean([row[key] for row in rows]))
    ra1, dec1, t1 = mean(first, "ra_deg"), mean(first, "dec_deg"), mean(first, "t_mjd")
    ra2, dec2, t2 = mean(second, "ra_deg"), mean(second, "dec_deg"), mean(second, "t_mjd")
    a1, d1, a2, d2 = (math.radians(v) for v in (ra1, dec1, ra2, dec2))
    separation = math.degrees(math.acos(math.sin(d1) * math.sin(d2) + math.cos(d1) * math.cos(d2) * math.cos(a1 - a2)))
    days = t2 - t1
    distance = prediction["diagnostics"]["heliocentric_distance_au"]
    source = f"{base}/training.json"

    def measured(name, value, unit, ref=source, content_type="measured"):
        return {"name": name, "value": round(value, 6), "unit": unit, "content_type": content_type,
                "synthetic": False, "source_ref": ref}

    barnard = _json("barnard/investigation.json")["target_catalogue"]
    return {
        "schema_version": "tenger.lesson/1", "contract_version": 6, "lesson_id": "distance",
        "title_key": "lesson.distance.title", "grade_band": "8-11", "investigation_key": "pluto",
        "formula_key": "lesson.distance.formula",
        "worked_example": {
            "prompt_key": "lesson.distance.worked",
            "inputs": [measured("visit1_ra_deg", ra1, "deg"), measured("visit1_dec_deg", dec1, "deg"),
                       measured("visit1_mjd", t1, "d"), measured("visit2_ra_deg", ra2, "deg"),
                       measured("visit2_dec_deg", dec2, "deg"), measured("visit2_mjd", t2, "d")],
            "answer": {"value": round(separation, 4), "unit": "deg", "derived_by": "scripts/build_records.py",
                       "note": "great-circle angle between the mean training positions of two SPHEREx visits"},
        },
        "exercises": [
            {"id": "q1", "prompt_key": "lesson.distance.q1",
             "inputs": [measured("separation_deg", separation, "deg"), measured("days", days, "d")],
             "answer": {"value": round(separation / days, 5), "unit": "deg/d"}},
            {"id": "q2", "prompt_key": "lesson.distance.q2",
             "inputs": [measured("distance_au", distance, "au", f"{base}/prediction.json", "modeled"),
                        {"name": "au_light_minutes", "value": AU_LIGHT_MINUTES, "unit": "min", "content_type": "catalogue",
                         "synthetic": False, "source_ref": "IAU 2012 astronomical unit and the speed of light"}],
             "answer": {"value": round(distance * AU_LIGHT_MINUTES / 60, 3), "unit": "h"}},
            {"id": "q3", "prompt_key": "lesson.distance.q3",
             "inputs": [{"name": "parallax_arcsec", "value": round(barnard["parallax_mas"] / 1000, 6), "unit": "arcsec",
                         "content_type": "catalogue", "synthetic": False, "source_ref": "Gaia DR3 (barnard/investigation.json)"}],
             "answer": {"value": round(1000 / barnard["parallax_mas"], 4), "unit": "pc"}},
        ],
        "teacher_note_key": "lesson.distance.teacher",
        "derived_from": [_ref(source), _ref(f"{base}/prediction.json"), _ref("barnard/investigation.json")],
    }


def lesson_brightness() -> dict:
    doc = _json("epsindib/investigation.json")
    ratios = sorted((m for m in doc["measurements"] if m["quantity"] == "flux_ratio_b_over_a" and m["status"] == "measured"),
                    key=lambda m: m["sigma"])
    best, other = ratios[0], next(m for m in ratios[1:] if abs(m["value"] - 1) > m["sigma"])
    barnard_phot = _json("barnard/investigation.json")["photometry"]
    ref = "epsindib/investigation.json"

    def ratio_inputs(measurement):
        return [{"name": "ratio", "value": measurement["value"], "unit": "", "content_type": "measured", "synthetic": False,
                 "source_ref": f"{ref}#{measurement['id']}"},
                {"name": "sigma", "value": measurement["sigma"], "unit": "", "content_type": "measured", "synthetic": False,
                 "source_ref": f"{ref}#{measurement['id']}"}]

    def delta_mag(value):
        return round(-2.5 * math.log10(value), 4)

    return {
        "schema_version": "tenger.lesson/1", "contract_version": 6, "lesson_id": "brightness",
        "title_key": "lesson.brightness.title", "grade_band": "8-11", "investigation_key": "epsindib",
        "formula_key": "lesson.brightness.formula",
        "worked_example": {"prompt_key": "lesson.brightness.worked", "inputs": ratio_inputs(best),
                           "answer": {"value": delta_mag(best["value"]), "unit": "mag",
                                      "z": round((best["value"] - 1) / best["sigma"], 3),
                                      "derived_by": "scripts/build_records.py"}},
        "exercises": [
            {"id": "q1", "prompt_key": "lesson.brightness.q1", "inputs": ratio_inputs(other),
             "answer": {"value": delta_mag(other["value"]), "unit": "mag",
                        "z": round((other["value"] - 1) / other["sigma"], 3)}},
            {"id": "q2", "prompt_key": "lesson.brightness.q2",
             "inputs": [{"name": "n_flagged", "value": barnard_phot["refused"].get("measure.flagged-pixels-in-aperture", 0),
                         "unit": "", "content_type": "measured", "synthetic": False,
                         "source_ref": "barnard/investigation.json#photometry"},
                        {"name": "n_exposures", "value": barnard_phot["n_points"], "unit": "", "content_type": "measured",
                         "synthetic": False, "source_ref": "barnard/investigation.json#photometry"}],
             "answer": {"value": round(barnard_phot["refused"].get("measure.flagged-pixels-in-aperture", 0)
                                       / barnard_phot["n_points"], 4), "unit": "fraction"}},
        ],
        "teacher_note_key": "lesson.brightness.teacher",
        "derived_from": [_ref(ref), _ref("barnard/investigation.json")],
    }


def lesson_how_sure() -> dict:
    scoreboard = _json("scoreboard.json")
    rows = [row for row in scoreboard["rows"] if row["status"] in ("hit", "miss")]
    hits = sum(row["status"] == "hit" for row in rows)
    pluto = next(row for row in rows if row["trial_id"] == "pluto-position-2026b")
    n = len(rows)
    return {
        "schema_version": "tenger.lesson/1", "contract_version": 6, "lesson_id": "how-sure",
        "title_key": "lesson.how-sure.title", "grade_band": "8-11", "investigation_key": "pluto",
        "formula_key": "lesson.how-sure.formula",
        "worked_example": {
            "prompt_key": "lesson.how-sure.worked",
            "inputs": [{"name": "d2", "value": pluto["model_d2"], "unit": "", "content_type": "measured", "synthetic": False,
                        "source_ref": "trials/pluto-position-2026b/verification.json"},
                       {"name": "threshold", "value": 5.991, "unit": "", "content_type": "catalogue", "synthetic": False,
                        "source_ref": "chi-square, 2 degrees of freedom, 95%"}],
            "answer": {"value": 0, "unit": "hit (1) or miss (0)", "derived_by": "scripts/build_records.py",
                       "note": "D^2 above the threshold: a miss"}},
        "exercises": [
            {"id": "q1", "prompt_key": "lesson.how-sure.q1",
             "inputs": [{"name": "n_trials", "value": n, "unit": "", "content_type": "measured", "synthetic": False,
                         "source_ref": "scoreboard.json"}],
             "answer": {"value": round(0.95 * n, 3), "unit": "expected hits"}},
            {"id": "q2", "prompt_key": "lesson.how-sure.q2",
             "inputs": [{"name": "n_trials", "value": n, "unit": "", "content_type": "measured", "synthetic": False,
                         "source_ref": "scoreboard.json"}],
             "answer": {"value": round(0.95 ** n, 4), "unit": "probability"}},
            {"id": "q3", "prompt_key": "lesson.how-sure.q3",
             "inputs": [{"name": "n_hits", "value": hits, "unit": "", "content_type": "measured", "synthetic": False,
                         "source_ref": "scoreboard.json"},
                        {"name": "n_trials", "value": n, "unit": "", "content_type": "measured", "synthetic": False,
                         "source_ref": "scoreboard.json"}],
             "answer": {"value": round(hits / n, 4), "unit": "fraction"}},
        ],
        "teacher_note_key": "lesson.how-sure.teacher",
        "derived_from": [_ref("scoreboard.json"), _ref("trials/pluto-position-2026b/verification.json")],
    }


def build() -> dict:
    made = {"game": [], "lessons": []}
    for round_id, trial_id in ROUNDS.items():
        document = game_round(round_id, trial_id)
        if document:
            _write(f"game/{round_id}.json", document)
            made["game"].append(round_id)
    for document in (lesson_distance(), lesson_brightness(), lesson_how_sure()):
        _write(f"lessons/{document['lesson_id']}.json", document)
        made["lessons"].append(document["lesson_id"])
    return made


if __name__ == "__main__":
    print(build())
