import httpx
import pytest

from backend import catalogs, config


def client_where(down: set[str]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host in down:
            return httpx.Response(404, text="This page is currently unavailable")
        return httpx.Response(200, text=f"answer from {request.url.host}")

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_cds_is_used_first_when_it_answers():
    text, url = catalogs.simbad_tap("SELECT 1", client_where(set()))
    assert "simbad.cds.unistra.fr" in url and "cds" in text


def test_cfa_mirror_answers_when_cds_is_down():
    text, url = catalogs.simbad_tap("SELECT 1", client_where({"simbad.cds.unistra.fr"}))
    assert url == config.SIMBAD_TAP_URLS[1] and "cfa.harvard.edu" in text
    _, url = catalogs.vizier_asu({"-source": "B/vsx"}, client_where({"vizier.cds.unistra.fr"}))
    assert "vizier.cfa.harvard.edu" in url


def test_all_mirrors_down_raises():
    hosts = {"simbad.cds.unistra.fr", "simbad.cfa.harvard.edu"}
    with pytest.raises(httpx.HTTPError):
        catalogs.simbad_tap("SELECT 1", client_where(hosts))


def test_probe_picks_first_reachable_host():
    assert catalogs.reachable_host(config.VIZIER_URLS, client_where({"vizier.cds.unistra.fr"})) == "vizier.cfa.harvard.edu"
