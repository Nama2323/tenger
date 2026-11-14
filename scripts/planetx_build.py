"""Task A8 outputs: static/data/planetx/depth.json and hidden-planet.json (contract V12).

Reads cache/planetx/{plan,run,psftest}.json written by scripts/planetx.py. Every file written here
carries "artificial": true (it is derived from injected sources) and "counts": false.
"""
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

from backend import astrometry, injection
from backend.processing import Grid, display_native, group_visits, reproject
from scripts import planetx

CONTRACT_VERSION = 12
DISTANCES_AU = (300, 500, 700, 1000)
GAME_DISTANCE_AU = 500
GAME_FOV_DEG = 0.1
OUT = planetx.OUT
WORK = planetx.WORK

# Published numbers, each with where it was read. Filled from the papers themselves (see
# docs/planetx-depth.md); a value that could not be read in the paper is not used.
WISE_VEGA_TO_AB = {"w1": 2.699, "w2": 3.339}
WISE_AB_REFERENCE = ("WISE All-Sky Explanatory Supplement, Section IV.4.h (Cutri et al. 2012): "
                     "m_AB = m_Vega + 2.699 (W1), + 3.339 (W2)")
I_VEGA_TO_AB = {"offset": 0.45, "reference": "Blanton & Roweis 2007, AJ 133, 734, Table 1 (I, Bessell 1990 curve, "
                                          "lambda_eff 7994 A): m_AB - m_Vega = 0.45", "doi": "10.1086/510127"}
LM16 = {"reference": "Linder & Mordasini 2016, A&A 589, A134", "doi": "10.1051/0004-6361/201628350",
        "url": "https://arxiv.org/abs/1602.07465"}
F16 = {"reference": "Fortney et al. 2016, ApJL 824, L25", "doi": "10.3847/2041-8205/824/2/L25",
       "url": "https://arxiv.org/abs/1604.07424"}


def _offset(band_id: str) -> dict:
    if band_id == "i":
        return I_VEGA_TO_AB
    return {"offset": WISE_VEGA_TO_AB[band_id], "reference": WISE_AB_REFERENCE,
            "url": "https://wise2.ipac.caltech.edu/docs/release/allsky/expsup/sec4_4h.html"}


def _model(model_id, paper, band_id, vega, scenario_key, location, **extra) -> dict:
    offset = _offset(band_id)
    return {"id": model_id, **paper, "band_id": band_id, "scenario_key": scenario_key,
            "mag_published": {"value": vega, "system": extra.pop("system", "Vega")},
            "vega_to_ab": offset, "mag_ab": round(vega + offset["offset"], 3), "location": location, **extra}


LM_LOCATION = "Abstract and Sect. 4.2, p. 1-2 (arXiv:1602.07465v2); Fig. 2"
LM_RULE = "Sect. 4.2, p. 2: reflected light scales as 1/r^4, 4 mag brighter at perihelion and 2 mag dimmer at aphelion"
LM_COMMON = {"mass_earth": 10, "spectrum": "blackbody (Vega reference spectrum of Bohlin & Gilliland 2004)",
             "albedo": {"bond": 0.31, "geometric": 0.41}, "note_key": "planetx.note.lm16"}
MODELS: list[dict] = []
for _band, _vega in (("i", 21.0), ("w1", 20.1), ("w2", 20.1)):
    MODELS.append(_model(f"lm16-700au-{_band}", LM16, _band, _vega, "planetx.scenario.lm16-nominal", LM_LOCATION,
                         distance_au=700, **LM_COMMON))
    MODELS.append(_model(f"lm16-280au-{_band}", LM16, _band, round(_vega - 4.0, 1), "planetx.scenario.lm16-perihelion",
                         LM_LOCATION, distance_au=280, derived=LM_RULE, **LM_COMMON))
    MODELS.append(_model(f"lm16-1120au-{_band}", LM16, _band, round(_vega + 2.0, 1), "planetx.scenario.lm16-aphelion",
                         LM_LOCATION, distance_au=1120, derived=LM_RULE, **LM_COMMON))
F_LOCATION = "Table 2, p. 4 (arXiv:1604.07424v2): apparent magnitudes at 622 AU, cloud-free, radius of Neptune"
F_COMMON = {"distance_au": 622, "mass_earth": None, "radius": "Neptune",
            "system_note_key": "planetx.note.fortney-system", "note_key": "planetx.note.f16"}
