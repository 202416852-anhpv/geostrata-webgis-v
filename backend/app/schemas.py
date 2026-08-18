"""Pydantic schema — hợp đồng dữ liệu công khai của API.

Đây là ranh giới giữa backend và frontend: đổi tên cột trong CSDL không làm vỡ
frontend chừng nào các schema dưới đây giữ nguyên.
"""

from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

LayerPattern = Literal["hatch", "crosshatch", "dots", "gravel", "sand", "dense"]
RoleName = Literal["admin", "manager", "user"]

# Sai số cho phép khi so khớp chiều sâu (cm). Ranh giới lưu numeric(6,2).
DEPTH_TOLERANCE_M = 0.01


class SoilTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    name: str
    description: str
    color: str
    pattern: LayerPattern
    is_fill: bool
    strata_order: int


LocationKindName = Literal["point", "project_area"]


class VertexIn(BaseModel):
    """Một đỉnh ranh giới công trình."""

    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class VertexOut(VertexIn):
    model_config = ConfigDict(from_attributes=True)

    ordinal: int


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    location_label: str | None = None
    built_year: int | None = None
    scale_description: str | None = None
    vertices: list[VertexOut] = Field(default_factory=list)
    has_boundary: bool = Field(
        default=False, description="true khi đủ từ 3 đỉnh trở lên và đường bao không tự cắt"
    )
    area_m2: float | None = Field(default=None, description="Diện tích ranh giới, do PostGIS tính")
    perimeter_m: float | None = None
    borehole_count: int = 0


class ProjectWriteBase(BaseModel):
    """Mọi trường hồ sơ công trình đều không bắt buộc, trừ tên."""

    name: str = Field(min_length=1, max_length=300)
    location_label: str | None = Field(default=None, max_length=300)
    built_year: int | None = Field(default=None, ge=1800, le=2200)
    scale_description: str | None = Field(default=None, max_length=1000)
    vertices: list[VertexIn] = Field(
        default_factory=list,
        description="Toạ độ ranh giới theo thứ tự điểm 1 → điểm n. Cần từ 3 điểm mới dựng được đa giác.",
    )

    @model_validator(mode="after")
    def validate_vertices(self) -> ProjectWriteBase:
        count = len(self.vertices)
        # 1-2 điểm vẫn lưu được (đánh dấu vị trí), chỉ là chưa thành ranh giới.
        if 0 < count < 3:
            return self
        seen = {(round(v.lat, 7), round(v.lng, 7)) for v in self.vertices}
        if count and len(seen) < 3:
            raise ValueError("Ranh giới cần ít nhất 3 điểm khác nhau")
        return self


class ProjectCreateIn(ProjectWriteBase):
    code: str = Field(
        min_length=1, max_length=32, pattern=r"^[A-Za-z0-9._-]+$", description="Mã công trình, duy nhất"
    )


class ProjectUpdateIn(ProjectWriteBase):
    """Thay thế toàn bộ hồ sơ công trình, gồm cả danh sách đỉnh ranh giới."""


class BoreholeOut(BaseModel):
    """Một lỗ khoan kèm khoảng cách tới điểm tìm kiếm (nếu có)."""

    id: int
    code: str
    name: str
    lat: float | None = Field(default=None, description="null khi location_kind = project_area")
    lng: float | None = None
    location_kind: LocationKindName = "point"
    depth_m: float
    ground_level_m: float | None = None
    water_level_m: float | None = None
    drilling_company: str | None = None
    drilled_on: dt.date | None = None
    project_code: str | None = Field(default=None, description="null khi là hố khoan đơn lẻ")
    project_name: str | None = None
    distance_m: float | None = Field(
        default=None, description="Khoảng cách tới toạ độ tìm kiếm, mét. null khi truy vấn trực tiếp theo id."
    )
    created_by_username: str | None = Field(
        default=None,
        description="Người nhập lỗ khoan; null nếu do seeder sinh. Chỉ có ở endpoint chi tiết và mặt cắt.",
    )


class GeoLayerOut(BaseModel):
    """Một lớp địa tầng trong mặt cắt."""

    layer_code: str
    ordinal: int
    top_depth_m: float
    bottom_depth_m: float
    thickness_m: float
    soil_code: str
    name: str
    description: str
    color: str
    pattern: LayerPattern


class BoreholeSectionOut(BaseModel):
    """Toàn bộ dữ liệu cần để vẽ một bản mặt cắt địa chất."""

    borehole: BoreholeOut
    project: ProjectOut | None = Field(default=None, description="null khi là hố khoan đơn lẻ")
    layers: list[GeoLayerOut]
    max_depth_m: float


class BoreholeSearchOut(BaseModel):
    lat: float
    lng: float
    radius_m: float
    count: int
    boreholes: list[BoreholeOut]


