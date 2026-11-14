"""The exposure inventory decides which observations may still be called unopened."""
from scripts.exposure_inventory import group_visits, inside_polygon, parse_polygon, summarise_candidates


def square(ra, dec, half):
    return [(ra - half, dec - half), (ra + half, dec - half), (ra + half, dec + half), (ra - half, dec + half)]


def test_point_in_footprint_and_outside():
    footprint = square(100.0, 10.0, 1.75)
    assert inside_polygon(100.0, 10.0, footprint)
    assert not inside_polygon(103.0, 10.0, footprint)


def test_footprint_across_ra_zero():
    footprint = [(359.0, -1.0), (1.0, -1.0), (1.0, 1.0), (359.0, 1.0)]
    assert inside_polygon(0.2, 0.0, footprint)
    assert inside_polygon(359.8, 0.0, footprint)
    assert not inside_polygon(2.0, 0.0, footprint)


def test_parse_ivoa_polygon_text():
    text = "POLYGON ICRS 266.69 5.47 270.17 5.14 269.99 1.66 266.50 1.99 266.69 5.47"
    vertices = parse_polygon(text)
    assert vertices[0] == (266.69, 5.47) and len(vertices) == 5
    assert inside_polygon(268.3, 3.6, vertices)


def row(obs_id, mjd):
    return {"obs_id": obs_id, "t_min_mjd": mjd, "t_max_mjd": mjd + 0.001, "detector": 1, "collection": "spherex_dr1"}


def test_visits_split_on_gaps():
    visits = group_visits([row("a", 61000.0), row("b", 61005.0), row("c", 61100.0)])
    assert [len(v) for v in visits] == [2, 1]


def test_unopened_exposure_next_to_an_exposed_one_is_not_independent():
    candidates = [row("before", 60992.0), row("just-after", 61008.0), row("far", 61200.0)]
    summary = summarise_candidates(candidates, exposed_mjds=[61000.0])
    before, just_after, far = summary["visits"]
    assert before["shares_visit_window_with_exposed"] and not before["after_newest_exposed"]
    # Newer than everything exposed, yet in the same visit: still not independent.
    assert just_after["shares_visit_window_with_exposed"] and just_after["after_newest_exposed"]
    assert not far["shares_visit_window_with_exposed"] and far["after_newest_exposed"]
    assert summary["after_newest_exposed_obs_ids"] == 2
