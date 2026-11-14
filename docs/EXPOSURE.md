# Exposure inventory (Task A1, 14 Nov 2026)

Owner: Session A (science/data). Written **before any new SPHEREx pixels were opened** for TENGER.
Machine-readable record: [`docs/exposure/`](exposure/) (one JSON per target, `summary.json`,
`SHA256SUMS`). Regenerate with:

    .venv/bin/python -m scripts.exposure_inventory --network --out docs/exposure

The script reads metadata only: committed `meta.json` files, cache file names, the earlier audit
record, IRSA SIA listings, JPL Horizons ephemerides and the official 3I/ATLAS table. It never requests
an `access_url`, a cutout or pixels. Listings were taken 14 Nov 2026 between 11:31 and 11:41 UTC
against git `58f993b`.

## The rule

> **Nobody opens the pixels of a candidate observation listed here (cutout, full download, the app's
> live mode, IRSA Viewer/Firefly, the Spectrophotometry Tool, wget scripts, thumbnails or spectra
> made from them) until the trial that reserves it has a committed `prediction.json` and a written
> receipt (`docs/DATA-CONTRACT.md` §5–6).** Reading metadata rows (obs_id, time, band, footprint) is
> allowed. Anything opened early moves to the exposed set and that trial can no longer be
> `prospective_unexposed`.

Additional rules:

1. **Exposure is per `obs_id`, not per array.** SPHEREx's six arrays image the same field at the same
   moment, so opening one array of an exposure reveals the target's position (and brightness phase)
   for the other five. Releases do not matter either: the QR2 product of an exposure that was
   bundled exposes the DR1 product of that same exposure.
2. **Same-visit observations are not independent.** An unopened exposure taken within
   10 days of an exposed one (inventory field `shares_visit_window_with_exposed`) can only support a
   `retrospective_holdout` trial. At 10.4″/yr, Barnard's Star moves about 0.03″ per day.
3. **Anything newer is reserved automatically.** Any observation of a target with `t_min` later than
   that target's newest exposed observation (table below) is in the reserved set from the moment it
   appears in a future release. It can support a prospective trial only if it is also more than
   10 days from every exposed observation (rule 2).
4. **Traps that open pixels without meaning to:**
   - *App live mode.* Typing coordinates (instead of `?target=key`) or changing the FOV of a prepared
     target starts a live job that downloads up to 150 current exposures. That happens on localhost
     and on the public Render server. Until predictions are frozen, do not start live jobs within 2°
     of any of the eight targets. For Makemake and Pluto that means anywhere along their 2025–26
     paths: Makemake at RA 199.8–202.4°, Dec +20.1–+21.6° (observed visits); Pluto at RA
     304.1–308.6°, Dec −23.8 to −22.8°. Add the 2° margin to both. Use other fields to test live
     mode.
   - *Bake.* `python -m scripts.bake` and the "Bake frames" GitHub Action (weekly cron Monday
     04:17 UTC, plus manual dispatch) download new frames for the five challenge targets. Do not run
     either before predictions are frozen. The next scheduled run is Mon 16 Nov 04:17 UTC, after the
     deadline. That run happens only if Actions are enabled on the repository's default branch.
   - Opening any `access_url_not_opened` link in `docs/exposure/*.json`.
5. **A commit is a version reference, not proof that nobody looked.** Before a trial is labelled
   `prospective_unexposed`, every teammate states in the team chat that they have not opened those
   observations by any route. The trial manifest records that statement.

## Task A3 change (14 Nov 2026, from 21:10 UB): what is now opened

Decided by the team for Task A3 (phases C–D). It changes the exposed set as follows.

- **Five challenge targets: everything is opened.** A1 found that the newest observation of each is
  already exposed, so they can only support `retrospective_holdout` trials anyway. Session A downloads
  and processes **every DR1/QR3 exposure** listed at each target's field centre, including the
  same-visit exposures that A1 listed as never opened (`scripts/acquire.py`, fixed 0.1° field,
  cutout 0.145°). From now on every current DR1/QR3 observation of Barnard, WISE 0855, Epsilon Indi B,
  RW Aurigae and R Draconis counts as exposed. The exact obs_keys opened are listed in each target's
  `static/data/<key>/investigation.json` (`observations`). Opened 14 Nov 21:10–22:10 UB: Barnard
  356 of 358, WISE 0855 256 of 258 (2 failed downloads each, never opened), Epsilon Indi B 460 of
  460, RW Aurigae 335 of 335, R Draconis an even sample of 300 of 2,493 (the other 2,193 were not opened,
  but they count as exposed for trials anyway because they share visits with opened frames).
