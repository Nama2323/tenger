"""Background jobs that collect exposures for one sky patch, frame by frame."""
import hashlib
import logging
import random
import threading
from collections import Counter, OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx
import numpy as np

from . import archive, config, framestore
from .archive import Exposure
from .coords import mjd_to_year
from .flags import count_by_flag
from .framestore import Frame
from .processing import (
    Grid,
    ProductError,
    channel_index,
    display_native,
    group_visits,
    load_product,
    reproject,
    response_at,
    trim_product,
    wavelength_gradient,
)

log = logging.getLogger("blink.jobs")
MIN_COVERED_FRACTION = 0.05
_download_pool = ThreadPoolExecutor(config.DOWNLOAD_WORKERS, thread_name_prefix="cutout")


class Job:
    def __init__(self, ra: float, dec: float, fov: float, limit: int = config.MAX_EXPOSURES):
        self.id = job_id(ra, dec, fov)
        self.grid = Grid.for_fov(ra, dec, fov)
        self.limit = limit
        self.status = "searching"
        self.error: str | None = None
        self.available = 0
        self.total = 0
        self.failed = 0
        self.rejected: Counter[str] = Counter()  # exposures refused, by reason key
        self.cache_tag = framestore.cache_tag(self.grid)
        self.frames: list[Frame] = []
        self._lock = threading.Lock()

    def frames_from(self, start: int) -> list[Frame]:
        with self._lock:
            return self.frames[start:]

    def summary(self) -> dict:
        return {
            "id": self.id,
            "status": self.status,
            "error": self.error,
            "done": len(self.frames),
            "failed": self.failed,
            "rejected": dict(self.rejected),
            "total": self.total,
            "available": self.available,
            "ra": self.grid.ra,
            "dec": self.grid.dec,
            "fov": self.grid.fov,
            "n": self.grid.n,
            "scale": self.grid.scale,
        }

    def run(self) -> None:
        try:
            with httpx.Client(timeout=config.HTTP_TIMEOUT_SECONDS, follow_redirects=True) as client:
                self._collect(client)
            self.status = "done"
        except Exception as error:
            log.exception("Job %s failed", self.id)
            self.error = f"The SPHEREx archive could not be reached: {error}"
            self.status = "error"

    def _collect(self, client: httpx.Client) -> None:
        exposures = archive.search(client, self.grid.ra, self.grid.dec)
        self.available = len(exposures)
        chosen = sample_evenly(exposures, self.limit)
        self.total = len(chosen)
        self.status = "downloading"
        visits = dict(zip(chosen, group_visits([item.mjd for item in chosen])))
        # A random order fills every date and band early, so a partial result is useful.
        order = random.Random(self.id).sample(chosen, len(chosen))
        pending = [_download_pool.submit(self._build, client, item, visits[item]) for item in order]
        for future in as_completed(pending):
            self._store(future)

    def _store(self, future) -> None:
        try:
            frame = future.result()
        except ProductError as error:
            log.warning("Exposure refused in job %s: %s", self.id, error)
            self.rejected["product.unusable-quality-metadata"] += 1
            self.failed += 1
            return
        except Exception as error:
            log.warning("Exposure skipped in job %s: %s", self.id, error)
            self.failed += 1
            return
        if frame is None:
            self.failed += 1
            return
        with self._lock:
            self.frames = [*self.frames, frame]

    def _build(self, client: httpx.Client, exposure: Exposure, visit: int) -> Frame | None:
        key = archive.exposure_key(exposure)
        stored = framestore.load(self.id, key, self.cache_tag, visit)
        if stored is not None:
            return stored
        size = self.grid.fov * config.CUTOUT_MARGIN
        url = archive.cutout_url(exposure, self.grid.ra, self.grid.dec, size)
        payload = archive.fetch_cutout(client, exposure, self.grid.ra, self.grid.dec, size)
        frame = self._process(payload, exposure, visit, url)
        if frame is not None:
            framestore.save(self.id, key, self.cache_tag, frame)
        return frame

    def _process(self, payload: bytes, exposure: Exposure, visit: int, url: str = "") -> Frame | None:
        product = load_product(payload)
        native = display_native(product)
        pixels, mask = reproject(native, self.grid)
        covered = np.isfinite(pixels)
        if covered.mean() < MIN_COVERED_FRACTION:
            return None
        source_sha256 = hashlib.sha256(payload).hexdigest()
        native_file = None
        if config.KEEP_NATIVE_PRODUCTS:
            key = archive.exposure_key(exposure)
            saved = framestore.save_native(key, url, trim_product(payload, source_sha256))
            native_file = str(saved.relative_to(config.CACHE_DIR))
        response = response_at(product, self.grid.ra, self.grid.dec, exposure.detector)
        if response is not None:
            wavelength = response.centre_um
            wave_dx, wave_dy = wavelength_gradient(native, self.grid)
        else:
            # Display placement only. With no WCS-WAVE value this frame has no known
            # response, so it can never enter a quantitative comparison.
            wavelength = (exposure.wave_min_um + exposure.wave_max_um) / 2
            wave_dx, wave_dy = 0.0, 0.0
        meta = {
            "obsId": exposure.obs_id,
            "obsKey": exposure.obs_key,
            "detector": exposure.detector,
            "mjd": exposure.mjd,
            "mjdEnd": exposure.mjd_end,
            "timeScale": "UTC",
            "year": mjd_to_year(exposure.mjd),
            "visit": visit,
            "wavelength": wavelength,
            "waveDx": wave_dx,
            "waveDy": wave_dy,
            "channel": channel_index(wavelength, exposure.detector),
            "response": response.to_json() if response else None,
            "responseStatus": "known" if response else "unknown",
            "release": exposure.collection,
            "processing": exposure.processing,
            "releaseDate": exposure.release_date,
            "flaggedPct": round(float(mask[covered].mean() * 100), 2),
            "flagSchema": product.flag_schema.schema,
            "maskPolicy": product.flag_schema.policy,
            "flagCounts": count_by_flag(product.flags, product.flag_schema),
            "source": {"url": url or None, "sha256": source_sha256, "bytes": len(payload),
                       "software": product.software_version, "native": native_file},
            "cache": {"tag": self.cache_tag, **framestore.cache_identity(self.grid)},
        }
        return Frame(meta, pixels, mask)