for _teff, _ch4, _w1, _w2, _key in ((40, "1e-1", 27.6, 23.2, "planetx.scenario.f16-40k-methane-rich"),
                                     (40, "1e-6", 20.5, 22.8, "planetx.scenario.f16-40k-methane-poor"),
                                     (50, "1e-3", 19.0, 17.2, "planetx.scenario.f16-50k"),
                                     (50, "1e-6", 16.1, 17.2, "planetx.scenario.f16-50k-methane-poor")):
    for _band, _vega in (("w1", _w1), ("w2", _w2)):
        MODELS.append(_model(f"f16-{_teff}k-ch4-{_ch4}-{_band}", F16, _band, _vega, _key, F_LOCATION,
                             teff_k=_teff, methane=_ch4, system="not stated (read as Vega)", **F_COMMON))

WISE_LIMIT = {
    "band_id": "w1", "mag_vega": 16.7, "mag_ab": round(16.7 + WISE_VEGA_TO_AB["w1"], 3), "completeness": 0.9,
    "mag_vega_50": 16.86, "mag_ab_50": round(16.86 + WISE_VEGA_TO_AB["w1"], 3),
    "reference": "Meisner et al. 2018, AJ 155, 166", "doi": "10.3847/1538-3881/aaae70",
    "url": "https://arxiv.org/abs/1712.04950",
    "location": "Abstract; Sect. 6 and Sect. 8 (W1 < 16.7 (16.86) at 90% (50%) completeness)",
    "region": "high Galactic latitude (|b| > 30 deg) within the 76% of the sky searched; method valid 250-2250 AU",
    "data": "WISE and NEOWISE coadds (many epochs stacked along trial orbits)",
    "vega_to_ab": {"offset": WISE_VEGA_TO_AB["w1"], "reference": WISE_AB_REFERENCE},
    "system_note_key": "planetx.note.meisner-system", "note_key": "planetx.note.wise-limit",
}

MISSION_SENSITIVITY = {
    "statement_key": "planetx.mission-sensitivity",
    "per_channel_after_all_surveys": True,
    "full_mission": {
        "reference": "SPHEREx team, Public-products: Point_Source_Sensitivity_v28_base_cbe.txt (pre-launch current best "
                     "estimate; README: full 2-year nominal mission, per spectral channel, 5 sigma AB)",
        "url": "https://github.com/SPHEREx/Public-products",
        "sigma": 5, "survey": "all-sky",
        "values": [{"wavelength_um": 0.806, "mag_ab": 19.55}, {"wavelength_um": 3.393, "mag_ab": 19.77},
                   {"wavelength_um": 4.593, "mag_ab": 18.17}],
    },
    "single_visit_prelaunch": {
        "reference": "Crill et al. 2025, ApJS 281, 10 (SPHEREx Sky Simulator)", "url": "https://arxiv.org/abs/2505.24856",
        "location": "Abstract; Sect. VII and Figs. 16-17 (single-visit estimates, 112.5 s, per spectral channel)",
        "sigma": 5,
        "values": [{"wavelength_um": [0.75, 3.8], "mag_ab": [18.5, 19.0]},
                   {"wavelength_um": [3.8, 5.0], "mag_ab": [16.6, 18.0]}],
        "note_key": "planetx.note.single-visit",
    },
}


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# ---------------------------------------------------------------- curves


def curve(trials: list[dict], key: str = "found") -> list[dict]:
    points = []
    for mag in sorted({t["mag_ab"] for t in trials}):
        subset = [t for t in trials if t["mag_ab"] == mag]
        k, n = sum(bool(t[key]) for t in subset), len(subset)
        low, high = injection.wilson(k, n)
        points.append({"mag_ab": mag, "injected": n, "recovered": k, "fraction": round(k / n, 4),
                       "interval": [round(low, 4), round(high, 4)]})
    return points