- **Makemake and Pluto: training visits only.** Opened: every visit in the table below except the
  newest. **Still closed** until Task A4 has frozen and pushed the predictions: Makemake 2026-05-30 →
  06-13 (QR3, 65 obs_ids) and Pluto 2026-09-29 → 10-02 (QR3, 10 obs_ids). The acquisition code
  refuses any exposure with `t_min` inside a closed window. The visits actually opened are listed in
  the "Opened in A3" table further down when they are processed.
- **3I/ATLAS:** See-only, never a trial, so its pixels may be opened for viewing. Cutouts follow the
  comet using the positions in the official exposure table (`scripts/acquire_body.py 3i-atlas`).
- **Opened in A3** (training visits, object-following cutouts 0.0725°, plus one fixed-sky pair):

  | Body | Visit (UTC) | Rows opened | Release | Processed | Opened (UB time) |
  |---|---|---:|---|---:|---|
  | Makemake | 2025-05-30 → 06-19 | 111 | DR1 | see below | 14 Nov, 21:15–21:37 |
  | Makemake | 2025-07-04 → 07-06 | 14 | DR1 | see below | same run |
  | Makemake | 2025-12-28 → 2026-01-09 | 111 | DR1 | see below | same run |
  | Makemake | **2026-05-30 → 06-13** | **0 (closed)** | QR3 | — | — |

  | Pluto | 2025-04-25 → 05-01 | 10 | DR1 | see below | 14 Nov, 21:34–22:00 |
  | Pluto | 2025-09-25 → 10-12 | 109 | DR1 | see below | same run |
  | Pluto | 2026-04-25 → 05-02 | 97 | DR1 | see below | same run |
  | Pluto | 2026-05-12 | 2 | DR1 | see below | same run |
  | Pluto | **2026-09-29 → 10-02** | **0 (closed)** | QR3 | — | — |

  Makemake total: 236 rows requested, 234 processed, 2 failed after retries. Pluto: 218 requested,
  218 processed. Each body also has a fixed-sky pair that re-uses two of its training exposures
  with a different cutout centre (Makemake `2025W22_2B_0258_1` D3 + `2025W23_1C_0121_1` D3; Pluto
  `2025W40_2B_0346_4` D3 + `2025W41_1A_0285_1` D3). The newest exposure opened is MJD 61049.26
  (Makemake) and 61172.96 (Pluto); the holdout windows start at MJD 61190.77 and 61312.68.
- Live jobs near the targets remain blocked in the web app (`static/js/reserved.js`, and
  `static/data/reserved.json` from A3).

## Team confirmation for Task A4 (recorded 14 Nov 2026, 22:35 UB, before any prediction)

Statement passed to Session A in the A4 task message, recorded as given. The message left two template
placeholders unfilled. The name was supplied in the A5 task message (14 Nov 2026, 23:12 UB) and is filled
in below; see "Team confirmation update for Task A5".

- **Viewer:** **Narmandakh** (name supplied at A5; the A4 record read "[Name]"). He downloaded and
  inspected SPHEREx cutouts of:
  - **Makemake** on 2025-05-31, 06-01, 06-02, 06-11, 12-28, 12-29, 12-30, 12-31 and 2026-01-01, 01-03,
    01-05, 01-09, **06-09, 06-12** (UTC);
  - **Pluto** on 2025-10-04 and 10-06 (detectors D2 and D3) and 2026-04-30 15:57:59 UTC (D2).
- **Other teammates:** "[confirmed none / not answered yet]". The choice was not filled in, so Session A
  records it as **not answered yet**. Every trial that depends on it carries `"confirmation_pending": true`.
- Rule: seeing any exposure of a visit counts as seeing that visit.

Mapped onto the visits in the inventory:

