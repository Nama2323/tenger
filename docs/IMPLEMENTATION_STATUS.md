# TENGER implementation status

A status file is not a claim of completion. Each entry gives what ran, with what result, and what is
still open. Session A edits only "Science/data". Session B edits only "Web".

---

## Science/data (Session A)

### Current phase

**Phase A: reconcile local state. Task A1 is done** (baseline, exposure inventory, data contract).
Application behaviour has not changed. Next is phase B (science/data repair), starting with Task A2.

### Task A1, 14 Nov 2026 (git base `58f993b`, branch `tenger-dev`)

**Environment**

- Python 3.12.14 (`/opt/homebrew/bin/python3.12`) in `.venv`. `requirements.txt` installed unpinned.
  Resolved versions: astropy 8.0.2, numpy 2.5.4, scipy 1.18.1, fastapi 0.162.7, uvicorn 0.54.0,
  httpx 0.28.1, pillow 13.0.0, pytest 9.2.0. No lock file exists yet.
- Node.js was not installed on this Mac. Installed `node` v26.13.1 with Homebrew to run the JS tests.

**Baseline (before any change)**

| Command | Result |
|---|---|
| `.venv/bin/python -m pytest` | **54 passed** (11.7 s) |
| `node --test tests/*.mjs` | **39 passed, 0 failed** |
| `.venv/bin/uvicorn backend.api:app --host 0.0.0.0 --port 8765` | Started. `GET /` 200 |
| Browser, `http://localhost:8765/?target=<key>` for barnard, wise0855, epsindib, rwaur, rdra | All five open from bundled data. `meta.json`, `frames.bin.gz`, thumbnails 200. Name, motion box and date strip render |
| Browser console | Non-fatal: `data/sky/Moc.fits` 404. Aladin Lite 3.8.2 logs `ERR_NAME_NOT_RESOLVED` / `Failed to fetch` from an external call inside `createSky` (`static/js/sky.js:36`). The sky tiles still load |
| `/api/resolve?q=Vega` | 200 in 15.8 s: the CDS Sesame call times out (12 s), then the CfA mirror answers |

After A1 changes: **59 passed** (54 + 5 new in `tests/test_exposure_inventory.py`). JS: 39 passed.

**Network from this Mac (14 Nov 2026, about 11:20 UTC)**

| Service | Probe | Result | Blocks if down |
|---|---|---|---|
| IRSA SIA v2 | `SIA?COLLECTION=spherex_dr1&POS=…&RESPONSEFORMAT=CSV` | 200, 1.2 s | Archive discovery, live mode, bake |
| IRSA SIA self-description | `MAXREC=0` | 200. Collections: `spherex_dr1`, `spherex_dr1_cube`, `spherex_dr1_deep`, `spherex_qr3`, `spherex_qr3_deep` (QR2 no longer listed) | Release discovery |
| IRSA TAP | `TAP_SCHEMA.tables` for schema `spherex` | 200, 0.8 s (`spherex.obscore`, `observation`, `plane`, …) | Metadata joins, Gaia overlay (`gaia_dr3_source` 200, 9 s) |
| IRSA cutouts | DR1 `2025W33_2C_0321_1` D6, Barnard, 0.02° (an already-exposed frame) | 200, 3.95 MB `application/fits`, `SIMPLE = T`, 18 s. Only the header card was checked | Live frames, bake, every new measurement |
| IRSA AllWISE IBE / HiPS | `p3am_cdd` search, HiPS `properties` | 200 / 200 | WISE context, sky map |
| JPL Horizons API | Pluto, 2026-11-14 to 15, geocentric | 200, 1.0 s | Makemake/Pluto ephemerides, Solar System checks |
| SIMBAD (CDS, Strasbourg) | `sim-tap/sync` and `sim-id` | **404 "This page is currently unavailable"** | — |
| SIMBAD (CfA mirror) | `simbad.cfa.harvard.edu/simbad/sim-tap/sync` | 200, 1.8 s | Use instead of CDS while CDS is down |
| VizieR (CDS) | `vizier.cds.unistra.fr/viz-bin/asu-tsv` | **404**. TAPVizieR timed out (60 s) | `config.VIZIER_URL` points here (not referenced by any current code path) |
| VizieR (CfA mirror) | `vizier.cfa.harvard.edu/viz-bin/asu-tsv` | 200, 2.1 s | Use for VSX/AllWISE catalogue lookups |
| Sesame (CDS / CfA) | name lookup | CDS: timeout, 60 s. CfA: 200, 1.0 s | Name search (falls back to CfA, slow) |
| 3I/ATLAS page and table | `comet3iatlas/index.html`, `obscore_3I_Atlas.vot` | 200 / 200 (259 rows) | Comet See view |

