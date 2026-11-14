# TENGER implementation status

A status file is not a claim of completion. Each entry gives what ran, with what result, and what is
still open. Session A edits only "Science/data". Session B edits only "Web".

**Correction (15 Nov 2026):** entries below that call SPHEREx Blink "the team's earlier project" or pythonhack000 a "teammate" are wrong; it is the open-source code this repository started from (MIT, see LICENSE), and the entries are left as written.

---

## Science/data (Session A)

### Current phase

**Phase H data checks done (Task H2); Planet X depth measured (A8, V12); asteroid batch frozen and verified
(A9, V13).** Release work continues on `tenger-dev`; the user fast-forwarded `main` to `8fea8b9` at 05:57 UB.
`bake.yml` disabled on GitHub. Open: three teammates' confirmation for Pluto; updating `main`; making
the repository public and enabling Pages (`docs/RELEASE.md`).

### Task A10, 15 Nov 2026 (integrity audit, Planet X wording, batch contract, submission numbers)

| Part | Files | Result |
|---|---|---|
| Integrity audit | `scripts/audit_integrity.py`, `docs/audit-integrity.md`, `tests/test_audit.py` | From git and files only. **21 trial folders pass, 7 asteroid-batch checks pass, 0 fixes needed.** Checked: prediction and receipt commits are ancestors of, and earlier than, the first commit adding any evaluation-derived file; receipt hashes and committed bytes; every D² recomputed from verification.json (largest difference 0.0003, rounding); verdicts match the scoreboard. For Pluto and the asteroids, the earliest evaluation cutout on disk is later than the prediction commit. Rules, model code and both amendments (`3dfd962`, `4d7a076`) are ancestors of the freeze `61b3cb7` and earlier than it |
| Planet X wording | `scripts/strings_en.py`, `planetx/depth.json` (regenerated, unchanged apart from timestamps) | `planetx.verdict.partial` reads "Partly within reach: one exposure finds about {percent}% …". The threshold is ≥ 5%, as on the website (no row sits at exactly 5%). 17 too-faint rows, 1 partial (lm16-280au-i, 28%) |
| Batch contract | `docs/DATA-CONTRACT.md` V14; `batches/asteroids-2026a.json` now contract 14; validator latest 14 | The batch format as produced, field by field, against Session B's B6 proposal (renamed fields, additions) |
| Submission numbers | `scripts/submission_numbers.py` → `docs/SUBMISSION-NUMBERS.md` | 46 lines, each generated from its file and field, nothing typed by hand |

