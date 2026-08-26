"""Endpoint dữ liệu tham chiếu: danh mục đất và cấu hình client.

Danh sách công trình nằm ở routers/projects.py, không khai báo lại ở đây —
hai router cùng đăng ký GET /projects thì cái nạp trước sẽ che cái sau.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import repository
from app.auth import require_user
from app.config import Settings, get_settings
from app.database import get_db
from app.models import User
from app.schemas import ClientConfigOut, SoilTypeOut

router = APIRouter(tags=["catalog"])


@router.get("/soil-types", response_model=list[SoilTypeOut], summary="Danh mục loại đất")
def list_soil_types(
    db: Session = Depends(get_db),
    _actor: User = Depends(require_user),
) -> list[SoilTypeOut]:
    return repository.list_soil_types(db)


@router.get("/config", response_model=ClientConfigOut, summary="Tham số nghiệp vụ cho frontend")
def client_config(config: Settings = Depends(get_settings)) -> ClientConfigOut:
    """Công khai: frontend cần đọc trước khi có phiên đăng nhập."""
    return ClientConfigOut(
        default_search_radius_m=config.default_search_radius_m,
        min_search_radius_m=config.min_search_radius_m,
        max_search_radius_m=config.max_search_radius_m,
        max_results=config.max_results,
        allow_self_registration=config.allow_self_registration,
        max_avatar_bytes=config.max_avatar_bytes,
        geocode_enabled=config.geocode_enabled,
    )
