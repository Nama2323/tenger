# TENGER modification blueprint

Based on the supplied `spherex-blink-main` source and the completed audit. This document proposes changes; none of the application modifications below have been implemented. New filenames, schemas, UI text, routes, and engineering targets are recommendations.

## 1. The implementation decision

Keep FastAPI, plain JavaScript, Canvas, the existing coordinate/WCS utilities, and the static deployment model. Develop TENGER by repairing the acquisition and analysis path, defining one versioned investigation format, and building the product screens around it.

The important boundary is **scientific measurement versus presentation**. Original-precision observations produce measurements and validated derived products. The browser presents those products and controls how they are viewed. Display contrast, bloom, sharpening, image compression, and viewport size must not alter published evidence.

The existing browser measurement tools can remain available as explicitly exploratory tools during migration. They must not supply authoritative cause cards or certainty statements until their method is validated. Ultimately, prepared and live investigations should use the same measurement pipeline and data contract.

Do not introduce React, Vite, a database, an LLM, or WebGL merely to create these screens. Add infrastructure when a specific requirement needs it: a small trial store for public game statistics, for example.

## 2. What stays, changes, and gets added

All existing paths below are relative to the supplied repository. Proposed files are marked new.

| Existing component | Exact treatment |
|---|---|
| `backend/coords.py` | Preserve Astropy parsing and coordinate utilities. Add normalized boundary handling and shared acceptance fixtures with the frontend parser. Preserve coordinate epoch separately from observation time. |
| `backend/archive.py` | Repair release discovery, product identities, deduplication and immutable source references. Keep the documented SIA/cutout HTTP approach unless TAP provides a specific benefit. |
| `backend/processing.py` | Preserve useful WCS/grid operations; expand input data and quality handling. Separate display resampling from native-resolution measurement. Move calibration, matching and analysis into focused modules as they are added. |
| `backend/framestore.py` | Version the cache schema; retain variance, original flag bits, source identity and processing configuration. Reject old incompatible cache entries. |
| `backend/jobs.py` | Call the shared investigation pipeline. Replace implicit “all frames failed but job done” with explicit result states. Bound active jobs and queue size; memory eviction alone does not limit work. |
| `backend/api.py` | Keep existing routes initially. Return structured error codes and manifest locations. Make CORS/backend origin configurable. Add manifest/measurement endpoints only as migration needs them. |
| `backend/presets.py` | Preserve five mandatory targets and aliases. Add sourced catalogue identifiers, epochs and category. Treat extra feed targets as candidates until actual products pass validation. |
| `backend/gaia.py`, `resolver.py`, `wise.py` | Preserve adapters; improve identifiers, uncertainty, epochs, provenance and failure handling. WISE stays a distinct context dataset. |
| `scripts/bake.py`, `build_site.py` | Acquire once, process once, export from validated results. Make WISE/Gaia optional enrichments so an external context failure cannot abort otherwise valid SPHEREx products. |
| `scripts/results.mjs` | Stop maintaining an independent authoritative measurement path. Initially compare old output with new pipeline results; ultimately replace it with a formatter/validator or retire it. |
| `static/js/plate.js`, `viewport.js` | Preserve Canvas rendering and geometry. Add swipe and shared pan/zoom transforms. Distinguish data pixels from decorative display effects. |
| `static/js/stack.js` | Keep safe geometry/codecs. Remove implicit nearest-channel fallback from time comparison. Rename median stacks honestly. Read a versioned layout rather than assuming new binary data match the old format. |
| `static/js/science.js` | Stop automatic categorical verdicts. Retain exploratory utilities with limitations; render validated results from manifests for prepared targets. |
| `static/js/chart.js` | Preserve SVG charts. Add inspectable points/table, source references, usable-channel gaps and reliable errors. Molecule labels become explicitly sourced references unless a feature is actually measured. |
| `static/js/main.js` | Gradually extract orchestration, viewer state, search, feed and evidence rendering. Do not replace all 1,452 lines in one patch. |
| `static/js/i18n.js` | Keep translation lookup behavior; load separate MN and EN JSON resources. Make existing result cards rerender when language changes. |
| `static/js/sky.js` | Keep AllWISE/Aladin context. Label the active survey; add SPHEREx cube browsing only after its access/rendering issue is resolved. |
| `static/js/tour.js` | Rewrite the storyline after validated target products are chosen. Do not script a result the dataset does not support. |
| HTML/CSS | Recompose existing elements into TENGER screens and simplify the primary viewer controls. Preserve functioning controls and accessibility hooks. |
| Deployment/workflows | Preserve Pages plus optional FastAPI hosting; add test/data-validation gates and staged, atomic data publication. |

