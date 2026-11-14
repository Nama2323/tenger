"""SIMBAD and VizieR with an automatic mirror fallback.

CDS Strasbourg stays the first choice. When it cannot be reached (it was down on
14 Nov 2026), the CfA mirror at Harvard answers the same queries. The order lives
in config.SIMBAD_TAP_URLS and config.VIZIER_URLS.
"""
import logging
from urllib.parse import urlparse

import httpx

from . import config

log = logging.getLogger("blink.catalogs")
PROBE_TIMEOUT_SECONDS = 8
QUERY_TIMEOUT_SECONDS = 60


def _first_answer(urls, params: dict, client: httpx.Client | None, timeout: float) -> tuple[str, str]:
    """Return (text, url) from the first service that answers with HTTP 200."""
    own = client is None
    client = client or httpx.Client(timeout=timeout, follow_redirects=True)
    last: Exception | None = None
    try:
        for url in urls:
            try:
                response = client.get(url, params=params)
                response.raise_for_status()
                return response.text, url
            except httpx.HTTPError as error:
                log.warning("Catalogue service %s failed: %s", url, error)
                last = error
    finally:
        if own:
            client.close()
    raise last or httpx.HTTPError("no catalogue service configured")


def simbad_tap(adql: str, client: httpx.Client | None = None) -> tuple[str, str]:
    """Run a synchronous SIMBAD TAP query (CSV). Returns (csv_text, service_url)."""
    params = {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "csv", "QUERY": adql}
    return _first_answer(config.SIMBAD_TAP_URLS, params, client, QUERY_TIMEOUT_SECONDS)


def vizier_asu(params: dict, client: httpx.Client | None = None) -> tuple[str, str]:
    """Run a VizieR ASU-TSV query. Returns (tsv_text, service_url)."""
    return _first_answer(config.VIZIER_URLS, params, client, QUERY_TIMEOUT_SECONDS)


def reachable_host(urls, client: httpx.Client | None = None) -> str | None:
    """Host name of the first service that answers a small request, in priority order."""
    own = client is None
    client = client or httpx.Client(timeout=PROBE_TIMEOUT_SECONDS, follow_redirects=True)
    try:
        for url in urls:
            try:
                client.get(url, params={"-source": "I/239/hip_main", "-out.max": 1}).raise_for_status()
                return urlparse(url).hostname
            except httpx.HTTPError as error:
                log.warning("Mirror probe %s failed: %s", url, error)
    finally:
        if own:
            client.close()
    return None


def configure_astroquery(client: httpx.Client | None = None) -> dict:
    """Point astroquery's SIMBAD and VizieR at the first reachable mirror (CDS first).

    astroquery is optional (not in requirements.txt). Returns the chosen hosts.
    """
    chosen = {}
    try:
        from astroquery.simbad import conf as simbad_conf
        from astroquery.vizier import conf as vizier_conf
    except ImportError:
        return chosen
    simbad = reachable_host(config.SIMBAD_TAP_URLS, client)
    vizier = reachable_host(config.VIZIER_URLS, client)
    if simbad:
        simbad_conf.server = simbad
        chosen["simbad"] = simbad
    if vizier:
        vizier_conf.server = vizier
        chosen["vizier"] = vizier
    return chosen
