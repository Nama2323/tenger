# Why the Pluto forecast missed: exploratory post-mortem (Task A5b)

**Exploratory, after the reveal.** Nothing here changes the frozen trial `pluto-position-2026b`, its
verification (miss, D² = 6.77) or the scoreboard. The alternative fits below were made after seeing
the answer. They explain the miss; they do not count. Numbers come from
`static/data/trials/pluto/postmortem.json`, which `python -m scripts.postmortem` regenerates from
the frozen trial, training, prediction and verification files.

## 1. What was predicted and what was seen

| | Value |
|---|---|
| Frozen forecast (two-body orbit fitted to 50 detections from 2 training visits, Oct 2025 and Apr–May 2026) | RA 306.096536°, Dec −23.719151° at MJD 61314.164 (2026-10-01) |
| Frozen 95% region, C_pred | 6.04″ × 2.49″, long axis at PA 78° (east of north) |
| Observed (4 exposures, array 3) | RA 306.094908°, Dec −23.719832° |
| Observed − forecast | −5.37″ east, −2.45″ north; 5.90″ in total |
| Score | D² = 6.77 > 5.991: **miss**. The baseline missed by 5.5° |

## 2. Was the measured object Pluto?

Yes. JPL Horizons was queried only after the verdict (geocentric astrometric position, moved to
SPHEREx's position with each FITS header's spacecraft vector and the Horizons distance). It differs
from our **observed** position by **0.35″** (0.22″ E, 0.27″ N). That is within the measurement and
array-level scatter, and well inside a 6″ pixel. It differs from our **frozen forecast** by **6.22″**
(5.59″ E, 2.72″ N). So the detection is right, and the forecast was off.

## 3. Shape of the miss

Pluto was moving 24.7″ per day toward PA 261° (west-southwest).

| Component | Residual | σ in the scored covariance | z |
|---|---|---|---|
| Along the track (ahead of the forecast) | **+5.69″** | 2.49″ | 2.29 |
| Across the track | +1.57″ | 1.05″ | 1.50 |

The residual points at PA 245°, 16° from the direction of motion and roughly along the long axis of
the 95% ellipse. The miss is mainly a timing error along the path, which is the direction an
extrapolated orbit is least sure about. The ellipse was oriented correctly, but too small.

## 4. Testing the possible causes

Each test refits the **same training data**, unless it says otherwise.

### (a) Was the uncertainty too small? **Yes: the main cause.**

The frozen covariance treated the 50 training exposures as independent, scaled by √(χ²/dof) = √2.0.
The exposures fall into only 6 groups (visit × array). A3 found array-to-array offsets of about 0.4″
within a visit (Pluto: up to 0.6″ between arrays observing at the same moment). An offset shared by a
whole group is not reduced by averaging its exposures. Monte Carlo (200 refits per level) with a
random offset per group:

| Group offset σ | 95% region at the evaluation time (along × across) | D² of the actual miss with this added | Result then |
|---|---|---|---|
| frozen (none) | 6.04″ × 2.49″ | 6.77 | miss |
| 0.1″ | 5.80″ × 0.77″ (added) | 3.46 | hit |
| 0.2″ | 10.6″ × 1.44″ (added) | 1.65 | hit |
| 0.4″ | 22.1″ × 3.08″ (added) | 0.45 | hit |

**Leaving one group out at a time, using the training data only** (computable before the freeze):
the forecast moves by up to 7.4″ and 8.8″. That gives a jackknife 95% region of 22.6″ × 13.0″, in
which the miss has D² = 0.70. A two-visit arc carried five months forward is very sensitive to a
few tenths of an arcsecond of shared error per group. The frozen ellipse did not include that.

### (b) Was the model wrong? **Partly, and second in size.**

| Change to the frozen model | Effect on the forecast |
|---|---|
| Heliocentric → barycentric two-body (all solar-system mass at the barycentre) | Error 5.76″ → **5.13″** (0.63″ better). The heliocentric frame ignores the Sun's own pull from Jupiter, about 2×10⁻⁷ m/s² |
| Barycentric two-body → full N-body (Sun, Jupiter, Saturn, Uranus, Neptune; astropy ephemerides) | 5.13″ → 5.14″: the planets' individual pulls do not matter over this arc |
| Light-time correction off | Moves the forecast by 0.34″ (it was on, correctly) |
| Spacecraft offset off (Earth's centre instead) | Moves the forecast by 0.92″ (it was on, correctly) |
| Pluto–Charon | Pluto sits about 2,100 km from the barycentre (0.08″ at 35 au), and Charon's light moves the photocentre by a similar amount. Both are inside the 0.35″ observed-vs-Horizons difference |

The refit of the frozen heliocentric model reproduces the frozen forecast to within 0.14″. That
difference comes from the post-mortem using Earth's centre for the evaluation observer. A barycentric
model would have scored D² = 5.41 under the frozen covariance. That is a hit only by a small margin,
and a choice made after seeing the answer, so it proves nothing on its own.

### (c) Was the measurement wrong? **No.**

The observed position agrees with Horizons to 0.35″. The scatter of the 4 identified exposures gives
C_obs σ = 0.30″ and 0.25″. Array-level systematics of about 0.4″ (all 4 exposures are in array 3)
cannot produce 5.9″. Blending is not involved: each identified exposure had exactly one source
passing the rules, and the strong neighbouring peaks are kept as alternatives.

## 5. The cause, in one sentence

The orbit was well determined for its training data (χ²/dof 2.0, residuals 0.3″). But the frozen
covariance assumed independent per-exposure errors, while the errors are shared within each of only
six visit-and-array groups. A 5-month extrapolation from two visits therefore had a true along-track
uncertainty several times larger than stated. A heliocentric (not barycentric) frame added about 0.6″.

## 6. What we would change next time

1. Estimate the forecast uncertainty from **group-level resampling** (visit × array jackknife or
   Monte Carlo with per-group offsets), not from per-exposure errors scaled by χ².
2. Fit in the **barycentric frame** with the solar-system mass (or N-body). For a 35 au body this
   matters at the 0.6″ level.
3. Require **at least three visits** before freezing an orbit forecast, or label a two-visit
   forecast "weakly constrained" with the jackknife region.
4. Report the along-track and across-track sizes of the 95% region next to the ellipse.

## 7. The April 2027 open forecast

The frozen open forecast (`pluto-position-open-2027a`, reference 2027-04-25) used the same two
visits and the same uncertainty method. It stays frozen and unchanged.

| | 95% region along × across the track |
|---|---|
| Frozen open forecast | 54.1″ × 1.06″ (PA 83°) |
| Monte Carlo, group offsets 0.1″ / 0.2″ / 0.4″ (added part only) | 14.7″ × 1.02″ / 29.3″ × 1.98″ / 64.0″ × 3.93″ |
| Exploratory barycentric N-body minus frozen | 0.24″ (D² 0.27 in the frozen region) |

Along the track the frozen region is already generous for offsets up to about 0.3″. Across the
track its 1.06″ is probably 2–4 times too small, so a cross-track miss is plausible in 2027. That is
the open forecast's honest risk.

## Files

`static/data/trials/pluto/postmortem.json` (kind `tenger.postmortem/1`, `exploratory: true`,
`counts: false`) and `scripts/postmortem.py` (deterministic Monte Carlo seed 20261114).
