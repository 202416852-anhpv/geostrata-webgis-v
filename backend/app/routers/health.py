"""Health check dùng cho Docker healthcheck và giám sát."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app import repository
from app.database import get_db
from app.schemas import HealthOut

logger = logging.getLogger(__name__)
router = APIRouter(tags=["system"])


@router.get("/health", response_model=HealthOut, summary="Trạng thái dịch vụ")
def health(response: Response, db: Session = Depends(get_db)) -> HealthOut:
    try:
        count = repository.count_boreholes(db)
    except SQLAlchemyError:
        logger.exception("Health check: không truy vấn được CSDL")
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return HealthOut(status="degraded", database="down")
    return HealthOut(status="ok", database="up", borehole_count=count)
