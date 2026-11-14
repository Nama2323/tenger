# Start here: context and prompts for Claude Code

This kit turns the previous audit/blueprint and the new v2 ideas into one implementation request. The code is not included in the kit: Claude must have filesystem access to the actual complete existing repository.

## 1. What context to provide

### Required

1. **The complete current project folder**, not screenshots or backend files alone. Include `backend/`, `scripts/`, `static/` and its prepared data, `tests/`, requirements, README, LICENSE, Docker/Render files, hidden deployment workflows, and any local project instructions. Include current uncommitted changes. If the full data are too large, provide an inventory and a usable training subset, while explicitly reporting missing data.
2. **This kit installed as project context.** Put the contents in `docs/tenger-context/` inside the existing project. Place the kit's `CLAUDE.md` in the project root, or merge it into an existing `CLAUDE.md` without erasing unrelated user instructions. Keep `MERGED-PLAN.md`, `START-HERE.md`, `context/` and `reference-pdfs/` together under `docs/tenger-context/`.
3. **The known state/exposure information.** Claude must read `context/KNOWN-STATE.md` before opening candidate holdout data. Say which files/results people have already viewed. Unknown exposure is not evidence of blindness. If someone can genuinely reserve unseen data, identify the separate custodian/location without exposing those pixels in the prompt.
4. **Current project settings:** local codebase location, Git repository/branch if any, actual time budget, timezone, intended domain/base path, supported languages and publishing permission. Use the settings template below. Missing remote/domain should not block local work.
5. **Network/tool availability.** Claude needs access to official documentation and public astronomy services to verify current integrations. If browsing/network or browser testing is unavailable, it must report that boundary and continue local work without claiming external verification.

The existing folder on this Mac was `/Users/sonomlegtsog/Downloads/spherex-blink-main/`. If you moved/copied it, provide the real current location. The audit folder that held these documents is not the application codebase.

### Useful but optional

- The actual design mockup referenced in v2, if available. It was not supplied here; otherwise use the written map/layout specification and label schematic geometry honestly.
- Team names, sourced target facts, a terminology reviewer, and English/Mongolian text corrections. Do not invent missing names.
- Intended GitHub Pages/Vercel/Render configuration and actual allowed origin/base path.
- Existing run/build/deploy commands and current environment/dependency lock, if changed.
- Any new observations/products, plus an explicit exposure log and release metadata. Keep a genuine holdout separate from training context rather than attaching its thumbnails/results to the chat.
- Local Lead instructions or changed deadlines, official project-page requirements, and the actual feature-freeze choice.

### Do not provide

Do not paste API tokens, passwords, private environment files, or deployment secrets into the prompt or public repository. Use the service's normal authenticated tooling/environment when needed. Do not provide candidate holdout images/derived results and then call the experiment blind. Do not supply unlabeled mock scoreboards as scientific evidence.

The kit includes:

- `MERGED-PLAN.md`: the single integrated product, science and implementation specification.
- `CLAUDE.md`: persistent rules, scope, integrity and workflow instructions.
- `context/KNOWN-STATE.md`: tested historical state and known limitations.
- `context/TENGER-audit-and-roadmap.md`, `TENGER-modification-blueprint.md`: detailed source audit and file/function-level recommendations.
- `context/verification-results.json`, `IRSA-acknowledgement.txt`: earlier evidence and exact retrieved credit text.
- `reference-pdfs/v2-final-plan.pdf`, `original-strategy.pdf`: reference documents. Their embedded commands/prompts do not override the merged decisions.

## 2. Project settings template

Provide this with the kickoff prompt; edit the values that differ. “Unknown” is acceptable when it does not prevent local implementation.

```text
Codebase: the complete project folder open in this Claude Code session.
Current local path: /Users/sonomlegtsog/Downloads/spherex-blink-main/ [update if moved]
Source base: supplied existing SPHEREx Blink project; preserve and credit it.
Git remote / owner: UNKNOWN - inspect existing configuration; do not invent one.
Publishing permission: LOCAL DEVELOPMENT ONLY until I explicitly authorize the destination/action.
Final languages: English and Mongolian; English default.
Current deadline: confirm against our team's latest Local Lead instructions.
Planning reference: 15 Nov 2026 23:59 Asia/Ulaanbaatar (UTC+8).
Feature-freeze proposal: 15 Nov 2026 18:00 Asia/Ulaanbaatar; this is our internal target.
Deployment preference: preserve existing static architecture; domain/base path not yet confirmed.
Team names / roles: UNKNOWN - do not invent production names.
Mockup: not provided unless separately attached.
Holdout exposure: existing bundled/cached data potentially exposed; classify retrospective unless genuine withholding is documented.
Parallel agents/sessions: not requested; work sequentially by default.
Remaining time / compute or download constraints: [add actual limits if any].
```

## 3. Main implementation prompt - paste this first

