# TENGER implementation status

A status file is not a claim of completion. Each entry gives what ran, with what result, and what is
still open. Session A edits only "Science/data". Session B edits only "Web".

---

## Science/data (Session A)

### Current phase

**Phases C–D: real investigations. Task A3 is in progress** (see "Task A3" below: per-target table,
what was opened, what is left). A2 (science repair) is done.

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

### Task A3, 14 Nov 2026 (phases C–D, branch `tenger-dev`)

**Exposure rule applied** (recorded in `docs/EXPOSURE.md`, "Task A3 change"): all current DR1/QR3
exposures of the five challenge targets opened; Makemake and Pluto training visits only (holdout
visits closed, refused in code); 3I/ATLAS See-only.

**Pipeline** (all on native pixels; previews and viewer bundles are made from the same exposures)

| Step | Where | What it does |
|---|---|---|
| Acquisition | `scripts/acquire.py`, `scripts/acquire_body.py` | Fixed field (0.1°, cutout 0.145°) for the five targets; R Dra sampled to 300 of 2,493. Moving bodies: cutouts centred on the Horizons position of each training exposure; holdout rows raise `HoldoutViolation` before any request. 3I/ATLAS: official table rows resolved to their DR1 products by SIA (the table's QR2 datalinks no longer resolve) |
| Quality gate | `backend/investigation.py` | `L2DQAFLG` must be `Pass`; target inside the cutout; flag schema known (A2) |
| Position | `backend/astrometry.py` | Pixel-integrated Gaussian, masked pixels excluded, 1/VARIANCE weights, east/north covariance via the full WCS. Saturated core → wing fit (35″). Identification gate: within 3″ of the catalogue track and no other Gaia source within 12″ |
| Motion | `backend/astrometry.py`, `scripts/build_investigation.py` | WLS with parallax fixed to the catalogue (main, catalogue-assisted), free (exploratory) or absent (baseline). Observer = Earth (astropy ephemeris) + spacecraft header position. Uncertainty = larger of exposure-level (scaled by √χ²) and visit-level fits (`sigma_basis`) |
| Control | same | Isolated Gaia stars (G 10–15.5) measured identically; their fitted motions compared with Gaia (`control`), their residual scatter sets a per-exposure floor |
| Photometry | `backend/processing.py`, `scripts/build_investigation.py` | 12″ aperture with fractional pixel weights, ZODI and annulus median removed, VARIANCE errors. Brightness ratios only through wavelength-matched pairs, divided by the median ratio of field stars (G 10–17) on the same dates; floors from same-date repeatability and field-star scatter |
| Faint moving bodies | `backend/stacking.py` | Joint forced fit of one offset to all exposures of an epoch (native pixels, own WCS/VARIANCE/mask, robust loss); time-shuffled null test; reference = Horizons moved to the spacecraft position |
| Comparisons | `backend/investigation.py` | Every pair of epochs in the same array; brightness grade at the target, field grade over the plate, `difference` only if both quantitative |
| Outputs | `static/data/<key>/investigation.json`, `epochs/*.webp`, `meta.json`, `frames.bin.gz`, `index.json`, `reserved.json`, `strings.en.json` | Contract V3 (and V4 for brightness game rounds) |

**Results per target** (all numbers from the published files)

| Target | Exposures used | Status | Main result | Checks |
|---|---|---|---|---|
| Barnard's Star | 356 of 358 (DR1 239, QR3 119 listed) | measured | μ = 10.42 ± 0.33″/yr (parallax fixed to Gaia; visit-level σ). Gaia DR3 10.393 (z = 0.07) | 14 control stars all agree with Gaia (median Δ 0.04″/yr). Free parallax 0.95 ± 0.04″ vs Gaia 0.547″ (z = 9): exposure-level fits share visit systematics (saturated-core wing fits); flagged `limit.visit-systematics`. Brightness: saturated core in every exposure → insufficient |
| WISE 0855 | 256 of 258 (DR1) | insufficient_data | No motion: every fit near the track is outside the 3″ gate or contaminated by a Gaia G = 16.3 star 4–12″ away; photometry contaminated/flagged | Catalogue: SIMBAD (CfA mirror), Kirkpatrick et al. 2021 |
| Epsilon Indi B | pending | — | — | — |
| RW Aurigae | pending | — | — | — |
| R Draconis | pending | — | — | — |
| Makemake | 234 of 236 training rows (DR1) | measured (partial data) | Not detected in single exposures; joint fits: 1 validated epoch (v0-d2: −0.32″ E, +0.92″ N of the spacecraft-corrected ephemeris, S/N 9.3), 2 candidates (null test also finds signal), 9 below S/N 5 | Static-source check; time-shuffled null |
| Pluto | 218 of 218 training rows (DR1) | measured (partial data) | Joint fits: 9 validated epochs (visit 1 all six arrays, visit 2 arrays 1–3; S/N 11–26), offsets −0.83…+0.61″ E, −0.44…+0.50″ N; 3 candidates; first visit (10 rows) too sparse | Array-to-array scatter ~0.4″ within a visit (as for Barnard) |
| 3I/ATLAS | pending | — | — | — |

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

### Map of the inherited UI (read before B1, git `a646a75`)

Plain ES modules, no build step, served as is from `static/`.

| File | Lines | Role |
|---|---:|---|
| `index.html` | 183 | One page: header (logo, name/coordinate search with "Top places" list, demo, RU/EN toggle), landing `#hero` (title, WISE 0855 "proof" blink, five challenge cards), `#about` (results table from `results.json`, three text columns), `#observatory` (plate canvas + six detector tiles, side panel with motion result, spectrum/light-curve chart and tools, footer deck with film strip, From/To range, One/Side-by-side, band slider) |
| `js/main.js` | 1452 | Everything else: app state, plate rendering and paint cache, film strip, play loop, From/To range, compare view, follow/lock camera, Gaia/AllWISE overlays, static vs live loading (`openStatic`/`openLive` + job polling), auto spectrum + motion, URL (`target`, `ra`, `dec`, `fov`, `embed`), landing cards, results table, search list, guided demo actions |
| `js/plate.js` | 302 | Canvas renderer: stacks per band, stretch limits, mono/composite/difference painting, overlays (Gaia rings, track, expected-motion ring, pick cross, scale bar, N/E) |
| `js/stack.js` | 272 | Pure maths: channel/detector ranges, median stacking, `visitsOf`, `resolveBand` (nearest-channel fallback), tangent-plane projection, decoders |
| `js/science.js` | 337 | Browser photometry, spectrum, centroid tracking, proper-motion fit, control stars |
| `js/chart.js` | 121 | SVG spectrum and light-curve charts (molecule reference lines) |
| `js/viewport.js` | 43 | Zoom/pan maths |
| `js/api.js` | 82 | Static loader with retries (`data/…`), live API client (`LIVE_SERVER` on github.io) |
| `js/i18n.js` | 328 | English + Russian strings, default from `navigator.language` |
| `js/names.js`, `js/sky.js`, `js/tour.js` | 54/76/116 | Offline name list; Aladin Lite all-sky background; scripted demo |
| `css/style.css` | 553 | Dark glass theme, amber accent, one breakpoint at 1000 px |

Problems found for TENGER: the landing presents the legacy `results.json` motion numbers as "Tested on all
five challenge targets"; the motion box says "the motion is real"; "Sum" is a per-pixel median;
Difference subtracts the first date over a broad band with no validation; single-channel views silently
use the nearest channel per date; Russian is chosen automatically for Russian browsers; many controls
are under 44 px; there is no page/panel/A/B/band state in the URL.

### Task B1, 14 Nov 2026 (phase E: TENGER interface; base `a646a75`, worktree branch `web`)

**What changed**

| Area | Files | Result |
|---|---|---|
| Shell and navigation | `index.html`, `js/main.js`, `css/style.css` | TENGER header with Investigate (Home), Beat the physics, Learn, About. Pages are sections of one HTML file, switched by `page=` with history (Back works). Skip link, focus moves to the page heading. |
| English resource | `js/i18n.js` | One English table for every visible string (≈510 keys, including all contract enums, notes, captions, charts, panels). English is forced as default; the inherited Russian table stays in the file but is no longer offered (it does not cover the new pages). |
| Home | `js/home.js`, `js/map.js`, `js/targets.js` | Prominent RA/Dec + FOV form with a local parser (`js/coords.js`: degrees, `hms`/`dms`, colons, spaces, unicode minus); name search kept; five official shortcuts plus Makemake, Pluto and 3I/ATLAS as "Not available yet"; schematic log-distance map with the required caption, arbitrary-angle check, colour **and** shape per family (stars amber circle, variables purple diamond, Solar System cyan ring, hypothetical orange dashed ring), unplaced/clamped notes and label placement that avoids other names and dots; target list built from the same entries. The real Aladin sky is an opt-in "Pick a position on the real sky" panel that only fills the coordinate form. |
| Data loading | `js/contract.js` | Reads `data/index.json`, `<key>/investigation.json`, `trials/<id>/{trial,prediction,receipt,verification}.json`, game rounds and lessons per DATA-CONTRACT v1. Each result is `ok`, `missing`, `unsupported` (newer major), `invalid` (wrong kind, unsafe path) or `error`. `?fixtures=1` switches the base to `dev-fixtures/` and shows a page-wide "Example data, not an observation" banner. |
| Investigation | `js/main.js`, `js/panels.js`, `js/caption.js` | Panels in order See, What changed, Prediction, Evidence, Spectrum (optional), with a sticky panel bar. See keeps the inherited renderer, viewport, detector tiles, follow-camera, Gaia/AllWISE overlays and live mode, and adds Blink / Side by side / Swipe / Difference with explicit A/B observation (epoch) IDs, swap, "Only A and B". Caption strip per plate: UTC time or range, wavelength (array range, or the channel actually shown with a substitution warning), releases with counts, IRSA source link, status chip (processed / context / difference), full observation-ID list, plus an A/B warning (cross-mission, different channels, broad band). |
| Difference gate | `js/main.js` | Difference is offered only when the investigation file lists a quantitative comparison of exactly this A/B pair with `difference` allowed. No such file exists, so it is off everywhere, with the reason shown. The old first-date broad-band difference is no longer reachable. |
| Honesty fixes | `js/main.js`, `js/i18n.js` | Legacy `results.json` numbers are no longer shown (only its thumbnails are used). Motion is no longer measured automatically; the button lives in "Explore in your browser (not validated)" and the wording no longer says "the motion is real". "Sum" is called "All dates (median)". Prediction/Evidence/What changed show "not published yet" states when files are missing. |
| Reserved-sky guard | `js/reserved.js` | Live jobs are refused within 2° (plus half the field diagonal) of Barnard, WISE 0855, ε Indi B, RW Aur, R Dra and the Makemake/Pluto path boxes from `docs/EXPOSURE.md`. Prepared frames still open; a different FOV for a prepared target falls back to the prepared field with a note. |
| URLs | `js/route.js` | Old `ra`, `dec`, `fov`, `target`, `embed` links work. Added `page`, `panel`, `band` (`all`, `d1`–`d6`, `c0`–`c101`), `a`, `b`, `mode`, `v`; `id` is an alias of `target`; coordinates win over a conflicting target (note shown); bad values are dropped with a note; a data-version mismatch or a missing A/B ID is reported. "Copy share link" copies the full state. |
| Accessibility | `css/style.css`, `js/main.js` | Real buttons; 44 px minimum for every control (measured); ←/→ change date (B outside Blink), Space plays/pauses or flips the swipe; `prefers-reduced-motion` stops autoplay, blinking thumbnails and smooth scrolling; every chart has a "Show the data as a table" disclosure; token contrast checked in tests. |
| Game / Learn / About | `js/pages.js` | Beat the physics explains the reveal order and the bounded `exp_decay_v1` score and lists published rounds (none yet). Learn lists the three lessons and the Planet X Lab as "In preparation". About gives sources, methods/limits, credits (base project, IRSA, SPHEREx, WISE, Gaia, Aladin, fonts) and the AI disclosure. |
| Fixtures | `static/dev-fixtures/` | Index (8 targets + hypothetical Planet Nine), Barnard investigation, a verified example position trial (hash chain trial → prediction → receipt is real), an R Dra brightness trial with no receipt/verification, a game round and a lesson. Every file has `"example": true`; distances and numbers are invented or approximate. |

**Commands and results** (14 Nov 2026, Node v26.13.1, Chrome headless via DevTools protocol)

| Command | Result |
|---|---|
| `node --test tests/*.mjs` | **84 passed, 0 failed** (39 inherited, one of them rewritten because it endorsed nearest-channel substitution, + 45 new in `route`, `coords`, `contract`, `i18n`, `targets`, `caption`, `contrast`) |
| `.venv/bin/python -m pytest` (after rebase on `origin/tenger-dev` with A2) | 101 passed, 2 skipped (no Python file changed by B1) |
| `.venv/bin/uvicorn backend.api:app --port 8766` from this worktree | Serves the site; `data/index.json` 404 (not published yet, handled) |
| `node docs/screens/capture.mjs http://localhost:8766 docs/screens` | 10 page states × 360/390/768/1280. Measured `innerWidth` = requested width every time; `scrollWidth` = `clientWidth` (no horizontal scroll) everywhere; no control under 44 px; no script errors. Report: `docs/screens/viewport-report.json` |
| In-app browser (Claude desktop, 1024 px pane) | Keyboard (Space, ←/→), Blink/Side/Swipe, Difference refused with reason, band change, share link round trip (mode, band, A/B, panel restored), conflicting link, unknown target, version mismatch, embed mode: all as described above |
| Guard check, in-page with `/api/observe` trapped | `?target=barnard&fov=0.5`, `?ra=201&dec=21` (Makemake path), `?ra=270.5&dec=5`, `?target=rdra&ra=248.9&dec=66.0`: **0** live requests, notices shown |
| Live mode at RA 40°, Dec +60° (far from all eight targets) | Job started on the local server, QR3 frames arrived, caption showed their times and release |

Screenshots: `docs/screens/<page>-<width>.png`. They show the real app; they are not evidence of validated
science. Fixture screenshots (`home-fixtures-map`, `prediction-fixtures`) show the example banner.

**Waiting on Session A**

- `static/data/index.json`: until it exists the distance map shows its waiting text, prediction statuses read
  "No prediction published yet", and Prediction says "The prediction ledger is not published yet".
- `<key>/investigation.json` per target: needed for validated What changed values, Evidence tables, the
  Difference gate (comparisons with `difference`) and the Spectrum flag. The viewer's A/B IDs are legacy
  visit dates (`2026-08-23`, `allwise`); epoch IDs (`e1`, `e2`) from investigation files are not yet mapped to
  frames. A preview asset per epoch, or a mapping from epochs to legacy frames, is needed for that.
- Trials, receipts, verifications, game rounds and lessons: the panels render them already (checked with
  fixtures) and show "waiting"/"not checked yet" for missing parts.
- Makemake, Pluto, 3I/ATLAS: stay "Not available yet" until the index lists them with products.
- Keys used by data (`limit.*`, `explain.*`, `ident.*`, `quantity.*`, `credit.*`): unknown keys show a visible
  "(description not written yet)" text. Session A should send the list of keys it writes so the English text
  can be added.

**Limits and open points**

- Viewer frames are still the legacy prepared frames (QR2/QR3, approximate channel wavelengths, flags not
  re-validated). After rebasing on Session A's contract version 2, the nearest-channel substitution
  (`resolveBand`) was removed (V2.4): a date with no exposure in the chosen channel shows "No frames in this
  band for this date" and the caption says so. Labelling Blink/Side by side with the comparison grade (V2.4)
  needs investigation files and is not done yet. The new V2.1 frame fields (`responseStatus`, `obsKey`, …) are
  not read by the viewer yet.
- The reserved regions are a copy of `docs/EXPOSURE.md` in `js/reserved.js`; 3I/ATLAS has no region (no path
  data here). Update the list when predictions are frozen or regions change. *(B2: now read from `data/reserved.json`, A3.)*
- The guided demo (`js/tour.js`) is no longer reachable from the UI: its captions relied on the old landing
  and on the unvalidated motion number. Kept in the repository. *(Fixed in B2: rewritten and reachable again.)*
- No real-phone check yet; only emulated widths in headless Chrome and the desktop pane.
- `backend/api.py` CORS and `js/api.js` `LIVE_SERVER` are unchanged (team decision 6).

**Next action (proposed)**: phase F/G web work once Session A publishes the index and the first trial:
scoreboard page from `scoreboard.json`, the Beat the physics round player, and printable lessons.

### Task B2, 14 Nov 2026 (phase G: Beat the physics; rebased on A3 `49aa871`)

**What changed**

| Area | Files | Result |
|---|---|---|
| Scoring and checks | `js/game.js` (pure) | `exp_decay_v1` exactly as DATA-CONTRACT §11: `round(100·e^(−error/scale))`, bounded 0–100, a perfect guess scores 100, never divides by the baseline error. Non-finite or negative error, scale ≤ 0, non-finite scale or an unknown formula → score `null` and raw errors only. Raw errors in the round's `units` (position fields are arcsec; `arcmin`/`deg` rounds are converted). Ties are reported; "physics lost" only when the straight line is strictly closer. Rounds with a bad quantity, training points, reveal time or baseline/model/actual are refused with the reason shown. |
| Round player | `js/game-ui.js`, `index.html`, `css/style.css` | One round at a time with a round picker (`?page=game&round=<id>`). Training points (dates, table as well), the player taps a guess, moves it with arrow keys (Shift = 5×) or the four nudge buttons, or types offsets/values; Enter or "Lock in my guess". Reveal in order: straight-line baseline → frozen model and its 95% region (prediction covariance with `region_d2`, or ±z·σ for brightness) → real observation with its image (or "no image"). Results table: raw error with units and score for you, straight line and model, the closest highlighted, the official trial result from `verification.json`, and the score rule with the round's scale. Axes before the reveal come from the training points only, so they do not hint at the answer. Best score per round in `localStorage`, read and written inside try/catch. No backend, no leaderboard. |
| Shared labels | `js/labels.js`, `js/panels.js` | Category, status, example and "counts as prospective" chips come from one module used by the Prediction panel and the game; "counts as prospective" is shown only from a `scoreboard.json` row, never computed by the page. |
| Example rounds | `static/dev-fixtures/` | Three rounds behind `?fixtures=1`: Barnard position (retrospective; the straight line beats the model, the model region still holds), Makemake position (catalogue-assisted, arcmin), R Dra brightness (retrospective, mag). Their trials, receipts, verifications and an example scoreboard; an artificial image; a waiting RW Aur trial for the Prediction panel. All `"example": true`. Without `?fixtures=1` the game says no rounds are published and offers a link to the example rounds. |
| Demo tour | `js/tour.js`, `js/main.js` | Rewritten and reachable again ("Play the guided demo" on Home, stop button in a caption bar): Home → Barnard blink (AllWISE context vs SPHEREx, catalogue ring) → follow camera → Swipe → Side by side → R Dra through the six arrays → hand-over to Beat the physics. It shows no measured motion or brightness numbers; reduced motion skips the swipe animation and autoplay. |
| A3: reserved sky | `js/reserved.js` | Reads `data/reserved.json` (V3.3: `tenger.reserved/1`, distance to every `path` point, margin plus half the field diagonal) from real data even in fixture mode. Valid file → it is authoritative (Makemake and Pluto holdout paths, the 3I/ATLAS path; the five challenge targets are open since A3). Missing, unreadable, example or partly malformed file → the built-in list stays in force. |
| A3: strings | `js/i18n.js`, `js/main.js` | The 67 keys of `data/strings.en.json` are copied into the English resource (Session A's wording wins for its keys; my About acknowledgements moved to `ack.*`). At run time the file only fills keys that are still missing, so the site never shows a raw key. A test fails if a published key is missing from `i18n.js`. |
| A3: epochs and comparisons | `js/epochs.js`, `js/main.js`, `js/panels.js` | Epochs are one array in one visit (`v<visit>-d<array>`, `viewer.visit` = the viewer's visit). For the viewer's A/B dates and the chosen array (detector or channel), the page finds the same-array comparison: the caption shows "A and B in array D6: Quantitative" with the reason texts, the all-band view says grades are per array, and Difference is enabled only when that comparison lists `difference`. Evidence shows how many epochs belong to dates in the viewer and the reasons per comparison. |
| A3: index fields | `js/targets.js`, `js/home.js` | `status_reason_key` explains "Not available yet" on cards, the list and the investigation page; index `thumbnails` (with paths under `data/`) replace the legacy blink pair when present. |

**Commands and results**

| Command | Result |
|---|---|
| `node --test tests/*.mjs` | **104 passed, 0 failed** (adds `tests/game.test.mjs`: score bounds, zero/negative/non-finite inputs, perfect baseline, units, ties, invalid rounds, answer-free axes, storage failures; `tests/epochs.test.mjs`: per-array comparisons, the real `reserved.json`, malformed reserved files; strings coverage in `tests/i18n.test.mjs`) |
| `node docs/screens/capture.mjs http://localhost:8766 docs/screens` | 13 page states incl. `game`, `game-example`, `game-example-revealed`, `game-rdra-revealed` at 360/390/768/1280: measured viewport = requested, no horizontal scroll, no control under 44 px, no script errors (see `viewport-report.json`) |
| In-app browser | Played all three example rounds (tap, Enter, arrow keys, typed values); reveal order and results as above; the Barnard example reports "physics lost"; the tour ran Home → Barnard → follow → swipe and stopped on request; fixture Barnard with D6 enables Difference, D1 and all-band do not |

**Waiting on Session A**

- `static/data/index.json`, real `game/<round>.json`, trials, verifications and `scoreboard.json` (expected
  Sunday morning). The game, Prediction panel and target statuses read them as soon as they exist; nothing
  else needs to change. Real investigation files will switch each target from "not published" to real
  evidence one by one; the viewer keeps the bundled frames, which A3 rebuilds per V3.5.
- The contract has no scalar shape for game rounds yet. The page reads brightness rounds as
  `training_points[{t_mjd, value}]`, `baseline/model/actual {value}` (model may carry `sigma`), `units`
  `"mag"` (brighter up) or a flux unit, and `actual.image` as a path under `data/` or
  `{path, content_type}`. Please confirm or append the shape in the contract.
- The epoch preview images (`epochs[].assets.preview`) are not shown yet; the viewer uses the bundle frames.

**Limits**

- The game is an educational demonstration, not a blind study of players: the round data are in the page.
- Region drawing needs the prediction covariance (position) or `sigma` and `z_max` (brightness); without them
  the page says the region is unavailable.
- Not checked on a real phone; emulated widths and the desktop pane only.

**Next action (proposed)**: when Session A publishes the real rounds, play each one at 360 and 1280 px and
re-capture `docs/screens/`; then the scoreboard page and printable lessons (phase G/H).

### B2 follow-up, 14 Nov 2026 (after Session A's `1c6715a`: first real investigation, index, reserved, strings)

Requested by Session A:

- **Paths with spaces**: `tests/contract.test.mjs` and `tests/i18n.test.mjs` built folder paths from
  `URL.pathname`, which keeps `%20` and failed with ENOENT in `/Users/…/Hackathon Astrolemma`. Both now use
  `fileURLToPath`. Checked by copying `static/` and `tests/` into a scratch folder whose path has a space:
  105/105 pass there.
- **New data keys** (`limit.blended-binary`, `limit.few-visits-parallax`, `limit.visit-systematics`,
  `quantity.parallax_arcsec`): the copied block in `js/i18n.js` is regenerated from `strings.en.json`
  (71 keys). The test keeps failing on any key Session A adds later until it is copied; at run time the page
  fills such keys from the file, so users never see a raw key.

Real data now on the site (`data/index.json`, `data/barnard/investigation.json`, rebuilt Barnard bundle):

- Home: the map draws 7 targets at Session A's cited distances (Gaia DR3 / SIMBAD parallaxes, JPL Horizons);
  3I/ATLAS has no distance and is listed as unplaced. Prediction statuses read "No prediction published yet".
- Barnard: chip "Frames from the investigation (quality-gated DR1/QR3)" because the evidence file has
  `legacy: null` and the bundle carries `dataset_version` (V3.1/V3.5); A/B dates are the file's
  `viewer.visits` (2025-08-29, 2026-03-20, 2026-08-22). What changed shows Session A's explanations, the
  SPHEREx proper motion next to the Gaia catalogue value (content chips "Measured" / "Catalogue"), the values
  that could not be measured folded away with their reasons, and the limitations once. Evidence covers all
  18 epochs. No comparison allows a difference image, so Difference stays off with its reason.
- WISE 0855, ε Indi B, RW Aur, R Dra: the index says `unavailable` (`unavailable.no-validated-product`).
  Their bundled frames stay viewable so the five-target viewer is kept (CLAUDE.md), labelled
  "Legacy frames only; no validated product yet" and "Prepared frames (legacy, not yet re-validated)". If
  the team prefers to hide them until validated, it is one line in `isViewable` (`js/targets.js`).
- `node --test tests/*.mjs`: **105 passed** (adds a test that all five challenge targets stay viewable with the
  real index while unvalidated ones are marked legacy-only). Screenshots regenerated (see below).

### Task R1, 14 Nov 2026 (visual redesign; rebased on Session A's `915c551`)

Goal: TENGER looks like its own product, clearly different from SPHEREx Blink, without changing features,
URL parameters, contract readers, the reserved-sky guard, accessibility or tests. Mood reference only: a
"mission console" (NASA Eyes was not copied: no code, images or logos).

| Page | Commit | What changed |
|---|---|---|
| Design system, Home | `style(web): R1 Home as a map console…` | Tokens at the top of `style.css` (background `#05070d`, glass panels `#0a0f1a` at 85% with backdrop blur and `#1e2738` border, text `#e6edf7`, muted `#8d9bb0`, accent `#5cc8ff`, stars `#ffe08a`, variables `#c9a0ff`, Solar System `#5cc8ff`, Planet Nine `#ffa94d`, hit `#5fd38d`, miss `#ffb547`, waiting `#8d9bb0`), 8 px grid, 12 px radius, one shadow. Self-hosted Space Grotesk / Inter / JetBrains Mono (`static/fonts/`, OFL texts and README; the Google Fonts request is gone). Slim top bar with an orbit mark (phone: Menu). Home is a full-screen map console: starfield, glowing Sun and markers, the "Schematic: not a sky map" note, colour key, floating search card (one box for a name or RA/Dec, FOV, Top places, Real sky, Guided demo, the five challenge shortcuts) and a collapsible Targets rail grouped by type, a bottom sheet on phones. Notices are dismissible toasts. |
| Investigate | `style(web): R1 Investigate as a glass panel…` | A 420 px glass panel slides in over the map (200 ms; a full-screen sheet on phones) with sticky section tabs and titles. The viewer moved to a stage with a bottom time bar: epoch ticks with dates and small previews, play/pause, A and B markers, and the Blink / Swipe / Side by side / Difference control. Caption strip, A/B pickers, wavelength (bands, six arrays) and more controls are in See. Escape closes the panel. New preview mode for evidence files with epoch previews but no frame bundle (Makemake): A/B on the preview images, captions from the epoch records, comparison grade of the pair. |
| Beat the physics | `style(web): R1 Beat the physics…` | Page header, round tabs, glass round panel; plot colours from the design system (you: accent ring; baseline: grey square; model: yellow diamond and region; real observation: green cross). DATA-CONTRACT V4: brightness units `mag_ab`, `ujy`, `ratio`; magnitudes are drawn brighter-up. |
| Learn, About | `style(web): R1 Learn and About` | Numbered lesson cards, the Planet X Lab card in Planet Nine orange; About as cards with a Fonts section (names, designers, links to the three OFL texts). |

Removed from the old look: the "What moved?"-style hero, amber pill buttons, Unbounded/Commissioner fonts,
the old header, landing cards and the full-page AllWISE background behind Home (the Aladin sky is now an
opt-in "Real sky" panel).

**Checks**

| Check | Result |
|---|---|
| `node --test tests/*.mjs` | **106 passed** (contrast test now checks the R1 tokens: text, muted, accent, category and verdict colours ≥ 4.5:1 on background, panel and raised surfaces; dark text on accent ≥ 4.5:1) |
| `docs/screens/capture.mjs`, all pages at 360/390/768/1280 (+1440 for the redesign shots) | Measured viewport = requested; no horizontal scroll; no control under 44 px; no script errors except the expected 404s for files not published yet. Two bugs found on the way and fixed: a `filter` on the dimmed Home made it the containing block for its fixed starfield and sheet (16 px overflow on phones); map labels could stick out of the map on direct investigation links |
| In-app browser | Search (name, coordinates with FOV, invalid numbers), Real sky panel (Aladin loads), rail toggle, chips, open/close the panel, Escape, Space and ←/→ on the plate, swipe, tour start/stop; `/api/observe` trapped during a reserved-path search: 0 requests |

Screenshots: `docs/screens/*.png` (all pages, four widths) and `docs/screens/redesign/` (before and after at 390
and 1440 px, see its README).

**Also in this task**: re-copied `strings.en.json` (85 keys after rebasing on Session A's WISE 0855 commit
`f07081a`); contract V4 brightness units in the game. WISE 0855 now opens with its own evidence file
(available; motion insufficient because a neighbour contaminates it), checked at 390 and 1280 px. Pluto (Session A `7b23199`, partial with previews) opens in preview mode like Makemake; 3I/ATLAS keeps the unavailable state.

**Limits**: not checked on a real phone. The time bar shows evenly spaced epoch ticks (with dates) rather than a
proportional time axis, so uneven gaps between visits are read from the labels. Preview mode shows previews
only (no zoom, spectrum or motion quick look), as the evidence file provides no frames for Makemake.

### Follow-up to Session A's `496d2af` (all five challenge targets rebuilt), 14 Nov 2026

- Rebased; `strings.en.json` re-copied (88 keys). All five challenge targets are `available` with `legacy: null`
  and rebuilt bundles, so the "legacy frames only" label no longer appears (it was derived from the index, no
  code change needed). Their frames are labelled "Frames from the investigation (quality-gated DR1/QR3)".
- **Difference images** are now possible where Session A allows them (Epsilon Indi B 6 pairs, WISE 0855 4,
  RW Aur 1, Barnard 0). The page enables Difference only for the A/B dates of a comparison whose `modes`
  include `difference`, and only with that comparison's single detector array selected (not a channel and not
  the all-band composite). The caption and the difference status line list every check the comparison left
  open, e.g. "Not checked: background." When a quantitative comparison covers the pair, the generic
  "different wavelengths within this range" warning is no longer shown next to it.
- **Brightness ratios** in What changed show the field-star-calibrated value ± sigma and, under it, the raw
  ratio with its statistical error and the field-star control (number of stars, median ratio, scatter).
- Checked in the browser: Epsilon Indi B, D1, A 2025-05-10 / B 2026-04-25 → Difference on, caption "Not
  checked: background"; D5 (registration unverified) and all bands → Difference off.
- `node --test tests/*.mjs`: **107 passed** (new test reads the real Epsilon Indi B file: D1 allows a
  difference image with background `not_checked`, D5 does not, every allowed pair has PSF and registration
  `pass`).

### Task B3, 14 Nov 2026 (phase G: lessons and the Planet X Lab)

| Part | Files | Result |
|---|---|---|
| Lesson maths | `js/lessons.js` (pure) | Small-angle distance d[pc] = b[au]/θ[″] and the shift of a fixed body; Δm = 2.5 log₁₀(F₁/F₂); reflected dimming 1/r⁴ (10 log₁₀ of the distance ratio); H from diameter and albedo; V = H + 5 log₁₀(rΔ) at zero phase; Gaussian tail (erfc, error < 1.2e-7), 2D inside-probability 1 − e^(−k²/2), the 95% radius √(−2 ln 0.05) = 2.4477, false alarms E = N·P(Z > k), all-inside 0.95ᴺ; the Lab model (H, V near opposition with Δ = r − 1 au, apparent diameter, yearly parallax for a body at rest, circular-orbit drift with P² = a³, light time). |
| Lessons | `js/learn-ui.js`, `index.html`, `css/style.css` | Learn shows three lesson cards and the Lab; `?page=learn&lesson=distance|brightness|sure|lab` opens one. Each lesson: the idea, the formula in MathML (native browser rendering, no library to vendor) with the same formula in words, its assumptions, a worked example, three exercises with answers behind toggles, a teacher note, a link to the source investigation (Makemake for 1 and 2, Barnard's prediction panel for 3). Lesson 1 says a parallax-only distance for Makemake or Pluto is a model illustration because they move along their orbits. Lesson 2 says V cannot be compared with SPHEREx near-infrared AB depth and decides no detectability; no AB 18.4 anywhere. Lesson 3 explains 2.45 versus 2, false alarms with the independence caveat, and shows the scoreboard's checked trials, hits, misses, other outcomes and open forecasts per trial type straight from `scoreboard.json` (no rate computed; "no checked trials published yet" today). |
| Records | `js/lessons.js` `readLessonRecord` | Until Session A publishes lesson records (task A5), every lesson uses synthetic practice values computed by the tested functions and labelled "Synthetic practice values … not observations". A record with lesson_id `distance`, `brightness` or `how-sure` (aliases accepted) replaces the worked example and exercises automatically; inputs show their content type, `synthetic` flag, and a warning if a non-synthetic input has no `source_ref`; prompts come from `prompt_key` with `{input}` placeholders. Example records are labelled. |
| Planet X Lab | `js/learn-ui.js` | Sliders for distance (200–1200 au), diameter (5,000–60,000 km) and albedo (0.05–0.8). Results: V, H, apparent diameter, yearly parallax, orbital drift and period, light time, each with its assumption written beside it. Planet Nine is labelled hypothetical and not observed. "Could SPHEREx see it?" answers that this visible-band model cannot decide it (no same-band model adopted). |
| Print | `css/style.css` | Printing from Learn gives a plain white worksheet (no navigation or backgrounds), formulas in black, writing space under each exercise, links printed as text, and the answers on a separate last page. Checked with headless Chrome PDF export: lesson 2 and lesson 3 print as four A4 pages with the answer key alone on page 4. |

**Checks**: `node --test tests/*.mjs` **115 passed** (adds `tests/lessons.test.mjs`: every formula against known values, the synthetic answers, record reading and the unsourced-input flag, scoreboard counts without rates, Lab monotonicity checks such as double albedo = 0.75 mag brighter). The i18n tests confirm every key used by `learn-ui.js` exists in the English resource (prompts, answers, MathML and assumptions all live there). Learn, a lesson, lesson 3 with the example scoreboard and the Lab: no horizontal scroll and no control under 44 px at 360/390/768/1280.

**Waiting on Session A**: lesson records (A5). Lesson ids expected: `distance`, `brightness`, `how-sure`; prompt and teacher texts in `strings.en.json`; numbers with `synthetic` and `source_ref` as in contract §12.
