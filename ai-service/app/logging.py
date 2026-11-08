"""
JSON logs on stdout, one object per line, each carrying the request id.

This service is stateless: it writes no files. Error output from libraries (LangChain, Google's SDK, Pydantic) can contain
the text they rejected, which may be an employee's message, so nothing from an exception is logged or returned except its
type, its stack frames and a message that is known to be safe. See `redact_exception`.
"""

import contextvars
import json
import logging
import sys
import traceback
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError

request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("request_id", default=None)

DETAIL_LIMIT = 4000
_RESERVED = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {"message", "asctime", "color_message"}


class SafeError(Exception):
    """An error whose message was written by us and never contains user input; its message may be logged and returned."""


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "requestId": request_id_var.get(),
            "event": record.getMessage(),
        }
        entry.update({k: v for k, v in record.__dict__.items() if k not in _RESERVED})
        return json.dumps(entry, default=str)


class _NoRequestUrls(logging.Filter):
    """Drops HTTP client "HTTP Request: METHOD URL" lines whatever library or logger name they come from."""

    def filter(self, record: logging.LogRecord) -> bool:
        return not record.getMessage().startswith("HTTP Request:")


class _StdoutHandler(logging.StreamHandler):
    """Looks up sys.stdout on every write, so it follows redirection (and tests can capture it)."""

    def __init__(self) -> None:
        super().__init__(stream=sys.stdout)

    @property  # type: ignore[override]
    def stream(self):
        return sys.stdout

    @stream.setter
    def stream(self, _value) -> None:  # StreamHandler.__init__ assigns it
        pass


def setup_logging(level: str = "INFO") -> None:
    handler = _StdoutHandler()
    handler.setFormatter(JsonFormatter())
    handler.addFilter(_NoRequestUrls())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())
    # Uvicorn's own loggers use the same JSON handler; its access log is replaced by our http.request event.
    for name in ("uvicorn", "uvicorn.error"):
        lg = logging.getLogger(name)
        lg.handlers = []
        lg.propagate = True
    # HTTP client libraries log full request URLs at INFO. Keep them quiet so no URL (and nothing that might be in one) is printed.
    for name in ("httpx", "httpx2", "httpcore", "urllib3", "google_genai", "google.auth", "langsmith"):
        logging.getLogger(name).setLevel(logging.WARNING)
    access = logging.getLogger("uvicorn.access")
    access.handlers = []
    access.propagate = False
    access.disabled = True


def log_event(event: str, level: int = logging.INFO, **fields: Any) -> None:
    # Python's LogRecord forbids extra keys that collide with its own attributes (message, name, ...); rename them.
    safe = {(f"field_{k}" if k in _RESERVED else k): v for k, v in fields.items()}
    logging.getLogger("ai-service").log(level, event, extra=safe)


def _safe_message(exc: BaseException) -> str:
    if isinstance(exc, SafeError):
        return str(exc)
    if isinstance(exc, ValidationError):
        # Locations and error types only: no input values, no context, no URLs.
        items = exc.errors(include_input=False, include_context=False, include_url=False)
        return "; ".join(f"{'.'.join(str(p) for p in e['loc']) or '(root)'}: {e['type']}" for e in items)
    return "[redacted]"


def redact_exception(exc: BaseException) -> dict[str, str]:
    """
    {"type", "message", "detail"} for logs and error responses. `message` is the exception's message only when we know it is safe.
    `detail` is the stack frames and the chain of causes (type and safe message), trimmed to 4,000 characters. Never any
    argument or local variable, and never the text of an exception we did not write.
    """
    lines: list[str] = []
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        lines.append(f"{type(current).__name__}: {_safe_message(current)}")
        for frame in traceback.extract_tb(current.__traceback__):
            lines.append(f"  at {frame.filename.rsplit('/', 1)[-1]}:{frame.lineno} in {frame.name}")
        current = current.__cause__ or current.__context__
        if current is not None:
            lines.append("caused by:")
    return {"type": type(exc).__name__, "message": _safe_message(exc), "detail": "\n".join(lines)[:DETAIL_LIMIT]}
