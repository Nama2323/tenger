"""Tunable constants, overridable through the environment."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = Path(os.environ.get("BLINK_CACHE", ROOT / "cache"))
STATIC_DIR = ROOT / "static"

IRSA_SIA_URL = "https://irsa.ipac.caltech.edu/SIA"
SESAME_URLS = (
    "https://cds.unistra.fr/cgi-bin/nph-sesame/-oI/A",
    "https://vizier.cfa.harvard.edu/viz-bin/nph-sesame/-oI/A",
    "http://vizier.cfa.harvard.edu/viz-bin/nph-sesame/-oI/A",
)
# Catalogue services: CDS Strasbourg first, the CfA mirror as automatic fallback
# (CDS SIMBAD/VizieR were down on 14 Nov 2026). See backend/catalogs.py.
SIMBAD_TAP_URLS = (
    "https://simbad.cds.unistra.fr/simbad/sim-tap/sync",
    "https://simbad.cfa.harvard.edu/simbad/sim-tap/sync",
)
VIZIER_URLS = (
    "https://vizier.cds.unistra.fr/viz-bin/asu-tsv",
    "https://vizier.cfa.harvard.edu/viz-bin/asu-tsv",
)
VIZIER_URL = VIZIER_URLS[0]  # earlier single-URL name

# Used only if the archive's self-description cannot be read (listed by IRSA, 14 Nov 2026).
FALLBACK_COLLECTIONS = ("spherex_dr1", "spherex_dr1_deep", "spherex_qr3", "spherex_qr3_deep")
# Which product wins when one exposure exists in several releases: earlier kinds first.
RELEASE_PRIORITY = tuple(
    item.strip() for item in os.environ.get("BLINK_RELEASE_PRIORITY", "dr,qr").split(",") if item.strip()
)
# Optional comma-separated allow-list of collections, e.g. "spherex_dr1,spherex_qr3".
ONLY_COLLECTIONS = tuple(
    item.strip() for item in os.environ.get("BLINK_COLLECTIONS", "").split(",") if item.strip()
)

# Versions that enter every processed-frame cache key. Bump PIPELINE_VERSION whenever
# processing changes what a cached frame contains.
PIPELINE_VERSION = "tenger-a2-2026.11.14"
FRAME_SCHEMA = 2
# Keep each cutout (minus its PSF table) at native resolution next to the display frame.
KEEP_NATIVE_PRODUCTS = os.environ.get("BLINK_KEEP_NATIVE", "1") != "0"

DOWNLOAD_WORKERS = int(os.environ.get("BLINK_WORKERS", 6))
MAX_EXPOSURES = int(os.environ.get("BLINK_MAX_EXPOSURES", 150))
MAX_JOBS_IN_MEMORY = int(os.environ.get("BLINK_MAX_JOBS", 4))
SEARCH_TTL_SECONDS = 24 * 3600
HTTP_TIMEOUT_SECONDS = 180
CUTOUT_RETRIES = 8

# A square cutout is rotated relative to the north-up plate, so request more
# than the field of view to keep the corners filled.
CUTOUT_MARGIN = 1.45
MIN_FOV_DEG = 0.02
MAX_FOV_DEG = 0.5
