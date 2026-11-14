# TENGER data contract

Owner: Session A (science/data) writes the files. Session B (website) reads them. To change the
contract, **append a new version section** at the end. Never edit a published version silently;
only typo fixes are allowed in place, and each one is noted in the changelog.

## Changelog

| Version | Date | Change |
|---|---|---|
| 1 | 2026-11-14 | First version (Task A1). Defines nine file types, enums, paths and examples. |
| 11 | 2026-11-15 | Additive (Task A7). Open forecast v2 fields, abandoned manifests, hindcast file, scoreboard `abandoned_before_prediction`. |
| 10 | 2026-11-15 | Additive. Per-visit colour previews for moving targets; index `composites_path`; index `prediction.status` now reflects verification. |
| 9 | 2026-11-14 | Additive (Task A6). `scene3d.json` for the 3D views. |
| 8 | 2026-11-14 | Additive (Task A5b). Exploratory post-mortem file `trials/pluto/postmortem.json`. |
| 7 | 2026-11-14 | Additive (Task A5). Verification extras, reserved.json status, scoreboard and game additions. |
| 6 | 2026-11-14 | Additive. Verification residual fields agreed with Session B before A5 (reference position, C_pred, C_obs). |
| 5 | 2026-11-14 | Additive (Task A4). Trial labels and precedence, confirmation_pending, open forecasts, training.json, prediction_status, model_state, receipts with full SHA; names agreed with Session B. |
| 4 | 2026-11-14 | Additive (Task A3). Brightness game round shape (`quantity: "brightness"`), confirmed with Session B. |
| 3 | 2026-11-14 | Additive (Task A3). Real investigation fields (provenance, quality gate, epochs mapped to viewer frames and previews, graded comparisons, astrometry and photometry blocks), `reserved.json`, `strings.en.json`, index additions. `schema_version` majors unchanged. |
| 2 | 2026-11-14 | Additive (Task A2). Live/bake frame metadata fields, flag mask policy, comparison and measurement reason keys, the comparison rule for the viewer. Version 1 file kinds and their `schema_version` values are unchanged. |

---

# Version 1

## 1. Rules for every file

1. **`schema_version`** is a top-level key of every JSON file: `"tenger.<kind>/1"`, e.g.
   `"tenger.investigation/1"`. A reader accepts a file only if the kind matches and the major
   version is one it knows. Otherwise it shows "unsupported data version" rather than guessing.
2. **Real vs example.** Files under `static/data/` are real data. They must not contain
   `"example": true`, and the production validator rejects them if they do. The examples in this
   document and every file in `static/dev-fixtures/` (Session B) carry `"example": true`. The UI must
   label an example file visibly ("Example data, not an observation") and never feed it to the
   scoreboard.
3. **Missing means `null`.** Never `0`, `""` or `NaN` as a placeholder. A missing measurement keeps
   its record with `"value": null` and a `status` saying why.
4. **Units sit in field names:** `_deg`, `_arcsec`, `_mas_yr`, `_um` (micrometres), `_mjy_sr`,
   `_ujy`, `_mag`, `_days`, `_mjd`. Angles are ICRS degrees unless named otherwise. Times are
   `*_mjd` (the time system is stated in `time_scale`, default `"UTC"` as listed by IRSA ObsCore) plus
   an ISO-8601 `*_utc` string for display.
5. **No visible English sentences in data.** Text shown to users comes from Session B's English
   resource file via keys (`*_key`). Data files give keys and numeric `params`. Proper names
   (`name`) and free-text `notes` (for developers, never displayed) are the only exceptions.
6. **Content type.** Every displayed value or image says what it is with `content_type`:
   `measured`, `catalogue`, `modeled`, `interpreted`, `processed`, `artificial`.
7. **Observation identity.** `obs_key` = `"<collection>:<obs_id>:D<detector>"`, e.g.
   `"spherex_dr1:2025W33_2C_0321_1:D6"`. Exposure and independence are judged per `obs_id`
   (see `docs/EXPOSURE.md`).
8. **Hashes** are lowercase hex SHA-256 of the file's exact bytes (UTF-8, LF line endings, as
   committed). Python writers use `json.dumps(obj, indent=2, ensure_ascii=False) + "\n"` with the
   key order shown in this document. Verification hashes the committed bytes and never re-serialises.
9. **One source of truth.** A number appears in exactly one authoritative file. Other files either
   reference it (`*_ref` = path plus `sha256`) or carry a generated copy listed in `derived_from`.
   Nobody hand-edits a generated copy.

## 2. Shared enums

| Enum | Values |
|---|---|
| `trial_status` | `waiting`, `hit`, `miss`, `insufficient_data`, `ambiguous`, `invalid_comparison`, `see_only` |
| `trial_category` | `prospective_unexposed`, `retrospective_holdout`, `catalogue_assisted`, `illustrative` |
| `content_type` | `measured`, `catalogue`, `modeled`, `interpreted`, `processed`, `artificial` |
| `comparison_grade` | `quantitative`, `qualitative`, `invalid` |
| `data_status` | `available`, `partial`, `unavailable` |
| `measurement_status` | `measured`, `insufficient_data`, `invalid_comparison`, `not_attempted` |
| `target_role` | `challenge`, `extra`, `place` |
| `exposure_status` | `unexposed`, `exposed`, `unknown` |

Meaning of `trial_status`:

- `waiting`: prediction frozen, not yet verified.
- `hit` / `miss`: verified against the preregistered rule.
- `insufficient_data`: no usable reserved observation, or no defensible prediction could be made.
  `status_reason_key` says which.
- `ambiguous`: the target could not be identified uniquely. Alternatives are kept.
- `invalid_comparison`: response, registration or quality checks failed.
- `see_only`: the target is excluded from forecasting (3I/ATLAS). It never enters a denominator.

Meaning of `trial_category`. A trial has exactly one:

- `prospective_unexposed`: the reserved observation was unopened when the prediction was frozen
  (`exposure.status = "unexposed"`), *and* no catalogue or ephemeris value shaped the prediction.
- `retrospective_holdout`: evaluation data already available or seen. A demonstration, not "before we
  looked".
- `catalogue_assisted`: a named catalogue or ephemeris prior shaped the prediction. This takes
  precedence over `prospective_unexposed`. The exposure status is still recorded.
- `illustrative`: a simulation or teaching example. Never scored.

## 3. Paths under `static/data/`

| File | Path | Written by |
|---|---|---|
| Site index | `static/data/index.json` | `scripts/build_site.py` (to be extended) |
| Investigation manifest | `static/data/<target_key>/investigation.json` | build pipeline |
| Trial manifest | `static/data/trials/<trial_id>/trial.json` | `scripts/predict.py` (freeze step) |
| Prediction (immutable) | `static/data/trials/<trial_id>/prediction.json` | `scripts/predict.py` |
| Prediction receipt | `static/data/trials/<trial_id>/receipt.json` | `scripts/predict.py --receipt` after commit |
| Verification | `static/data/trials/<trial_id>/verification.json` | `scripts/verify.py` |
| Scoreboard (derived) | `static/data/scoreboard.json` | `scripts/verify.py --scoreboard` |
| Game record | `static/data/game/<round_id>.json` | `scripts/make_game.py` |
| Lesson record | `static/data/lessons/<lesson_id>.json` | `scripts/make_lessons.py` |