def summary(trials: list[dict], blanks: list[dict]) -> dict:
    points = curve(trials)
    site = curve(trials, "found_site")
    false = sum(b["found"] for b in blanks)
    low, high = injection.wilson(false, len(blanks))
    spans = {"bright_fraction": points[0]["fraction"] if points else None,
             "faint_fraction": points[-1]["fraction"] if points else None}
    return {
        "curve": points,
        "depth_50_ab": injection.completeness(points, 0.5),
        "depth_90_ab": injection.completeness(points, 0.9),
        "site_threshold": {"snr_min": planetx.SITE_SNR_MIN,
                           "depth_50_ab": injection.completeness(site, 0.5),
                           "depth_90_ab": injection.completeness(site, 0.9)},
        "false_detection": {"blanks": len(blanks), "false": false,
                            "rate": round(false / len(blanks), 4) if blanks else None,
                            "interval": [round(low, 4), round(high, 4)]},
        "grid_spans_full_range": bool(points and points[0]["fraction"] >= 0.95 and points[-1]["fraction"] <= 0.05),
        **spans,
    }


# ---------------------------------------------------------------- motion


def apparent_positions(ra: float, dec: float, distance_au: float, mjds: list[float]) -> list[tuple[float, float]]:
    """Sky positions, seen from Earth, of a point fixed at distance_au from the barycentre towards (ra, dec).

    Only the observer's motion (parallax) is included; the body's own orbital motion is at most
    v_circ / d (0.7"/day at 300 au, 0.1"/day at 1000 au) and is left out. SPHEREx's 700 km offset from
    Earth's centre changes the direction by < 0.01" at 300 au and is also left out."""
    a, d = math.radians(ra), math.radians(dec)
    point = distance_au * np.array([math.cos(d) * math.cos(a), math.cos(d) * math.sin(a), math.sin(d)])
    out = []
    for mjd in mjds:
        vector = point - astrometry.observer_barycentric_au(mjd, None)
        out.append((math.degrees(math.atan2(vector[1], vector[0])) % 360,
                    math.degrees(math.asin(vector[2] / np.linalg.norm(vector)))))
    return out


def separation_arcsec(p, q) -> float:
    east, north = astrometry.tangent_offsets_arcsec(p[0], p[1], q[0], q[1])
    return math.hypot(east, north)


def orbital_rate_arcsec_per_day(distance_au: float) -> float:
    speed_km_s = 29.78 / math.sqrt(distance_au)
    return speed_km_s * 86400 / (distance_au * astrometry.KM_PER_AU) * 206264.806


def motion(field_key: str) -> dict:
    investigation = json.loads((planetx.DATA / field_key / "investigation.json").read_text())
    ra, dec = investigation["request"]["ra_deg"], investigation["request"]["dec_deg"]
    times = sorted(o["t_start_mjd"] for o in investigation["observations"] if "t_start_mjd" in o
                   and "allwise" not in o.get("collection", ""))
    visit_ids = group_visits(times)
    visits = []
    for visit in sorted(set(visit_ids)):
        mjds = [t for t, v in zip(times, visit_ids) if v == visit]
        visits.append({"first_mjd": round(mjds[0], 4), "last_mjd": round(mjds[-1], 4),
                       "span_days": round(mjds[-1] - mjds[0], 2), "exposures": len(mjds)})
    rows = []
    for distance in DISTANCES_AU:
        within, between = [], []
        for visit in visits:
            first, last = apparent_positions(ra, dec, distance, [visit["first_mjd"], visit["last_mjd"]])
            within.append(round(separation_arcsec(first, last), 1))
        for left, right in zip(visits, visits[1:]):
            mid_left = (left["first_mjd"] + left["last_mjd"]) / 2
            mid_right = (right["first_mjd"] + right["last_mjd"]) / 2
            p, q = apparent_positions(ra, dec, distance, [mid_left, mid_right])
            between.append(round(separation_arcsec(p, q), 1))
        rates = []
        for visit in visits:
            p, q = apparent_positions(ra, dec, distance, [visit["first_mjd"], visit["first_mjd"] + 1.0])
            rates.append(separation_arcsec(p, q))
        rows.append({"distance_au": distance, "within_visit_arcsec": within, "between_visits_arcsec": between,
                     "rate_arcsec_per_day": [round(min(rates), 2), round(max(rates), 2)],
                     "orbital_rate_bound_arcsec_per_day": round(orbital_rate_arcsec_per_day(distance), 2)})
    return {"field_key": field_key, "ra_deg": ra, "dec_deg": dec, "visits": visits, "by_distance": rows,
            "pixel_arcsec": 6.15, "observer": "Earth's centre (astropy builtin ephemeris); SPHEREx offset neglected"}


# ---------------------------------------------------------------- depth.json


