# TENGER final merged plan: See, Predict, Learn

Prepared 14 November 2026. This is the single implementation plan combining the existing-project audit/blueprint and the supplied 23-page v2 plan. It is a proposed implementation specification; writing this document did not change the application or produce new astronomical results.

## 1. Product and scope

**TENGER lets people see real changes in the infrared sky, test predictions against observations, and learn the mathematics behind the evidence.**

Suggested public pitch: “See the changing sky. Make a prediction. Check it against real NASA observations.” Do not claim that no other team offers these features. The v2 document's repository counts, competitor results and award forecasts were not independently verified in this merge.

The official foundation stays first: RA/Dec input, selectable field of view, all five challenge targets, and a reliable sequence of real SPHEREx observations with transparent metadata. Prediction, play and lessons extend that foundation.

Final product language: English and Mongolian, with English available by default for judging. The v2 English-only MVP is a possible emergency scope decision for the team, not an automatic cancellation of the earlier bilingual requirement.

Four destinations:

1. **Home / Investigate:** an illustrative log-distance map, a target-feed/list alternative, coordinate search and investigation panel.
2. **Beat the physics:** predict the next position or brightness, then compare your guess, a simple baseline, the model and the actual observation.
3. **Learn / Planet X Lab:** three printable lessons and an honest physical-assumptions calculator.
4. **About / Data Sources:** methods, references, limitations, credits, reused work, and accurate AI disclosure.

An investigation has See, What changed, Prediction, Evidence and optional Spectrum panels. Sky Explorer is a context layer, not a replacement for coordinate investigation.

## 2. Decisions resolving conflicts between the source plans

| Topic | Unified decision |
|---|---|
| Existing code versus a new Vite project | Preserve the supplied FastAPI/plain-JS/Canvas project. Extend `backend`, `scripts`, `static`, tests and deployment workflows incrementally. A new framework/build system is not required. |
| Core science versus novelty | Repair release handling, flags, wavelength comparison, provenance and measurement validity before publishing new predictions or redesigned result cards. |
| Static-only versus coordinate search | Static prepared investigations power the demo. Coordinates resolve to existing coverage locally; arbitrary uncovered positions use the existing optional, configured FastAPI service or a clear unavailable state. Do not imply all-sky live retrieval works on static hosting alone. |
| Map versus Sky Feed | Offer both through the same target index; map is visual context, feed/list is accessible and the fallback if map work threatens delivery. |
| Bilingual versus English-only | MN/EN remains a final requirement. English default does not imply English-only. Both lessons and dynamic scientific states need translation. |
| Prediction for every target | Each target has an explicit prediction status. Comet 3I/ATLAS is See-only in this release. Other targets are scored only when data and a defensible model permit it. |
| “Before looking” | Existing bundled/cached data and previously rendered results are not automatically blind. Label retrospective evaluation honestly; reserve genuinely unseen data for a prospective trial. |
| Eight targets versus eight predictions | Eight desired targets do not imply eight scored trials. With one See-only comet there are at most seven target-level forecasts, and possibly fewer eligible calibrated tests. Count actual trial IDs. |
| Competing code-reuse rules | Preserve and attribute the supplied existing MIT code; do not copy additional competitor code/text/assets. If the team chooses a strict zero-competitor-code policy, it must explicitly reconsider its existing base. Do not silently claim the inherited viewer was written from scratch. |
| Planet X brightness comparison | Do not compare V directly with a near-IR AB limit or present AB 18.4 as an established single-exposure limit. Adopt a validated band-specific model or state detectability is undetermined. |
| Model versus linear baseline | Show actual errors. The physics model is allowed to lose; never choose/rewrite examples after reveal merely to make it win. |
| Automatic publishing | Prepare and test reviewable changes. Push/deploy/tag only to the user's explicitly authorized repository and destination; no force-push or direct-to-main workflow assumed. |
| Parallel sessions | One sequential implementation session is the default. Separate worktrees/agents are optional only when the user explicitly requests coordination. |

## 3. Data and scientific foundation

Preserve the useful existing viewer, coordinate/WCS utilities, charts and tests. New science modules should be shared by static preparation and live jobs.

### Repair acquisition and storage