**Exposure inventory** (`docs/EXPOSURE.md`, `docs/exposure/*.json`, generator
`scripts/exposure_inventory.py`, metadata only)

- Exposed = every obs_id in any committed `meta.json` (2–7 versions per target), the 1,241 processed
  `.npz` frames (all also bundled at some point) and the audit's one DR1 cutout.
- For all five challenge targets, the newest DR1/QR3 observation in the archive is already exposed.
  The 9 Nov bake took everything released then. Never-opened exposures exist only inside visits that
  also contain exposed frames. So no `prospective_unexposed` trial is possible for a challenge
  target with current data. `retrospective_holdout` is possible.
- Makemake (184 obs_ids, 4 visits) and Pluto (120 obs_ids, 5 visits) have no exposed pixels. Each
  can support a prospective trial if the team confirms nobody opened them. If the model uses an
  orbit or ephemeris prior, the trial is `catalogue_assisted`. Detection itself is unvalidated.
- 3I/ATLAS: 259 table rows, 133 obs_ids (Aug and Dec 2025). See-only.

**Data contract**: `docs/DATA-CONTRACT.md` version 1 covers the site index, investigation, trial,
prediction, receipt, verification, scoreboard, game round and lesson. Enums, paths, one example each
(all JSON examples parse; all carry `"example": true`).

**Files added in A1**: `docs/EXPOSURE.md`, `docs/exposure/{summary,barnard,wise0855,epsindib,rwaur,rdra,makemake,pluto,3i_atlas}.json`,
`docs/exposure/SHA256SUMS`, `docs/DATA-CONTRACT.md`, `docs/IMPLEMENTATION_STATUS.md`,
`scripts/exposure_inventory.py`, `tests/test_exposure_inventory.py`. No application file changed.

### Findings confirmed against the earlier audit (current code, not yet fixed)

- `backend/archive.py` discovers only `spherex_qr\d+` collections. `data/collections.json` lists QR2/QR3 only.
  DR1 is never fetched, and QR2 is no longer listed by IRSA. WISE 0855's bundled frames are all QR2.
- The bundled `meta.json` frames still carry approximate `channel`/`wavelength` values and no
  VARIANCE or flag-definition provenance (audit §4). Not re-tested here.
- Bake and live jobs sample at most 150 exposures per target. The search cache has a 24 h TTL.

### Open limits

- Exposure of Makemake/Pluto through tools outside this repo (public Render live mode, IRSA Viewer)
  cannot be ruled out from files. A team statement is needed before any `prospective_unexposed` label.
- CDS Strasbourg SIMBAD/VizieR outage: catalogue work should use the CfA mirrors until it recovers.
- Dependencies are unpinned. The resolved versions are listed above.
- Docker build, rebake, deployment and real-phone checks: not run (not in A1 scope).

### Next action (proposed)

Task A2, phase B: release-aware discovery (DR1 + QR3, wide and deep), `obs_id`-based dedupe and
versioned cache keys, MSKN/MSKM flag decoding with fail-closed unknown schemas, VARIANCE kept, and
no nearest-channel fallback in the science path. In parallel, draft the Makemake/Pluto trial
manifests. Training visits may be opened only after the trial manifest is committed.

---

## Web (Session B)

*Session B fills this section.*
