"""Trial definitions for Task A4 (frozen into trials/<id>/trial.json by scripts/predict.py).

Categories follow docs/DATA-CONTRACT.md V1 §2 and V5: every label that applies is listed,
and `category` is the most limiting one (illustrative > retrospective_holdout >
catalogue_assisted > prospective_unexposed). The exposure facts come from
docs/EXPOSURE.md ("Team confirmation for Task A4"), recorded before any prediction.
"""

CATEGORY_ORDER = ("illustrative", "retrospective_holdout", "catalogue_assisted", "prospective_unexposed")

# What the team has seen of each evaluation visit (docs/EXPOSURE.md, 14 Nov 2026 22:35 UB).
EVALUATION_EXPOSURE = {
    "barnard": {"status": "exposed", "why": "all current exposures opened in A3 (and bundled earlier)"},
    "wise0855": {"status": "exposed", "why": "all current exposures opened in A3 (and bundled earlier)"},
    "epsindib": {"status": "exposed", "why": "all current exposures opened in A3 (and bundled earlier)"},
    "rwaur": {"status": "exposed", "why": "all current exposures opened in A3 (and bundled earlier)"},
    "rdra": {"status": "exposed", "why": "the evaluation visit shares frames opened in A3"},
    "makemake": {"status": "exposed", "why": "a teammate inspected cutouts on 2026-06-09 and 06-12 (evaluation visit)"},
    "pluto": {"status": "unexposed", "why": "not reported viewed; Session A never opened it; other teammates not answered yet",
              "confirmation_pending": True},
}

# Holdout = newest visit. Visits are the investigation's visit numbers (A3).
TRIALS = {
    "pluto-position-2026b": {
        "target": "pluto", "quantity": "position", "kind": "orbit", "holdout_window_mjd": [61312.0, 61316.0],
        "priors": [], "ephemeris_use": "JPL Horizons (A1 inventory) centred the training cutouts and seeded "
        "the identification of training detections; it is not an input of the orbit fit or the forecast",
    },
    "makemake-position-2026a": {
        "target": "makemake", "quantity": "position", "kind": "orbit", "holdout_window_mjd": [61190.0, 61205.0],
        "priors": [], "ephemeris_use": "JPL Horizons (A1 inventory) centred the training cutouts",
    },
    "barnard-position-2026b": {
        "target": "barnard", "quantity": "position", "kind": "star", "holdout_visit": 2,
        "priors": [{"name": "Gaia DR3 parallax 546.9759 mas", "value_mas": 546.9759, "content_type": "catalogue",
                    "used_for": "fixed parallax"},
                   {"name": "Gaia DR3 proper motion -801.551, +10362.394 mas/yr", "pmra_mas_yr": -801.551,
                    "pmdec_mas_yr": 10362.394, "content_type": "catalogue",
                    "used_for": "visit-level systematic estimate (not a model input)"},
                   {"name": "Gaia DR3 position and motion", "content_type": "catalogue",
                    "used_for": "identification gate and tangent-plane reference only"}],
        "free_parallax_note": "free parallax from SPHEREx alone was 0.95 +/- 0.04 arcsec vs Gaia 0.547 (A3, z = 9): "
        "visit-level systematics of the saturated-core wing fits make it unusable, so the Gaia value is fixed",
    },
    "epsindib-position-2026b": {
        "target": "epsindib", "quantity": "position", "kind": "star", "holdout_visit": 3,
        "priors": [{"name": "SIMBAD parallax 270.658 mas (Gaia EDR3, 2020yCat.1350....0G)", "value_mas": 270.658,
                    "content_type": "catalogue", "used_for": "fixed parallax"},
                   {"name": "SIMBAD proper motion +3981.977, -2466.832 mas/yr (Gaia EDR3)", "pmra_mas_yr": 3981.977,
                    "pmdec_mas_yr": -2466.832, "content_type": "catalogue",
                    "used_for": "visit-level systematic estimate (not a model input)"},
                   {"name": "SIMBAD position and motion", "content_type": "catalogue",
                    "used_for": "identification gate and tangent-plane reference only"}],
        "free_parallax_note": "free parallax from SPHEREx alone was 0.369 +/- 0.014 arcsec vs 0.271 (A3, z = 7): "
        "visit-level systematics, so the catalogue value is fixed",
    },
    "wise0855-position-2026a": {
        "target": "wise0855", "quantity": "position", "kind": "star", "holdout_visit": 2,
        "priors": [{"name": "SIMBAD parallax 439.0 mas (Kirkpatrick et al. 2021)", "value_mas": 439.0, "content_type": "catalogue",
                    "used_for": "would fix the parallax"}],
    },
    "rwaur-brightness-2026a": {
        "target": "rwaur", "quantity": "brightness", "kind": "brightness", "holdout_visit": 2, "exploratory": True,
        "priors": [], "note": "unresolved 1.2 arcsec binary: at most an exploratory range",
    },
    "rdra-brightness-2026a": {
        "target": "rdra", "quantity": "brightness", "kind": "brightness", "holdout_visit": 6,
        "priors": [{"name": "AAVSO VSX period of R Dra", "content_type": "catalogue", "used_for": "would phase a period model"}],
    },
}

# Open forecasts: the next SPHEREx visit, not yet in the archive (cadence from the training visits).
OPEN_FORECASTS = {
    "pluto-position-open-2027a": {
        "target": "pluto", "quantity": "position", "kind": "orbit", "reference_mjd": 61520.0,  # 2027-04-25
        "window_mjd": [61490.0, 61550.0], "step_days": 5.0, "check_after_utc": "2027-05-15",
        "cadence_note": "Pluto visits so far start near 04-25 and 09-25 each year",
    },
    "makemake-position-open-2027a": {
        "target": "makemake", "quantity": "position", "kind": "orbit", "reference_mjd": 61402.0,  # 2026-12-28
        "window_mjd": [61372.0, 61432.0], "step_days": 5.0, "check_after_utc": "2027-01-20",
        "cadence_note": "Makemake visits so far start near 05-30 and 12-28 each year",
    },
}


def labels_for(target: str, priors: list, illustrative: bool = False, open_forecast: bool = False) -> tuple[list, str]:
    """All applicable category labels and the most limiting one."""
    labels = []
    if illustrative:
        labels.append("illustrative")
    exposure = "unexposed" if open_forecast else EVALUATION_EXPOSURE[target]["status"]
    if exposure != "unexposed":
        labels.append("retrospective_holdout")
    if any(prior.get("used_for", "").startswith(("fixed", "would")) for prior in priors):
        labels.append("catalogue_assisted")
    if not labels:
        labels.append("prospective_unexposed")
    category = next(item for item in CATEGORY_ORDER if item in labels)
    return labels, category
