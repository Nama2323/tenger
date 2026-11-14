# Session A hand-off (15 Nov 2026, morning; everything on `tenger-dev`, nothing pushed to `main`)
**Finished.**
- A8: Planet X depth from 40,066 injections. One exposure reaches AB 17.1 / 17.5 / 16.2 (0.8 / 3.4 / 4.6 µm). The nominal Planet Nine is 4.4–7.3 mag fainter.
- A9: 8 asteroid forecasts frozen and pushed (`61b3cb7`, 06:03 UB) before any evaluation image was opened, then verified (`9cf2bfd`).
- A10: the integrity audit passes for every trial (`docs/audit-integrity.md`). The batch format is contract V14. `docs/SUBMISSION-NUMBERS.md` holds every quotable number.

**Failed or weak.**
- Only 1 of 8 asteroids could be scored (a hit, 6.5″), so calibration is "1 of 1, 95% interval 0.025–1.0". That tests nothing.
- Cause: SPHEREx flags moving asteroids as OUTLIER pixels, and our frozen mask discarded them.
- After the verdicts (exploratory, not counted): JPL's position lay inside all 7 frozen regions. With OUTLIER pixels kept, 491 and 1021 also become hits.

**Needs your decision.**
1. Team statement: confirm that nobody viewed the 8 asteroids' images (or Pluto's evaluation visit). Until then both stay "pending".
2. `main` is at `8fea8b9`, before the asteroid freeze. To publish A9 and A10: `git fetch origin && git push origin origin/tenger-dev:main`.
3. Whether the site and video should mention the exploratory 7-of-7 result. It is labelled exploratory everywhere and is never the calibration.
