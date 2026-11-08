from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Read from the environment (and a local .env). Names match .env.example."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ai_service_token: str = ""
    google_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash"
    llm_timeout_seconds: float = 20
    confidence_threshold: float = 0.6
    log_level: str = "INFO"
    debug_log_prompts: bool = False
    app_env: str = "development"

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
