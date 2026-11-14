"""SPHEREx pixel-flag schemas and the measurement mask policy.

Two header schemas exist. Verified 14 Nov 2026 against real cutouts of already-exposed
Barnard-field exposures (DR1 `l2b-v27-2026-228` and QR3 `l2b-v27-2026-241`, software
7.0.5: MSKN/MSKM; QR2 `l2b-v20-2025-266`, software 6.4+psffix1: MP_) and the IRSA
SPHEREx documentation, which says the flag definitions travel in the FLAGS header:

* current (DR1, QR3): one triplet per mask plane n,
  ``MSKNnnnn`` = name, ``MSKMnnnn`` = bitmask (always ``1 << n``),
  ``MSKDnnnn`` = description, e.g. ``MSKN0001 = 'OVERFLOW'``, ``MSKM0001 = 2``.
* historical (QR2): ``HIERARCH MP_<NAME> = <bit number>``,
  e.g. ``MP_HOT = 10``.

A header with neither schema, a malformed definition, or two schemas that disagree
raises :class:`UnknownFlagSchema`. Nothing is ever treated as safe by default:
an unrecognised flag name, or a bit set in the data with no definition, rejects
the pixel and says why.
"""
import re
from dataclasses import dataclass

import numpy as np
from astropy.io import fits

MASK_POLICY = "tenger-mask-v1"
SCHEMA_CURRENT = "MSKN/MSKM"
SCHEMA_HISTORICAL = "MP"
KEEP = "keep"
REJECT = "reject"

# Adopted policy (TENGER, not an official SPHEREx recommendation; the IRSA
# documentation lists the flags but does not say which to mask).
# Only flags that describe a pixel without saying its value is wrong are kept.
_POLICY: dict[str, tuple[str, str]] = {
    "SOURCE": (KEEP, "marks a known source position; not a defect"),
    "FULLSAMPLE": (KEEP, "full sample history is available; not a defect"),
    "TRANSIENT": (REJECT, "transient during the ramp; the per-pixel repair cannot be checked here"),
    "OVERFLOW": (REJECT, "overflow during the ramp; value may be saturated"),
    "SUR_ERROR": (REJECT, "error in on-board processing"),
    "PHANTOM": (REJECT, "phantom (non-imaging) pixel, QR2 schema"),
    "REFERENCE": (REJECT, "reference (non-imaging) pixel, QR2 schema"),
    "NONFUNC": (REJECT, "permanently unusable pixel"),
    "DICHROIC": (REJECT, "low efficiency due to the dichroic; strict policy rejects it"),
    "MISSING_DATA": (REJECT, "on-board data lost"),
    "HOT": (REJECT, "hot pixel"),
    "COLD": (REJECT, "anomalously low signal"),
    "PHANMISS": (REJECT, "phantom correction was not applied; strict policy rejects it"),
    "NONLINEAR": (REJECT, "nonlinearity correction not reliable"),
    "PERSIST": (REJECT, "persistent charge above threshold"),
    "OUTLIER": (REJECT, "flagged as an outlier by the pipeline"),
    "CROSSTALK": (REJECT, "affected by crosstalk"),
    "GHOST": (REJECT, "ghost of a bright source in the exposure"),
    "GHOST_FPA": (REJECT, "ghost of a bright source on another detector"),
    "GHOST_EXT": (REJECT, "ghost of a bright source outside the field"),
    "STREAK": (REJECT, "affected by a streak"),
    "BLOOM": (REJECT, "part of a bloom artifact"),
    "SNOWBALL": (REJECT, "part of a snowball artifact"),
    "HALO": (REJECT, "part of a transient halo"),
}
UNKNOWN_NAME_REASON = "flag name not in the adopted policy; rejected until reviewed"
UNDEFINED_BIT_REASON = "bit set in the data but not defined in the header"

_MSKN = re.compile(r"^MSKN(\d{4})$")
_MP = re.compile(r"^MP_([A-Z0-9_]+)$")


class UnknownFlagSchema(ValueError):
    """The FLAGS header cannot be decoded with a known, consistent schema."""


@dataclass(frozen=True)
class FlagDefinition:
    bit: int
    name: str
    description: str | None
    action: str
    reason: str


