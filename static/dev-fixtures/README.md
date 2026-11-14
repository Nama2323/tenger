# Development fixtures (Session B)

Every JSON file here is **example data, not an observation**. Each one carries `"example": true` and
follows `docs/DATA-CONTRACT.md` version 1, so the website can be built before Session A publishes the
real files under `static/data/`.

- The site reads these files only when the URL has `?fixtures=1`. Every page then shows the banner
  "Example data, not an observation".
- Distances, positions, covariances, scores and hashes in these files are invented or approximate.
  None of them is a measurement, a cited value or a TENGER result. Do not copy them into `static/data/`.
- `barnard/investigation.json` reuses real observation IDs of frames that are already bundled (and so
  already exposed), so the viewer's epoch matching and the Difference gate can be exercised. The checks,
  grades and values attached to them are invented.
- `game/example-actual.svg` is an artificial image; the game labels it "Artificial".
- `tests/contract.test.mjs` checks that every file here has `"example": true` and a known schema, and that
  no file under `static/data/` does.
