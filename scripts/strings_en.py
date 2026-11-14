"""English text for every key Session A writes into static/data (DATA-CONTRACT V3.4).

Usage: python -m scripts.strings_en [--out static/data]

Placeholders in braces name an entry of the record's `params`. Session B may copy these
into static/js/i18n.js; tests/test_static_data.py checks that every key used in
static/data has a string here.
"""
import argparse
import json
from pathlib import Path

STRINGS = {
    # quantities
    "quantity.proper_motion_total_arcsec_yr": "Total proper motion (arcsec per year)",
    "quantity.proper_motion_east_arcsec_yr": "Proper motion towards east (arcsec per year)",
    "quantity.proper_motion_north_arcsec_yr": "Proper motion towards north (arcsec per year)",
    "quantity.proper_motion_total_linear_arcsec_yr": "Total proper motion, straight-line fit without parallax (arcsec per year)",
    "quantity.control_fraction_within_95pct": "Field-star check: share of comparison stars whose measured motion agrees with Gaia",
    "quantity.flux_ratio_b_over_a": "Brightness ratio, date B over date A, same wavelength",
    "quantity.parallax_arcsec": "Parallax from SPHEREx positions alone (arcsec, exploratory)",
    "quantity.position_offset_arcsec": "Position offset from the reference (arcsec)",
    # explanations
    "explain.motion-measured": "SPHEREx positions from {n_points} exposures over {days} days give a proper motion of {value} ± {sigma} arcsec per year. Gaia DR3 lists {catalogue} arcsec per year.",
    "explain.motion-insufficient": "The SPHEREx exposures here do not give enough clean positions to measure the motion.",
    "explain.motion-contaminated": "The target's light overlaps a catalogued neighbour star (G {neighbour_g_mag}, about {neighbour_arcsec} arcsec away) in {n_contaminated} pictures, so no motion is reported.",
    "explain.control": "Check: {n_stars} ordinary field stars were measured the same way and compared with Gaia. Share that agree within the 95% region: {fraction}.",
    "explain.brightness-measured": "In matching wavelengths the star was {value} times as bright on date B as on date A (± {sigma}).",
    "explain.brightness-insufficient": "No pair of dates has the same wavelength and clean pixels at the star ({n_flagged} of {n_exposures} pictures have saturated or flagged pixels on it), so no brightness change is reported.",
    "explain.not-available": "SPHEREx data for this target are not available here yet: {reason}.",
    "explain.see-only": "This target is shown for looking only. It is not part of the prediction tests.",
    "explain.training-only": "Only the training visits are opened. The newest visit stays closed until the prediction is frozen.",
    "explain.moving-object-cutouts": "Each picture is centred on where the ephemeris puts the body at that moment, so the stars move and the body stays near the centre.",
    "explain.fixed-sky-pair": "Two dates of the same patch of sky: the body moves across the background stars.",
    # limitations
    "limit.gaussian-psf-model": "Positions come from a simple bell-shaped star model, not the full SPHEREx PSF.",
    "limit.parallax-from-catalogue": "The yearly parallax wobble uses the Gaia distance (catalogue-assisted).",
    "limit.parallax-not-modelled": "The yearly parallax wobble is not modelled.",
    "limit.catalogue-assisted-identification": "The star was found using its catalogue position and motion.",
    "limit.saturated-core-wing-fit": "The star's centre is saturated; its position comes from the outer glow only.",
    "limit.control-not-passed": "The field-star check did not pass, so the uncertainty may be underestimated.",
    "limit.no-parallax-baseline": "Straight-line fit that ignores parallax: a simple comparison, not the best model.",
    "limit.few-visits-parallax": "Only a few visits: the parallax fit is sensitive to small errors that differ from visit to visit.",
    "limit.visit-systematics": "The free parallax fit disagrees with Gaia, a sign of visit-to-visit errors; uncertainties may be too small.",
    "limit.blended-binary": "This is a close pair of stars; at SPHEREx resolution both are measured together.",
    "limit.official-table-positions": "Pictures are centred on the comet positions given in the official SPHEREx exposure table.",
    "limit.see-only": "For looking only: no measurement or prediction is made for this target.",
    "limit.joint-fit-epochs": "The body is too faint for single pictures; each date's position comes from one fit to all its pictures together.",
    "limit.identification-gate": "A position counts only within 3 arcsec of the catalogue track and with no other catalogued source within 12 arcsec.",
    "limit.photometric-floor": "Brightness errors include the scatter seen between pictures taken on the same date.",
    "limit.differential-photometry": "Brightness ratios are divided by the median ratio of ordinary field stars on the same dates.",
    "limit.aperture-whole-pixels": "Brightness is summed over whole pixels inside a circle.",
    "limit.wcs-wave-approximate": "Wavelengths come from the approximate lookup table in each file (about 1 nm).",
    "limit.ephemeris-guided": "Cutouts follow the JPL Horizons ephemeris (catalogue-assisted).",
    "limit.detection-not-validated": "No detection of this body has been validated in these pictures.",
    "limit.training-visits-only": "Only training visits are shown.",
    # comparisons
    "compare.response-matched": "Same detector and the same wavelength at the star.",
    "compare.matched-pairs": "Compared only through exposures with matching wavelengths.",
    "compare.field-matched": "The wavelengths match across the whole picture.",
    "compare.response-shifted": "Same detector, but the wavelengths differ too much for a brightness comparison.",
    "compare.field-shifted": "Wavelengths match at the star but not across the whole picture, so no difference image.",
    "compare.field-no-matched-pair": "No exposure pair with matching wavelengths, so no difference image.",
    "compare.position-different-response": "Positions can be compared, but the wavelengths differ.",
    "compare.response-unknown": "The wavelength of one picture is unknown.",
    "compare.no-spectral-overlap": "The two pictures saw different wavelengths.",
    "compare.field-gradient-unknown": "How the wavelength changes across the picture is unknown.",
    "compare.psf-differs": "The star images are sharper on one date than the other (PSF differs by more than 10%), so no difference image.",
    "compare.psf-unknown": "The image sharpness (PSF) is not known for one date.",
    "compare.registration-unverified": "The sky alignment of these pictures is not confirmed by the pipeline.",
    "compare.no-exposures": "One of the dates has no usable exposure.",
    # measurement refusals
    "measure.flagged-pixels-in-aperture": "Flagged pixels (for example saturation) cover the star.",
    "measure.outside-cutout": "The star is outside this picture.",
    "measure.aperture-empty": "No pixels inside the measuring circle.",
    "measure.annulus-too-small": "Too few clean sky pixels around the star.",
    "measure.too-few-good-pixels": "Too few clean pixels around the star.",
    "measure.low-snr": "The star is too faint here for a reliable position.",
    "measure.fit-failed": "The star model did not fit.",
    "measure.fit-singular": "The star model could not be constrained.",
    "measure.fit-at-bound": "The star model hit a limit; the position is not trusted.",
    "measure.too-few-epochs": "Too few positions for a motion fit.",
    "measure.baseline-too-short": "The dates span too short a time for a motion fit.",
    "measure.not-target": "The fitted source is more than 3 arcsec from where the catalogue puts the target, so it is not counted.",
    "measure.contaminated": "Another catalogued source lies within 12 arcsec and could spoil this measurement.",
    "measure.repeatability-unknown": "Too few same-date picture pairs to check how repeatable the brightness is.",
    "measure.no-photometric-control": "Too few comparison stars with matching wavelengths on both dates to check the brightness scale.",
    "measure.null-test-failed": "A check with shuffled times also found a signal (likely a star), so this is not counted.",
    "measure.no-measured-matched-pair": "No matching-wavelength pair with clean pixels at the star.",
    # quality gate
    "quality.l2-dqa-not-pass": "The SPHEREx quality check did not pass for this exposure.",
    "quality.target-outside-cutout": "The target is outside this exposure's picture.",
    "product.unusable-quality-metadata": "The file's quality flags could not be read safely.",
    "unavailable.no-validated-product": "no validated SPHEREx product yet",
    "unavailable.no-current-product": "the exposure listed in the official table has no current (DR1) product",
    "unavailable.holdout-closed": "the newest visit is reserved for the prediction test",
    # reserved sky
    "reserved.rule": "Live loading is paused near these paths so reserved observations stay unopened.",
    "reserved.prediction-holdout": "Reserved for a prediction test.",
    "reserved.until-predictions-frozen": "Until the predictions are frozen and published.",
    "reserved.see-only": "See-only target: live loading is paused along its path.",
    # thumbnails and credits
    "thumb.spherex": "SPHEREx picture (processed)",
    "credit.irsa": "Data: NASA/IPAC Infrared Science Archive (IRSA).",
    "credit.spherex": "SPHEREx is a NASA mission led by Caltech and managed by JPL.",
    "credit.gaia": "Positions and motions of comparison stars: ESA Gaia DR3.",
    "credit.horizons": "Ephemerides: JPL Horizons.",
    "credit.comet-table": "3I/ATLAS exposure list: SPHEREx team, via IRSA.",
    "credit.base-project": "Built on the team's earlier SPHEREx Blink project.",
}


def build(out: Path) -> int:
    document = {"schema_version": "tenger.strings/1", "language": "en", "strings": dict(sorted(STRINGS.items()))}
    out.mkdir(parents=True, exist_ok=True)
    (out / "strings.en.json").write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n")
    return len(STRINGS)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="static/data")
    print(build(Path(parser.parse_args().out)))
