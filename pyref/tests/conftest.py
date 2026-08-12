import pytest

from atlasopt import load


@pytest.fixture(scope="session")
def g():
    return load()
