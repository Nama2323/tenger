# TENGER: Claude Code prompts in send order (MacBook)

Base: the team's SPHEREx Blink code (pythonhack000/spherex-blink). Plan: docs/tenger-context/MERGED-PLAN.md.
Rules: CLAUDE.md (read its "Team decisions" first; they override the kit: English only, push only to `tenger-dev`).
These prompts replace the prompts inside START-HERE.md and the PDFs.

Two terminals:
- **Terminal A = Session A, science and data**, folder `~/tenger`, branch `tenger-dev`.
- **Terminal B = Session B, website**, folder `~/tenger-web` (a git worktree, local branch `web`).

Paste one prompt at a time. Type `/clear` in a terminal before its next prompt. If you prefer one terminal only,
run every prompt below in Terminal A in the same order (slower, but simpler).

| # | When (Ulaanbaatar) | Terminal | Prompt | Phase |
|---|---|---|---|---|
| 0 | Sat 19:15 | Mac Terminal | Setup by hand | - |
| 1 | Sat 19:30 | A | A1 baseline, exposure inventory, data contract | A |
| 2 | after A1 pushes (~20:15) | A | A2 science and data repair | B |
| 3 | after A1 pushes (~20:15) | B | B1 TENGER interface | E |
| 4 | Sat ~23:30 (can run overnight) | A | A3 real investigations for all targets | C, D |
| 5 | Sun 07:00 | A | A4 freeze and predict (no verifying) | F |
| 6 | Sun 07:30 | B | B2 Beat the physics | G |
| 7 | after A4 pushes | A | A5 verify and scoreboard | F |
| 8 | Sun ~10:30 | B | B3 three lessons and Planet X Lab | G |
| 9 | Sun 13:00 | A and B | Checkpoint (by hand) | - |
| 10 | Sun 14:00 | B, then A | H1 web release prep, H2 data release checks | H |
| 11 | Sun 18:00 | you | Feature freeze, then video, project page, submit by 22:00 | - |

---

## Step 0: setup by hand (Mac Terminal, about 15 minutes)

The private repo github.com/Nama2323/tenger already exists. Its `main` holds only a placeholder from earlier
(an old CLAUDE.md); step 3 replaces it.

```bash
# 1. The team's code, with your private repo as "origin"
cd ~
git clone https://github.com/pythonhack000/spherex-blink.git tenger
cd tenger
git remote rename origin upstream
git remote add origin https://github.com/Nama2323/tenger.git

# 2. Add this kit (puts CLAUDE.md in the root and everything else in docs/)
unzip -o ~/Downloads/TENGER-mac-kit.zip -d ~/tenger

# 3. Working branch, first commit, push
git checkout -b tenger-dev
git add CLAUDE.md docs
git commit -m "docs: add TENGER context, team decisions and prompts"
git push --force origin tenger-dev:main
git push -u origin tenger-dev

# 4. Keep the Mac awake while Claude works (stop later with: killall caffeinate)
caffeinate -dimsu &

# 5. Start Session A
claude
```

If a push says "refusing to allow an OAuth App to create or update workflow", run `gh auth refresh -s workflow`
and push again. If git asks for a password, run `gh auth login` first (`brew install gh` if needed).

Session B is set up after A1 has pushed (see Step 3).

---

## Step 1: Terminal A, prompt A1 (baseline, exposure inventory, data contract)