def build_depth() -> dict:
    run = json.loads((WORK / "run.json").read_text())
    psftest = json.loads((WORK / "psftest.json").read_text())
    used = [e for e in run["exposures"] if e["status"] == "used"]
    bands = []
    for band_id, spec in planetx.BANDS.items():
        band_trials = [t for t in run["trials"] if t["band_id"] == band_id]
        band_blanks = [b for b in run["blanks"] if b["band_id"] == band_id]
        fields = []
        for key in planetx.FIELDS:
            exposures = [e for e in used if e["field_key"] == key and e["band_id"] == band_id]
            if not exposures:
                continue
            trials = [t for t in band_trials if t["field_key"] == key]
            blanks = [b for b in band_blanks if b["field_key"] == key]
            zodi = [e["zodi_mjy_sr"] for e in exposures if e.get("zodi_mjy_sr") is not None]
            fields.append({
                "field_key": key,
                "field_role": "challenge target field" if key in planetx.CHALLENGE else "training visits of a moving body",
                "n_exposures": len(exposures),
                "zodi_mjy_sr": {"median": round(float(np.median(zodi)), 5), "min": round(min(zodi), 5),
                                "max": round(max(zodi), 5)},
                "exposures": [{"obs_key": e["obs_key"], "t_mjd": e["t_mjd"], "centre_um": e["centre_um"],
                               "url": e["url"], "source_sha256": e["source_sha256"],
                               "zodi_mjy_sr": e["zodi_mjy_sr"], "psf_fwhm_arcsec": e["psf_fwhm_arcsec"],
                               "epsf_calibration": e["epsf_calibration"]} for e in exposures],
                **summary(trials, blanks),
            })
        centres = [e["centre_um"] for e in used if e["band_id"] == band_id]
        bands.append({
            "id": band_id, "detector": spec["detector"], "wavelength_um": list(spec["window_um"]),
            "centres_used_um": [round(min(centres), 4), round(max(centres), 4)],
            "published_band": spec["published_band"], "nominal_um": spec["nominal_um"],
            "magnitudes": run["grids"][band_id]["mags"],
            "optimal_m5_ab_range": run["grids"][band_id]["optimal_m5_range"],
            "optimal_note_key": "planetx.optimal-note",
            "pooled": summary(band_trials, band_blanks),
            "fields": fields,
        })
    photometry = run["photometry"]
    check = {"method": "VARIANCE-weighted ePSF + flat-sky fit at the injected position on the injected frame "
                       "(real noise and background included), at the brightest grid magnitude with optimal S/N <= 30",
             "by_band": {}}
    for band_id in planetx.BANDS:
        rows = [p for p in photometry if p["band_id"] == band_id]
        pulls = np.array([p["pull"] for p in rows])
        ratio = np.array([p["flux_out_ujy"] / p["flux_in_ujy"] for p in rows])
        check["by_band"][band_id] = {
            "injections": len(rows), "mag_in": sorted({p["mag_in"] for p in rows}),
            "median_flux_ratio_out_over_in": round(float(np.median(ratio)), 4),
            "median_pull": round(float(np.median(pulls)), 3),
            "pull_std_robust": round(float(1.4826 * np.median(np.abs(pulls - np.median(pulls)))), 3),
            "fraction_within_3_sigma": round(float(np.mean(np.abs(pulls) <= 3)), 3)}
    realism = site_fit_on_real_stars(json.loads((WORK / "psftest.json").read_text()), run)
    return {"bands": bands, "photometry_check": check, "psf_mapping_test": {k: v for k, v in psftest.items() if k != "rows"},
            "realism": realism, "settings": run["settings"]}


def site_fit_on_real_stars(psftest: dict, run: dict) -> dict:
    """The site's fit on real isolated stars vs on injections of the same (ePSF-measured) magnitude."""
    out = {"note_key": "planetx.realism-note", "bins": []}
    for band_id in planetx.BANDS:
        stars = [r for r in psftest["rows"] if r["band_id"] == band_id and r.get("mag_ab_measured")]
        for low in np.arange(13.0, 19.0, 0.5):
            high = low + 0.5
            real = [r for r in stars if low <= r["mag_ab_measured"] < high]
            fake = [t for t in run["trials"] if t["band_id"] == band_id and low <= t["mag_ab"] < high]
            if len(real) < 5 or not fake:
                continue
            k_real, k_fake = sum(r["site_found"] for r in real), sum(t["found"] for t in fake)
            out["bins"].append({"band_id": band_id, "mag_ab": [float(low), float(high)],
                                "real": {"stars": len(real), "found": k_real,
                                         "interval": [round(v, 3) for v in injection.wilson(k_real, len(real))]},
                                "injected": {"trials": len(fake), "found": k_fake,
                                             "interval": [round(v, 3) for v in injection.wilson(k_fake, len(fake))]}})
    return out


