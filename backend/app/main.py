"""Điểm vào của backend GeoStrata."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from app.config import get_settings
from app.routers import auth, boreholes, catalog, health, projects, users

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger("geostrata")

settings = get_settings()

app = FastAPI(
    title="GeoStrata WebGIS API",
    description="API tra cứu lỗ khoan khảo sát địa chất và mặt cắt địa tầng.",
    version="1.0.0",
    docs_url=f"{settings.api_prefix}/docs",
    openapi_url=f"{settings.api_prefix}/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(health.router, prefix=settings.api_prefix)
app.include_router(auth.router, prefix=settings.api_prefix)
app.include_router(catalog.router, prefix=settings.api_prefix)
app.include_router(projects.router, prefix=settings.api_prefix)
app.include_router(boreholes.router, prefix=settings.api_prefix)
app.include_router(users.router, prefix=settings.api_prefix)


@app.exception_handler(SQLAlchemyError)
async def handle_db_error(_request: Request, exc: SQLAlchemyError) -> JSONResponse:
    """Không rò rỉ chi tiết SQL ra client, nhưng vẫn ghi log đầy đủ."""
    logger.exception("Lỗi truy vấn CSDL", exc_info=exc)
    return JSONResponse(status_code=503, content={"detail": "Không truy cập được cơ sở dữ liệu"})