The existing files `static/data/targets.json`, `results.json`, `<key>/meta.json`,
`<key>/frames.bin.gz`, `<key>/wise.bin.gz` and the thumbnails stay readable as **legacy** assets until
a later version retires them. `investigation.json` points to them. Their numbers (e.g. the motion
values in `results.json`) are *legacy, unvalidated*. Pages must not present them as validated
results, and new features must not copy them.

IDs: `target_key`, `trial_id`, `round_id`, `lesson_id` match `^[a-z0-9]+(-[a-z0-9]+)*$`.
`trial_id` reads `<target_key>-<quantity>-<label>`, e.g. `pluto-position-2026b`.

## 4. Site index: `index.json`

The single file the home page loads. It lists targets, what each can show, and where every other
file is.

```json
{
  "schema_version": "tenger.site_index/1",
  "example": true,
  "dataset_version": "example-2026-11-14",
  "generated_utc": "2026-11-14T12:00:00Z",
  "targets": [
    {
      "key": "example-star",
      "name": "Example Star",
      "name_key": "target.example-star.name",
      "role": "challenge",
      "kind": "faststar",
      "reference": {"ra_deg": 10.0, "dec_deg": 20.0, "epoch_jyear": 2016.0,
                    "pmra_mas_yr": 100.0, "pmdec_mas_yr": -50.0, "source": "Gaia DR3 (example)"},
      "footprint": {"centre_ra_deg": 10.0, "centre_dec_deg": 20.0, "fov_deg": 0.1},
      "data_status": "available",
      "prediction": {"status": "waiting", "trial_ids": ["example-star-position-a"]},
      "investigation_path": "example-star/investigation.json",
      "thumbnails": [{"path": "example-star/thumb-b.webp", "content_type": "processed",
                      "label_key": "thumb.spherex", "time_utc": "2026-01-01T00:00:00Z"}],
      "map": {"distance": {"value": 1.0, "unit": "pc", "kind": "parallax_distance",
                           "source": "example"},
              "angle_deg": 45.0, "angle_is_arbitrary": true}
    }
  ],
  "trials": ["trials/example-star-position-a/trial.json"],
  "scoreboard_path": "scoreboard.json",
  "game_rounds": ["game/example-round.json"],
  "lessons": ["lessons/example-lesson.json"],
  "releases": [{"collection": "spherex_dr1", "listed_utc": "2026-11-14T11:31:00Z"}],
  "credits_keys": ["credit.irsa", "credit.spherex", "credit.base-project"]
}
```

`map.angle_is_arbitrary` must be `true`. The map is a schematic log-distance illustration, not sky
geometry. `distance` may be `null`, e.g. for the Sun or an unknown distance.

## 5. Investigation manifest: `<key>/investigation.json`

One per prepared target. It feeds the cards, the viewer, the evidence panels, the charts and the
exports. Viewer state (A/B ids, band, mode) refers to the ids defined here.

```json
{
  "schema_version": "tenger.investigation/1",
  "example": true,
  "target_key": "example-star",
  "dataset_version": "example-2026-11-14",
  "pipeline": {"version": "0.0.0-example", "config_sha256": "0000000000000000000000000000000000000000000000000000000000000000"},
  "request": {"ra_deg": 10.0, "dec_deg": 20.0, "fov_deg": 0.1, "position_epoch_mjd": 61100.0},
  "coverage": {"available_fov_deg": 0.1, "observations_listed": 2, "observations_used": 2},
  "observations": [
    {"obs_key": "spherex_dr1:EXAMPLE_0001_1:D3", "obs_id": "EXAMPLE_0001_1", "detector": 3,
     "collection": "spherex_dr1", "t_start_mjd": 61000.0, "t_end_mjd": 61000.001,
     "time_scale": "UTC", "t_start_utc": "2026-02-25T00:00:00Z",
     "response": {"centre_um": 2.0, "width_um": 0.02, "source": "CWAVE/CBAND"},
     "file": "level2_EXAMPLE_0001_1D3_spx_example.fits", "url": null,
     "source_sha256": null, "flag_schema": "MSKN/MSKM", "flagged_fraction": 0.01},
    {"obs_key": "spherex_qr3:EXAMPLE_0002_1:D3", "obs_id": "EXAMPLE_0002_1", "detector": 3,
     "collection": "spherex_qr3", "t_start_mjd": 61200.0, "t_end_mjd": 61200.001,
     "time_scale": "UTC", "t_start_utc": "2026-09-13T00:00:00Z",
     "response": {"centre_um": 2.0, "width_um": 0.02, "source": "CWAVE/CBAND"},
     "file": "level2_EXAMPLE_0002_1D3_spx_example.fits", "url": null,
     "source_sha256": null, "flag_schema": "MSKN/MSKM", "flagged_fraction": 0.02}
  ],
  "epochs": [
    {"id": "e1", "obs_keys": ["spherex_dr1:EXAMPLE_0001_1:D3"], "t_start_mjd": 61000.0,
     "t_end_mjd": 61000.001, "combine": "single", "assets": {"preview": null}},
    {"id": "e2", "obs_keys": ["spherex_qr3:EXAMPLE_0002_1:D3"], "t_start_mjd": 61200.0,
     "t_end_mjd": 61200.001, "combine": "single", "assets": {"preview": null}}
  ],
  "comparisons": [
    {"id": "c1", "a": "e1", "b": "e2", "grade": "quantitative", "modes": ["blink", "side_by_side", "swipe"],
     "checks": {"response": "pass", "registration": "pass", "psf": "not_checked", "background": "pass"},
     "reason_keys": []}
  ],
  "measurements": [
    {"id": "m1", "quantity": "proper_motion_total_arcsec_yr", "content_type": "measured",
     "status": "insufficient_data", "value": null, "sigma": null, "method": "example",
     "inputs": ["e1", "e2"], "limitation_keys": ["limit.example"]}
  ],
  "explanation": [{"key": "explain.example", "params": {"measurement": "m1"}}],
  "capabilities": {"modes": ["blink", "side_by_side", "swipe"], "difference": false,
                   "spectrum": false, "light_curve": false},
  "legacy": {"meta": "example-star/meta.json", "frames": "example-star/frames.bin.gz",
             "status": "unvalidated"},
  "data_status": "available",
  "measurement_status": "insufficient_data",
  "credits_keys": ["credit.irsa", "credit.spherex"]
}
```

A comparison with `grade: "invalid"` lists only the modes that are still honest (usually
`side_by_side`). It never lists `difference`.

