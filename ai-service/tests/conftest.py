import pytest
from fastapi.testclient import TestClient

from app.config import get_settings

TOKEN = "test-token-123"


@pytest.fixture(autouse=True)
def env(monkeypatch):
    for name in ("GROQ_API_KEY", "AI_SERVICE_TOKEN", "APP_ENV", "DEBUG_LOG_PROMPTS", "GROQ_MODEL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("AI_SERVICE_TOKEN", TOKEN)
    monkeypatch.setenv("GROQ_API_KEY", "fake-groq-key-for-tests")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def client():
    from app.main import create_app

    with TestClient(create_app(), raise_server_exceptions=False) as c:
        yield c