## 3. Repair the scientific pipeline first

### 3.1 Release discovery, source identity, and downloads

Change collection parsing from a QR-number regex to explicit supported product families: DR1 wide/deep, QR3 wide/deep, with a separate treatment for cube and calibration collections. Discover future collections, but require an understood schema before using them for measurements. “The archive lists it” does not prove processing compatibility.

Deduplicate physical observations by observation identifier and detector while choosing the accepted processing product using declared release/calibration policy. Preserve the exact selected filename and URL. Do not rank DR releases by the existing QR numeric helper.

Use two cache levels: original downloads identified by product/source hash, and derived products identified by source hashes plus pipeline version, calibration version, grid, mask policy, and spectral selection. Coordinate/FOV alone is not a sufficient processing cache key.

Validate HTTP status, FITS structure, required extensions and units. Save interrupted downloads separately and promote only completed files. Distinguish search timeout, no coverage, rejected quality, and zero successful downloads.

**Done when:** a fixture and real network smoke check include DR1 and QR3, old cache products cannot masquerade as new processing, and a temporary context-service failure does not destroy a SPHEREx bake.

### 3.2 Full scientific inputs and image resolution

Expand `Native` to retain original image values, variance, original flags, the decoded measurement mask, spatial WCS, calibrated spectral information, source metadata and PSF/calibration references. Preserve ZODI as an input and record its subtraction; do not silently overwrite the original array or apply a display background adjustment to all analysis products.

A newly identified issue: `Grid.for_fov` caps output at 160 pixels. For a 0.5-degree field, that is `0.5 × 3600 / 160 = 11.25 arcsec/pixel`. The current 7-arcsec aperture is then automatically enlarged by the pixel-size rule. Therefore changing FOV changes the measurement aperture and discards resolution.

Measure compact sources on native pixels with the appropriate solid-angle treatment and calibration, or on a separately justified analysis grid. Make preview resolution independent. Larger fields can use 512/1024-pixel previews or tiles as needed; these are display decisions, not new measurement resolutions. If the original pipeline cannot support a requested measurement, report it as unavailable.

**Done when:** changing preview size/FOV/contrast cannot change the stored scientific result for the same source and observation selection; aperture angular size and correction method remain explicit.

### 3.3 Flag policy

Implement a schema-aware decoder for both historical `MP_` headers and current `MSKN`/`MSKM` definitions. Store bit names, masks, and which policy rejected each pixel. Check missing/unrecognized definitions explicitly.

Use separate purposes: display warnings, photometry rejection, astrometry rejection, and context-only informational bits. Do not assume every flagged value is saturated. Do not silently treat unfamiliar bits as benign. Decide individual informational/problem flags against release documentation and validation rather than carrying forward the old “benign” list unquestioned.

Measurements must obey their quality policy even when the user chooses to visualize flagged pixels. A display checkbox must not enable invalid scientific pixels. Propagate masks over the interpolation or convolution footprint; nearest-neighbor masks do not capture contamination spread by bilinear interpolation.

**Done when:** the audited 12 × 12 DR1 cutout's named hazard flags are recognized, informational source markers are not confused with hazards, and masked pixels do not enter a measurement unnoticed.

### 3.4 Spectral calibration and matching

Replace nominal log-spaced channel assignment with release-associated calibration. Keep quick-look WCS-WAVE labels distinct from science calibration. IRSA specifies CWAVE/CBAND for science analysis and provides channel/response products; detector 4–6 calibration orientation must be handled correctly. [IRSA products](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products/), [spectral calibrations](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/spherex_spectral_calibrations.html).

Matching has two levels:

1. **Selected-source measurements:** evaluate the response at that source's position in every exposure, accounting for its epoch/position.
2. **Whole-field time comparisons:** validate spectral compatibility across the comparison region, not just the field center. A center wavelength match does not ensure every star in the cutout has a matched response.

