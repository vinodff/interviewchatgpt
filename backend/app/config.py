from ipaddress import ip_address
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def loopback_host(host: str | None) -> bool:
    if host == "localhost":
        return True
    try:
        return ip_address(host or "").is_loopback
    except ValueError:
        return False


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)
    environment: str = "development"
    local_test_mode: bool = False
    local_test_user_id: str = ""
    database_url: str = "sqlite+aiosqlite:///./data/interviewpilot.db"
    redis_url: str = "memory://"
    gemini_api_key: SecretStr = SecretStr("")
    gemini_answer_model: str = "gemini-3.8-flash"
    gemini_fast_model: str = "gemini-3.5-flash-lite"
    gemini_live_model: str = "gemini-3.5-transcribe-live"
    gemini_embedding_model: str = "gemini-embedding-001"
    embedding_dimensions: int = 768
    encryption_key: SecretStr = SecretStr("")
    upload_dir: Path = Path("data/uploads")
    max_upload_bytes: int = 20 * 1024 * 1024
    max_sources: int = 200
    allowed_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "https://www.interviewwin.live",
        "https://interviewwin.live",
        "https://frontend-blush-pi-24.vercel.app",
    ]
    public_url: str = "https://www.interviewwin.live"
    cookie_secure: bool = False
    session_days: int = 7
    free_minutes: int = Field(default=2, ge=0)
    starter_minutes: int = Field(default=20, gt=0)
    pro_minutes: int = Field(default=45, gt=0)
    value_minutes: int = Field(default=120, gt=0)
    starter_price_minor: int = Field(default=10000, gt=0)
    pro_price_minor: int = Field(default=20000, gt=0)
    value_price_minor: int = Field(default=50000, gt=0)
    max_session_seconds: int = 7200
    github_token: SecretStr = SecretStr("")
    github_client_id: str = ""
    github_client_secret: SecretStr = SecretStr("")
    stripe_secret_key: SecretStr = SecretStr("")
    stripe_webhook_secret: SecretStr = SecretStr("")
    stripe_price_id: str = ""
    stripe_starter_price_id: str = ""
    cashfree_app_id: str = ""
    cashfree_secret: SecretStr = SecretStr("")
    cashfree_env: str = "production"
    cashfree_api_version: str = "2023-08-01"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: SecretStr = SecretStr("")
    smtp_from: str = ""
    worker_poll_seconds: float = 2

    @model_validator(mode="after")
    def require_production_settings(self):
        if self.local_test_mode:
            if self.environment not in {"development", "test"}:
                raise ValueError("Local testing mode is only available in development or test")
            try:
                self.local_test_user_id = str(UUID(self.local_test_user_id))
            except ValueError:
                raise ValueError("Local testing mode requires an existing LOCAL_TEST_USER_ID UUID") from None
            if any(not loopback_host(urlparse(url).hostname) for url in [self.public_url, *self.allowed_origins]):
                raise ValueError("Local testing mode requires loopback application URLs and origins")
        if self.environment == "production":
            if not self.database_url.startswith("postgresql+asyncpg://"):
                raise ValueError("Production requires PostgreSQL")
            if self.redis_url.startswith("memory:") or not self.cookie_secure:
                raise ValueError("Production requires Redis and secure cookies")
            if not self.encryption_key.get_secret_value() or not self.gemini_api_key.get_secret_value():
                raise ValueError("Production requires encryption and Gemini secrets")
            if not self.public_url.startswith("https://") or any(not o.startswith("https://") for o in self.allowed_origins):
                raise ValueError("Production requires HTTPS origins")
        return self

    def testing_user(self, user_id: str) -> bool:
        return self.local_test_mode and self.environment in {"development", "test"} and user_id == self.local_test_user_id


settings = Settings()
