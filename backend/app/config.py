from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    # Storage
    clips_dir: Path = Path("/data/clips")
    database_url: str = "sqlite:////data/clips/db.sqlite3"
    storage_quota_gb: float = 10.0

    # -------------------------------------------------------------------------
    # Display — update these once the Pi display is confirmed.
    # Set DISPLAY_WIDTH / DISPLAY_HEIGHT env vars in docker-compose.yml or .env.
    # All processed video is letterboxed to exactly this resolution.
    # -------------------------------------------------------------------------
    display_width: int = 1920
    display_height: int = 1080

    # Processing
    target_fps: int = 30
    video_crf: int = 23          # libx264 quality (18=near-lossless, 28=smaller file)
    max_clip_duration: float = 15.0    # seconds; longer uploads are rejected
    crossfade_duration: float = 0.5    # seconds blended at loop boundary

    @property
    def db_path(self) -> Path:
        return self.clips_dir / "db.sqlite3"

    @property
    def quota_bytes(self) -> int:
        return int(self.storage_quota_gb * 1024 ** 3)

    model_config = {"env_file": ".env"}


settings = Settings()
