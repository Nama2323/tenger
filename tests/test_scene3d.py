"""Task A6: scene3d.json content and the orbit-element helpers."""
import json
import math
from pathlib import Path

import numpy as np
import pytest

from backend import orbit
from scripts import build_scene3d

DATA = Path(__file__).resolve().parent.parent / "static" / "data"


def scene():
    path = DATA / "scene3d.json"
    if not path.exists():
        pytest.skip("scene3d.json not published")
    return json.loads(path.read_text())


def test_elements_from_a_circular_orbit():
    r = np.array([30.0, 0.0, 0.0])
    v = np.array([0.0, math.sqrt(orbit.GM_SUN / 30.0), 0.0])
    elements = build_scene3d.elements_from_state(r, v)
    assert elements["a"] == pytest.approx(30.0, abs=1e-3) and elements["e"] < 1e-4 and elements["i"] < 1e-6


def test_kepler_points_lie_on_the_ellipse():
    points = np.array(build_scene3d.kepler_points(40.0, 0.25, 17.0, 110.0, 114.0))
    distances = np.linalg.norm(points, axis=1)
    assert distances.min() == pytest.approx(30.0, abs=0.05) and distances.max() == pytest.approx(50.0, abs=0.05)


def test_ecliptic_rotation_keeps_lengths_and_maps_the_pole():
    vector = np.array([0.3, -0.4, 0.5])
    assert np.linalg.norm(build_scene3d.to_ecliptic(vector)) == pytest.approx(np.linalg.norm(vector))
    pole = build_scene3d.to_ecliptic([0.0, -math.sin(build_scene3d.OBLIQUITY_RAD), math.cos(build_scene3d.OBLIQUITY_RAD)])
    assert pole == pytest.approx([0.0, 0.0, 1.0], abs=1e-12)


def test_scene_labels_every_source():
    document = scene()
    assert document["schema_version"] == "tenger.scene3d/1"
    pluto = document["bodies"]["pluto"]
    assert pluto["catalogue_orbit"]["content_type"] == "catalogue" and "SBDB" in pluto["catalogue_orbit"]["source"]
    assert pluto["position_now"]["content_type"] == "catalogue" and "Horizons" in pluto["position_now"]["source"]
    assert pluto["our_orbit"]["ours"] is True and pluto["our_orbit"]["content_type"] == "modeled"
    for star in document["stars"]:
        assert star["content_type"] == "catalogue" and star["source"] and star["evidence"].endswith("investigation.json")


def test_planet_nine_is_hypothetical_and_every_number_is_cited():
    nine = scene()["planet_nine"]
    assert nine["status"] == "hypothetical"
    for estimate in nine["estimates"]:
        assert estimate["reference"] and estimate["doi"]
        assert not {"position_au", "orbit_points_au", "ra_deg", "dec_deg"} & set(estimate)  # nothing drawn as known


def test_pluto_loop_has_every_exposure_and_the_reveal():
    loop = scene()["pluto_loop"]
    training = json.loads((DATA / "trials" / "pluto-position-2026b" / "training.json").read_text())
    assert len(loop["training"]) == len(training["points"])
    assert len(loop["evaluation"]) == 20
    assert sum("measured" in row for row in loop["evaluation"]) == 4
    assert all(abs(np.linalg.norm(row["spherex_au"]) - 1.0) < 0.03 for row in loop["training"] + loop["evaluation"])
    assert loop["observed"]["verdict"] == "miss" and loop["frozen_forecast"]["trial_id"] == "pluto-position-2026b"
    assert loop["open_forecast_2027"]["track"]
