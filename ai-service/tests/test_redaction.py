"""
Error output from libraries can contain the text they rejected. The employee's message must never reach a log line
or an error response. Each test fails a call on purpose with a recognisable secret and looks for it everywhere.
"""

import json
import uuid

from fastapi.testclient import TestClient
from pydantic import BaseModel, Field, ValidationError

from app.logging import SafeError, redact_exception
from app.main import create_app

SECRET = "MY-LAPTOP-IS-ON-FIRE-secret-9f3a"


class Draft(BaseModel):
    title: str = Field(max_length=5)
    priority: int


def everything(client_out: str, response_text: str) -> str:
    return client_out + response_text


def failing_client(raiser) -> TestClient:
    app = create_app()

    @app.get("/boom")
    def boom():
        raiser()

    return TestClient(app, raise_server_exceptions=False)


def test_an_unknown_exception_that_contains_the_message_never_appears(capsys):
    def raiser():
        raise ValueError(f"cannot parse: {SECRET}")

    with failing_client(raiser) as c:
        res = c.get("/boom")
    out = capsys.readouterr().out
    assert res.status_code == 500
    assert SECRET not in out and SECRET not in res.text
    body = res.json()["error"]
    assert body["type"] == "ValueError" and body["message"] == "unexpected error" and body["code"] == "INTERNAL"
    assert "boom" in body["detail"]  # the stack frames are kept


def test_a_pydantic_validation_error_keeps_locations_and_types_but_not_the_rejected_input(capsys):
    def raiser():
        Draft.model_validate({"title": SECRET, "priority": SECRET})

    with failing_client(raiser) as c:
        res = c.get("/boom")
    out = capsys.readouterr().out
    assert SECRET not in out and SECRET not in res.text
    detail = res.json()["error"]["detail"]
    assert "title: string_too_long" in detail and "priority: int_parsing" in detail


def test_a_wrapped_error_chain_is_redacted_at_every_level(capsys):
    def raiser():
        try:
            raise RuntimeError(f"inner {SECRET}")
        except RuntimeError as inner:
            raise KeyError(f"outer {SECRET}") from inner

    with failing_client(raiser) as c:
        res = c.get("/boom")
    assert SECRET not in capsys.readouterr().out and SECRET not in res.text
    assert "caused by:" in res.json()["error"]["detail"] and "RuntimeError" in res.json()["error"]["detail"]


def test_a_safe_error_we_wrote_keeps_its_message():
    info = redact_exception(SafeError("model returned an unknown category code"))
    assert info["message"] == "model returned an unknown category code"


def test_an_invalid_request_body_does_not_echo_the_rejected_value(capsys):
    app = create_app()

    class Body(BaseModel):
        n: int

    @app.post("/probe")
    def probe(body: Body):
        return body

    with TestClient(app, raise_server_exceptions=False) as c:
        res = c.post("/probe", json={"n": SECRET})
    assert res.status_code == 422
    assert SECRET not in res.text and SECRET not in capsys.readouterr().out
    assert res.json()["error"]["detail"] == "body.n: int_parsing"


def test_the_failure_is_logged_once_with_the_request_id_and_a_traceback(capsys):
    rid = str(uuid.uuid4())

    def raiser():
        raise ValueError(SECRET)

    with failing_client(raiser) as c:
        res = c.get("/boom", headers={"X-Request-Id": rid})
    lines = [json.loads(l) for l in capsys.readouterr().out.splitlines() if l.startswith("{")]
    errors = [l for l in lines if l["event"] == "error.unexpected"]
    assert len(errors) == 1
    assert errors[0]["requestId"] == rid and errors[0]["errorType"] == "ValueError" and "boom" in errors[0]["traceback"]
    assert res.json()["requestId"] == rid and res.headers["X-Request-Id"] == rid


def test_detail_is_trimmed():
    def deep(n):
        if n == 0:
            raise ValueError("x")
        deep(n - 1)

    try:
        deep(500)
    except ValueError as exc:
        assert len(redact_exception(exc)["detail"]) <= 4000
