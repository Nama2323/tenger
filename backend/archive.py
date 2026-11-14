"""Access to the IRSA SPHEREx archive: release discovery, search and cutouts."""
import csv
import io
import json
import logging
import random
import re
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import httpx

from . import config

log = logging.getLogger("blink.archive")
# Level 2 spectral-image collections: data releases (dr) and quick releases (qr),
# wide survey or deep fields. Spectral cubes (spherex_dr1_cube) are another product.
_COLLECTION = re.compile(r'value="(spherex_(?:dr|qr)\d+(?:_deep)?)"')
_RELEASE = re.compile(r"^spherex_(dr|qr)(\d+)(_deep)?$")
_PROCESSING = re.compile(r"_spx_(l2b-v(\d+)-(\d{4})-(\d{3}))\.fits")
_DETECTOR = re.compile(r"^SPHEREx-D([1-6])$")
METRES_TO_UM = 1e6
SEARCH_SCHEMA = 2  # bump to stop reading search caches written by older code


@dataclass(frozen=True)
class Release:
    kind: str  # "dr" (data release) or "qr" (quick release)
    number: int
    field: str  # "wide" or "deep"


def parse_release(collection: str) -> Release | None:
    match = _RELEASE.match(collection)
    if not match:
        return None
    return Release(match[1], int(match[2]), "deep" if match[3] else "wide")


def parse_processing(url: str) -> str | None:
    """Pipeline product version from the file name, e.g. 'l2b-v27-2026-228'."""
    match = _PROCESSING.search(url)
    return match[1] if match else None


@dataclass(frozen=True)
class Exposure:
    obs_id: str
    detector: int
    mjd: float
    wave_min_um: float
    wave_max_um: float
    url: str
    collection: str
    mjd_end: float | None = None
    processing: str | None = None
    release_date: str | None = None
    publisher_did: str | None = None

    @property
    def obs_key(self) -> str:
        """Release-aware identity: '<collection>:<obs_id>:D<detector>'."""
        return f"{self.collection}:{self.obs_id}:D{self.detector}"

    @property
    def release(self) -> Release | None:
        return parse_release(self.collection)


def parse_collections(self_description: str) -> tuple[str, ...]:
    return tuple(dict.fromkeys(_COLLECTION.findall(self_description)))


def parse_sia_csv(text: str) -> list[Exposure]:
    return [
        exposure
        for row in csv.DictReader(io.StringIO(text))
        if (exposure := _row_to_exposure(row)) is not None
    ]


