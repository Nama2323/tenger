# Known state before Claude implementation

This context describes the supplied snapshot audited on 14 November 2026; it is not a replacement for checking current files.

- Existing project location on the original user's Mac: `/Users/sonomlegtsog/Downloads/spherex-blink-main/`. The extracted snapshot had no local Git history at audit time. Never assume a current remote or repository owner.
- The audit and blueprint did not modify application source. They created reports, evidence and local audit scripts outside the source folder.
- Existing architecture: FastAPI backend, plain JavaScript/Canvas/SVG frontend, Python bake scripts, static prepared assets, optional Render backend and Pages deployment configuration.
- Prior audit: 54 Python tests and 39 JavaScript tests passed in an isolated Python 3.12 environment. These are historical results; rerun after changes. A passing unit suite did not validate real-target photometry/motion.
- Five required targets each had 150 bundled processed frames, primarily QR2 plus some QR3; WISE 0855 was QR2-only. Fresh DR1/QR3 searches established field coverage, not valid detections at every band.
- Current discovery code missed DR1. A downloaded real DR1 12x12 cutout had 17 pixels with named hazard flags; the old decoder rejected zero because it read only MP definitions, not MSKN/MSKM.
- Current scientific risks: implicit nearest-channel fallback; broad-wavelength differencing; VARIANCE discarded; approximate channel maps; generic flag-to-saturation inference; native analysis tied to 160-pixel display grid; different filters in viewer versus results table.
- Existing UI was English/Russian. Mongolian support is not already present.
- Some existing images/results were inspected: home previews, Barnard viewer including different modes, target metadata, bundled results table and source products. All cached assets should be treated as potentially exposed until provenance is established. Do not call them prospective blind holdouts simply because a new script hasn't read them.
- No genuine frozen forecast/verification ledger was created in the prior audit. No TENGER hit rate, independent Makemake/Pluto recovery or measured Planet Nine detection limit was established.
- Official 3I/ATLAS exposure table was retrieved with 259 rows; no demonstration pair was validated. Makemake/Pluto preliminary fixed-coordinate searches do not prove the bodies are detected.
- Aladin initialized, but a separate DR1 cube diagnostic stayed blank with a fetch failure; root cause unresolved. Some catalogue/context requests timed out or returned an error. Do not describe these as functioning end-to-end integrations.
- No full current-release rebake, Docker build, new deployment, physical-phone acceptance or hackathon submission was performed. Requested browser viewport dimensions did not always match actual dimensions.
- Licensing: supplied root code MIT notice must be preserved. A separate Aladin package license metadata/file inconsistency was noted; inspect the actual shipped version before changing distribution. No new competitor code was imported.
- Reported deadlines were checked in an earlier audit; the feature-freeze time is an internal strategy target. User's current deadline, deployment destination, team names and policies need the actual supplied values.

Use `verification-results.json` for the recorded query/status evidence, and the full audit/blueprint for details. If the current source differs, record the difference before fixing it.