## 6. Trial manifest: `trials/<trial_id>/trial.json`

Written and committed **before** `prediction.json`. It freezes what the prediction may use and how it
will be scored.

```json
{
  "schema_version": "tenger.trial/1",
  "example": true,
  "trial_id": "example-star-position-a",
  "target_key": "example-star",
  "quantity": "position",
  "category": "retrospective_holdout",
  "frozen_utc": "2026-11-14T12:00:00Z",
  "exposure": {"status": "exposed", "inventory_ref": {"path": "docs/exposure/example-star.json",
               "sha256": "0000000000000000000000000000000000000000000000000000000000000000"},
               "team_statement": null, "notes": "example"},
  "training": {"obs_keys": ["spherex_dr1:EXAMPLE_0001_1:D3"],
               "measurements_sha256": "0000000000000000000000000000000000000000000000000000000000000000"},
  "holdout": {"obs_ids": ["EXAMPLE_0002_1"], "t_mjd": 61200.0, "selection_rule_key": "holdout.next-visit"},
  "permitted_inputs": [{"name": "Gaia DR3 parallax", "content_type": "catalogue", "used_for": "prior"}],
  "model": {"id": "linear-pm-parallax", "version": "0.0.0-example", "code_sha256": "0000000000000000000000000000000000000000000000000000000000000000"},
  "baseline": {"id": "linear-no-parallax"},
  "scoring": {"kind": "position_2d_chi2", "frame": "tangent plane at predicted position, east/north arcsec",
              "coverage": 0.95, "threshold_d2": 5.991464547107979,
              "covariance": "S = C_pred + C_obs"},
  "exclusion_rules_keys": ["exclude.flagged-centroid", "exclude.no-detection"],
  "exploratory": false,
  "revises": null
}
```

`scoring.kind` is one of `position_2d_chi2` (hit if `r.T @ inv(S) @ r <= threshold_d2`; 95% gives
5.991464547107979, radius 2.4477468), `scalar_1d_gaussian` (`z_max` = 1.959963984540054) or
`empirical_interval` (with a justification key). A trial revised after reveal gets a new `trial_id`
with `"exploratory": true` and `"revises": "<old id>"`. It never counts as prospective.

## 7. Prediction (immutable): `trials/<trial_id>/prediction.json`

Written once, hashed and committed. Never rewritten. Verification refuses to run if the hash differs
from the receipt.

```json
{
  "schema_version": "tenger.prediction/1",
  "example": true,
  "trial_id": "example-star-position-a",
  "trial_ref": {"path": "trials/example-star-position-a/trial.json",
                "sha256": "0000000000000000000000000000000000000000000000000000000000000000"},
  "category": "retrospective_holdout",
  "created_utc": "2026-11-14T12:05:00Z",
  "t_mjd": 61200.0,
  "model": {"ra_deg": 10.001, "dec_deg": 19.9995,
            "cov_arcsec2": [[0.25, 0.0], [0.0, 0.25]], "content_type": "modeled"},
  "baseline": {"ra_deg": 10.0011, "dec_deg": 19.9994,
               "cov_arcsec2": [[0.36, 0.0], [0.0, 0.36]], "content_type": "modeled"},
  "limitation_keys": ["limit.parallax-geometry-approx"]
}
```

For `scalar_1d_gaussian` trials, `model` and `baseline` hold `{"value", "sigma", "unit"}` instead of
coordinates.

## 8. Prediction receipt: `trials/<trial_id>/receipt.json`

A separate file, written after the commit that added `prediction.json`. That way the prediction never
has to contain its own commit.

```json
{
  "schema_version": "tenger.receipt/1",
  "example": true,
  "trial_id": "example-star-position-a",
  "prediction_path": "trials/example-star-position-a/prediction.json",
  "prediction_sha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "commit": "0000000",
  "committed_utc": "2026-11-14T12:06:00Z",
  "pushed": {"remote": "origin", "branch": "tenger-dev", "utc": null}
}
```

`pushed.utc` stays `null` unless the push really happened. A push or public timestamp is extra
evidence. It is not proof that nobody looked.

## 9. Verification: `trials/<trial_id>/verification.json`

Written only by `scripts/verify.py`, after it checks `prediction_sha256`.

```json
{
  "schema_version": "tenger.verification/1",
  "example": true,
  "trial_id": "example-star-position-a",
  "prediction_sha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "revealed_utc": "2026-11-14T13:00:00Z",
  "observed": {"ra_deg": 10.0012, "dec_deg": 19.9993, "cov_arcsec2": [[0.16, 0.0], [0.0, 0.16]],
               "obs_keys": ["spherex_qr3:EXAMPLE_0002_1:D3"], "content_type": "measured"},
  "identification": {"method_key": "ident.preregistered-aperture", "alternatives": 0, "ambiguous": false},
  "residuals": {
    "model": {"east_arcsec": 0.68, "north_arcsec": -0.72, "d2": 2.39, "error_arcsec": 0.99},
    "baseline": {"east_arcsec": 0.34, "north_arcsec": -0.36, "d2": 0.47, "error_arcsec": 0.5}
  },
  "status": "hit",
  "status_reason_key": null
}
```

`status` follows `trial.json.scoring` for the **model**. The baseline's residuals are reported next to
it. The model is allowed to lose.

## 10. Scoreboard (derived only): `scoreboard.json`

Generated from every `trial.json`, `prediction.json`, `receipt.json` and `verification.json`. Never
edited by hand. The UI shows these counts and rows and computes no success numbers of its own.

```json
{
  "schema_version": "tenger.scoreboard/1",
  "example": true,
  "generated_utc": "2026-11-14T13:05:00Z",
  "derived_from": [{"path": "trials/example-star-position-a/verification.json",
                    "sha256": "0000000000000000000000000000000000000000000000000000000000000000"}],
  "counts": {
    "retrospective_holdout": {"waiting": 0, "hit": 1, "miss": 0, "insufficient_data": 0,
                              "ambiguous": 0, "invalid_comparison": 0}
  },
  "see_only": ["example-comet"],
  "rows": [
    {"trial_id": "example-star-position-a", "target_key": "example-star", "quantity": "position",
     "category": "retrospective_holdout", "status": "hit", "exploratory": false,
     "counts_as_prospective": false,
     "model_error_arcsec": 0.99, "baseline_error_arcsec": 0.5}
  ]
}
```

`counts_as_prospective` is `true` only when `category == "prospective_unexposed"`, `exploratory`
is `false`, and `status` is `hit` or `miss`. A category with no trials is left out of `counts` rather
than written as zeros.

## 11. Game record: `game/<round_id>.json`

Generated from a trial. The values carry `derived_from` hashes. The page reveals player → baseline →
model → actual, in that order.

