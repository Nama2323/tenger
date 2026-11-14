"""Spectral-response compatibility for comparisons across time.

SPHEREx uses linear variable filters: the wavelength an exposure records changes
across the detector, so two exposures of one star in the same array usually did
not see the same wavelength. A brightness comparison between them is only
quantitative when their responses at the source actually match. There is no
nearest-channel substitution here: every comparison gets a grade
(``quantitative``, ``qualitative`` or ``invalid``) and a reason key.

Source-specific and field-wide matching are graded separately. A match at the
star's position does not make a whole-field difference image valid, because the
wavelength gradients of the two exposures differ.

The tolerance below is adopted for TENGER and documented as such; it is not an
official SPHEREx criterion and not a validation of any particular comparison.
"""
import math
from dataclasses import dataclass

QUANTITATIVE = "quantitative"
QUALITATIVE = "qualitative"
INVALID = "invalid"
# Centres closer than this fraction of the narrower bandwidth count as one response.
MATCH_FRACTION_OF_BANDWIDTH = 0.1
# WCS-WAVE is a bilinear lookup table; IRSA quotes about 1 nm accuracy for it.
WCS_WAVE_ACCURACY_UM = 0.001
QUANTITIES = ("flux", "position")


@dataclass(frozen=True)
class Response:
    """Central wavelength and bandwidth (um) one exposure recorded at one sky position."""

    detector: int
    centre_um: float
    width_um: float
    source: str = "WCS-WAVE"

    def is_known(self) -> bool:
        return (
            math.isfinite(self.centre_um)
            and math.isfinite(self.width_um)
            and self.centre_um > 0
            and self.width_um > 0
        )

    def to_json(self) -> dict:
        return {"centre_um": self.centre_um, "width_um": self.width_um, "source": self.source}


@dataclass(frozen=True)
class Grade:
    grade: str
    reason_key: str
    shift_um: float | None = None
    tolerance_um: float | None = None

    def to_json(self) -> dict:
        return {
            "grade": self.grade,
            "reason_key": self.reason_key,
            "shift_um": self.shift_um,
            "tolerance_um": self.tolerance_um,
        }


def tolerance_um(a: Response, b: Response) -> float:
    return max(MATCH_FRACTION_OF_BANDWIDTH * min(a.width_um, b.width_um), WCS_WAVE_ACCURACY_UM)


def overlap(a: Response, b: Response) -> float:
    """Shared fraction of two top-hat passbands, relative to the wider one."""
    low = max(a.centre_um - a.width_um / 2, b.centre_um - b.width_um / 2)
    high = min(a.centre_um + a.width_um / 2, b.centre_um + b.width_um / 2)
    return max(0.0, high - low) / max(a.width_um, b.width_um)


def grade_pair(a: Response | None, b: Response | None, quantity: str = "flux") -> Grade:
    """Grade one source-specific comparison between two exposures."""
    if quantity not in QUANTITIES:
        raise ValueError(f"unknown quantity {quantity!r}")
    if a is None or b is None or not a.is_known() or not b.is_known():
        return Grade(INVALID, "compare.response-unknown")
    shift = abs(a.centre_um - b.centre_um)
    tolerance = tolerance_um(a, b)
    if a.detector == b.detector and shift <= tolerance:
        return Grade(QUANTITATIVE, "compare.response-matched", shift, tolerance)
    if quantity == "position":
        # Positions can be compared across wavelengths, but chromatic PSF and
        # centroid effects are not modelled, so the result is not quantitative here.
        return Grade(QUALITATIVE, "compare.position-different-response", shift, tolerance)
    if a.detector == b.detector and overlap(a, b) > 0:
        return Grade(QUALITATIVE, "compare.response-shifted", shift, tolerance)
    return Grade(INVALID, "compare.no-spectral-overlap", shift, tolerance)


def grade_field(
    a: Response | None,
    b: Response | None,
    gradient_a: tuple[float, float] | None,
    gradient_b: tuple[float, float] | None,
    half_size_px: float,
) -> Grade:
    """Grade a whole-field comparison (e.g. a difference image) on a square plate.

    Wavelength is linear across a small plate: centre + gx * dx + gy * dy (um per
    plate pixel). The field passes only if the two responses match at every corner.
    """
    source = grade_pair(a, b, "flux")
    if source.grade == INVALID:
        return source
    if gradient_a is None or gradient_b is None:
        return Grade(INVALID, "compare.field-gradient-unknown")
    dgx = gradient_a[0] - gradient_b[0]
    dgy = gradient_a[1] - gradient_b[1]
    base = a.centre_um - b.centre_um
    worst = max(
        abs(base + dgx * sx * half_size_px + dgy * sy * half_size_px)
        for sx in (-1, 1)
        for sy in (-1, 1)
    )
    tolerance = tolerance_um(a, b)
    if a.detector == b.detector and worst <= tolerance:
        return Grade(QUANTITATIVE, "compare.field-matched", worst, tolerance)
    return Grade(QUALITATIVE, "compare.field-shifted", worst, tolerance)


def match_epochs(
    first: list[tuple[str, Response | None]],
    second: list[tuple[str, Response | None]],
    quantity: str = "flux",
) -> dict:
    """Pair exposures of two epochs explicitly, never by nearest channel.

    Each input is a list of (obs_key, response). The comparison is quantitative
    only through the listed matched pairs; each exposure is used at most once.
    """
    pairs = []
    used = set()
    best = None
    for key_a, response_a in first:
        candidates = []
        for key_b, response_b in second:
            if key_b in used:
                continue
            grade = grade_pair(response_a, response_b, quantity)
            if grade.grade == QUANTITATIVE:
                candidates.append((grade.shift_um, key_b, grade))
            elif best is None or _rank(grade) > _rank(best):
                best = grade
        if candidates:
            shift, key_b, grade = min(candidates)
            used.add(key_b)
            pairs.append({"a": key_a, "b": key_b, **grade.to_json()})
    if pairs:
        return {"grade": QUANTITATIVE, "reason_key": "compare.matched-pairs", "pairs": pairs}
    if best is None:
        return {"grade": INVALID, "reason_key": "compare.no-exposures", "pairs": []}
    return {"grade": best.grade, "reason_key": best.reason_key, "pairs": []}


def _rank(grade: Grade) -> int:
    return {INVALID: 0, QUALITATIVE: 1, QUANTITATIVE: 2}[grade.grade]
