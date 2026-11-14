# TENGER release notes (Task H2, 15 Nov 2026)

This is the release candidate on branch `tenger-dev` of `github.com/Nama2323/tenger`. Nothing has
been pushed to `main`, tagged or deployed. The repository is still private, GitHub Pages is not
enabled (`gh api repos/Nama2323/tenger/pages` → 404), and `main` is still at `58f993b`, an ancestor
of `tenger-dev`, so `main` can be fast-forwarded.

## Acceptance matrix

Checks were run on 15 Nov 2026, Ulaanbaatar time, on `tenger-dev` after rebasing on Session B's
`16da115`.

| Feature | Evidence | Result |
|---|---|---|
| **See:** the five challenge targets (Barnard's Star, WISE 0855, Epsilon Indi B, RW Aur, R Dra) | `static/data/<key>/investigation.json` ×5 pass `scripts.validate_release`. Session B captured every page state at 360/390/768/1280 px (`docs/screens`). In a Pages simulation (`static/` served alone from `/tenger/`, no backend), Barnard's Star opened with no console errors | **Pass** |
| **See:** Pluto, Makemake and 3I/ATLAS previews | Investigations and per-visit composites (contract V10) pass the validator. 3I/ATLAS is See-only | **Pass** |
| Science inputs (DR1/QR3, flag schemas, native IMAGE/VARIANCE/FLAGS/ZODI/WCS-WAVE, spectral grading, gated difference images) | `pytest`: 179 passed, 2 skipped (network tests, which run with `--network`) | **Pass** |
| Live search for any coordinates | Works with the local FastAPI server. On `*.github.io` the app calls `spherex-blink.onrender.com`, whose CORS allows only `pythonhack000.github.io` (team decision 6: not changed) | **Pass locally; does not work on a Pages copy** |
| Frozen trials and hash chains | `python -m scripts.predict check`: 13 of 13 trial folders intact. The validator also compares each `prediction.json` with the copy in its receipt commit and rechecks model code hashes and verification hashes | **Pass** |
| One honest prospective trial | `pluto-position-2026b`: **miss**, 5.90″, D² 6.77 > 5.991, published. `confirmation_pending: true`: Narmandakh opened no evaluation pixels. He saw only the visit's archive listing, which may include JPL-predicted positions, and the forecast did not use it. The other three teammates have not answered yet (`docs/EXPOSURE.md`) | **Pass** (the miss is published; the prospective label waits for three confirmations) |
| Retrospective trials | Barnard's Star hit (D² 2.62) and Epsilon Indi B hit (D² 0.21), both retrospective and catalogue-assisted. Four trials insufficient data. The baseline misses all three checked trials | **Pass** |
| Scoreboard | `scoreboard.json` equals a fresh `build_scoreboard` run (validator). The Predictions page shows the file's counts: prospective 1 miss, retrospective 2 hit and 4 insufficient, open forecasts never counted | **Pass** |
| Open forecasts | Pluto April 2027 v1 and v2b, Pluto Sept/Oct 2027 v2b, Makemake (insufficient). All are listed, none counted, and the two abandoned v2 folders stay out of the index | **Pass** |
| Post-mortem and v2 hindcast (exploratory) | `trials/pluto/postmortem.json` and `hindcast-v2.json` have `exploratory: true` and `counts: false`, and their numbers match the frozen verification (validator) | **Data pass**. Web: "Why we missed" is in progress (Session B, R3); the hindcast is not shown |
| Beat the physics | 3 rounds from real trials (Barnard's Star, Epsilon Indi B, Pluto) equal a fresh `build_records` run. Node game tests pass | **Pass** |
| Three printable lessons | `lessons/{distance,brightness,how-sure}.json` equal a fresh `build_records` run. A stale scoreboard hash in `how-sure.json` was found by the validator and regenerated in H2. Print check in the Web status (B3) | **Pass** |
| Planet X Lab and 3D scene | `scene3d.json`: every body and star has its source. Planet Nine is `hypothetical`, with no position or orbit: five cited estimates, each with a DOI or arXiv reference. Our Pluto orbit is labelled modeled (validator). The 3D Home draws Planet Nine only as faint rings for the three published semi-major-axis ranges | **Pass** |
| English only, one resource file | `strings.en.json` (148 keys) and `js/i18n.js`. `node --test tests/*.mjs`: 152 passed, 0 failed | **Pass** |
| No example or fixture data published as real | Validator: no `"example": true` under `static/data`, and every JSON under `static/dev-fixtures` carries `"example": true`. Fixtures load only with `?fixtures=1`, under a banner | **Pass** |
| Responsive and accessible | Session B: 175 captures, no horizontal scroll, no control under 44 px, Lighthouse accessibility 100 on all four pages | **Pass at emulated widths**; not checked on a real phone |
| Credits, DOIs, team, base project, AI disclosure | `README.md`, the About page, `tests/release.test.mjs` (acknowledgement text and keys) | **Pass** |
| No automatic rebake during judging | `bake.yml` schedule removed on `tenger-dev` (`workflow_dispatch` kept). **`main` still has the weekly schedule** until it is updated (see step 0 below) | **Pass on `tenger-dev`; open on `main`** |
| GitHub Pages deploy | `pages.yml` uploads `static/` (139 MB, 1,461 files, none over 50 MB, no symlinks, relative paths only). The same tree served from `/tenger/` loads Home (3D), See, Predictions and the scoreboard. The only 404s are the expected `verification.json` files of unverified trials | **Ready, not deployed** |

## Known limits

- **Live search on Pages.** See the matrix. Fixing it needs either the Render service's CORS to allow
  `https://nama2323.github.io` or a TENGER backend deployment. Both are outside this task.
- **Prospective label.** Pluto is listed as prospective-unexposed but marked pending until the three
  remaining teammates confirm they did not view the evaluation visit. One teammate saw that visit's
  archive listing (metadata only, no pixels). Two hits that are retrospective and
  catalogue-assisted are demonstrations, and three checked trials cannot show that our 95% regions are calibrated.
- **Measurement model.** The PSF is a pixel-integrated Gaussian, not the full SPHEREx ePSF. Pairs
  closer than about 15″ are not separated. Saturated stars get wing fits only, so Barnard's Star, RW Aur
  and R Dra have no brightness measurements.
- **Wavelengths.** These come from WCS-WAVE (about 1 nm), not from the CWAVE/CBAND Spectral WCS
  product. The same-response tolerance (same array, 10% of the narrower bandwidth) is a TENGER choice.
- **Parallax.** For Barnard's Star and Epsilon Indi B it is fixed to the catalogue value because the
  free fits are inconsistent (visit systematics). This is why those trials are catalogue-assisted.
- **Pluto forecasts.** Few visits; the post-mortem shows the frozen uncertainty was too small. The
  v1 April 2027 open forecast keeps that method unchanged on purpose.
- **Manual bake.** A manual run of `bake.yml` would rebuild `static/data` with the older SPHEREx Blink
  pipeline, push to `main` and redeploy. Do not run it during judging.
- **Web.** The 3D scene is a log-scale picture, not an ephemeris. `og:image` is relative until the
  public address is set. Receipt links to commits work only once the repository is public.
- **Bundled data are exposed.** Teammates have seen every bundled frame (CLAUDE.md, decision 8).

## Run locally

```
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn backend.api:app --host 0.0.0.0 --port 8765
```

Open http://localhost:8765, or http://<mac-ip>:8765 from a phone on the same Wi-Fi. Release checks:

```
.venv/bin/python -m pytest
node --test tests/*.mjs
.venv/bin/python -m scripts.validate_release
.venv/bin/python -m scripts.predict check
```

## Making the repository public and deploying Pages (for the team to run; not done here)

**Step 0, as soon as possible.** `main` still has the weekly bake schedule (`17 4 * * 1`). Its next
run is **Monday 16 Nov 2026, 04:17 UTC (12:17 Ulaanbaatar)**, during judging. That run would rebake
with the old pipeline, commit to `main` and trigger Pages. Either update `main` (step 3) before then,
or disable the workflow now:

```
gh workflow disable bake.yml -R Nama2323/tenger
```

1. **Final check** on an up-to-date `tenger-dev` (all four commands above pass). If possible, record
   the three remaining teammates' confirmations first (`docs/EXPOSURE.md`).
2. **Make the repository public** (planned for Sunday 14:00; Pages on a private repository needs a
   paid plan):

   ```
   gh repo edit Nama2323/tenger --visibility public --accept-visibility-change-consequences
   ```

3. **Enable Pages with GitHub Actions as the source**, then update `main`. Enabling first means the
   deploy triggered by the push succeeds.

   ```
   gh api -X POST repos/Nama2323/tenger/pages -f build_type=workflow
   ```

   ```
   git fetch origin && git push origin origin/tenger-dev:main
   ```

   The push is a fast-forward (`main` is an ancestor of `tenger-dev`). To review it as a pull request
   instead: `gh pr create -R Nama2323/tenger --base main --head tenger-dev --title "TENGER release"`, then
   merge it on GitHub.
4. **Deploy.** The push to `main` changes `static/**`, so `pages.yml` starts on its own. If it does
   not:

   ```
   gh workflow run pages.yml -R Nama2323/tenger --ref main
   ```

   ```
   gh run watch -R Nama2323/tenger
   ```

5. **Check** https://nama2323.github.io/tenger/: Home (3D or 2D map), each challenge target, Pluto's
   preview, Predictions (scoreboard and the reveal), Beat the physics, Learn (print a lesson), About,
   and a receipt link (works only once the repository is public). Live search will not work there
   (see Known limits).
6. **Afterwards (Session B):** set absolute `og:url` and `og:image` for the public address.

Do not run `bake.yml` or push other branches to `main` while the entry is being judged.
