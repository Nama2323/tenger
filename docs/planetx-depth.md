# Could SPHEREx see Planet X? We measured it (Task A8)

**What this is.** A measurement of how faint a point source one SPHEREx exposure can find, made by adding
artificial sources of known brightness to real exposures and running the site's own measurement on
them. It is then compared with published Planet Nine brightness predictions in the same bands. Nothing
here is a detection, a trial or a scoreboard entry. Every derived file carries `"artificial": true` and
`"counts": false` (`static/data/planetx/`, contract V12). Numbers come from
`static/data/planetx/depth.json`, which `python -m scripts.planetx all` regenerates (seed 20261115).

## Results

### Single-exposure depth (pooled over seven fields, six exposures each)

Each band row pools all 7 fields × 6 exposures × up to 12 positions at each magnitude.

| Band | Channels used | 50% depth (AB) | 90% depth (AB) | 50% at the site's S/N ≥ 10 | Optimal-fit S/N 5 (reference) | False detections |
|---|---|---|---|---|---|---|
| I (0.8 µm, D1) | 0.750–0.870 µm | **17.09** (17.01–17.18) | 15.40 (15.21–15.57) | 16.50 | 18.0–18.8 | 0 / 705 (≤ 0.5%) |
| W1 (3.4 µm, D4) | 3.253–3.537 µm | **17.48** (17.40–17.54) | 16.03 (15.76–16.29) | 16.79 | 17.6–19.0 | 0 / 713 (≤ 0.5%) |
| W2 (4.6 µm, D6) | 4.453–4.748 µm | **16.16** (16.11–16.20) | 15.40 (15.17–15.53) | 15.42 | 16.6–17.4 | 0 / 717 (≤ 0.5%) |

- Ranges are where the 95% Wilson band crosses the level.
- The curves run from ≥ 99% to 0% recovery in every band (`grid_spans_full_range: true`).
- The site's Gaussian fit plateaus below 100% until about AB 15. Real isolated stars show the same
  behaviour (realism check below).
- "Optimal-fit S/N 5" is the brightness at which a fit with the true ePSF would reach S/N 5,
  computed from each exposure's VARIANCE. It is a reference, not a recovery measurement.

