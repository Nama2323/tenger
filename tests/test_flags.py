import numpy as np
import pytest
from astropy.io import fits

from backend.flags import (
    MASK_POLICY,
    SCHEMA_CURRENT,
    SCHEMA_HISTORICAL,
    UnknownFlagSchema,
    count_by_flag,
    decode_header,
    reject_mask,
)


def current_header(planes):
    header = fits.Header()
    for plane, name in planes.items():
        header[f"MSKN{plane:04d}"] = name
        header[f"MSKM{plane:04d}"] = 1 << plane
        header[f"MSKD{plane:04d}"] = f"description of {name}"
    return header


def historical_header(bits):
    header = fits.Header()
    for name, bit in bits.items():
        header[f"HIERARCH MP_{name}"] = bit
    return header


def test_current_schema_keeps_each_flag_name_bit_and_reason():
    schema = decode_header(current_header({1: "OVERFLOW", 21: "SOURCE"}))
    assert schema.schema == SCHEMA_CURRENT
    assert schema.policy == MASK_POLICY
    overflow = schema.by_name()["OVERFLOW"]
    assert overflow.bit == 1 and overflow.action == "reject" and "overflow" in overflow.reason
    assert overflow.description == "description of OVERFLOW"
    assert schema.by_name()["SOURCE"].action == "keep"


def test_current_schema_rejects_hazards_and_keeps_source_marks():
    schema = decode_header(current_header({1: "OVERFLOW", 21: "SOURCE", 26: "BLOOM"}))
    flags = np.array([[0, 1 << 21, 2, (1 << 21) | (1 << 26)]], np.int32)
    assert reject_mask(flags, schema).tolist() == [[False, False, True, True]]


def test_historical_mp_schema_is_still_decoded():
    schema = decode_header(historical_header({"HOT": 10, "SOURCE": 21}))
    assert schema.schema == SCHEMA_HISTORICAL
    flags = np.array([[0, 1 << 10, 1 << 21, (1 << 21) | (1 << 10)]])
    assert reject_mask(flags, schema).tolist() == [[False, True, False, True]]


def test_header_without_any_flag_schema_is_rejected_not_treated_as_safe():
    with pytest.raises(UnknownFlagSchema):
        decode_header(fits.Header({"EXTNAME": "FLAGS"}))


def test_bitmask_that_does_not_match_its_plane_is_rejected():
    header = current_header({1: "OVERFLOW"})
    header["MSKM0001"] = 4
    with pytest.raises(UnknownFlagSchema):
        decode_header(header)


def test_conflicting_schemas_are_rejected():
    header = current_header({10: "HOT"})
    header["HIERARCH MP_HOT"] = 11
    with pytest.raises(UnknownFlagSchema):
        decode_header(header)


def test_unknown_flag_name_rejects_its_pixels_with_a_reason():
    schema = decode_header(current_header({30: "NEW_ARTIFACT"}))
    definition = schema.by_name()["NEW_ARTIFACT"]
    assert definition.action == "reject" and "not in the adopted policy" in definition.reason
    assert reject_mask(np.array([1 << 30]), schema).tolist() == [True]


def test_bit_set_without_a_definition_rejects_the_pixel():
    schema = decode_header(current_header({21: "SOURCE"}))
    flags = np.array([1 << 21, (1 << 21) | (1 << 5)])
    assert reject_mask(flags, schema).tolist() == [False, True]
    assert count_by_flag(flags, schema) == {"SOURCE": 2, "UNDEFINED_BITS": 1}
