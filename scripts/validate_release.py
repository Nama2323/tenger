"""Production validator for static/data (Task H2). Exit status 1 if anything fails.

Usage: python -m scripts.validate_release [--quiet]

Checks every published data file:
- schema: known kind, major version 1, contract_version not older than the kind (stale files fail);
- no example or test-fixture content anywhere (no "example": true, scoreboard rows only for real trials);
- simulations labelled (content_type "artificial" needs synthetic: true; real lesson inputs need a source);
- source metadata (observations, measurements, distances, scene entries, derived_from hashes);
- hash chains (trial -> training -> prediction -> receipt -> git commit; verification -> prediction);
- displayed numbers equal their source records (index, scoreboard, game, lessons, post-mortem, hindcast,
  3D scene), and derived files equal a fresh regeneration.
Legacy viewer files (targets.json, results.json, <key>/meta.json) are listed, not validated as contract files.
Development fixtures under static/dev-fixtures/ ship with the site (opened only with ?fixtures=1), so each
fixture JSON must carry "example": true at the top level and must not appear under static/data.
"""
import hashlib
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "static" / "data"
FIXTURES = ROOT / "static" / "dev-fixtures"
LATEST_CONTRACT = 11
MIN_CONTRACT = {"postmortem": 8, "scene3d": 9, "composites": 10, "abandoned": 11, "hindcast": 11}
KINDS = {"site_index", "investigation", "trial", "prediction", "receipt", "verification", "scoreboard", "game_round",
         "lesson", "training", "reserved", "strings", "postmortem", "hindcast", "scene3d", "composites", "abandoned"}
LEGACY = ("targets.json", "results.json")
CONTENT_TYPES = {"measured", "catalogue", "modeled", "interpreted", "processed", "artificial"}


class Report:
    def __init__(self):
        self.failures, self.notes = [], []

    def fail(self, where, message):
        self.failures.append(f"{where}: {message}")

    def note(self, where, message):
        self.notes.append(f"{where}: {message}")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path: Path):
    return json.loads(path.read_text())


def rel(path: Path) -> str:
    return str(path.relative_to(DATA))


def walk(node, visit, trail=()):
    visit(node, trail)
    if isinstance(node, dict):
        for key, value in node.items():
            walk(value, visit, trail + (key,))
    elif isinstance(node, list):
        for index, value in enumerate(node):
            walk(value, visit, trail + (index,))


# ------------------------------------------------------------------ per-file checks


def check_schema_and_flags(report: Report) -> dict:
    documents = {}
    for path in sorted(DATA.rglob("*.json")):
        name = rel(path)
        if path.name in LEGACY or path.name == "meta.json" or name.startswith("sky/") or name.startswith("gaia/"):
            report.note(name, "legacy viewer file (not a contract file)")
            continue
        try:
            doc = load(path)
        except json.JSONDecodeError as error:
            report.fail(name, f"not valid JSON: {error}")
            continue
        version = doc.get("schema_version", "") if isinstance(doc, dict) else ""
        if not version.startswith("tenger.") or "/" not in version:
            report.fail(name, "no TENGER schema_version (unknown or unlabelled file)")
            continue
        kind, major = version[len("tenger."):].split("/")
        if kind not in KINDS:
            report.fail(name, f"unknown kind {kind!r}")
        if major != "1":
            report.fail(name, f"schema major {major} is not 1")
        contract = doc.get("contract_version")
        if contract is not None and not (MIN_CONTRACT.get(kind, 1) <= contract <= LATEST_CONTRACT):
            report.fail(name, f"contract_version {contract} out of range for {kind}")
        if kind in MIN_CONTRACT and contract is None:
            report.fail(name, f"{kind} needs contract_version >= {MIN_CONTRACT[kind]}")

        def visit(node, trail):
            if isinstance(node, dict):
                if node.get("example") is True:
                    report.fail(name, f"example content at {'/'.join(map(str, trail)) or 'top'}")
                content = node.get("content_type")
                if content is not None and content not in CONTENT_TYPES:
                    report.fail(name, f"unknown content_type {content!r}")
                if content == "artificial" and node.get("synthetic") is not True:
                    report.fail(name, f"artificial content not labelled synthetic at {'/'.join(map(str, trail))}")
                if node.get("synthetic") is False and "source_ref" in node and not node.get("source_ref"):
                    report.fail(name, f"real input without source_ref at {'/'.join(map(str, trail))}")

        walk(doc, visit)
        documents[name] = (kind, doc)
    return documents


