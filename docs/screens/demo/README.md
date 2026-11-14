# Demo clips for the 30-second video

Silent clips of the **public site** (no `?fixtures`, real data only), recorded on 15 Nov 2026 from a local
server with `record.mjs` in this folder. Every clip: MP4, H.264 (High), yuv420p, 1280×720, 30 fps, no audio.
During recording the page made no request to `dev-fixtures` and threw no error (`clips.json`).

| Clip | Length | Size | What it shows |
|---|---|---|---|
| `a-home-3d.mp4` | 5.7 s | 1.06 MB | Home in 3D: the Solar System scene (planet orbits from JPL elements, the Kuiper Belt, the hypothetical Planet Nine only as faint published ranges, stars on an outer shell, "Distances not to scale"), a slow turn, then the camera flies to Pluto and its investigation opens. The page clock is stepped by hand, one frame per 1/30 s, so the motion is smooth on software WebGL. |
| `b-predictions.mp4` | 6.1 s | 1.30 MB | Predictions: the scoreboard as counted in scoreboard.json, the frozen-prediction cards (Barnard's Star and ε Indi B hits, the Pluto miss), "Why we missed" opening on the Pluto card (labelled exploratory, after the reveal), then the open Pluto v2 forecasts ("check back when IRSA releases the data"). |
| `c-game-epsindib.mp4` | 6.3 s | 0.14 MB | Beat the physics, ε Indi B: the chart in offsets from the last measurement with dated groups of dots; Hint 1 (direction arrow) and Hint 2 (30-day straight-line ruler to the target date); a typed guess; lock; the reveal of the straight line, the frozen physics model with its region, and the real observation. |
| `d-planetx-lab.mp4` | 5.3 s | 1.03 MB | Planet X Lab, "Could SPHEREx see Planet X? We measured it": the "Measured by TENGER" chip, the headline with our depths ("one exposure would catch it about 1 time in 4", re-recorded after the wording fix), the 17-of-18 sentence with the interpolated 28%, then the WISE W1 band (array D4) recovery curve with its 95% band, the 50% and 90% depths, numbered published predictions and the WISE limit. |
| `e-hidden-planet.mp4` | 6.0 s | 0.16 MB | Find the hidden planet (pair 1, ε Indi B field, I band): the two real frames blink with the "Artificial planet added for this game" label, a tap near the moving dot, Check my guess: where the planet was put in both frames, "2.0 pixels × 3″ = 6.0″", the pipeline's result, and "not a detection, never counted outside this game". |

**Skipped: (f) the asteroid batch summary.** Session A had not published the real batch
(`static/data/batches/`, `index.json` `batch_paths`) when these were recorded; the only batch on the site is the
invented example behind `?fixtures=1`, which must not appear in the video. Record it with the same tool once the
real batch is on `tenger-dev` (add a clip that opens `?page=predictions` and scrolls to `#ledger-batch`).

## Re-recording

```bash
node docs/screens/demo/record.mjs http://localhost:8766 docs/screens/demo
```

Needs Google Chrome, ffmpeg and Node 22+; name clips after the folder to record only those
(`... docs/screens/demo b-predictions e-hidden-planet`). Page clips use Chrome's screencast, timed by arrival,
resampled to a constant 30 fps; the 3D clip steps the page clock. If a clip would exceed 2.9 MB the encoder
raises the CRF. The first frame of each page clip is the page already loaded and scrolled into place.
