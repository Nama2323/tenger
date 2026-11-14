"""The post-mortem's orbit code agrees with the frozen model where they should coincide."""
import numpy as np

from backend import orbit
from scripts import postmortem


def test_heliocentric_dense_solution_matches_the_frozen_propagator():
    state = np.array([15.0, -28.0, -12.0, 0.0018, 0.0006, -0.0002])
    ephemeris = postmortem.Ephemeris(60900.0, 61400.0)
    model = postmortem.Model("heliocentric_two_body", ephemeris)
    body_at = model.solve(state, 61000.0, 60950.0, 61300.0)
    for t in (60950.0, 61000.0, 61300.0):
        assert np.allclose(body_at(t), orbit.propagate(state, 61000.0, np.array([t]))[0], atol=1e-9)
    observer = orbit.observer_heliocentric_au(61300.0, None)
    assert np.allclose(model.radec(body_at, 61300.0, observer), orbit.apparent_radec(state, 61000.0, 61300.0, observer),
                       atol=1e-9)


def test_barycentric_total_mass_exceeds_the_sun_by_the_planets():
    assert 1.0013 < postmortem.GM_TOTAL / postmortem.GM_SUN < 1.0014


def test_ellipse_axes_and_angle():
    cov = np.diag([4.0, 1.0])  # east variance 4, north variance 1: long axis east (PA 90)
    shape = postmortem.ellipse(cov)
    assert abs(shape["semi_major_95_arcsec"] - 2.0 * 2.4477468306808166) < 1e-3
    assert abs(shape["position_angle_deg_east_of_north"] - 90.0) < 1e-6
