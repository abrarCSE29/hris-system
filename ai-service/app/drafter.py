"""
Turns a message into a request draft with a Groq-hosted model (LangChain structured output).

The model's answer is never trusted: its codes are checked against the lists the backend sent, and an invalid answer gets
one retry. Failures become a `DraftFailure` that carries a code, an HTTP status and a redacted cause. Nothing here logs or
returns the employee's message.
"""

import logging
import time
from dataclasses import dataclass
from typing import Any, Protocol

from langchain_core.exceptions import OutputParserException
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_groq import ChatGroq
from pydantic import ValidationError

from app.config import Settings
from app.logging import SafeError, log_event, redact_exception
from app.prompts import system_prompt
from app.schemas import Draft, DraftRequest, DraftResponse


class StructuredModel(Protocol):
    async def ainvoke(self, messages: list[Any]) -> Draft: ...


class DraftFailure(Exception):
    """A failed draft: what to tell the backend. `cause` is the original exception, kept only to be redacted."""

    def __init__(self, status: int, code: str, message: str, cause: BaseException | None = None) -> None:
        super().__init__(message)
        self.status, self.code, self.message, self.cause = status, code, message, cause


@dataclass
class _Invalid(Exception):
    reason: str  # always written by us, never model or user text


class _GroqModel:
    """The real model. It is built on the first call, so a missing key becomes a clean error inside the draft, not a crash."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._chain: StructuredModel | None = None

    async def ainvoke(self, messages: list[Any]) -> Draft:
        if self._chain is None:
            s = self._settings
            if not s.groq_api_key:
                raise DraftFailure(502, "MODEL_NOT_CONFIGURED", "GROQ_API_KEY is not set")
            llm = ChatGroq(
                model=s.groq_model,
                api_key=s.groq_api_key,
                temperature=0,
                timeout=s.llm_timeout_seconds,
                max_retries=0,  # no hidden retries: we count and bound our own
            )
            self._chain = llm.with_structured_output(Draft, method="function_calling")  # type: ignore[assignment]
        return await self._chain.ainvoke(messages)  # type: ignore[union-attr]


def build_model(settings: Settings) -> StructuredModel:
    """A Groq-hosted model through LangChain, answering in the shape of `Draft`."""
    return _GroqModel(settings)


def build_messages(req: DraftRequest) -> list[Any]:
    # The message travels as its own human turn, never inside the instructions.
    return [SystemMessage(content=system_prompt(req)), HumanMessage(content=req.message)]


def _check(draft: Draft, req: DraftRequest) -> None:
    if draft.category not in {c.code for c in req.categories}:
        raise _Invalid("model returned a category code that was not offered")
    if draft.department not in {d.code for d in req.departments}:
        raise _Invalid("model returned a department code that was not offered")


def _classify(exc: BaseException) -> DraftFailure:
    name = type(exc).__name__
    code = getattr(exc, "status_code", None) or getattr(exc, "code", None)  # Groq's SDK uses status_code
    if isinstance(exc, TimeoutError) or "Timeout" in name or "DeadlineExceeded" in name or code in (408, 504):
        return DraftFailure(504, "TIMEOUT", "the model did not answer in time", exc)
    if code == 429 or "ResourceExhausted" in name or "RateLimit" in name:
        return DraftFailure(429, "RATE_LIMITED", "the model API rate limit was reached", exc)
    if code in (401, 403):
        return DraftFailure(502, "MODEL_AUTH", "the model API rejected our credentials", exc)
    return DraftFailure(502, "MODEL_ERROR", "the model call failed", exc)


async def draft_request(req: DraftRequest, model: StructuredModel, settings: Settings) -> DraftResponse:
    messages = build_messages(req)
    if settings.debug_log_prompts:
        # Local debugging only: this includes the employee's message (a warning is printed at startup).
        log_event("draft.debug.prompt", logging.WARNING, system=messages[0].content, human=messages[1].content)

    started = time.perf_counter()
    last_reason = ""
    for attempt in (1, 2):
        try:
            draft = await model.ainvoke(messages)
            if settings.debug_log_prompts:
                log_event("draft.debug.reply", logging.WARNING, reply=draft.model_dump() if hasattr(draft, "model_dump") else str(draft))
            if not isinstance(draft, Draft):
                raise _Invalid("model did not return the expected structure")
            _check(draft, req)
        except _Invalid as bad:
            last_reason = bad.reason
            log_event("draft.invalid_output", logging.WARNING, attempt=attempt, reason=bad.reason)
            continue
        except (OutputParserException, ValidationError) as bad:
            # The model's reply did not fit the shape. The library's message may quote it, so only the type is kept.
            last_reason = f"model reply did not match the expected structure ({type(bad).__name__})"
            log_event("draft.invalid_output", logging.WARNING, attempt=attempt, reason=last_reason)
            continue
        except DraftFailure:
            raise
        except Exception as exc:
            failure = _classify(exc)
            log_event("draft.failed", logging.ERROR, code=failure.code, errorType=type(exc).__name__)
            raise failure from exc

        latency = round((time.perf_counter() - started) * 1000)
        return DraftResponse(
            title=draft.title.strip(),
            description=draft.description.strip(),
            category=draft.category,
            priority=draft.priority,
            department=draft.department,
            confidence=draft.confidence,
            low_confidence=draft.confidence < settings.confidence_threshold,
            reasoning=draft.reasoning.strip(),
            model=settings.groq_model,
            latency_ms=latency,
            attempts=attempt,
        )

    raise DraftFailure(502, "INVALID_OUTPUT", last_reason or "the model returned invalid output twice", SafeError(last_reason))


def failure_body(failure: DraftFailure, request_id: str | None) -> dict:
    info = redact_exception(failure.cause) if failure.cause is not None else {"type": "DraftFailure", "detail": ""}
    return {
        "error": {"code": failure.code, "message": failure.message, "type": info["type"], "detail": info["detail"]},
        "requestId": request_id,
    }
