"""Data for the 3D views: static/data/scene3d.json (Task A6, DATA-CONTRACT V9).

Usage: python -m scripts.build_scene3d

Sources, each labelled in the file:
- JPL SBDB API (orbital elements) and JPL Horizons API (heliocentric vectors): catalogue.
- Our Pluto orbit: the frozen A4 state vector (static/data/trials/pluto-position-2026b): modeled, ours.
- Target stars: the catalogue entries already in each investigation file.
- Planet Nine: hypothetical; only ranges quoted from the cited abstracts, nothing invented.
- Pluto loop: SPHEREx positions (Earth + FITS header spacecraft vector), measured detections,
  the frozen forecast, the observed position and the 2027 open-forecast track.
Frames: solar-system positions are heliocentric ecliptic J2000 in au (obliquity 84381.448");
stars are ICRS directions with distances in parsecs.
"""
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import httpx
import numpy as np

from backend import orbit

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "static" / "data"
EPOCH_JD_TDB = 2461358.5  # 2026-11-14 00:00 TDB, the scene's "now"
OBLIQUITY_RAD = math.radians(84381.448 / 3600)
HORIZONS = "https://ssd.jpl.nasa.gov/api/horizons.api"
SBDB = "https://ssd-api.jpl.nasa.gov/sbdb.api"
ORBIT_SAMPLES = 180
STARS = ("barnard", "wise0855", "epsindib", "rwaur", "rdra")

PLANET_NINE = {
    "status": "hypothetical",
    "note": "No detection. Ranges quoted from the papers' abstracts; no orbit is drawn as if known.",
    "estimates": [
        {"reference": "Batygin & Brown 2016, AJ 151, 22", "doi": "10.3847/0004-6256/151/2/22",
         "mass_earth": {"min": 10, "max": None, "text": "greater than ~10 Earth masses"},
         "orbit_text": "eccentric; in about the same plane as the distant Kuiper belt objects; perihelion 180 degrees "
                       "from theirs"},
        {"reference": "Brown & Batygin 2016, ApJL 824, L23", "doi": "10.3847/2041-8205/824/2/L23",
         "mass_earth": {"min": 5, "max": 20}, "semimajor_axis_au": {"min": 380, "max": 980},
         "perihelion_au": {"min": 150, "max": 350, "text": "roughly between 150 and 350 AU"},
         "inclination_deg": {"value": 30, "text": "approximately 30 degrees to the ecliptic"},
         "brightness_v": {"min": 22, "max": 25}},
        {"reference": "Batygin, Adams, Brown & Becker 2019, Physics Reports", "doi": "10.1016/j.physrep.2019.01.009",
         "mass_earth": {"min": 5, "max": 10}, "semimajor_axis_au": {"min": 400, "max": 800},
         "eccentricity": {"min": 0.2, "max": 0.5}, "inclination_deg": {"min": 15, "max": 25}},
        {"reference": "Brown & Batygin 2021, AJ 162, 219", "doi": "10.3847/1538-3881/ac2056",
         "mass_earth": {"value": 6.2, "plus": 2.2, "minus": 1.3}, "semimajor_axis_au": {"value": 380, "plus": 140, "minus": 80},
         "inclination_deg": {"value": 16, "plus": 5, "minus": 5}, "perihelion_au": {"value": 300, "plus": 85, "minus": 60}},
        {"reference": "Brown, Holman & Batygin 2024, arXiv:2401.17977 (AJ, in press at listing)",
         "doi": "10.48550/arXiv.2401.17977",
         "constraint_text": "rules out a Planet Nine with the characteristics predicted in Brown & Batygin (2021) to a "
                            "50% completion depth of V = 21.5; with ZTF and DES, 78% of that parameter space is excluded; "
                            "most of the remainder is at V > 21",
         "excluded_fraction_of_bb2021_space": 0.78},
    ],
}


def to_ecliptic(vector) -> np.ndarray:
    x, y, z = vector
    c, s = math.cos(OBLIQUITY_RAD), math.sin(OBLIQUITY_RAD)
    return np.array([x, c * y + s * z, -s * y + c * z])


def _r(values, digits=6):
    return [round(float(v), digits) for v in values]


