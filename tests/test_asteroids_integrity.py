"""A9 integrity: evaluation-time ephemeris values never appear before the freeze (docs/EXPOSURE.md, A9 rule)."""
import json
import subprocess
from pathlib import Path

import pytest

from scripts import asteroids

ROOT = Path(__file__).resolve().parent.parent
POSITIONAL = {"ra_obj", "dec_obj", "vmag", "sun_dist", "geo_dist", "dist_ctr", "phase", "ra", "dec",
              "ra1", "dec1", "ra2", "dec2", "ra3", "dec3", "ra4", "dec4"}


def test_sanitize_keeps_only_identifiers_and_times():
    row = {key: "1" for key in POSITIONAL | set(asteroids.EVAL_KEEP)}
    assert set(asteroids.sanitize(row)) == set(asteroids.EVAL_KEEP)
    assert not POSITIONAL & set(asteroids.EVAL_KEEP)


def _walk(node, trail=()):
    if isinstance(node, dict):
        for key, value in node.items():
            yield trail + (key,), key, value
            yield from _walk(value, trail + (key,))
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from _walk(value, trail + (index,))


def test_selection_record_has_no_evaluation_positions():
    path = asteroids.OUT / "selection.json"
    if not path.exists():
        pytest.skip("selection not run yet")
    selection = json.loads(path.read_text())
    for record in selection["examined"]:
        for trail, key, _ in _walk(record.get("evaluation_visit") or {}):
            assert key not in POSITIONAL, f"{record['number']}: evaluation field {trail}"


def test_training_files_hold_training_rows_only():
    selection_path = asteroids.OUT / "selection.json"
    if not selection_path.exists():
        pytest.skip("selection not run yet")
    selection = json.loads(selection_path.read_text())
    for record in selection["examined"]:
        if record["number"] not in selection["selected"]:
            continue
        rows = json.loads((asteroids.OUT / f"training-{record['number']}.json").read_text())["rows"]
        evaluation_start = record["evaluation_visit"]["first_mjd"]
        assert rows and all(float(row["mjd_start"]) < evaluation_start - asteroids.VISIT_GAP_DAYS for row in rows)


def test_nothing_committed_before_the_freeze_holds_evaluation_ephemeris():
    """After the freeze, the raw MOST tables are saved; no evaluation RA/Dec may occur in the freeze commit."""
    raw_dir = asteroids.OUT / "raw"
    receipt = ROOT / "static" / "data" / "batches" / "asteroids-2026a" / "receipt.json"
    if not raw_dir.exists() or not receipt.exists():
        pytest.skip("batch not frozen yet")
    commit = json.loads(receipt.read_text())["commit"]
    patterns = set()
    for path in raw_dir.glob("*.json"):
        raw = json.loads(path.read_text())
        for row in raw["evaluation_rows"]:
            for key in ("ra_obj", "dec_obj"):
                value = float(row[key])
                patterns.update({f"{value:.5f}", f"{value:.6f}"})
    assert patterns
    found = subprocess.run(["git", "grep", "-F", "-l", *sum((["-e", p] for p in sorted(patterns)), []), commit],
                           cwd=ROOT, capture_output=True, text=True)
    hits = [line for line in found.stdout.splitlines() if "/raw/" not in line]
    assert hits == [], f"evaluation ephemeris values found in the freeze commit: {hits[:5]}"
