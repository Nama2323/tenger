# TENGER implementation status

A status file is not a claim of completion. Each entry gives what ran, with what result, and what is
still open. Session A edits only "Science/data". Session B edits only "Web".

---

## Science/data (Session A)

### Current phase

**Phase B: science repair. Task A2 is done for the backend** (releases, flags, native products,
spectral grading, tests). The bundled viewer data and the browser-side band choice are unchanged.
See "Task A2" below for what is left.

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

### Task A2, 14 Nov 2026 (phase B, git base `a646a75`, branch `tenger-dev`)

**What changed (commits `79f30c3`, `763237b`, `eebea63`, `dbe4664`, this docs commit)**

| Area | Files | Change |
|---|---|---|
| Releases | `backend/archive.py`, `backend/config.py` | Discovery reads the SIA self-description with no collection and accepts `spherex_(dr\|qr)N[_deep]`. `spherex_dr1_cube` is excluded (a different product). Fallback list is DR1, DR1-deep, QR3, QR3-deep. Each `Exposure` keeps collection, product version (`l2b-v27-2026-228`), `t_max`, release date and publisher DID. `obs_key` = `<collection>:<obs_id>:D<n>`. `select_products` keeps one product per (obs_id, detector): data release over quick release (`BLINK_RELEASE_PRIORITY`, default `dr,qr`), then release number, then product version. Optional `BLINK_COLLECTIONS` allow-list. |
| Cache keys | `backend/framestore.py`, `backend/jobs.py` | Frame path `frames/<job>/<tag>/<key>.npz`. The tag hashes pipeline version (`tenger-a2-2026.11.14`), frame schema 2, mask policy and grid. The key holds collection, obs_id, detector and product version. A stored frame whose `cache.tag` differs is rebuilt. Old QR-only caches (`data/frames/<job>/<key>.npz`, `data/search/*.json`, `data/collections.json`) are never read. They were not deleted. Search cache moved to `search/v2/`, collections to `collections-v2.json`. |
| Flags | `backend/flags.py` (new), `backend/processing.py` | Decodes current `MSKNnnnn`/`MSKMnnnn`/`MSKDnnnn` and historical `HIERARCH MP_<NAME> = bit`. Each flag keeps bit, name, description, action and reason. No schema, `MSKM != 1<<n`, a bit outside 0–31, two names on one bit, or MSKN/MP_ disagreement → `UnknownFlagSchema` and the exposure is refused (counted in the job summary `rejected`). Policy `tenger-mask-v1`: keep `SOURCE`, `FULLSAMPLE`; reject every other named flag, unknown names and undefined bits. Stricter than before: `DICHROIC` and `PHANMISS` are now rejected. |
| Native data | `backend/processing.py`, `backend/jobs.py` | `NativeProduct` keeps IMAGE, VARIANCE, FLAGS, ZODI, celestial WCS and WCS-WAVE at original resolution and dtype. `native_aperture_photometry` works on these pixels: ZODI and annulus median removed, error from VARIANCE (aperture sum plus the annulus-median term), pixel solid angle from the WCS. Any rejected pixel in the aperture gives `insufficient_data` with per-flag counts. The 160-px plate (`display_native` + `reproject`) is display only. Jobs keep each cutout minus its PSF table under `native/` (`BLINK_KEEP_NATIVE=0` turns it off) and record the SHA-256 and size of the bytes received. |
| Spectral matching | `backend/spectral.py` (new), `backend/jobs.py` | `grade_pair` gives `quantitative` / `qualitative` / `invalid` with a reason key. Tolerance: same array and centres within 10% of the narrower bandwidth (floor 1 nm, the IRSA-quoted WCS-WAVE accuracy). This is a TENGER choice, not an official criterion. `grade_field` checks the plate corners separately, so a match at the star does not validate a difference image. `match_epochs` pairs exposures explicitly, each used once. The job no longer silently uses the array midpoint when WCS-WAVE fails: it records `responseStatus: "unknown"` and `response: null`, and the midpoint is used only to place the frame on the band slider. |
| Catalogues | `backend/catalogs.py` (new), `backend/config.py` | SIMBAD TAP and VizieR ASU try CDS first, then the CfA mirror. `configure_astroquery()` points astroquery at the first reachable host if astroquery is installed (it is not a dependency). Sesame already had the CfA fallback. |
| Contract | `docs/DATA-CONTRACT.md` | Version 2 appended (additive): new frame metadata fields, mask policy, reason keys, viewer rule for time comparisons. |

**Verification against real files** (all already-exposed Barnard-field exposures, `center=269.44648,4.76867&size=0.02`)

| Product | Software | FLAGS schema | Rejected pixels (new / old decoder) |
|---|---|---|---|
| DR1 `2025W33_2C_0321_1` D6, `l2b-v27-2026-228` | 7.0.5 | `MSKN/MSKM/MSKD`, 22 planes incl. CROSSTALK, GHOST*, STREAK, BLOOM, SNOWBALL, HALO | **17 / 144** (old: 0) |
| QR3 `2026W33_2A_0594_4` D6, `l2b-v27-2026-241` | 7.0.5 | `MSKN/MSKM/MSKD` (same 22) | 9 / 144 (header check only, file not kept) |
| QR2 `2025W33_2C_0321_1` D6, `l2b-v20-2025-266` | 6.4+psffix1 | `MP_*` (16 keys, incl. PHANTOM, REFERENCE) | 14 / 144 (old: 14) |