The pair builder returns approved pairs and rejection reasons. A nominal shared channel can be an initial filter, but compatibility tolerances must be justified using the actual response and control-source behavior. Do not invent a universal wavelength-difference tolerance.

Delete silent substitution from the quantitative path. If a user selects an unavailable channel, say “No compatible observations at this wavelength.” An explicit “switch to an available channel” action is acceptable; it must change the visible selection.

Classify products as `quantitative`, `qualitative`, or `invalid`, with reasons. Broad detector composites may remain useful qualitative views; they must not automatically become variability measurements or difference products.

**Done when:** each comparison exposes its actual response and contributing exposures; a deliberately mismatched pair cannot produce a quantitative difference or brightness claim.

### 3.5 Time selection, stacking, and differences

Choose exposures for a viable time/spectral pair **before** applying a frame-count limit. The current even sampling can discard the exact repeated wavelengths needed to compare epochs. Optimize for validated coverage and compatible pairs, then control payload size with prepared previews.

Retain exposure times individually. Build epoch groups with target-specific limits on time span and allowed motion/variability smearing; do not apply a universal 75-day stack. Use shorter intervals for moving Solar System objects and explicit time ranges for all stacks.

Initially rename “Sum” to “Median stack.” Add a true inverse-variance coadd only with explicit assumptions, quality masks, effective response and uncertainty propagation. For a weighted mean, propagate variance using the squared weights; track correlated noise introduced by resampling/convolution.

Difference products require a common sky grid, valid response match, measured registration residuals, appropriate PSF treatment, documented background handling, and an error model. Publish both parents and valid coverage. Use a shared stretch for blink comparisons. Distinguish a display-scaled difference from a calibrated flux difference.

**Done when:** a stable-source control and injection tests bound false changes; failures have an explicit reason rather than a decorative difference image.

### 3.6 Measurements and explanations

Create one Python analysis path used by prepared and live results. Measurement records reference original-precision inputs and contain method/version, selected source, aperture/PSF treatment, wavelength response, epoch, value, uncertainty components, rejected flags, and limitations.

For variability, compute percentage change only with an appropriate nonzero baseline and compatible measurements. If errors are independent, `sigma_delta² = sigma1² + sigma2²`; account for covariance and shared systematics when they are not. A near-zero denominator should not produce a dramatic percentage. Do not publish significance derived solely from background scatter when relevant errors are missing.

For motion, retain per-epoch positions and errors; evaluate registration, chromatic centroid shifts, blending, saturation, and parallax. Show catalogue predictions as predictions, separately from recovered positions. Use stellar parallax/proper-motion models or explain the limits of a simplified fit. Do not infer distance from total Solar System displacement without the geometry/orbital model.

Cause cards are deterministic renderings of structured evidence, not an LLM call. Use `supported`, `suggestive`, or `insufficient` only when their decision rules are documented; otherwise use descriptive status without a confidence category. Each card covers the seven evidence questions in the request. A known variable-star classification alone does not prove measured variability in these images.

**Done when:** the feed, viewer, chart and exported report use the same result identifiers and numbers. The existing browser/table discrepancy cannot recur from different frame filters.

## 4. One investigation format for static and live modes

Add a versioned `manifest.json` per prepared target, and a site-level index of prepared fields. Keep legacy exports during migration so a schema change does not break all existing views.

An investigation contains:

| Section | Required meaning |
|---|---|
| Identity/version | Schema, dataset version, pipeline/config hash, target key, generated time |
| Request/coverage | Input coordinate and epoch, actual field footprint/WCS, requested FOV, available FOV, observation range |
| Target context | Catalogue IDs/type, reference position/epoch, sourced proper motion/parallax where used |
| Observations | Exact product/release/file/URL, start/mid/end time, detector, response, units, flags, calibration and provenance |
| Epochs/products | Contributing observations, time span, spectral compatibility, image/mask/error assets, processing parents |
| Comparisons | Explicit A/B product IDs, grade, allowed modes, failure reasons, registration/PSF/background checks |
| Measurements | Referenced observations/products, method, values/units/errors, status, alternatives, limitations |
| Explanation | Translation keys and numeric references; no separate manually typed measurement values |
| Capabilities | Which modes, spectral samples, measurements and context layers are actually available |
| Credits | Dataset, code, image, API and calibration acknowledgement references |

