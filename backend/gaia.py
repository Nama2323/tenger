"""Nearby Gaia DR3 stars from the IRSA catalogue service, cached on disk."""
import csv
import io
import json

import httpx

from . import config
from .archive import _is_fresh, _write_atomic

TAP_URL = "https://irsa.ipac.caltech.edu/TAP/sync"
GAIA_EPOCH = 2016.0
MAX_STARS = 300
ROOT_TWO = 1.4143


def parse_csv(text: str) -> list[dict]:
    stars = []
    for row in csv.DictReader(io.StringIO(text)):
        try:
            stars.append(
                {
                    "ra": float(row["ra"]),
                    "dec": float(row["dec"]),
                    "g": float(row["phot_g_mean_mag"]),
                    "pmra": float(row["pmra"] or 0),
                    "pmdec": float(row["pmdec"] or 0),
                }
            )
        except (KeyError, ValueError):
            continue
    return stars


def nearby(ra: float, dec: float, fov: float) -> list[dict]:
    path = config.CACHE_DIR / "gaia" / f"{ra:.4f}_{dec:.4f}_{fov:.3f}.json"
    if _is_fresh(path):
        return json.loads(path.read_text())
    query = (
        f"SELECT TOP {MAX_STARS} ra,dec,phot_g_mean_mag,pmra,pmdec FROM gaia_dr3_source "
        f"WHERE CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',{ra:f},{dec:f},{fov / 2 * ROOT_TWO:f}))=1 "
        "AND phot_g_mean_mag IS NOT NULL ORDER BY phot_g_mean_mag"
    )
    response = httpx.get(TAP_URL, params={"QUERY": query, "FORMAT": "CSV"}, timeout=90)
    response.raise_for_status()
    stars = parse_csv(response.text)
    _write_atomic(path, json.dumps(stars).encode())
    return stars


FIELD_COLUMNS = (
    "source_id,ra,dec,ra_error,dec_error,parallax,parallax_error,pmra,pmra_error,pmdec,pmdec_error,"
    "phot_g_mean_mag,ruwe"
)


def parse_field_csv(text: str) -> list[dict]:
    """Rows with full astrometry; missing numbers become None, never 0."""
    def number(value):
        try:
            return float(value) if value not in ("", None) else None
        except ValueError:
            return None

    stars = []
    for row in csv.DictReader(io.StringIO(text)):
        star = {key: number(row.get(key)) for key in FIELD_COLUMNS.split(",") if key != "source_id"}
        star["source_id"] = row.get("source_id")
        if star["ra"] is not None and star["dec"] is not None:
            stars.append(star)
    return stars


def field_stars(ra: float, dec: float, radius_deg: float, g_max: float = 17.0) -> list[dict]:
    """Gaia DR3 sources with positions, parallaxes, motions and errors (epoch 2016.0), cached."""
    path = config.CACHE_DIR / "gaia" / f"field_{ra:.4f}_{dec:.4f}_{radius_deg:.4f}_{g_max:.1f}.json"
    if path.exists():
        return json.loads(path.read_text())
    query = (
        f"SELECT {FIELD_COLUMNS} FROM gaia_dr3_source "
        f"WHERE CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',{ra:f},{dec:f},{radius_deg:f}))=1 "
        f"AND phot_g_mean_mag < {g_max:f}"
    )
    response = httpx.get(TAP_URL, params={"QUERY": query, "FORMAT": "CSV"}, timeout=120)
    response.raise_for_status()
    stars = parse_field_csv(response.text)
    _write_atomic(path, json.dumps(stars).encode())
    return stars