@dataclass(frozen=True)
class FlagSchema:
    schema: str
    definitions: tuple[FlagDefinition, ...]
    policy: str = MASK_POLICY

    @property
    def defined_bits(self) -> int:
        return _bits(item.bit for item in self.definitions)

    @property
    def reject_bits(self) -> int:
        return _bits(item.bit for item in self.definitions if item.action == REJECT)

    def by_name(self) -> dict[str, FlagDefinition]:
        return {item.name: item for item in self.definitions}

    def to_json(self) -> dict:
        return {
            "schema": self.schema,
            "policy": self.policy,
            "definitions": [
                {"bit": d.bit, "name": d.name, "action": d.action, "reason": d.reason}
                for d in self.definitions
            ],
        }


def _bits(bits) -> int:
    value = 0
    for bit in bits:
        value |= 1 << bit
    return value


def _definition(bit: int, name: str, description: str | None) -> FlagDefinition:
    if not 0 <= bit <= 31:
        raise UnknownFlagSchema(f"flag {name!r} uses bit {bit}, outside a 32-bit mask")
    action, reason = _POLICY.get(name, (REJECT, UNKNOWN_NAME_REASON))
    return FlagDefinition(bit, name, description, action, reason)


def _current(header: fits.Header) -> list[FlagDefinition]:
    found = []
    for key in header:
        match = _MSKN.match(key)
        if not match:
            continue
        plane = int(match[1])
        name = str(header[key]).strip().upper()
        mask = header.get(f"MSKM{plane:04d}")
        if mask is None or int(mask) != 1 << plane:
            raise UnknownFlagSchema(f"MSKM{plane:04d} = {mask!r} is not 1 << {plane}")
        description = header.get(f"MSKD{plane:04d}")
        found.append(_definition(plane, name, str(description) if description is not None else None))
    return found


def _historical(header: fits.Header) -> list[FlagDefinition]:
    found = []
    for key, value in header.items():
        match = _MP.match(key)
        if not match:
            continue
        try:
            bit = int(value)
        except (TypeError, ValueError) as error:
            raise UnknownFlagSchema(f"{key} = {value!r} is not a bit number") from error
        found.append(_definition(bit, match[1], None))
    return found


def decode_header(header: fits.Header) -> FlagSchema:
    """Read the flag definitions a FLAGS header carries; fail closed."""
    current, historical = _current(header), _historical(header)
    if not current and not historical:
        raise UnknownFlagSchema("FLAGS header has neither MSKN/MSKM nor MP_ definitions")
    if current and historical:
        a = {d.name: d.bit for d in current}
        b = {d.name: d.bit for d in historical}
        clash = {name for name in a.keys() & b.keys() if a[name] != b[name]}
        if clash:
            raise UnknownFlagSchema(f"MSKN and MP_ definitions disagree for {sorted(clash)}")
    definitions = current or historical
    bits = [d.bit for d in definitions]
    if len(bits) != len(set(bits)):
        raise UnknownFlagSchema("two flag names share one bit")
    schema = SCHEMA_CURRENT if current else SCHEMA_HISTORICAL
    return FlagSchema(schema, tuple(sorted(definitions, key=lambda d: d.bit)))


def reject_mask(flags: np.ndarray, schema: FlagSchema) -> np.ndarray:
    """True where the pixel value must not enter a measurement."""
    values = flags.astype(np.int64) & 0xFFFFFFFF
    undefined = values & ~schema.defined_bits & 0xFFFFFFFF
    return ((values & schema.reject_bits) != 0) | (undefined != 0)


def count_by_flag(flags: np.ndarray, schema: FlagSchema, where: np.ndarray | None = None) -> dict[str, int]:
    """How many pixels carry each named flag (and undefined bits), optionally inside a region."""
    values = flags.astype(np.int64) & 0xFFFFFFFF
    if where is not None:
        values = values[where]
    counts = {}
    for definition in schema.definitions:
        count = int(np.count_nonzero(values & (1 << definition.bit)))
        if count:
            counts[definition.name] = count
    undefined = int(np.count_nonzero(values & ~schema.defined_bits & 0xFFFFFFFF))
    if undefined:
        counts["UNDEFINED_BITS"] = undefined
    return counts