- Discover and select current DR1/QR3 wide/deep products using an understood release policy. Treat future schemas as requiring compatibility checks. Keep exact source filenames/URLs, observations, processing and calibration versions.
- Cache originals separately from derived products. Derived identity includes source hashes, configuration, calibration, mask policy, grid and pipeline version. Do not reuse old QR-only caches as corrected products.
- Retain IMAGE, VARIANCE, FLAGS, ZODI, WCS and appropriate PSF/spectral-calibration information. Preserve originals or reproducible immutable references and checksums.
- Decode historical `MP_` and current `MSKN`/`MSKM` flag definitions. Preserve individual reasons and reject unknown quality schemas explicitly. Display choices cannot override the measurement mask.
- Keep native-resolution science separate from small previews. The current 160-pixel cap makes a 0.5-degree field 11.25 arcsec/pixel; that display resolution must not determine scientific aperture size or centroid precision.
- Make WISE, Gaia and other context services optional enrichments. A temporary context failure must not destroy valid SPHEREx preparation.

### Matching, time, and measurement

- Replace approximate logarithmic channel assignment in the science path with appropriate release calibration. WCS-WAVE can support quick-look labels; use documented science calibration for measurements. Respect detector calibration orientation. [IRSA products](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products/), [spectral calibration](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/spherex_spectral_calibrations.html).
- Remove silent nearest-channel substitution. Same detector or nominal channel is not proof of equal response. Evaluate matching at the source for measurements and across the actual region for whole-field comparisons. The v2 `ref/80` rule is not adopted as an automatic science-quality threshold.
- Choose compatible observations before frame-count sampling. Keep real exposure times and epoch time ranges; replace the universal long-visit bin with target-appropriate limits on smearing and variability.
- Preserve median stacking under an honest label. Add weighted coadds only with explicit units, masks and uncertainty treatment. Difference images require response matching, registration/PSF/background checks and appropriate noise propagation.
- Measure original-precision data. Include instrumental/background/calibration and resampling limits in uncertainties. A guessed centroid floor, 2,000 Monte Carlo draws, or a control star alone does not establish calibrated error coverage.
- Field controls need catalogue motion/parallax assessment; do not assume all field stars have zero motion over decades.
- Maintain explicit `qualitative`, `quantitative`, and `invalid` comparison status with documented reasons. Show insufficient evidence when needed, rather than forced measurements.

### Target roles

| Target | See / explanation | Prediction proposal and gate |
|---|---|---|
| Barnard's Star | SPHEREx motion, saturation checks; optional historical context | Fit astrometry from quality-controlled training measurements; add annual-parallax observer geometry where constrained; compare against a simple linear baseline |
| WISE 0855 | Long-wavelength detection/confusion investigation | Only forecast if identification, blending and errors support a usable track; otherwise insufficient training data |
| Epsilon Indi B | Brown-dwarf system context and motion | Confirm which component/system is measured; account for unresolved/blended astrometry |
| R Draconis | Matched-response brightness change | Periodic forecast only if training cadence, wavelength and a justified period/model constrain it; VSX optical periods/ranges must not become unverified infrared amplitude priors |
| RW Aurigae | Matched-response variability | Exploratory range or baseline; a historical min/max range is not automatically a calibrated 95% prediction interval |
| Makemake | Object-following acquisition plus fixed-sky motion pair | Independent model only if training arcs constrain it; otherwise label the forecast catalogue-assisted or illustrative. Validate recovery separately |
| Pluto | Same distinction between object tracking and fixed sky | Same model/identification requirements; no guaranteed circular-orbit recovery claim |
| 3I/ATLAS | Official exposure table and extended-source/low-SNR caveats | See-only in this release; omit from forecast-hit denominator |

All five official shortcuts remain visible even when a measurement is unavailable. Makemake/Pluto/3I slots remain unavailable until their actual demonstration products pass validation. A verified bright asteroid may replace an extra target only with a recorded reason; mandatory targets cannot be replaced.

For moving stars, 2MASS Ks -> AllWISE W2 -> SPHEREx is optional long-baseline context/astrometry. Use actual exposure/coadd timing, not “2000/2010/2026” as exact dates; the baseline is whatever the source files establish. Cross-mission photometry is not directly comparable, and low-SNR/non-detection in 2MASS must not turn into a fabricated centroid. These products can be released independently if the historic baseline fails.