Separate `dataStatus`, `measurementStatus`, and likely-cause hypothesis. A field can have valid images but insufficient evidence for a measurement. Use `null` for a missing result; never substitute zero.

Keep preview assets separate from numeric arrays. The homepage loads only the index and thumbnails. The viewer loads the manifest, first preview and selected pair before optional full arrays. This avoids requiring a multi-megabyte measurement payload just to see an image.

Prepared and live loaders return the same frontend investigation model. Keep current API routes compatible at first; add a job manifest route when the pipeline can emit it. A later measurement endpoint can compute clicked-position results using the same server method, with bounded work and explicit coverage limits. Prepared targets can ship precomputed results for selected objects; arbitrary clicked spectra remain clearly exploratory or unavailable until supported.

## 5. Exact frontend product changes

### 5.1 Navigation and page structure

Use four primary destinations: **Investigate**, **Explore**, **Planet X Lab**, and **About**. Home is the Sky Feed. Spectra and “Why did it change?” are tabs/panels within an investigation; the game belongs within the Lab. This covers the intended screens without nine competing navigation items.

Stay with `index.html` initially. Use existing query parameters plus a small page parameter for secondary destinations. This avoids static-host deep-link rewrites. Split modules progressively:

```text
static/js/
  main.js              small bootstrap and event setup
  api.js               network requests and configurable endpoints
  data-loader.js       NEW: static/live -> common investigation
  state.js             NEW: application state and actions
  router.js            NEW: query parsing/serialization
  coordinates.js       NEW: offline coordinate parser/validation
  feed.js              NEW: available target cards
  viewer.js            NEW: playback, epochs, bands, mode
  evidence.js          NEW: cause cards and metadata
  planet-lab.js        NEW: hypothetical calculations
  game.js              NEW, later: injection experiment
  plate.js             existing renderer, extended
  viewport.js          existing geometry, extended
  chart.js             existing SVG charts, extended
  i18n.js              translation loading/formatting
```

This is a destination structure, not permission to move every function in the first patch. Extract by behavior while keeping the current viewer passing its regression checks.

### 5.2 Coordinate search and prepared fields

Parse decimal and sexagesimal input locally. Use the same expected input/output fixtures as Python, including negative-zero declination, RA wrapping, invalid minutes/seconds, poles, and explicit units. Preserve ambiguous formats as validation errors rather than guesses.

After parsing, find a prepared field whose actual WCS footprint contains the entire requested view. Do not select solely by a rounded coordinate or target name. An offset request must render centered on the requested position through the correct transform; otherwise explicitly offer the prepared target-centered field. A smaller requested view can crop prepared data when coverage and resolution allow. Never label a 6-arcmin product as a 30-arcmin observation by stretching it.

If prepared coverage does not suffice, offer live retrieval with clear progress. Name resolution for known presets stays local; unknown names can use the existing resolver. Switching FOV must communicate whether it changes the data source or available resolution.

**Acceptance:** the same prepared region opens through both its target button and equivalent coordinate entry without contacting Render. Out-of-range requests do not silently recenter or invent data.

### 5.3 Viewer state and comparison modes

Store `epochA`, `epochB`, `selectedBand`, `mode`, `viewport`, `datasetVersion` and quality display settings explicitly. Separate comparison mode from playback state; current `one/compare` and `video/sum/diff` combinations need a coherent mapping.

Expose Blink, Side by side, Swipe, and Difference. A shared viewport keeps aligned features at the same location in both canvases. The swipe divider changes the visible portion of the second registered image, not its scale. Support keyboard adjustment and visible A/B labels.

The timeline reflects epochs available **for the selected band**, with unavailable epochs explained. Changing band must validate or reset selected A/B epochs. Playback traverses compatible frames only. Difference mode selects its explicit A/B parents rather than always subtracting the first global visit.

Keep an always-visible strip with date/time range, actual wavelength, release, product count and source-details access. Add a visible real/processed/difference/artificial badge. Make flags visible by meaning, with details in a drawer.

Remove silent band fallback, automatic cross-mission comparison, unsupported categorical motion verdicts, and generic feature-detection implications. Retain WISE as an explicitly labeled context mode with mission-specific timing/calibration caveats.

### 5.4 Feed and evidence

Reuse existing target-card and blink-preview rendering. Replace the generic results table as the homepage's main story with evidence-led cards. All five mandatory targets appear first; additional slots can say unavailable until validated.

