import json
import os
import uuid

from fastapi import Depends
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app
from app.security import require_token
from tests.conftest import TOKEN


def protected_client() -> TestClient:
    app = create_app()

    @app.get("/probe", dependencies=[Depends(require_token)])
    def probe():
        return {"ok": True}

    return TestClient(app, raise_server_exceptions=False)


class TestHealth:
    def test_is_public_and_reports_the_model_without_calling_the_model(self, client):
        res = client.get("/health")
        assert res.status_code == 200
        assert res.json() == {"status": "ok", "model": "qwen/qwen3.8-27b"}

    def test_model_comes_from_the_environment(self, monkeypatch):
        monkeypatch.setenv("GROQ_MODEL", "some-other-model")
        get_settings.cache_clear()
        with TestClient(create_app()) as c:
            assert c.get("/health").json()["model"] == "some-other-model"


class TestServiceToken:
    def test_missing_token_is_401(self):
        with protected_client() as c:
            res = c.get("/probe")
        assert res.status_code == 401
        assert res.json()["error"]["code"] == "UNAUTHORIZED"

    def test_wrong_token_is_401(self):
        with protected_client() as c:
            assert c.get("/probe", headers={"X-Service-Token": TOKEN + "x"}).status_code == 401
            assert c.get("/probe", headers={"X-Service-Token": TOKEN[:-1]}).status_code == 401
            assert c.get("/probe", headers={"X-Service-Token": ""}).status_code == 401

    def test_right_token_passes(self):
        with protected_client() as c:
            assert c.get("/probe", headers={"X-Service-Token": TOKEN}).json() == {"ok": True}

    def test_an_unset_token_never_lets_anyone_in(self, monkeypatch):
        monkeypatch.setenv("AI_SERVICE_TOKEN", "")
        get_settings.cache_clear()
        with protected_client() as c:
            assert c.get("/probe", headers={"X-Service-Token": ""}).status_code == 401
            assert c.get("/probe").status_code == 401

    def test_comparison_is_constant_time(self, monkeypatch):
        import app.security as security

        calls = []
        real = security.hmac.compare_digest
        monkeypatch.setattr(security.hmac, "compare_digest", lambda a, b: calls.append(1) or real(a, b))
        with protected_client() as c:
            c.get("/probe", headers={"X-Service-Token": "nope"})
        assert calls


class TestDocs:
    def test_interactive_docs_exist_in_development(self, client):
        assert client.get("/docs").status_code == 200

    def test_interactive_docs_are_off_in_production(self, monkeypatch):
        monkeypatch.setenv("APP_ENV", "production")
        get_settings.cache_clear()
        with TestClient(create_app()) as c:
            assert c.get("/docs").status_code == 404
            assert c.get("/openapi.json").status_code == 404
            assert c.get("/health").status_code == 200


class TestRequestId:
    def test_uses_the_id_the_backend_sent_and_echoes_it(self, client):
        rid = str(uuid.uuid4())
        res = client.get("/health", headers={"X-Request-Id": rid})
        assert res.headers["X-Request-Id"] == rid

    def test_makes_one_when_missing_or_malformed(self, client):
        for headers in ({}, {"X-Request-Id": "not-a-uuid"}, {"X-Request-Id": "x" * 500}):
            rid = client.get("/health", headers=headers).headers["X-Request-Id"]
            assert str(uuid.UUID(rid)) == rid

    def test_an_unknown_path_gets_the_same_error_shape(self, client):
        res = client.get("/nope")
        assert res.status_code == 404
        assert res.json()["error"]["code"] == "NOT_FOUND" and res.json()["requestId"] == res.headers["X-Request-Id"]

    def test_error_responses_carry_the_id(self):
        rid = str(uuid.uuid4())
        with protected_client() as c:
            res = c.get("/probe", headers={"X-Request-Id": rid})
        assert res.status_code == 401
        assert res.json()["requestId"] == rid
        assert res.headers["X-Request-Id"] == rid


class TestStateless:
    def test_serving_requests_writes_no_file_and_opens_no_database(self, tmp_path, monkeypatch, client):
        monkeypatch.chdir(tmp_path)
        before = set(os.listdir(tmp_path))
        client.get("/health")
        client.get("/nope")
        assert set(os.listdir(tmp_path)) == before

    def test_logging_has_no_file_handler(self, client):
        import logging

        handlers = [h for lg in [logging.getLogger(), logging.getLogger("uvicorn"), logging.getLogger("ai-service")] for h in lg.handlers]
        assert handlers and not any(isinstance(h, logging.FileHandler) for h in handlers)


def log_lines(out: str) -> list[dict]:
    return [json.loads(line) for line in out.splitlines() if line.strip().startswith("{")]


class TestLogs:
    def test_a_field_named_like_a_log_record_attribute_does_not_crash_logging(self, capsys):
        from app.logging import log_event

        log_event("probe", message="hello", name="x")
        line = log_lines(capsys.readouterr().out)[-1]
        assert line["field_message"] == "hello" and line["field_name"] == "x"

    def test_each_event_is_one_json_line_with_the_request_id(self, client, capsys):
        rid = str(uuid.uuid4())
        client.get("/health", headers={"X-Request-Id": rid})
        lines = log_lines(capsys.readouterr().out)
        req = [l for l in lines if l["event"] == "http.request"]
        assert len(req) == 1
        assert req[0]["requestId"] == rid
        assert req[0]["path"] == "/health" and req[0]["status"] == 200
        assert isinstance(req[0]["latencyMs"], int)
        assert {"time", "level", "requestId", "event"} <= req[0].keys()

    def test_the_service_token_never_appears_in_logs(self, capsys):
        with protected_client() as c:
            c.get("/probe", headers={"X-Service-Token": TOKEN})
            c.get("/probe", headers={"X-Service-Token": "wrong-token-value"})
        out = capsys.readouterr().out
        assert TOKEN not in out and "wrong-token-value" not in out and "fake-groq-key-for-tests" not in out

    def test_debug_prompt_logging_is_off_by_default_and_warns_when_on(self, monkeypatch, capsys):
        with TestClient(create_app()):
            pass
        assert not [l for l in log_lines(capsys.readouterr().out) if l["event"] == "startup.warning"]
        monkeypatch.setenv("DEBUG_LOG_PROMPTS", "true")
        get_settings.cache_clear()
        with TestClient(create_app()):
            pass
        warn = [l for l in log_lines(capsys.readouterr().out) if l["event"] == "startup.warning"]
        assert len(warn) == 1 and warn[0]["level"] == "WARNING" and "production" in warn[0]["text"]
