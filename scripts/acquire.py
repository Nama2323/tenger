"""Download and process every DR1/QR3 exposure of a prepared target (fixed sky field).

Usage: python -m scripts.acquire <target-key> [--limit N]

Frames and native products land in the cache (config.CACHE_DIR, versioned paths).
This opens pixels: run it only for targets whose observations may be opened under
docs/EXPOSURE.md (Task A3: the five challenge targets).
"""
import argparse
import json
import sys
import time

from backend import config
from backend.jobs import Job
from backend.presets import ALL_TARGETS

ALLOWED = {"barnard", "wise0855", "epsindib", "rwaur", "rdra"}


def acquire(key: str, limit: int) -> dict:
    if key not in ALLOWED:
        raise SystemExit(f"{key}: not allowed by the Task A3 exposure rule (fixed-field acquisition)")
    preset = next(item for item in ALL_TARGETS if item.key == key)
    ra, dec = preset.centre()
    job = Job(ra, dec, preset.fov, limit=limit)
    started = time.time()
    job.run()
    summary = {**job.summary(), "key": key, "seconds": round(time.time() - started), "cache": str(config.CACHE_DIR)}
    print(json.dumps(summary), flush=True)
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("key")
    parser.add_argument("--limit", type=int, default=100000)
    args = parser.parse_args()
    result = acquire(args.key, args.limit)
    sys.exit(0 if result["status"] == "done" else 1)
