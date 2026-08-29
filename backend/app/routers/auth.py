"""Đăng ký, đăng nhập, đăng xuất và hồ sơ cá nhân."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import coins as coin_service
from app import repository
from app.auth import client_user_agent, get_current_user, get_session_token
from app.config import Settings, get_settings
from app.database import get_db
from app.images import InvalidImageError, validate_avatar
from app.models import Role, User
from app.schemas import (
    ErrorOut,
    LoginIn,
    LoginOut,
    PasswordChangeIn,
    ProfileUpdateIn,
    RegisterIn,
    RegistrationConfigOut,
    UserOut,
)
from app.security import hash_password, verify_password

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])

_BAD_CREDENTIALS = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Tên đăng nhập hoặc mật khẩu không đúng",
)


def _issue_session(
    db: Session, user: User, config: Settings, user_agent: str | None
) -> LoginOut:
    token, session = repository.create_session(db, user, config.session_ttl_hours, user_agent)
    db.commit()
    return LoginOut(
        access_token=token,
        expires_at=session.expires_at,
        user=UserOut.model_validate(user),
    )


@router.get("/registration", response_model=RegistrationConfigOut, summary="Có cho tự đăng ký không")
def registration_config(config: Settings = Depends(get_settings)) -> RegistrationConfigOut:
    """Công khai: màn đăng nhập cần biết có hiện tab Đăng ký hay không."""
    return RegistrationConfigOut(
        allow_self_registration=config.allow_self_registration, min_password_length=8
    )


@router.post(
    "/register",
    response_model=LoginOut,
    status_code=status.HTTP_201_CREATED,
    responses={
        status.HTTP_403_FORBIDDEN: {"model": ErrorOut},
        status.HTTP_409_CONFLICT: {"model": ErrorOut},
    },
    summary="Tự đăng ký tài khoản",
)
def register(
    payload: RegisterIn,
    db: Session = Depends(get_db),
    config: Settings = Depends(get_settings),
    user_agent: str | None = Depends(client_user_agent),
) -> LoginOut:
    """Tạo tài khoản mới rồi đăng nhập luôn.

    Tài khoản tự đăng ký LUÔN nhận vai trò "user" (chỉ tra cứu), bất kể client
    gửi gì — nâng quyền là việc của admin.
    """
    if not config.allow_self_registration:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Hệ thống đang tắt tính năng tự đăng ký. Liên hệ quản trị viên để được cấp tài khoản.",
        )

    if repository.get_user_by_username(db, payload.username) is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail=f"Tên đăng nhập {payload.username} đã có người dùng"
        )
    if payload.email and repository.get_user_by_email(db, payload.email) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Email này đã được đăng ký")

    try:
        user = repository.create_user(
            db,
            username=payload.username,
            full_name=payload.full_name,
            password=payload.password,
            role=Role.USER.value,
            email=payload.email,
            phone=payload.phone,
            job_title=payload.job_title,
            organization=payload.organization,
        )
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="Tên đăng nhập hoặc email đã tồn tại"
        ) from None

    # Tặng xu dùng thử để người mới xem được vài hố khoan trước khi cần nạp.
    if config.coins_enabled and config.signup_bonus_coins > 0:
        coin_service.credit(
            db,
            user.id,
            config.signup_bonus_coins,
            kind="admin_grant",
            description="Xu tặng khi đăng ký tài khoản",
        )

    logger.info("Đăng ký tài khoản mới: %s", user.username)
    return _issue_session(db, user, config, user_agent)


@router.post(
    "/login",
    response_model=LoginOut,
    responses={status.HTTP_401_UNAUTHORIZED: {"model": ErrorOut}},
    summary="Đăng nhập",
)
def login(
    payload: LoginIn,
    db: Session = Depends(get_db),
    config: Settings = Depends(get_settings),
    user_agent: str | None = Depends(client_user_agent),
) -> LoginOut:
    user = repository.get_user_by_username(db, payload.username)
    # Cho phép đăng nhập bằng email, tiện cho người tự đăng ký.
    if user is None and "@" in payload.username:
        user = repository.get_user_by_email(db, payload.username)

    # Sai tên và sai mật khẩu trả về cùng một thông báo, để không lộ tài khoản nào tồn tại.
    if user is None or not verify_password(payload.password, user.password_hash):
        logger.warning("Đăng nhập thất bại cho tài khoản %r", payload.username)
        raise _BAD_CREDENTIALS
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Tài khoản đã bị khoá")

    logger.info("Đăng nhập thành công: %s (%s)", user.username, user.role)
    return _issue_session(db, user, config, user_agent)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, summary="Đăng xuất")
def logout(token: str = Depends(get_session_token), db: Session = Depends(get_db)) -> None:
    """Xoá phiên khỏi CSDL — token cũ lập tức vô hiệu, không dùng lại được."""
    repository.revoke_session(db, token)
    db.commit()


@router.get("/me", response_model=UserOut, summary="Thông tin tài khoản đang đăng nhập")
def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)


@router.put(
    "/me",
    response_model=UserOut,
    responses={status.HTTP_409_CONFLICT: {"model": ErrorOut}},
    summary="Tự sửa hồ sơ cá nhân",
)
def update_profile(
    payload: ProfileUpdateIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    """Người dùng chỉ sửa được thông tin của mình, không đụng tới vai trò."""
    if payload.email:
        existing = repository.get_user_by_email(db, payload.email)
        if existing is not None and existing.id != user.id:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="Email này đã được dùng bởi tài khoản khác")

    user.full_name = payload.full_name
    user.email = payload.email
    user.phone = payload.phone
    user.job_title = payload.job_title
    user.organization = payload.organization
    repository.touch_user(db, user)
    db.commit()
    return UserOut.model_validate(user)


@router.post(
    "/change-password",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={status.HTTP_400_BAD_REQUEST: {"model": ErrorOut}},
    summary="Tự đổi mật khẩu",
)
def change_password(
    payload: PasswordChangeIn,
    user: User = Depends(get_current_user),
    token: str = Depends(get_session_token),
    db: Session = Depends(get_db),
) -> None:
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Mật khẩu hiện tại không đúng")

    user.password_hash = hash_password(payload.new_password)
    repository.touch_user(db, user)
    # Đổi mật khẩu thì các phiên khác phải đăng nhập lại; phiên đang gọi vẫn giữ,
    # để người dùng không bị đá ra ngay sau khi đổi.
    repository.revoke_other_sessions(db, user.id, token)
    db.commit()


@router.post(
    "/me/avatar",
    response_model=UserOut,
    responses={status.HTTP_400_BAD_REQUEST: {"model": ErrorOut}},
    summary="Tải lên ảnh đại diện",
)
def upload_avatar(
    file: UploadFile = File(..., description="Ảnh PNG, JPEG, WebP hoặc GIF"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    config: Settings = Depends(get_settings),
) -> UserOut:
    data = file.file.read(config.max_avatar_bytes + 1)
    try:
        # Kiểu ảnh suy từ nội dung, không tin Content-Type client khai.
        mime = validate_avatar(data, config.max_avatar_bytes)
    except InvalidImageError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    repository.set_avatar(db, user, data, mime)
    db.commit()
    logger.info("%s cập nhật ảnh đại diện (%d KB, %s)", user.username, len(data) // 1024, mime)
    return UserOut.model_validate(user)


@router.delete("/me/avatar", response_model=UserOut, summary="Xoá ảnh đại diện")
def delete_avatar(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    repository.clear_avatar(db, user)
    db.commit()
    return UserOut.model_validate(user)