# --- Xác thực và tài khoản ---------------------------------------------------


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=64)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    full_name: str
    email: str | None = None
    phone: str | None = None
    job_title: str | None = None
    organization: str | None = None
    role: RoleName
    is_active: bool
    has_avatar: bool = Field(
        default=False, description="Ảnh lấy qua GET /api/users/{id}/avatar, không nhúng vào JSON"
    )
    avatar_updated_at: dt.datetime | None = Field(
        default=None, description="Dùng làm khoá cache khi tải lại ảnh"
    )
    created_at: dt.datetime
    last_login_at: dt.datetime | None = None


class LoginOut(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_at: dt.datetime
    user: UserOut


USERNAME_PATTERN = r"^[a-zA-Z0-9._-]+$"
# Giới hạn 64 ký tự để mọi mật khẩu UTF-8 đều nằm dưới mốc 72 byte của bcrypt.
PASSWORD_FIELD = Field(min_length=8, max_length=64)


class ProfileFields(BaseModel):
    """Thông tin liên hệ, dùng chung cho đăng ký, tạo tài khoản và sửa hồ sơ."""

    email: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=32)
    job_title: str | None = Field(default=None, max_length=128)
    organization: str | None = Field(default=None, max_length=200)

    @field_validator("email")
    @classmethod
    def normalise_email(cls, value: str | None) -> str | None:
        """Chuẩn hoá về chữ thường, khớp với chỉ mục duy nhất lower(email) trong CSDL."""
        if value is None:
            return None
        cleaned = value.strip().lower()
        if not cleaned:
            return None
        if "@" not in cleaned or cleaned.startswith("@") or cleaned.endswith("@"):
            raise ValueError("Email không hợp lệ")
        return cleaned


class RegisterIn(ProfileFields):
    """Tự đăng ký. Tài khoản mới luôn nhận vai trò "user" — chỉ tra cứu."""

    username: str = Field(min_length=3, max_length=64, pattern=USERNAME_PATTERN)
    full_name: str = Field(min_length=1, max_length=128)
    password: str = PASSWORD_FIELD


class UserCreateIn(ProfileFields):
    """Admin tạo tài khoản, được chọn vai trò ngay."""

    username: str = Field(min_length=3, max_length=64, pattern=USERNAME_PATTERN)
    full_name: str = Field(min_length=1, max_length=128)
    password: str = PASSWORD_FIELD
    role: RoleName = "user"


class UserUpdateIn(BaseModel):
    """Admin cập nhật tài khoản khác; trường nào bỏ trống thì giữ nguyên."""

    full_name: str | None = Field(default=None, min_length=1, max_length=128)
    email: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=32)
    job_title: str | None = Field(default=None, max_length=128)
    organization: str | None = Field(default=None, max_length=200)
    role: RoleName | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=64)


class ProfileUpdateIn(ProfileFields):
    """Người dùng tự sửa hồ sơ của mình — không đụng tới vai trò."""

    full_name: str = Field(min_length=1, max_length=128)


class AvatarOut(BaseModel):
    has_avatar: bool
    avatar_updated_at: dt.datetime | None = None


class RegistrationConfigOut(BaseModel):
    allow_self_registration: bool
    min_password_length: int


class PasswordChangeIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=64)
    new_password: str = Field(min_length=8, max_length=64)


# --- Ghi dữ liệu lỗ khoan ----------------------------------------------------


class LayerIn(BaseModel):
    soil_code: str = Field(min_length=1, description="Mã loại đất trong bảng soil_types")
    top_depth_m: float = Field(ge=0)
    bottom_depth_m: float = Field(gt=0)
    layer_code: str | None = Field(
        default=None,
        max_length=8,
        description='Bỏ trống để hệ thống tự đánh: "k" cho đất đắp, còn lại 1, 2, 3...',
    )


