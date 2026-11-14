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


def _tokens(value: float) -> set[str]:
    return {f"{value:.4f}", f"{value:.5f}", f"{value:.6f}"}


def _has_token(text: str, token: str) -> bool:
    import re
    return re.search(r"(?<![0-9.])" + re.escape(token) + r"(?![0-9])", text) is not None


def test_nothing_committed_before_the_freeze_holds_evaluation_ephemeris():
    """No file in the freeze commit holds both coordinates of any evaluation-row position (whole numbers, 4-6
    decimals). A single coordinate equal to five decimals happens by chance in large files (for example the
    3I/ATLAS path shares 1021's evaluation declination -16.49581 at RA 244.6 vs 346.7), so pairs are required."""
    raw_dir = asteroids.OUT / "raw"
    if not raw_dir.exists() or not list(raw_dir.glob("*.json")):
        pytest.skip("batch not frozen yet")
    commit = json.loads(sorted(raw_dir.glob("*.json"))[0].read_text())["after_freeze_commit"]
    pairs = []
    for path in raw_dir.glob("*.json"):
        raw = json.loads(path.read_text())
        pairs += [(_tokens(float(row["ra_obj"])), _tokens(float(row["dec_obj"]))) for row in raw["evaluation_rows"]]
    assert pairs
    every_ra = sorted({token for ra, _ in pairs for token in ra})
    listed = subprocess.run(["git", "grep", "-F", "-l", *sum((["-e", t] for t in every_ra), []), commit],
                            cwd=ROOT, capture_output=True, text=True).stdout.splitlines()
    hits = []
    for entry in listed:
        path = entry.split(":", 1)[1]
        if "/raw/" in path:
            continue
        text = subprocess.run(["git", "show", f"{commit}:{path}"], cwd=ROOT, capture_output=True, text=True).stdout
        for ra_tokens, dec_tokens in pairs:
            if any(_has_token(text, t) for t in ra_tokens) and any(_has_token(text, t) for t in dec_tokens):
                hits.append(path)
                break
    assert hits == [], f"evaluation ephemeris positions found in the freeze commit: {hits[:5]}"
