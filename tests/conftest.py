"""Network tests are skipped unless asked for: `pytest --network` or TENGER_NETWORK=1."""
import os

import pytest


def pytest_addoption(parser):
    parser.addoption("--network", action="store_true", help="run tests that call external services")


def pytest_configure(config):
    config.addinivalue_line("markers", "network: calls an external service (IRSA, CDS, CfA); skipped offline")


def pytest_collection_modifyitems(config, items):
    if config.getoption("--network") or os.environ.get("TENGER_NETWORK") == "1":
        return
    skip = pytest.mark.skip(reason="network test; run with --network or TENGER_NETWORK=1")
    for item in items:
        if "network" in item.keywords:
            item.add_marker(skip)