class BoreholeWriteBase(BaseModel):
    name: str | None = Field(default=None, max_length=64)
    # Bỏ trống lat/lng khi chỉ biết hố khoan thuộc công trình nào.
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    location_kind: LocationKindName = "point"
    depth_m: float = Field(gt=0, le=9999)
    ground_level_m: float | None = None
    water_level_m: float | None = Field(default=None, ge=0)
    drilling_company: str | None = Field(default=None, max_length=300)
    drilled_on: dt.date | None = None
    layers: list[LayerIn] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_location(self) -> BoreholeWriteBase:
        """Khớp với ràng buộc boreholes_location_consistent trong CSDL."""
        if self.location_kind == "point":
            if self.lat is None or self.lng is None:
                raise ValueError(
                    "Hố khoan có vị trí xác định phải nhập đủ vĩ độ và kinh độ. "
                    'Nếu chưa rõ vị trí, đặt location_kind = "project_area".'
                )
        elif self.lat is not None or self.lng is not None:
            raise ValueError(
                'location_kind = "project_area" nghĩa là chưa rõ vị trí, không nhận toạ độ'
            )
        return self

    @model_validator(mode="after")
    def validate_layers(self) -> BoreholeWriteBase:
        """Địa tầng nhập tay phải liền mạch từ mặt đất tới đáy lỗ khoan.

        Đây chính là bất biến mà bộ sinh dữ liệu đã bảo đảm; nhập tay cũng không
        được phá, nếu không bản vẽ mặt cắt sẽ hở hoặc chồng lớp.
        """
        if not self.layers:
            return self  # cho phép tạo lỗ khoan trước, nhập địa tầng sau

        ordered = sorted(self.layers, key=lambda layer: layer.top_depth_m)
        if abs(ordered[0].top_depth_m) > DEPTH_TOLERANCE_M:
            raise ValueError("Lớp đầu tiên phải bắt đầu từ độ sâu 0 m")

        for layer in ordered:
            if layer.bottom_depth_m <= layer.top_depth_m:
                raise ValueError(
                    f"Lớp {layer.top_depth_m}-{layer.bottom_depth_m} m có đáy không sâu hơn đỉnh"
                )

        for previous, following in zip(ordered, ordered[1:], strict=False):
            if abs(previous.bottom_depth_m - following.top_depth_m) > DEPTH_TOLERANCE_M:
                raise ValueError(
                    f"Địa tầng hở hoặc chồng lớp tại {previous.bottom_depth_m} m "
                    f"và {following.top_depth_m} m"
                )

        if abs(ordered[-1].bottom_depth_m - self.depth_m) > DEPTH_TOLERANCE_M:
            raise ValueError(
                f"Lớp cuối kết thúc ở {ordered[-1].bottom_depth_m} m "
                f"nhưng lỗ khoan sâu {self.depth_m} m"
            )

        self.layers = ordered
        return self


class BoreholeCreateIn(BoreholeWriteBase):
    code: str = Field(min_length=1, max_length=32, description="Mã hố khoan, duy nhất trong công trình")
    project_code: str | None = Field(
        default=None, description="Bỏ trống để tạo hố khoan đơn lẻ, không thuộc công trình nào"
    )

    @model_validator(mode="after")
    def validate_project_required(self) -> BoreholeCreateIn:
        if self.location_kind == "project_area" and not self.project_code:
            raise ValueError('Hố khoan chưa rõ vị trí phải gắn với một công trình (thiếu project_code)')
        return self


class BoreholeUpdateIn(BoreholeWriteBase):
    """Thay thế toàn bộ thông tin hố khoan, gồm cả danh sách lớp."""


class BoreholeInProjectIn(BoreholeWriteBase):
    """Hố khoan nằm trong khối tạo hàng loạt — công trình lấy từ khối bao ngoài."""

    code: str = Field(min_length=1, max_length=32)


class BoreholeBulkCreateIn(BaseModel):
    """Tạo nhiều hố khoan trong một lần, kèm khả năng tạo luôn công trình.

    Ba cách dùng:

    * ``project`` = null  → các hố khoan đơn lẻ, không thuộc công trình nào.
    * ``project_code``    → gắn vào công trình đã có.
    * ``project``         → tạo công trình mới rồi gắn toàn bộ hố khoan vào đó.
    """

    project: ProjectCreateIn | None = None
    project_code: str | None = Field(default=None, description="Dùng khi công trình đã tồn tại")
    boreholes: list[BoreholeInProjectIn] = Field(default_factory=list, max_length=500)

    @model_validator(mode="after")
    def validate_target(self) -> BoreholeBulkCreateIn:
        if self.project is not None and self.project_code:
            raise ValueError("Chỉ được chọn một trong hai: tạo công trình mới hoặc dùng project_code có sẵn")
        if not self.boreholes and self.project is None:
            raise ValueError("Cần ít nhất một hố khoan, hoặc một công trình để tạo")

        target = self.project is not None or bool(self.project_code)
        unlocated = [b.code for b in self.boreholes if b.location_kind == "project_area"]
        if unlocated and not target:
            raise ValueError(
                f"Hố khoan chưa rõ vị trí phải thuộc một công trình: {', '.join(unlocated)}"
            )

        duplicates = sorted({c for c in (b.code for b in self.boreholes) if
                             [x.code for x in self.boreholes].count(c) > 1})
        if duplicates:
            raise ValueError(f"Mã hố khoan bị trùng trong danh sách: {', '.join(duplicates)}")
        return self


class BulkCreateOut(BaseModel):
    project: ProjectOut | None = None
    created_count: int
    boreholes: list[BoreholeOut]


class ClientConfigOut(BaseModel):
    """Tham số nghiệp vụ frontend đọc lúc khởi động — tránh hard-code hai nơi."""

    default_search_radius_m: float
    min_search_radius_m: float
    max_search_radius_m: float
    max_results: int
    allow_self_registration: bool = True
    max_avatar_bytes: int = 512_000


class HealthOut(BaseModel):
    status: Literal["ok", "degraded"]
    database: Literal["up", "down"]
    borehole_count: int | None = None


class ErrorOut(BaseModel):
    detail: str
