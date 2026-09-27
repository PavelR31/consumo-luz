"""
Consumo Luz - API Backend
Monitor de consumo eléctrico residencial de Nicaragua
"""
import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.database import init_db
from app.services.tariff import seed_tariff_blocks
from app.database import SessionLocal

from app.routers import auth, readings, dashboard, billing, reports

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    logger.info("🔌 Iniciando Consumo Luz API...")
    init_db()

    # Seed default tariff blocks
    db = SessionLocal()
    try:
        seed_tariff_blocks(db)
        logger.info("⚡ Bloques tarifarios inicializados")
    finally:
        db.close()

    # Ensure upload directory exists
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    logger.info(f"Directorio de uploads: {settings.UPLOAD_DIR}")
    logger.info("API lista")

    yield

    logger.info("👋 Cerrando Consumo Luz API...")


app = FastAPI(
    title="Consumo Luz Nicaragua",
    description="API para monitoreo de consumo eléctrico residencial",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS - allow frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL, "http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount uploads directory for serving photos
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

# Include routers
app.include_router(auth.router)
app.include_router(readings.router)
app.include_router(dashboard.router)
app.include_router(billing.router)
app.include_router(reports.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "consumo-luz-api"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.APP_HOST,
        port=settings.APP_PORT,
        reload=True,
    )
