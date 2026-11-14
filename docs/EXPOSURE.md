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
  `static/data/<key>/investigation.json` (`observations`).
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

  Makemake total: 236 rows requested, 234 processed, 2 failed after retries. The fixed-sky pair
  (`2025W22_2B_0258_1` D3 and `2025W23_1C_0121_1` D3) re-uses two of those exposures with a
  different cutout centre. Pluto rows are added when its run finishes.
- Live jobs near the targets remain blocked in the web app (`static/js/reserved.js`, and
  `static/data/reserved.json` from A3).

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
