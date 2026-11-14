"""Per-visit colour previews for the moving targets (display only): static/data/<key>/composites.json.

Usage: python -m scripts.build_composites

Display colours, not for measurement: within each visit, the body-centred display frames
of arrays 5-6 (red), 3-4 (green) and 1-2 (blue) are median-stacked and stretched per channel.
Same geometry as the single-array epoch previews (centred on the body, north up, east left).
Reads only the cached training/See frames already used by the A3 previews.
"""
import json
import warnings
from pathlib import Path

import numpy as np
from PIL import Image

from backend import config
from backend.processing import group_visits

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "static" / "data"
KEYS = ("pluto", "makemake", "3i-atlas")
GROUPS = {"r": (5, 6), "g": (3, 4), "b": (1, 2)}
SIZE = 240


def load(key: str) -> list[dict]:
    items = []
    for path in sorted((config.CACHE_DIR / "bodies" / key / "meta").glob("*.json")):
        meta = json.loads(path.read_text())
        if meta["kind"] != "follow":
            continue
        with np.load(config.CACHE_DIR / meta["frame"]) as stored:
            meta["image"] = np.where(stored["mask"] == 0, stored["pixels"], np.nan)
        items.append(meta)
    items.sort(key=lambda item: (item["mjd"], item["detector"]))  # same order as scripts/build_body.py
    for item, visit in zip(items, group_visits([item["mjd"] for item in items])):
        item["visit"] = visit
    return items


def channel(frames: list[np.ndarray]) -> np.ndarray | None:
    if not frames:
        return None
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        stack = np.nanmedian(np.stack(frames), axis=0)
    values = stack[np.isfinite(stack)]
    if not values.size:
        return None
    low, high = np.percentile(values, [25, 99.8])
    unit = np.clip((np.nan_to_num(stack, nan=low) - low) / max(high - low, 1e-9), 0, None)
    return np.minimum(1, np.arcsinh(unit * 10) / np.arcsinh(10))


def build(key: str) -> dict | None:
    items = load(key)
    if not items:
        return None
    folder = DATA / key / "composites"
    folder.mkdir(parents=True, exist_ok=True)
    rows = []
    for visit in sorted({item["visit"] for item in items}):
        members = [item for item in items if item["visit"] == visit]
        channels = {name: channel([m["image"] for m in members if m["detector"] in arrays])
                    for name, arrays in GROUPS.items()}
        if any(value is None for value in channels.values()):
            rows.append({"visit": visit, "path": None, "reason_key": "composite.missing-array-group",
                         "groups_present": sorted(name for name, value in channels.items() if value is not None)})
            continue
        rgb = np.dstack([channels["r"], channels["g"], channels["b"]])[::-1]  # north up
        image = Image.fromarray((rgb * 255).astype(np.uint8), "RGB").resize((SIZE, SIZE), Image.NEAREST)
        name = f"v{visit}.webp"
        image.save(folder / name, quality=85)
        rows.append({"visit": visit, "path": f"{key}/composites/{name}", "content_type": "processed",
                     "display_only": True, "label_key": "composite.display-colours",
                     "groups": {name: list(arrays) for name, arrays in GROUPS.items()},
                     "frame": "body_centred", "epoch_ids": [f"v{visit}-d{d}" for d in sorted({m["detector"] for m in members})],
                     "t_start_mjd": round(min(m["mjd"] for m in members), 6),
                     "t_end_mjd": round(max(m["mjdEnd"] or m["mjd"] for m in members), 6),
                     "n_exposures": len(members)})
    document = {"schema_version": "tenger.composites/1", "contract_version": 10, "target_key": key,
                "note": "display colours, not for measurement", "visits": rows}
    (DATA / key / "composites.json").write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n")
    return document


if __name__ == "__main__":
    for key in KEYS:
        document = build(key)
        print(key, [(row["visit"], row["path"] or row["reason_key"]) for row in document["visits"]] if document else None)
