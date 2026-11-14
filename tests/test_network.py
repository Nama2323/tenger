"""Checks against live services. Skipped unless run with --network or TENGER_NETWORK=1.

They read metadata only (no pixels), at a neutral sky position.
"""
import httpx
import pytest

from backend import archive, config

pytestmark = pytest.mark.network


def test_irsa_lists_data_and_quick_releases(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    with httpx.Client(timeout=60) as client:
        found = archive.discover_collections(client)
    assert "spherex_dr1" in found and "spherex_qr3" in found
    assert not any(name.endswith("_cube") for name in found)


def test_simbad_answers_from_cds_or_the_cfa_mirror():
    from backend import catalogs

    text, url = catalogs.simbad_tap("SELECT TOP 1 main_id FROM basic WHERE main_id = 'NAME Barnard''s star'")
    assert url in config.SIMBAD_TAP_URLS
    assert "main_id" in text