| Body | Visit (UTC) | Role | Seen by the team? |
|---|---|---|---|
| Makemake | 2025-05-30 → 06-19 | training | yes (05-31, 06-01, 06-02, 06-11) |
| Makemake | 2025-07-04 → 07-06 | training | not reported |
| Makemake | 2025-12-28 → 2026-01-09 | training | yes (8 dates) |
| Makemake | **2026-05-30 → 06-13** | **evaluation** | **yes (06-09, 06-12)**: the Makemake trial can only be `retrospective_holdout` |
| Pluto | 2025-04-25 → 05-01 | training | not reported |
| Pluto | 2025-09-25 → 10-12 | training | yes (10-04, 10-06; D2, D3) |
| Pluto | 2026-04-25 → 05-12 | training | yes (04-30 15:57:59, D2) |
| Pluto | **2026-09-29 → 10-02** | **evaluation** | **not reported by the viewer; other teammates pending** |

Consequences: Makemake's evaluation visit is exposed (retrospective). Pluto's evaluation visit is
not known to be exposed. A Pluto trial fitted only to our training positions may be
`prospective_unexposed` with `"confirmation_pending": true` until every teammate has answered. Neither
Session A nor this repository has opened any pixel of either evaluation visit. Horizons positions for
the evaluation exposures do exist in `docs/exposure/<key>.json` and `static/data/reserved.json`: the
A1 coverage check computed them. The A4 prediction code never reads them (tested).

## Team confirmation update for Task A5 (recorded 14 Nov 2026, 23:12 UB, before any evaluation pixel was opened)

Statement passed to Session A in the A5 task message, recorded as given:

- **Narmandakh** did the earlier research. The Makemake viewing recorded in A4 (2025-05-31 to
  2026-06-12) was his.
- **Pluto, pixels:** he opened exactly five Pluto cutouts, all outside the evaluation window:
  2025-10-04 01:09:28 UTC (D3), 2025-10-04 23:58:26 UTC (D2), 2025-10-06 02:05:55 UTC (D3),
  2025-10-06 13:30:36 UTC (D2) and 2026-04-30 15:57:59 UTC (D2). He downloaded them from IRSA (Moving
  Object Search Tool and SPHEREx Cutout Service) and opened them locally in Python.
- **Pluto, metadata only:** for 2026-09-29, 10-01 and 10-02 (the evaluation visit) he saw only the
  archive listing records, never any pixels. Those records may include JPL-predicted positions. Our
  forecast did not use those listings: it was computed from `training.json` alone (A4, tested).
- **Other teammates:** the other three have **not answered yet**.

Consequences:

| Trial | Effect |
|---|---|
| `pluto-position-2026b` | Stays `prospective_unexposed` with `confirmation_pending: true` until all four have confirmed. A teammate saw the **metadata** of the evaluation visit, possibly including JPL-predicted positions. That is an exposure of the ephemeris, not of the SPHEREx pixels, and the forecast did not use it. It is recorded here and in `verification.json` as a limitation. |
| `makemake-position-2026a` | Unchanged: `retrospective_holdout` (evaluation visit viewed). |

