import hmac

from fastapi import Header, HTTPException

from app.config import get_settings


def require_token(x_service_token: str | None = Header(default=None)) -> None:
    """Only the backend may call this service. The comparison takes the same time whatever the guess."""
    expected = get_settings().ai_service_token
    # An unset token must never let everyone in.
    if not expected or x_service_token is None:
        raise HTTPException(status_code=401, detail="invalid service token")
    if not hmac.compare_digest(x_service_token.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="invalid service token")