```text
Read CLAUDE.md fully, "Team decisions" first. Then read docs/tenger-context/MERGED-PLAN.md, START-HERE.md and
context/KNOWN-STATE.md, and skim context/TENGER-audit-and-roadmap.md and TENGER-modification-blueprint.md for
file-level findings. The prompts inside START-HERE.md and the PDFs are superseded by the ones I send you.
You are Session A (science and data). TASK A1: baseline, exposure inventory and data contract. Do not change
application behaviour in this task.
1. Baseline: create .venv (Python 3.12 if installed, else the newest 3.x), install requirements.txt, run
   `.venv/bin/python -m pytest` and `node --test tests/*.mjs`, start
   `.venv/bin/uvicorn backend.api:app --host 0.0.0.0 --port 8765` and confirm the five challenge targets open at
   http://localhost:8765. Record exact counts and any failures.
2. Network: confirm from this Mac that IRSA (SIA, TAP, cutouts), JPL Horizons, SIMBAD and VizieR answer.
   Record each result. If one is down, say which features it blocks.
3. Exposure inventory, BEFORE opening any new SPHEREx pixels: for Barnard's Star, WISE 0855, Epsilon Indi B,
   R Draconis, RW Aurigae, Makemake, Pluto and 3I/ATLAS, list which observations (obs_id, date, release, band)
   are bundled in static/data/ and data/, and which the team has already seen (KNOWN-STATE.md: treat every
   bundled frame, thumbnail and result of the five challenge targets as exposed). Then query METADATA ONLY
   (SIA/TAP listings, no cutouts, no rendering) for DR1/QR3 observations that are newer than or absent from the
   bundled set. Write docs/EXPOSURE.md: per target, the exposed set, the candidate never-opened set that could
   support a prospective trial, and the rule that no one opens those pixels until predictions are frozen.
4. Write docs/DATA-CONTRACT.md version 1 (MERGED-PLAN section 5): JSON shapes, file paths under static/data/,
   and a "schema_version" in every file, for: site index; investigation manifest; trial manifest; prediction.json
   (immutable); prediction receipt (separate file, holds the hash and commit); verification.json; scoreboard
   (derived only); game record; lesson record. Status enums: waiting, hit, miss, insufficient_data, ambiguous,
   invalid_comparison, see_only. Trial categories: prospective_unexposed, retrospective_holdout,
   catalogue_assisted, illustrative. Give one tiny example per file, marked "example": true.
5. Create docs/IMPLEMENTATION_STATUS.md with two sections, "Science/data" (yours) and "Web" (Session B's).
Commit "docs: baseline, exposure inventory, data contract" and publish:
git fetch origin && git rebase origin/tenger-dev && git push origin HEAD:tenger-dev
End with a short report: test counts, network status, the exposure table, and anything that blocks Session B.
```

---

## Step 2: Terminal A, `/clear`, prompt A2 (science and data repair)

```text
Read CLAUDE.md, docs/IMPLEMENTATION_STATUS.md, docs/EXPOSURE.md and docs/DATA-CONTRACT.md. Session A.
TASK A2 = MERGED-PLAN phase B: repair the science inputs in the existing code. Keep the current viewer working at
every commit. Do not open pixels of the never-opened observations listed in docs/EXPOSURE.md.
1. Releases: backend/archive.py and config.py discover and select DR1 and QR3 (DR1 is currently missed); every
   source has a release-aware identity; cache keys include release, processing version, mask policy, grid and
   pipeline version, so old QR-only caches are never reused as corrected products.
2. Flags: decode both historical MP_* and current MSKN*/MSKM* definitions from the FITS headers; keep each
   flag's reason; an unknown flag schema is rejected, not treated as safe. Verify header names against the
   official IRSA SPHEREx product documentation and one real downloaded DR1 cutout (an exposed observation).
3. Keep IMAGE, VARIANCE, FLAGS, ZODI, WCS and WCS-WAVE through processing; measurements use native-resolution
   data and VARIANCE, independent of the 160-pixel display previews.
4. Spectral matching: remove silent nearest-channel substitution from quantitative time comparisons; a
   comparison gets status quantitative, qualitative or invalid with a written reason.
5. Tests: update tests that endorsed the old behaviour; add a small real FITS fixture (a few KB cutout) for flags,
   variance and DR1 parsing; mark network tests so they can be skipped offline.
