from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db, close_db
from app.services.queue import start_worker, stop_worker
from app.routes import clips, storage, display, wifi


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await start_worker()
    yield
    await stop_worker()
    await close_db()


app = FastAPI(title="Daily Prophet API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(clips.router)
app.include_router(storage.router)
app.include_router(display.router)
app.include_router(wifi.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
