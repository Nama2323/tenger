# Asteroid batch: pre-registered rules (Task A9)

**Written and committed before the selection was run.** Nothing below may change after the selection
runs. Any later change is a new, dated section that says what changed and why. The code that applies
these rules is `scripts/asteroids.py`, in the same commit (`python -m scripts.asteroids select`).

## 0. Integrity rule for MOST (user's rule, 15 Nov 2026, before any selection)

IRSA's Moving Object Search Tool (MOST) returns JPL-predicted positions for every exposure, including
the evaluation visit. Therefore:

- **Training rows only:** MOST positions are used only for training exposures.
- **Evaluation visit from times alone:** it is the newest cluster of exposure times.
- **Evaluation rows are cut down in memory first.** Before anything is printed, logged or saved, every
  evaluation-visit row is reduced to `observationid`, `productid` (detector), `uri` (file path),
  `mjd_start`, `mjd_end` and `match` (in footprint).
  - The predicted RA/Dec, rates, magnitudes, distances, phase, image corners and image centre are
    dropped.
  - Detector and file path identify the exposure; they carry no ephemeris value.
- **Blind star check.** The 15″ star check at the evaluation time runs on the in-memory positions.
  Only pass/fail is kept.
- **Raw MOST tables are saved only after the freeze push.**
- **Exposed objects are excluded.** An object whose evaluation-time predicted position has appeared in
  any output or file is excluded, or would be catalogue-assisted only.
  - 1000 Piazzia is excluded (`docs/EXPOSURE.md`).
  - It has only two DR1/QR3 visits, so it would fail §1 anyway.
- A test (`tests/test_asteroids_integrity.py`) checks that nothing committed before the freeze contains
  evaluation-time ephemeris values.

## 1. Selection

1. **Pool.** JPL Small-Body Database query: numbered asteroids of JPL orbit class MBA (main belt
   only; inner/outer-belt classes not included), with 9.0 ≤ H ≤ 11.0.
   - The lower bound avoids saturated objects: SPHEREx saturates near AB 10–11.7 (Explanatory
     Supplement v2.1, Table 25).
   - The upper bound keeps the pool short.
2. **Order.** Absolute magnitude H ascending (brightest first by H, not by predicted V); ties by
   number.
