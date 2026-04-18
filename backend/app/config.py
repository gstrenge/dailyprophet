from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    clips_dir: Path = Path("/data/clips")
    database_url: str = "sqlite:////data/clips/db.sqlite3"
    storage_quota_gb: float = 10.0

    @property
    def db_path(self) -> Path:
        return self.clips_dir / "db.sqlite3"

    @property
    def quota_bytes(self) -> int:
        return int(self.storage_quota_gb * 1024 ** 3)

    model_config = {"env_file": ".env"}


settings = Settings()