def verdicts(bands: list[dict]) -> list[dict]:
    """Gap = published model magnitude (AB) minus our pooled 50% single-exposure depth (AB)."""
    out = []
    by_id = {band["id"]: band for band in bands}
    comparisons = [m for m in MODELS if m.get("mag_ab") is not None]
    if WISE_LIMIT:
        comparisons = comparisons + [{"id": "wise-limit", "band_id": WISE_LIMIT["band_id"], "mag_ab": WISE_LIMIT["mag_ab"]}]
    for model in comparisons:
        depth = by_id[model["band_id"]]["pooled"]["depth_50_ab"]
        if depth is None:
            continue
        bright, faint = depth["interval"]
        sigma = (faint - bright) / (2 * 1.96) if bright is not None and faint is not None else None
        gap = model["mag_ab"] - depth["value"]
        found = recovered_fraction(by_id[model["band_id"]]["pooled"]["curve"], model["mag_ab"])
        share = found["value"] if found["value"] is not None else found["upper_95"]
        if gap <= 0:
            key = "planetx.verdict.within-depth"
        elif share < 0.05:
            key = "planetx.verdict.too-faint"
        else:
            key = "planetx.verdict.partial"
        out.append({"band_id": model["band_id"], "model_id": model["id"], "model_mag_ab": model["mag_ab"],
                    "depth_50_ab": depth["value"], "gap_mag": {"value": round(gap, 2),
                                                               "sigma": round(sigma, 2) if sigma else None},
                    "factor_in_flux": round(10 ** (0.4 * gap), 1), "recovered_fraction": found, "verdict_key": key})
    return out


def recovered_fraction(curve: list[dict], mag: float) -> dict:
    """Fraction of injections found at this magnitude: linear in magnitude between the two neighbouring curve
    points (the website's rule, 15 Nov). Fainter than the faintest test: no value, only that point's upper 95%."""
    points = sorted(curve, key=lambda point: point["mag_ab"])
    if mag > points[-1]["mag_ab"]:
        return {"value": None, "beyond_ab": points[-1]["mag_ab"], "upper_95": points[-1]["interval"][1]}
    if mag <= points[0]["mag_ab"]:
        return {"value": points[0]["fraction"], "interpolated": False, "at_ab": points[0]["mag_ab"]}
    for left, right in zip(points, points[1:]):
        if left["mag_ab"] <= mag <= right["mag_ab"]:
            if mag == left["mag_ab"]:
                return {"value": left["fraction"], "interpolated": False, "at_ab": left["mag_ab"]}
            share = (mag - left["mag_ab"]) / (right["mag_ab"] - left["mag_ab"])
            value = left["fraction"] + share * (right["fraction"] - left["fraction"])
            return {"value": round(value, 4), "interpolated": True, "between_ab": [left["mag_ab"], right["mag_ab"]]}
    raise ValueError("magnitude outside the curve")


def projection(bands: list[dict]) -> list[dict]:
    """sqrt(N) gain for N exposures stacked along the right track: a projection, not a measurement."""
    rows = []
    for band in bands:
        depth = band["pooled"]["depth_50_ab"]
        if depth is None:
            continue
        for n in (4, 16, 100):
            rows.append({"band_id": band["id"], "exposures_stacked": n,
                         "projected_depth_50_ab": round(depth["value"] + 1.25 * math.log10(n), 2)})
    return rows


def verdict_summary(bands: list[dict]) -> dict:
    """Numbers for the summary sentence (planetx.verdict.summary), and the sentence itself."""
    from scripts.strings_en import STRINGS

    depth = {band["id"]: (band["pooled"]["depth_50_ab"] or {}).get("value") for band in bands}
    model = {m["band_id"]: m["mag_ab"] for m in MODELS if m["id"].startswith("lm16-700au-")}
    values = {f"depth_{b}": f"{depth[b]:.1f}" for b in depth if depth[b] is not None}
    values.update({f"model_{b}": f"{model[b]:.1f}" for b in model})
    if depth.get("w1") is not None:
        values["gap_w1"] = f"{model['w1'] - depth['w1']:.1f}"
    partial = [v for v in verdicts(bands) if v["verdict_key"] == "planetx.verdict.partial"]
    if partial:
        closest = max(partial, key=lambda v: v["recovered_fraction"]["value"])
        values["one_in"] = str(round(1 / closest["recovered_fraction"]["value"]))
    template = STRINGS["planetx.verdict.summary"]
    try:
        text = template.format(**values)
    except KeyError:
        text = None
    return {"key": "planetx.verdict.summary", "values": values, "text": text}