Run pytest and node --test, start the server and check the five targets still open. Update the Science/data
section of the status file (changed files, commands, pass/fail, limits). Commit in small steps and publish
(rebase first). If this is not finished by 23:30, stop at a working commit and list what is left.
```

---

## Step 3: Terminal B setup and prompt B1 (TENGER interface)

Set up Session B once A1 has pushed (Mac Terminal):

```bash
cd ~/tenger
git fetch origin
git worktree add ../tenger-web -b web origin/tenger-dev
cd ~/tenger-web
claude
```

Session B can run the site with Session A's environment on another port:
`../tenger/.venv/bin/uvicorn backend.api:app --host 0.0.0.0 --port 8766`

```text
Read CLAUDE.md ("Team decisions" first: you are Session B), docs/tenger-context/MERGED-PLAN.md sections 1, 6
and 7, docs/DATA-CONTRACT.md and docs/IMPLEMENTATION_STATUS.md. Edit only static/ except static/data/,
tests/*.mjs and the Web section of the status file. Labeled fixtures go only in static/dev-fixtures/.
TASK B1 = MERGED-PLAN phase E: the TENGER interface, extending the existing plain-JS app (no new framework,
no build step: GitHub Pages serves static/ as is).
1. Read static/index.html, static/js/*.js and static/css/style.css first and write a short map of the current UI
   into the Web section. Split static/js/main.js only where you touch it, keeping the renderer, viewport and
   chart utilities.
2. TENGER identity and navigation: Home/Investigate, Beat the physics, Learn (with the Planet X Lab), About.
3. Home: a schematic log-distance map labelled "Schematic: not a sky map. Angles are arbitrary; distances come
   from the cited sources", an accessible target list built from the same index, a prominent RA/Dec + FOV search
   and the five official target shortcuts. Makemake, Pluto and 3I/ATLAS show "not available yet" until Session A
   publishes their products. Colours: background #05070d, panel #0a0f1a, card #0f1726, text #e6edf7; stars
   amber, variable stars purple, Solar System cyan, hypothetical Planet Nine orange; check contrast.
4. Investigation panel order: See, What changed, Prediction, Evidence, optional Spectrum. See keeps the existing
   viewer and adds Swipe and Side-by-side next to Blink and Difference, with explicit A/B observation IDs, band
   and mode. A caption strip shows observation time or range, wavelength, release, source link and status
   (real, processed, difference, context or artificial). Prediction and Evidence read the contract files and show
   honest "waiting" or "not available" states when files are missing. Never show sample numbers as real.
5. URLs: keep ra, dec, fov, target and embed working; add page, panel, band, a, b and v (data version); accept
   id as an alias of target; a share link restores the state; coordinates win over a conflicting target.
6. Every visible string comes from one English resource (extend static/js/i18n.js; English is the default).
7. Real buttons, 44 px tap targets, keyboard left/right/space in the viewer, prefers-reduced-motion, chart data
   also as a table, no horizontal scroll at 360, 390 and 768 px and on desktop.
Test with node --test and in a real browser at 360, 390, 768 and 1280 px (check the actual viewport size); save
screenshots to docs/screens/. Commit "feat(web): TENGER shell, map, feed and investigation panels" and publish:
git fetch origin && git rebase origin/tenger-dev && git push origin HEAD:tenger-dev
Report what works and what is waiting on Session A.
```

---

## Step 4: Terminal A, `/clear`, prompt A3 (real investigations; can run overnight)

```text
Read CLAUDE.md, docs/IMPLEMENTATION_STATUS.md, docs/EXPOSURE.md and docs/DATA-CONTRACT.md. Session A.
TASK A3 = MERGED-PLAN phases C and D. Keep the never-opened observations in docs/EXPOSURE.md closed.
1. One real investigation end to end first: Barnard's Star. Quality-gated epochs from DR1/QR3, spectrally
   matched comparisons, native measurements with VARIANCE-based errors and masks, provenance (source files,
   checksums, release, processing version), previews built from the same source of truth, and an investigation
   manifest in static/data/ following the contract. Field-star control with catalogue motion checked.
2. Then the other four official targets (WISE 0855, Epsilon Indi B, R Draconis, RW Aurigae). Each gets an
   explicit measurement status; insufficient data stays honest and you move on.
3. Then the demonstration targets: Makemake and Pluto (object-following acquisition plus a fixed-sky pair) and
   3I/ATLAS (official exposure table; See-only). If a product does not validate, publish its "not available"
   status with the reason.
4. Optional context, only if time allows: 2MASS Ks and AllWISE W2 for the moving stars, using actual
   observation dates; non-detections stay non-detections. WISE/Gaia failures must not break a bake.
5. Site index updated so the website lists every target with its real availability.
Tests: spectral rejection, masks/errors, coverage/FOV centring, reproducibility. Update the status file. Commit per
target and publish after each one (rebase first), so Session B sees real data as soon as it exists.
```

---

## Step 5: Terminal A, `/clear`, prompt A4 (freeze and predict; do not verify)

```text
Read CLAUDE.md "Prediction integrity", docs/EXPOSURE.md, docs/DATA-CONTRACT.md and MERGED-PLAN section 4.
Session A. TASK A4 = phase F part 1: freeze and predict. Do NOT open, download, render or measure evaluation
pixels and do NOT query truth (Horizons, SIMBAD positions for the test epoch) in this task.
1. For each target decide, from docs/EXPOSURE.md, its trial category: prospective_unexposed only where the
   evaluation observation is genuinely never-opened; retrospective_holdout where it was bundled or seen;
   catalogue_assisted where catalogue or ephemeris priors drive the forecast; illustrative otherwise. 3I/ATLAS is
   see_only. RW Aurigae may get only an exploratory range, not a calibrated 95% interval.
2. Write a trial manifest per target: training observation IDs and hashes, evaluation observation ID and time,
   permitted priors, model, a simple linear baseline, scoring rule (2D: D^2 = r^T S^-1 r <= 5.991 with
   S = C_pred + C_obs; 1D: |z| <= 1.96 with combined sigma) and exclusion rules.
3. Fit only models the training data can support: stars with annual-parallax observer geometry where
   constrained; Makemake/Pluto only if the training arc constrains the fit (otherwise catalogue_assisted or no
   forecast, with the reason); R Draconis only with a justified period model. Show residuals and sensitivity.
4. Write each prediction.json (immutable, with the training manifest hash), hash it, commit
   "predict: freeze <target>", and write the receipt (file hash and commit) as a separate file.
5. Test input isolation (no truth network calls, no evaluation files read), deterministic output and tamper
   detection.
Publish (rebase first). Report exactly which trials are eligible, their categories and why. Stop here.
```

---

## Step 6: Terminal B, `/clear`, prompt B2 (Beat the physics)

```text
Read CLAUDE.md, docs/DATA-CONTRACT.md (game record), docs/IMPLEMENTATION_STATUS.md and MERGED-PLAN section 7.
Session B. TASK B2 = phase G game. Build game.html (or a game view) from trial and game records.
1. Start with ONE valid round, then add up to three: Barnard's Star position, Makemake position, R Draconis
   brightness, only where the records exist. Until Session A publishes them, use a clearly labelled fixture
   from static/dev-fixtures/ that never ships as real data.
2. Show the training epochs; the player taps a guess; reveal in order: player, linear baseline, frozen model and
   its region, actual observation with its thumbnail. Show raw errors with units for all three.
3. Score with a documented, bounded scale fixed per round before the reveal (no division by the baseline
   error); handle zero and non-finite values. Physics is allowed to lose.
4. Labels show the trial category (retrospective, catalogue-assisted, illustrative) exactly as the scoreboard
   does. localStorage is best effort inside try/catch; no backend, no public leaderboard.
5. Touch and keyboard play, reduced motion, English strings in the resource file.
Test with node --test (scoring edge cases) and in a browser at 360 and 1280 px; screenshots to docs/screens/.
Update the Web section, commit "feat(web): Beat the physics" and publish (rebase first).
```

---

## Step 7: Terminal A, `/clear`, prompt A5 (verify and scoreboard)

```text
Read CLAUDE.md "Prediction integrity", docs/DATA-CONTRACT.md and the frozen trial files. Session A.
TASK A5 = phase F part 2: verify, then derive the scoreboard.
1. Verify only trials whose prediction.json still matches its receipt hash. Then load the evaluation
   observations with the same quality and measurement pipeline and write a separate verification.json.
2. Solar System recovery: search around the frozen predicted position and time, list every candidate source,
   check field-star confusion and motion across exposures, keep alternatives; the brightest dot is not
   automatically the target. Only then compare with an independent ephemeris, stating the observer
   approximation (Horizons location 500 is geocentric, not the spacecraft).
3. Score with tangent-plane residuals and the combined covariance (D^2 <= 5.991 in 2D; |z| <= 1.96 in 1D).
   Keep misses, ambiguous and unavailable outcomes. Never edit a frozen prediction; a model change after the
   reveal is a new exploratory version and stays out of the counts.
4. Write the scoreboard as a derived file: counts per category and status, plus the expected number of hits
   only where 95% coverage is defensible. Write the game records (training display, baseline, frozen model,
   reveal) and the lesson records (sourced real numbers) the website needs.
5. Tests: tamper rejection, covariance and interval cases, singular cases, counts.
Publish (rebase first). Report every outcome honestly, including misses.
```

---

## Step 8: Terminal B, `/clear`, prompt B3 (three lessons and the Planet X Lab)

```text
Read CLAUDE.md, docs/DATA-CONTRACT.md (lesson record) and MERGED-PLAN section 7. Session B.
TASK B3 = phase G lessons and Lab, in English.
1. Three printable lessons for grades about 8-11, each with: a short idea, an accessible formula, a worked
   example from the lesson records, three exercises with answers hidden behind toggles, a teacher note, a link
   to the source investigation, and print CSS (clean worksheet, answers on a separate last page).
   - Lesson 1, distance and a moving observer: small-angle geometry. Real Makemake/Pluto motion includes
     orbital motion, so a parallax-only distance is a model illustration; say so.
   - Lesson 2, brightness, logarithms and detection limits: reflected light falls with distance; visual magnitude
     model with its assumptions. Do not compare V magnitude with SPHEREx near-infrared AB depth and do not
     hard-code AB 18.4 as a proven limit; compare same-band quantities or say detectability is undetermined.
   - Lesson 3, how sure are we: uncertainty, 2D regions (why 2.45 and not 2), the actual eligible trial counts
     from the scoreboard, false alarms E = N * P(Z > k) with independence caveats.
2. Planet X Lab: sliders for distance and size/albedo assumptions, the resulting model brightness and motion,
   every assumption written next to the result, Planet Nine labelled hypothetical, no "SPHEREx cannot see it"
   verdict unless the adopted same-band model supports it.
3. No real-number example until its record exists; until then show "available after verification" or a clearly
   marked synthetic exercise.
Test the numbers with node --test, check that every visible string comes from the English resource, and check the print preview.
Update the Web section, commit "feat(web): lessons and Planet X Lab" and publish (rebase first).
```

---

## Step 9: Sunday 13:00 checkpoint (by hand, 10 minutes)

Ask each session: "Give me a 5-line status: done, broken, and what you would cut to finish by 18:00."
Cut in this order: optional spectra, 2MASS/AllWISE context, third game round, Makemake/Pluto recovery,
second game round. Never cut: the five-target viewer, honest scoreboard states, one game round, the lessons.

---

## Step 10: Sunday 14:00, release preparation

Decide where the final public site lives before H1:
- (a) Nama2323/tenger: make it public (Settings, Change visibility), Settings, Pages, Source: GitHub Actions,
  and ask the teammate to add https://nama2323.github.io to the CORS list of the Render server; or
- (b) pythonhack000/spherex-blink: the teammate merges `tenger-dev` into their repo, which already has Pages and
  Render working.

### Terminal B, `/clear`, prompt H1

```text
Read CLAUDE.md and docs/IMPLEMENTATION_STATUS.md. Session B. TASK H1 = phase H for the website. Fix, don't add.
1. About / Data Sources page: methods, limitations, "What TENGER can and can't see", data credits with DOIs
   (SPHEREx DR1 doi:10.26131/IRSA678, cube doi:10.26131/IRSA679), the IRSA acknowledgement copied exactly
   from docs/tenger-context/context/IRSA-acknowledgement.txt, 2MASS, WISE, Gaia, SIMBAD, JPL, VSX, Aladin
   Lite, every library and font with its licence, credit to the team's SPHEREx Blink base, and an accurate AI
   disclosure: planning and audit with Codex, implementation with Claude Code (Anthropic), reviewed by the team.
2. Short guided tour (skippable, once per browser) and embed mode with a "Copy embed code" button.
3. Full browser pass at 360, 390, 768 and 1280 px: coordinate -> data -> band/A/B/mode -> evidence ->
   prediction -> game -> lesson print -> shared URL restore. Fix layout bugs and console errors.
4. Performance: lazy-load frames; recompress oversized images; check with Lighthouse (mobile).
5. Open Graph tags and an og.png from a real screenshot. Check every external link.
Commit "release(web): prepare v1.0", publish to tenger-dev. Report the acceptance matrix and anything failing.
Do not push to main, tag or deploy.
```

### Terminal A, `/clear`, prompt H2

```text
Read CLAUDE.md and docs/IMPLEMENTATION_STATUS.md. Session A. TASK H2 = phase H for data and science.
1. Run all tests. Add a production validator that rejects test-fixture scoreboards, unlabelled simulations,
   files without source metadata and stale schema versions; run it on static/data/.
2. Check every number the site shows for the five targets, the scoreboard, the game and the lessons against its
   source record; list mismatches and fix them at the source.
3. Finalise README: what TENGER is, how to run it, data credits, team, AI disclosure, limitations.
4. Write docs/RELEASE.md: acceptance matrix (feature, evidence, pass/fail), known limits, local run command,
   and the exact steps to deploy for review. Do not push to main, tag or deploy.
Commit "release(data): validators and docs" and publish to tenger-dev.
```

When both pass: merge to main and deploy by hand, or tell Claude in one terminal, for example:
"I authorize merging tenger-dev into main on origin and running the Pages workflow."

---

## Step 11: Sunday 18:00 onwards (people, not Claude)

Feature freeze at 18:00. Record the 30-second video or prepare up to 7 slides, fill in the project page
(link the public repo and site, list every external resource in References), check every link in a private
window, and click Submit before 22:00. Deadline 23:59.

---

## If a session crashes or its context fills up

```text
Continue TENGER from the current code and docs/IMPLEMENTATION_STATUS.md. Read CLAUDE.md (Team decisions first),
docs/tenger-context/MERGED-PLAN.md, docs/EXPOSURE.md and docs/DATA-CONTRACT.md. Run git status and preserve
uncommitted changes. Do not restart the repository, repeat finished research or regenerate frozen predictions.
Recheck the last recorded test state, tell me in 5 lines where things stand, then continue the next unfinished
step of my last prompt for this session (Session A or B as stated in the status file).
```
