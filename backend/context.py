"""2MASS and AllWISE context for moving stars, with the real observation dates.

Catalogue content only (content_type "catalogue"): for astrometric context, never a
like-for-like brightness comparison with SPHEREx. A source counts as the target only
within MATCH_ARCSEC of the target's catalogue track at that observation's own date.
No match is reported as a non-detection (with the search radius), never filled in.
Service failures return status "unavailable" and never stop a build.
"""
import csv
import io
import math

import httpx

from .astrometry import tangent_offsets_arcsec
from .coords import propagate

TAP_URL = "https://irsa.ipac.caltech.edu/TAP/sync"
MATCH_ARCSEC = 3.0
MJD_2MASS_MID = 51544.5  # 2000.0; 2MASS observed 1997-2001
MJD_ALLWISE_MID = 55400.0  # mid 2010; AllWISE MEP covers 2010-2011
NOT_LIKE_FOR_LIKE = "context.not-like-for-like"


def _position(star: dict, mjd: float) -> tuple[float, float]:
    return propagate(star["ra"], star["dec"], star.get("pmra") or 0.0, star.get("pmdec") or 0.0, 2016.0, mjd)


def _radius_arcsec(star: dict, years: float) -> float:
    motion = math.hypot(star.get("pmra") or 0.0, star.get("pmdec") or 0.0) / 1000
    return 10.0 + motion * years


def _query(adql: str) -> list[dict]:
    response = httpx.get(TAP_URL, params={"QUERY": adql, "FORMAT": "CSV"}, timeout=120)
    response.raise_for_status()
    return list(csv.DictReader(io.StringIO(response.text)))


def _number(value):
    try:
        return float(value) if value not in ("", None) else None
    except ValueError:
        return None


def _matched(star: dict, rows: list[dict], mjd_of) -> list[dict]:
    matched = []
    for row in rows:
        mjd = mjd_of(row)
        ra, dec = _number(row.get("ra")), _number(row.get("dec"))
        if mjd is None or ra is None or dec is None:
            continue
        expected = _position(star, mjd)
        east, north = tangent_offsets_arcsec(expected[0], expected[1], ra, dec)
        separation = math.hypot(east, north)
        if separation <= MATCH_ARCSEC:
            matched.append({**row, "_mjd": mjd, "_sep": separation})
    return matched


def twomass(star: dict) -> dict:
    centre = _position(star, MJD_2MASS_MID)
    radius = _radius_arcsec(star, 3.0)
    base = {"survey": "2MASS PSC", "band": "Ks", "source": "IRSA fp_psc", "content_type": "catalogue",
            "label_key": "context.twomass-ks", "note_key": NOT_LIKE_FOR_LIKE,
            "search_radius_arcsec": round(radius, 1), "match_arcsec": MATCH_ARCSEC}
    try:
        rows = _query("SELECT ra,dec,k_m,k_msigcom,jdate,ph_qual FROM fp_psc WHERE "
                      f"CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',{centre[0]:f},{centre[1]:f},{radius / 3600:f}))=1")
    except httpx.HTTPError:
        return {**base, "status": "unavailable", "reason_key": "context.service-failed"}
    matched = _matched(star, rows, lambda row: (_number(row.get("jdate")) or 0) - 2400000.5 or None)
    if not matched:
        return {**base, "status": "not_detected", "reason_key": "context.no-source-on-track", "detections": []}
    return {**base, "status": "detected", "detections": [
        {"mjd": round(item["_mjd"], 5), "k_mag": _number(item.get("k_m")), "k_sigma_mag": _number(item.get("k_msigcom")),
         "ph_qual": item.get("ph_qual"), "offset_from_track_arcsec": round(item["_sep"], 2)} for item in matched]}


def allwise_mep(star: dict) -> dict:
    centre = _position(star, MJD_ALLWISE_MID)
    radius = _radius_arcsec(star, 1.0)
    base = {"survey": "AllWISE multi-epoch photometry", "band": "W2", "source": "IRSA allwise_p3as_mep",
            "content_type": "catalogue", "label_key": "context.allwise-w2", "note_key": NOT_LIKE_FOR_LIKE,
            "search_radius_arcsec": round(radius, 1), "match_arcsec": MATCH_ARCSEC}
    try:
        rows = _query("SELECT ra,dec,mjd,w2mpro_ep,w2sigmpro_ep FROM allwise_p3as_mep WHERE "
                      f"CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',{centre[0]:f},{centre[1]:f},{radius / 3600:f}))=1")
    except httpx.HTTPError:
        return {**base, "status": "unavailable", "reason_key": "context.service-failed"}
    matched = _matched(star, rows, lambda row: _number(row.get("mjd")))
    if not matched:
        return {**base, "status": "not_detected", "reason_key": "context.no-source-on-track", "n_exposures": 0}
    mjds = sorted(item["_mjd"] for item in matched)
    w2 = sorted(value for value in (_number(item.get("w2mpro_ep")) for item in matched) if value is not None)
    return {**base, "status": "detected", "n_exposures": len(matched),
            "mjd_first": round(mjds[0], 5), "mjd_last": round(mjds[-1], 5),
            "w2_median_mag": w2[len(w2) // 2] if w2 else None, "w2_measured_exposures": len(w2)}


def for_star(star: dict) -> dict:
    """Both surveys; each part fails independently."""
    try:
        first = twomass(star)
    except Exception:  # noqa: BLE001 - context must never break a build
        first = {"survey": "2MASS PSC", "status": "unavailable", "reason_key": "context.service-failed"}
    try:
        second = allwise_mep(star)
    except Exception:  # noqa: BLE001
        second = {"survey": "AllWISE multi-epoch photometry", "status": "unavailable", "reason_key": "context.service-failed"}
    return {"twomass_ks": first, "allwise_w2": second}