def write_depth() -> Path:
    built = build_depth()
    bands = built["bands"]
    document = {
        "schema_version": "tenger.planetx_depth/1",
        "contract_version": CONTRACT_VERSION,
        "generated_utc": now(),
        "artificial": True,
        "counts": False,
        "title_key": "planetx.title",
        "method": {
            "single_exposure": True,
            "injection": "artificial point sources added in memory to IMAGE (MJy/sr = F_nu / pixel solid angle "
                         "x ePSF), one at a time; VARIANCE, FLAGS and ZODI unchanged",
            "psf_source": "each frame's own EPSF extension (zone nearest the source; 'x-fast then y' ordering)",
            "detection_rule": {"fit": "backend.astrometry.fit_position (pixel-integrated Gaussian, VARIANCE "
                                      "weights, 15\" radius, guided at the injected position)",
                               "snr_min": planetx.SNR_MIN, "max_offset_px": planetx.MAX_OFFSET_PX,
                               "site_snr_min": planetx.SITE_SNR_MIN, "rule_key": "planetx.rule.found"},
            "positions": {"per_exposure": planetx.N_POSITIONS, "blanks_per_exposure": planetx.N_BLANKS,
                          "exclusion": {"catalogue_radius_arcsec": planetx.CATALOGUE_RADIUS_ARCSEC,
                                        "catalogues": ["Gaia DR3", "AllWISE"],
                                        "target_radius_arcsec": planetx.TARGET_RADIUS_ARCSEC,
                                        "flagged_pixel_radius_px": planetx.CLEAN_RADIUS_PX,
                                        "flag_policy": "tenger-mask-v1"}},
            "mag_step": planetx.MAG_STEP,
            "interval_method": "wilson", "confidence": 0.95,
            "depth_interval_method": "magnitudes where the pointwise 95% Wilson band crosses the level; "
                                     "the depth itself from a monotone (isotonic) fit of the fractions",
            "seed": planetx.SEED,
            "fields_note_key": "planetx.fields-note",
        },
        "bands": bands,
        "photometry_check": built["photometry_check"],
        "site_fit_on_real_stars": built["realism"],
        "psf_mapping_test": built["psf_mapping_test"],
        "models": MODELS,
        "wise_limit": WISE_LIMIT or None,
        "mission_sensitivity": MISSION_SENSITIVITY or None,
        "motion": [motion(key) for key in planetx.CHALLENGE],
        "verdicts": verdicts(bands),
        "stacked_projection": {"projection": True, "measured": False, "note_key": "planetx.projection-note",
                               "assumptions_key": "planetx.projection-assumptions", "rows": projection(bands)},
        "verdict_key": "planetx.verdict.summary",
        "verdict_summary": verdict_summary(bands),
        "limitation_keys": ["planetx.limit.single-exposure", "planetx.limit.gaussian-detector",
                            "planetx.limit.variance-unchanged", "planetx.limit.few-exposures",
                            "planetx.limit.model-dependent"],
        "credits_keys": ["credit.irsa", "credit.spherex", "credit.gaia", "credit.allwise"],
    }
    path = OUT / "depth.json"
    planetx.write_json(path, document)
    return path


# ---------------------------------------------------------------- hidden-planet game pairs

GAME_PAIRS = (
    ("barnard", "w2", "spherex_dr1:2026W12_1A_0598_4:D6", "spherex_dr1:2026W13_1A_0129_4:D6"),
    ("barnard", "i", "spherex_qr3:2026W34_2A_0757_2:D1", "spherex_qr3:2026W36_1A_0510_1:D1"),
    ("epsindib", "i", "spherex_dr1:2025W41_2B_0301_1:D1", "spherex_dr1:2025W43_1A_0019_1:D1"),
    ("rwaur", "w1", "spherex_qr3:2026W36_1A_0476_2:D4", "spherex_qr3:2026W37_1A_0524_1:D4"),
    ("wise0855", "w2", "spherex_dr1:2025W46_1A_0090_3:D6", "spherex_dr1:2025W46_2A_0214_2:D6"),
    ("rdra", "w2", "spherex_dr1_deep:2026W12_1A_0349_3:D6", "spherex_dr1_deep:2026W13_2A_0281_2:D6"),
)  # tried in order until four pairs are built


