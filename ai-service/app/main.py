import logging
import time
import uuid
import warnings
from contextlib import asynccontextmanager

# Google's SDK prints SyntaxWarnings for some docstrings when it is first imported. They are noise, not problems.
warnings.filterwarnings("ignore", category=SyntaxWarning)

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.exceptions import RequestValidationError  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from starlette.exceptions import HTTPException  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.logging import log_event, redact_exception, request_id_var, setup_logging  # noqa: E402


def _error_body(code: str, message: str, kind: str, detail: str) -> dict:
    return {"error": {"code": code, "message": message, "type": kind, "detail": detail}, "requestId": request_id_var.get()}


def create_app() -> FastAPI:
    settings = get_settings()
    setup_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if settings.debug_log_prompts:
            log_event(
                "startup.warning",
                logging.WARNING,
                text="DEBUG_LOG_PROMPTS is on: prompts and raw model replies, which include employees' messages, will be "
                "logged. Never use this in production.",
            )
        log_event("startup", model=settings.gemini_model, production=settings.is_production)
        yield

    app = FastAPI(
        title="HRIS AI service",
        version="0.1.0",
        lifespan=lifespan,
        # The service is private; its interactive docs are for local use only.
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        """The backend sends X-Request-Id; use it on every log line and echo it back. Make one if it is missing or malformed."""
        incoming = request.headers.get("x-request-id", "")
        try:
            rid = str(uuid.UUID(incoming))
        except ValueError:
            rid = str(uuid.uuid4())
        token = request_id_var.set(rid)
        started = time.perf_counter()
        try:
            try:
                response = await call_next(request)
            except Exception as exc:  # handled here, not by a global handler, so the request id is still set
                info = redact_exception(exc)
                log_event("error.unexpected", logging.ERROR, errorType=info["type"], errorMessage=info["message"], traceback=info["detail"])
                response = JSONResponse(_error_body("INTERNAL", "unexpected error", info["type"], info["detail"]), status_code=500)
            response.headers["X-Request-Id"] = rid
            log_event(
                "http.request", method=request.method, path=request.url.path, status=response.status_code,
                latencyMs=round((time.perf_counter() - started) * 1000),
            )
            return response
        finally:
            request_id_var.reset(token)

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, exc: HTTPException) -> JSONResponse:
        code = {401: "UNAUTHORIZED", 404: "NOT_FOUND"}.get(exc.status_code, "ERROR")
        return JSONResponse(_error_body(code, str(exc.detail), "HTTPException", ""), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        # Locations and error types only; the rejected values (the employee's text) are left out.
        where = "; ".join(f"{'.'.join(str(p) for p in e['loc'])}: {e['type']}" for e in exc.errors())
        return JSONResponse(_error_body("VALIDATION_FAILED", "invalid request body", "RequestValidationError", where), status_code=422)

    @app.get("/health")
    def health() -> dict:
        """Public. Says the service is up; it does not call Gemini."""
        return {"status": "ok", "model": get_settings().gemini_model}

    return app


app = create_app()
