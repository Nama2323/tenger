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


def _depth_doc(**extra):
    point = {"mag_ab": 17.0, "injected": 10, "recovered": 5, "fraction": 0.5,
             "interval": [round(v, 4) for v in vr_wilson(5, 10)]}
    pooled = {"curve": [point], "depth_50_ab": None, "depth_90_ab": None}
    return {"schema_version": "tenger.planetx_depth/1", "contract_version": 12, "counts": False,
            "bands": [{"id": "w1", "pooled": pooled, "fields": [{"field_key": "barnard", **pooled}]}],
            "stacked_projection": {"projection": True}, **extra}


def vr_wilson(k, n):
    from backend import injection
    return injection.wilson(k, n)


def test_artificial_content_only_under_planetx(tmp_path, monkeypatch):
    (tmp_path / "lessons").mkdir()
    (tmp_path / "lessons" / "x.json").write_text(json.dumps(
        {"schema_version": "tenger.lesson/1", "contract_version": 12, "example_point": {"artificial": True}}))
    (tmp_path / "planetx").mkdir()
    (tmp_path / "planetx" / "depth.json").write_text(json.dumps(_depth_doc()))  # no top-level artificial: true
    monkeypatch.setattr(vr, "DATA", tmp_path)
    report = vr.Report()
    vr.check_schema_and_flags(report)
    assert any("artificial content outside planetx" in line for line in report.failures)
    assert any('without top-level "artificial": true' in line for line in report.failures)


def test_planetx_curves_must_match_their_counts(tmp_path, monkeypatch):
    doc = _depth_doc(artificial=True)
    doc["bands"][0]["fields"][0]["curve"][0] = dict(doc["bands"][0]["fields"][0]["curve"][0], recovered=9)
    (tmp_path / "planetx").mkdir()
    (tmp_path / "planetx" / "depth.json").write_text(json.dumps(doc))
    (tmp_path / "planetx" / "stray.webp").write_bytes(b"x")
    monkeypatch.setattr(vr, "DATA", tmp_path)
    report = vr.Report()
    documents = vr.check_schema_and_flags(report)
    vr.check_planetx(report, documents)
    assert any("disagrees with its counts" in line for line in report.failures)
    assert any("not referenced" in line for line in report.failures)
