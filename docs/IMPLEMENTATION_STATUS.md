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
| `node --test tests/*.mjs` | **84 passed, 0 failed** (39 inherited + 45 new in `route`, `coords`, `contract`, `i18n`, `targets`, `caption`, `contrast`) |
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
  re-validated). Single-channel views still use the nearest channel per date for display; the caption names
  the channel shown and warns when it differs between A and B.
- The reserved regions are a copy of `docs/EXPOSURE.md` in `js/reserved.js`; 3I/ATLAS has no region (no path
  data here). Update the list when predictions are frozen or regions change.
- The guided demo (`js/tour.js`) is no longer reachable from the UI: its captions relied on the old landing
  and on the unvalidated motion number. Kept in the repository.
- No real-phone check yet; only emulated widths in headless Chrome and the desktop pane.
- `backend/api.py` CORS and `js/api.js` `LIVE_SERVER` are unchanged (team decision 6).

**Next action (proposed)**: phase F/G web work once Session A publishes the index and the first trial:
scoreboard page from `scoreboard.json`, the Beat the physics round player, and printable lessons.
