from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = "sqlite:///./querymind.db"
    max_rows: int = 500
    query_timeout_seconds: int = 10
    upload_dir: str = "./data/uploads"
    max_upload_bytes: int = 50 * 1024 * 1024
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