3. **Images.** MOST (`catalog=spherex`, 2025-04-01 to 2026-11-15).
   - Rows with `match = 1` (the object's predicted position is inside the image footprint) from DR1
     or QR3 file paths.
   - One row per exposure and detector, DR1 preferred.
4. **Visits.** Clusters of exposure times; a new cluster starts after a gap of more than 30 days.
   - At least 3 visits are required.
   - Evaluation = the newest visit; training = all earlier visits.
5. **Brightness** (training visits only): the median MOST V of every training visit lies in
   11.5–16.0. Evaluation magnitudes are never read.
6. **Evaluation window.** Within the evaluation visit, the 1-day interval (starting at an exposure
   time) that holds the most exposures; ties go to the earliest. Times only.
7. **Star check at the evaluation time** (catalogue only, no pixels, blind). An exposure in the window
   is star-free when no Gaia DR3 source with G < 18 and no AllWISE source with W1 < 15 (Vega) lies
   within 15″ of the object's predicted position. VizieR via the CfA mirror.
   - Star-free exposures are kept, at most 10, spread evenly in time.
   - An object needs at least 4.
8. **Take the first 8 that pass, in order.**
   - A candidate whose query fails at the network is recorded as not examined, and the next is taken.
   - If time runs short, selected objects that are not started are marked "not attempted", never
     partial.

## 2. Exposure

No teammate has opened these objects' images. Narmandakh's earlier viewing covered only Makemake and
Pluto. Every trial carries `team_statement_pending: true` until the user confirms the team statement.
Category: `prospective_unexposed` (pending), plus `catalogue_assisted` for the training identification
(next section).

## 3. Training measurements (the Pluto pipeline, A3)

- **Every exposure of every training visit** (from MOST): a cutout of 0.03° centred on the MOST
  position at that exposure (training rows only).
- Fit with `backend.astrometry.fit_position` (pixel-integrated Gaussian, VARIANCE weights, 15″
  radius), started at the MOST position.
- A point is kept when all of these hold:
  - the fit is measured with S/N ≥ 10;
  - it is within 3″ of the MOST position (identification gate, catalogue-assisted as for Pluto);
  - no Gaia DR3 source with G < 18 lies within 12″ of the measured position (blending);
  - the exposure has L2 quality Pass or no flag.
- The spacecraft position comes from each header (X_SC, Y_SC, Z_SC).
- Groups for resampling are visit × detector.
- A training visit with fewer than 5 kept points is dropped. An object left with fewer than 2
  training visits is frozen as insufficient data.

## 4. Models (frozen per object)

- **Primary: method v2, as instructed.** `scripts/forecast_v2.MethodV2`, unchanged:
  - barycentric two-body orbit fitted to our positions only;
  - group Monte Carlo (300 draws, per-group offsets) and visit × detector jackknife, combined as an
    envelope along and across the track.
- **Starting state.** No JPL orbit is used. The fit starts from states built from our own first-visit
  positions and motion over a grid of geocentric distances, 0.8–4.0 AU in 0.2-AU steps. The solution
  with the lowest χ² is kept.
- **Two-body model error, added to the covariance:**
  - 24 synthetic orbits per object with the semi-major axis, eccentricity and inclination of our own
    fitted orbit, and random node, perihelion argument and mean anomaly (seeded);
  - each is integrated with the Sun, Jupiter, Saturn, Uranus and Neptune (astropy ephemerides), seen
    from Earth at the object's real training-exposure times and evaluation time;
  - each is fitted with the same two-body model and forecast. The error is expressed along and across
    that orbit's own track;
  - C_model is the second moment (bias included) of those errors, rotated to the object's track. It is
    stated in the prediction.
- **Spacecraft term:** forecast_v2's spacecraft σ for the predicted distance (the forecast observer
  is Earth's centre).
- C_pred = C_fit (envelope) + C_model + C_spacecraft.
- **Secondary, pre-registered and scored separately: the same with a heliocentric two-body orbit.**
  - A synthetic test run before any selection (6 random main-belt orbits, about 300-day gap) gave
    two-body errors of 32–1028″ with the barycentric frame and 15–106″ with the heliocentric frame.
  - v2's barycentric frame was chosen for a body beyond the planets. Inside Jupiter's orbit the
    heliocentric frame is the usual two-body approximation.
  - The batch calibration reports the primary; the secondary is reported next to it.
- **Baseline:** the straight-line model of `scripts/predict.py` (constant motion in the tangent
  plane) fitted to the same training points. It is frozen too.
- **Forecast times:** the evaluation exposures chosen in §1.7 (their times only).

## 5. Freeze, then verify

1. Trial manifests, training files, predictions and receipts for the whole batch, committed and
   pushed as "predict: freeze asteroid batch", **before any evaluation pixel is opened**.
2. Then the evaluation exposures are opened. Cutouts are centred on the frozen primary forecast at
   each exposure time; the size covers the larger 95% region (primary or secondary) plus 60″,
   capped at 0.5°.
3. **Static reference.** For each evaluation exposure, one other exposure of the same detector that
   covers the same sky position at least 0.5 day earlier or later, with the same cutout (from the SIA
   listing at that position).
4. **Recovery under the Pluto rules** (`scripts/verify.py`):
   - every peak with S/N ≥ 5 within the listing radius is kept as a candidate;
   - identification needs fit S/N ≥ 10, a distance within max(15″, 3 × the largest 1σ of C_pred), and
     no source at S/N ≥ 5 at the same position in the static reference;
   - exactly one passing candidate per exposure;
   - motion consistency across exposures (χ² at p = 0.997, 0.3″ allowance);
   - at least 3 exposures identified. Otherwise the object is ambiguous or insufficient data, and it
     is still published.
5. **Score**, as for Pluto: mean residual of the identified exposures (each against the model at its
   own time), C_obs from the residual scatter (or the fit floor), and D² = r̄ᵀ(C_pred + C_obs)⁻¹r̄.
   - Hit if D² ≤ 5.991.
   - The secondary model and the baseline are scored on the same identified positions with the same
     C_obs.
6. **Only after the verdict**, JPL Horizons is compared with the observed position and with the
   forecast.

## 6. Calibration

- k of N primary forecasts inside their 95% regions.
- N counts every scored object (hit or miss). Ambiguous or insufficient objects are listed and not
  counted in N.
- Binomial 95% interval for the true coverage: Clopper–Pearson (exact), with Wilson as a second
  method.
- The expected count under perfect calibration is 0.95 N.
- Model and straight-line errors are listed side by side.
- **Independence assumption.** The objects are different bodies observed at different times. They
  share the method, the two-body model-error estimate and SPHEREx's systematic errors, so their
  outcomes may be correlated. The binomial interval assumes independence and is therefore optimistic.
- Every outcome is published. Nothing is dropped after the reveal.

## Clarifications, 15 Nov 2026 02:52 UB (before any training pixel or forecast; no outcome known)

1. **Category.** Section 2 also mentioned a `catalogue_assisted` label for the training
   identification. As for Pluto (A4), the ephemeris-guided identification of training detections is
   recorded as a limitation (`limit.ephemeris-guided-training`), not as a label. The forecast itself
   uses no catalogue or ephemeris value, and the user asked for `prospective_unexposed` with
   `team_statement_pending`. The trials therefore carry `labels: ["prospective_unexposed"]`,
   `team_statement_pending: true` and `confirmation_pending: true`.
2. **Synthetic model error, implementation detail.** Each synthetic orbit is fitted at 30 of the
   object's real training-exposure times, evenly spaced (the error is set by the time coverage, not
   the count). The model error uses the mean evaluation time. Synthetic orbits keep e ≤ 0.6.