def _optional_float(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _row_to_exposure(row: dict) -> Exposure | None:
    match = _DETECTOR.match(row.get("energy_bandpassname") or "")
    if not match:
        return None
    try:
        collection = row["obs_collection"]
        if parse_release(collection) is None:
            log.warning("Skipping row from unrecognised collection %r", collection)
            return None
        return Exposure(
            obs_id=row["obs_id"],
            detector=int(match[1]),
            mjd=float(row["t_min"]),
            wave_min_um=float(row["em_min"]) * METRES_TO_UM,
            wave_max_um=float(row["em_max"]) * METRES_TO_UM,
            url=row["access_url"],
            collection=collection,
            mjd_end=_optional_float(row.get("t_max")),
            processing=parse_processing(row["access_url"]),
            release_date=row.get("obs_release_date") or None,
            publisher_did=row.get("obs_publisher_did") or None,
        )
    except (KeyError, TypeError, ValueError) as error:
        log.warning("Skipping malformed archive row: %s", error)
        return None


def _processing_rank(exposure: Exposure) -> tuple[int, str]:
    match = re.match(r"l2b-v(\d+)-(\d{4}-\d{3})", exposure.processing or "")
    return (int(match[1]), match[2]) if match else (-1, "")


def release_rank(exposure: Exposure, priority: tuple[str, ...] = config.RELEASE_PRIORITY) -> tuple:
    """Order products of one exposure: release kind by priority, then number, then pipeline version."""
    release = exposure.release
    if release is None:
        return (-1, -1, (-1, ""))
    kind = len(priority) - priority.index(release.kind) if release.kind in priority else 0
    return (kind, release.number, _processing_rank(exposure))


def select_products(exposures: list[Exposure], priority: tuple[str, ...] = config.RELEASE_PRIORITY) -> list[Exposure]:
    """One product per (exposure, detector): a data release beats a quick release by default.

    Products of the same exposure in different releases are the same photons, so
    they are never counted twice (see docs/EXPOSURE.md, exposure is per obs_id).
    """
    best: dict[tuple[str, int], Exposure] = {}
    for exposure in exposures:
        key = (exposure.obs_id, exposure.detector)
        held = best.get(key)
        if held is None or release_rank(exposure, priority) > release_rank(held, priority):
            best[key] = exposure
    return list(best.values())


dedupe_latest = select_products  # earlier name, kept for callers outside this package


def cutout_url(exposure: Exposure, ra: float, dec: float, size_deg: float) -> str:
    return f"{exposure.url}?center={round(ra, 5)},{round(dec, 5)}&size={round(size_deg, 4)}"


def exposure_key(exposure: Exposure) -> str:
    """File-safe cache key that changes when the release or the product version changes."""
    return f"{exposure.collection}__{exposure.obs_id}_D{exposure.detector}__{exposure.processing or 'unversioned'}"


def discover_collections(client: httpx.Client) -> tuple[str, ...]:
    """Ask the archive which SPHEREx releases exist, so new ones (DR1, QR3, later) appear unaided."""
    path = config.CACHE_DIR / f"collections-v{SEARCH_SCHEMA}.json"
    if _is_fresh(path):
        return _allowed(tuple(json.loads(path.read_text())))
    try:
        response = client.get(config.IRSA_SIA_URL, params={"POS": "circle 0 0 0.0001", "MAXREC": 0})
        response.raise_for_status()
        found = parse_collections(response.text)
    except httpx.HTTPError as error:
        log.warning("Release discovery failed: %s", error)
        found = ()
    if found:
        _write_atomic(path, json.dumps(found).encode())
        return _allowed(found)
    cached = tuple(json.loads(path.read_text())) if path.exists() else config.FALLBACK_COLLECTIONS
    return _allowed(cached)


def _allowed(collections: tuple[str, ...]) -> tuple[str, ...]:
    """Apply the optional BLINK_COLLECTIONS restriction."""
    if not config.ONLY_COLLECTIONS:
        return collections
    return tuple(item for item in collections if item in config.ONLY_COLLECTIONS)


def search(client: httpx.Client, ra: float, dec: float) -> list[Exposure]:
    """List every exposure covering a position, across all known releases."""
    path = config.CACHE_DIR / "search" / f"v{SEARCH_SCHEMA}" / f"{ra:.4f}_{dec:.4f}.json"
    if _is_fresh(path):
        return _read_search(path)
    try:
        found = _query_all_releases(client, ra, dec)
    except httpx.HTTPError as error:
        if path.exists():
            log.warning("Search failed, using stale result: %s", error)
            return _read_search(path)
        raise
    _write_atomic(path, json.dumps([asdict(item) for item in found]).encode())
    return found


def _query_all_releases(client: httpx.Client, ra: float, dec: float) -> list[Exposure]:
    rows: list[Exposure] = []
    for collection in discover_collections(client):
        response = client.get(
            config.IRSA_SIA_URL,
            params={
                "COLLECTION": collection,
                "POS": f"circle {ra} {dec} 0.001",
                "RESPONSEFORMAT": "CSV",
            },
        )
        response.raise_for_status()
        rows.extend(parse_sia_csv(response.text))
    return sorted(select_products(rows), key=lambda item: (item.mjd, item.detector))


def _read_search(path: Path) -> list[Exposure]:
    return [Exposure(**item) for item in json.loads(path.read_text())]


def fetch_cutout(
    client: httpx.Client, exposure: Exposure, ra: float, dec: float, size_deg: float
) -> bytes:
    """Download one cutout as FITS bytes."""
    return _download(client, cutout_url(exposure, ra, dec, size_deg))


def _download(client: httpx.Client, url: str) -> bytes:
    """Fetch with retries, honouring the archive's Retry-After when it is busy."""
    for attempt in range(config.CUTOUT_RETRIES):
        response = None
        try:
            response = client.get(url)
            response.raise_for_status()
            return response.content
        except httpx.HTTPError as error:
            log.info("Cutout attempt %d failed for %s: %s", attempt + 1, url, error)
            if attempt + 1 == config.CUTOUT_RETRIES:
                raise
            time.sleep(_retry_delay(response, attempt))
    raise RuntimeError("unreachable")


def _retry_delay(response: httpx.Response | None, attempt: int) -> float:
    wait = response.headers.get("retry-after", "") if response is not None else ""
    jitter = random.uniform(0, 2)
    return (float(wait) if wait.isdigit() else 2**attempt) + jitter


def _is_fresh(path: Path) -> bool:
    return path.exists() and time.time() - path.stat().st_mtime < config.SEARCH_TTL_SECONDS


def _write_atomic(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".part")
    temporary.write_bytes(payload)
    temporary.replace(path)