Session A opens Pluto's evaluation pixels only after this record is committed and pushed, through
`scripts/verify.py`, with cutouts centred on the frozen model (not on the listing's positions).

## Task A5 (14 Nov 2026, from 23:17 UB): evaluation data opened for verification

- **Pluto evaluation visit opened** at 2026-11-14 15:17:11 UTC (23:17 UB) by `scripts/verify.py
  acquire-pluto`. That was after the team update above was pushed (`63d53bd`) and after the frozen
  prediction's receipt was checked. All 20 rows (10 obs_ids, D3 and D6, QR3) were requested as cutouts
  centred on the **frozen model** position, never on the listing's positions. From this moment that
  visit is exposed.
- Barnard and Epsilon Indi B: their holdout visits were already opened in A3. Verification reused the
  A3 measurements.
- JPL Horizons was queried for Pluto only **after** the Pluto verdict was computed, for the separate
  comparison in `verification.json` (`after_verdict_comparison`).

## Task A4 (14 Nov 2026, 22:35–22:55 UB): predictions frozen, nothing opened

A4 opened, downloaded, rendered or measured **no pixels**. It made no Horizons query and read no
catalogue position at an evaluation epoch. Training measurements came from the A3 evidence files:
Makemake and Pluto training visits only, and the challenge targets' non-holdout visits. Prediction
code reads only `static/data/trials/<id>/trial.json` and `training.json` (tested). Trial manifests
were committed and pushed (`486e723`) before any prediction, then each prediction (`6c13e88` …
`7afe037`), then the receipts (`ba1d3c8`). The Makemake and Pluto evaluation visits stay closed in
`static/data/reserved.json` (`until_key: reserved.until-verified`) until Task A5's pre-registered
verification opens them.

## Task A8 (15 Nov 2026, 02:00–05:30 UB): nothing new opened

Task A8 (Planet X depth) re-downloaded **127 exposures that were already opened**, this time with
their EPSF extension, into `cache/planetx/source/`:
- 126 planned exposures: six per field and band on the five challenge-target fields, and on Pluto's
  and Makemake's training visits (`role: training` only);
- 1 more R Dra field exposure for a game pair.

Every file's SHA-256 equals the `source_sha256` that its investigation recorded when it was first
opened, so these are the same bytes that were opened before. Nothing was taken from Pluto's 2026
evaluation visit, from Makemake's 2026 evaluation visit or from the reserved 3I/ATLAS path.
Artificial sources were added only in memory. The derived files under `static/data/planetx/` are
labelled `"artificial": true` and never count as observations.

## A9 rule for MOST (user's rule, 15 Nov 2026, about 02:40 UB, before any asteroid selection)

IRSA's Moving Object Search Tool (MOST) returns JPL-predicted positions for every exposure, including
an object's evaluation visit. For an asteroid forecast to count as `prospective_unexposed`, nobody,
Session A included, may see the ephemeris position at the evaluation time before the batch is frozen
and pushed.

1. MOST positions are used only for training exposures. Each object's evaluation visit is picked from
   exposure times alone (the newest visit cluster).
   - Before anything is printed, logged or saved, every evaluation-visit row is reduced in memory to
     `observationid`, `productid` (detector), `uri` (file path), `mjd_start`, `mjd_end` and `match`
     (in footprint).
   - RA/Dec, rates, magnitudes, distances, phase and the image's own corners and centre are dropped.
   - Raw MOST tables are saved only after the freeze push.
2. The 15″ star check at the evaluation time is blind: code computes it and keeps only pass/fail.
3. An object whose evaluation-time predicted position has already appeared in Session A's output or
   files is excluded from the batch, or included only as `catalogue_assisted`.
4. `tests/test_asteroids_integrity.py` checks that nothing committed before the freeze contains
   evaluation-time ephemeris values.

**Already exposed before this rule (excluded):**
- **1000 Piazzia.** During the A9 feasibility check (15 Nov 2026, 02:33–02:34 UB), its full-period MOST
  table was fetched into scratch files (`a1000.html`, `a1000_full.tbl`, `a1000_results.tbl`). That table
  holds JPL positions and V for both of its DR1/QR3 visits.
  - Printed to the session: visit start times, spans, counts, releases and detector counts, and the V
    range of its first visit only. No position was printed.
  - The files were deleted at 02:38 UB.
  - Piazzia has only two DR1/QR3 visits, so the selection rule (three visits) would reject it anyway.
    It is excluded by name too.
- **Makemake.** A one-month MOST query (2025-05-25 to 06-25, inside its exposed training period) tested
  the service. Makemake is not an asteroid-batch candidate.
- **Nothing else.** No other object's MOST or Horizons data had been requested. The JPL SBDB pool query
  returns names, H and orbit class only.

## Task A9 (15 Nov 2026, from 02:55 UB): the asteroid batch (team statement pending)

**Selection:** applied at 02:55 UB by `python -m scripts.asteroids select`, under the rules committed
and pushed first (`b9ef625`, `docs/asteroid-batch.md`). Record: `docs/exposure/asteroids/selection.json`.
- 32 candidates were examined in H order, and the first 8 that passed were taken.
- Evaluation-visit rows hold identifiers and times only; the star check kept pass/fail only.

**Exposure status: nobody on the team has opened these objects' images.** Narmandakh's earlier viewing
covered only Makemake and Pluto. `team_statement_pending: true` stays until the user confirms the team
statement in chat.

| Object | H | Training visits (MOST rows) | Evaluation visit (MJD, times only) | Evaluation exposures chosen | team_statement_pending |
|---|---|---|---|---|---|
| 491 Carina | 9.0 | 3 (342 exposures) | 61274.13–61275.56 | 4 | true |
| 1021 Flammario | 9.01 | 2 (269 exposures) | 61229.37–61229.50 | 4 | true |
| 363 Padua | 9.03 | 2 (217 exposures) | 61233.00–61286.02 | 10 | true |
| 714 Ulula | 9.03 | 2 (291 exposures) | 61278.65–61300.10 | 10 | true |
| 345 Tercidina | 9.04 | 2 (259 exposures) | 61296.80–61317.71 | 6 | true |
| 286 Iclea | 9.07 | 2 (121 exposures) | 61166.51–61214.97 | 10 | true |
| 162 Laurentia | 9.09 | 2 (275 exposures) | 61269.90–61280.75 | 10 | true |
| 379 Huenna | 9.1 | 2 (267 exposures) | 61299.62–61310.75 | 10 | true |

**Opened so far:** none.
- Training pixels are opened next, from MOST training rows only.
- Evaluation pixels are opened only after the batch is frozen and pushed.

## Who has seen what

- **Teammates** have viewed the bundled frames, thumbnails and results of the five challenge targets
  (team decision 8; `docs/tenger-context/context/KNOWN-STATE.md`). The bundled frames come from 2–7
  committed versions of each `meta.json` (6 to 9 Nov 2026 bakes), all published on the teammate's
  GitHub Pages site. All of them count as exposed. So do the 1,241 processed `.npz` frames in
  `data/frames/`. Every one of them also appeared in some bundled version.
- **Earlier audit (Codex, 14 Nov):** viewed the home previews, the Barnard viewer and the results table. It
  downloaded one DR1 cutout, `2025W33_2C_0321_1` D6 (Barnard field, 12×12 px). One QR3 cutout
  attempt returned HTTP 503 (no pixels). It ran fixed-position SIA metadata searches for Makemake,
  Pluto and 3I/ATLAS at a 15 Aug 2025 ephemeris position (metadata only) and downloaded the 3I/ATLAS
  table (metadata).
- **This session (Claude, Task A1):** opened `?target=` views of the five challenge targets (bundled
  data only, already exposed). For the cutout-service check it re-requested the audit's
  already-exposed cutout `2025W33_2C_0321_1` D6, checked only the HTTP status and the FITS `SIMPLE`
  card, and deleted the file. No candidate pixels were opened.
- **Unknown:** whether anyone used the public site's live mode (Render), IRSA Viewer or other tools on
  these positions. There are no logs. Rule 5 covers this.

## Summary per target

Archive listing = DR1 + DR1-deep + QR3 + QR3-deep rows whose footprint contains the target at the
exposure time. For stars the position comes from the preset's proper motion. For Makemake and Pluto
it comes from a geocentric Horizons ephemeris, which is good enough for coverage: the offset from
SPHEREx's low-Earth orbit is below 0.3″.

| Target | Exposed obs_ids (dates, releases) | Archive obs_ids now | Never opened | Newer than exposed | Prospective trial possible now? |
|---|---|---:|---:|---:|---|
| Barnard's Star | 166 (2025-08-15 → 2026-09-22; QR2 112, QR3 54, DR1 1) | 181 | 15 obs_ids in 4 visits, all sharing a visit with exposed frames | 0 | **No.** Retrospective only. Next SPHEREx visit expected about Feb 2027 |
| WISE 0855 | 129 (2025-05-05 → 2026-05-14; QR2) | 129 (DR1 only, no QR3 rows) | 0 | 0 | **No.** Every current exposure is exposed |
| Epsilon Indi B | 193 (2025-04-24 → 2026-10-02; QR2 143, QR3 50) | 238 | 45 obs_ids in 7 visits. Only 1 (2025-05-20, D3/D6) is ≥10 days from an exposed frame (12.9 d) | 0 | **No.** Retrospective only |
| RW Aurigae | 164 (2025-09-01 → 2026-09-16; QR2 110, QR3 54) | 168 | 4 obs_ids, all same-visit | 0 | **No.** Retrospective only |
| R Draconis | 255 (2025-04-24 → 2026-09-27; QR2 70, QR2-deep 119, QR3-deep 66) | 1,258 (deep field) | 1,003 obs_ids, all inside visit windows with exposed frames | 0 | **Not with current data.** Near the north ecliptic pole the coverage is almost continuous, so a QR3 release with observations after 2026-09-27 would be reserved automatically (rule 3) |
| Makemake | 0 | 184 (DR1 236 rows, QR3 127 rows) | 184 obs_ids in 4 visits | all | **Yes, conditionally** (see below) |
| Pluto | 0 | 120 (DR1 218 rows, QR3 20 rows) | 120 obs_ids in 5 visits | all | **Yes, conditionally** (see below) |
| 3I/ATLAS | 0 pixels by the team. Published SPHEREx team papers show these data | 133 obs_ids / 259 rows in the official table (`spherex_qr2` URLs, 2025-08-01 → 2025-12-14) | n/a | n/a | **See-only** (not a prediction target) |

QR3 products for these fields were released about 3–6 weeks after observation. The newest
`obs_release_date` seen is 2026-10-29. DR1 rows were released 27 Sep – 9 Oct 2026. The 9 Nov bake
already contained the newest observation available for every challenge target.

### Candidate never-opened visits (Makemake, Pluto)

| Target | Visit (UTC) | obs_ids | Arrays | Collection | Suggested role |
|---|---|---:|---|---|---|
| Makemake | 2025-05-30 → 06-19 | 56 | 1–6 | DR1 | training |
| Makemake | 2025-07-04 → 07-06 | 7 | 1,2,4,5 | DR1 | training |
| Makemake | 2025-12-28 → 2026-01-09 | 56 | 1–6 | DR1 | training |
| Makemake | 2026-05-30 → 06-13 | 65 | 1–6 | QR3 | **reserved holdout** |
| Pluto | 2025-04-25 → 05-01 | 5 | 2,3,5,6 | DR1 | training |
| Pluto | 2025-09-25 → 10-12 | 55 | 1–6 | DR1 | training |
| Pluto | 2026-04-25 → 05-02, 05-12 | 50 | 1–6 | DR1 | training |
| Pluto | 2026-09-29 → 10-02 | 10 | 3,6 | QR3 | **reserved holdout** |

The roles are a proposal for the trial design (Task A-F), not a decision. Until a trial manifest
freezes them, treat **all** Makemake and Pluto visits as reserved, training visits included. A
training visit may be opened only after the trial manifest that names it as training has been
committed.

Conditions before either can be called `prospective_unexposed`:

- The model is fitted only on SPHEREx training positions plus stated physical constants. If a JPL/MPC
  orbit or ephemeris shapes the prediction, the category is `catalogue_assisted`. That remains a
  useful trial, but it is not independent validation against the same ephemeris.
- Identification of the body in the holdout follows a preregistered procedure, with alternatives kept.
  The brightest source in the ellipse is not automatically the body. Pluto (Dec ≈ −23°, towards the
  Milky Way) has a crowded field.
- Detectability is not established. Makemake is V ≈ 17.1. No SPHEREx detection of either body has
  been validated. The training visits may show the body is undetectable in single exposures. In that
  case the outcome is `insufficient_data`, not a forecast.
- Sparse arcs (3 training visits over about 1 year) may not constrain an orbit. Report that honestly.

### Challenge targets: what can still be done

- `retrospective_holdout` trials on exposed epochs (e.g. hold out the 2026-08/09 QR3 visit for
  Barnard or Epsilon Indi B, then predict it from 2025 data). These must be labelled
  retrospective: the team has already seen those frames and the results in the viewer.
- Never-opened, same-visit DR1/QR3 exposures (listed in each JSON) are retrospective too (rule 2).
- A genuinely prospective challenge-target trial needs an observation released after the prediction
  is frozen. R Draconis is the most likely to get one (near-continuous NEP coverage). Before the
  deadline, nothing guarantees that a release arrives.

## Files

| File | Content |
|---|---|
| `docs/exposure/summary.json` | Counts per target, rules, git head, generation time |
| `docs/exposure/<key>.json` | `exposed` (obs_id, date, arrays, releases, wavelengths, source of exposure), `archive_listing`, `candidates_never_opened.visits`, `candidate_rows` (metadata only) |
| `docs/exposure/3i_atlas.json` | Official table summary (columns, counts, dates) |
| `docs/exposure/SHA256SUMS` | Hashes of the JSON files as generated |
| `scripts/exposure_inventory.py` | Generator (metadata only) |

Limits: SIA was queried with a 0.005° circle at the preset's propagated centre. A star very close to
an array edge could be listed or missed at the margin. The 3I/ATLAS table lists retired QR2 URLs.
Matching DR1 products were not looked up because the comet is See-only.
