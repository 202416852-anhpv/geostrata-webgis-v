"""Kiểm thử băm mật khẩu, token phiên và cấp bậc vai trò."""

from __future__ import annotations

import pytest

from app.models import Role
from app.security import (
    MAX_PASSWORD_BYTES,
    PasswordTooLongError,
    generate_session_token,
    hash_password,
    hash_token,
    verify_password,
)


def test_hash_is_not_the_plain_password() -> None:
    hashed = hash_password("matkhau123")
    assert hashed != "matkhau123"
    assert hashed.startswith("$2")


def test_same_password_gets_different_hashes() -> None:
    """Mỗi lần băm dùng salt riêng, nên hai người cùng mật khẩu vẫn khác hash."""
    assert hash_password("matkhau123") != hash_password("matkhau123")


def test_verify_accepts_correct_and_rejects_wrong() -> None:
    hashed = hash_password("matkhau123")
    assert verify_password("matkhau123", hashed)
    assert not verify_password("matkhau124", hashed)
    assert not verify_password("", hashed)


def test_verify_survives_corrupted_hash() -> None:
    """Hash hỏng phải trả về False, không được ném lỗi làm sập request đăng nhập."""
    assert not verify_password("matkhau123", "khong-phai-hash-bcrypt")


def test_unicode_password_round_trip() -> None:
    password = "MậtKhẩuTiếngViệt2024"
    assert verify_password(password, hash_password(password))


def test_password_over_bcrypt_limit_is_rejected() -> None:
    """bcrypt cắt lặng lẽ sau 72 byte; phải chặn thay vì để hai mật khẩu dài hoá một."""
    with pytest.raises(PasswordTooLongError):
        hash_password("a" * (MAX_PASSWORD_BYTES + 1))


def test_long_password_never_verifies() -> None:
    hashed = hash_password("a" * MAX_PASSWORD_BYTES)
    assert not verify_password("a" * (MAX_PASSWORD_BYTES + 10), hashed)


def test_session_tokens_are_unique_and_long() -> None:
    tokens = {generate_session_token() for _ in range(200)}
    assert len(tokens) == 200
    assert all(len(token) >= 32 for token in tokens)


def test_token_hash_is_stable_sha256() -> None:
    token = "abc123"
    assert hash_token(token) == hash_token(token)
    assert len(hash_token(token)) == 64
    assert hash_token(token) != hash_token("abc124")


# --- Cấp bậc vai trò ---------------------------------------------------------


@pytest.mark.parametrize(
    "role,required,expected",
    [
        (Role.ADMIN, Role.ADMIN, True),
        (Role.ADMIN, Role.MANAGER, True),
        (Role.ADMIN, Role.USER, True),
        (Role.MANAGER, Role.ADMIN, False),
        (Role.MANAGER, Role.MANAGER, True),
        (Role.MANAGER, Role.USER, True),
        (Role.USER, Role.ADMIN, False),
        (Role.USER, Role.MANAGER, False),
        (Role.USER, Role.USER, True),
    ],
)
def test_role_hierarchy(role: Role, required: Role, expected: bool) -> None:
    assert role.can_act_as(required) is expected


def test_role_parses_from_database_string() -> None:
    assert Role("manager") is Role.MANAGER
    with pytest.raises(ValueError):
        Role("superadmin")