Each card loads actual prepared A/B assets with declared mode: time change, cross-mission context, or wavelength contrast. Only the first may be titled as an observed temporal change. Never make an attractive feed preview by quietly comparing different wavelengths.

Within the viewer, show “What changed?”, the measurement and uncertainty, the source epochs, the likely explanation, alternatives/quality, and next useful data. Link every number to the measurement and every measurement to observations. A high-proper-motion catalogue value may be educational even when this dataset's recovery is inconclusive; label the distinction.

### 5.5 Spectra and sky context

Spectra need hover/focus inspection and an accessible table with wavelength, flux quantity/unit, uncertainty, time, channel and product. Leave gaps where channels are missing. Do not combine variable-source observations across dates into a single unqualified spectrum. Let users choose a comparable epoch or see separated samples. Reference molecular wavelengths are optional overlays with sources.

Keep the existing AllWISE sky map while the SPHEREx cube rendering issue is investigated. Label survey and spectral slice. A spectral-cube slider must never look like a temporal timeline. Overlays should add identification context, not decorate every frame with irrelevant catalogue points.

### 5.6 Mongolian and mobile

Add `static/locales/mn.json` and `en.json`; preserve RU only if maintaining a third language is useful. Target explanatory text must also use translation resources. Format dates/numbers with the selected locale and observation times explicitly in UTC where appropriate. Switch language by rerendering state-dependent panels, not only static `data-t` elements.

Put coordinate examples beside the input. On phones, image, date, band, Play, and timeline appear before evidence and advanced settings. Put contrast, flags and overlays in a collapsible drawer. Add touch zoom buttons and reset; implement multi-pointer pinch only with proper gesture tests. Respect reduced-motion preferences and pause offscreen/background playback. Add focus labels, keyboard timeline operation and chart tables.

Engineering targets, to verify rather than claim now: first prepared preview within 3 seconds under a declared throttled mobile profile; homepage critical assets under 2 MB; no page overflow at 360/390/768 CSS pixels; interactions remain usable with Mongolian strings. Measure on the actual deployment and representative phones.

### 5.7 Shareable URLs

Extend existing parameters, for example:

`?ra=...&dec=...&fov=...&target=barnard&mode=blink&band=...&a=...&b=...&data=...&lang=mn`

Retain `embed=1`. Stable product/epoch IDs, not array indexes, identify A/B. Validate schema/data version and provide an explicit stale-link fallback if those products are unavailable. Coordinates and requested FOV are authoritative; `target` is a hint unless consistent with the resolved field. Never silently ignore conflicting coordinates because a target key exists.

## 6. Add the signature features after the viewer is trustworthy

### Planet X Lab

Implement pure physics functions independent of UI so units and assumptions can be tested. Controls: distance, radius, visual geometric albedo, interval, viewing geometry, and optional mass-radius assumption. Mass should affect output only through a declared physical/empirical model; do not create a decorative mass slider.

Use projected observer-baseline geometry for the parallax illustration and ephemerides for real-object comparisons. Keep visual magnitude separate from predicted near-infrared flux. A SPHEREx detectability verdict requires an adopted spectral model and wavelength/exposure-matched sensitivity or recovery study; otherwise show “not determined by this model.”

Pluto/Makemake comparison cards must use sourced values at declared epochs. Planet Nine is hypothetical and no detection is implied. The Lab is valuable even if its honest outcome is a limitation rather than a yes/no instrument claim.

### Hide-the-Planet

First create a local educational game: start round, blink real image copies, choose a position, submit, reveal, and show artificial brightness/motion and score. Inject a calibrated PSF-shaped source, not an arbitrary bright dot; include pixel sampling and noise assumptions. Preserve the original image and identify the transformation chain. Do not calibrate apparent magnitude from an arbitrary display-pixel intensity.

If the experiment is intended to assess the full analysis pipeline, inject before that pipeline and run the same processing. A display-only game measures human/interface recovery under its own conditions and must say so.

Public statistics are a separate second stage requiring trial storage, blank trials, participant/trial bias controls, detection/false-positive counts and uncertainty. Only fit a threshold where the observed trials support it. Browser-only scoring can be educational without pretending to supply global statistics.

## 7. Implementation sequence and concrete exit gates