Extensions: DR1/QR3 `IMAGE, FLAGS, VARIANCE, ZODI, EPSF, WCS-WAVE`; QR2 has `PSF` in place of `EPSF`.
This matches the IRSA SPHEREx data-products page. The IRSA tutorial confirms that flag names travel as
`MSKNnnnn` with `MSKDnnnn` descriptions in the FLAGS header. Neither IRSA page says which flags to
mask, so `tenger-mask-v1` is our own documented choice. WCS-WAVE at Barnard's position (D6): centre
4.929 µm, bandwidth 0.037 µm. IRSA says WCS-WAVE is for visualization (about 1 nm accuracy) and the
separate Spectral WCS product (CWAVE/CBAND) is the science reference. We do not read that product yet.

On the DR1 cutout, Barnard's Star itself falls on OVERFLOW/BLOOM/TRANSIENT pixels in D6. Native
photometry therefore returns `insufficient_data`, not a flux.

**Tests**

| Command | Result |
|---|---|
| `.venv/bin/python -m pytest` | **101 passed, 2 skipped** (the 2 network tests). Baseline was 59 |
| `.venv/bin/python -m pytest --network tests/test_network.py` | **2 passed**: IRSA lists `spherex_dr1` and `spherex_qr3` and no cube; SIMBAD answered from the CfA mirror (CDS TAP returned 404 at 20:12 UB) |
| `node --test tests/*.mjs` | **39 passed, 0 failed** (unchanged) |
| Server `.venv/bin/uvicorn backend.api:app --port 8765`, browser `?target=` barnard, wise0855, epsindib, rwaur, rdra | All five open from bundled data, plate dates and frame counts shown, **0 `/api/` requests** (no live job started near a target) |

Updated tests that endorsed the old behaviour: `test_archive.py` (self-description now includes DR1
and excludes cubes; DR beats QR; cache key carries release and product version), `test_framestore.py`
(versioned tag, old unversioned files ignored). New: `test_flags.py`, `test_native_product.py` (real
DR1 and QR2 fixtures), `test_spectral.py`, `test_jobs_pipeline.py` (offline pipeline on the DR1
fixture), `test_catalogs.py` (mirror fallback with a mock transport), `test_network.py` (marked
`network`), `tests/conftest.py` (`--network` or `TENGER_NETWORK=1`).

Fixtures (`tests/fixtures/`, see its README): DR1 11 kB and QR2 9 kB gzip copies of the cutouts above
with the PSF table removed, plus two SIA metadata rows. Original SHA-256 values are recorded in the
README and in each file's `TGRSRC` card.

**Exposure accounting.** Pixels opened this task: DR1 and QR2 products of `2025W33_2C_0321_1` D6
and the QR3 product of `2026W33_2A_0594_4` D6. Both obs_ids were already in the exposed set (bundled
frames and the earlier audit), so the exposed set does not change. No Makemake, Pluto or never-opened
challenge-target observation was requested. SIA metadata was read for the Barnard position and a
neutral position (0, 0). Bake and live jobs were not run.

### Still open after A2

- **Browser-side band choice (Session B).** `resolveBand` in `static/js/stack.js` still swaps in the
  nearest channel that has data, per date step, in blink mode. Difference mode compares whole-array
  stacks whose wavelengths differ across the plate. Contract V2.4 states the rule. The backend
  grades exist, but nothing sends them to the browser yet: the investigation manifest (phase C) is
  meant to carry them.
- **Bundled data is legacy.** `static/data/*/meta.json` and `frames.bin.gz` were built by the old
  pipeline: QR2/QR3 only, MP_ mask (DR1 masks were never applied), no VARIANCE or response width.
  The same holds for `static/data/results.json` and `scripts/results.mjs` (`wingBrightness` compares
  brightness across dates within one array without response matching). Rebuilding needs a bake,
  which `docs/EXPOSURE.md` forbids until the trial manifests are frozen. Bake/build_site were not
  run or re-tested with the new metadata.
- **Science WCS.** Responses come from WCS-WAVE (about 1 nm). The CWAVE/CBAND Spectral WCS product
  is not read. Measurements do not yet use the EPSF (PSF photometry, PSF-matching checks) or
  registration checks. `grade_field` assumes a linear wavelength gradient across the plate.
- **Tolerance.** The 10%-of-bandwidth match is adopted, not validated. No flux-error budget for a
  given shift has been derived.
- **Native photometry** uses whole pixels (no fractional apertures), and a median background with
  a Gaussian π/2 variance factor. VARIANCE covariance between neighbouring pixels is ignored.
- `astroquery` is not installed. Only the httpx helpers are exercised.

### Open limits (from A1, still true)

- Exposure of Makemake/Pluto through tools outside this repo (public Render live mode, IRSA Viewer)
  cannot be ruled out from files. A team statement is needed before any `prospective_unexposed` label.
- CDS Strasbourg SIMBAD/VizieR outage: the code now falls back to CfA automatically.
- Dependencies are unpinned (versions in A1 above).
- Docker build, rebake, deployment and real-phone checks: not run.

### Next action (proposed)

Phase C: first real investigation. Write `scripts/build_investigation.py` that emits
`static/data/<key>/investigation.json` (contract V1 §5) from bundled legacy metadata, marked
`legacy`, with comparison grades computed from recorded responses where they exist and `invalid` /
`response-unknown` where they do not. In parallel, draft the Makemake/Pluto trial manifests
(`trial.json`) so their training visits can be opened under the new pipeline.

---

## Web (Session B)

*Session B fills this section.*
