import numpy as np

from backend import config, framestore
from backend.framestore import Frame
from backend.processing import Grid

GRID = Grid.for_fov(10.0, 0.0, 0.1)
TAG = framestore.cache_tag(GRID)


def make_frame(tag=TAG):
    pixels = np.array([[1.5, np.nan], [3.0, 4.0]], np.float32)
    mask = np.array([[0, 1], [0, 0]], np.uint8)
    meta = {"obsId": "o1", "detector": 2, "mjd": 61000.5, "visit": 1, "cache": {"tag": tag}}
    return Frame(meta, pixels, mask)


def test_saved_frame_comes_back_unchanged(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    framestore.save("job", "key", TAG, make_frame())
    loaded = framestore.load("job", "key", TAG, visit=7)
    assert loaded.meta["detector"] == 2
    assert np.array_equal(loaded.pixels, make_frame().pixels, equal_nan=True)
    assert loaded.mask.tolist() == [[0, 1], [0, 0]]


def test_visit_comes_from_the_current_job_not_the_stored_file(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    framestore.save("job", "key", TAG, make_frame())
    assert framestore.load("job", "key", TAG, visit=7).meta["visit"] == 7


def test_missing_frame_is_none(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    assert framestore.load("job", "absent", TAG, visit=0) is None


def test_corrupt_frame_is_treated_as_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    framestore.path_for("job", "bad", TAG).parent.mkdir(parents=True)
    framestore.path_for("job", "bad", TAG).write_bytes(b"not a frame")
    assert framestore.load("job", "bad", TAG, visit=0) is None


def test_cache_tag_changes_with_pipeline_mask_policy_and_grid(monkeypatch):
    other_grid = Grid.for_fov(10.0, 0.0, 0.2)
    assert framestore.cache_tag(other_grid) != TAG
    monkeypatch.setattr(config, "PIPELINE_VERSION", "something-else")
    assert framestore.cache_tag(GRID) != TAG
    monkeypatch.setattr(framestore, "MASK_POLICY", "another-policy")
    identity = framestore.cache_identity(GRID)
    assert identity["mask_policy"] == "another-policy"


def test_old_unversioned_cache_files_are_never_read(tmp_path, monkeypatch):
    """A QR-era frame stored at frames/<job>/<key>.npz must not be served as a corrected product."""
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    legacy = tmp_path / "frames" / "job" / "2025W33_2C_0321_1_D6_2.npz"
    legacy.parent.mkdir(parents=True)
    legacy.write_bytes(b"legacy")
    assert framestore.load("job", "2025W33_2C_0321_1_D6_2", TAG, visit=0) is None


def test_frame_with_a_different_cache_identity_is_rebuilt(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    framestore.save("job", "key", TAG, make_frame(tag="stale-tag"))
    assert framestore.load("job", "key", TAG, visit=0) is None