3. **Batch trials are not mixed into the scoreboard's per-category counts.** They form a separate
   `asteroid_batch` block (contract V13).

## Amendment, 15 Nov 2026 05:52 UB: the heliocentric frame is the primary (user's decision)

Made before any forecast was frozen and before any evaluation pixel was opened; no outcome is known.

- **Evidence.** A dry run of both frames was made on the first measured object (345 Tercidina, 80
  training points, two visits). Nothing was written or frozen.

  | Frame | χ²/dof of the fit to our training positions | Residual RMS (E, N) | Synthetic two-body error, RMS along / across | 95% region along × across |
  |---|---|---|---|---|
  | Barycentric (v2) | 332 | 1.35″, 2.86″ | 381″ / 194″ | 932″ × 476″ |
  | Heliocentric | 4.45 | 0.23″, 0.34″ | 27″ / 5″ | 66″ × 14″ |

- **Why this matters.** The barycentric frame cannot fit a main-belt arc: the Sun's own motion around
  the barycentre is not a small correction inside Jupiter's orbit. Its 15′ region would make the
  identification radius larger than the 0.5° cutout cap, so recovery would almost certainly be
  ambiguous.
- **Decision.** The user chose the heliocentric two-body as the primary model in chat, just before 05:52 UB.
- **What changes:**
  - **Primary** (identification region, scoring, calibration): heliocentric two-body, with everything
    else in section 4 unchanged (v2 resampling envelope, synthetic model error, spacecraft term).
  - **Secondary** (still frozen, scored on the same identified positions, reported next to the
    primary): barycentric two-body, method v2 as originally instructed.
  - The straight-line baseline is unchanged.

## Amendment, 15 Nov 2026 05:53 UB: one frame rule for the whole batch; excess scatter covered (user's instruction)

Made before any forecast was frozen and before any evaluation pixel was opened; no outcome is known.

1. **One rule, not per object.** The heliocentric two-body is the primary model for every object in the
   batch. Main-belt asteroids orbit inside Jupiter, so the heliocentric two-body is the standard
   approximation; the barycentric frame suits distant bodies such as Pluto. The frame is never chosen
   per object from its fit. The barycentric v2 forecast stays the frozen secondary for every object.
2. **Excess scatter.** The v2 Monte Carlo resamples the real residuals within each visit × detector
   group, so in principle it reflects scatter beyond the formal errors. To make sure, the formal
   parameter covariance is used as a third estimate. It is already scaled by max(1, χ²/dof) in
   `postmortem.fit`, and is propagated to each evaluation time. Along and across the track separately,
   C_fit takes the largest of the Monte Carlo, the jackknife and this scaled formal estimate. The basis
   that won is recorded per axis (`formal_scaled_by_chi2` when the scaled formal covariance is the
   largest).
3. **Planetary perturbations.** Unchanged: C_model, the synthetic N-body two-body error (Sun, Jupiter,
   Saturn, Uranus, Neptune; 24 orbits per object), is added to C_fit. C_pred = C_fit + σ_g² + the
   spacecraft term + C_model.
4. **Further choices** in A9 are made by Session A as the recommended option and written here (the user
   is asleep).

