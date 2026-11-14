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
| `f-asteroid-batch.mp4` | 5.5 s | 0.82 MB | Predictions, the asteroid batch after Session A's check (`9cf2bfd`): "1 of 1 landed inside our 95% regions", "Of all 8 asteroids: 1 inside its 95% region; 4 ambiguous (not counted); 3 insufficient data (not counted)", "far too few to test", the second model and the straight line counted apart, the exploratory JPL line; then the cards (frozen forecast regions, the reason each was not scored, JPL after the verdict, and 345 Tercidina inside its region). Recorded 15 Nov after the verification. |

## Re-recording

```bash
node docs/screens/demo/record.mjs http://localhost:8766 docs/screens/demo
```

Needs Google Chrome, ffmpeg and Node 22+; name clips after the folder to record only those
(`... docs/screens/demo b-predictions e-hidden-planet`). Page clips use Chrome's screencast, timed by arrival,
resampled to a constant 30 fps; the 3D clip steps the page clock. If a clip would exceed 2.9 MB the encoder
raises the CRF. The first frame of each page clip is the page already loaded and scrolled into place; it counts from the start of recording (a still page sends its first frame late), which (f) needed and which leaves clips a–e unchanged until re-recorded.
