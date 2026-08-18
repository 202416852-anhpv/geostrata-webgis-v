"""Dependency xác thực và phân quyền cho FastAPI.

Ba vai trò, quyền tăng dần:

    user     — tra cứu lỗ khoan và xem mặt cắt
    manager  — thêm / sửa dữ liệu lỗ khoan
    admin    — quản lý tài khoản, phân vai trò, xoá lỗ khoan

Quyền theo cấp bậc: admin làm được mọi việc của manager, manager làm được mọi
việc của user.
"""

from __future__ import annotations

from collections.abc import Callable

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app import repository
from app.database import get_db
from app.models import Role, User

# auto_error=False để tự trả lỗi bằng tiếng Việt thay vì thông báo mặc định.
bearer_scheme = HTTPBearer(auto_error=False, description="Token nhận được từ POST /api/auth/login")

_UNAUTHENTICATED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Chưa đăng nhập hoặc phiên đã hết hạn",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_session_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    if credentials is None or not credentials.credentials:
        raise _UNAUTHENTICATED
    return credentials.credentials


def get_current_user(
    token: str = Depends(get_session_token),
    db: Session = Depends(get_db),
) -> User:
    """Người dùng của phiên hiện tại.

    Vì phiên tra thẳng từ CSDL nên đăng xuất, khoá tài khoản hay đổi vai trò đều
    có hiệu lực ngay ở request kế tiếp.
    """
    user = repository.get_active_user_by_token(db, token)
    if user is None:
        raise _UNAUTHENTICATED
    return user


def require_role(minimum: Role) -> Callable[..., User]:
    """Sinh dependency đòi hỏi vai trò tối thiểu."""

    def dependency(user: User = Depends(get_current_user)) -> User:
        if not user.can_act_as(minimum):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Chức năng này yêu cầu quyền {minimum.value} trở lên",
            )
        return user

    return dependency


require_user = require_role(Role.USER)
require_manager = require_role(Role.MANAGER)
require_admin = require_role(Role.ADMIN)


def client_user_agent(request: Request) -> str | None:
    return request.headers.get("user-agent")