def entry_for(field_key: str, band_id: str, obs_key: str) -> dict:
    investigation = json.loads((planetx.DATA / field_key / "investigation.json").read_text())
    o = next(o for o in investigation["observations"] if o["obs_key"] == obs_key)
    return {"field_key": field_key, "band_id": band_id, "obs_key": obs_key, "url": o["url"],
            "source_sha256": o["source_sha256"], "t_mjd": o["t_start_mjd"], "centre_um": o["response"]["centre_um"]}


def stretch(frame: np.ndarray) -> np.ndarray:
    finite = np.isfinite(frame)
    values = frame[finite]
    median = float(np.median(values))
    mad = float(np.median(np.abs(values - median))) * 1.4826 or 1.0
    scaled = (frame - median) / mad
    top = max(float(np.percentile(scaled[finite], 99.7)), 5.0)
    display = np.arcsinh(np.clip(scaled, -2, None) / 3.0) / np.arcsinh(top / 3.0)
    display = np.clip((display + 0.08) / 1.08, 0, 1)
    return np.where(finite, display * 255, 16).astype(np.uint8)


def is_clean(cutout, entry, x, y) -> bool:
    product = cutout.product
    height, width = product.image.shape
    if not (planetx.EDGE_PX <= x <= width - 1 - planetx.EDGE_PX and planetx.EDGE_PX <= y <= height - 1 - planetx.EDGE_PX):
        return False
    scale = astrometry.pixel_scale_arcsec(product, width / 2, height / 2)
    sources = planetx.catalogue_pixels(cutout, entry)
    if len(sources) and np.min(np.hypot(sources[:, 0] - x, sources[:, 1] - y)) * scale < planetx.CATALOGUE_RADIUS_ARCSEC:
        return False
    if math.hypot(x - (width - 1) / 2, y - (height - 1) / 2) * scale < planetx.TARGET_RADIUS_ARCSEC:
        return False
    bad_y, bad_x = np.nonzero(product.reject)
    return not (len(bad_x) and np.min(np.hypot(bad_x - x, bad_y - y)) < planetx.CLEAN_RADIUS_PX)


def plate_xy(grid: Grid, ra: float, dec: float) -> tuple[float, float]:
    col, row = (float(v) for v in grid.wcs.all_world2pix(ra, dec, 0))
    return round(col, 2), round(grid.n - 1 - row, 2)  # origin top-left, north up