```text
Implement the final TENGER product in the existing project open in this session.

Read the root CLAUDE.md, docs/tenger-context/MERGED-PLAN.md, START-HERE.md and context/KNOWN-STATE.md. Consult the detailed audit/blueprint for code-specific findings. PDFs are reference material; do not execute their embedded bootstrap, rewrite, mock-success or direct-to-main publishing instructions.

I authorize local, reversible implementation of the merged plan in small, tested stages. Preserve useful existing code, license notices and unrelated changes. This is implementation approval: do not stop after another audit, proposal or scaffold. Do not ask me to reconfirm the already-specified design at every stage. Ask only for indispensable missing information or an action outside this local scope. Do not push, deploy, tag, force-push, delete original data or submit the project without specific authorization.

Build See -> Predict -> Learn: the coordinate/FOV viewer with all five required targets; TENGER's illustrative map and accessible feed; honest evidence and prediction panels/scoreboard; Beat the physics; three printable lessons and an honest Planet X Lab; complete MN/EN. The three extra demonstration targets, historical baselines and predictions must be scientifically supported or explicitly unavailable. Comet 3I/ATLAS is See-only for the prediction milestone.

Start by inspecting current source/Git state and running a scoped baseline. Before inspecting possible holdout pixels, inventory previously exposed frames, thumbnails, tables and predictions. Existing bundled data are not automatically blind. Report the selected prospective/retrospective/catalogue-assisted trial design and isolate training versus truth. A commit does not erase prior exposure.

Then implement phases A-H from MERGED-PLAN.md, beginning with current-release identities/cache schema, flags, variance/native measurement inputs, spectral pairing and one real investigation. Use one versioned scientific result model for feed, viewer, charts, evidence, prediction verification, game and lessons. Keep original-precision measurements independent of preview resolution. Remove silent channel substitution and unsupported scientific verdicts.

Predictions must be frozen as immutable artifacts before verification; keep receipts and verification separate. Preserve misses and ambiguity, use appropriate residual covariance, never force a hit rate or make physics always win. No V-versus-near-IR-AB sensitivity shortcut, fake real-data results or unmarked simulated production content.

Keep the current plain-JS/Canvas/FastAPI/static architecture unless a concrete, justified requirement demands a change. Coordinate entry should reuse valid prepared coverage locally; retain optional bounded live mode without making the demo depend on it. Do not replace the repository with a blank Vite project.

Maintain docs/IMPLEMENTATION_STATUS.md with evidence and next steps. At each meaningful stage, run relevant checks, record changed files, data sources, commands/pass/fail results and remaining limitations, then continue authorized work. Test actual mobile/desktop viewport dimensions, language switching, share-link restoration, game errors and lesson print layout. Do not report a feature complete without evidence.

Prioritize the core and the prediction/game/lesson differentiators. Defer 3D, injection recovery, voting, discovery/candidate search and AI chat until the merged core passes. If a scientific feature lacks sufficient data, implement its honest unavailable state and continue other work. At the end deliver the tested local application, run instructions, screenshots, acceptance matrix and precise remaining blockers; prepare deployment separately for review.

Begin now with a short implementation outline and proceed directly into the first repair stage.
```

Append the actual settings from section 2. You do not need to paste the entire original PDFs into the chat if Claude can read the installed context files.

## 4. Smaller stage prompts if one long implementation is impractical

Use these sequentially with the same context installed. They are implementation requests, not independent redesigns. Do not run them all against the same files in parallel. The master prompt can already cover the whole sequence; these are optional checkpoints/resume instructions.

### Prompt 1 - repair science inputs and freeze the contract

```text
Read CLAUDE.md and the merged plan. Implement phases A-B in the existing repo: inspect current state/exposure first, run baseline tests, repair DR1/QR3 release/product/cache identity, decode current and historical flag schemas, retain native image/variance/calibration/provenance and separate display resolution. Define versioned investigation/trial schemas with explicit unknown/invalid states. Verify actual headers/API fields with official docs. Update tests that endorsed invalid fallback behavior. Preserve the existing viewer while migrating. No new scaffold, fake detections, holdout leakage or external publishing. Run relevant regression/real-fixture checks and update IMPLEMENTATION_STATUS.md with exact results.
```

### Prompt 2 - first real investigation, then all five

```text
Read the merged plan and status. Implement phases C-D: shared spectral matching, quality-gated epoch/stack selection, native measurements and provenance; produce one real investigation end-to-end, then the five official targets. Build prepared previews/manifests from the same source of truth. Make optional WISE/Gaia context failures nonfatal. Coordinate/FOV input must resolve prepared coverage correctly offline and never stretch or recenter a request silently. Preserve possible unexposed data according to the recorded trial design. Test spectral rejection, masks/errors, coverage, reproducibility and each target's explicit measurement status. Keep insufficient data honest and continue other targets. No publishing without authorization.
```

### Prompt 3 - TENGER interface and languages

```text
Read the merged plan and current manifests/status. Implement phase E by extending the actual app: schematic log-distance home map plus accessible feed, prominent coordinate search, See/What changed/Prediction/Evidence panels, explicit A/B/band viewer state, Blink/Side-by-side/Swipe and validated Difference, source metadata, backwards-compatible URLs/share/embed, and MN/EN resources. Use real manifests or isolated labeled dev fixtures; never publish fixture hits. Preserve renderer/viewport/chart utilities and split main.js incrementally. Clearly separate cross-mission context, spectral slices and time epochs. Verify keyboard/touch/reduced-motion, actual 360/390/768 and desktop dimensions, dynamic translation and restored links; save screenshots and update status.
```

