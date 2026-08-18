"""Kiểm thử quy tắc đăng ký và hồ sơ người dùng."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas import ProfileUpdateIn, RegisterIn, UserCreateIn


def registration(**overrides) -> dict:
    return {
        "username": "nguyenvana",
        "full_name": "Nguyễn Văn A",
        "password": "matkhau123",
    } | overrides


def test_minimal_registration() -> None:
    payload = RegisterIn(**registration())
    assert payload.email is None
    assert payload.organization is None


def test_registration_has_no_role_field() -> None:
    """Vai trò do backend gán cứng là "user"; client không được tự chọn."""
    assert "role" not in RegisterIn.model_fields


def test_extra_role_in_body_is_ignored() -> None:
    payload = RegisterIn(**registration(role="admin"))  # type: ignore[arg-type]
    assert not hasattr(payload, "role")


@pytest.mark.parametrize("username", ["ab", "có dấu", "tên có cách", "a@b", ""])
def test_rejects_invalid_username(username: str) -> None:
    with pytest.raises(ValidationError):
        RegisterIn(**registration(username=username))


@pytest.mark.parametrize("username", ["abc", "nguyen.van_a", "user-01", "A1b"])
def test_accepts_valid_username(username: str) -> None:
    assert RegisterIn(**registration(username=username)).username == username


@pytest.mark.parametrize("password", ["", "ngan", "1234567"])
def test_rejects_short_password(password: str) -> None:
    with pytest.raises(ValidationError):
        RegisterIn(**registration(password=password))


def test_rejects_password_beyond_bcrypt_limit() -> None:
    """Chặn ở schema để không bao giờ chạm tới mốc cắt 72 byte của bcrypt."""
    with pytest.raises(ValidationError):
        RegisterIn(**registration(password="a" * 65))


# --- Chuẩn hoá email ---------------------------------------------------------


def test_email_is_lowercased() -> None:
    payload = RegisterIn(**registration(email="  Nguyen.VanA@Example.COM  "))
    assert payload.email == "nguyen.vana@example.com"


def test_blank_email_becomes_null() -> None:
    """Chuỗi rỗng phải thành NULL, nếu không nhiều tài khoản sẽ đụng ràng buộc duy nhất."""
    assert RegisterIn(**registration(email="   ")).email is None


@pytest.mark.parametrize("email", ["khongcoa", "@example.com", "a@"])
def test_rejects_malformed_email(email: str) -> None:
    with pytest.raises(ValidationError):
        RegisterIn(**registration(email=email))


# --- Admin tạo tài khoản -----------------------------------------------------


def test_admin_can_set_role() -> None:
    payload = UserCreateIn(**registration(role="manager"))
    assert payload.role == "manager"


def test_admin_create_defaults_to_user_role() -> None:
    assert UserCreateIn(**registration()).role == "user"


@pytest.mark.parametrize("role", ["superadmin", "quanly", ""])
def test_rejects_unknown_role(role: str) -> None:
    with pytest.raises(ValidationError):
        UserCreateIn(**registration(role=role))


# --- Tự sửa hồ sơ ------------------------------------------------------------


def test_profile_update_cannot_change_role_or_active() -> None:
    """Hồ sơ cá nhân không có trường vai trò — người dùng không thể tự nâng quyền."""
    assert "role" not in ProfileUpdateIn.model_fields
    assert "is_active" not in ProfileUpdateIn.model_fields
    assert "password" not in ProfileUpdateIn.model_fields


def test_profile_update_requires_full_name() -> None:
    with pytest.raises(ValidationError):
        ProfileUpdateIn(full_name="")


def test_profile_update_keeps_optional_fields_null() -> None:
    payload = ProfileUpdateIn(full_name="Trần Thị B")
    assert payload.phone is None
    assert payload.job_title is None
