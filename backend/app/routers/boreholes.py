"""Endpoint tra cứu và nhập liệu lỗ khoan.

Đọc: mọi tài khoản đã đăng nhập.
Thêm / sửa: manager trở lên.
Xoá: chỉ admin.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import coins as coin_service
from app import repository
from app.auth import require_admin, require_manager, require_user
from app.config import Settings, get_settings
from app.database import get_db
from app.models import Borehole, Project, User
from app.routers.coins import unlock_cost_for
from app.schemas import (
    BoreholeBulkCreateIn,
    BoreholeCreateIn,
    BoreholeOut,
    BoreholeSearchOut,
    BoreholeSectionOut,
    BoreholeUpdateIn,
    BulkCreateOut,
    ErrorOut,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/boreholes", tags=["boreholes"])
settings = get_settings()

_NOT_FOUND = {status.HTTP_404_NOT_FOUND: {"model": ErrorOut}}


def _load_borehole(db: Session, borehole_id: int) -> Borehole:
    borehole = repository.get_borehole(db, borehole_id)
    if borehole is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Không tìm thấy lỗ khoan id={borehole_id}")
    return borehole


# --- Đọc ---------------------------------------------------------------------


@router.get("", response_model=BoreholeSearchOut, summary="Tìm lỗ khoan quanh một toạ độ")
def search_boreholes(
    lat: float = Query(..., ge=-90, le=90, description="Vĩ độ (WGS84)"),
    lng: float = Query(..., ge=-180, le=180, description="Kinh độ (WGS84)"),
    radius_m: float | None = Query(
        None,
        ge=settings.min_search_radius_m,
        le=settings.max_search_radius_m,
        description="Bán kính tìm kiếm (m). Bỏ trống sẽ dùng giá trị mặc định của hệ thống.",
    ),
    limit: int = Query(200, ge=1, le=settings.max_results),
    db: Session = Depends(get_db),
    config: Settings = Depends(get_settings),
    _actor: User = Depends(require_user),
) -> BoreholeSearchOut:
    radius = radius_m if radius_m is not None else config.default_search_radius_m
    boreholes = repository.search_boreholes(db, lat=lat, lng=lng, radius_m=radius, limit=limit)

    # Đánh dấu hố nào người này đã có quyền xem, để danh sách hiện đúng ổ khoá.
    if unlock_cost_for(_actor, config) > 0:
        owned = repository.unlocked_borehole_ids(db, _actor.id)
        for item in boreholes:
            item.is_unlocked = item.id in owned

    return BoreholeSearchOut(lat=lat, lng=lng, radius_m=radius, count=len(boreholes), boreholes=boreholes)


@router.get(
    "/{borehole_id}",
    response_model=BoreholeOut,
    responses=_NOT_FOUND,
    summary="Chi tiết một lỗ khoan",
)
def get_borehole(
    borehole_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    _actor: User = Depends(require_user),
) -> BoreholeOut:
    return repository.to_borehole_out(_load_borehole(db, borehole_id))


@router.get(
    "/{borehole_id}/section",
    response_model=BoreholeSectionOut,
    responses=_NOT_FOUND,
    summary="Mặt cắt địa chất của một lỗ khoan",
)
def get_section(
    borehole_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    _actor: User = Depends(require_user),
    config: Settings = Depends(get_settings),
) -> BoreholeSectionOut:
    """Mặt cắt là phần nội dung phải trả phí với vai trò "user".

    Trả 402 khi chưa mua: yêu cầu hợp lệ, chỉ thiếu quyền xem — khác hẳn 403
    (không đủ vai trò) hay 404 (không tồn tại).
    """
    section = repository.get_section(db, borehole_id)
    if section is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Không tìm thấy hố khoan id={borehole_id}")

    cost = unlock_cost_for(_actor, config)
    if cost > 0 and coin_service.get_unlock(db, _actor.id, borehole_id) is None:
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            detail=f"Cần {cost} xu để xem mặt cắt hố khoan này",
        )

    return section


# --- Ghi ---------------------------------------------------------------------


@router.post(
    "",
    response_model=BoreholeOut,
    status_code=status.HTTP_201_CREATED,
    responses={
        status.HTTP_400_BAD_REQUEST: {"model": ErrorOut},
        status.HTTP_409_CONFLICT: {"model": ErrorOut},
    },
    summary="Thêm lỗ khoan mới (manager trở lên)",
)
def create_borehole(
    payload: BoreholeCreateIn,
    db: Session = Depends(get_db),
    actor: User = Depends(require_manager),
) -> BoreholeOut:
    """Thêm một hố khoan, thuộc công trình hoặc đứng riêng.

    Bỏ trống ``project_code`` để tạo hố khoan đơn lẻ.
    """
    project = _resolve_project(db, payload.project_code)
    _ensure_code_free(db, project.id if project else None, payload.code, payload.project_code)

    try:
        borehole = repository.create_borehole(
            db, project=project, code=payload.code, payload=payload, actor=actor
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Dữ liệu vi phạm ràng buộc CSDL") from None

    logger.info(
        "%s thêm hố khoan %s (%s)",
        actor.username,
        payload.code,
        payload.project_code or "đơn lẻ",
    )
    return repository.to_borehole_out(borehole)


@router.post(
    "/bulk",
    response_model=BulkCreateOut,
    status_code=status.HTTP_201_CREATED,
    responses={
        status.HTTP_400_BAD_REQUEST: {"model": ErrorOut},
        status.HTTP_409_CONFLICT: {"model": ErrorOut},
    },
    summary="Thêm nhiều hố khoan, kèm tạo công trình nếu cần (manager trở lên)",
)
def create_boreholes_bulk(
    payload: BoreholeBulkCreateIn,
    db: Session = Depends(get_db),
    actor: User = Depends(require_manager),
) -> BulkCreateOut:
    """Ba cách dùng, xem BoreholeBulkCreateIn.

    Toàn bộ nằm trong một giao dịch: một hố khoan lỗi thì không có gì được lưu,
    tránh để lại công trình rỗng hoặc danh sách nhập dở.
    """
    if payload.project is not None:
        if repository.get_project_by_code(db, payload.project.code) is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail=f"Đã có công trình mã {payload.project.code}",
            )
        project = repository.create_project(db, payload.project, actor)
    else:
        project = _resolve_project(db, payload.project_code)

    project_id = project.id if project else None
    scope_code = payload.project_code or (project.code if project else None)
    for item in payload.boreholes:
        _ensure_code_free(db, project_id, item.code, scope_code)

    try:
        created = [
            repository.create_borehole(db, project=project, code=item.code, payload=item, actor=actor)
            for item in payload.boreholes
        ]
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Dữ liệu vi phạm ràng buộc CSDL") from None

    logger.info(
        "%s thêm %d hố khoan (%s)",
        actor.username,
        len(created),
        project.code if project else "đơn lẻ",
    )
    return BulkCreateOut(
        project=repository.to_project_out(db, project) if project else None,
        created_count=len(created),
        boreholes=[repository.to_borehole_out(b) for b in created],
    )


def _resolve_project(db: Session, project_code: str | None) -> Project | None:
    if not project_code:
        return None
    project = repository.get_project_by_code(db, project_code)
    if project is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail=f"Không có công trình với mã {project_code}"
        )
    return project


def _ensure_code_free(
    db: Session, project_id: int | None, code: str, project_code: str | None
) -> None:
    if repository.get_borehole_by_code(db, project_id, code) is None:
        return
    scope = f"Công trình {project_code}" if project_code else "Nhóm hố khoan đơn lẻ"
    raise HTTPException(status.HTTP_409_CONFLICT, detail=f"{scope} đã có hố khoan mã {code}")


@router.put(
    "/{borehole_id}",
    response_model=BoreholeOut,
    responses={**_NOT_FOUND, status.HTTP_400_BAD_REQUEST: {"model": ErrorOut}},
    summary="Cập nhật lỗ khoan và địa tầng (manager trở lên)",
)
def update_borehole(
    payload: BoreholeUpdateIn,
    borehole_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    actor: User = Depends(require_manager),
) -> BoreholeOut:
    borehole = _load_borehole(db, borehole_id)
    try:
        repository.update_borehole(db, borehole, payload, actor)
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    logger.info("%s cập nhật lỗ khoan id=%d", actor.username, borehole_id)
    return repository.to_borehole_out(borehole)


@router.delete(
    "/{borehole_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=_NOT_FOUND,
    summary="Xoá lỗ khoan (chỉ admin)",
)
def delete_borehole(
    borehole_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    actor: User = Depends(require_admin),
) -> None:
    borehole = _load_borehole(db, borehole_id)
    repository.delete_borehole(db, borehole)
    db.commit()
    logger.warning("%s xoá lỗ khoan %s (id=%d)", actor.username, borehole.code, borehole_id)
