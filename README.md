# Daily Prophet

A Harry Potter–style picture frame. Raspberry Pi 5 drives a display mounted behind a cut-out newspaper, looping short stylized video clips uploaded over local Wi-Fi.

---

## Running the stack

### Production (Nginx-served build)

```powershell
docker compose up --build
```

| Service  | URL                          |
|----------|------------------------------|
| Frontend | http://127.0.0.1:3000        |
| Backend  | http://127.0.0.1:8000        |
| API docs | http://127.0.0.1:8000/docs   |

### Development (hot-reload)

```powershell
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

| Service  | URL                          | Notes                        |
|----------|------------------------------|------------------------------|
| Frontend | http://127.0.0.1:5173        | Vite dev server, HMR enabled |
| Backend  | http://127.0.0.1:8000        | uvicorn --reload             |
| API docs | http://127.0.0.1:8000/docs   |                              |

> **Windows note:** use `127.0.0.1` not `localhost` — Docker Desktop on Windows binds to IPv4 only and `localhost` can resolve to `::1` (IPv6) first.

---

## Running tests

Tests run inside the backend dev image (includes FFmpeg + pytest).

**Build the dev image first** (only needed after changing `requirements*.txt` or the Dockerfile):

```powershell
docker build --target dev -t dailyprophet-backend-dev ./backend
```

**Run the full suite:**

```powershell
docker run --rm -v "${PWD}/backend:/app" dailyprophet-backend-dev pytest -v
```

**Run a specific file or test:**

```powershell
docker run --rm -v "${PWD}/backend:/app" dailyprophet-backend-dev pytest -v tests/test_processor.py
docker run --rm -v "${PWD}/backend:/app" dailyprophet-backend-dev pytest -v -k "sepia"
```

Test files and what they cover:

| File                       | Group | Covers                                              |
|----------------------------|-------|-----------------------------------------------------|
| `tests/test_clips.py`      | A     | Upload lifecycle, quota enforcement, delete cleanup |
| `tests/test_queue.py`      | A     | Sequential processing, crash recovery               |
| `tests/test_processor.py`  | B     | FFmpeg pipeline: resize, sepia, crossfade, codec    |

---

## Configuration reference

### Display resolution

**Set this before deploying to the Pi** once the display model is confirmed.

File: [`docker-compose.yml`](docker-compose.yml) → `backend.environment`

```yaml
- DISPLAY_WIDTH=1920
- DISPLAY_HEIGHT=1080
```

Processed video is letterboxed (black bars) to exactly this size. Changing these values requires re-processing existing clips.

### Storage quota

How much of the SD card is reserved for clips.

File: [`docker-compose.yml`](docker-compose.yml) → `backend.environment`

```yaml
- STORAGE_QUOTA_GB=10
```

### Video processing tuning

File: [`backend/app/config.py`](backend/app/config.py)

| Setting             | Default | What it does                                        |
|---------------------|---------|-----------------------------------------------------|
| `target_fps`        | `30`    | Output frame rate                                   |
| `video_crf`         | `23`    | libx264 quality — lower = better quality/larger file |
| `max_clip_duration` | `15.0`  | Maximum clip length in seconds; longer uploads are rejected |
| `crossfade_duration`| `0.5`   | Loop blend window in seconds                        |

All of these can also be set as env vars (`TARGET_FPS`, `VIDEO_CRF`, etc.) in `docker-compose.yml`.

### Clip storage location

Clips are bind-mounted from the host into containers. Change the host path in [`docker-compose.yml`](docker-compose.yml):

```yaml
volumes:
  - ./data/clips:/data/clips
```

On the Pi this will point to a dedicated partition on the SD card.

### Sepia filter

The Daily Prophet brownish-gray look is a classic sepia matrix. To tune it, edit the `colorchannelmixer` values in [`backend/app/services/processor.py`](backend/app/services/processor.py) — look for the comment `# Classic sepia matrix`.

---

## Project layout

```
backend/
  app/
    config.py          ← all tunable settings live here
    main.py            ← FastAPI app + lifespan
    database.py        ← SQLite setup
    models.py          ← Pydantic data models
    routes/            ← clips, storage, display schedule, wifi
    services/
      processor.py     ← FFmpeg pipeline (resize, sepia, crossfade, encode)
      queue.py         ← sequential async job queue
  tests/               ← pytest test suite
frontend/
  src/
    api/               ← fetch client + TypeScript types
    pages/             ← Upload, Queue, Settings, Kiosk
    components/        ← ClipCard, StorageMeter
docker-compose.yml     ← production stack
docker-compose.dev.yml ← dev overrides (hot-reload, Vite)
data/clips/            ← clip storage (bind-mounted, git-ignored)
```
