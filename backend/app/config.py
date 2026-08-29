"""Cấu hình ứng dụng, đọc từ biến môi trường (12-factor)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Kết nối CSDL --------------------------------------------------------
    database_url: str = Field(
        default="postgresql+psycopg2://geostrata:geostrata@localhost:5432/geostrata",
        description="DSN SQLAlchemy tới PostgreSQL/PostGIS",
    )
    db_pool_size: int = 5
    db_max_overflow: int = 10
    db_echo: bool = False

    # --- Tham số nghiệp vụ ---------------------------------------------------
    # Nguồn duy nhất cho bán kính mặc định. Frontend đọc lại qua /api/config,
    # nên không còn tình trạng hard-code hai nơi lệch nhau.
    default_search_radius_m: float = 150.0
    min_search_radius_m: float = 10.0
    max_search_radius_m: float = 5000.0
    max_results: int = 500

    # --- HTTP ----------------------------------------------------------------
    # Khai báo kiểu str, KHÔNG phải list[str]: với field kiểu phức hợp,
    # pydantic-settings chạy json.loads() lên giá trị biến môi trường trước cả
    # validator "before", nên chuỗi "a,b" sẽ ném JSONDecodeError ngay lúc khởi động.
    # Tách chuỗi ở cors_origin_list bên dưới.
    cors_origins: str = Field(
        default="http://localhost:5173,http://localhost:8080",
        description="Danh sách origin được phép, phân tách bằng dấu phẩy",
    )
    api_prefix: str = "/api"

    # --- Xác thực ------------------------------------------------------------
    session_ttl_hours: int = 12
    # Tài khoản tự đăng ký luôn nhận vai trò "user" (chỉ tra cứu); admin nâng
    # quyền sau. Đặt false nếu chỉ cho admin tạo tài khoản.
    allow_self_registration: bool = True
    max_avatar_bytes: int = 512_000
    # Chỉ dùng khi CSDL chưa có tài khoản nào — xem app/seed/__main__.py.
    bootstrap_admin_username: str = "admin"
    bootstrap_admin_password: str = "admin123"

    # --- Tra cứu địa điểm ----------------------------------------------------
    geocode_enabled: bool = True
    nominatim_url: str = "https://nominatim.openstreetmap.org"
    # Nominatim yêu cầu mỗi ứng dụng tự khai báo để nhận diện; đổi thành thông
    # tin liên hệ thật nếu chạy ngoài môi trường local.
    geocode_user_agent: str = (
        "GeoStrataWebGIS/1.0 (khao sat dia chat; lien he: admin@geostrata.local)"
    )
    # Giới hạn kết quả trong Việt Nam. Để trống nếu cần tra cứu toàn cầu.
    geocode_country_codes: str = "vn"
    geocode_timeout_s: float = 6.0
    # Chính sách của Nominatim: tối đa 1 yêu cầu mỗi giây.
    geocode_min_interval_s: float = 1.0

    # --- Ví xu và thanh toán -------------------------------------------------
    coins_enabled: bool = True
    # Giá mở khoá một hố khoan. Đặt 0 để mở miễn phí cho mọi người.
    borehole_unlock_cost: int = 10
    # Người dùng mới được tặng xu để dùng thử trước khi phải nạp.
    signup_bonus_coins: int = 20
    payment_order_ttl_hours: int = 48
    # Thông tin chuyển khoản hiện cho người dùng khi tạo đơn.
    bank_name: str = "Ngân hàng TMCP Ngoại thương Việt Nam (Vietcombank)"
    bank_account_number: str = "0123456789"
    bank_account_name: str = "CONG TY GEOSTRATA"

    # --- Seed / migration ----------------------------------------------------
    data_dir: Path = Path("/app/data")
    migrations_dir: Path = Path("/app/db/migrations")

    @property
    def cors_origin_list(self) -> list[str]:
        """Tách "a, b, c" thành danh sách, bỏ qua phần tử rỗng."""
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
