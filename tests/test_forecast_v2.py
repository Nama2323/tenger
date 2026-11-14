"""Task A7: Pluto open forecast v2 (frozen) and the exploratory hindcast."""
import json
import shutil
from pathlib import Path

import httpx
import pytest

from scripts import forecast_v2, predict

DATA = Path(__file__).resolve().parent.parent / "static" / "data"
V2 = ("pluto-position-open-2027a-v2b", "pluto-position-open-2027b-v2b")


def test_v2_forecasts_are_frozen_open_and_intact():
    for trial_id in V2:
        folder = DATA / "trials" / trial_id
        trial = json.loads((folder / "trial.json").read_text())
        prediction = json.loads((folder / "prediction.json").read_text())
        assert trial["open_forecast"] is True and trial["method_version"] == 2
        assert trial["revises"] == "pluto-position-open-2027a"
        assert prediction["prediction_status"] == "predicted"
        assert prediction["model"]["along_track_95_arcsec"] > 0 and prediction["model"]["cross_track_95_arcsec"] > 0
        assert predict.check(trial_id) == []
        assert len(json.loads((folder / "receipt.json").read_text())["commit"]) == 40


def test_v1_open_forecast_is_unchanged_and_both_stay_out_of_the_counts():
    scoreboard = json.loads((DATA / "scoreboard.json").read_text())
    assert {"pluto-position-open-2027a", *V2} <= set(scoreboard["open_forecasts"])
    assert not {row["trial_id"] for row in scoreboard["rows"]} & {"pluto-position-open-2027a", *V2}
    assert predict.check("pluto-position-open-2027a") == []


def test_abandoned_manifests_were_never_predicted():
    for trial_id in ("pluto-position-open-2027a-v2", "pluto-position-open-2027b-v2"):
        folder = DATA / "trials" / trial_id
        note = json.loads((folder / "abandoned.json").read_text())
        assert note["predicted"] is False and not (folder / "prediction.json").exists()
        assert note["trial_sha256"] == predict.sha256((folder / "trial.json").read_bytes())
    assert "pluto-position-open-2027a-v2" in json.loads((DATA / "scoreboard.json").read_text())["abandoned_before_prediction"]


def test_v2_prediction_reads_only_its_folder_and_refuses_tampering(tmp_path, monkeypatch):
    trial_id = V2[0]
    shutil.copytree(DATA / "trials" / trial_id, tmp_path / trial_id)
    (tmp_path / trial_id / "prediction.json").unlink()
    (tmp_path / trial_id / "receipt.json").unlink()
    monkeypatch.setattr(forecast_v2, "TRIALS", tmp_path)
    monkeypatch.setattr(forecast_v2, "MC_DRAWS", 3)

    def no_network(*args, **kwargs):
        raise AssertionError("no network during prediction")

    monkeypatch.setattr(httpx, "get", no_network)
    path = forecast_v2.predict_v2(trial_id, "2026-11-15T00:00:00Z")
    assert json.loads(path.read_text())["prediction_status"] == "predicted"
    with pytest.raises(predict.FrozenError):
        forecast_v2.predict_v2(trial_id)  # never rewritten
    path.unlink()
    training = tmp_path / trial_id / "training.json"
    training.write_bytes(training.read_bytes().replace(b'"measured"', b'"measured" ', 1))
    with pytest.raises(predict.FrozenError):
        forecast_v2.predict_v2(trial_id)


def test_hindcast_is_exploratory_and_compares_old_and_new_methods():
    document = json.loads((DATA / "trials" / "pluto" / "hindcast-v2.json").read_text())
    assert document["exploratory"] is True and document["counts"] is False
    verification = json.loads((DATA / "trials" / "pluto-position-2026b" / "verification.json").read_text())
    assert document["old_method"]["d2"] == verification["residuals"]["model"]["d2"]
    new = document["new_method"]
    assert new["along_track_95_arcsec"] > document["old_method"]["error_arcsec"] / 2
    assert new["result_if_it_had_been_frozen"] in ("hit", "miss")