```json
{
  "schema_version": "tenger.game_round/1",
  "example": true,
  "round_id": "example-round",
  "trial_id": "example-star-position-a",
  "category": "retrospective_holdout",
  "quantity": "position",
  "units": "arcsec",
  "derived_from": [{"path": "trials/example-star-position-a/prediction.json",
                    "sha256": "0000000000000000000000000000000000000000000000000000000000000000"}],
  "training_points": [{"t_mjd": 61000.0, "east_arcsec": 0.0, "north_arcsec": 0.0,
                       "content_type": "measured"}],
  "reveal_t_mjd": 61200.0,
  "baseline": {"east_arcsec": 0.5, "north_arcsec": -0.4},
  "model": {"east_arcsec": 0.4, "north_arcsec": -0.5, "region_d2": 5.991464547107979},
  "actual": {"east_arcsec": 0.6, "north_arcsec": -0.6, "image": null},
  "scoring": {"formula": "exp_decay_v1", "scale": 2.0}
}
```

`exp_decay_v1`: `score = round(100 * exp(-error / scale))`. Here `error ≥ 0` is the raw error in
`units`, and `scale > 0` is fixed when the round is generated, before reveal. If `error` or `scale`
is not finite, or `scale ≤ 0`, the score is `null` and the page shows only raw errors. Raw errors for
player, baseline and model are always shown. A perfect guess scores 100. Nothing divides by the
baseline error.

## 12. Lesson record: `lessons/<lesson_id>.json`

Worked examples and answers come from sourced records or are clearly marked synthetic.

```json
{
  "schema_version": "tenger.lesson/1",
  "example": true,
  "lesson_id": "example-lesson",
  "title_key": "lesson.example.title",
  "grade_band": "8-11",
  "investigation_key": "example-star",
  "formula_key": "lesson.example.formula",
  "worked_example": {
    "inputs": [{"name": "baseline_au", "value": 2.0, "unit": "au", "content_type": "artificial",
                "synthetic": true, "source_ref": null}],
    "answer": {"value": 1.0, "unit": "arcsec", "derived_by": "scripts/make_lessons.py"}
  },
  "exercises": [
    {"id": "q1", "prompt_key": "lesson.example.q1",
     "inputs": [{"name": "distance_pc", "value": 2.0, "unit": "pc", "content_type": "artificial",
                 "synthetic": true, "source_ref": null}],
     "answer": {"value": 0.5, "unit": "arcsec"}}
  ],
  "teacher_note_key": "lesson.example.teacher",
  "derived_from": []
}
```

An input with `"synthetic": false` needs a `source_ref` (a measurement id in an investigation, a
trial id, or a catalogue citation). If a real value does not exist yet, the lesson uses a synthetic
input marked as such. It never uses a measured-looking number.

---

# Version 2 (additive, Task A2, 14 Nov 2026)

Nothing in Version 1 changes. Every file kind keeps `schema_version` `…/1`. This version adds the
following.

## V2.1 Live and bake frame metadata

Each frame's JSON object in `GET /api/job/{id}/frames` (and in the `meta` of a cached frame) keeps
its old fields and gains these. Old bundled `meta.json` files do not have them. A reader must treat
a missing field as unknown, never as "passed".

| Field | Type | Meaning |
|---|---|---|
| `obsKey` | string | `"<collection>:<obs_id>:D<detector>"` (§1 rule 7) |
| `release` | string | Collection, e.g. `spherex_dr1`, `spherex_qr3_deep` (unchanged name, now DR1 too) |
| `processing` | string or null | Product version from the file name, e.g. `l2b-v27-2026-228` |
| `releaseDate` | string or null | IRSA `obs_release_date` |
| `mjd`, `mjdEnd`, `timeScale` | number, number or null, `"UTC"` | Exposure start and end (IRSA `t_min`, `t_max`) |
| `response` | object or null | `{"centre_um", "width_um", "source": "WCS-WAVE"}` at the request centre. `null` = unknown |
| `responseStatus` | `known` / `unknown` | If `unknown`, `wavelength` is the array midpoint for display placement only |
| `wavelength`, `waveDx`, `waveDy` | number | Display placement (unchanged). Not a validity proof |
| `channel` | integer | Approximate display bin 0–101. A label, never a response |
| `flagSchema` | `MSKN/MSKM` or `MP` | Which FLAGS header schema was decoded |
| `maskPolicy` | string | `tenger-mask-v1` (table in `backend/flags.py`) |
| `flagCounts` | object | Pixels per flag name in the native cutout, plus `UNDEFINED_BITS` if any |
| `source` | object | `{"url", "sha256", "bytes", "software", "native"}`: cutout request, SHA-256 of the bytes received, pipeline software version, cached native product path (or null) |
| `cache` | object | `{"tag", "pipeline", "frame_schema", "mask_policy", "grid"}` |

The job summary (`/api/observe`, `/api/job/{id}`) gains `rejected`: `{reason_key: count}` for
exposures refused before display, e.g. `product.unusable-quality-metadata` (no known flag schema
or a missing extension).

## V2.2 Flag mask policy `tenger-mask-v1`

Kept: `SOURCE`, `FULLSAMPLE`. Rejected: every other named flag, any name not in the policy and any
bit set without a header definition. The display mask (`mask` in frames) uses the same rejection.
A display setting can hide or show the mask overlay. It cannot change which pixels a measurement
uses.

## V2.3 Comparison and measurement reason keys

`comparison_grade` (V1 §2) is assigned by `backend/spectral.py`. Reason keys for the English
resource file:

| Key | Grade | Meaning |
|---|---|---|
| `compare.response-matched` | quantitative | Same array, centres within 10% of the narrower bandwidth (TENGER tolerance, not an official criterion) |
| `compare.matched-pairs` | quantitative | Two epochs compared only through the listed matched exposure pairs |
| `compare.field-matched` | quantitative | Responses match at every corner of the plate |
| `compare.response-shifted` | qualitative | Same array, overlapping passbands, centres too far apart for a brightness comparison |
| `compare.field-shifted` | qualitative | Matched at the source but not across the whole plate. No difference image |
| `compare.position-different-response` | qualitative | Position compared across wavelengths. Chromatic effects not modelled |
| `compare.response-unknown` | invalid | One side has no WCS-WAVE response |
| `compare.no-spectral-overlap` | invalid | Passbands do not overlap (or different arrays for brightness) |
| `compare.field-gradient-unknown` | invalid | Wavelength gradient across the plate unknown |
| `compare.no-exposures` | invalid | One epoch has no exposure |
| `measure.flagged-pixels-in-aperture` | `insufficient_data` | A rejected pixel lies inside the aperture. Counts per flag are given |
| `measure.outside-cutout`, `measure.aperture-empty`, `measure.annulus-too-small` | `insufficient_data` | Geometry prevents a measurement |

## V2.4 Viewer rule for time comparisons

- Blink and side-by-side may show any pair. They are labelled with the comparison grade.
- A difference image, or any brightness change, needs `quantitative`. A difference image also
  needs the field grade (`compare.field-*`) to be `quantitative`.
