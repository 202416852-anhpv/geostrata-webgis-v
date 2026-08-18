"""Quản lý tài khoản — chỉ admin.

Các chốt an toàn để hệ thống không tự khoá chính mình:
  1. Admin không tự đổi vai trò, tự khoá hay tự xoá tài khoản mình.
  2. Đổi vai trò hoặc khoá tài khoản thì mọi phiên của người đó bị huỷ ngay.
  3. Kiểm tra "admin cuối cùng" như lớp phòng vệ dự phòng (xem _guard_last_admin).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Path, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import repository
from app.auth import require_admin, require_user
from app.database import get_db
from app.models import User
from app.schemas import ErrorOut, UserCreateIn, UserOut, UserUpdateIn
from app.security import hash_password

logger = logging.getLogger(__name__)
# Không đặt dependency ở cấp router: hầu hết route cần quyền admin, riêng ảnh
# đại diện thì mọi người đã đăng nhập đều xem được. FastAPI không cho phép một
# route bỏ qua dependency của router, nên gắn quyền theo từng route.
router = APIRouter(prefix="/users", tags=["users"])


def _load_user(db: Session, user_id: int) -> User:
    user = repository.get_user(db, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Không tìm thấy tài khoản id={user_id}")
    return user


def _guard_last_admin(db: Session, target: User) -> None:
    """Chặn thao tác làm biến mất admin hoạt động cuối cùng.

    Trên thực tế chốt "không tự thao tác lên chính mình" đã bắt trước: người gọi
    luôn là một admin đang hoạt động và khác target, nên số admin còn lại luôn
    >= 1. Giữ lại như lớp phòng vệ thứ hai, phòng khi chốt kia được nới ra sau này.
    """
    if target.role != "admin" or not target.is_active:
        return
    if repository.count_admins(db, exclude_user_id=target.id) == 0:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Đây là admin hoạt động duy nhất. Hãy cấp quyền admin cho tài khoản khác trước.",
        )


@router.get("", response_model=list[UserOut], summary="Danh sách tài khoản")
def list_users(
    db: Session = Depends(get_db),
    _actor: User = Depends(require_admin),
) -> list[UserOut]:
    return [UserOut.model_validate(user) for user in repository.list_users(db)]


@router.post(
    "",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    responses={status.HTTP_409_CONFLICT: {"model": ErrorOut}},
    summary="Tạo tài khoản mới",
)
def create_user(
    payload: UserCreateIn,
    db: Session = Depends(get_db),
    actor: User = Depends(require_admin),
) -> UserOut:
    try:
        user = repository.create_user(
            db,
            username=payload.username,
            full_name=payload.full_name,
            password=payload.password,
            role=payload.role,
            email=payload.email,
            phone=payload.phone,
            job_title=payload.job_title,
            organization=payload.organization,
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"Tên đăng nhập hoặc email đã tồn tại: {payload.username}",
        ) from None

    logger.info("%s tạo tài khoản %s (%s)", actor.username, user.username, user.role)
    return UserOut.model_validate(user)


@router.patch(
    "/{user_id}",
    response_model=UserOut,
    responses={
        status.HTTP_404_NOT_FOUND: {"model": ErrorOut},
        status.HTTP_409_CONFLICT: {"model": ErrorOut},
    },
    summary="Sửa tài khoản, đổi vai trò hoặc khoá / mở khoá",
)
def update_user(
    payload: UserUpdateIn,
    user_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    actor: User = Depends(require_admin),
) -> UserOut:
    target = _load_user(db, user_id)

    changing_role = payload.role is not None and payload.role != target.role
    disabling = payload.is_active is False and target.is_active

    if target.id == actor.id and (changing_role or disabling):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Không thể tự đổi vai trò hoặc tự khoá tài khoản của chính mình",
        )
    if changing_role or disabling:
        _guard_last_admin(db, target)

    if payload.full_name is not None:
        target.full_name = payload.full_name
    if payload.email is not None:
        target.email = payload.email or None
    if payload.phone is not None:
        target.phone = payload.phone or None
    if payload.job_title is not None:
        target.job_title = payload.job_title or None
    if payload.organization is not None:
        target.organization = payload.organization or None
    if payload.role is not None:
        target.role = payload.role
    if payload.is_active is not None:
        target.is_active = payload.is_active
    if payload.password is not None:
        target.password_hash = hash_password(payload.password)

    repository.touch_user(db, target)

    # Vai trò mới hoặc bị khoá phải có hiệu lực ngay, không chờ phiên hết hạn.
    if changing_role or disabling or payload.password is not None:
        revoked = repository.revoke_all_sessions(db, target.id)
        if revoked:
            logger.info("Huỷ %d phiên của %s do thay đổi quyền", revoked, target.username)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="Email đã được dùng bởi tài khoản khác"
        ) from None

    logger.info("%s cập nhật tài khoản %s", actor.username, target.username)
    return UserOut.model_validate(target)


@router.delete(
    "/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        status.HTTP_404_NOT_FOUND: {"model": ErrorOut},
        status.HTTP_409_CONFLICT: {"model": ErrorOut},
    },
    summary="Xoá tài khoản",
)
def delete_user(
    user_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    actor: User = Depends(require_admin),
) -> None:
    target = _load_user(db, user_id)
    if target.id == actor.id:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Không thể tự xoá tài khoản của chính mình")
    _guard_last_admin(db, target)

    # Lỗ khoan do người này nhập vẫn giữ nguyên (created_by chuyển thành NULL
    # theo ON DELETE SET NULL) — xoá tài khoản không được làm mất dữ liệu khảo sát.
    repository.delete_user(db, target)
    db.commit()
    logger.info("%s xoá tài khoản %s", actor.username, target.username)


@router.get(
    "/{user_id}/avatar",
    responses={
        status.HTTP_200_OK: {"content": {"image/*": {}}, "description": "Ảnh đại diện"},
        status.HTTP_404_NOT_FOUND: {"model": ErrorOut},
    },
    summary="Ảnh đại diện của một tài khoản (mọi người đã đăng nhập)",
)
def get_avatar(
    user_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    _actor: User = Depends(require_user),
) -> Response:
    """Trả ảnh nhị phân. Vì cần đăng nhập nên frontend tải qua fetch rồi dựng blob URL."""
    found = repository.load_avatar(db, user_id)
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tài khoản chưa có ảnh đại diện")

    data, mime = found
    return Response(
        content=data,
        media_type=mime,
        # private: ảnh chỉ dành cho người đã đăng nhập, proxy trung gian không cache chung.
        headers={"Cache-Control": "private, max-age=300"},
    )