## 4. Forecasting protocol and public scoreboard

### Honest trial categories

Every trial declares one of:

- **Prospective, unexposed:** the target observation and derived products were genuinely withheld before model/rule freeze, with an exposure record and any remaining limitations stated.
- **Retrospective holdout:** historical data reserved for evaluation now, possibly already available/seen. Useful demonstration, not “before we looked.”
- **Catalogue-assisted:** named catalogue/ephemeris priors influence prediction. Label the dependency; do not portray agreement with the same source as independent validation.
- **Illustrative:** a physical/educational simulation, never scored as a real forecast.

Downloaded/reprojected frames, static thumbnails, spectra, tables, screenshots and external truth lookups can leak holdout information. Audit them before opening additional target products. This chat already examined some supplied images/results. A git commit cannot make prior viewing disappear and is not independent proof of blindness. Do not repeat the PDF's “we predicted eight before looking” pitch without actual evidence.

### Freeze, predict, verify

1. Record source inventory/exposure status. Select training observations, evaluation epoch, targets, baseline, model, permitted priors, scoring rule and exclusion criteria before viewing reserved pixels.
2. Freeze a training manifest: observation IDs, hashes, calibration, measurements, code/config versions and permitted external inputs.
3. Train/predict using only approved inputs. No hidden truth requests. Annual apparent parallax requires observer geometry; `apply_space_motion` alone is not a complete observer-parallax model. [Astropy space-motion documentation](https://docs.astropy.org/en/stable/coordinates/apply_space_motion.html).
4. Write an immutable `prediction.json`, hash it, then commit it when working in a Git checkout. Write the commit/file hash receipt separately; do not require a file to contain its own commit SHA. A public timestamp/remote receipt is additional evidence only when publishing is authorized.
5. Verification checks that the frozen artifact is unchanged, then loads the reserved observations and writes a separate `verification.json` and append-only trial record.
6. Publish every preregistered outcome, including misses, unavailable observations, and ambiguous identification. Do not require a chosen hit rate or “no more than two misses.”
7. Fixing the model after verification creates a new exploratory version on the same revealed data; it does not become a fresh blind success. Reserve a new unexposed epoch for a new prospective test.

For Solar System recovery, query around the frozen predicted position/time, inspect all candidate sources under a preregistered procedure, check field-star confusion and motion across exposures, and preserve alternative candidates. The brightest object inside an ellipse is not automatically the target. Consult an appropriately framed independent ephemeris afterward for comparison. Geocentric Horizons location 500 is an approximation to a spacecraft observer; document or correct it when precision requires.

The PDF's two-parameter circular-orbit fit is not a guaranteed independent orbit solution from sparse arcs. Demonstrate training identifiability, fit residuals, sensitivity to starting values/priors and predictive uncertainty. If unconstrained, say so and use a labeled catalogue-assisted model or no forecast. Do not infer a planet's distance from total observed motion as if orbital motion vanished.

### Scoring and uncertainty

Use tangent-plane residuals in consistent angular units. Under a justified Gaussian model, compare the residual with its covariance, including observational error and relevant shared/systematic covariance. For independent prediction and observation errors, `S = C_pred + C_obs`.

Position hit: `D² = residual.T @ inverse(S) @ residual <= chi2.ppf(0.95, 2) ≈ 5.991`; equivalently `D <= 2.4477468`. Show which covariance the ellipse depicts. A one-standard-deviation-axis covariance ellipse encloses about 39.3% in 2D, not 68%; a radius-two ellipse encloses about 86.5%. Do not confuse these with a 95% region. [SciPy chi-square documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.chi2.html).

For a valid one-dimensional Gaussian forecast, use a properly combined residual uncertainty and `|z| <= 1.96`. For non-Gaussian predictive samples, use a declared empirically justified interval/region instead of forcing an ellipse. Monte Carlo sample count does not repair an invalid model or covariance.

Scoreboard separates trial category and eligibility. Statuses: waiting, verified hit, verified miss, insufficient data, ambiguous identification, invalid comparison, and excluded/See-only with reason. Show counts for each; do not drop bad outcomes from view. No arbitrary confidence percentages.

`E[hits] = sum(p_i)`; it becomes `0.95 N` only for trials with defensible 95% predictive coverage. `P(all hit)=0.95^N` additionally assumes independence. With seven such independent trials it is about 69.8%; the PDF's eight-trial example is theoretical, not this product's automatic sample size. A handful of targets cannot validate a universal 95% calibration claim. Show baseline and model errors without promising that physics wins.

## 5. Shared data contract and code changes

Preserve the earlier blueprint's versioned investigation manifest and add prediction/game/lesson records. Do not maintain contradictory duplicate values in `meta`, chart, feed and scoreboard files.

| Product | Purpose |
|---|---|
| Site index | Prepared footprints, targets, availability, map distances with sources, dataset versions and credits |
| Investigation manifest | Source observations, epochs, calibrated responses, masks/variance, valid comparisons, measurements, evidence, preview assets and capabilities |
| Frozen training/trial manifest | Exposure audit, permitted inputs/priors, holdout ID/time, code/config hashes, baseline and scoring rules |
| `prediction.json` | Immutable prediction, uncertainty, model limits, training manifest hash and trial category |
| Prediction receipt | Hash/commit reference without altering the frozen prediction |
| `verification.json` | Observed result and error, identification evidence, residual metrics, verdict and frozen prediction reference |
| Scoreboard | Derived view of trial records; counts separated by category/eligibility; no manually edited success numbers |
| Game records | Training-only display, frozen baseline/model, reveal observation, units, preregistered scoring scale and trial provenance |
| Lesson records | Sourced real quantities linked to measurements/trials; answer calculations, assumptions and translations |

Recommended extension locations, adapted to current code:

- Modify `backend/archive.py`, `config.py`, `processing.py`, `framestore.py`, `jobs.py`, `api.py`, `presets.py` and existing catalogue adapters.
- Add focused backend modules for calibration, pairing, measurement, manifests and predictions as needed. CLI scripts remain thin callers of shared functions.
- Extend `scripts/bake.py`/`build_site.py`; add `scripts/predict.py`, `verify.py`, `make_game.py`, `make_lessons.py` when real implementation exists. Do not ship TODO scripts as completed functionality.
- Retire `scripts/results.mjs` as an independent authority once all results come from the shared measurement pipeline.
- Gradually split `static/js/main.js` into state/router, loader, feed/map, viewer, evidence, prediction, game, lesson and Lab modules. Preserve renderer/viewport/chart utilities.
- Add MN/EN JSON resources. Existing prepared assets stay readable while a versioned migration is introduced; old scientific claims need an explicit legacy/unvalidated status.

Raw science stays out of the public preview bundle. Production builds reject unlabeled sample content and test-fixture scoreboards; legitimate artificial-source games and model illustrations remain explicitly labeled.

## 6. UI, visual direction, and map

Use the v2 visual direction: navy-black background, clear light typography, amber stars, purple variable stars, cyan Solar System objects and orange hypothetical Planet Nine. Suggested tokens: background `#05070d`, panel `#0a0f1a`, card `#0f1726`, text `#e6edf7`. Verify contrast rather than assuming all token combinations meet it. Fonts must cover Mongolian Cyrillic; new libraries/fonts need licenses and credits.

The home map is a **schematic logarithmic distance illustration**, not an actual sky map or an orbital solution. Label arbitrary angular placement, mixed distance definitions and any not-to-scale treatment. Source distances/epochs, handle missing distances and the Sun separately, and keep target buttons in the accessible DOM. Do not describe pinned variables or arbitrary angles as observed coordinates. Keep coordinate search and five mandatory target shortcuts prominent. The real Aladin sky context is separate.

Investigation order: target/coordinates -> See -> What changed -> Prediction -> Evidence -> optional spectrum. Persistent image strip: actual observation time/range, wavelength/response, release, source, real/processed/difference/context/artificial status. Viewer offers Blink, Side by side, Swipe and validated Difference; timeline includes only compatible observations for a selected band. AllWISE/2MASS are explicitly cross-mission context.

Prediction panel: training/evaluation dates; model and baseline; uncertainty region; observed point; separately labeled catalogue/ephemeris comparison; residual; trial category; freeze receipt; limitations. Only a prospective-unexposed trial may carry qualified “frozen before reserved pixels were opened” wording. Forecast future dates must be labeled forecasts, not observed frames.

Evidence distinguishes measured, catalogue-sourced, modeled and interpreted content. Explain alternatives, reliability and missing data. A learned star class is not proof that a particular pair changed intrinsically.

Routes extend existing `ra`, `dec`, `fov`, `target`, `embed` parameters, adding page/panel, band, explicit A/B IDs and dataset version. If accepting the PDF's `id` parameter, normalize it as a documented alias rather than breaking existing links. Coordinates/FOV remain authoritative; explain stale/conflicting links.

Mobile: primary image/date/band/Play together, secondary controls in a drawer, 44-pixel target hit areas where possible, keyboard timeline/swipe support, readable chart tables, reduced-motion support and no horizontal overflow at 360/390/768 and desktop widths. Screenshots are generated from the actual app, not treated as proof of validated science.

## 7. Beat the physics and lessons

### Main game

Desired rounds: Barnard's position, Makemake's position, R Draconis brightness, if valid observations/models exist. Each shows training epochs; the player guesses the next position/value. Reveal in order: player, baseline, model/region, actual observation/thumbnail. Display actual player/baseline/model residuals in arcsec/arcmin/magnitudes as appropriate. Keep status and retrospective/prospective labels consistent with the scoreboard.

The PDF's division by straight-line error is undefined for a perfect baseline and gives zero even for merely matching that baseline. Replace it with a documented bounded score normalized by a fixed per-round scale chosen before reveal; guard zero/non-finite values. Always show raw errors as the primary comparison. Model defeat is allowed. Local storage is best-effort; no account, leaderboard or public statistics required. This is an educational game, not a secured blind study of players.

Parallax loops are geometry-dependent; label a schematic animation as an illustration, and use measured/fitted numbers only when available. Do not make “straight lines always lose” a claim.

### Three printable lessons, grades roughly 8-11

Each: short idea, accessible formula, worked example, three exercises, toggled answers, separate answer print page, teacher note, link to source investigation, MN/EN resources and print CSS. Grade/time labels are teaching recommendations, not tested classroom outcomes.

1. **Distance and a moving observer:** small-angle/projected-baseline geometry; show assumptions. Real Makemake/Pluto motion may include orbital motion; a parallax-only number is a model illustration, not an unconditional measured distance. Use explicit synthetic geometry if it teaches the formula more honestly, clearly distinct from real observations.
2. **Brightness, logarithms and detection limits:** reflected-light dependence, visual magnitude model and assumptions, separate infrared detectability. Do not title the empirical conclusion “SPHEREx cannot see it” without a validated scenario. Compare same-band quantities only. Use optional radius/mass model with limitations; do not turn mass into a decorative control.
3. **How sure are we?:** uncertainty, 2D regions, calibration assumptions, actual eligible scoreboard counts, and false-alarm examples with Gaussian/independence/multiple-testing caveats. Recompute answers from one lessons data source.

No real-number lesson example appears until its referenced measurement exists; show an honest unavailable example or a clearly marked synthetic exercise. Do not generate measured-looking numbers to finish the worksheet.

## 8. Secondary features and deliberate cuts

Keep the previous plan's full-provenance explanations, optional Gaia/known-object overlays, coordinate sharing and fast static demo. Spectra for up to three scientifically usable targets can be a first spectral milestone; complete coverage is never fabricated.

Stretch: Hide-the-Planet artificial injection experiment; recovery curve with uncertainty and blank controls; a focused 3D parallax explainer with 2D fallback; GIF/evidence-card export; trail view with proper labels; DR1 cube integration after the outstanding fetch/render issue is resolved. Do not hardcode an unverified Three.js bundle budget; measure any added dependency cost.

Defer candidate/discovery searches, voting, AI chat/classification, elaborate 3D navigation and public player statistics. They must not displace the coordinate viewer, prediction integrity, game or lessons. No new competitor code/assets are imported.

## 9. Delivery sequence and acceptance gates

| Phase | Deliverable | Required exit evidence |
|---|---|---|
| A: reconcile local state | Inspect current source/instructions, record baseline tests, source ownership, context/holdout exposure inventory | Changed conditions versus prior audit documented; no false blindness assumption; working code preserved |
| B: science/data repair | Current releases, flags, native data/variance/calibration, pairing, versioned cache | Old tests updated where they endorsed invalid behavior; real FITS regression; mismatched comparisons rejected |
| C: first real investigation | One target through shared manifest, previews and evidence; coordinate lookup into prepared coverage | Reproducible original source, valid multi-epoch images, correct FOV/centering, explicit measurement status |
| D: complete five-target core | Mandatory target shortcuts, time viewer, metadata, explanations, MN/EN foundation | All five open on static prepared data; coordinates/FOV validated; no fabricated observations/results |
| E: TENGER interface | Log map + accessible feed, investigation panels, swipe/share, responsive stateful UI | Real browser flows, language switching, chart tables, screenshots at declared widths |
| F: prediction experiment | Freeze trial/model/baseline, predict, receipt, verify, derive scoreboard | Immutable artifacts, separated truth, actual eligibility, misses retained, prospective/retrospective labels correct |
| G: game and three lessons | First valid round then up to three; printable bilingual lessons and honest Lab | Correct residuals/zero handling; data-linked lesson answers and print layout checked |
| H: release | About/credits/limitations, guided tour, embed, performance, deployment preparation | Full tests, data validators, real-device/mobile checks, signed-out link check if published; source/data/AI attributions verified |
| I: stretch | Selected spectra/injection/3D/export/cube improvements | Core acceptance remains green; each feature earns its own science and interaction checks |

Model and UI infrastructure can be developed using synthetic fixtures only in isolated tests/dev views. A real scoreboard cannot be replaced by mock hits. If time is short, one honest verified prediction and one working game round are better than seven invented successes; remaining forecasts visibly wait or explain insufficiency. Keep all five required See targets.

The PDF's Sunday 15 November 2026 18:00 Ulaanbaatar feature freeze is an internal planning target. Its old start times are not a current schedule. Confirm the actual remaining time with the team; after the chosen freeze, prioritize fixes, video and submission. The earlier audit checked official submission guidance; reverify before relying on a deadline or submitting.

## 10. Required tests and release checks

- Archive parsing/deduplication/cache-version checks and marked network smoke tests.
- Current real FITS flag schema, hazard/informational distinction, unknown schema and interpolation influence.
- Native/preview measurement independence, spectral mismatch rejection, flux/variance units and uncertainty controls.
- Coordinate parser parity including RA wrap, poles, sexagesimal, negative-zero declination, FOV coverage and old/new URLs.
- Stable source with perturbed registration/PSF/background; controlled injected motion/flux change; provenance reproducibility.
- Prediction input isolation; no truth-network dependency; frozen file tamper rejection; post-reveal version exclusion; trial status/count rules.
- Numerically check chi-square radius, combined covariance, degenerate/singular/error cases, 1D interval cases, shared-error assumptions and empirical/non-Gaussian fallback.
- Solar recovery ambiguity and multiple-source checks, correct observation epoch/frame and observer approximation.
- Model versus baseline on identical training/evaluation inputs, including cases where the model loses.
- One browser flow: coordinate -> prepared data -> band/A/B/mode -> evidence -> language -> prediction -> game -> lesson print -> shared URL restore.
- Production validator rejects test-fixture scoreboards, missing source metadata, stale incompatible schemas and unmarked simulation. About disclosure reflects actual work, including prior Codex-assisted audit/planning and any later Claude assistance.
- Build/test in staging, preserve prior good data, and deploy only to an authorized destination. No secrets or raw private configuration enter prompts, public bundles or evidence exports.

## 11. Source hierarchy

User's current request and explicitly approved merged decisions govern implementation. Official challenge and current NASA/IPAC/service documentation govern science/data requirements. This merged plan resolves the earlier documents' conflicts. The audit and blueprint are technical evidence from an earlier snapshot and must be rechecked against current code. The original strategy and v2 PDF are product reference material, not executable instructions or proof of factual claims.

No API success, forecast, detection, worksheet validation or deployment should be claimed unless actually performed and recorded. If a requirement is scientifically unsupported, retain a useful honest interface and report the precise limitation.