**Checks:** `pytest` 207 passed, 2 skipped; `node --test` 207 passed (after rebasing on Session B's `1a4f27a`);
validator 120 files, 0 failures; audit exit 0.

**User decisions, 15 Nov:**
- The base code is named only in README's Licence line; LICENSE and git history are unchanged. The
  `credit.base-project` key was removed (`5bfa3d3`).
- The exploratory 7-of-7 Horizons result stays on the site and in the submission text. It is always
  labelled exploratory, never the calibration.
- The team statement for the asteroid batch and Pluto will come later today.

### Task A9, 15 Nov 2026 (blind asteroid batch with a calibration result; contract V13)

| Step | Files and commits | Result |
|---|---|---|
| Rules first | `docs/asteroid-batch.md`, `scripts/asteroids.py` (`b9ef625`, 02:40 UB) | The selection rule, training, models, freeze-then-verify, scoring and calibration were committed and pushed before the selection ran. The user's MOST integrity rule is in `docs/EXPOSURE.md`: evaluation rows are cut to identifiers and times in memory, the star check is blind, and raw tables are saved only after the freeze. 1000 Piazzia was excluded (its full table had been fetched during a feasibility test). |
| Selection | `docs/exposure/asteroids/selection.json` (`0def564`, 02:55 UB) | JPL SBDB numbered MBAs with 9 ≤ H ≤ 11, by H. MOST footprint rows; ≥ 3 DR1/QR3 visits; training-visit V 11.5–16; blind 15″ star check (Gaia G < 18, AllWISE W1 < 15). 32 examined; first 8: 491, 1021, 363, 714, 345, 286, 162, 379 |
| Model code before data | `scripts/asteroid_forecast.py` (`8268808`) | v2 `MethodV2` with the frame as a parameter; start from our first-visit motion over a 0.8–4.0 AU grid; synthetic N-body model error (24 orbits with our fitted a, e, i; Sun + 4 giants); spacecraft term |
| Amendments before the freeze | `3dfd962` 05:52, `4d7a076` 05:53, `8fea8b9` (timestamps corrected) | The user chose the heliocentric primary for every object (barycentric v2 χ²/dof 332 on 345; heliocentric 4.5) and stated the one-rule wording. Barycentric v2 is the frozen secondary. C_fit is the largest of MC, jackknife and the χ²-scaled formal covariance, per axis; resampling won on every axis of every object |
| Training | `cache/asteroids/<n>/training-measured.json` → `trials/asteroid-<n>-position/training.json` | Every training exposure from MOST (2,041 cutouts). A3 fit, S/N ≥ 10, ≤ 3″ from MOST, no Gaia G < 18 within 12″. Kept per object: 97, 81, 92, 159, 80, 43 (286: visit 2 dropped), 51, 59 |
| Freeze | `61b3cb7` "predict: freeze asteroid batch" (06:03 UB), receipts `ffe833f`, raw MOST + integrity test `358d487` | Primary heliocentric 95% regions from 16″ × 10″ to 286″ × 22″; 286 frozen insufficient. The integrity test (both coordinates of any evaluation row, whole numbers) passes |
| Verification | `9cf2bfd` (06:36 UB) | 345 hit (D² 0.12, 6.5″); 491 and 1021 insufficient; 363, 714, 162, 379 ambiguous; 286 insufficient. **Calibration 1 of 1 inside (Clopper–Pearson 0.025–1.0)**. Secondary 1/1; straight line 0/1 (3.1° off) |
| After the verdicts (exploratory, not counted) | `verification.json` `horizons_after_verdict`; `docs/exposure/asteroids/exploratory-outlier.json` | JPL Horizons lies inside the frozen primary 95% region for 7 of 7 (median errors 3.4–62″). Cause of the failures: SPHEREx flags moving asteroids' pixels OUTLIER and `tenger-mask-v1` rejects them. With only OUTLIER kept, 491 and 1021 become hits (D² 0.08, 1.94; measured − Horizons ≤ 0.2″); 363, 714, 162 and 379 stay ambiguous (large regions, one static reference) |
| Site data | `batches/asteroids-2026a.json`, `scoreboard.json` `asteroid_batch`, `index.json` `batch_paths`, strings (196 keys) | Batch trials are kept out of the per-category counts. Validator: 120 files, 0 failures |

**Checks:** `pytest` 203 passed, 2 skipped (network); validator 120 files, 0 failures;
`predict check` all trials intact; `tests/test_asteroids_integrity.py` passes after the freeze.

**Limits:**
- N = 1 scored, so calibration is not tested.
- The team statement is pending for all eight objects.
- Training identification was guided by JPL positions; the fit and the forecast used none.
- The synthetic model-error fits start from the true orbit, so they may understate fit failures.
- Static rejection uses one reference image.
- Planet X wording follow-up (Session B's request): `planetx/depth.json` verdicts carry
  `recovered_fraction`. One row is `planetx.verdict.partial` (28%); the summary matches the website
  (`f1d0cc4`).

### Task A8, 15 Nov 2026 ("Could SPHEREx see Planet X? We measured it."; contract V12)

| Part | Files | Result |
|---|---|---|
| Injection-recovery library | `backend/injection.py` (new) | Reads the DR1/QR3 `EPSF` table (21 × 21 zones, 5× oversampled, "x-fast then y"). Picks the zone whose centre is nearest the source (parent pixel via `CRPIX1A/2A`, as in IRSA's tutorial). Injects unit-flux ePSF × F_ν ÷ pixel solid angle into an in-memory copy of IMAGE. Recovers with the site's `astrometry.fit_position` at S/N ≥ 5 within 1 px; the threshold is set only during the call, and the file is unchanged because its hash belongs to frozen forecasts. Also: ePSF photometry, Wilson intervals, isotonic completeness depths. The task's rule `iplane = y·11 + x + 1` (121 zones, 10×) describes the older QR1/QR2 PSF cube. It is the same x-fast ordering, with the DR1 grid size |
| Measurement run | `scripts/planetx.py` (new) | 7 exposed fields (5 challenge fields, Pluto and Makemake training visits) × 3 bands (0.75–0.87 µm D1, 3.25–3.55 µm D4, 4.45–4.75 µm D6) × 6 exposures = 126. Re-downloaded with EPSF; all 126 SHA-256 equal the investigations' `source_sha256`. Catalogue exclusion uses Gaia DR3 + AllWISE within 15″ (VizieR CfA mirror; IRSA TAP gave 502 and timeouts). **40,066 injections and 2,135 blank controls**, deterministic (seed 20261115), about 30 s on 6 processes |
| Outputs | `scripts/planetx_build.py` (new), `static/data/planetx/depth.json`, `planetx/hidden-planet.json`, `planetx/hidden/*.webp` | Curves with 95% Wilson intervals, 50%/90% depths per field and pooled, false-detection rates, ZODI per field, published comparison values with locations, motion from the observer's geometry, verdicts, and a stacked-depth *projection*. Four hidden-planet pairs. Everything is `"artificial": true`, `"counts": false` |
| Published numbers | `docs/planetx-depth.md` | Read in the papers themselves:<br>• Linder & Mordasini 2016 (abstract, Sect. 4.2): I 21.0, W1 20.1, W2 20.1 at 700 AU, plus their 1/r⁴ rule for 280 and 1120 AU (no I/W1/W2 for other masses).<br>• Fortney et al. 2016, Table 2 (622 AU): W1/W2 for 40 and 50 K and three methane abundances; system not stated, read as Vega (labelled).<br>• Meisner et al. 2018: W1 < 16.7 (90%).<br>• WISE Vega→AB offsets +2.699 and +3.339; I +0.45 (Blanton & Roweis 2007, Table 1).<br>• SPHEREx pre-launch per-channel full-mission and single-visit values (Public-products file; Crill et al. 2025) |
| Contract V12, strings | `docs/DATA-CONTRACT.md`, `scripts/strings_en.py` → `strings.en.json` (182 keys) | Artificial content is allowed only under `planetx/`. Every text key in the planetx files exists |
| Validator | `scripts/validate_release.py` | Artificial nodes outside `planetx/` fail. Files under `planetx/` need top-level `artificial: true`. Every image there must be referenced. Curves must equal their counts (Wilson, fractions, depths). Models need reference, DOI or URL, and location. The stacked depth must be labelled a projection. String keys must exist |
| Exposure record | `docs/EXPOSURE.md` | Nothing new opened (127 already-exposed exposures re-downloaded, identical bytes) |

**Results (pooled 50% single-exposure depth, AB):**
- 0.8 µm: **17.09** (17.01–17.18).
- 3.4 µm: **17.48** (17.40–17.54).
- 4.6 µm: **16.16** (16.11–16.20).
- 90% depths: 15.40, 16.03 and 15.40.
- False detections: 0 of 705, 0 of 713 and 0 of 717 blanks (≤ 0.5%).

**Checks:**
- **PSF mapping:** the nearest zone fits better than the swapped zone for 483 of 789 isolated stars
  (61%, 95%: 58–65%), and for 75% at 0.8 µm. The zone choice moves the depth by ≤ 0.11 mag.
- **Flux scale:** the median recovered flux is 97.0%, 96.6% and 99.5%.
- **Realism:** the site's fit finds real stars like injections where both are bright.

**Verdict:**
- The nominal Planet Nine (Linder & Mordasini, 700 AU) is 4.4 / 5.3 / 7.3 mag too faint for one exposure.
- Closest cases: the same planet at perihelion at 0.8 µm (0.4 mag) and Fortney's brightest 50 K
  methane-poor case at 3.4 µm (1.3 mag).
- One exposure is 1.9 mag shallower than the WISE + NEOWISE W1 limit.
- Within one visit the planet moves 1–790″ (300–1000 AU), so only a shift-and-stack search could
  reach deeper.

**Checks run:**
- `pytest tests/test_injection.py tests/test_validate_release.py`: 16 passed (PSF mapping on a real
  fixture, inject-then-measure, faint non-recovery, blank controls on noise, Wilson values,
  completeness, in-memory only, validator rules).
- Full-suite results are in the commit report.

**Limits:**
- Single exposures in one channel each.
- The site's Gaussian detector is about 1 mag shallower than an optimal ePSF fit.
- The injected sources' photon noise was not added.
- Six exposures per field and band.
- Broad-band model magnitudes are compared with narrow channels (direction stated per band).
- The new test fixture `tests/fixtures/spherex_spherex_dr1_2025W46_1A_0076_2_D6_epsf.fits.gz` is a real,
  exposed WISE 0855 cutout. Its ePSF planes outside the 3 × 3 zones around it are zeroed (recorded in
  its header).

### Task H2, 15 Nov 2026 (release checks for data and science; fix, don't add)

| Part | Files | Result |
|---|---|---|
| Production validator | `scripts/validate_release.py` (new), `tests/test_validate_release.py` (new, 4 tests) | Runs on `static/data`. It checks known kinds, major version 1 and a contract version not older than the kind (stale files fail), and rejects any `"example": true`. Artificial content must be `synthetic`, and real lesson inputs need a source. It requires source metadata (observation URLs and SHA-256, measurement method/value/σ, catalogue sources, sourced index distances, `derived_from` hashes, scene sources and Planet Nine references). Hash chains: `predict.check`, each `prediction.json` byte-equal to the copy in its receipt commit, model code hashes (v1 files; v2 trials use `forecast_v2.code_sha256`) and verification → prediction hashes. Every JSON in `static/dev-fixtures` must carry `"example": true`, because fixtures ship with `static/`. Legacy viewer files (`targets.json`, `results.json`, `meta.json`, `sky/`, `gaia/`) are listed, not validated. **Result: 77 contract files, 0 failures** |
| What it found | `static/data/lessons/how-sure.json` | `derived_from` still held the scoreboard hash from before A7's rebuild. Regenerated with `python -m scripts.build_records`; only the hash changed |
| Numbers on the site against their sources | validator `check_numbers` | The scoreboard equals a fresh `build_scoreboard.build` run. Game rounds and lessons equal a fresh `build_records` run. Index statuses follow the verifications, and index distances equal 1000/parallax. Post-mortem and hindcast numbers match the frozen verification. In `scene3d.json`, the frozen forecast, observed position, training count, star distances and our-orbit labels match their files. Session B's hard-coded figures in `js/i18n.js` (Gaia 10.4″, pixel 6.2″) agree with the data. **No mismatches** |
| README | `README.md` | Rewritten for TENGER: See/Predict/Learn; results (2 retrospective catalogue-assisted hits, the prospective Pluto miss and its post-mortem cause, 4 insufficient-data trials, open forecasts never counted); how to run and check; limitations; data credits and DOIs (matching the About page); team; SPHEREx Blink base (MIT); AI disclosure |
| No automatic rebake | `.github/workflows/bake.yml` | `schedule` removed, `workflow_dispatch` kept. Scheduled workflows run from the default branch, so `main` keeps the weekly schedule until it is updated (next run would have been Mon 16 Nov 04:17 UTC, 12:17 UB). On the user's go-ahead the workflow was then **disabled on GitHub** (`gh workflow disable bake.yml -R Nama2323/tenger`; state `disabled_manually`; `pages.yml` still active) |
| Pages check | `.github/workflows/pages.yml` (unchanged) | Uploads `static/` on a push to `main` that touches `static/**`, or on manual dispatch. `static/` is 139 MB, 1,461 files, none over 50 MB, no symlinks, only relative paths. Simulated by serving a copy of `static/` alone from `/tenger/` with no backend: Home (3D), Barnard's Star in See, Predictions and the scoreboard load. The only 404s are the expected `verification.json` files of unverified trials. On `*.github.io`, live search calls the Render service, whose CORS allows only `pythonhack000.github.io` (not changed: team decision 6). Repository private, Pages not enabled (API 404) |
| Release notes | `docs/RELEASE.md` (new) | Acceptance matrix, known limits, local run command, and the exact steps for the team to make the repository public and deploy Pages (not done here) |

**Checks (after rebasing on Session B's `16da115`):** `pytest` 179 passed, 2 skipped (network);
`node --test tests/*.mjs` 152 passed, 0 failed; `python -m scripts.validate_release` 0 failures;
`python -m scripts.predict check` 13 of 13 intact.

**Not done (by instruction or outside this task):** nothing pushed to `main`, no tag, no deploy, no
repository setting changed except disabling `bake.yml` (approved by the user after H2). Session B's request to add `n_exposures`/`n_visits` to `postmortem.json`
was declined in H2. `scripts/postmortem.py` is part of the code hash of the frozen v2 open forecasts,
so changing it would break their hash chain, and H2 is fix-only.

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

### Task A7, 15 Nov 2026 (Pluto open forecast v2 with the post-mortem's lessons)

**Method v2** (`scripts/forecast_v2.py`):
- **Data:** all Pluto detections held, 50 training plus the 4 identified 2026 detections (re-measured
  with the A3 fit), in 3 visits and 7 visit × array groups.
- **Frame:** barycentric two-body with the solar-system mass, with light time; observer = Earth plus
  the header spacecraft vector.
- **Uncertainty:** the envelope, separately along and across the track, of a group Monte Carlo (300
  draws; one offset per group with σ_g = max(group residual RMS 0.134″, 0.2″), exposures resampled
  within groups) and a leave-one-group-out jackknife. σ_g² and the unknown spacecraft position are
  then added.
- **Fit:** χ²/dof 2.32.

**Frozen v2 open forecasts** (never counted; v1 `pluto-position-open-2027a` unchanged).
Order: manifests `ab61b6b` → predictions `fd758e5` ("predict: freeze pluto open forecast v2") →
receipts `16ff3df`.

| Trial | Reference | Position | 95% along × across |
|---|---|---|---|
| `pluto-position-open-2027a-v2b` | 2027-04-25 (MJD 61520) | RA 310.371228°, Dec −22.947119° | 26.4″ × 8.9″ |
| `pluto-position-open-2027b-v2b` | 2027-09-29 (MJD 61677) | RA 308.018418°, Dec −23.798488° | 15.2″ × 11.5″ |

v1 said 54.1″ × 1.06″ for April. v2 sits 13.1″ from v1 along the track and 0.9″ across it, with a
cross-track size about 8 times larger.

**Defect, handled openly.** The first v2 manifests (`33a4171`, ids `…-v2`) were frozen without the
starting state and with the earlier uncertainty wording, because two edits to the freeze code had not
applied. The frozen code could not predict them. They were **never predicted**; they stay untouched
with an `abandoned.json` beside each (`6efcd3d`, reason, hash and replacement), and they are skipped by
the index and listed separately on the scoreboard. The freeze → predict flow was then rehearsed end to
end in a scratch copy before re-freezing as `…-v2b`.

**Exploratory hindcast** (`trials/pluto/hindcast-v2.json`, never counted). Method v2 was trained on
the two training visits only and compared with the 2026 observation:

| Method | Error | 95% region | D² |
|---|---|---|---|
| v1 (frozen) | 5.90″ | 6.04″ × 2.49″ | 6.77 (miss) |
| v2 (hindcast) | 5.27″ | 21.2″ × 15.6″ (along × across) | 0.40 (would have been a hit) |

v2 would not have been more accurate, but it would have been honest about its uncertainty. It was
designed after the miss, so it proves nothing on its own.

**Index.** `index.json` statuses come from the verification files (since `d66b6f3`): Barnard hit,
Eps Ind B hit, Pluto miss, matching `scoreboard.json`. Regenerated again here with the v2 forecasts.

**Tests:** `tests/test_forecast_v2.py` covers frozen, open and intact forecasts; v1 unchanged; open
forecasts not counted; abandoned manifests never predicted; prediction without network from its
folder alone; no rewrite; tampered training refused; the hindcast labelled exploratory.

### Task A6, 14 Nov 2026 (data for the 3D views)

`static/data/scene3d.json` (kind `tenger.scene3d/1`, contract V9), built by
`python -m scripts.build_scene3d`:
- **Pluto and Makemake, catalogue:** JPL SBDB orbital elements (Pluto solution 1, epoch JD 2457588.5;
  Makemake solution 130, epoch JD 2461200.5, with sigmas). Heliocentric ecliptic positions on
  2026-11-14 00:00 TDB from JPL Horizons (Pluto 35.64 au from the Sun, Makemake 52.74 au; Earth
  included). Drawable orbit points for each.
- **Pluto, ours (modeled):** the frozen A4 state as ecliptic elements: a 40.45 au, e 0.293,
  i 17.17°, Ω 110.33°, ω 111.76°, against SBDB's 39.59 au, 0.252, 17.15°, 110.29°, 113.71°. Our
  position today is 0.04 au from Horizons'. Labelled two-visit and Sun-only.
- **Stars:** RA/Dec, parallax and distance from each evidence file's catalogue entry. Barnard
  1.83 pc, WISE 0855 2.28 pc, Eps Ind B 3.69 pc, RW Aur 183 pc (cautioned: unresolved binary, poor
  Gaia fit), R Dra 799 pc.
- **Planet Nine:** hypothetical. Only the quantities stated in five cited abstracts (Batygin & Brown
  2016; Brown & Batygin 2016; Batygin et al. 2019; Brown & Batygin 2021; Brown, Holman & Batygin
  2024, which excludes 78% of the 2021 parameter space), with DOIs. No position or orbit is given.
- **Pluto loop:**
  - SPHEREx heliocentric positions (Earth plus header spacecraft vector) and the fitted Pluto
    positions for all 50 training detections and all 20 evaluation exposures (4 with measured
    positions);
  - the frozen forecast and the observed position (miss, D² 6.77);
  - the 2027 open-forecast track (13 points).

Tests: `tests/test_scene3d.py` (circular-orbit elements, ellipse points, ecliptic rotation, source
labels, Planet Nine cited and never placed, loop completeness) and `tests/test_static_data.py`
(every key, including `credit.sbdb`, has English text).

README: team section added (Narmandakh Garam, Erkhes Orgil, Anu-Ujin Bayarbaatar, Sonomlegtsog
Zolzaya), as passed on from the user by Session B. The rest of the README still describes SPHEREx
Blink and needs release prep.

### Task A5b, 14 Nov 2026 (exploratory post-mortem of the Pluto miss; nothing re-scored)

`docs/postmortem-pluto.md` and `static/data/trials/pluto/postmortem.json` (generated by
`scripts/postmortem.py`, all labelled "exploratory, after the reveal", `counts: false`). The frozen
trial, prediction, verification and scoreboard were read, never written.

- **Identification is right.** Observed − Horizons (moved to SPHEREx) = 0.35″. The frozen forecast −
  Horizons = 6.22″.
- **Shape.** The miss is mostly along the track: +5.69″ (z 2.29), against 1.57″ across it (z 1.50).
  The ellipse had the right orientation (PA 78° vs residual 245°/65°), but it was too small.
- **Cause (a), the main one: uncertainty too small.** Shared offsets within the 6 visit × array
  groups are not in the frozen covariance. With group offsets of 0.1/0.2/0.4″ added, the actual miss
  scores D² 3.46/1.65/0.45, which would all have been hits. A training-only jackknife (leaving out
  one group) gives a 95% region of 22.6″ × 13.0″ (D² 0.70).
- **Cause (b), secondary: model frame.** Barycentric instead of heliocentric improves the error from
  5.76″ to 5.13″. Full N-body adds nothing more. Light time (0.34″) and the spacecraft offset (0.92″)
  were already modelled. Pluto–Charon is about 0.1″ or less.
- **Cause (c), excluded: measurement.** 0.35″ from Horizons; C_obs σ 0.3″.
- **2027 open forecast** (frozen, unchanged): the along-track 54″ is adequate, but the cross-track
  1.06″ is probably 2–4× too small at group offsets of 0.2–0.4″.
- **Next time:** group-level resampling for C_pred, barycentric frame, at least three visits, and
  along/across-track sizes in the report.

Tests: `tests/test_postmortem.py` (post-mortem propagator = frozen propagator; GM total;
ellipse axes) and `tests/test_static_data.py` (post-mortem labelled exploratory, matches the frozen
verdict, no `trial.json`, not on the scoreboard).

### Task A5, 14 Nov 2026 (phase F part 2: verify, scoreboard, game, lessons; branch `tenger-dev`)

**Before opening anything.** The team update was recorded and pushed first (`63d53bd`):
- **Narmandakh** did the earlier research. That covers the Makemake viewing and five Pluto training
  cutouts (exact UTC times in `docs/EXPOSURE.md`).
- For Pluto's evaluation dates he saw **listing metadata only** (possibly JPL-predicted positions),
  never pixels.
- The other three teammates have not answered, so Pluto stays `prospective_unexposed` with
  `confirmation_pending`.

**Integrity gate.** `scripts/verify.py` refuses a trial unless all of these hold:
- the trial → training → prediction → receipt hashes match;
- `prediction.json` is byte-identical to the file in the receipt's commit (`git show`);
- the model code still has the frozen hash.

All three predicted trials passed. Pluto's evaluation visit was opened only afterwards, at
15:17:11 UTC, with cutouts centred on the **frozen model** (never on the listing's positions).

**Outcomes** (model = frozen physics model; baseline = frozen straight line, scored on the same data
with the same C_obs)

| Trial | Category | Exposures used | Model: mean residual (E, N) | Model error, D² | Verdict | Baseline error, D² |
|---|---|---|---|---|---|---|
| `barnard-position-2026b` | retrospective (+ catalogue-assisted) | 28 of 117 (89 refused: saturated-core fits) | (−1.31″, −0.78″) | 1.52″, **2.62** | **hit** | 3.11″, 786 (miss) |
| `epsindib-position-2026b` | retrospective (+ catalogue-assisted) | 113 of 120 | (+0.010″, −0.075″) | 0.076″, **0.21** | **hit** | 0.26″, 18.1 (miss) |
| `pluto-position-2026b` | **prospective, confirmation pending** | 4 of 20 (all D3; D6 never detected, as in training) | (−5.37″, −2.45″) | 5.90″, **6.77** | **miss** (threshold 5.991) | 5.5°, 1.3×10⁵ (miss) |
| `makemake-position-2026a`, `wise0855-position-2026a`, `rwaur-brightness-2026a`, `rdra-brightness-2026a` | retrospective | — | — | — | **insufficient_data** (frozen so at A4) | — |
| `pluto-position-open-2027a`, `makemake-position-open-2027a` | open forecasts | — | — | — | not counted; IRSA has not released the data | — |

**Pluto recovery.**
- **Pre-registered rules:** S/N ≥ 10 within 15″ of the frozen model, plus the static-source check on
  another date. Every peak with S/N ≥ 5 within 30″ is kept as an alternative (20 listed).
- **Result:** 4 exposures identified; none had two passing sources.
- **Motion consistency** (added at verification by the task instruction, and recorded as such):
  χ² 12.3 on 6 degrees of freedom, against a limit of 19.8. The identification passes.
- **After the verdict:** JPL Horizons, moved to the spacecraft position, sits 0.22″ E, 0.27″ N from
  the identified source, so the identification is right. The frozen orbit sits 5.59″ E, 2.72″ N from
  Horizons: the miss is the two-visit orbit's extrapolation over 5 months, not an identification
  error. This comparison is in `after_verdict_comparison` and does not affect the status.

**Correction made before Session B used the files.** The first baseline D² values were computed with
the baseline residuals' own scatter. The trial defines C_obs as the observed-position covariance,
which is the same for model and baseline. The baseline D² values were recomputed: Barnard
774 → 786, Eps Ind B 18.08 → 18.08, Pluto 74,423 → 133,738. All three remain misses. The old
values are kept in each file's `corrections` list. Model numbers and statuses are unchanged.
`verify.py` now scores the baseline with the model's C_obs.

**Scoreboard (derived).**
- Retrospective: 2 hits, 0 misses, 4 insufficient_data.
- Prospective: 1 miss (Pluto, `counts_as_prospective: false` until all four teammates confirm;
  `counts_as_prospective_if_confirmed: true`).
- Open forecasts listed separately, never counted.

No success rate is computed. Three checked trials cannot establish 95% calibration.

**Game and lessons** (Session B's lesson ids; every input has a `source_ref`):

| Record | Content |
|---|---|
| `game/barnard-position.json`, `game/epsindib-position.json`, `game/pluto-position.json` | Frame centred on the frozen model at the reveal time; training points = per-visit-and-array means; baseline, model (C_pred), actual (r̄, C_obs, image); scale = frozen 95% semi-major axis (2.32″, 0.41″, 6.06″). There is no brightness round because no verified brightness trial exists |
| `lessons/distance.json` | Pluto moved 4.09° between the two training visits (0.0200°/day). Sunlight takes 4.90 h to reach it at the fitted 35.34 au (modelled). Barnard's Star is 1.83 pc away (Gaia parallax) |
| `lessons/brightness.json` | Two Eps Ind B wavelength-matched, field-star-calibrated ratios as magnitudes with z (both: no clear change). Barnard: saturated in 356 of 356 pictures, so no brightness can be measured |
| `lessons/how-sure.json` | Pluto D² 6.77 vs 5.991 → miss. For N = 3: expected 2.85 hits, P(all) = 0.857 if independent; observed 2/3. The teacher note says what 3 trials can and cannot show |

**`reserved.json`.** The Makemake and Pluto regions stay listed (readers may keep blocking), with
`status: "released"` and a reason. Pluto is verified; Makemake was frozen as insufficient, so it has
nothing to protect. 3I/ATLAS stays reserved.

**Tests** (`tests/test_verify.py` plus the extended `tests/test_static_data.py`):
- **Tamper refusal:** a changed prediction, a missing receipt, and no rewrite of verification files.
- **Scoring:** D² from the mean residual and combined covariance; the C_obs fit floor; a singular
  covariance gives `invalid_comparison`; fewer than 3 identified gives `insufficient_data`; the
  baseline uses the same C_obs; published D² values match the published covariances to 2%.
- **Scoreboard:** counts, open forecasts excluded, a pending prospective trial not counted.
- **Recovery:** a static star near the forecast is listed and rejected; two passing sources make the
  trial ambiguous; inconsistent motion makes it ambiguous.
- **Strings:** every key in the trial, verification, game and lesson files has English text.

`.venv/bin/python -m pytest`: **158 passed, 2 skipped**. `node --test`: 132 of 133. The one failure
is Session B's check that the new strings are copied into `i18n.js`.

**Limits.**
- Pluto's category depends on three teammates who haven't answered yet.
- The verifier fits single sources: close pairs (≲15″) fail to fit, and in Pluto's crowded field
  several strong peaks were therefore not identified. They are kept as alternatives, not used.
- Barnard's holdout used only 28 of 117 exposures (saturated-core wing fits).
- Both hits are retrospective and catalogue-assisted, so they are demonstrations, not independent
  validations.

### Task A4, 14 Nov 2026 (phase F part 1: freeze and predict; branch `tenger-dev`)

**Order of events (all on `origin/tenger-dev`):**
1. Team viewing recorded in `docs/EXPOSURE.md` (`ef61149`).
2. Model code, tests and contract V5 (`1edb723`).
3. Nine trial manifests and training measurements (`486e723`).
4. One "predict: freeze <target>" commit per trial: `6c13e88` barnard, `84e4fee` epsindib, `b2df072` pluto, `24e215a` makemake, `d6999ef` wise0855, `70d15a9` rwaur, `df778bb` rdra, `d317a51` pluto open forecast, `7afe037` makemake open forecast.
5. Receipts with full SHAs (`ba1d3c8`).

`python -m scripts.predict check` reports every hash chain intact.

**Team statement.** The task message left two placeholders unfilled: the viewer's name ("[Name]")
and the other teammates' answer ("[confirmed none / not answered yet]"). They are recorded as given,
and the other teammates are treated as **not answered yet**. What was seen: Makemake's training
visits and its **evaluation visit** (2026-06-09, 06-12); Pluto's training visits only.

**Trials, categories and why**

| Trial | Category (labels) | Prediction | Why |
|---|---|---|---|
| `pluto-position-2026b` | **prospective_unexposed**, `confirmation_pending` | **predicted**: 2026-10-01 (MJD 61314.65), 95% semi-axes 2.5″ × 6.1″ | Evaluation visit (2026-09-29 → 10-02, QR3, D3/D6) not reported viewed and never opened by Session A. The forecast is our own heliocentric two-body fit to 50 training detections (2 visits). No JPL orbit or ephemeris input: Horizons only centred the training cutouts (`ephemeris_use`). All 8 starting distances (5–100 au) converge to one bound orbit (35.34 au, χ²/dof 1.99; near-best spread 0.01″). Pending until every teammate confirms |
| `barnard-position-2026b` | retrospective_holdout (+ catalogue_assisted) | predicted: 95% semi-axes 2.3″ | Holdout = visit 2 (2026-08-16 → 09-22), already seen. Parallax fixed to Gaia DR3 because the free fit is unusable (A3: 0.95″ vs 0.547″). Two training visits sit ±0.44″ off the catalogue track; this visit systematic sets the uncertainty |
| `epsindib-position-2026b` | retrospective_holdout (+ catalogue_assisted) | predicted: 95% semi-axes 0.4″ | Holdout = visit 3 (2026-09-27), seen. Parallax fixed to the Gaia EDR3 value via SIMBAD (free fit inconsistent, z = 7). Uncertainty from per-visit-and-array means (308 training positions, 3 visits) |
| `makemake-position-2026a` | retrospective_holdout | **insufficient_data** (`predict.no-training-positions`) | Evaluation visit seen by the team. No single-exposure training detection; only 1 validated joint epoch: an orbit is unconstrained |
| `wise0855-position-2026a` | retrospective_holdout (+ catalogue_assisted) | insufficient_data (`predict.no-training-positions`) | Every training position contaminated (A3) |
| `rwaur-brightness-2026a` | retrospective_holdout, exploratory | insufficient_data (`predict.no-period-model`) | Only 15 single-exposure fluxes at assorted wavelengths, with no wavelength-matched pair across training visits. Unresolved binary: no defensible range |
| `rdra-brightness-2026a` | retrospective_holdout (+ catalogue_assisted) | insufficient_data (`predict.no-training-measurements`) | Saturated in every exposure: nothing for a VSX-period model to phase |
| `pluto-position-open-2027a` | prospective_unexposed, **open forecast** | predicted: reference 2027-04-25 (MJD 61520), track 2027-03-26 → 05-25 every 5 days; at the reference 95% semi-axes 1.1″ × 54″ (along track) | Next visit expected near 04-25 (cadence of the training visits). Same orbit fit; not counted in the scoreboard; `check_after_utc` 2027-05-15 |
| `makemake-position-open-2027a` | prospective_unexposed, open forecast | insufficient_data | Orbit unconstrained (as above) |
| 3I/ATLAS | see_only | — | Never a trial |

Eligible for scoring when the evaluation data are measured: **3 trials**. Pluto is prospective,
pending confirmation; Barnard and Eps Ind B are retrospective. Four trials are frozen as
`insufficient_data` and count as such. One open forecast (Pluto) waits for IRSA.

**Model vs baseline on the training data.**
- **Pluto:** orbit χ²/dof 1.99 (residual RMS 0.29″, 0.30″). The straight-line baseline can't follow
  the parallax loop, and its forecast lies 5.5° from the orbit's. Fitting the October visit alone
  mispredicts April by about 4,000″, so one visit can't constrain an orbit.
- **Barnard:** χ²/dof 8.2 at exposure level, 2.9 at visit level.
- **Eps Ind B:** 5.7 at exposure level, 9.5 at visit level.

The baselines (no parallax) are in each `prediction.json` under `diagnostics`.

**Scoring as frozen.**
- **Hit rule:** D² = r̄ᵀ S⁻¹ r̄ ≤ 5.991, with S = C_pred + C_obs.
- **Residual:** r̄ is the mean, over identified holdout exposures, of observed − frozen model. The
  model is evaluated with each exposure's own observer position.
- **Observed covariance:** C_obs is the sample covariance divided by N; fewer than 3 identified
  exposures means insufficient_data.
- **Pluto identification is pre-registered:** search around the frozen model only (no ephemeris
  query), S/N ≥ 10, static-source check, ambiguity rule.

**Tests** (`tests/test_predict.py`, `tests/test_static_data.py`) cover:
- **Orbit:** synthetic recovery with the forecast inside D² < 13.8; convergence from every starting
  distance; a one-visit arc flagged as unconstrained.
- **Categories:** label precedence.
- **Isolation:** holdout rows ignored even when poisoned; evaluation rows reduced to IDs and times;
  prediction runs with no network and no files outside the trial folder.
- **Integrity:** repeated predictions byte-identical; tampering with training, trial or prediction
  detected; predictions never rewritten; insufficient trials frozen as such; published hash chains
  intact; open forecasts not counted.

`.venv/bin/python -m pytest`: **144 passed, 2 skipped**.

**Published for Session B:**
- `static/data/trials/<id>/{trial,training,prediction,receipt}.json`
- `scoreboard.json`: retrospective 2 waiting + 4 insufficient; prospective 1 waiting; open forecasts listed separately
- `index.json`: `trials`, `scoreboard_path`, and per target `prediction.status` / `trial_ids` / `open_forecast_ids`
- `reserved.json`: evaluation paths stay closed until verified
- Contract V5

**Limits.**
- Pluto's category depends on teammates who haven't answered yet.
- The orbit model is Sun-only (planetary perturbations neglected over a 7-month arc). Pluto–Charon
  photocentre motion is left in the residuals.
- The spacecraft position at the evaluation time is a covariance term in the headline prediction;
  verification uses the real header positions.
- The Barnard and Eps Ind B uncertainties rest on only two or three visits.
- Horizons positions for the evaluation exposures exist in the repository (A1 inventory,
  `reserved.json`); the prediction code provably does not read them.

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

**Results per target** (from the published files, dataset `a3-2026-11-14`, pipeline `tenger-a2-2026.11.14`)

| Target | Exposures used / listed | Status | Main result | Checks and limits |
|---|---|---|---|---|
| Barnard's Star | 356 / 358 (DR1 + QR3; 2 failed downloads) | measured | μ = **10.42 ± 0.33″/yr** (parallax fixed to Gaia; σ from the visit-level fit). Gaia DR3 10.393 (z = 0.07) | Control: 14 field stars, all agree with Gaia (median Δ 0.040″/yr). Floor 0.15″. Saturated core: wing fits in arrays 4–6. Free parallax 0.95 ± 0.04″ vs 0.547″ (z = 9): visit systematics, flagged. Brightness: saturated in every exposure → 0 of 8 ratios. No difference image passes |
| WISE 0855 | 256 / 258 (DR1) | insufficient_data | No motion, no brightness: every fit near the track is outside the 3″ gate or contaminated by a Gaia G = 16.3 star 4–12″ from the track | Catalogue: SIMBAD via CfA (Kirkpatrick+2021). Context: 2MASS non-detection (kept as such); AllWISE W2 27 exposures, 2010. 4 difference-image pairs pass all gates |
| Epsilon Indi B | 458 / 460 (DR1 + QR3) | measured | μ = **4.668 ± 0.043″/yr**, catalogue 4.684 (z = −0.37). 16 of 20 matched brightness ratios measured, all consistent with no change (3–25%) | Control: 5 field stars, 3 agree → **not passed** (flagged). Free parallax 0.369 ± 0.014″ vs 0.271″ (z = 7), flagged. Repeatability floor 1.6%. 6 difference-image pairs |
| RW Aurigae | 335 / 335 | insufficient_data | Brightness refused: flagged (saturated/bloom) pixels in the aperture in 318 exposures; 0 of 9 ratios | Blended binary (1.2″). 1 difference-image pair |
| R Draconis | 299 / 2,493 (sample of 300; deep + wide, DR1 + QR3) | insufficient_data | Brightness refused: saturated in all 299; 0 of 17 ratios | 7 visits; 3 difference-image pairs |
| Makemake | 234 / 236 training rows (DR1) | measured (partial) | Not seen in single exposures. Joint fits: **1 validated epoch** (v0-d2, −0.32″ E/+0.92″ N of the spacecraft-corrected ephemeris, S/N 9.3), 2 candidates, 9 below S/N 5 | Static-source check, time-shuffled null test. Holdout visit closed |
| Pluto | 218 / 218 training rows (DR1) | measured (partial) | **9 validated epochs** (S/N 11–26, offsets within 0.9″), 3 candidates, 4 too sparse or faint | Array-to-array scatter about 0.4″ within a visit. Holdout visit closed |
| 3I/ATLAS | 258 / 259 official-table rows | See-only | 12 body-centred previews (Aug, Dec 2025); no measurements, no trial | Table's QR2 links no longer resolve; DR1 products found by SIA. 1 row has no DR1 product (listed as unavailable) |

**What Session B gets** (all under `static/data/`): `index.json` (eight targets, sourced map distances,
`reserved_path`, `strings_path`), `<key>/investigation.json` (contract V3), `<key>/epochs/*.webp`
(one preview per epoch, same exposures as the measurements), rebuilt `<key>/meta.json` +
`frames.bin.gz` for the five challenge targets (epochs map to them through `epochs[].viewer` and
`viewer.visits`, whose `date_utc` equals the viewer's step id), `reserved.json` (Makemake/Pluto
holdout paths, 3I/ATLAS path), `strings.en.json` (English text for every key emitted; B copies it into
`i18n.js`). Contract V4 adds brightness game rounds. B confirmed all of these render (messages
between sessions, 14 Nov).

**Commands and results** (14 Nov 2026, 22:29 UB)

| Command | Result |
|---|---|
| `.venv/bin/python -m pytest` | **133 passed, 2 skipped** (network). New A3 tests: `test_astrometry.py` (synthetic stars: masks, VARIANCE, saturation, parallax, refusals), `test_investigation.py` (no cross-array or nearest-channel comparisons, PSF/registration gates, FOV centring, identification gate, contamination, reproducibility), `test_stacking.py` (joint fit, null test, spacecraft correction), `test_static_data.py` (every emitted key has English text, no example data, previews exist, viewer mapping, holdout never opened, reserved paths), fractional-aperture test |
| `.venv/bin/python -m pytest --network tests/test_network.py` | 2 passed (A2) |
| `node --test tests/*.mjs` | 106 of 107 here at 22:29; the failure was B's check that every new `strings.en.json` key is copied into `i18n.js` (`context.*`). B copied them in `3dc1e22` and reports 115/115 |
| Full rebuild twice (`build_investigation` ×5 `--cached-only`, `build_body` ×3) | **All 52 published data files byte-identical** between the two runs |
| Server + in-app browser, `?target=` for all five, plus Pluto | All open from the rebuilt bundles with their evidence files; **0 `/api/` requests** |

**Exposure accounting.** Opened in A3: every current DR1/QR3 exposure of the five challenge targets
(R Dra: the 300 sampled), Makemake and Pluto training visits only (holdout windows refused in code,
newest opened exposure MJD 61049.26 and 61172.96), and 3I/ATLAS. The tables are in
`docs/EXPOSURE.md`. Raw cutouts stay in the git-ignored `cache/`, with SHA-256 values in each
observation record.

### Still open after A3

- **Saturation.** Barnard, RW Aur and R Dra saturate SPHEREx in nearly every exposure. Their
  brightness is `insufficient_data`. Wing or PSF-wing photometry of saturated stars, and ePSF fits,
  are not implemented.
- **Visit-level systematics.** For the saturated Barnard star and for Eps Ind B, the free parallax
  disagrees with Gaia (z = 9 and 7). Motion uncertainties therefore use the visit-level fit. The
  cause (wing-fit asymmetry, array-dependent offsets of about 0.4″) is not modelled.
- **WISE 0855** needs a joint along-track fit in arrays 5–6 that models the neighbour star. That is
  the only route to a measurement there.
- **Moving bodies.** Only 1 Makemake epoch passes the null test. Detectability of the closed holdout
  visits is unknown (Task A4 must allow `insufficient_data`).
- **Checks still `not_checked`:** background in comparisons. The registration check reads header
  flags only, and `FINAST` is 0 in every sampled file, so it barely discriminates.
- WCS-WAVE (≈1 nm) is used instead of the CWAVE/CBAND product. The 10%-of-bandwidth tolerance is
  adopted, not validated.
- `static/data/results.json` and `scripts/results.mjs` remain legacy (no longer shown by B).
- `astroquery` is not installed (httpx mirror helpers only). Dependencies are unpinned.

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

- Collect the three remaining teammates' statements on Pluto's evaluation visit. When all four
  confirm, regenerate `scoreboard.json` so the Pluto row counts as prospective. Never edit the trial
  files.
- Keep `bake.yml` disabled during judging (done 15 Nov; `docs/RELEASE.md`, step 0).
- After Sunday 14:00: the team makes the repository public, enables Pages and fast-forwards `main`
  (`docs/RELEASE.md`). Run `python -m scripts.validate_release` before every data commit.
- When IRSA releases Pluto's spring-2027 visit, check `pluto-position-open-2027a` with the same
  verifier.

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

### Task B4, 14 Nov 2026 (phase F/G: the prediction ledger and the reveal; rebased on Session A's A4 `9003251`)

Field names agreed with Session A before A4 froze anything (now DATA-CONTRACT V5): `open_forecast`, `labels`,
`confirmation_pending`, `holdout.data_state` / `check_after_utc`, `prediction_status`, `track`, `training.json`,
`scoreboard.open_forecasts`, `observed.image` geometry, full 40-character receipt SHAs. For A5, the reveal also reads
`residuals.<model|baseline>.reference`, `c_pred_arcsec2` and `observed.cov_arcsec2` = C_obs as scored (Session A's
scoring frame, DATA-CONTRACT V6), so the reveal draws and re-checks exactly what was scored.

| Part | Files | Result |
|---|---|---|
| Predictions page | `index.html`, `js/ledger-ui.js`, `js/ledger-parts.js`, `js/ledger.js` (pure), `js/route.js`, `js/main.js` | Nav item between Investigate and Beat the physics, `?page=predictions`. Built only from `index.json` `trials`, `scoreboard.json` and each trial's `trial`/`prediction`/`receipt`/`verification` files. One card per trial: target, quantity, short status chip (waiting, hit, miss, ambiguous, insufficient data, invalid comparison, see only), every category label (category first), what was predicted for which UTC date (position with 95% semi-axes, or value ± σ, or "no defensible prediction" with Session A's reason key), "Frozen in git `<7-char sha>` on `<UTC>`" linking to `github.com/Nama2323/tenger/commit/<full sha>` (no link for example receipts or an all-zero SHA), the team-confirmation-pending note, raw residuals of model and straight line once verified (east, north, error, D = √d²), and a "Watch the reveal" button for verified position trials. Status comes from `verification.json`, then V5 `prediction_status` (insufficient data at freeze is never "waiting"), then a frozen prediction (waiting); a scoreboard row that disagrees is shown as a warning. Cards: checked, then waiting, then insufficient data. |
| Scoreboard summary | `js/ledger.js` `scoreboardTable` | Category × status table with exactly the categories and statuses present in `counts`; no totals, no percentage, no expected-hit number. Open forecasts and See-only targets are listed by name as "never counted". A disclosure explains the four trial types. |
| Open forecasts | `js/ledger-ui.js` | Separate section "Open forecasts: check back when IRSA releases the data", only for trials the files label (`open_forecast`, `holdout.data_state: not_released` or `scoreboard.open_forecasts`; never inferred from dates). Chart (north up, east left, scale bar): the predicted position and its 95% region to scale, the `track` with each point's own 95% ellipse and first/last dates, a zoom on the reference-time region when it is too small to see, the straight line drawn only if it is on the chart (otherwise its distance is given), and a data table. "Can be checked after `<check_after_utc>`" or "no date announced". Real Pluto forecast: 13-point track with its retrograde loop; Makemake: insufficient data. |
| The reveal | `js/reveal.js`, `css/style.css` | Full-screen `<dialog>`, `?page=predictions&trial=<id>` opens it directly (for recording). Steps on click (picture or button), Space or →; ← back, Home/End: (1) evaluation image, whole, with the prediction area marked; (2) a 1.1 s zoom to that area, training track drawn in with its dates; (3) frozen 95% region (C_pred) growing in, with the receipt line and the category note ("not a blind test" for retrospective); (4) straight-line baseline continuing the track; (5) observed position with its offset; (6) verdict banner (Hit/Miss, D vs 2.45) with the dashed test region (C_pred + C_obs), raw residual table and which of model and straight line was closer. One callout label per step, placed in the free direction (never over markers, the track or the banner). The page recomputes d² from the drawn positions and shows a warning if it disagrees with `verification.json` by more than 2% (the recorded result is never changed). Images are drawn only with centre, pixel scale and north-up/east-left orientation, pixelated so SPHEREx pixels stay visible. Under `prefers-reduced-motion` there is no zoom or entry animation. At 1280×720 the stage is 570 px and every step fits without scrolling. |
| Shortcuts and limits | `js/help.js`, `index.html` | "?" key (and Shift+/) or the "?" button in the top bar opens a keyboard-shortcut sheet (every page, viewer, game, reveal; each row matches a real handler). "Can and can't see" in the top bar (in the Menu on phones) opens "What TENGER can and can't see" on every page. Both are native modal dialogs (Escape, focus kept inside); Escape no longer also closes the investigation panel while a dialog is open. The nav becomes the Menu below 980 px (it has six items now). |
| Investigate panel | `js/panels.js` | Reads V5 `training.obs[]` / `holdout.obs[]` (it said "0 earlier observations" for the A4 trials), shows every label and the confirmation-pending warning, and links to the ledger (to the reveal when verified). |
| Fixtures | `static/dev-fixtures/tools/make-trials.mjs` | Writes labelled example trials with real hash chains: Barnard hit (straight line closer) and Epsilon Indi B miss, both with `training.json` and an **artificial** 48×48 px evaluation image (6.2″ pixels, labelled "Artificial", "Example data, not an observation"); Pluto waiting (confirmation pending); WISE 0855 insufficient at freeze; Pluto open forecast with a 4-point track and Makemake open forecast; the example scoreboard regenerated from them. Positions, covariances, dates and images are invented. |
| Switch to real files | `js/main.js` | The page shows the fixtures (with its own banner) until the real `index.json` lists trials or a scoreboard, then the real files, with no code change. This happened when Session A pushed A4 during this task. `?fixtures=1` still forces the examples, which is the only way to see a reveal until A5 publishes a verification. |
| Lesson 3 | `js/lessons.js`, `js/learn-ui.js` | Its "Open forecasts" column counted `waiting`; under V5 open forecasts are not in `counts`, so the column is now "Waiting for the check" and the text says open forecasts are listed on the Predictions page. |
| Strings | `js/i18n.js` | ~220 new English keys; `strings.en.json` re-copied (112 keys after A4). |

**Checks**

| Check | Result |
|---|---|
| `node --test tests/*.mjs` | **133 passed, 0 failed** (adds `tests/ledger.test.mjs`, 18 tests: trial ids, real-vs-fixture switch, open forecasts only from labels (a far-future date alone is not one), status order and the scoreboard-conflict warning, all labels, receipt links only for real commits, scoreboard counts copied unchanged with no rate field, open forecasts and See-only never counted, fixture hash chains training → trial → prediction → receipt/verification, reveal geometry = recorded residual and D = √d², a tampered residual is flagged, A5 reference frame with C_pred from verification, image placement refusals, forecast tracks and zoom, card order, scale bars, the `trial` route parameter, English text for every step/status/shortcut/limit) |
| `node docs/screens/capture.mjs http://localhost:8766 docs/screens` | 137 captures, all pages at 360/390/768/1280 plus the reveal at 1280×720 (every step for Barnard, the verdict for the Epsilon Indi B miss): measured viewport = requested, no horizontal scroll, no control under 44 px, no script errors (only the expected 404s for verification/receipt files that do not exist yet) |
| In-app browser | Real ledger after A4 (7 trial cards, 2 open forecasts, scoreboard from the file); fixture reveal stepped with Space, →, ←, End, clicks on the picture; Escape closes it and the URL drops `trial`; the "?" key and both top-bar dialogs; the nav fits at 990 px and becomes the Menu at 768 px |

Screenshots: `docs/screens/predictions*.png`, `predictions-reveal-<step>-<size>.png` (for the video: 1280x720),
`shortcuts-*.png`, `limits-*.png`. Every reveal screenshot shows example data (artificial image, invented numbers);
no trial has been verified yet.

**Limits**

- No real reveal exists until Session A publishes verifications (A5). Until then the reveal can only be shown with
  `?page=predictions&fixtures=1&trial=barnard-position-example` (hit) or `…epsindib-position-example` (miss), which
  are labelled example data throughout. Do not record those frames as results.
- `baseline_track` (V5, open forecasts) is not drawn; the forecast chart shows the straight line only when it falls
  on the chart. The forecast chart does not draw the training track (it is far from the forecast window).
- Labels in the reveal avoid markers, the training track and the banner, but a training date can still touch an ellipse
  when points are crowded (seen on the Epsilon Indi B example at 390 px).
- Commit links point to the private repository until it is made public (Sunday 14:00).
- Not checked on a real phone; emulated widths and the desktop pane only.

**Next action (proposed)**: when A5 lands, open each verified trial's reveal at 1280×720, record the video take, and
re-capture `docs/screens/`; read A5's lesson records in Learn.

### Task H1a, 14–15 Nov 2026 (phase H: release preparation that does not depend on A5; rebased on Session A's A6 `43e8731`)

No new features. What changed:

| Part | Files | Result |
|---|---|---|
| About / Data Sources | `index.html`, `js/pages.js`, `js/i18n.js`, `css/style.css` | What TENGER is and the See / Predict / Learn story. **How TENGER works**: seasons and visits, quality checks, wavelength matching (same array, 10% of the narrower bandwidth, no nearest channel), hold-out predictions and trial types, frozen git receipts, recovery of moving bodies (the pre-registered A4 rule), scoring (D² ≤ 5.991, \|z\| ≤ 1.96, the game's bounded score). **Limits**: saturation (Barnard, RW Aur, R Dra), contaminated targets (WISE 0855 neighbour, RW Aur binary), parallax-only illustrations, a small number of trials (counts are left to the scoreboard; no number is copied), approximations. **What TENGER can and can't see** (same keys as the top-bar dialog). **Data, DOIs and acknowledgements**: SPHEREx (doi:10.26131/IRSA678, doi:10.26131/IRSA679 cited, cube not used), IRSA, WISE/AllWISE, 2MASS PSC (doi:10.26131/IRSA2), Gaia DR3, SIMBAD, VizieR (doi:10.26093/cds/vizier), Sesame, AAVSO VSX (named prior, not needed), JPL Horizons, JPL SBDB (orbits in A6's `scene3d.json`), Aladin Lite (including that it reports its start-up settings and the page address to CDS); required acknowledgements quoted; `ack.spherex` is the exact text of `docs/tenger-context/context/IRSA-acknowledgement.txt` (a test compares them). **Software and licences** from the installed package metadata (Aladin Lite GPL-3.0, Astropy with its citation, NumPy, SciPy, Pillow, FastAPI, Starlette, Uvicorn, HTTPX, pytest, Node.js) plus a table of all 35 Python packages; fonts (OFL). **Built on SPHEREx Blink** (pythonhack000, MIT). **Team**: Narmandakh Garam, Erkhes Orgil, Anu-Ujin Bayarbaatar, Sonomlegtsog Zolzaya (names from the user, no roles; also sent to Session A for the README). **AI disclosure**: planning and audit with OpenAI Codex and Claude; implementation with Claude Code; team review; no AI-generated images. DOIs were resolved on doi.org and their landing pages checked (IRSA678 = DR1 spectral images, IRSA679 = DR1 all-sky cube, IRSA2 = 2MASS PSC). |
| Fixes found on the way | `js/i18n.js`, `css/style.css` | The map text said Solar System distances are from the Sun; the index gives geocentric distances (JPL Horizons), now said so. "Can't see" listed RW Aur and R Dra as saturated but not Barnard's Star. `body.example-data` set `--banner` without re-declaring `--chrome`, so the example banner covered the top 40 px of the investigation (custom properties resolve where declared). |
| Guided tour | `js/tour.js`, `js/main.js`, `index.html` | Home → Pluto (preview blink) → Predictions (scrolls to a "Watch the reveal" button when one exists) → Beat the physics → Learn. Step-by-step with **Next** / **Skip the tour** and "step n of 5", no timers. Starts by itself **once per browser** (`localStorage` key `tenger.tour.v1`, read and written in try/catch) only on a plain visit to Home: never with a target, coordinates, page, trial, example data or `embed=1`, and not at all when storage is blocked (it could not remember, so it waits for the "Guided tour" button). Keyboard focus stays on Next while targets open; on desktop the bar sits over the side panel during an investigation so the picture and time bar stay visible. |
| Embed | `index.html`, `js/main.js`, `js/route.js`, `css/style.css` | `?embed=1` now matches the R1 layout (the old rule hid `.top`, which no longer exists): no top bar, map, tour, footer or other panels; the viewer and See only; Escape does not close it; an **Open in TENGER ↗** link opens the same view on the full site. **Copy embed code** next to "Copy share link" copies `<iframe src="…&embed=1" title="TENGER: <name>" width="100%" height="640" loading="lazy" allowfullscreen>` (escaped, no `fixtures`); if the clipboard is blocked the code appears in a read-only box to copy by hand. |
| Open Graph | `index.html`, `og.png` | `og:*` and `twitter:card` tags; `og.png` is a 1200×630 headless-Chrome screenshot of this site (Barnard's Star, AllWISE 2010 next to SPHEREx 2026, side by side), palette PNG 127 KB (grey and colour palettes built separately so the amber catalogue ring keeps its colour). The tags are static English in `<head>` because crawlers do not run scripts. `og:image` is relative until the public address is chosen. |
| Performance | `css/style.css`, `js/main.js`, `js/ledger-ui.js`, `js/learn-ui.js`, `index.html` | Layout shift fixed: the content stays invisible until main.js has shown the page the address asks for (4 s safety net); the Predictions page shows its heading and one loading line until the ledger is drawn; the Home map and the Learn cards appear when their data are drawn; `main` has a 100vh minimum so the footer never jumps. Lesson cards use `h2` (heading order). Images were already `loading="lazy"`; preview images and frame bundles load only when a target is opened. |
| Captures | `docs/screens/capture.mjs` | Marks the tour as seen before each capture; adds About sections, the tour, embed and the OG sizes. |
| Sky tiles | `js/sky.js` | The Real sky panel probed `alasky.cds.unistra.fr/AllWISE/RGB-W4-W2-W1`, which now answers 404, so it always fell back to the coarse local copy. It now uses IRSA's mirror of the same survey (`ivo://CDS/P/allWISE/color`, CORS `*`, the URL the backend already uses); checked in the in-app browser (tiles from IRSA). |
| Strings | `js/i18n.js` | `strings.en.json` re-copied after A5 and A6 (142 keys); the copy test fails until this is done. |

**Links** (15 Nov 2026, from this Mac; checker in the session scratchpad, not shipped)

| What | Result |
|---|---|
| 39 distinct URLs in `static/` code and HTML | All answer 200 after fixes, except: `github.com/Nama2323/tenger/commit/` (the prefix of receipt links; the repository is private until Sunday 14:00, and all 9 receipt SHAs exist on `origin/tenger-dev`) and `spherex-blink.onrender.com` (200, live service, left as is per team decision 6). Fixed: SIMBAD home (`/simbad/` gave 404, now `simbad.cds.unistra.fr/`), Starlette and Uvicorn (old domains no longer resolve; now `starlette.dev`, `uvicorn.dev`, from their package metadata), the CDS AllWISE tile URL (see Sky tiles). |
| DOIs | `10.26131/IRSA678`, `IRSA679`, `IRSA2` and `10.26093/cds/vizier` resolve; the IPAC landing pages name the right datasets |
| 2,442 IRSA source URLs in `static/data/**/*.json` | All 2,438 distinct files answer HEAD 200. The cutout form of the links (`?center=…&size=…`): 4 of 25 sampled returned a FITS header; the rest got "503 Server busy, retry later" from IRSA, also for 6 single, spaced requests soon after. About 20 minutes later 2 more returned FITS headers (200). That was IRSA load, not broken links; nothing was changed |

**Lighthouse 12.8.2, mobile (default simulated throttling), local server**

| Page | Before | After | FCP / LCP / TBT / CLS after |
|---|---|---|---|
| Home | Perf 81, A11y 100, BP 100, SEO 100 (CLS 0.18) | Perf 86, A11y 100, BP 100, SEO 100 | 1.7 s / 4.0 s / 0 ms / 0 |
| Predictions | 64 / 100 / 96 / 100 (CLS 0.69) | 91 / 100 / 96 / 100 | 1.7 s / 3.3 s / 0 ms / 0 |
| Beat the physics | 85 / 100 / 100 / 100 (CLS 0.16) | 92 / 100 / 100 / 100 | 1.3 s / 3.3 s / 0 ms / 0 |
| Learn | 85 / 98 / 100 / 100 (CLS 0.16, heading order) | 93 / 100 / 100 / 100 | 1.7 s / 3.2 s / 0 ms / 0 |

Not fixed (not cheap or not ours): Predictions best-practices 96 = console 404s for `verification.json` of trials that have none (insufficient data at freeze, open forecasts; the page reads them as "missing"); render-blocking CSS (one 17 kB file); no long cache lifetimes (server or Pages setting); no minification (no build step by design). Home's LCP element is the tour text on a first visit. Page weights before opening a target: about 300 kB (fonts 100 kB); a target's frame bundle loads only when it is opened (Barnard 5.9 MB).

**Images over 200 kB**: none in Session B's folders. Three remain in `static/data/sky/Norder3/` (Session A's folder: `Allsky.jpg` 734 kB, `Npix450.jpg` 214 kB, `Npix451.jpg` 217 kB), the offline copy of the sky tiles, loaded only if IRSA is unreachable when Real sky opens. Not recompressed here (folder ownership).

**Checks**

| Check | Result |
|---|---|
| `node --test tests/` | **141 passed, 0 failed** (adds `tests/release.test.mjs`, 8 tests: the SPHEREx acknowledgement equals the IRSA file word for word; both DOIs and every source, licence, method, limit, team and disclosure key exist; AI disclosure wording; tour order, once-per-browser rules, blocked storage, Next/Skip sequence; embed code escaping; OG tags and og.png 1200×630 under 200 kB) |
| `node docs/screens/capture.mjs http://localhost:8766 docs/screens` | 163 captures: every page state at 360/390/768/1280 plus the About sections, the tour (Home, Pluto), embed, the embed-code fallback, the reveal at 1280×720 and the two OG candidates. Measured viewport = requested; no horizontal scroll; no control under 44 px; every page ready; the only console errors are 404s for trial files that do not exist (`verification.json` of unverified trials, the fixtures' missing receipt) |
| In-app browser | Tour from a fresh visit (auto-start, Enter on Next through all five steps, focus kept on Next, Finish, no restart on reload); embed at 1024 px; Copy embed code (clipboard blocked in the pane, so the fallback box appeared with the escaped iframe); About at 375 px (no horizontal scroll); Real sky with IRSA tiles; a real reveal (Barnard, verdict step) with no console errors |

**Not done / limits**

- Built on A5/A6 data but does not present them beyond what B2–B4 already read: the Pluto post-mortem ("Why we missed", `trials/pluto/postmortem.json`), the 3D scene (`scene3d.json`) and the lesson records' new wording are not shown or checked in detail. Session A's message: post-mortem is exploratory, after the reveal, and changes no verdict.
- `og:image` is relative; make it absolute when the public address is chosen. Receipt links work only once the repository is public.
- Embed: the iframe uses the address it was copied from (localhost while testing). The embedded page is the whole app in embed mode, so it downloads the same files.
- Not checked on a real phone; emulated widths and the desktop pane only.

**Next action (proposed)**: when the public address is chosen, set absolute `og:url`/`og:image`; then a web task for A5/A6 content (post-mortem in Predictions and Lesson 3, the real reveals at 1280×720 for the video).

### Task R2, 15 Nov 2026 (3D Home scene with the 2D map as fallback; display colours in See)

| Part | Files | Result |
|---|---|---|
| Library | `static/vendor/three/` | three.js **0.187.0** (MIT, `LICENSE` kept). The npm package now ships only unminified builds (2.1 MB for `three.core.js` + `three.module.js`), so the classes the scene uses were bundled and minified once with esbuild 0.25.12 into one ES module, `three-tenger.min.js`: **575 kB, 141.7 kB gzip**. The README gives the entry list, the command, the size and the SHA-256. The site still has no build step. |
| Orbit maths | `js/orbits.js` (pure, no three.js) | Planets from JPL's approximate Keplerian elements (Standish, Table 1, 1800–2050) for today's date: elements + rates, ω = ϖ − Ω, M = L − ϖ, Kepler by Newton iteration, rotation into the J2000 ecliptic. Orbit lines at that date's elements. ICRS → ecliptic for star directions (ε = 84381.448″, as in `scene3d.json`). Log scale R = 10·log₁₀(1 + r / 0.25 au). Seeded illustrative Kuiper Belt (30–50 au). Planet Nine: every published semi-major-axis range in `scene3d.json`, each with its citation (380–980 au, Brown & Batygin 2016; 400–800 au, Batygin et al. 2019; 300–520 au, Brown & Batygin 2021); none → label only. |
| Scene | `js/space3d.js` | Sun with glow sprites; eight planets (sizes exaggerated, Saturn with rings, Earth labelled "SPHEREx orbits it"); faint reference rings 1, 10, 100, 1,000 au with labels; orbit lines in the accent token; Kuiper Belt dots labelled "illustration"; Pluto and Makemake at their JPL Horizons positions with their SBDB orbits from `scene3d.json`; Planet Nine only as faint shaded rings for those published ranges (no point, no orbit line, no edges), labelled "hypothetical" with the three citations and "Not observed: no known position or orbit" (user's note, 15 Nov); the five challenge stars in their real directions (Gaia DR3 / SIMBAD) on an outer shell the camera never leaves, each with a dashed sightline and a label "name · distance" on its near part (a label whose sightline points at the camera fades, so it never sits on the Sun); decorative background stars. CSS2D labels in the R1 fonts; HUD (date, camera target, "Distances not to scale: log scale · sizes exaggerated") in JetBrains Mono. Default viewpoint chosen from the data: no target star within 57° of the line of sight, Pluto and Makemake more than 85° away from it. |
| Interaction | `js/space3d.js`, `js/space-ui.js`, `js/main.js`, `index.html` | OrbitControls (drag, pinch, wheel; damping off under reduced motion); clicking Pluto, Makemake or a star (or its label), choosing a target in the rail, a Home shortcut, the search or the tour flies the camera there (1.4 s, ease in-out; instant under reduced motion) and then opens the existing investigation panel. Stars are approached from behind the Sun. "Reset view", "Top view", "2D view"/"3D view" (the choice is remembered, best effort). On phones the scene sits in the page column; a vertical swipe scrolls the page, a sideways drag turns the scene. The canvas and its labels are `aria-hidden`; the Targets list stays the accessible path. |
| Loading and fallbacks | `js/space-ui.js` | three.js and the scene are fetched only when Home is on screen, after the page's own work, in an idle callback; the 2D map is shown until the 3D scene exists. 2D instead when: no WebGL (or the context fails), `deviceMemory` < 2 GB, a software renderer (SwiftShader, llvmpipe), frames slower than 60 ms during the opening move, `prefers-reduced-motion` (with "3D view" offered), embed mode, or a script error. A note under the colour key says which. Pixel ratio capped at 2; frames are drawn only while the camera moves (controls, damping, flights). |
| See: display colours | `js/plate.js`, `js/stack.js`, `js/main.js`, `js/targets.js`, `index.html`, `css/style.css` | "All bands" is now painted in display colours (D5–D6 red, D3–D4 green, D1–D2 blue, each with its own stretch) when the date has frames in all three groups; a badge on the plate says "Display colours, not for measurement", the caption lists the three ranges, and **Grayscale** sits on the time bar (one click). Dates missing a group, AllWISE context frames, single arrays and Difference stay grey; the caption says why. Preview targets (Pluto, Makemake, 3I/ATLAS) use Session A's per-visit composites (contract V10, `composites_path`, asked for in this task and published in `d66b6f3`): a step whose epoch is listed in a visit's `epoch_ids` shows that visit's display colours, with the badge and a caption saying the colours use their own stretch per visit; steps outside those visits (Pluto's fixed-field pair) stay grey. The old caption said "in false colour" while the composite was painted grey; now it says what is shown. Measurements never used these pixels and still don't. |
| About | `js/pages.js`, `js/i18n.js` | three.js 0.187.0 (MIT) under Software, JPL's approximate planetary elements (Standish) under Data. |

**Added JavaScript (gzip -9)**: three.js bundle 141.7 kB + `space3d.js` 7.2 kB + `orbits.js` 4.0 kB, all loaded lazily; `space-ui.js` 2.5 kB loads with the page. Total **155.4 kB**, under the 300 kB aim.

**Checks**

| Check | Result |
|---|---|
| `node --test tests/` (after rebasing on Session A's A7 `41e8a16`, strings re-copied: 148 keys) | **152 passed, 0 failed**. New `tests/orbits.test.mjs`: Kepler solver; planet positions against JPL Horizons (DE441, jup365, ura184, nep098 vectors at JD 2461358.5 TDB) within 3× JPL's nominal error (actual: Mercury 21.9″, Mars 12.4″, Jupiter 86.9″, Saturn 265.4″, Uranus 0.1″, Neptune 31.5″; distances within 0.006 au); the Earth–Moon barycentre against the Earth position in `scene3d.json`; Julian dates; orbit lines through the planets; log scale; ICRS → ecliptic; Kuiper Belt bounds and repeatability; Planet Nine only as a range from the file; display colours only with all three groups; the 2D fallback rules. |
| Browser, in-app pane (1024 px) and phone width (390 px) | 3D loads after the page; flight from the rail to Pluto, then the investigation; Escape back to Home keeps the camera; Reset/Top; 2D ↔ 3D toggle remembered; display colours ↔ Grayscale with the caption and badge following; no console errors. |
| `node docs/screens/capture.mjs http://localhost:8766 docs/screens` | **175 captures**: every page state at 360/390/768/1280 plus the 3D Home (default, top view, after picking Pluto) at all four widths. Measured viewport = requested; no horizontal scroll; no control under 44 px; every page ready; the only console errors are 404s for trial files that do not exist (`verification.json` of unverified trials, a fixture's missing receipt). The capture forces reduced motion, so the other Home shots show the 2D map, its "3D view" button and the reduced-motion note. Chrome now gets `--enable-unsafe-swiftshader` so the 3D shots render headless |
| Lighthouse 12.8.2 mobile | Home **66** (was 86): FCP 1.9 s, LCP 4.3 s, TBT 750 ms, CLS 0; this is the cost of three.js on Home. Predictions 91, Beat the physics 91, Learn 90 (unchanged, CLS 0); accessibility 100 on all four. With software WebGL forced (SwiftShader) Home scores 45 (TBT 9.5 s): creating a software context alone took 2.8 s at 4× CPU throttle, which is why software renderers now get the 2D map. An earlier WebGL test-context probe cost 2.5 s there and was removed. |
| Video | `docs/screens/3d/flight-to-pluto-1280x720.mp4` (4.2 s, 30 fps, headless Chrome with a stepped clock, so it is smooth on any machine) and a still `flight-to-pluto-arriving-1280x720.png`; `docs/screens/3d/flight.mjs` re-records it. |

Screenshots: `docs/screens/home-3d*.png` (default, top view, after picking Pluto, four widths). The other captures run with reduced motion forced, so they show the 2D map with the "3D view" button and its note.

**Asked of Session A, and delivered (`d66b6f3`, contract V10)**

- Per-visit composite previews for Pluto, Makemake and 3I/ATLAS (now read, see above).
- `index.json` `prediction.status` after A5: Barnard and Epsilon Indi B now `hit`, Pluto `miss`, so the chips no longer say "waiting". No web change needed.
- `strings.en.json` re-copied (148 keys after A7).

A7 (Pluto open forecasts v2, hindcast) arrived during this task: the Predictions page lists the two new open forecasts next to the v1 one without errors (the index leaves out the abandoned trials). Their `revises` link, the along/cross-track sizes and the hindcast are not shown yet.

**Limits**

- A picture, not an ephemeris: planet positions err by up to ~4.5′ (Saturn) against Horizons, distances are logarithmic, sizes exaggerated. The Planet Nine rings lie in the ecliptic plane only to show distance ranges; the papers' inclinations (11–30° across the estimates) are not drawn.
- Pluto and Makemake are drawn at the scene file's date (14 Nov 2026), the planets at today's date.
- Not checked on a real phone or a real GPU-less device; the slow-device rule is a frame-time threshold, not a benchmark.
- MERGED-PLAN §8 listed elaborate 3D navigation as deferred; this task was requested explicitly.

**Next action (proposed)**: record the final video take from `flight.mjs` once the data are frozen; check the 3D view on a real phone.

### Task R3, 15 Nov 2026 (Pluto's story in 3D, "Why we missed", released regions, Home performance; rebased on Session A's H2 `623cceb`)

| Part | Files | Result |
|---|---|---|
| Why Pluto loops | `js/loop.js` (pure), `js/loop3d.js`, `js/loop-ui.js`, `index.html` (`?page=loop`), `js/route.js`, `css/style.css` | A page with a 3D scene from `scene3d.json` `pluto_loop` and `our_orbit`: the Sun; SPHEREx's orbit (Earth from JPL's approximate elements, within 0.00007 au of the FITS-header positions) drawn **8×** larger than it is; markers at the 50 training (blue) and 20 evaluation (orange) exposure positions; Pluto's path from TENGER's frozen orbit (two-body propagation of `our_orbit`, within 0.0002 au of every `fitted_pluto_au`) and the fitted positions; each exposure's sight line from the drawn telescope through Pluto's real position to a sky sphere, where the sight lines trace the apparent loop (bright up to the slider date); the 2026 check point; the 2027 forecast tracks, v1 from `scene3d.json` and both v2 from their `prediction.json` (RA/Dec + geocentric distance). Time slider (with the date), **View from SPHEREx** (camera at the telescope, looking along its sight line, narrow field), **Top view**, **Reset view**, **2D view**. The label says "Distances not to scale: SPHEREx's orbit is drawn 8 times larger…, so the loop looks about 8 times bigger. Pluto's real yearly shift is about 1.6°" (from the data). Pluto is near the ecliptic (−4°), so its loop is flat: in 3D it reads as a back-and-forth swing. Below it, always, a **true-scale chart** of the apparent path (RA/Dec, east left) with the measured positions, the 2027 tracks and the slider date, and an **arcsecond inset** of the 2026 check (frozen 95% region 6.04″ × 2.49″ at PA 78° and the observation 5.9″ away, from `postmortem.json`). The chart is the 2D fallback (no WebGL, software renderer, reduced motion without opting in, embed). Linked from the Pluto investigation header, the Pluto trial and forecast cards on Predictions, and Lesson 1. |
| Why we missed | `js/postmortem.js` (pure), `js/postmortem-ui.js`, `js/ledger-ui.js`, `js/reveal.js` | A folded section on the Pluto trial card and an open one at the end of the Pluto reveal, chip "Exploratory, after the reveal", every number from `postmortem.json`: we found Pluto 0.35″ from JPL; the forecast was 6.2″ from JPL (5.9″ from our measurement), mostly along the track (5.7″ along, 1.6″ across: about 5.5 hours of Pluto's motion); main cause, too-confident uncertainty (the training detections fell into only 6 groups; shared errors of 0.1/0.2/0.4″ per group would give D² 3.46/1.65/0.45; the training-only jackknife gives 22.6″ × 13.0″, D² 0.70); second cause, the frame (5.76″ → 5.13″ barycentric; 5.14″ N-body); what we changed (the v2 method's name from `hindcast-v2.json`). Then the **exploratory hindcast** (old v1 vs new v2 on the same 2026 check: 5.90″ / 6.04″ × 2.49″ / D² 6.77 / miss, against 5.27″ / 21.2″ × 15.6″ / D² 0.40 / "would have been a hit (not a test)") and the **v1 and v2 open forecasts side by side** (v1 54.1″ × 1.06″ ellipse axes; v2 April 26.4″ × 8.9″ and Sept/Oct 15.2″ × 11.5″ along × across). Files that are not exploratory, or that claim to count, are refused. The v2 forecast cards show Session A's "made after the 2026 miss" label. Session A could not add the number of training exposures (50) to `postmortem.json` without breaking the code hash of the frozen v2 forecasts, so the text says "fell into only 6 groups" and switches to the count automatically if a later file states it. |
| Lesson 3 | `js/learn-ui.js`, `js/main.js` | A second worked example, "why the Pluto forecast was too sure of itself": independent errors average as 1/√N, errors shared within G groups only as 1/√G; the frozen region, the miss (D² 6.77), the jackknife region and its D² from `postmortem.json`; labelled exploratory. Prints with the lesson. |
| Released regions | `js/reserved.js`, `js/pages.js`, `index.html` | `reserved.json` V10: a region is lifted only by `status: "released"` **with** a `release_reason_key`; no status, another status, or a release without a reason keeps it reserved (fail closed, tested). Pluto (verified) and Makemake (nothing to verify) no longer block live loading; 3I/ATLAS still does. About lists every region with "Released: live loading allowed" or "Reserved: live loading paused" and the reason text; if the file cannot be read, it says the built-in list is in force. |
| View toggle fix | `js/space-ui.js` | With the delayed start, the Home button said "2D view" while the 2D map was still showing (the 3D view chosen but not started), and clicking it switched 3D off and saved "2D". It now names the view that is not on screen, and "3D view" starts 3D at once; the idle start and a click cannot create two scenes. Found because the 3D screenshots failed. |
| Offline sky tiles | `tests/release.test.mjs` | Already true, now tested: `data/sky` appears only in `sky.js`, which tries IRSA's survey first; `createSky` is called once, from `openSkyContext`, which runs only when the Real sky panel opens. Home loads none of these tiles. |
| Home performance | `js/space-ui.js` | three.js now starts on the visitor's first interaction (pointer move or press, touch, wheel, key) or, failing that, once the page has loaded and then stayed idle for 4 s (`requestIdleCallback`). The 2D map is the page until then. Lighthouse mobile, Home: **85** (FCP 1.9 s, LCP 4.1 s, TBT 0 ms, CLS 0), up from 66. In Lighthouse's run three.js was not fetched at all: its measuring window closes before the 4 s idle start, so the score does not include the 3D start-up. That cost now comes after the page is usable: under 0.25 s of main-thread time in a 4×-throttled CPU profile with hardware WebGL. |

**Checks**

| Check | Result |
|---|---|
| `node --test tests/` | **165 passed, 0 failed**. New: `tests/loop.test.mjs` (orbit propagation vs `fitted_pluto_au` and `position_now`; directions from the data vectors vs measured RA/Dec within 3″; telescope position vs FITS-header positions; sight lines through Pluto onto the sphere; drawn loop wider than the true one by roughly the exaggeration; the loop model's exposures, check and v1/v2 tracks, v2 points rebuilt from RA/Dec + distance), `tests/postmortem.test.mjs` (every number from the files; refusals; hindcast; 95% axes from covariance eigenvalues; v1/v2 rows; 1/√G), release-region and offline-tile tests. |
| `node docs/screens/capture.mjs http://localhost:8766 docs/screens` | **213 captures** (every page state at 360/390/768/1280, the new states, and 1280×720 for the loop page, Why we missed and the Pluto reveal's end): measured viewport = requested, no horizontal scroll, no control under 44 px, every page ready, no console errors other than 404s for trial files that do not exist. The 3D shots first failed: see the toggle fix above |
| Lighthouse 12.8.2 mobile | Home **86** (FCP 1.2 s, LCP 4.2 s, TBT 0 ms, CLS 0; three.js not fetched in its window, see above), Predictions 90, Beat the physics 90, Learn 89; accessibility 100 and CLS 0 on all four; best practices 96 on Predictions (the expected 404s) |
| In-app browser | Loop page: 3D scene, slider, View from SPHEREx (the loop face-on as a flat swing), Top/Reset, the true-scale chart and inset; Why we missed on the Pluto card and at the end of the reveal; Lesson 3's example; About's reserved list; no console errors. |

Screenshots: `docs/screens/loop*.png` (2D at four widths; 3D default, from SPHEREx and top view, incl. 1280×720 for recording), `predictions-why-*.png`, `reveal-pluto-why-*.png`, `learn-lesson-sure-pluto-*.png`, `learn-lesson-distance-loop-*.png`, `about-reserved-*.png`.

**Limits**

- The 3D loop is exaggerated 8× by design (labelled); the arcsecond-level comparison is in the inset and in "Why we missed", not in the 3D.
- The 3D draws Pluto from our two-body orbit for any date (light time ignored for drawing) and the telescope as the Earth–Moon barycentre.
- Not checked on a real phone or a real GPU-less device.

`python -m scripts.validate_release` (Session A's validator) on this tree: 77 contract files checked, 0 failures.

### B5 part 0, 15 Nov 2026: public address (site live at https://nama2323.github.io/tenger/)

- `og:url` and `og:image` are now absolute (`https://nama2323.github.io/tenger/`, `…/og.png`); a test checks both. The live
  page and `og.png` answer 200.
- Receipt links checked on the public repository: all 11 receipts open `github.com/Nama2323/tenger/commit/<full sha>` with
  HTTP 200, and each SHA is the matching "predict: freeze …" commit (the two v2 Pluto open forecasts share `fd758e5`).
- `node --test tests/`: 165 passed.

### Task B5, 15 Nov 2026 ("Could SPHEREx see Planet X? We measured it" and "Find the hidden planet")

Shapes agreed with Session A before either file existed (to become DATA-CONTRACT V12): artificial content lives
only under `static/data/planetx/`; kinds `tenger.planetx_depth/1` and `tenger.hidden_planet/1`, both with top-level
`artificial: true` and `counts: false`. Until Session A publishes them, the page reads labelled examples from
`static/dev-fixtures/planetx/` (made by `dev-fixtures/tools/make-planetx.mjs`: invented curves, synthetic frames,
every file `"example": true`) and switches to the real files automatically, file by file.

| Part | Files | Result |
|---|---|---|
| Measured panel (Planet X Lab) | `js/planetx.js` (pure), `js/planetx-ui.js`, `js/learn-ui.js` | Under "Could SPHEREx see it?": per band (published band, SPHEREx array, μm range) the pooled recovery-fraction curve with its 95% interval band (from the file, else Wilson from the counts), dashed 50% and 90% levels and the depth lines with values (the file's depths and intervals; missing ones interpolated from the curve), published Planet Nine predictions drawn only where the file gives a same-band AB value (others listed, not drawn), the WISE limit, the overall verdict text (`verdict_key`) and per-band gaps, the mission-sensitivity statement. Beside it, the assumptions in plain words (injections per point, single exposures, the detection rule from `method`, the interval, what depth means, the same-band rule, plus the file's `assumption_keys`); under it a data table per band (magnitude, added, found, fraction, interval) and per field (exposures, depths, false detections in blanks). `stacked_projection` is never read. Chip "Measured by TENGER" for the real file, "Example data, not an observation" plus a note for the example. |
| Find the hidden planet | `js/planetx-ui.js`, `index.html` (`#hidden-round` on Beat the physics) | Optional round under the regular ones: the two frames of a pair blink (or Frame A / Frame B; no autoplay under reduced motion), the label "Artificial planet added for this game" on the picture and in the chips before and after the reveal. Tap (or arrow keys, Shift ×5, Enter) to guess; "Check my guess" reveals where the planet was put in both frames, the pipeline's positions, the distance in pixels and arcseconds, inside or outside the tolerance circle, whether the pipeline found it (with its lowest S/N) and "not a detection, never counted outside this game". The reader refuses a file without `artificial: true` and `counts: false`, frames outside `planetx/`, frames marked anything but artificial, or a pair without injected positions in both frames. The example round's text says its frames are synthetic (not "real SPHEREx pictures"). |
| Links | `index.html`, `js/learn-ui.js` | "Could SPHEREx see Planet X? We measured it" on Home (search card) and Predictions (page head), and one line in Lesson 2, all to `?page=learn&lesson=lab#measured` (scrolls to the panel). |
| Public address (part 0, `023d604`) | `index.html` | Absolute `og:url`/`og:image`; receipt links checked (see the B5 part 0 note above). |

**Checks**

| Check | Result |
|---|---|
| `node --test tests/` | **172 passed, 0 failed**. New `tests/planetx.test.mjs`: Wilson intervals against known values; 50%/90% depth interpolation; magnitude ranges; the V12 depth reader (pooled curves, depth intervals, interpolated missing depths, same-band models only, WISE limit, projections never read, refusals); the example files labelled; hidden-planet refusals (no `artificial`, `counts` not false, frames outside `planetx/`, a frame marked otherwise, one frame, one injected position); tap distances in pixels and arcseconds; every label in English. The fixture test knows the two new kinds |
| `node docs/screens/capture.mjs http://localhost:8766 docs/screens` | **229 captures** incl. `learn-lab-measured`, `learn-lesson-brightness-planetx`, `game-hidden`, `game-hidden-revealed` at 360/390/768/1280: measured viewport = requested, no horizontal scroll, no control under 44 px, every page ready, no console errors other than 404s for files not published yet |
| In-app browser | Lab panel with the example data (chart, interval band, depth lines, markers, assumptions, table); hidden-planet round: blink, tap, reveal with both injected positions, the pipeline's positions, distance and verdict; labels before and after; no console errors besides the expected 404s for the unpublished real files. |

**Waiting on Session A**: `static/data/planetx/depth.json`, `hidden-planet.json` and frames (target before 10:00 UB),
plus the strings for their `verdict_key`, `note_key`, `assumption_keys`, `statement_key` and `rule_key`. Nothing in
the page has to change when they land; I will check the real files in the browser then.

**Loading**: the Planet X files are fetched only when Learn or Beat the physics opens (Home and Predictions load just the two small modules), so the 404s for the unpublished real files never appear on other pages. Lighthouse mobile after B5: Home 85, Predictions 90 (best practices 100 on Home).

**Limits**: the gap line in the panel does not say which depth the gap is measured from (the file's verdict text
should); per-field curves are shown as tables, not charts; not checked on a real phone.

### Task B6, 15 Nov 2026 (asteroid batch: calibration on Predictions and in Lesson 3)

**State of A9**: Session A has no A9 task, so there is no real asteroid batch, no agreed schema and no decision on
whether a batch counts on the scoreboard. Session A said those are the user's decisions. B6 is built against an
**invented, labelled example** and the shape Session B proposed (below); it switches to a real batch on its own once
`index.json` lists one in `batch_paths[]`.

**Proposed shape (not in DATA-CONTRACT yet)**: each asteroid is a normal trial (`trials/<id>/{trial,prediction,
receipt,verification}.json`, trial with `target_name` and `batch_id`); one summary per batch,
`batches/<id>.json`, schema `tenger.batch/1`, with `team_statement_pending`, `trial_ids[]`, `calibration {n, k_inside,
level, interval, interval_method, expected_inside, independence_note_key}`, `rows[] {trial_id, name, d, d2, inside,
model_error_arcsec, baseline_error_arcsec, status, excluded_reason_key}` and `note_keys[]`.

**Never a test scoreboard on the public page**: the invented example is read only in `?fixtures=1` mode. Without a
real batch the Predictions page and Lesson 3 show nothing about it and request no fixture file (checked in the
browser). A batch file under `static/data/` that says `"example": true` is refused.

| Part | Files | Result |
|---|---|---|
| Batch reader and maths | `js/batch.js` (pure) | `readBatch` (counts and interval from the file when it has them; otherwise counted from the rows with excluded rows left out, exact interval computed and flagged), exact Clopper–Pearson interval, `coverageVerdict` (95% inside / above / below the interval), `chartRows`, `baselineWins` (ties count for neither), `whatIfRows` (same share, 4× and 16× the tries). |
| Predictions: "Asteroid batch" | `js/batch-ui.js`, `js/ledger-ui.js`, `index.html` (`#ledger-batch-host` after the scoreboard), `css/style.css` | Chips (category, example, **Team statement pending** while the file says so) and a note. Summary at the top: "k of N landed inside our 95% regions", the interval with its method, whether 95% lies inside it, the expected count, why a small N is wide, the independence assumption. A dot chart of each asteroid's D against the dashed 2.45 line (inside/outside colours, data table). A scatter of model error against straight-line error with the diagonal and the count each way. One card per asteroid: small sky plot (forecast, 95% test region from forecast plus measurement covariance, observed cross; north up, east left), forecast RA/Dec and date, region half-axes, observed offset and D, straight-line error, verdict chip, and the freeze commit link (none for an example or zero receipt). Batch trials are not shown again as single cards. |
| Lesson 3 worked example | `js/batch-ui.js` (`lessonBatchSection`), `js/learn-ui.js` (`setBatch`), `js/main.js` (`ensureBatch`, loaded when Predictions or Learn opens) | "Did our 95% regions hold 95% of the time?": k of N and the share, what k of N means (expected count, chance), why a small N is not proof (the exact interval and its width), a what-if table with the same share at 4× and 16× the tries (labelled computed, not measured), the independence caveat and the source file. Every number from the batch file except the labelled what-if rows. |
| Example fixture | `dev-fixtures/tools/make-batch.mjs` → `dev-fixtures/batches/asteroids-example.json`, `dev-fixtures/trials/asteroid-NN-example/` | 12 invented asteroids, all `"example": true`, zero commit SHA, hash chain trial → prediction → receipt/verification, residuals built so each D² = rᵀS⁻¹r exactly (10 of 12 inside; the straight line wins 3). |
| B5 follow-up (Session A's answer) | `js/planetx.js`, `js/i18n.js` | The gap line now says it is the prediction minus our pooled 50% single-exposure depth (positive = fainter than one exposure reaches); `limitation_keys` are read alongside `assumption_keys`. |

**Checks**

| Check | Result |
|---|---|
| `node --test tests/` | **180 passed, 0 failed**. New `tests/batch.test.mjs`: the 2.4477 limit; Clopper–Pearson against known values; intervals narrowing with N; coverage verdicts; the reader from file vs counted (excluded rows, D-only rows, ties, refusals); the example consistent with its own trial files (D² from residual and region, verdicts, batch ids); the loader never returns the example on the public page, switches to a listed real batch and refuses a real-path batch marked as an example; every label in English. Contract fixture test knows `batches/` (kind `batch`); `planetx.test.mjs` checks `limitation_keys`. |
| `node docs/screens/capture.mjs http://localhost:8766 docs/screens` (B6 pages, merged into the full report) | `predictions-batch`, `predictions-batch-charts`, `predictions-batch-cards`, `learn-lesson-sure-batch` at 360/390/768/1280, plus `predictions` and `learn-lesson-sure` again: measured viewport = requested, no horizontal scroll, no control under 44 px; report now 245 entries, none wide. Console errors only 404s for fixture trials without verification files and the unpublished Planet X files. |
| In-app browser | `?page=predictions&fixtures=1`: section, summary, both charts, 12 cards; `?page=learn&lesson=sure&fixtures=1`: worked example and what-if table. Public `?page=predictions` and `?page=learn&lesson=sure`: no batch section and no batch or fixture requests. |

**Needs the user**: give Session A the A9 task (or drop it). Decide whether a batch counts on the main scoreboard and
whether one freeze commit covers all its trials; the page does not depend on either answer.

**Limits**: the shape is Session B's proposal until it is in DATA-CONTRACT; with only the example, nothing about the
batch is visible on the public site; not checked on a real phone.

### Fixes after B6, 15 Nov 2026 (Planet X band arrays and pixel scale; Session A's real A8 files checked)

| Fix | Files | Result |
|---|---|---|
| Example W1 on the wrong array | `dev-fixtures/tools/make-planetx.mjs`, `dev-fixtures/planetx/depth.json` | W1 (3.35 µm) moved from D3 (1.63–2.41 µm) to **D4 (2.42–3.82 µm)**; example regenerated (only the W1 lines changed; the generator is seeded). |
| Band ↔ array check | `js/planetx.js` (`PUBLISHED_BAND_UM`, `bandWavelengthCheck`, reusing `DETECTOR_RANGES` from `js/stack.js`), `js/planetx-ui.js` | Johnson I 0.80 µm, W1 3.35 µm, W2 4.60 µm must lie inside the array the file names, and the file's own wavelengths inside that array. The panel shows a warning on any band that fails. Test runs on the example **and on Session A's real `depth.json`**: i → D1 (0.75–0.87 µm used), w1 → D4 (3.25–3.55), w2 → D6 (4.45–4.75), nominal wavelengths within 0.1 µm. |
| Pixel scale of the hidden-planet frames | `js/planetx.js` (`tapReport`, `NATIVE_PIXEL_ARCSEC`), `js/planetx-ui.js`, `js/i18n.js` | The scale is still read per frame from the file. Session A's real frames say **3″ per picture pixel**: they were resampled from ~6.15″ detector pixels when aligned. Checked independently: in all four pairs, the injected positions' pixel distance × 3″ matches their RA/Dec separation to 0.2%; the 2.05-px tolerance = 6.15″ = one detector pixel. The reveal now writes the sum out ("12.4 pixels × 3″ = 37.2″", circle "2.05 pixels (6.15″)") and adds one line saying the frames were resampled. Tests: shown arcsec = shown px × that frame's `pixel_arcsec` for every pair in the example and the real file; the real scale agrees with the sky positions. |
| Real A8 files in the browser | `js/planetx.js`, `js/planetx-ui.js`, `js/i18n.js`, `css/style.css` | Found and fixed with the real data: the headline sentence's numbers were blank ("AB , and :"); it is now filled from `verdict_summary.values`. The 18 verdicts were 18 repeated paragraphs with "± 0.0"; they are now one sentence ("18 of 18 … closest Linder & Mordasini 280 AU in Johnson I: 0.36 ± 0.04 mag, factor 1.4") and a table (prediction, band, predicted AB, our 50% depth, gap ± σ to 0.01 mag, flux factor; WISE limit row named). Chart markers carried the same long reference and overlapped; they are now numbered, with a key under each chart (scenario and AB). "Each point: —" now counts injections from the curves (479–485). `limitation_keys` shown. |
| Strings | `js/i18n.js` | Session A's `strings.en.json` re-copied (V12: 168 keys not already defined here). |

**Checks**: `node --test tests/` **185 passed, 0 failed**. Captures `learn-lab-measured`, new `learn-lab-measured-w1`, `game-hidden`, `game-hidden-revealed`, `learn-lesson-brightness-planetx` at 360/390/768/1280 with the real files: report 249 entries, no horizontal scroll, no control under 44 px, every page ready, no console errors other than 404s. Session A's validator: 79 contract files, 0 failures.

### Task B7 part 0, 15 Nov 2026 (Beat the physics: answer leak fixed)

**The leak**: every round file measures positions from "the frozen model at the reveal time", and the page drew
them in that frame, so before the reveal the chart's 0,0 (where the zero gridlines cross), the typed offsets and the
training table were all measured from the model's answer. Tapping the crossing tied the model every time.

**Fix** (`js/game.js`, `js/game-ui.js`, `js/i18n.js`; data files unchanged): before the reveal everything on screen
is an offset from the **last training measurement** (axes, typed offsets, status line and training table say so).
The view comes only from the training points plus, around the last measurement, their own least-squares speed ×
the days to the target in every direction (`guessView`); after the reveal it may widen to show everything
(`revealView`). Guesses are stored and scored in the file's frame, so scores are unchanged. Scalar rounds were
not affected (their axis is the measured value).

**Checks**: `node --test tests/` 187 passed. New tests on every real and example position round: the pre-reveal
state is identical when the model, baseline and actual are moved anywhere; no coordinate shown equals any of them
(as offsets from the last measurement); the screen's 0,0 is the last measurement, not the model; the view holds the
training points and speed × days in every direction; it only widens after the reveal and then shows all three;
a typed offset at the actual's offset scores as the actual. In the browser (real Barnard, ε Indi B, Pluto rounds):
the zero gridlines cross on the last dot, typing 0, 0 puts the guess there, the axis labels fit.

### Task B7, 15 Nov 2026 (Beat the physics: help players predict)

Part 0 (the answer leak) was published on its own as `a422795`, see above. User decisions recorded for B6: the
invented batch stays behind `?fixtures=1`; when Session A's real batch lands it is its own block on Predictions and
is **not** added to the main hit/miss headline (B6 already shows it only as its own section).

| Part | Files | Result |
|---|---|---|
| How to predict | `js/game-help.js` (`howToBox`), `js/game-ui.js` | A box above the chart, open on the first visit, then remembered closed (best-effort storage; open every time if storage is blocked). Text per round type (`game.js roundType`): stars (Barnard's Star, ε Indi B): straight drift plus the yearly loop, four steps (direction, speed between dated dots, extend to the target date, allow for the bend); Pluto (and Makemake): moves along its orbit, Earth's motion makes it loop backwards once a year, link "Why Pluto loops"; brightness rounds: rising/fading, rate, turning. |
| Dates | `js/game.js` (`dateClusters`), `js/game-help.js` (`timelineStrip`, `clusterDate`) | Every group of dots (one SPHEREx visit, dots ≤ 30 days apart) is labelled on the chart with its dates ("2025-08-21 – 08-27"). Under the chart a time line: one mark per visit at its start date, the target date, the stretch from the last measurement to the target, and "The target date is N days after the last measurement (date)". Positions follow the days; dates alternate rows so close visits never touch. |
| Hints | `js/game.js` (`trainingMotion`, `hintDirection`, `hintRuler`), `js/game-help.js` (`hintBody`, `hintOverlay`), `js/game-ui.js` | Optional, one at a time, position rounds only, all from the training points on screen: 1 "Which way?" arrow along the least-squares direction of motion with the compass word; 2 "How far?" dashed ruler from the last measurement with a tick every 30 days to the target date, the speed per day and the distance, "a straight-line extrapolation: it ignores the bend"; 3 "Why the path bends" one sentence for the round type and a small labelled sketch of the yearly loop. The results table says "You (with N hints)"; the score formula is unchanged. Hints lock with the guess. |
| After the reveal | `js/game.js` (`resultExplanation`), `js/game-help.js` (`explainResult`) | One line with the errors from the round file's `outcome` block (positions as fallback): e.g. Pluto "The straight line missed by 19,870″ (5.5°) because it ignores the loop that Earth's motion adds every year; the physics model, which follows both Earth and Pluto, missed by 5.9″. That was outside the model's own 95% region, so the trial counts as a miss." When the straight line was closer it says so ("Physics is allowed to lose"). |

**Checks**

| Check | Result |
|---|---|
| `node --test tests/` | **191 passed, 0 failed**. The leak test now also covers the date groups, the hint direction and the ruler (the pre-reveal state does not change when the answers move; no shown coordinate equals them). New: round types; one date group per visit on the real rounds (2/3/2); date labels; hint direction is a unit vector, ruler ticks every 30 days and its end at speed × days; compass words; angle text; the explanation uses the file's outcome numbers (Barnard 3.1073/1.5188″, Pluto 19869.7467/5.8991″ and "outside"), the example where the straight line wins says so; English strings for every round type. |
| `node docs/screens/capture.mjs http://localhost:8766 docs/screens` (game pages, merged) | New `game-howto`, `game-hints`, `game-timeline`, `game-pluto-hints`, `game-explained`, plus `game`, `game-example`, `game-example-revealed`, `game-rdra-revealed` again, at 360/390/768/1280: no horizontal scroll (the first time-line design overflowed at 768 and was redrawn), no control under 44 px, every page ready, no console errors. Report: 269 entries. |
| Keyboard (in-app browser, real ε Indi B round) | Tab to "How to predict", Enter opens it; Enter on the hint button shows hints 1 and 2 and keeps focus there; arrow keys on the chart move the guess from the last measurement (0.18″ steps), Enter locks it and moves focus to the next reveal step; the hint button is disabled after the lock. |

**Limits**: the yearly-loop sketch is a schematic, not the round's real loop; the hint direction uses all training
dots, so for Pluto (two visits) it is the line between the visits; not checked on a real phone.

### Task B8, 15 Nov 2026 night (release QA, credits, demo clips)

**Release QA in public mode** (no `?fixtures`; headless Chrome crawl of 52 URLs: every page, lesson, the Lab, the
loop, all 8 targets × 4 panels, viewer modes, a reveal, embed and a coordinate search; every visible button
clicked once on 11 main pages):

| Found | Fix | After |
|---|---|---|
| 8 failing requests (404, logged as console errors) for `verification.json` of trials that cannot have one yet | `js/contract.js` `verificationNotDue`: no request when `prediction_status` is `insufficient_data` or an open forecast is before its `check_after_utc` (contract V5); every other trial is read as before. Test with a request spy. | 0 failing requests, 0 console errors |
| "Full screen" threw an uncaught "Permissions check failed" when the browser refused (also real users in an embed without `allowfullscreen`) | `js/main.js`: the refusal shows a note | 0 button errors |
| Hidden-planet reveal said "moving —″" with Session A's real file (`motion_arcsec` is `{east, north, total}` in V12) | `js/planetx.js` reads the object or a number; test on the real file | "moving 46″" |
| Session A's V13 strings (`batch.*`, `train.*`) made the copy test fail on `tenger-dev` after `e93e9a5` (I pushed before re-running; now every push is gated on 0 failures) | Re-copied (179 keys); our own sentence renamed `batch.assumeIndependent` so Session A's `batch.independence` keeps its wording, and a real batch's note replaces ours instead of repeating it (`b8b0e67`) | 194 tests pass |

No request to `dev-fixtures` on any public page. Links: all 43 external links on the site resolve (200); all 11
"frozen in git" receipts open their commit (200), and each commit contains that trial's `prediction.json`
(GitHub API); every DOI redirects from doi.org to its record (A&A and IOP pages answer scripts with a bot check,
not a broken link); the 3 font licence files are served.

**Lighthouse mobile** (simulated throttling; `?page=learn&lesson=lab` for the Lab; two runs where they differed):

| Page | Performance | Accessibility | Best practices | SEO | LCP |
|---|---|---|---|---|---|
| Home | 81, 82 | 100 | 100 | 100 | 4.6 s (the first-visit tour text) |
| Predictions | 87 | 100 | 100 | 100 | 3.8 s |
| Beat the physics | 88 | 100 | 100 | 100 | 3.9 s |
| Learn | 87 | 100 | 100 | 100 | 3.9 s |
| Planet X Lab | 80, 82 | 100 | 100 | 100 | 4.9 s |

Home is above the ≥ 80 target from R3 but below B5's 85–86; not changed (fixes only).

**Credits** (`js/pages.js`, `index.html`, `js/i18n.js`): About adds IRSA MOST (A9: training exposures only;
evaluation rows cut to identifiers and times) and the A9 use of JPL Horizons (compared only after each verdict), and
a new list "Published values we compare with": Linder & Mordasini 2016, Fortney et al. 2016, Meisner et al. 2018,
Blanton & Roweis 2007, Cutri et al. 2012 (WISE Explanatory Supplement IV.4.h), SPHEREx Public-products, Crill et
al. 2025, and the five Planet Nine orbit papers drawn on the 3D Home, each with DOI/arXiv/URL links (all checked).
The IRSA SPHEREx acknowledgement is unchanged (test: word for word against the IRSA file). New test: every DOI in
the published data is linked on About.

**Demo clips** (`docs/screens/demo/`, recorder `record.mjs`, README): a Home 3D (5.7 s), b Predictions (6.1 s),
c Beat the physics ε Indi B with Hint 2 and the reveal (6.3 s), d Planet X Lab W1 (5.0 s), e Find the hidden planet
(6.0 s); all 1280×720 H.264 yuv420p 30 fps, 0.14–1.30 MB, public site, no fixture request, no page error.
(f) asteroid batch **skipped**: not published by Session A yet.

**Checks**: `node --test tests/` 194 passed, 0 failed. Captures of the touched pages at 360/390/768/1280 (65,
incl. new `about-refs`): no horizontal scroll, no control under 44 px, every page ready, **no console errors**;
report 273 entries. Session A's validator: 79 contract files, 0 failures.

### Planet X wording fix, 15 Nov 2026 morning (user's rule; plus a lesson regression found on the way)

**Planet X Lab** (`js/planetx.js`, `js/planetx-ui.js`, `js/i18n.js`, `css/style.css`). "18 of 18 published values
are fainter than one exposure reaches" overstated the closest case. Now every published value is read against the
same band's pooled curve in `planetx/depth.json`:

- `recoveredAt`: the fraction found at that magnitude. It is linear in magnitude between the two neighbouring
  tested points and labelled "interpolated", with both points' Wilson 95% intervals. Beyond the faintest test there
  is no value, only that point's upper bound.
- `reachOf`: under 5% found = "Too faint for one exposure". At least 5% and fainter than our 50% depth =
  "Below our 50% depth; found in about N% of single exposures". At or brighter than the 50% depth = within reach.
- On Session A's file: Linder & Mordasini at 280 AU (AB 17.45, Johnson I) = 0.415 + 0.8 × (0.250 − 0.415) =
  **28%**, between AB 17.25 (41.5%, 37.2–46.0%) and 17.50 (25.0%, 21.3–29.0%). The other 17 values are 0% or
  beyond the curve (upper bound 0.8%).
- The gap table gains "Found in one exposure" and "What it means" columns. The gap column reads "± our error",
  with a note: the ± is our measurement error only, and the planet's predicted brightness is uncertain by far more
  (mass, albedo, distance).
- Headline (`planetx.headline`, using the file's `verdict_summary.values`): "Only the closest published case comes
  within reach, and one exposure would catch it about 1 time in 4." It falls back to the file's own sentence if the
  values are missing or the nominal planet is not under 5% in every band.
- Session A told the rule, the suggested keys (`planetx.verdict.partial`, optional `recovered_fraction`) and the
  sentence. A test checks the file's verdict keys against the curve once A10 lands. Until then, the only mismatch
  allowed is "too faint" on a row between 5% and 50%.
- Layout fix: opening the 18-row table stretched the page to 1632 px at 360. Fixed with `minmax(0, 1fr)` columns
  on `.lesson`, `.lab-view` and the Planet X grids.

**Lesson regression (live since `3c7e7c1`, 02:36).** Re-copying Session A's V12 strings dropped 11 keys that the web
also defined: `lesson.distance.q1–q3`, `lesson.brightness.q1–q2`, and both lessons' `.title`, `.formula` and
`.teacher`. Session A's real exercises were therefore filled into the web's example templates and printed blanks
("With a baseline of , a star shifts by ."). Fixed:

- The web's own keys are renamed (`lesson.*.math` for the MathML, `lesson.*.synthetic.q*` and
  `lesson.*.synthetic.teacher`), and Session A's 11 keys are copied back (190 keys).
- Record numbers go into Session A's sentences bare, to 4 significant figures. Before: "4.086182°° in 203.890759
  unit.d days". Now: "4.086° in 203.9 days".
- Answers use 4 significant figures and show the file's z ("0.064 mag (z = −1.142)").
- Units without text never print their key. New: `d`, `h`, `min`, `deg/d`, `expected hits`; `fraction` and
  `probability` print as plain numbers.
- New tests: the web may not redefine a Session A key with different text (only `planetx.title` is allowed, a
  heading without the full stop); every lesson record's prompt is filled from its own inputs, and every unit has
  English text.

**Demo clip (d)** re-recorded with the new headline (5.3 s, 1.03 MB).

**Checks**: `node --test tests/` 201 passed, 0 failed. Captures of every Learn page and the new `learn-lab-reach`
(the table open) at 360/390/768/1280: no horizontal scroll, no control under 44 px.

**After Session A's A10 follow-up (`f1d0cc4`)**: re-copied its strings (191 copied + 3 the web defines;
new `planetx.verdict.partial`). `depth.json` now carries `recovered_fraction` per verdict; the test that the
file's verdict keys agree with the curve is active and passes. The file's headline and the page's are identical
(new test).

### Asteroid batch, real file (A9 frozen: `61b3cb7`, `ffe833f`), 15 Nov 2026 morning

Session A's frozen batch is now listed in `index.json`. With the B6 code it would have read "0 of 0 landed inside …
consistent with 95%", sent 7 failing requests for verification files that cannot exist yet, and broken the card
layout. Fixed:

- `js/batch.js`: V13 row fields (`model_*`, `secondary_*`, `baseline_*`; the example's bare names still read). The
  secondary and straight-line calibration blocks are read separately. With nothing checked there is no interval
  and no coverage verdict.
- `js/batch-ui.js`: "8 asteroid forecasts frozen in git on 2026-11-14 21:54 UTC. None has been checked yet.",
  then "7 waiting for their check; 1 could not be forecast (insufficient data) and will not be counted." Once
  scored, the second model and the straight line each get their own "k of N" line, never added into the primary.
  Cards show "Waiting for its check" and "95% forecast region (measurement error added at the check)"; 286 Iclea
  shows "Insufficient data" with the file's reason. The file's independence and team-statement notes appear once.
- No failing requests: the ledger skips the trials the scoreboard's `asteroid_batch.rows` names, and the batch
  loader does not request `verification.json` for a row whose status is `waiting` (`contract.js`
  `trial(id, { waiting })`). New test with a request spy.
- Card layout: a card without a plot gives its facts the full width (it was one character per line at 1280).
- Once Session A lists a real batch, the invented example no longer shows in `?fixtures=1` mode either (the loader
  test now stubs an index without `batch_paths`).

Clip (f) not recorded yet: Session A is verifying the batch now, and a clip of 8 "waiting" cards would be stale
within the hour. It will be recorded once the calibration is in.

**Checks**: 206 tests pass. Captures `predictions-asteroids` and `predictions-asteroids-cards` at
360/390/768/1280: no console error, no failing request, no horizontal scroll. Session A's validator: 112 files,
0 failures.

### Live site check, 15 Nov 2026 morning (after the user updated `main` to `8fea8b9`)

- **Files.** All 157 text files on https://nama2323.github.io/tenger/ are byte-identical to `main`'s `static/`.
  All 1,277 binary files are served (200).
- **Crawl.** Every page, lesson, the Lab, the loop, 8 targets × 4 panels, viewer modes, embed and a coordinate
  search: 52 URLs, every button on 11 pages, run against the live site and against `main` served locally. Live:
  no failing request, no `dev-fixtures` request, no button error. The only console errors are on the coordinate
  search (below).
- **Same as local on every page changed tonight** (Predictions, Beat the physics, Learn and its lessons, the Lab,
  Find the hidden planet, About). The remaining text differences were timing (blink frame A or B, "Loading…" on the
  slower network, the 3D loop's speed fallback under load) or the single-threaded local test server dropping
  connections.
- **Live only, 1: coordinate search does not work.** `api.js` calls `https://spherex-blink.onrender.com`, whose
  CORS allows only `https://pythonhack000.github.io`. From `nama2323.github.io` the request is blocked and the
  viewer says "The images did not load. Check the connection and try again." Locally the uvicorn backend answers.
  Changing the Render service or `LIVE_SERVER` needs the user's decision (CLAUDE.md).
- **Live only, 2: a misleading label during the first load.** On a first visit the See panel says "Prepared frames
  (legacy, not yet re-validated)" while the ~6 MB `frames.bin.gz` downloads (about 2–13 s here), then switches to
  "Frames from the investigation (quality-gated DR1/QR3)". `framesKind()` reads the investigation file, which is
  fetched after the frames. Locally the load is too fast to see it. This predates tonight.
- **Not live yet:** the Planet X wording, the lesson fix and the real asteroid batch block (on `tenger-dev` at
  `082c98d`).

### SPHEREx Blink credit moved from the pages to README, 15 Nov 2026 (user's decision)

- **Removed from the site:** the footer line "Built on the team's earlier project SPHEREx Blink (MIT licence)."
  (every page) and the "Built on SPHEREx Blink" card on About (`index.html`, `js/pages.js` `BASE_PROJECT`, keys
  `footer.base`, `about.baseTitle`, `about.base`, `about.link.source`). The footer keeps the data credit line.
  The Team card now spans the About grid so no half-empty row is left. Session A's `credit.base-project` key is
  listed in `index.json` `credits_keys` but no page renders it. Data notes that say where legacy frames came from
  ("Prepared frames from the earlier SPHEREx Blink build") stay, because they describe data provenance.
- **README.md**, new section "What existed before Space Apps, and what we built":
  - TENGER started from SPHEREx Blink (MIT, notice kept in `LICENSE`); its viewer, plate renderer, stacking code
    and archive client are reused.
  - SPHEREx Blink's 43 commits of 6–9 Nov 2026 (pythonhack000, merges by sabr.sf, the frame-baking job).
  - No TENGER commit before 14 Nov 09:00 Ulaanbaatar time; the first is `58f993b`, 19:01. Author times are used,
    because rebased commits have later commit times.
  - A plain-words list of what was built, with commit references (every one checked to be on `tenger-dev`).
- **Untouched:** `LICENSE`, git history, `LIVE_SERVER` and the backend's CORS.
- **Test** (`tests/release.test.mjs`): no footer line or About card for the base project, the data credit is still
  in the footer, the README section is present, and `LICENSE` is MIT. The batch loader test now covers both the
  frozen state (no verification request) and Session A's checked batch (`9cf2bfd`; verification files read).
  Session A's strings re-copied (193 + 3; new `batch.exploratory-horizons`, `batch.outlier-flag`).
- **Checks:** 207 tests pass. Captures `home`, `about`, `about-refs` and the new `about-footer` at 360 and 1280:
  no horizontal scroll, no control under 44 px, no console error.

### Asteroid batch after Session A's check (`9cf2bfd`), and demo clip (f), 15 Nov 2026

Session A's verification: 345 Tercidina inside (D² 0.12); 4 ambiguous; 3 insufficient data. Calibration 1 of 1
(Clopper–Pearson 0.025–1.0). The page now shows:

- **Summary.**
  - "1 of 1 landed inside our 95% regions", then "Of all 8 asteroids: 1 inside its 95% region; 4 ambiguous (not
    counted); 3 insufficient data (not counted)".
  - Instead of "consistent with honest 95% regions" (an interval that covers almost everything says nothing), it
    says "With 1 scored … far too few to test".
  - The second frozen model (1 of 1) and the straight line (0 of 1) each get their own line.
  - Session A's OUTLIER-flag note explains why most objects were not scored.
- **Exploratory JPL comparison** (`exploratory_horizons_coverage`). It is read only when it says `exploratory: true,
  counts: false`, has its own "Exploratory" chip, and ends "This is not the calibration above" (7 of 7 inside for
  both models). Each card adds "JPL, after the verdict: 3.4″ from the forecast, inside the frozen region
  (exploratory, not counted)".
- **Cards.**
  - "Ambiguous" and "Insufficient data" chips, each with the file's reason.
  - Unscored cards say "95% forecast region" with a note that the measurement error is added at scoring (the long
    label had squeezed phone layouts).
  - The model-versus-straight-line chart leaves room for five-digit ticks (11,082″).
- **Lesson 3 corrections.**
  - It no longer says "We froze 1 asteroid forecasts" (frozen 8 ≠ scored 1).
  - It no longer says "with only 1 asteroids".
  - It no longer claims "1 of 1 … can only show they are not badly wrong"; it now says "says almost nothing about
    our regions yet: the true hit rate could still be anywhere from 3% to 100%".
- **Demo clip (f)** `docs/screens/demo/f-asteroid-batch.mp4`: 5.5 s, 0.82 MB, 1280×720 H.264 30 fps, public page, no
  error. The recorder now counts a page clip's first frame from the start of recording; a still page's first
  frame arrives late, which had cut the opening hold short.
- **Checks:** 208 tests pass (new: the scored-batch rules; a block that claims to count is refused). Captures
  `predictions-asteroids`, `predictions-asteroids-cards` and `learn-lesson-sure-batch` (now the public page) at
  360/390/768/1280: no console error, no failing request, no horizontal scroll.

### Base-code wording and live search on the public site, 15 Nov 2026 (user's decision; replaces the earlier SPHEREx Blink requests)

- **Website** (`static/`): no page, script, style or data file the site serves names SPHEREx Blink or pythonhack000.
  - The legacy-frame notes now say "made by the open-source code this site started from"; code comments use the
    same wording.
  - Session A removed `credit.base-project` from `strings.en.json` and `index.json`; the copy follows (192 + 3).
  - The astronomy "Blink" view keeps its name.
- **Wording outside the site:**
  - README.md: the "What existed before…" section now says "open-source code (MIT licence; see Licence below and
    `LICENSE`)".
  - README.md has exactly one credit line, in a new "Licence" section: "Parts of the code come from SPHEREx Blink
    (https://github.com/pythonhack000/spherex-blink, MIT licence); see LICENSE."
  - CLAUDE.md decisions 1 and 6, and docs/PROMPTS.md (5 phrases), no longer call the base code the team's or its
    author a teammate. docs/EXPOSURE.md was reworded by Session A.
  - Dated logs and audit records are unchanged; one dated correction line is at the top of this file.
  - `LICENSE` is byte-identical (a test pins its SHA-256); git history is untouched.
- **Live search** (`static/js/api.js`, `static/js/main.js`):
  - `LIVE_SERVER` / `API_BASE` are removed, and `liveAvailable()` is false on `*.github.io`. There every live call
    throws before any request.
  - A coordinate search, a name outside the prepared list, or a Gaia overlay with no prepared list shows: "Live
    search needs the TENGER server, which is not running on this public site; the prepared targets work."
  - Run locally, live calls go to the same origin as before. `backend/api.py` is unchanged.
- **Tests:**
  - `tests/live.test.mjs`: on github.io no live call fetches anything; locally the call goes to `/api/…` on the
    same origin; no served file names onrender.com.
  - `tests/release.test.mjs`: no served file names SPHEREx Blink or pythonhack000, while "Blink" stays; README
    has exactly the one credit line, in the Licence section; the LICENSE hash is unchanged.
  - 213 pass.
- **Browser check:**
  - `docs/screens/github-io-check.mjs` serves `static/` as `https://nama2323.github.io/tenger/` in headless
    Chrome, so the page really runs on a github.io host. At 360 and 1280: the coordinate search and the name
    search both show the note; Barnard's Star (prepared) loads its frames; About has no mention.
  - About 630 requests in all, every one to that origin: none to onrender.com, no `/api/` request, no console
    error. Screenshots `live-off-coords-*` and `live-off-name-*`.
  - Captures `home`, `about`, `about-footer` at 360/1280: no horizontal scroll.

### Live site after the user's update of `main` (`4efc3e0`), and B9: the 30-second video, 15 Nov 2026

- **Live check.**
  - Files: all 1,577 on https://nama2323.github.io/tenger/ match `main`. 296 text files are byte-identical; 1,281
    binaries return 200 at the exact size.
  - Crawl: 52 pages and states, every button on 11 pages. 19,383 requests, all to nama2323.github.io; none failed,
    none to onrender.com, `/api/` or `dev-fixtures`. No console error, and no page text names the base project.
  - In the browser: the Planet X headline ("about 1 time in 4"), the 28% line and the ± note; the lessons (Session
    A's exercises, 4 significant figures, z in the answer); the checked asteroid batch; the data-only footer; and the
    live-search note for both coordinate and name search.
- **B9 video** `docs/screens/demo/tenger-demo-30s.mp4`:
  - 30.000 s (900 frames), 3,062,603 bytes, 1280×720, H.264 High, yuv420p, 30 fps, no audio.
  - Captions are burned in from Chrome-rendered PNGs, since this ffmpeg has no text filters; there is a matching
    `.srt` and a contact sheet.
  - `make-video.mjs` records the deployed site shot by shot, and every caption number was checked against the data
    files (README in that folder).
  - Shot 2: AllWISE 2010 against SPHEREx 2026; the site has no 2MASS frames. Shot 6 adds "for the nominal Planet
    Nine".
- **Recording fix.** A headless Chrome left by a failed first run kept its port with a busy software GPU process.
  Later runs connected to it, and the viewer drew about 2 frames a second. The script now uses a fresh port, Chrome
  on the Mac's GPU (Metal), and always closes its Chrome.