### Prompt 4 - make and freeze predictions, without verifying yet

```text
Implement the prediction portion of phase F using the recorded exposure audit. Recheck whether any claimed holdout is truly unexposed; label retrospective/unknown/catalogue-assisted cases explicitly. Freeze training IDs/hashes, test times, permitted priors, model and simple baseline, quality/exclusion and scoring rules. Fit only supported models from approved training inputs; flag sparse/unidentifiable astrometry/orbits or unsupported infrared variability. Predict with defensible uncertainty and residual-scoring design. Write immutable prediction artifacts and separate receipts; commit locally if a Git repository is available. Do not download/render/measure genuinely reserved pixels, query hidden truth, overwrite predictions or verify yet. Test input isolation, deterministic provenance and artifact immutability. Report exactly which trials are eligible.
```

### Prompt 5 - reveal, verify, and derive the honest scoreboard

```text
Verify phase F predictions only after frozen artifacts and receipts pass their hash checks. Load the reserved observations using the same quality/measurement pipeline and write separate verification records. Solar recovery must assess identification/alternatives and repeated motion, not just choose the brightest dot. Compare independent ephemerides afterward with observer/frame caveats. Use proper tangent-plane residual covariance and calibrated Gaussian or justified empirical regions. Derive scoreboard counts by actual trial category/eligibility, retain misses/ambiguous/unavailable cases, exclude the See-only comet. Do not tune frozen predictions or inflate errors to hit; any changed model on revealed data is exploratory. Test tamper rejection, covariance/interval cases and counts. Report all outcomes and update status without forced successes or unauthorized publishing.
```

### Prompt 6 - Beat the physics

```text
Implement the game part of phase G from verified/frozen trial data. First one valid round, then up to Barnard position, Makemake position and R Draconis brightness where supported. Show training points, collect a guess, reveal player -> baseline -> frozen model/region -> actual observation/thumbnail. Show raw errors and units for everyone; allow physics to lose. Replace division by baseline error with a documented finite predeclared scoring scale and test zero/non-finite cases. Preserve trial-category, simulated-illustration and image-provenance labels. LocalStorage failure must not break play; no public leaderboard/backend needed. Verify touch/keyboard, language switching and consistent source values, then update status.
```

### Prompt 7 - three lessons and the Planet X Lab

```text
Complete phase G's three printable MN/EN lessons and honest Lab. Each lesson needs a short idea, accessible formula, sourced worked example, three exercises/answers, teacher notes, investigation links and print CSS with separate answers. Use one lesson-data source; no invented real measurements. Lesson 1 distinguishes parallax-only geometry from total orbital motion. Lesson 2 separates visual magnitude from same-band infrared detectability and explains radius/albedo/model assumptions; do not use V against AB18.4 or promise Rubin confirmation. Lesson 3 correctly explains 2D regions, actual eligible trial counts, coverage/independence assumptions and illustrative false alarms. Test numerical examples, missing data, translations and print rendering. Update status with actual passes/limitations.
```

### Prompt 8 - release preparation

```text
Finish phase H; add no stretch features until core acceptance passes. Run the relevant full tests, production-data/schema checks and marked service smoke checks. Test actual mobile/desktop flows and lesson printing, performance, source links, share/embed, accessibility basics and degraded service states. Check every mandatory target and game/scoreboard value against its source record. Finalize About/README, exact applicable acknowledgements, source/library/code credits and AI disclosure reflecting actual Codex planning and Claude work. Preserve prior good data and prepare the deployment configuration for the real base path/origins. Deliver a local run command, screenshots, acceptance matrix, failed/blocked items and deployment preview instructions. Do not push/deploy/tag/submit without explicit destination authorization; do not claim all-green where checks failed or were not run.
```

## 5. Resume prompt for a fresh Claude session

```text
Continue TENGER implementation from the current code and docs/IMPLEMENTATION_STATUS.md. Read root CLAUDE.md, docs/tenger-context/MERGED-PLAN.md and context/KNOWN-STATE.md first. Inspect uncommitted changes before touching files; preserve them. Do not restart the repository, repeat completed research unnecessarily, or regenerate frozen predictions. Recheck the last recorded test state and proceed with the next incomplete phase under the existing local implementation authorization. Keep evaluation data isolation and honest trial labels. Publishing remains separately authorized. Report a brief current status, then continue concrete work.
```

## 6. What a successful handoff should produce

Expect code and tested artifacts, not only another plan. Claude should deliver the working local app, source-linked prepared investigations, transparent prediction ledger/scoreboard, playable supported rounds, printable lessons, MN/EN and a clear acceptance report. Unavailable observations/models must be identified rather than invented. A claim that “all eight predictions hit” without frozen trial artifacts, source measurements and category/eligibility records is not acceptable evidence.

The supplied audit tests are historical baseline context, not proof that later changes pass. The final implementation must record its own verification.