def check_sources(report: Report, documents: dict) -> None:
    for name, (kind, doc) in documents.items():
        if kind == "investigation":
            for obs in doc.get("observations", []):
                if obs.get("role") in ("see_only", "training", "training_fixed_sky", None) and not obs.get("url"):
                    report.fail(name, f"observation {obs.get('obs_key')} has no source url")
                if not obs.get("source_sha256"):
                    report.fail(name, f"observation {obs.get('obs_key')} has no source_sha256")
            for measurement in doc.get("measurements", []):
                if not measurement.get("method"):
                    report.fail(name, f"measurement {measurement.get('id')} has no method")
                if measurement.get("status") == "measured" and measurement.get("value") is None:
                    report.fail(name, f"measurement {measurement.get('id')} measured without a value")
                if measurement.get("status") == "measured" and measurement.get("content_type") == "measured" \
                        and measurement.get("sigma") is None and not measurement["quantity"].startswith("control_"):
                    report.fail(name, f"measurement {measurement.get('id')} has no uncertainty")
                if measurement.get("status") != "measured" and measurement.get("value") is not None:
                    report.fail(name, f"measurement {measurement.get('id')} has a value but status {measurement.get('status')}")
            catalogue = doc.get("target_catalogue")
            if catalogue is not None and not catalogue.get("source"):
                report.fail(name, "target_catalogue without source")
        if kind in ("game_round", "lesson"):
            entries = doc.get("derived_from") or []
            if not entries:
                report.fail(name, "no derived_from")
            for entry in entries:
                target = DATA / entry["path"]
                if not target.exists():
                    report.fail(name, f"derived_from {entry['path']} missing")
                elif sha(target) != entry["sha256"]:
                    report.fail(name, f"derived_from {entry['path']} hash is stale")
        if kind == "scoreboard":
            for entry in doc.get("derived_from", []):
                target = DATA / entry["path"]
                if not target.exists() or sha(target) != entry["sha256"]:
                    report.fail(name, f"derived_from {entry['path']} missing or stale")
        if kind == "site_index":
            for target in doc["targets"]:
                distance = (target.get("map") or {}).get("distance")
                if distance is not None and not distance.get("source"):
                    report.fail(name, f"{target['key']}: distance without source")
                if target.get("map", {}).get("angle_is_arbitrary") is not True:
                    report.fail(name, f"{target['key']}: map angle not marked arbitrary")
                for thumb in target.get("thumbnails", []):
                    if not (DATA / thumb["path"]).exists():
                        report.fail(name, f"{target['key']}: thumbnail {thumb['path']} missing")
        if kind == "scene3d":
            for key, body in doc["bodies"].items():
                for part, value in body.items():
                    if not value.get("source"):
                        report.fail(name, f"bodies.{key}.{part} without source")
            for star in doc["stars"]:
                if not star.get("source"):
                    report.fail(name, f"star {star['key']} without source")
            for estimate in doc["planet_nine"]["estimates"]:
                if not (estimate.get("reference") and estimate.get("doi")):
                    report.fail(name, "Planet Nine estimate without reference/DOI")
        if kind in ("postmortem", "hindcast"):
            if doc.get("exploratory") is not True or doc.get("counts") is not False:
                report.fail(name, "exploratory file not labelled exploratory / counts false")


