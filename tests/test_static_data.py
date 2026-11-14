"""Checks on the published files in static/data (Session A output). Skipped parts when absent."""
import json
from pathlib import Path

import pytest

DATA = Path(__file__).resolve().parent.parent / "static" / "data"
KEY_FIELDS = ("reason_key", "status_reason_key", "label_key", "rule_key", "until_key", "explain_key", "key",
              "method_key", "name_key", "prompt_key", "title_key", "formula_key", "teacher_note_key",
              "selection_rule_key", "note_key")
LIST_KEY_FIELDS = ("limitation_keys", "reason_keys", "credits_keys")


def load(name):
    path = DATA / name
    if not path.exists():
        pytest.skip(f"{name} not published")
    return json.loads(path.read_text())


def investigations():
    return sorted(DATA.glob("*/investigation.json"))


def collect_keys(node, found):
    if isinstance(node, dict):
        for field, value in node.items():
            if field in KEY_FIELDS and isinstance(value, str) and "." in value and field != "key":
                found.add(value)
            if field == "key" and isinstance(value, str) and value.startswith(("explain.", "limit.")):
                found.add(value)
            if field in ("limitation_keys", "reason_keys", "credits_keys", "exclusion_rules_keys") and isinstance(value, list):
                found.update(item for item in value if isinstance(item, str))
            if field == "quantity" and isinstance(value, str):
                found.add(f"quantity.{value}")
            collect_keys(value, found)
    elif isinstance(node, list):
        for item in node:
            collect_keys(item, found)


def test_every_data_key_has_english_text():
    strings = load("strings.en.json")["strings"]
    found = set()
    extra = [*DATA.glob("trials/*/*.json"), *DATA.glob("game/*.json"), *DATA.glob("lessons/*.json"), DATA / "scoreboard.json"]
    for path in [*investigations(), DATA / "index.json", DATA / "reserved.json", *extra]:
        if path.exists():
            collect_keys(json.loads(path.read_text()), found)
    found = {key for key in found if not key.startswith("target.")}
    missing = sorted(found - set(strings))
    assert not missing, missing


def test_real_data_never_carries_the_example_flag():
    for path in [*investigations(), DATA / "index.json", DATA / "reserved.json", DATA / "strings.en.json"]:
        if path.exists():
            assert json.loads(path.read_text()).get("example") is not True, path


def test_investigations_follow_the_contract_and_point_to_real_files():
    for path in investigations():
        doc = json.loads(path.read_text())
        assert doc["schema_version"] == "tenger.investigation/1"
        assert doc["target_key"] == path.parent.name
        epoch_ids = {epoch["id"] for epoch in doc["epochs"]}
        for epoch in doc["epochs"]:
            preview = epoch["assets"].get("preview")
            assert preview is None or (DATA / preview).exists(), preview
        for comparison in doc["comparisons"]:
            assert comparison["a"] in epoch_ids and comparison["b"] in epoch_ids
            assert comparison["grade"] in {"quantitative", "qualitative", "invalid"}
            if "difference" in comparison["modes"]:
                assert comparison["grade"] == "quantitative"
                assert comparison.get("field", {}).get("grade") == "quantitative"
        obs = {item["obs_key"] for item in doc["observations"]}
        for epoch in doc["epochs"]:
            assert set(epoch["obs_keys"]) <= obs | {key + ":fixed" for key in obs}
        for measurement in doc["measurements"]:
            if measurement["status"] != "measured":
                assert measurement["value"] is None
            assert measurement["content_type"] in {"measured", "catalogue", "modeled", "interpreted", "processed", "artificial"}


def test_viewer_mapping_matches_the_bundle():
    for path in investigations():
        doc = json.loads(path.read_text())
        if not doc.get("viewer"):
            continue
        meta = json.loads((DATA / doc["viewer"]["meta"]).read_text())
        frames = meta["frames"]
        for epoch in doc["epochs"]:
            for index in epoch["viewer"]["frame_indices"]:
                frame = frames[index]
                assert frame["obsKey"] in epoch["obs_keys"]
                assert frame["visit"] == epoch["visit"]


def test_training_only_bodies_never_include_the_holdout_window():
    for key in ("makemake", "pluto"):
        path = DATA / key / "investigation.json"
        if not path.exists():
            continue
        doc = json.loads(path.read_text())
        low, high = doc["coverage"]["holdout_window_mjd_closed"]
        for item in doc["observations"]:
            assert item["t_start_mjd"] < low - 1.0, item["obs_key"]


def test_reserved_regions_cover_the_holdout_paths():
    reserved = load("reserved.json")
    keys = {region["key"]: region for region in reserved["regions"]}
    assert {"makemake", "pluto", "3i-atlas"} <= set(keys)
    for region in keys.values():
        assert region["path"], region["key"]
        lo, hi = region["window_mjd"]
        assert all(lo <= point["mjd"] <= hi for point in region["path"])


def test_frozen_trials_have_intact_hash_chains_and_open_forecasts_are_not_counted():
    from scripts import predict

    trials_dir = DATA / "trials"
    if not trials_dir.exists():
        pytest.skip("no trials published")
    for folder in sorted(path for path in trials_dir.iterdir() if (path / "trial.json").exists()):
        assert predict.check(folder.name) == [], folder.name
        receipt = json.loads((folder / "receipt.json").read_text())
        assert len(receipt["commit"]) == 40
    scoreboard = load("scoreboard.json")
    rows = {row["trial_id"] for row in scoreboard["rows"]}
    assert not rows & set(scoreboard["open_forecasts"])
    for row in scoreboard["rows"]:
        prediction = json.loads((trials_dir / row["trial_id"] / "prediction.json").read_text())
        if prediction["prediction_status"] == "insufficient_data":
            assert row["status"] == "insufficient_data"


def test_the_pluto_postmortem_is_exploratory_and_matches_the_frozen_verdict():
    path = DATA / "trials" / "pluto" / "postmortem.json"
    if not path.exists():
        pytest.skip("no post-mortem")
    postmortem = json.loads(path.read_text())
    assert postmortem["exploratory"] is True and postmortem["counts"] is False
    assert postmortem["label"] == "exploratory, after the reveal"
    verification = json.loads((DATA / "trials" / "pluto-position-2026b" / "verification.json").read_text())
    assert postmortem["frozen"]["status"] == verification["status"] == "miss"
    assert postmortem["frozen"]["d2"] == verification["residuals"]["model"]["d2"]
    assert not (DATA / "trials" / "pluto" / "trial.json").exists()  # never a scored trial
    scoreboard = json.loads((DATA / "scoreboard.json").read_text())
    assert "pluto" not in {row["trial_id"] for row in scoreboard["rows"]}
