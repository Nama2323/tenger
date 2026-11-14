import math

from backend.spectral import (
    INVALID,
    QUALITATIVE,
    QUANTITATIVE,
    Response,
    grade_field,
    grade_pair,
    match_epochs,
)

D6 = Response(6, 4.929, 0.037)


def test_same_response_is_quantitative():
    grade = grade_pair(D6, Response(6, 4.930, 0.037))
    assert grade.grade == QUANTITATIVE and grade.reason_key == "compare.response-matched"
    assert grade.shift_um <= grade.tolerance_um


def test_shifted_response_in_one_array_is_only_qualitative_for_brightness():
    grade = grade_pair(D6, Response(6, 4.950, 0.037))
    assert grade.grade == QUALITATIVE and grade.reason_key == "compare.response-shifted"


def test_no_overlap_or_another_array_is_invalid_for_brightness():
    assert grade_pair(D6, Response(6, 4.70, 0.036)).grade == INVALID
    assert grade_pair(D6, Response(5, 4.30, 0.12)).reason_key == "compare.no-spectral-overlap"


def test_unknown_response_is_invalid_never_substituted():
    assert grade_pair(D6, None).grade == INVALID
    assert grade_pair(D6, Response(6, math.nan, 0.037)).reason_key == "compare.response-unknown"


def test_positions_across_responses_are_qualitative_with_a_reason():
    grade = grade_pair(D6, Response(4, 3.0, 0.07), quantity="position")
    assert grade.grade == QUALITATIVE and grade.reason_key == "compare.position-different-response"


def test_source_match_does_not_validate_the_whole_field():
    other = Response(6, 4.929, 0.037)
    assert grade_field(D6, other, (0.0, 0.0), (0.0, 0.0), 60).grade == QUANTITATIVE
    # Same wavelength at the star, but the two filters run in different directions across the plate.
    grade = grade_field(D6, other, (0.0005, 0.0), (-0.0005, 0.0), 60)
    assert grade.grade == QUALITATIVE and grade.reason_key == "compare.field-shifted"
    assert grade_field(D6, other, None, (0.0, 0.0), 60).grade == INVALID


def test_epochs_pair_explicitly_and_use_each_exposure_once():
    first = [("a1", D6), ("a2", Response(6, 4.80, 0.036))]
    second = [("b1", Response(6, 4.9295, 0.037)), ("b2", Response(6, 4.60, 0.035))]
    result = match_epochs(first, second)
    assert result["grade"] == QUANTITATIVE
    assert [(pair["a"], pair["b"]) for pair in result["pairs"]] == [("a1", "b1")]


def test_epochs_without_any_matched_pair_are_not_quantitative():
    result = match_epochs([("a1", D6)], [("b1", Response(6, 4.95, 0.037))])
    assert result["grade"] == QUALITATIVE and result["pairs"] == []
    assert match_epochs([], [("b1", D6)])["grade"] == INVALID
