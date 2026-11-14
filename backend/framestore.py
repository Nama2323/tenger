"""Processed frames on disk: small, fast to read, and shippable with the app.

Every cache path carries a tag built from the pipeline version, the frame schema,
the flag mask policy and the display grid, and every key carries the release,
the exposure, the detector and the product version. Frames written by older code
(for example QR-only caches without a mask policy) are never found under a new
tag, so they are never reused as corrected products. They are not deleted.
"""
import hashlib
import io
import json
import logging
import zipfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import config
from .archive import _write_atomic
from .flags import MASK_POLICY

log = logging.getLogger("blink.framestore")


@dataclass(frozen=True)
class Frame:
    meta: dict
    pixels: np.ndarray
    mask: np.ndarray


def cache_identity(grid) -> dict:
    """Everything that changes what a cached frame means."""
    return {
        "pipeline": config.PIPELINE_VERSION,
        "frame_schema": config.FRAME_SCHEMA,
        "mask_policy": MASK_POLICY,
        "grid": [round(grid.ra, 6), round(grid.dec, 6), grid.n, round(grid.scale * 3600, 6)],
    }


def cache_tag(grid) -> str:
    identity = json.dumps(cache_identity(grid), sort_keys=True)
    return hashlib.sha256(identity.encode()).hexdigest()[:12]


def path_for(job_id: str, key: str, tag: str) -> Path:
    return config.CACHE_DIR / "frames" / job_id / tag / f"{key}.npz"


def native_path_for(key: str, cutout: str) -> Path:
    """Native-resolution product (FITS without its PSF table) for one cutout request."""
    digest = hashlib.sha256(cutout.encode()).hexdigest()[:10]
    return config.CACHE_DIR / "native" / f"{key}__{digest}.fits"


def save(job_id: str, key: str, tag: str, frame: Frame) -> None:
    output = io.BytesIO()
    np.savez_compressed(output, pixels=frame.pixels, mask=frame.mask, meta=json.dumps(frame.meta))
    _write_atomic(path_for(job_id, key, tag), output.getvalue())


def save_native(key: str, cutout: str, payload: bytes) -> Path:
    path = native_path_for(key, cutout)
    _write_atomic(path, payload)
    return path


def load(job_id: str, key: str, tag: str, visit: int) -> Frame | None:
    """Read a stored frame; a damaged or mismatched file counts as missing so it is rebuilt."""
    path = path_for(job_id, key, tag)
    if not path.exists():
        return None
    try:
        with np.load(path) as stored:
            meta = json.loads(str(stored["meta"]))
            if meta.get("cache", {}).get("tag") != tag:
                log.warning("Ignoring frame %s written under another cache identity", path)
                return None
            return Frame({**meta, "visit": visit}, stored["pixels"], stored["mask"])
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        log.warning("Ignoring damaged frame %s: %s", path, error)
        return None