- Choosing a band must never silently substitute the nearest channel that has data in one epoch
  and not the other. If an epoch has no exposure with a matching response, show that instead.
  (`resolveBand` in `static/js/stack.js` currently does this substitution. That file belongs to
  Session B.)

---

# Version 3 (additive, Task A3, 14 Nov 2026)

Version 1 and 2 stay valid. Every file kind keeps major version `/1`, so the V1 reader accepts the
files. Files written under this version carry `"contract_version": 3`. Unknown extra fields must be
ignored by readers.

## V3.1 Investigation additions (`<key>/investigation.json`)

| Path | Meaning |
|---|---|
| `contract_version` | `3` |
| `pipeline.code_sha256`, `pipeline.settings` | SHA-256 of the processing code files, and the settings hashed into `config_sha256` |
| `request.cutout_deg` | Cutout side actually requested (field × 1.45, so a rotated frame fills the plate) |
| `coverage.observations_processed`, `observations_refused` (reason → count), `observations_failed`, `releases`, `viewer_frames` | How many archive rows became usable exposures, and why the rest did not |
| `target_catalogue` | The catalogue entry used to find the target (`source`, `gaia_source_id`, position at `epoch_jyear`, motion, parallax). `content_type: "catalogue"` |
| `observations[]` + `processing`, `exposure_s`, `source_bytes`, `software`, `mask_policy`, `quality {usable, reason_key, l2_dqa}` | Provenance per exposure. `url` is the exact cutout request, `source_sha256` the hash of the bytes received. `response` is the WCS-WAVE value at the target (null = unknown) |
| `epochs[]` + `visit`, `detector` | An epoch is one array in one visit (`id` = `v<visit>-d<array>`) |
| `epochs[].combine` | `single` or `median_stack` (a per-pixel median of the epoch's frames, used only for previews) |
| `epochs[].assets.preview` | Path under `data/` of a 240 px WebP, north up, same stretch for every epoch of one array. `preview_kind`, `content_type: "processed"` |
| `epochs[].viewer` | `{visit, frame_indices}`: the epoch's frames in `<key>/meta.json` (0-based). `visit` equals the frames' `visit` field, so the viewer's step for that visit is the epoch's step |
| `comparisons[]` | Every pair of epochs **in the same array** (never across arrays). `grade` = brightness grade at the target. `brightness {grade, reason_key, pairs[]}` lists the matched exposure pairs; `position {grade, reason_key}`; `field` = whole-plate grade. `modes` includes `difference` only when brightness and field are both `quantitative`. `checks.field_response` added; `registration`, `psf`, `background` are `not_checked` |
| `measurements[]` + `status_reason_key`, `n_points`, `chi2_red`, `span_days`, `n_stars`, `n_pairs`, `comparison` | Extra context. `content_type` separates SPHEREx measurements (`measured`) from catalogue values (`catalogue`) |
| `astrometry` | For moving stars: `reference`, systematic `floor` from control stars, `fit_parallax_fixed` and `fit_linear` (parameters, covariance, chi-square), `catalogue_agreement` (z of measured vs catalogue), `control` (per-star rows) and `per_exposure` positions |
| `photometry` | Native aperture photometry per usable exposure, with refusals by reason |
| `viewer` | `{meta, frames, visits[{visit, frame_indices, mean_mjd, date_utc}]}`. `date_utc` is the UTC date of the mean frame time, which is how the viewer names a step |
| `limitation_keys` | Union of the measurement limitations |
| `legacy` | `null` when the viewer bundle was rebuilt from the same exposures |

Quantities used: `proper_motion_total_arcsec_yr`, `proper_motion_east_arcsec_yr`,
`proper_motion_north_arcsec_yr`, `proper_motion_total_linear_arcsec_yr`,
`control_fraction_within_95pct`, `flux_ratio_b_over_a`. Moving bodies also use
`position_offset_arcsec`.

## V3.2 Index additions (`index.json`)

`contract_version`, `reserved_path` (`"reserved.json"`), `strings_path` (`"strings.en.json"`).
Per target: `measurement_status`, `status_reason_key` (when unavailable), and `thumbnails[].epoch_id`.
`prediction` is `{"status": null, "trial_ids": []}` until a trial exists, and `see_only` for 3I/ATLAS.
`map.distance` is `null` or `{value, unit ("pc" or "au"), kind, source}`.

## V3.3 Reserved sky (`reserved.json`, kind `tenger.reserved/1`)

```json
{"schema_version": "tenger.reserved/1", "margin_deg": 2.0, "rule_key": "reserved.rule",
 "regions": [{"key": "pluto", "kind": "holdout_path", "reason_key": "reserved.prediction-holdout",
              "until_key": "reserved.until-predictions-frozen", "window_mjd": [61312.6847, 61315.6055],
              "obs_ids": 10, "ra_deg": [306.0845, 306.1062], "dec_deg": [-23.7214, -23.7182],
              "path": [{"mjd": 61312.6847, "ra_deg": 306.1062, "dec_deg": -23.7182}], "source": "…"}]}
```

`kind` is `holdout_path` (Makemake, Pluto: the newest visit, closed until Task A4) or
`see_only_path` (3I/ATLAS). A live request is refused when its centre lies within `margin_deg`
plus half the field diagonal of any `path` point. The `ra_deg`/`dec_deg` box is a summary. The five
challenge targets are no longer listed: since A3 all their current observations are opened
(`docs/EXPOSURE.md`).

## V3.4 English strings (`strings.en.json`, kind `tenger.strings/1`)

`{"schema_version": "tenger.strings/1", "language": "en", "strings": {key: text}}`. Every key that
Session A writes (`*_key`, `reason_key`, `limitation_keys`, `quantity.<quantity>`, `credits_keys`,
`label_key`, `explain.*`) has an entry. `{name}` placeholders refer to the record's `params`.
`tests/test_static_data.py` enforces this. Session B may copy the strings into its resource file.

## V3.5 Viewer bundle (`<key>/meta.json`, `frames.bin.gz`)

Same binary format as before. A3 rebuilt it for the challenge targets from the investigation's own
usable exposures (DR1/QR3, `tenger-mask-v1` masks, frames at least 92% covered, at most 240). Frame
objects carry the V2.1 fields. `meta.json` gains `dataset_version`. `wise` and `thumbs` are carried
over from the previous bundle (AllWISE context, unchanged).

---

# Version 4 (additive, 14 Nov 2026): brightness game rounds

A game round (V1 §11) may have `"quantity": "brightness"`. Then:

| Field | Shape |
|---|---|
| `units` | `"mag_ab"`, `"ujy"` or `"ratio"` (a brightness ratio to a stated reference date) |
| `training_points[]` | `{"t_mjd", "value", "sigma" (or null), "content_type": "measured"}` |
| `baseline`, `model` | `{"value"}`; `model` may add `"sigma"` |
| `actual` | `{"value", "sigma" (or null), "image"}`; `image` is `null`, a path string, or `{"path", "content_type"}` |
| `scoring` | `exp_decay_v1` as in V1 §11, with `error = |guess - actual.value|` in `units` |

Smaller magnitudes mean brighter; a reader must not assume larger is brighter when `units` is
`mag_ab`. Values come from a trial's frozen prediction and its verification, with `derived_from`
hashes, exactly as for position rounds.

---

# Version 5 (additive, Task A4, 14 Nov 2026): freezing and predicting

Readers of V1 files keep working. New files written under this version carry `"contract_version": 5`.

## V5.1 Categories: labels and precedence

`trial.json` and `prediction.json` carry `"labels"`: **every** category that applies. `"category"`
is the most limiting of them, in this order: `illustrative` > `retrospective_holdout` >
`catalogue_assisted` > `prospective_unexposed`. Example: a Barnard trial whose evaluation visit was
already seen, and which fixes the parallax to Gaia, has `labels: ["retrospective_holdout",
"catalogue_assisted"]` and `category: "retrospective_holdout"`. The page shows all labels. (V1 said
`catalogue_assisted` takes precedence over `prospective_unexposed`; that still holds.)

`"confirmation_pending": true` (top level of `trial.json`) means that not every teammate has yet
stated that they never viewed the evaluation visit (`docs/EXPOSURE.md`). It only appears with
`prospective_unexposed`.

`"ephemeris_use"` (optional, `trial.json`) says how an ephemeris was used when it was *not* a model
input (e.g. to centre training cutouts).

## V5.2 Trial manifest additions (`trial.json`)

| Field | Meaning |
|---|---|
| `open_forecast` | `true` for a forecast of a future visit that IRSA has not released |
| `holdout.data_state` | `"released"` or `"not_released"` |
| `holdout.check_after_utc` | Earliest date the data could be released (estimate), or `null` |
| `holdout.obs[]` | `{obs_key, t_start_mjd, t_end_mjd}` only: IDs and times, never positions |
| `holdout.t_mjd` | Reference time (median evaluation exposure start; for open forecasts the expected mid-visit) |
| `training.path`, `measurements_sha256`, `n_points`, `visits`, `obs[]` | `training.json` path, the SHA-256 of its bytes, and each training observation with its source hash |
| `permitted_inputs[]` | Priors with `value_mas` / `pmra_mas_yr` / `pmdec_mas_yr` when numeric, and `used_for` |
| `model.code_sha256` | SHA-256 over `backend/orbit.py`, `backend/astrometry.py`, `scripts/predict.py`, `scripts/trials.py`. Prediction refuses to run if it differs |
| `scoring.observed`, `c_obs`, `c_pred`, `model_evaluation` | How verification will build the residual and both covariances |
| `identification` | Pre-registered rules for finding the target in the evaluation data |

## V5.3 Training measurements (`trials/<id>/training.json`, kind `tenger.training/1`)

```json
{"schema_version": "tenger.training/1", "contract_version": 5, "trial_id": "…", "target_key": "…",
 "source": {"path": "pluto/investigation.json", "sha256": "…"}, "selection": "…",
 "points": [{"t_mjd": 60949.55, "ra_deg": 304.17, "dec_deg": -23.61, "cov_arcsec2": [[0.04, 0], [0, 0.04]],
             "obs_keys": ["spherex_dr1:…:D3"], "visit": 1, "detector": 3, "spacecraft_km": [491.3, -6065.3, -3323.6],
             "content_type": "measured"}]}
```

`trial.training.measurements_sha256` is the SHA-256 of these exact bytes. Brightness trials use
`flux_ujy` and `sigma_ujy` in place of positions.

## V5.4 Prediction additions (`prediction.json`)

| Field | Meaning |
|---|---|
| `prediction_status` | `"predicted"` or `"insufficient_data"` (with `status_reason_key`). If `insufficient_data`, `model`, `baseline` and `track` are `null`, and the trial counts as `insufficient_data` (never `waiting`) |
| `training_sha256` | Copy of the frozen training hash |
| `t_mjd`, `model`, `baseline` | Position at the reference time with `cov_arcsec2` (east/north arcsec²; the 95% region is D² ≤ 5.991) |
| `track`, `baseline_track` | Open forecasts only: `[{t_mjd, ra_deg, dec_deg, cov_arcsec2}]` over the expected visit window |
| `model_state` | Everything needed to evaluate the frozen model at any time and observer: the heliocentric state and its covariance (orbits), or reference, parameters, covariance and parallax (stars) |
| `diagnostics` | Training fit quality: χ², residual RMS, every starting distance and its converged χ², spread of near-best solutions, baseline fit |

## V5.5 Receipts and scoreboard

`receipt.commit` is the full 40-character SHA of the commit that added `prediction.json`.
`pushed.utc` is the time Session A confirmed that commit on `origin/tenger-dev`.
`scoreboard.json` leaves open forecasts out of `counts` and `rows` and lists them as
`"open_forecasts": ["<trial_id>", …]`, like `see_only`.

## V5.6 Verification image geometry (for later)

`verification.observed.image` = `{"path", "content_type": "processed", "epoch_id", "centre_ra_deg",
"centre_dec_deg", "scale_arcsec_px", "width_px", "height_px", "north_up": true, "east_left": true}`
or `null`.

---

# Version 6 (additive, 14 Nov 2026): verification residual fields (for Task A5)

Agreed with Session B before any verification, so the page can redraw exactly what was scored.

| Field (`verification.json`) | Meaning |
|---|---|
| `t_mjd` | Mean time of the identified holdout exposures |
| `observed.ra_deg`, `observed.dec_deg` | `residuals.model.reference` shifted by the mean residual r̄ in the tangent plane |
| `observed.cov_arcsec2` | **C_obs as scored**: sample covariance of the per-exposure residuals / N (never below the mean fit covariance / N) |
| `residuals.model.reference` | `{ra_deg, dec_deg, t_mjd}`: the frozen model evaluated at `t_mjd` with the real observer positions. D² is computed against this, not against `prediction.json`'s headline position (geocentric observer, median start time) |
| `residuals.model.c_pred_arcsec2` | **C_pred as scored** at `t_mjd` (including sigma_sys and, for orbits, without the spacecraft term because the real observer is used) |
| `residuals.model.east_arcsec`, `north_arcsec`, `d2`, `error_arcsec` | r̄ and D² = r̄ᵀ (C_pred + C_obs)⁻¹ r̄; `error_arcsec` = |r̄| |
| `residuals.baseline.*` | The same four fields plus `reference` and `c_pred_arcsec2` for the baseline |

---

# Version 7 (additive, Task A5, 14 Nov 2026)

| File | New fields |
|---|---|
| `verification.json` | `residuals.*.c_obs_arcsec2` (the same C_obs for model and baseline); `residuals.*.status` (the baseline's own hit/miss on the same data); `per_exposure[]` residuals; `identification` (rules applied, counts, motion check, `added_at_verification`); `candidates[]` (Pluto: every exposure with every listed peak, its fit, static check and whether it passed); `after_verdict_comparison` (JPL Horizons, separate from the status); `exposure_note`; `measurement_source` (stars: the A3 file and hash); `corrections[]` (what was recomputed, when, previous values, whether a status changed) |
| `reserved.json` | `regions[].status`: `"reserved"` or `"released"`, with `release_reason_key`; `released`: keys no longer protecting anything. Regions are kept so readers that block them keep working |
| `scoreboard.json` | rows gain `counts_as_prospective_if_confirmed`, `model_d2`, `baseline_d2`, `baseline_status`. `counts_as_prospective` is `false` while `confirmation_pending` |
| `game/<round>.json` | `contract_version`, `labels`, `confirmation_pending`, `frame` (centre = frozen model at the reveal time), `training_points[].n_exposures/visit/detector`, `model.cov_arcsec2` (C_pred), `baseline.cov_arcsec2`, `actual.cov_arcsec2` (C_obs), `outcome`, `scoring.scale_source` |
| `lessons/<id>.json` | `worked_example.prompt_key`; answers may add `z` or `note` |

---

# Version 8 (additive, Task A5b, 14 Nov 2026): exploratory post-mortem

`static/data/trials/pluto/postmortem.json`, kind `tenger.postmortem/1`. This folder has **no**
`trial.json`, so it is never a trial and never on the scoreboard. Top level: `label` ("exploratory,
after the reveal"), `exploratory: true`, `counts: false`, `trial_id` (the trial it explains).

| Block | Content |
|---|---|
| `frozen` | Status, D², error, reference position and time, 95% ellipses of C_pred, C_obs and their sum (`semi_major_95_arcsec`, `semi_minor_95_arcsec`, `position_angle_deg_east_of_north`) |
| `identification` | Observed − Horizons and frozen − Horizons (E, N and total arcsec), C_obs sigmas, exposures used |
| `residual_split` | East/north, along/across the track, apparent motion (arcsec/day, PA), σ and z for each |
| `alternative_models` | Per model (`heliocentric_two_body`, `barycentric_two_body`, `barycentric_nbody`), refitted to the same training data: χ²/dof, position, observed − model, error, exploratory D², 95% ellipse |
| `model_variants` | Forecast shift when light time or the spacecraft offset is switched off |
| `uncertainty_test` | `sensitivity` per group offset σ (0.1, 0.2, 0.4″): Monte Carlo ellipses at the evaluation time and at the 2027 reference, D² of the actual miss with that covariance added. `jackknife_by_visit_and_array` (training only) |
| `open_forecast_2027` | Frozen ellipse vs the exploratory N-body shift |

Pages must show it as "exploratory, after the reveal" and must not use it to change any count or status.

---

# Version 9 (additive, Task A6, 14 Nov 2026): `scene3d.json`

`static/data/scene3d.json`, kind `tenger.scene3d/1`, built by `scripts/build_scene3d.py`. Index
key: none (fixed path).

| Path | Content |
|---|---|
| `epoch_jd_tdb` | The scene's "now" (2461358.5 = 2026-11-14 00:00 TDB) |
| `frames` | `solar_system`: heliocentric ecliptic J2000, au (obliquity 84381.448″). `stars`: ICRS unit direction + distance in pc |
| `bodies.pluto.catalogue_orbit`, `bodies.makemake.catalogue_orbit` | JPL SBDB elements (`a, e, i, om, w, ma, q, tp, per, n, ad` with value/sigma/units), epoch, solution, producer, plus `orbit_points_au` (180 points for drawing). `content_type: "catalogue"` |
| `bodies.*.position_now` | JPL Horizons heliocentric vector at `epoch_jd_tdb` (position, velocity, distance from the Sun, ephemeris source). Earth included. `content_type: "catalogue"` |
| `bodies.pluto.our_orbit` | **Ours**: the frozen A4 state vector converted to ecliptic elements, its position now, `orbit_points_au`, `limitations`. `content_type: "modeled"`, `ours: true` |
| `stars[]` | Per challenge target: RA/Dec (epoch), ICRS direction, parallax, distance (pc), source, evidence file, and `caution` where the distance is doubtful (RW Aur) |
| `planet_nine` | `status: "hypothetical"`. `estimates[]`: each with `reference`, `doi` and only the quantities its abstract states (`mass_earth`, `semimajor_axis_au`, `eccentricity`, `inclination_deg`, `perihelion_au`, `brightness_v` as `{min,max}` or `{value,plus,minus}`, or a text constraint). No position or orbit is given, so none may be drawn as known |
| `pluto_loop.training[]`, `.evaluation[]` | Per exposure: role, `obs_key`, `t_mjd`, `spherex_au` (Earth + header spacecraft vector), `fitted_pluto_au` (frozen orbit at light emission), and `measured` RA/Dec where Pluto was detected |
| `pluto_loop.frozen_forecast`, `.observed` | The A4 forecast (RA/Dec, `cov_arcsec2`, 3D position) and the A5 observation (RA/Dec, `cov_arcsec2`, Earth position, verdict, D²) |
| `pluto_loop.open_forecast_2027` | The frozen 2027 track with covariances, Earth and fitted Pluto positions, and its "open forecast" label |

---

# Version 10 (additive, 15 Nov 2026): colour previews and verified status in the index

- `index.json` → `targets[].composites_path`: `"<key>/composites.json"` or `null`.
- `index.json` → `targets[].prediction.status` now gives the verified outcome when a
  `verification.json` exists (`hit`, `miss`, `ambiguous`, `invalid_comparison`). A prediction frozen as
  `insufficient_data` stays `insufficient_data`; an unverified prediction stays `waiting`.
- `<key>/composites.json`, kind `tenger.composites/1` (Pluto, Makemake, 3I/ATLAS): `note`
  ("display colours, not for measurement") and `visits[]`, each with `visit`, `path` (240 px WebP,
  body-centred, north up, east left) or `null` with `reason_key`, `content_type: "processed"`,
  `display_only: true`, `label_key`, `groups` (`r`: arrays 5–6, `g`: 3–4, `b`: 1–2), `epoch_ids` (the
  investigation's epochs of that visit), `t_start_mjd`, `t_end_mjd`, `n_exposures`. Each channel is a
  per-visit median with its own stretch, so colours are not comparable between visits or targets.

---

# Version 11 (additive, Task A7, 15 Nov 2026): Pluto open forecast v2, abandoned manifests, hindcast

**Open forecast v2** (`trials/pluto-position-open-2027a-v2b`, `…-2027b-v2b`):
- **`trial.json`** gains:
  - `forecast_label_key` (`forecast.after-2026-miss`), `method_version: 2`, and `revises` (the v1 open
    forecast, which stays valid and unchanged);
  - `model.code_files` (the files whose bytes `model.code_sha256` covers);
  - `model.start_state_bary_au_au_per_day` and `model.start_t0_mjd_utc` (starting values only), and
    `model.uncertainty` (the rule).
- **`prediction.json`:**
  - `model` and every `track[]` point carry `along_track_95_arcsec`, `cross_track_95_arcsec` and
    `uncertainty_basis` (`{"along", "cross"}`: `monte_carlo` or `jackknife`); track points also carry
    `distance_au`, `motion_arcsec_per_day` and `motion_position_angle_deg`;
  - `model_state.kind` is `barycentric_two_body`;
  - `diagnostics` include `group_mean_residuals_arcsec`, `monte_carlo_draws` and `jackknife_groups`.
- **`training.json`:** `source` lists both inputs (the v1 training file and the 2026 verification).
  Points from the 2026 visit have `visit: 3`.

**`trials/<id>/abandoned.json`** (kind `tenger.abandoned/1`): a manifest abandoned **before any
prediction**. Fields: `predicted: false`, `replaced_by`, `reason_key`, `reason`, `trial_sha256` (the
untouched manifest's hash). Readers skip such a trial. `index.json` does not list it, and
`scoreboard.json` lists it only in `abandoned_before_prediction`.

**`trials/pluto/hindcast-v2.json`** (kind `tenger.hindcast/1`): `exploratory: true`, `counts: false`,
`label_key` (`hindcast.v2-label`).
- `old_method` (the frozen v1 numbers: error, residual, C_pred, D², result).
- `new_method` (v2 trained on the two training visits only: position, residual, error, C_pred,
  along/cross 95% sizes, D², `result_if_it_had_been_frozen`).
- `observed`.

Never a trial and never counted.

# Version 12 (additive, Task A8, 15 Nov 2026): Planet X depth and the hidden-planet game

**Artificial content lives only under `static/data/planetx/`.** Every file there carries top-level
`"artificial": true` and `"counts": false`. A node with `"artificial": true` or `content_type:
"artificial"` anywhere else is invalid (`scripts/validate_release.py`). Nothing under `planetx/` is a
detection, a trial or a scoreboard entry.

**`planetx/depth.json`** (kind `tenger.planetx_depth/1`): single-exposure depth measured by
injection-recovery on real exposed fields.
- `method`: `single_exposure: true`, `injection`, `psf_source`, `detection_rule` (`fit`, `snr_min` 5,
  `max_offset_px` 1, `site_snr_min` 10, `rule_key`), `positions` (per exposure, blanks, `exclusion`),
  `mag_step` 0.25, `interval_method` `"wilson"`, `confidence` 0.95, `depth_interval_method`, `seed`.
- `bands[]`: `id` (`"i"` ≈ 0.8 µm on D1, `"w1"` ≈ 3.4 µm on D4, `"w2"` ≈ 4.6 µm on D6), `detector`,
  `wavelength_um` [lo, hi] (the selection window), `centres_used_um`, `published_band`, `nominal_um`,
  `magnitudes` (the grid), `pooled` and `fields[]`. Each of `pooled` and `fields[]` has:
  - `curve[]`: `{mag_ab, injected, recovered, fraction, interval: [lo, hi]}` (95% Wilson);
  - `depth_50_ab`, `depth_90_ab`: `{value, interval: [bright, faint]}` or `null` when the curve never
    crosses the level;
  - `site_threshold` (the same at S/N ≥ 10), `false_detection` (`blanks`, `false`, `rate`, `interval`),
    `grid_spans_full_range`, `bright_fraction`, `faint_fraction`.
  - Fields also have `field_key`, `field_role`, `n_exposures`, `zodi_mjy_sr` (`median`, `min`, `max`)
    and `exposures[]` (`obs_key`, `t_mjd`, `centre_um`, `url`, `source_sha256`, `zodi_mjy_sr`,
    `psf_fwhm_arcsec`, `epsf_calibration`).
- `photometry_check`: inject-then-measure flux test (`median_mag_out_minus_in`, `rms_mag`,
  `median_abs_pull`). `psf_mapping_test`: ePSF zone mapping on bright isolated stars (`stars`,
  `nearest_better`, `fraction`, `interval`, `by_band`, `tables`).
- `models[]`: published Planet Nine magnitudes in the same bands only: `id`, `reference`, `doi`, `url`,
  `band_id`, `scenario_key`, `mag_published` (`value`, `system`), `vega_to_ab` (`offset`, `reference`),
  `mag_ab`, `location` (table, section, page), optional `derived` (the paper's own rule used),
  `distance_au`, `mass_earth`, `note_key`, `system_note_key`.
- `wise_limit`: `band_id`, `mag_vega`, `mag_ab`, `completeness`, `mag_vega_50`, `mag_ab_50`,
  `reference`, `doi`, `url`, `location`, `region`, `data`, `vega_to_ab`, `note_key`.
- `mission_sensitivity`: `per_channel_after_all_surveys: true`, `full_mission` and
  `single_visit_prelaunch` (each with `reference`, `url`, `sigma`, `values`).
- `motion[]` (one per challenge field): `visits[]` and `by_distance[]` (`distance_au`,
  `within_visit_arcsec[]`, `between_visits_arcsec[]`, `rate_arcsec_per_day` [min, max],
  `orbital_rate_bound_arcsec_per_day`), from the observer's real geometry.
- `verdicts[]`: `band_id`, `model_id` (or `"wise-limit"`), `model_mag_ab`, `depth_50_ab`, `gap_mag`
  (`value` = model − depth, positive = too faint; `sigma`), `factor_in_flux`, `verdict_key`.
- `stacked_projection`: `projection: true`, `measured: false`, `note_key`, `assumptions_key`, `rows[]`
  (`band_id`, `exposures_stacked`, `projected_depth_50_ab`). Never shown as a measurement.
- `verdict_key`, `verdict_summary` (`key`, `values` for the placeholders, `text`), `limitation_keys`,
  `credits_keys`.

**`planetx/hidden-planet.json`** (kind `tenger.hidden_planet/1`): game pairs with one injected moving
source. `label_key`, `rule_key`, `derived_from`, and `pairs[]`:
- `id`, `field_key`, `band_id`, `injected_mag_ab`, `mag_rule`, `distance_au`, `dt_days`,
  `motion_arcsec` (`east`, `north`, `total`), `tolerance_px` (1 native pixel in plate pixels);
- `frames[2]`: `path` (`planetx/hidden/<id>-<n>.webp`), `t_mjd`, `obs_key`, `url`, `source_sha256`,
  `centre_um`, `pixel_arcsec`, `width`, `height`, `north_up: true`, `east_left: true`,
  `artificial: true`, `content_type: "artificial"`, `synthetic: true`, `display`. The real exposure is
  reprojected onto a common 3″ grid after the source is injected into its native pixels.
- `injected[]`: `{frame, x, y, ra_deg, dec_deg}`, plate pixels, origin top-left, pixel centres at
  integers;
- `pipeline`: `found` (both frames), `positions[]` (`frame`, `x`, `y`, `found`, `snr`), `rule_key`,
  `guided: true` (the fit starts at the injected position).
