"""The production validator passes on the published data and catches the defects it is meant to catch."""
import json

from scripts import validate_release as vr


def test_published_data_passes():
    report = vr.run(quiet=True)
    assert report.failures == []


def test_example_content_is_rejected(tmp_path, monkeypatch):
    (tmp_path / "scoreboard.json").write_text(json.dumps(
        {"schema_version": "tenger.scoreboard/1", "contract_version": vr.LATEST_CONTRACT, "example": True}))
    monkeypatch.setattr(vr, "DATA", tmp_path)
    report = vr.Report()
    vr.check_schema_and_flags(report)
    assert any("example content" in line for line in report.failures)


def test_stale_and_unknown_schemas_are_rejected(tmp_path, monkeypatch):
    (tmp_path / "scene3d.json").write_text(json.dumps({"schema_version": "tenger.scene3d/1", "contract_version": 8}))
    (tmp_path / "other.json").write_text(json.dumps({"schema_version": "tenger.mystery/1", "contract_version": 11}))
    monkeypatch.setattr(vr, "DATA", tmp_path)
    report = vr.Report()
    vr.check_schema_and_flags(report)
    assert len(report.failures) >= 2


def test_unlabelled_fixture_is_rejected(tmp_path, monkeypatch):
    (tmp_path / "scoreboard.json").write_text(json.dumps({"schema_version": "tenger.scoreboard/1"}))
    monkeypatch.setattr(vr, "FIXTURES", tmp_path)
    monkeypatch.setattr(vr, "ROOT", tmp_path)
    report = vr.Report()
    vr.check_fixtures(report)
    assert report.failures and "example" in report.failures[0]