def check_hash_chains(report: Report) -> None:
    from scripts import forecast_v2, predict

    for folder in sorted(path for path in (DATA / "trials").iterdir() if (path / "trial.json").exists()):
        name = f"trials/{folder.name}"
        trial = load(folder / "trial.json")
        for problem in predict.check(folder.name):
            report.fail(name, problem)
        if (folder / "abandoned.json").exists():
            if (folder / "prediction.json").exists():
                report.fail(name, "abandoned but predicted")
            continue
        if not (folder / "prediction.json").exists():
            report.fail(name, "frozen trial without prediction")
            continue
        receipt_path = folder / "receipt.json"
        if not receipt_path.exists():
            report.fail(name, "prediction without receipt")
            continue
        receipt = load(receipt_path)
        committed = subprocess.run(["git", "show", f"{receipt['commit']}:static/data/trials/{folder.name}/prediction.json"],
                                   cwd=ROOT, capture_output=True)
        if committed.returncode != 0 or committed.stdout != (folder / "prediction.json").read_bytes():
            report.fail(name, "prediction.json differs from the receipt's commit")
        files = trial["model"].get("code_files")
        expected = forecast_v2.code_sha256() if files else predict.model_code_sha256()
        if expected != trial["model"]["code_sha256"]:
            report.fail(name, "model code changed since the freeze")
        verification_path = folder / "verification.json"
        if verification_path.exists():
            verification = load(verification_path)
            if verification["prediction_sha256"] != sha(folder / "prediction.json"):
                report.fail(name, "verification refers to another prediction")


# ------------------------------------------------------------------ numbers shown vs sources


def close(a, b, tolerance=1e-6) -> bool:
    if a is None or b is None:
        return a is b
    return math.isclose(float(a), float(b), rel_tol=tolerance, abs_tol=tolerance)


