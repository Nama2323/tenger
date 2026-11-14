# TENGER data contract

Owner: Session A (science/data) writes the files. Session B (website) reads them. To change the
contract, **append a new version section** at the end. Never edit a published version silently;
only typo fixes are allowed in place, and each one is noted in the changelog.

## Changelog

| Version | Date | Change |
|---|---|---|
| 1 | 2026-11-14 | First version (Task A1). Defines nine file types, enums, paths and examples. |
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
