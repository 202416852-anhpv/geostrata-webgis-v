"""Băm mật khẩu và sinh token phiên."""

from __future__ import annotations

import hashlib
import secrets

import bcrypt

# bcrypt chỉ xử lý tối đa 72 byte; phần dư bị bỏ lặng lẽ nên phải chặn từ đầu,
# nếu không hai mật khẩu dài khác nhau có thể cùng đăng nhập được.
MAX_PASSWORD_BYTES = 72


class PasswordTooLongError(ValueError):
    def __init__(self) -> None:
        super().__init__(f"Mật khẩu vượt quá {MAX_PASSWORD_BYTES} byte")


def hash_password(plain: str) -> str:
    raw = plain.encode("utf-8")
    if len(raw) > MAX_PASSWORD_BYTES:
        raise PasswordTooLongError
    return bcrypt.hashpw(raw, bcrypt.gensalt()).decode("ascii")


def verify_password(plain: str, password_hash: str) -> bool:
    raw = plain.encode("utf-8")
    if len(raw) > MAX_PASSWORD_BYTES:
        return False
    try:
        return bcrypt.checkpw(raw, password_hash.encode("ascii"))
    except ValueError:
        # Hash hỏng hoặc sai định dạng: coi như sai mật khẩu, không làm sập request.
        return False


def generate_session_token() -> str:
    """Token gốc — chỉ trả về cho client đúng một lần, không lưu ở CSDL."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """CSDL chỉ giữ bản băm; lộ CSDL cũng không mạo danh được phiên."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