**Timestamp correction (05:55 UB).** The two amendment headings above first said 03:25 and 03:40 UB.
Those were Session A's mistaken estimates of the clock. The git commit times are authoritative:
`3dfd962` at 05:52:43 and `4d7a076` at 05:53:38 UB. Both amendments were still made before any
forecast was frozen and before any evaluation pixel was opened.

## Results (verified 15 Nov 2026, 06:10–06:36 UB; published in `9cf2bfd`)

- **Freeze:** `61b3cb7`, pushed 06:03 UB. **Receipts:** `ffe833f`. **Raw MOST tables and integrity
  test:** `358d487`. No file in the freeze commit holds an evaluation-row position.
- **Evaluation pixels** were opened only afterwards (06:10–06:30 UB). Cutouts were centred on the frozen
  primary forecast, each with a static reference image of the same detector.

**Primary (heliocentric two-body) under the frozen Pluto rules**

| Object | Status | Why | Frozen 95% region (along × across) | Horizons − forecast (after the verdict) |
|---|---|---|---|---|
| 345 Tercidina | **hit** (D² 0.12, error 6.5″) | 5 of 5 exposures identified, motion consistent | 66″ × 14″ | 6.4″; observed − Horizons 0.12″ |
| 491 Carina | insufficient data | no source fitted within the 34″ search radius in 4 exposures | 28″ × 7″ | 3.4″ (D² 0.09) |
| 1021 Flammario | insufficient data | forecast 2–4 px from the detector edge; no fit succeeded | 16″ × 10″ | 6.5″ (D² 2.0) |
| 363 Padua | ambiguous | motion inconsistent (3 exposures agree at 6.7″, one other passing candidate at 42″) | 56″ × 11″ | 6.8″ (D² 0.39) |
| 714 Ulula | ambiguous | several passing candidates in 5 exposures | 103″ × 65″ | 35″ (D² 0.70) |
| 162 Laurentia | ambiguous | several passing candidates in 7 exposures | 286″ × 22″ | 55″ (D² 0.23) |
| 379 Huenna | ambiguous | several passing candidates in 7 exposures | 143″ × 9″ | 62″ (D² 1.45) |
| 286 Iclea | insufficient data (frozen) | one training visit left | — | — |

**Calibration (pre-registered):**
- Primary: **1 of 1 scored forecast inside its 95% region.** The 95% Clopper–Pearson interval for the
  true coverage is 0.025–1.0 (Wilson 0.21–1.0); a perfectly calibrated method expects 0.95.
- One scored object cannot test calibration. The independence assumption (section 6) is moot at N = 1.
- Secondary (barycentric v2) on the same position: also inside (D² 0.32), with a 932″ region and a
  186″ error.
- Straight line: missed by 3.1° (D² 32).

**Exploratory, not counted: the catalogue truth inside the frozen regions.** After the verdicts, JPL
Horizons (moved to the spacecraft) was compared with the frozen forecast at every evaluation exposure.
- Primary: the median D² against the frozen C_pred is ≤ 5.991 for **7 of 7** objects (Clopper–Pearson
  0.59–1.0). Secondary: also 7 of 7.
- Median position errors of the primary: 3.4–62″.
- The forecasts and their regions were right. The recovery step failed.

**Why recovery failed (exploratory diagnosis):**
- SPHEREx's pipeline flags a moving asteroid's pixels as **OUTLIER** ("Pixel flagged by Detect
  Outliers") in many exposures, because it appears only once on that patch of sky. Our frozen mask
  policy (`tenger-mask-v1`) rejects OUTLIER pixels.
- At 491 Carina's true position the asteroid has S/N 41–48 in the D2 exposures, but its pixels carry
  OUTLIER.
- Re-running the identical recovery with only OUTLIER-flagged pixels kept
  (`docs/exposure/asteroids/exploratory-outlier.json`):

  | Object | With OUTLIER kept | Measured − Horizons |
  |---|---|---|
  | 491 | **hit**, D² 0.08 | 0.18″ |
  | 1021 | **hit**, D² 1.94 | 0.20″ |
  | 345 | unchanged hit | — |
  | 363, 714, 162, 379 | still ambiguous | — |

- The four still-ambiguous objects have large search regions (127–350″ radius) in crowded fields,
  where one static reference image (another wavelength, another depth) does not reject every real star.
- None of this counts. It says what to change next time:
  - keep OUTLIER pixels when searching for a moving object;
  - use several static references;
  - use an N-body model instead of a two-body model plus model error, to shrink the regions.
