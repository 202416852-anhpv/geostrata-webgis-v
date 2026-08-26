"""Tra cứu địa điểm theo tên, dùng cho ô tìm kiếm trên bản đồ."""

from __future__ import annotations

import logging
from functools import lru_cache

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.auth import require_user
from app.config import Settings, get_settings
from app.geocoding import GeocodingUnavailableError, NominatimClient
from app.models import User
from app.schemas import BoundingBoxOut, ErrorOut, PlaceOut, PlaceSearchOut

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/geocode", tags=["geocode"])


@lru_cache
def _client() -> NominatimClient:
    """Một thực thể dùng chung cho cả tiến trình — bộ đệm và bộ hạn tốc nằm trong đó."""
    config = get_settings()
    return NominatimClient(
        base_url=config.nominatim_url,
        user_agent=config.geocode_user_agent,
        country_codes=config.geocode_country_codes,
        timeout_s=config.geocode_timeout_s,
        min_interval_s=config.geocode_min_interval_s,
    )


@router.get(
    "",
    response_model=PlaceSearchOut,
    responses={status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ErrorOut}},
    summary="Tìm địa điểm theo tên",
)
def search_places(
    q: str = Query(..., min_length=2, max_length=200, description="Tên địa điểm cần tìm"),
    limit: int = Query(6, ge=1, le=20),
    config: Settings = Depends(get_settings),
    _actor: User = Depends(require_user),
) -> PlaceSearchOut:
    """Trả về danh sách địa điểm khớp với từ khoá.

    Cần đăng nhập: endpoint này gọi ra dịch vụ ngoài có giới hạn tốc độ, không
    nên để mở cho mọi truy cập.
    """
    if not config.geocode_enabled:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Tính năng tra cứu địa điểm đang tắt",
        )

    try:
        places = _client().search(q, limit)
    except GeocodingUnavailableError as exc:
        # 503 chứ không phải 500: lỗi nằm ở dịch vụ bên ngoài, thử lại có thể được.
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    return PlaceSearchOut(
        query=q,
        count=len(places),
        places=[
            PlaceOut(
                name=place.name,
                display_name=place.display_name,
                lat=place.lat,
                lng=place.lng,
                category=place.category,
                bbox=(
                    BoundingBoxOut(
                        south=place.bbox.south,
                        west=place.bbox.west,
                        north=place.bbox.north,
                        east=place.bbox.east,
                    )
                    if place.bbox
                    else None
                ),
            )
            for place in places
        ],
    )