| Change set | Scope | Exit gate |
|---|---|---|
| 1. Product identities and schema | Release parser/policy, source provenance, cache version; manifest model and fixtures | Real DR1/QR3 search records survive parsing; old caches are rejected; existing viewer remains operational with legacy data |
| 2. Native inputs and quality | Flags, variance, calibration references, full-resolution data path | Current real-header fixture passes; missing quality schema is explicit; source arrays preserved |
| 3. First validated investigation | Choose a useful target/band pair, native measurements, pair quality, manifest/preview export | At least two real epochs, traceable parents, justified spectral compatibility, honest measurement or insufficiency |
| 4. Viewer consumes manifest | One loader, persistent metadata, explicit A/B, no channel substitution, uncertainty-aware evidence panel | Existing playback/compare works on new products; bad pairs cannot be presented as quantitative changes |
| 5. Coordinate and static-data parity | Local parser, prepared coverage index, correct centering/FOV, URL state | Target button and equivalent coordinate request open the same prepared product without a live API |
| 6. Five-target release | Rebuild all required targets through the same pipeline; target-specific quality decisions | Every required target opens quickly; same number everywhere; unavailable measurements clearly explained |
| 7. TENGER UI, MN/EN and mobile | Recompose home/viewer, complete translations, touch/keyboard and error states | All core flows verified on declared desktop/mobile widths and actual phones; no dead controls or untranslated result cards |
| 8. Strong differentiators | Validated difference/coadds, swipe, spectra, known-object context, share/export | Each feature passes its scientific and interaction acceptance; unavailable modes remain gated |
| 9. Lab and extra targets | Verified educational model, independent object-following datasets | No V-versus-IR-limit error, no general motion-to-distance assertion, extras validated or unavailable |
| 10. Game, statistics, advanced exploration | Artificial-source game, then bounded public trial service; optional 3D/cube | Clear simulation labels, original preservation, meaningful statistics and no regression of core viewer |

Do not wait until every screen exists to deploy. Each accepted stage can produce a reviewable local build; publishing uses the user's authorized destination and the same tested data bundle. Preserve the previous good release throughout.

## 8. Tests that should change, and tests that should be added

Retain useful existing tests. Update tests that currently endorse the behavior we are removing: nearest-channel fallback, approximate channel mapping as science truth, display-grid resolution as measurement resolution, and flag fixtures limited to the older schema.

Add targeted checks for failures that matter:

- DR1 and QR3 wide/deep collection parsing, revision selection, and processing cache invalidation.
- The real DR1 flag-header structure, combined hazard/informational bits, and missing-schema behavior.
- Coordinate parser parity between Python and JS, RA wrap/poles/sexagesimal boundaries, and URL conflicts.
- Spectral mismatch rejection and unavailable-band state; source-position and field-wide matching distinctions.
- Mask influence under interpolation, native-versus-preview independence, variance propagation and correlated-noise assessment.
- Stationary source with changed PSF/registration/background, injected proper motion, and controlled brightness change. These must challenge the validity gates, not merely repeat the implementation formula.
- Shared results across feed, evidence, chart and export; reproducibility from retained source references.
- An archive failure with stale data, all-downloads-failed job, optional WISE outage, job cancellation, and capacity limit.
- Browser flows: coordinates -> prepared field -> band -> dates -> blink/compare -> evidence -> language switch -> share link reopening.
- Game artificial-source disclosure and original immutability; blank trials and threshold uncertainty when the statistics stage exists.

Use small retained legal fixtures for regular tests and separately marked network smoke tests. A green unit suite does not replace scientific validation of the five target products. Validate a full bake in staging before switching the public data index.

## 9. Practical cut line

The complete ideal product requires more than cosmetic changes: it includes a reliable scientific pipeline, data contracts, product design, localization and separately validated experiments. Do not express completion as an invented percentage of the current code.

For the next coherent release, finish change sets 1–7. That yields the actual TENGER core: coordinate entry, real prepared SPHEREx epochs, valid comparisons, source metadata, evidence cards, MN/EN, and mobile use. Then add the strongest supported differentiators. Keep all five mandatory targets; allow extra targets and measurements to remain explicitly unavailable when evidence is inadequate.

No additional approval is needed to use this document as an analysis. Application source edits and restructuring remain outside this analysis-only turn, consistent with the earlier requested implementation checkpoint.