def sbdb_elements(designation: str) -> dict:
    response = httpx.get(SBDB, params={"sstr": designation, "full-prec": "true"}, timeout=60)
    response.raise_for_status()
    data = response.json()
    orbit_block = data["orbit"]
    elements = {item["name"]: {"value": float(item["value"]), "sigma": float(item["sigma"]) if item.get("sigma") else None,
                               "units": item.get("units")} for item in orbit_block["elements"]}
    return {"source": f"JPL SBDB API, orbit solution {orbit_block.get('orbit_id')}", "object": data["object"]["fullname"],
            "epoch_jd_tdb": float(orbit_block["epoch"]), "frame": "heliocentric ecliptic J2000",
            "producer": orbit_block.get("producer"), "solution_date": orbit_block.get("soln_date"),
            "elements": elements, "content_type": "catalogue"}


def horizons_vector(command: str) -> dict:
    params = {"format": "json", "COMMAND": f"'{command}'", "EPHEM_TYPE": "VECTORS", "CENTER": "'500@10'",
              "REF_PLANE": "ECLIPTIC", "REF_SYSTEM": "ICRF", "OUT_UNITS": "AU-D", "VEC_TABLE": "2",
              "CSV_FORMAT": "YES", "TLIST": f"'{EPOCH_JD_TDB}'", "TIME_TYPE": "TDB"}
    response = httpx.get(HORIZONS, params=params, timeout=120)
    response.raise_for_status()
    result = response.json()["result"]
    fields = [field.strip() for field in result.split("$$SOE")[1].split("$$EOE")[0].strip().split(",")]
    numbers = [float(field) for field in fields[2:8]]
    source = next((line.split("{source:")[1].strip(" }") for line in result.splitlines()
                   if line.startswith("Target body name") and "{source:" in line), None)
    return {"source": f"JPL Horizons API, COMMAND {command}, ephemeris {source}", "epoch_jd_tdb": EPOCH_JD_TDB,
            "frame": "heliocentric ecliptic J2000", "position_au": _r(numbers[:3]), "velocity_au_per_day": _r(numbers[3:], 9),
            "distance_from_sun_au": round(float(np.linalg.norm(numbers[:3])), 4), "content_type": "catalogue"}


def kepler_points(a, e, i_deg, node_deg, peri_deg, n=ORBIT_SAMPLES) -> list:
    """Points along a closed ellipse from classical elements (ecliptic J2000), for drawing."""
    i, node, peri = (math.radians(v) for v in (i_deg, node_deg, peri_deg))
    points = []
    for k in range(n):
        anomaly = 2 * math.pi * k / n  # eccentric anomaly, evenly spaced
        x = a * (math.cos(anomaly) - e)
        y = a * math.sqrt(1 - e**2) * math.sin(anomaly)
        cos_o, sin_o, cos_w, sin_w, cos_i, sin_i = (math.cos(node), math.sin(node), math.cos(peri),
                                                    math.sin(peri), math.cos(i), math.sin(i))
        X = (cos_o * cos_w - sin_o * sin_w * cos_i) * x + (-cos_o * sin_w - sin_o * cos_w * cos_i) * y
        Y = (sin_o * cos_w + cos_o * sin_w * cos_i) * x + (-sin_o * sin_w + cos_o * cos_w * cos_i) * y
        Z = (sin_w * sin_i) * x + (cos_w * sin_i) * y
        points.append([round(X, 4), round(Y, 4), round(Z, 4)])
    return points


def elements_from_state(r, v, mu=orbit.GM_SUN) -> dict:
    """Classical elements from a heliocentric ecliptic state (au, au/day)."""
    r, v = np.asarray(r, float), np.asarray(v, float)
    h = np.cross(r, v)
    node_vector = np.cross([0.0, 0.0, 1.0], h)
    e_vector = ((v @ v - mu / np.linalg.norm(r)) * r - (r @ v) * v) / mu
    e = float(np.linalg.norm(e_vector))
    a = 1.0 / (2.0 / np.linalg.norm(r) - (v @ v) / mu)
    i = math.degrees(math.acos(h[2] / np.linalg.norm(h)))
    node = math.degrees(math.atan2(node_vector[1], node_vector[0])) % 360
    peri = math.degrees(math.acos(np.clip(node_vector @ e_vector / (np.linalg.norm(node_vector) * e), -1, 1)))
    if e_vector[2] < 0:
        peri = 360 - peri
    true_anomaly = math.degrees(math.acos(np.clip(e_vector @ r / (e * np.linalg.norm(r)), -1, 1)))
    if r @ v < 0:
        true_anomaly = 360 - true_anomaly
    nu = math.radians(true_anomaly)
    eccentric = 2 * math.atan(math.sqrt((1 - e) / (1 + e)) * math.tan(nu / 2))
    mean = math.degrees(eccentric - e * math.sin(eccentric)) % 360
    return {"a": round(a, 4), "e": round(e, 5), "i": round(i, 4), "om": round(node, 4), "w": round(peri, 4),
            "ma": round(mean, 4), "q": round(a * (1 - e), 4), "units": "au, deg"}


