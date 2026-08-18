"""Kiểm thử đọc cấu hình từ biến môi trường.

Các test này dựng lại đúng điều kiện lúc chạy trong Docker: biến môi trường ĐƯỢC
set thật. Bộ test trước đó không bắt được lỗi vì chạy với môi trường trống, nên
chỉ toàn dùng giá trị mặc định.
"""

from __future__ import annotations

import pytest

from app.config import Settings


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Bỏ mọi biến môi trường và .env để mỗi test tự kiểm soát đầu vào."""
    for name in (
        "CORS_ORIGINS",
        "DATABASE_URL",
        "DEFAULT_SEARCH_RADIUS_M",
        "SESSION_TTL_HOURS",
        "DATA_DIR",
        "MIGRATIONS_DIR",
    ):
        monkeypatch.delenv(name, raising=False)


def test_cors_origins_from_comma_separated_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Lỗi thật: pydantic-settings json.loads() giá trị env của field list[str]
    trước cả validator, nên chuỗi "a,b" làm container chết ngay lúc khởi động."""
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:8080,http://localhost:5173")
    settings = Settings(_env_file=None)  # type: ignore[call-arg]
    assert settings.cors_origin_list == ["http://localhost:8080", "http://localhost:5173"]


def test_cors_origins_tolerates_spaces_and_trailing_comma(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", " http://a.local , http://b.local ,")
    settings = Settings(_env_file=None)  # type: ignore[call-arg]
    assert settings.cors_origin_list == ["http://a.local", "http://b.local"]


def test_cors_origins_single_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:8080")
    settings = Settings(_env_file=None)  # type: ignore[call-arg]
    assert settings.cors_origin_list == ["http://localhost:8080"]


def test_cors_origins_default_when_unset() -> None:
    settings = Settings(_env_file=None)  # type: ignore[call-arg]
    assert settings.cors_origin_list == ["http://localhost:5173", "http://localhost:8080"]


def test_cors_origins_empty_string_yields_empty_list(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "")
    settings = Settings(_env_file=None)  # type: ignore[call-arg]
    assert settings.cors_origin_list == []


def test_every_env_var_used_by_docker_compose_parses(monkeypatch: pytest.MonkeyPatch) -> None:
    """Chốt toàn bộ biến mà docker-compose.yml truyền vào backend đều đọc được."""
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg2://u:p@db:5432/geostrata")
    monkeypatch.setenv("DEFAULT_SEARCH_RADIUS_M", "150")
    monkeypatch.setenv("MAX_SEARCH_RADIUS_M", "5000")
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:8080,http://localhost:5173")
    monkeypatch.setenv("DATA_DIR", "/app/data")
    monkeypatch.setenv("MIGRATIONS_DIR", "/app/db/migrations")
    monkeypatch.setenv("SESSION_TTL_HOURS", "12")

    settings = Settings(_env_file=None)  # type: ignore[call-arg]

    assert settings.database_url.endswith("/geostrata")
    assert settings.default_search_radius_m == 150.0
    assert settings.max_search_radius_m == 5000.0
    assert settings.session_ttl_hours == 12
    assert str(settings.data_dir).replace("\\", "/") == "/app/data"
    assert str(settings.migrations_dir).replace("\\", "/") == "/app/db/migrations"
    assert len(settings.cors_origin_list) == 2