def game_pairs(depth: dict) -> Path:
    fields = {(band["id"], f["field_key"]): f for band in depth["bands"] for f in band["fields"]}
    pooled = {band["id"]: band["pooled"] for band in depth["bands"]}
    (OUT / "hidden").mkdir(parents=True, exist_ok=True)
    pairs = []
    for old in (OUT / "hidden").glob("*.webp"):
        old.unlink()  # only files this function wrote; rebuilt below
    for attempt, (field_key, band_id, key_a, key_b) in enumerate(GAME_PAIRS, start=1):
        if len(pairs) == 4:
            break
        number = len(pairs) + 1
        entries = [entry_for(field_key, band_id, key) for key in (key_a, key_b)]
        planetx.fetch({"game": entries})
        cutouts = [planetx.load(e) for e in entries]
        if any(c is None for c in cutouts):
            continue
        reference = (fields.get((band_id, field_key)) or {}).get("depth_90_ab") or pooled[band_id]["depth_90_ab"]
        mag = round(math.floor((reference["value"] - 0.25) / planetx.MAG_STEP) * planetx.MAG_STEP, 2)
        ra_c, dec_c, _ = planetx.cutout_centre(entries[0]["url"])
        times = [e["t_mjd"] for e in entries]
        rng = np.random.default_rng([planetx.SEED, 99, attempt])
        chosen = None
        for x, y in planetx.clean_positions(cutouts[0], entries[0], rng, 40):
            ra_a, dec_a = (float(v) for v in cutouts[0].product.wcs.all_pix2world(x, y, 0))
            start, end = apparent_positions(ra_a, dec_a, GAME_DISTANCE_AU, times)
            east, north = astrometry.tangent_offsets_arcsec(start[0], start[1], end[0], end[1])
            ra_b, dec_b = astrometry.tangent_to_sky(ra_a, dec_a, east, north)
            xb, yb = (float(v) for v in cutouts[1].product.wcs.all_world2pix(ra_b, dec_b, 0))
            if is_clean(cutouts[1], entries[1], xb, yb) and \
                    math.hypot(*astrometry.tangent_offsets_arcsec(ra_c, dec_c, ra_b, dec_b)) < GAME_FOV_DEG * 3600 / 2 - 20 and \
                    math.hypot(*astrometry.tangent_offsets_arcsec(ra_c, dec_c, ra_a, dec_a)) < GAME_FOV_DEG * 3600 / 2 - 20:
                chosen = ((x, y, ra_a, dec_a), (xb, yb, ra_b, dec_b), (east, north))
                break
        if chosen is None:
            continue
        grid = Grid.for_fov(ra_c, dec_c, GAME_FOV_DEG)
        frames, injected_xy, found_xy, found_all = [], [], [], True
        for index, (cutout, entry, (x, y, ra, dec)) in enumerate(zip(cutouts, entries, chosen[:2])):
            product = injection.inject(cutout, [(x, y, mag)])
            frame, _ = reproject(display_native(product), grid)
            path = OUT / "hidden" / f"pair-{number}-{index + 1}.webp"
            Image.fromarray(np.flipud(stretch(frame))).save(path, lossless=True)
            frames.append({"path": f"planetx/hidden/{path.name}", "t_mjd": entry["t_mjd"],
                           "obs_key": entry["obs_key"], "url": entry["url"], "source_sha256": entry["source_sha256"],
                           "centre_um": entry["centre_um"], "pixel_arcsec": round(grid.scale * 3600, 4),
                           "width": grid.n, "height": grid.n, "north_up": True, "east_left": True,
                           "artificial": True, "content_type": "artificial", "synthetic": True,
                           "display": "ZODI and median removed, asinh stretch per frame; not for measurement"})
            px, py = plate_xy(grid, ra, dec)
            injected_xy.append({"frame": index, "x": px, "y": py, "ra_deg": round(ra, 6), "dec_deg": round(dec, 6)})
            result = injection.recover(product, x, y, planetx.SNR_MIN, planetx.MAX_OFFSET_PX)
            found_all = found_all and result.found
            if result.ra_deg is not None:
                fx, fy = plate_xy(grid, result.ra_deg, result.dec_deg)
                found_xy.append({"frame": index, "x": fx, "y": fy, "found": result.found,
                                 "snr": round(float(result.snr), 1) if result.snr is not None else None})
            else:
                found_xy.append({"frame": index, "x": None, "y": None, "found": False,
                                 "snr": round(float(result.snr), 1) if result.snr is not None else None})
        east, north = chosen[2]
        pairs.append({"id": f"pair-{number}", "field_key": field_key, "band_id": band_id,
                      "frames": frames, "injected": injected_xy, "injected_mag_ab": mag,
                      "mag_rule": "the field's 90% single-exposure depth in this band, rounded down to 0.25 mag less "
                                  "0.25 (brighter), so it should usually be recoverable",
                      "distance_au": GAME_DISTANCE_AU, "dt_days": round(times[1] - times[0], 3),
                      "motion_arcsec": {"east": round(east, 2), "north": round(north, 2),
                                        "total": round(math.hypot(east, north), 2)},
                      "pipeline": {"found": found_all, "positions": found_xy, "rule_key": "planetx.rule.found",
                                   "guided": True},
                      "tolerance_px": round(planetx.MAX_OFFSET_PX * 6.15 / (grid.scale * 3600), 2)})
    document = {"schema_version": "tenger.hidden_planet/1", "contract_version": CONTRACT_VERSION,
                "generated_utc": now(), "artificial": True, "counts": False,
                "label_key": "planetx.game.label", "rule_key": "planetx.game.rule",
                "derived_from": [{"path": "planetx/depth.json", "sha256": sha(OUT / "depth.json")}],
                "pairs": pairs}
    path = OUT / "hidden-planet.json"
    planetx.write_json(path, document)
    return path


def build() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    depth_path = write_depth()
    print(depth_path)
    print(game_pairs(json.loads(depth_path.read_text())))