def our_pluto_orbit() -> dict:
    prediction = json.loads((DATA / "trials" / "pluto-position-2026b" / "prediction.json").read_text())
    state = prediction["model_state"]
    t0 = state["t0_mjd_utc"]
    vector = np.array(state["state_au_au_per_day"])
    r, v = to_ecliptic(vector[:3]), to_ecliptic(vector[3:])
    elements = elements_from_state(r, v)
    now = orbit.propagate(vector, t0, np.array([EPOCH_JD_TDB - 2400000.5]))[0]
    return {"source": "Vestigium A4 frozen fit: heliocentric two-body, 50 SPHEREx detections, 2 visits "
                      "(trials/pluto-position-2026b/prediction.json)",
            "content_type": "modeled", "ours": True, "epoch_mjd_utc": t0, "frame": "heliocentric ecliptic J2000",
            "state_position_au": _r(r), "state_velocity_au_per_day": _r(v, 9), "elements": elements,
            "position_now_au": _r(to_ecliptic(now)),
            "orbit_points_au": kepler_points(elements["a"], elements["e"], elements["i"], elements["om"], elements["w"]),
            "limitations": ["two visits only (weakly constrained, see docs/postmortem-pluto.md)",
                            "heliocentric two-body (Sun only)"]}


def stars() -> list:
    out = []
    for key in STARS:
        doc = json.loads((DATA / key / "investigation.json").read_text())
        catalogue = doc["target_catalogue"]
        parallax = catalogue.get("parallax_mas")
        ra, dec = math.radians(catalogue["ra_deg"]), math.radians(catalogue["dec_deg"])
        direction = [math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec)]
        entry = {"key": key, "ra_deg": catalogue["ra_deg"], "dec_deg": catalogue["dec_deg"],
                 "epoch_jyear": catalogue["epoch_jyear"], "direction_icrs": _r(direction),
                 "parallax_mas": parallax, "distance_pc": round(1000 / parallax, 4) if parallax else None,
                 "source": catalogue["source"], "content_type": "catalogue",
                 "evidence": f"{key}/investigation.json"}
        if key == "rwaur":
            entry["caution"] = ("Gaia DR3 parallax of an unresolved 1.2 arcsec binary (A+B); the astrometric solution is "
                                "poor (RUWE about 16 in the Gaia field query of A3), so the distance is uncertain")
        out.append(entry)
    return out