def check_numbers(report: Report) -> None:
    from scripts import build_records, build_scoreboard

    # scoreboard == regeneration
    board = load(DATA / "scoreboard.json")
    fresh = build_scoreboard.build(board["generated_utc"])
    if {k: v for k, v in fresh.items()} != board:
        report.fail("scoreboard.json", "differs from a fresh regeneration")
    # game rounds and lessons == regeneration
    for round_id, trial_id in build_records.ROUNDS.items():
        path = DATA / "game" / f"{round_id}.json"
        expected = build_records.game_round(round_id, trial_id)
        if expected is not None and load(path) != json.loads(json.dumps(expected)):
            report.fail(f"game/{round_id}.json", "differs from a fresh regeneration")
    for builder in (build_records.lesson_distance, build_records.lesson_brightness, build_records.lesson_how_sure):
        expected = json.loads(json.dumps(builder()))
        path = DATA / "lessons" / f"{expected['lesson_id']}.json"
        if load(path) != expected:
            report.fail(f"lessons/{expected['lesson_id']}.json", "differs from a fresh regeneration")
    # index: statuses and distances
    index = load(DATA / "index.json")
    for target in index["targets"]:
        statuses = []
        for trial_id in target["prediction"]["trial_ids"]:
            folder = DATA / "trials" / trial_id
            prediction = load(folder / "prediction.json")
            if prediction["prediction_status"] == "insufficient_data":
                statuses.append("insufficient_data")
            elif (folder / "verification.json").exists():
                statuses.append(load(folder / "verification.json")["status"])
            else:
                statuses.append("waiting")
        if statuses and target["prediction"]["status"] not in statuses:
            report.fail("index.json", f"{target['key']}: status {target['prediction']['status']} not in {statuses}")
        investigation = DATA / target["key"] / "investigation.json"
        distance = (target.get("map") or {}).get("distance")
        if investigation.exists() and distance and distance["unit"] == "pc":
            parallax = (load(investigation).get("target_catalogue") or {}).get("parallax_mas")
            if parallax and not close(distance["value"], 1000 / parallax, 1e-3):
                report.fail("index.json", f"{target['key']}: distance {distance['value']} pc != 1000/{parallax}")
    # post-mortem and hindcast against the frozen verification
    verification = load(DATA / "trials" / "pluto-position-2026b" / "verification.json")
    model = verification["residuals"]["model"]
    postmortem = load(DATA / "trials" / "pluto" / "postmortem.json")
    if not (close(postmortem["frozen"]["d2"], model["d2"]) and close(postmortem["frozen"]["error_arcsec"], model["error_arcsec"])):
        report.fail("trials/pluto/postmortem.json", "frozen block differs from the verification")
    comparison = verification["after_verdict_comparison"]
    if postmortem["identification"]["observed_minus_horizons_arcsec"] != comparison["observed_minus_horizons_arcsec"]:
        report.fail("trials/pluto/postmortem.json", "identification differs from the verification")
    split = postmortem["residual_split"]
    if not (close(split["east_arcsec"], model["east_arcsec"], 1e-3) and close(split["north_arcsec"], model["north_arcsec"], 1e-3)):
        report.fail("trials/pluto/postmortem.json", "residual split differs from the verification")
    hindcast = load(DATA / "trials" / "pluto" / "hindcast-v2.json")
    if not (close(hindcast["old_method"]["d2"], model["d2"]) and hindcast["old_method"]["result"] == verification["status"]):
        report.fail("trials/pluto/hindcast-v2.json", "old_method differs from the verification")
    # 3D scene against the trial files and evidence files
    scene = load(DATA / "scene3d.json")
    loop = scene["pluto_loop"]
    prediction = load(DATA / "trials" / "pluto-position-2026b" / "prediction.json")
    if not (close(loop["frozen_forecast"]["ra_deg"], prediction["model"]["ra_deg"]) and
            close(loop["frozen_forecast"]["dec_deg"], prediction["model"]["dec_deg"])):
        report.fail("scene3d.json", "frozen forecast differs from prediction.json")
    if not (close(loop["observed"]["ra_deg"], verification["observed"]["ra_deg"]) and loop["observed"]["verdict"] == verification["status"]):
        report.fail("scene3d.json", "observed position differs from verification.json")
    training = load(DATA / "trials" / "pluto-position-2026b" / "training.json")
    if len(loop["training"]) != len(training["points"]):
        report.fail("scene3d.json", "loop training rows differ from training.json")
    for star in scene["stars"]:
        catalogue = load(DATA / star["key"] / "investigation.json")["target_catalogue"]
        if catalogue.get("parallax_mas") and not close(star["distance_pc"], 1000 / catalogue["parallax_mas"], 1e-3):
            report.fail("scene3d.json", f"star {star['key']} distance differs from its evidence file")
    our = scene["bodies"]["pluto"]["our_orbit"]
    if our.get("ours") is not True or our.get("content_type") != "modeled":
        report.fail("scene3d.json", "our Pluto orbit not labelled ours/modeled")


def check_fixtures(report: Report) -> None:
    """Fixtures are published with static/, so every one must say it is an example."""
    for path in sorted(FIXTURES.rglob("*.json")):
        doc = load(path)
        if not (isinstance(doc, dict) and doc.get("example") is True):
            report.fail(str(path.relative_to(ROOT)), 'development fixture without top-level "example": true')


def run(quiet: bool = False) -> Report:
    report = Report()
    documents = check_schema_and_flags(report)
    check_sources(report, documents)
    check_hash_chains(report)
    check_numbers(report)
    check_fixtures(report)
    if not quiet:
        for line in report.failures:
            print("FAIL", line)
        print(f"{len(documents)} contract files checked; {len(report.failures)} failures; "
              f"{len(report.notes)} legacy files listed")
    return report


if __name__ == "__main__":
    sys.exit(1 if run("--quiet" in sys.argv).failures else 0)