def job_id(ra: float, dec: float, fov: float) -> str:
    return hashlib.sha1(f"{ra:.4f}|{dec:.4f}|{fov:.3f}".encode()).hexdigest()[:12]


def sample_evenly(exposures: list[Exposure], limit: int) -> list[Exposure]:
    """Thin a long list evenly in time within each array, so every colour stays covered."""
    if len(exposures) <= limit:
        return exposures
    arrays = sorted({item.detector for item in exposures})
    chosen: list[Exposure] = []
    for position, detector in enumerate(arrays):
        members = [item for item in exposures if item.detector == detector]
        share = (limit - len(chosen)) // (len(arrays) - position)
        keep = np.linspace(0, len(members) - 1, min(share, len(members))).astype(int)
        chosen.extend(members[index] for index in keep)
    return sorted(chosen, key=lambda item: item.mjd)


class JobStore:
    """Recently used jobs; a rerun after eviction rebuilds from the disk cache."""

    def __init__(self) -> None:
        self._jobs: OrderedDict[str, Job] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, identifier: str) -> Job | None:
        with self._lock:
            return self._jobs.get(identifier)

    def start(self, ra: float, dec: float, fov: float) -> Job:
        identifier = job_id(ra, dec, fov)
        with self._lock:
            existing = self._jobs.get(identifier)
            if existing and existing.status != "error":
                self._jobs.move_to_end(identifier)
                return existing
            job = Job(ra, dec, fov)
            self._jobs[identifier] = job
            while len(self._jobs) > config.MAX_JOBS_IN_MEMORY:
                self._jobs.popitem(last=False)
        threading.Thread(target=job.run, daemon=True, name=f"job-{identifier}").start()
        return job