def pluto_loop() -> dict:
    trial = DATA / "trials" / "pluto-position-2026b"
    training = json.loads((trial / "training.json").read_text())
    prediction = json.loads((trial / "prediction.json").read_text())
    verification = json.loads((trial / "verification.json").read_text())
    open_forecast = json.loads((DATA / "trials" / "pluto-position-open-2027a" / "prediction.json").read_text())
    state = np.array(prediction["model_state"]["state_au_au_per_day"])
    t0 = prediction["model_state"]["t0_mjd_utc"]

    def fitted(t, observer):
        emitted = t
        for _ in range(3):
            body = orbit.propagate(state, t0, np.array([emitted]))[0]
            emitted = t - np.linalg.norm(body - observer) / orbit.C_AU_PER_DAY
        return orbit.propagate(state, t0, np.array([emitted]))[0]

    def row(t, spacecraft, measured=None, obs_key=None, role="training"):
        observer = orbit.observer_heliocentric_au(t, spacecraft)
        body = fitted(t, observer)
        out = {"role": role, "obs_key": obs_key, "t_mjd": round(t, 6),
               "spherex_au": _r(to_ecliptic(observer)),
               "spherex_source": "Earth (astropy) + FITS header spacecraft vector" if spacecraft else "Earth centre (spacecraft unknown)",
               "fitted_pluto_au": _r(to_ecliptic(body))}
        if measured:
            out["measured"] = {"ra_deg": measured[0], "dec_deg": measured[1], "content_type": "measured"}
        return out

    rows = [row(p["t_mjd"], p.get("spacecraft_km"), (p["ra_deg"], p["dec_deg"]), p["obs_keys"][0]) for p in training["points"]]
    evaluation_rows = []
    cache = ROOT / "cache" / "bodies" / "pluto-eval"
    identified = {c["obs_key"]: next((x for x in c["candidates"] if x["passes"]), None)
                  for c in verification.get("candidates", [])}
    times = {c["obs_key"]: c["t_mjd"] for c in verification.get("candidates", [])}
    for key in sorted(times, key=lambda k: (times[k], k)):
        spacecraft = None
        meta_path = cache / f"{key.replace(':', '__')}.json"
        if meta_path.exists():
            from backend.processing import load_product

            meta = json.loads(meta_path.read_text())
            info = load_product((ROOT / "cache" / meta["native"]).read_bytes()).info
            spacecraft = [info.get(axis) for axis in ("X_SC", "Y_SC", "Z_SC")]
            spacecraft = None if None in spacecraft else spacecraft
        found = identified.get(key)
        evaluation_rows.append(row(times[key], spacecraft, (found["ra_deg"], found["dec_deg"]) if found else None, key,
                                   "evaluation"))
    t_eval = verification["residuals"]["model"]["reference"]["t_mjd"]
    eval_observer = orbit.observer_heliocentric_au(t_eval, None)
    track = []
    for point in open_forecast.get("track") or []:
        observer = orbit.observer_heliocentric_au(point["t_mjd"], None)
        track.append({"t_mjd": point["t_mjd"], "ra_deg": point["ra_deg"], "dec_deg": point["dec_deg"],
                      "cov_arcsec2": point["cov_arcsec2"], "earth_au": _r(to_ecliptic(observer)),
                      "fitted_pluto_au": _r(to_ecliptic(fitted(point["t_mjd"], observer))), "content_type": "modeled"})
    return {
        "frame": "heliocentric ecliptic J2000, au",
        "note": "fitted_pluto_au is the frozen A4 orbit at the light-emission time; spherex_au is where the "
                "telescope was. The apparent loop on the sky comes from the telescope's own motion around the Sun.",
        "training": rows,
        "evaluation": evaluation_rows,
        "frozen_forecast": {"t_mjd": prediction["t_mjd"], "ra_deg": prediction["model"]["ra_deg"],
                            "dec_deg": prediction["model"]["dec_deg"], "cov_arcsec2": prediction["model"]["cov_arcsec2"],
                            "fitted_pluto_au": _r(to_ecliptic(fitted(prediction["t_mjd"], orbit.observer_heliocentric_au(prediction["t_mjd"], None)))),
                            "content_type": "modeled", "trial_id": "pluto-position-2026b"},
        "observed": {"t_mjd": t_eval, "ra_deg": verification["observed"]["ra_deg"],
                     "dec_deg": verification["observed"]["dec_deg"], "cov_arcsec2": verification["observed"]["cov_arcsec2"],
                     "earth_au": _r(to_ecliptic(eval_observer)), "content_type": "measured",
                     "verdict": verification["status"], "d2": verification["residuals"]["model"]["d2"]},
        "open_forecast_2027": {"trial_id": "pluto-position-open-2027a", "reference_t_mjd": open_forecast["t_mjd"],
                               "track": track, "label": "open forecast: to be checked when IRSA releases the data"},
    }


def build() -> dict:
    pluto_sbdb, makemake_sbdb = sbdb_elements("134340"), sbdb_elements("136472")
    bodies = {}
    for key, sbdb, command in (("pluto", pluto_sbdb, "999"), ("makemake", makemake_sbdb, "136472;")):
        el = sbdb["elements"]
        bodies[key] = {"catalogue_orbit": {**sbdb, "orbit_points_au": kepler_points(el["a"]["value"], el["e"]["value"],
                                                                                    el["i"]["value"], el["om"]["value"],
                                                                                    el["w"]["value"])},
                       "position_now": horizons_vector(command)}
    bodies["pluto"]["our_orbit"] = our_pluto_orbit()
    bodies["earth"] = {"position_now": horizons_vector("399")}
    return {
        "schema_version": "tenger.scene3d/1",
        "contract_version": 9,
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "epoch_jd_tdb": EPOCH_JD_TDB,
        "frames": {"solar_system": "heliocentric ecliptic J2000 (obliquity 84381.448 arcsec), au",
                   "stars": "ICRS unit direction, distance in pc"},
        "bodies": bodies,
        "stars": stars(),
        "planet_nine": PLANET_NINE,
        "pluto_loop": pluto_loop(),
        "credits_keys": ["credit.horizons", "credit.sbdb", "credit.gaia", "credit.irsa", "credit.spherex"],
    }


if __name__ == "__main__":
    document = build()
    (DATA / "scene3d.json").write_text(json.dumps(document, indent=1, ensure_ascii=False) + "\n")
    print({"bytes": (DATA / "scene3d.json").stat().st_size,
           "training": len(document["pluto_loop"]["training"]), "evaluation": len(document["pluto_loop"]["evaluation"]),
           "track": len(document["pluto_loop"]["open_forecast_2027"]["track"])})