**Per field.** 50% depths range by field:
- 0.8 µm: 16.0 (Barnard's crowded field) to 17.5 (Makemake);
- 3.4 µm: 16.6 (R Dra, near the bright Mira) to 17.8 (Makemake);
- 4.6 µm: 15.9 to 16.4.

Each field's median ZODI is listed. For example, at 4.6 µm the ZODI runs from 0.28 MJy/sr (Barnard)
to 0.51 MJy/sr (RW Aur). RW Aur, with the brightest zodiacal light, is among the shallowest fields,
but crowding and bright stars (Barnard's Star, R Dra) matter as much.
`depth.json` gives every field's curve and intervals.

**Checks.**
- *PSF zone mapping* (789 isolated Gaia stars):
  - The nearest-centre zone fits better than the x/y-swapped zone for 61% of stars (95%:
    58–65%), and for 75% at 0.8 µm, where the PSF changes most across the detector.
  - All 126 tables have the stated ordering.
  - Picking the swapped zone would change the depth by only 0.01–0.02 mag (largest 0.11 mag).
- *Flux scale*: an ePSF fit on the injected frame (real noise and background included) returns a
  median 97.0% / 96.6% / 99.5% of the injected flux at 0.8 / 3.4 / 4.6 µm.
  - The pulls are 1.1–1.7 times wider than VARIANCE predicts.
  - We read the small low bias as a selection effect: positions chosen away from catalogued sources
    are slightly emptier than the surrounding sky the fit uses.
- *Realism*: the site's fit finds real isolated stars as often as injected sources of the same
  measured brightness where both are bright.
  - Example at 0.8 µm: real stars 13.5–15.0 found 68/68, injections 2,859/2,904.
  - At the faint end real stars are found less often, as expected when noise scatters faint stars to
    brighter measured values.

### Planet Nine against one exposure

`gap` = model magnitude − our pooled 50% depth. Positive means too faint for one exposure.

| Prediction (AB) | I 0.8 µm | W1 3.4 µm | W2 4.6 µm |
|---|---|---|---|
| Our 50% single-exposure depth | 17.09 | 17.48 | 16.16 |
| Linder & Mordasini, 10 M⊕ at 700 AU | 21.45 (gap **4.4**, ×55 in flux) | 22.80 (gap **5.3**, ×134) | 23.44 (gap **7.3**, ×810) |
| … at perihelion, 280 AU (paper's rule) | 17.45 (gap 0.4) | 18.80 (gap 1.3) | 19.44 (gap 3.3) |
| … at aphelion, 1120 AU (paper's rule) | 23.45 (gap 6.4) | 24.80 (gap 7.3) | 25.44 (gap 9.3) |
| Fortney et al., 50 K, methane 10⁻⁶ (their brightest) | — | 18.80 (gap 1.3) | 20.54 (gap 4.4) |
| Fortney et al., 50 K, methane 10⁻³ | — | 21.70 (gap 4.2) | 20.54 (gap 4.4) |
| Fortney et al., 40 K, methane 10⁻⁶ | — | 23.20 (gap 5.7) | 26.14 (gap 10.0) |
| Fortney et al., 40 K, methane 10⁻¹ | — | 30.30 (gap 12.8) | 26.54 (gap 10.4) |
| WISE + NEOWISE search limit (Meisner et al. 2018, 90%) | — | 19.40 (gap 1.9) | — |

The gaps' statistical uncertainty is only ±0.02–0.04 mag (from our depth interval). The real
uncertainty is model-dependent and much larger:
- The papers' magnitude systems (Vega→AB offsets of 0.45, 2.70 and 3.34 mag) matter.
- So does the band-versus-channel difference. Methane absorbs near 3.3 µm, so for a methane-bearing
  atmosphere our 3.25–3.55 µm channels see less than the W1 average and the gap grows. A channel inside
  a methane window would see more and the gap would shrink.

**Verdict.**
- One SPHEREx exposure cannot see the nominal Planet Nine of Linder & Mordasini: it is 4.4 mag too
  faint at 0.8 µm, 5.3 mag at 3.4 µm and 7.3 mag at 4.6 µm.
- Only two published cases come within about a magnitude of one exposure:
  - Linder & Mordasini's planet at perihelion, at 0.8 µm. It sits 0.4 mag beyond our 50% depth, and
    one exposure finds 28% of artificial sources that faint (interpolated between AB 17.25 and 17.5): about
    1 time in 4. This is the only `planetx.verdict.partial` row. The paper itself expects Planet Nine near
    aphelion.
  - Fortney et al.'s most extreme 50 K methane-poor atmosphere, at 3.4 µm (1.3 mag).
- At 3.4 µm a single exposure is 1.9 mag shallower than the region WISE and NEOWISE already searched
  (W1 < 16.7 Vega).

### Why a real search needs shift-and-stack

Seen from Earth, a body at 300–1000 AU moves with the observer's parallax. The full numbers are in
`depth.json`, `motion[]`, at the five challenge fields' real visit times:
- **Within one visit** (visits last 0.8 to 72 days):
  - 300 AU: 4″ to 790″;
  - 1000 AU: 1″ to 240″;
  - typical rates of 0.7–12″ per day (both ends).
- **Between visits** about six months apart:
  - 300 AU: 530″–1370″;
  - 1000 AU: 160″–410″.

The PSF is about 6–9″ across, so the planet's light falls on different pixels in different exposures. A
search has to stack along trial paths for each distance and direction (as Meisner et al. did with
WISE).

**Projection, not a measurement.** If noise fell as 1/√N, stacking N exposures along the right path
would reach:
- N = 4: AB 17.8 / 18.2 / 16.9 (0.8 / 3.4 / 4.6 µm);
- N = 16: 18.6 / 19.0 / 17.7;
- N = 100: 19.6 / 20.0 / 18.7.

Even 100 exposures would leave the nominal planet 1.9–4.8 mag out of reach. At 3.4 µm that stack would
go only 0.6 mag deeper than the WISE limit.

The mission's published sensitivity is per spectral channel after all four surveys (pre-launch, 5σ):
19.55 at 0.806 µm, 19.77 at 3.393 µm and 18.17 at 4.593 µm. It is not a per-exposure figure. The
pre-launch single-visit estimates (AB 18.5–19 below 3.8 µm, 16.6–18 above) match our optimal-fit
reference levels.

### Hidden-planet game (`hidden-planet.json`, artificial)

Four pairs of real exposures of one field, 4–10 days apart. Each has one artificial source moving as a
body 500 AU away would (8.6″–71″ between the frames), injected 0.25–0.5 mag brighter than the
field's 90% depth:
- Epsilon Indi B at 0.8 µm;
- RW Aur at 3.4 µm;
- WISE 0855 at 4.6 µm;
- R Dra at 4.6 µm, near the bright star.

The site's fit, started at the injected positions, recovered all four in both frames (S/N 8–33). Barnard's
field was tried first; no position stayed clear of catalogued sources in both frames.


## Method

**Fields (all already exposed, `docs/EXPOSURE.md`).**
- The five challenge-target fields.
- The training visits of Pluto and Makemake (`role: training` in their investigations).
- Never the reserved 3I/ATLAS path, and never Pluto's 2026 evaluation visit.
- Per field and band, six usable exposures spread evenly in time. They were re-downloaded from IRSA with
  their EPSF extension, and each file's SHA-256 equals the `source_sha256` recorded in the investigation
  (126 of 126).

**Bands.** Three SPHEREx wavelength windows match the published Planet Nine bands:
- 0.75–0.87 µm on detector 1 (Johnson I, about 0.8 µm);
- 3.25–3.55 µm on detector 4 (WISE W1, 3.4 µm);
- 4.45–4.75 µm on detector 6 (WISE W2, 4.6 µm).

Each exposure measures one narrow spectral channel inside its window, at the wavelength SPHEREx's
filter gives at that pixel.

**PSF.** Each frame's own `EPSF` extension.
- DR1 and QR3 files (software 7.0.5) carry the ePSF as a binary table: 441 zones on a 21 × 21 grid,
  each 33 × 33 samples, 5× oversampled (1.23″ per sample), pixel-convolved. Rows are ordered
  "x-fast then y", so zone (x, y) is row `y·21 + x`.
- The rule in the task (`iplane = y·11 + x + 1`, 121 zones, 10× oversampled, 0.615″) describes the
  older PSF cube of QR1/QR2 files. It uses the same x-fast ordering. IRSA's tutorial says files of
  version 7.0 and later use the ePSF table.
- We take the zone whose centre (XCENTER, YCENTER, in parent-image pixels via `CRPIX1A/2A`) is
  nearest the source.
- The mapping was tested on bright isolated stars before any injection (see the PSF check below).

**Injection** (in memory only; `backend/injection.py`).
- A source of AB magnitude m has F_ν = 3631 Jy × 10^(−0.4 m).
- It is added to a copy of IMAGE as F_ν × ePSF ÷ (pixel solid angle from the WCS), in MJy/sr.
- VARIANCE, FLAGS and ZODI are unchanged. Nothing is written to `data/`, `cache/` or any original.

**Positions.** 12 injection positions and 24 blank positions per exposure, chosen at random:
- no pixel rejected by `tenger-mask-v1` within 2.5 px;
- no Gaia DR3 or AllWISE source within 15″ (VizieR via the CfA mirror, because IRSA TAP returned errors);
- more than 30″ from the target at the cutout centre and from each other;
- at least 5 px from the edges.

One source at a time; magnitudes in 0.25-mag steps spanning full to zero recovery.

**Recovery.** The site's own fit, `backend.astrometry.fit_position`:
- a pixel-integrated Gaussian with VARIANCE weights and a 15″ radius, started at the injected position;
- found = a measured position with S/N ≥ 5 within 1 native pixel (6.15″).

The site's astrometry normally uses S/N ≥ 10, so that threshold is reported too. The module constant
is set only during the call, and the file is unchanged (its hash is part of frozen forecasts).

**Blank controls.** The same fit at the blank positions with nothing injected. The false-detection
rate per field and band, with a 95% Wilson interval.

**Statistics.**
- Recovered fraction per magnitude with 95% Wilson intervals.
- The 50% and 90% completeness magnitudes come from a monotone (isotonic) fit of the fractions.
- Their range is where the pointwise Wilson band crosses the level.
- Results are given per field and band, and pooled per band.

## Published Planet Nine brightness (only what the papers state)

| Source | Where | What we use |
|---|---|---|
| Linder & Mordasini 2016, A&A 589, A134, doi:10.1051/0004-6361/201628350 | Abstract and Sect. 4.2 (arXiv:1602.07465v2) | 10 M⊕ at 700 AU, blackbody spectrum, Vega-based: I = 21.0, W1 = 20.1, W2 = 20.1. Sect. 4.2 rule for reflected light: 4 mag brighter at perihelion (280 AU), 2 mag dimmer at aphelion (1120 AU). The paper gives no I, W1 or W2 for other masses (only V and Q), so none are used |
| Fortney et al. 2016, ApJL 824, L25, doi:10.3847/2041-8205/824/2/L25 | Table 2 (622 AU, cloud-free, Neptune radius) | W1, W2 for 40 K and 50 K with methane 10⁻¹, 10⁻³, 10⁻⁶. The magnitude system is not named; the paper compares W1 with WISE's Vega limit (Sect. 5), so we read Vega |
| Meisner et al. 2018, AJ 155, 166, doi:10.3847/1538-3881/aaae70 | Abstract, Sect. 6 and 8 | No Planet Nine at W1 < 16.7 (90%) / 16.86 (50%) in high-latitude regions, WISE and NEOWISE coadds, 250–2250 AU |
| WISE All-Sky Explanatory Supplement IV.4.h | Table 3 | m_AB = m_Vega + 2.699 (W1), + 3.339 (W2) |
| Blanton & Roweis 2007, AJ 133, 734, doi:10.1086/510127 | Table 1 | I (Bessell 1990 curve, λ_eff 7994 Å): m_AB − m_Vega = 0.45. Linder & Mordasini call their band Johnson I; the curves may differ slightly |
| SPHEREx Public-products, Point_Source_Sensitivity_v28_base_cbe.txt | file and README | Pre-launch, full 2-year mission, per spectral channel, 5σ AB: 19.55 (0.806 µm), 19.77 (3.393 µm), 18.17 (4.593 µm) |
| Crill et al. 2025, ApJS 281, 10 (arXiv:2505.24856) | Abstract, Sect. VII, Figs. 16–17 | Pre-launch single-visit 5σ per channel: AB 18.5–19 (0.75–3.8 µm), 16.6–18 (3.8–5 µm). Four visits make the all-sky survey about 2× deeper (Sect. VII) |

The mission's published sensitivities are per spectral channel after all four surveys, not per
exposure. Our numbers are per exposure. A 5σ optimal-photometry limit and a 50% completeness of a
Gaussian-fit detector are also different definitions; the comparison is indicative.

## Limits

- Single exposures, one spectral channel each. Not the full mission and not a stacked search.
- The site's Gaussian fit is less sensitive than an optimal ePSF fit. The depths are those of the site's
  pipeline, not of SPHEREx's best possible photometry.
- The injected source's photon noise was not added (the zodiacal background dominates at these levels).
- Six exposures per field and band. Per-field curves are coarse, and the pooled curve is the main result.
- Broad-band model magnitudes are compared with narrow channels as if F_ν were flat across the band.
  For Fortney's methane spectra, a channel inside a window would be brighter and one inside a methane
  band fainter than the band average.
- Catalogue exclusion uses Gaia DR3 and AllWISE. Unlisted faint sources can still sit under an
  injection, and the blank controls measure that effect.

## Verdict classes (15 Nov 2026, website rule)

Each verdict row has `recovered_fraction`. This is the pooled curve's found fraction at the model
magnitude, linear in magnitude between the two neighbouring tested magnitudes. Fainter than the faintest
test there is no value, only that point's upper 95% bound. The classes are:
- `planetx.verdict.within-depth` when gap ≤ 0;
- `planetx.verdict.too-faint` when the fraction, or that upper bound, is below 5%;
- `planetx.verdict.partial` otherwise.

The other 17 rows are 0% or beyond the curve, with upper bounds of 0.8% or less.

