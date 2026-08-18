"""Endpoint hồ sơ công trình và ranh giới.

Đọc: mọi tài khoản đã đăng nhập. Thêm / sửa: manager trở lên. Xoá: chỉ admin.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import repository
from app.auth import require_admin, require_manager, require_user
from app.database import get_db
from app.models import Project, User
from app.schemas import BoreholeOut, ErrorOut, ProjectCreateIn, ProjectOut, ProjectUpdateIn

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/projects", tags=["projects"])

_NOT_FOUND = {status.HTTP_404_NOT_FOUND: {"model": ErrorOut}}


def _load_project(db: Session, project_id: int) -> Project:
    project = repository.get_project(db, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Không tìm thấy công trình id={project_id}")
    return project


def _warn_if_boundary_missing(project: Project, out: ProjectOut) -> ProjectOut:
    """Ranh giới không dựng được thì phải nói rõ, tránh người dùng tưởng đã lưu."""
    if out.vertices and not out.has_boundary:
        reason = (
            "cần từ 3 điểm trở lên"
            if len(out.vertices) < 3
            else "đường bao tự cắt nhau nên không tạo được đa giác hợp lệ"
        )
        logger.warning("Công trình %s: chưa dựng được ranh giới (%s)", project.code, reason)
    return out


@router.get("", response_model=list[ProjectOut], summary="Danh sách công trình")
def list_projects(
    db: Session = Depends(get_db),
    _actor: User = Depends(require_user),
) -> list[ProjectOut]:
    return repository.list_projects(db)


@router.get(
    "/{project_id}",
    response_model=ProjectOut,
    responses=_NOT_FOUND,
    summary="Chi tiết công trình kèm ranh giới",
)
def get_project(
    project_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    _actor: User = Depends(require_user),
) -> ProjectOut:
    return repository.to_project_out(db, _load_project(db, project_id))


@router.get(
    "/{project_id}/boreholes",
    response_model=list[BoreholeOut],
    responses=_NOT_FOUND,
    summary="Hố khoan thuộc công trình, kể cả hố chưa rõ vị trí",
)
def list_project_boreholes(
    project_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    _actor: User = Depends(require_user),
) -> list[BoreholeOut]:
    _load_project(db, project_id)
    return repository.list_project_boreholes(db, project_id)


@router.post(
    "",
    response_model=ProjectOut,
    status_code=status.HTTP_201_CREATED,
    responses={status.HTTP_409_CONFLICT: {"model": ErrorOut}},
    summary="Thêm công trình (manager trở lên)",
)
def create_project(
    payload: ProjectCreateIn,
    db: Session = Depends(get_db),
    actor: User = Depends(require_manager),
) -> ProjectOut:
    if repository.get_project_by_code(db, payload.code) is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail=f"Đã có công trình mã {payload.code}"
        )
    try:
        project = repository.create_project(db, payload, actor)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Mã công trình đã tồn tại") from None

    out = repository.to_project_out(db, project)
    logger.info("%s thêm công trình %s (%d đỉnh)", actor.username, project.code, len(out.vertices))
    return _warn_if_boundary_missing(project, out)


@router.put(
    "/{project_id}",
    response_model=ProjectOut,
    responses=_NOT_FOUND,
    summary="Cập nhật công trình và ranh giới (manager trở lên)",
)
def update_project(
    payload: ProjectUpdateIn,
    project_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    actor: User = Depends(require_manager),
) -> ProjectOut:
    project = _load_project(db, project_id)
    repository.update_project(db, project, payload, actor)
    db.commit()

    out = repository.to_project_out(db, project)
    logger.info("%s cập nhật công trình %s", actor.username, project.code)
    return _warn_if_boundary_missing(project, out)


@router.delete(
    "/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=_NOT_FOUND,
    summary="Xoá công trình và toàn bộ hố khoan bên trong (chỉ admin)",
)
def delete_project(
    project_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    actor: User = Depends(require_admin),
) -> None:
    project = _load_project(db, project_id)
    count = len(repository.list_project_boreholes(db, project_id))
    repository.delete_project(db, project)
    db.commit()
    logger.warning(
        "%s xoá công trình %s kèm %d hố khoan", actor.username, project.code, count
    )
