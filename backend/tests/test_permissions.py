"""Chốt ma trận phân quyền của API.

Chạy được mà không cần CSDL: thay `get_db` bằng session giả và `get_current_user`
bằng tài khoản dựng sẵn, nên chỉ còn đúng phần kiểm tra quyền được thử.
"""

from __future__ import annotations

from collections.abc import Iterator
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.database import get_db
from app.main import app
from app.models import User

ANY_TOKEN = {"Authorization": "Bearer token-gia-lap"}

VALID_BOREHOLE = {
    "project_code": "TTDH-CN",
    "code": "HK-TEST",
    "lat": 10.7769,
    "lng": 106.6953,
    "depth_m": 20.0,
    "layers": [],
}


def make_user(role: str) -> User:
    return User(id=1, username=f"{role}_test", full_name="Người kiểm thử", role=role, is_active=True)


@pytest.fixture
def client() -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: MagicMock()
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def as_role(role: str) -> None:
    app.dependency_overrides[get_current_user] = lambda: make_user(role)


def call(client: TestClient, method: str, path: str, *, authenticated: bool = True):
    """Gọi API; chỉ đính kèm body cho các method có body (httpx.get không nhận json)."""
    kwargs: dict = {}
    if method in {"post", "put", "patch"}:
        kwargs["json"] = VALID_BOREHOLE
    if authenticated:
        kwargs["headers"] = ANY_TOKEN
    return client.request(method, path, **kwargs)


# --- Chưa đăng nhập ----------------------------------------------------------


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/boreholes?lat=10.7&lng=106.7"),
        ("get", "/api/boreholes/1"),
        ("get", "/api/boreholes/1/section"),
        ("post", "/api/boreholes"),
        ("get", "/api/users"),
        ("post", "/api/users"),
        ("get", "/api/auth/me"),
        ("post", "/api/auth/logout"),
    ],
)
def test_requires_authentication(client: TestClient, method: str, path: str) -> None:
    app.dependency_overrides.pop(get_current_user, None)
    response = call(client, method, path, authenticated=False)
    assert response.status_code == 401, f"{method.upper()} {path} phải chặn người chưa đăng nhập"


def test_public_endpoints_stay_open(client: TestClient) -> None:
    """/config và /health phải gọi được trước khi đăng nhập, để dựng màn login."""
    app.dependency_overrides.pop(get_current_user, None)
    assert client.get("/api/config").status_code == 200


# --- Vai trò user ------------------------------------------------------------


def test_user_cannot_create_borehole(client: TestClient) -> None:
    as_role("user")
    response = client.post("/api/boreholes", json=VALID_BOREHOLE, headers=ANY_TOKEN)
    assert response.status_code == 403
    assert "manager" in response.json()["detail"]


def test_user_cannot_delete_borehole(client: TestClient) -> None:
    as_role("user")
    assert client.delete("/api/boreholes/1", headers=ANY_TOKEN).status_code == 403


@pytest.mark.parametrize("method,path", [("get", "/api/users"), ("post", "/api/users")])
def test_user_cannot_touch_user_management(client: TestClient, method: str, path: str) -> None:
    as_role("user")
    assert call(client, method, path).status_code == 403


# --- Vai trò manager ---------------------------------------------------------


def test_manager_passes_the_write_gate(client: TestClient) -> None:
    """Manager qua được cổng quyền; lỗi sau đó chỉ do session giả, không phải 403."""
    as_role("manager")
    response = client.post("/api/boreholes", json=VALID_BOREHOLE, headers=ANY_TOKEN)
    assert response.status_code not in (401, 403)


def test_manager_cannot_delete_borehole(client: TestClient) -> None:
    """Xoá là thao tác không hồi lại được nên chỉ dành cho admin."""
    as_role("manager")
    response = client.delete("/api/boreholes/1", headers=ANY_TOKEN)
    assert response.status_code == 403
    assert "admin" in response.json()["detail"]


def test_manager_cannot_manage_users(client: TestClient) -> None:
    as_role("manager")
    assert client.get("/api/users", headers=ANY_TOKEN).status_code == 403


# --- Vai trò admin -----------------------------------------------------------


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/users"),
        ("post", "/api/boreholes"),
        ("delete", "/api/boreholes/1"),
        ("get", "/api/boreholes/1"),
    ],
)
def test_admin_passes_every_gate(client: TestClient, method: str, path: str) -> None:
    as_role("admin")
    response = call(client, method, path)
    assert response.status_code not in (401, 403), f"admin không được bị chặn ở {path}"


# --- Kiểm tra dữ liệu vẫn chạy trước khi chạm CSDL ---------------------------


def test_invalid_payload_rejected_before_reaching_database(client: TestClient) -> None:
    as_role("manager")
    broken = VALID_BOREHOLE | {
        "depth_m": 20.0,
        "layers": [{"soil_code": "fill", "top_depth_m": 0, "bottom_depth_m": 5}],
    }
    response = client.post("/api/boreholes", json=broken, headers=ANY_TOKEN)
    assert response.status_code == 422, "địa tầng không phủ hết chiều sâu phải bị chặn"
