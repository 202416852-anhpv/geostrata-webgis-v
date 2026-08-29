"""Mô hình ORM ánh xạ tới lược đồ trong db/init/02_schema.sql.

Cột ``boreholes.geom`` (kiểu geography của PostGIS) cố tình KHÔNG ánh xạ:
trigger trong CSDL đã đồng bộ nó từ lat/lng, còn truy vấn không gian dùng
SQL thuần trong ``repository.py`` để tận dụng chỉ mục GiST.
"""

from __future__ import annotations

import datetime as dt
import enum
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Các cột thời gian đều có DEFAULT now() trong lược đồ. Phải khai báo lại
# server_default ở ORM, nếu không SQLAlchemy sẽ đưa cột vào câu INSERT với giá
# trị NULL và vi phạm ràng buộc NOT NULL thay vì để PostgreSQL tự điền.
_NOW = func.now()


class Role(str, enum.Enum):
    """Vai trò, xếp theo mức quyền tăng dần."""

    USER = "user"
    MANAGER = "manager"
    ADMIN = "admin"

    @property
    def level(self) -> int:
        return _ROLE_LEVELS[self]

    def can_act_as(self, required: Role) -> bool:
        return self.level >= required.level


_ROLE_LEVELS: dict[Role, int] = {Role.USER: 1, Role.MANAGER: 2, Role.ADMIN: 3}


class LocationKind(str, enum.Enum):
    """Mức độ xác định vị trí của một hố khoan."""

    POINT = "point"
    """Biết toạ độ chính xác."""

    PROJECT_AREA = "project_area"
    """Chỉ biết thuộc công trình nào, chưa rõ vị trí hố khoan."""


class Project(Base):
    """Công trình khảo sát.

    Cột ``boundary`` (geography Polygon) không ánh xạ ở đây: trigger trong CSDL
    tự dựng nó từ ``project_vertices``, còn diện tích / chu vi lấy bằng SQL thuần
    trong repository.
    """

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String, unique=True)
    name: Mapped[str] = mapped_column(Text)
    location_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    built_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    scale_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=_NOW)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=_NOW)
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # passive_deletes=True: nhường việc xoá con cho ON DELETE CASCADE của CSDL.
    # Mặc định SQLAlchemy sẽ UPDATE boreholes SET project_id = NULL, mà hố khoan
    # location_kind='project_area' bắt buộc phải có công trình nên CHECK sẽ chặn
    # và toàn bộ lệnh xoá công trình thất bại.
    boreholes: Mapped[list[Borehole]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    vertices: Mapped[list[ProjectVertex]] = relationship(
        back_populates="project",
        order_by="ProjectVertex.ordinal",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class ProjectVertex(Base):
    """Một đỉnh của ranh giới công trình. Nối theo ordinal rồi khép về điểm đầu."""

    __tablename__ = "project_vertices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    ordinal: Mapped[int] = mapped_column(Integer)
    lat: Mapped[float] = mapped_column()
    lng: Mapped[float] = mapped_column()

    project: Mapped[Project] = relationship(back_populates="vertices")


class SoilType(Base):
    __tablename__ = "soil_types"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String, unique=True)
    name: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text)
    color: Mapped[str] = mapped_column(String(7))
    pattern: Mapped[str] = mapped_column(String)
    is_fill: Mapped[bool] = mapped_column(Boolean, default=False)
    strata_order: Mapped[int] = mapped_column(Integer)


class Borehole(Base):
    __tablename__ = "boreholes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # NULL = hố khoan đơn lẻ, không thuộc công trình nào.
    project_id: Mapped[int | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True
    )
    code: Mapped[str] = mapped_column(String)
    name: Mapped[str] = mapped_column(Text)
    # NULL khi location_kind = 'project_area' (chỉ biết công trình, chưa rõ vị trí).
    lat: Mapped[float | None] = mapped_column(nullable=True)
    lng: Mapped[float | None] = mapped_column(nullable=True)
    location_kind: Mapped[str] = mapped_column(String, default=LocationKind.POINT.value)
    drilling_company: Mapped[str | None] = mapped_column(Text, nullable=True)
    depth_m: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    ground_level_m: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    water_level_m: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    drilled_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=_NOW)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=_NOW)
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    project: Mapped[Project | None] = relationship(back_populates="boreholes")
    author: Mapped[User | None] = relationship(foreign_keys=[created_by], lazy="joined")
    layers: Mapped[list[BoreholeLayer]] = relationship(
        back_populates="borehole",
        order_by="BoreholeLayer.ordinal",
        cascade="all, delete-orphan",
    )


class BoreholeLayer(Base):
    __tablename__ = "borehole_layers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    borehole_id: Mapped[int] = mapped_column(ForeignKey("boreholes.id", ondelete="CASCADE"))
    soil_type_id: Mapped[int] = mapped_column(ForeignKey("soil_types.id"))
    layer_code: Mapped[str] = mapped_column(String)
    ordinal: Mapped[int] = mapped_column(Integer)
    top_depth_m: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    bottom_depth_m: Mapped[Decimal] = mapped_column(Numeric(6, 2))

    borehole: Mapped[Borehole] = relationship(back_populates="layers")
    soil_type: Mapped[SoilType] = relationship(lazy="joined")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String, unique=True)
    full_name: Mapped[str] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(String, nullable=True)
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String, default=Role.USER.value)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    phone: Mapped[str | None] = mapped_column(Text, nullable=True)
    job_title: Mapped[str | None] = mapped_column(Text, nullable=True)
    organization: Mapped[str | None] = mapped_column(Text, nullable=True)
    # deferred: ảnh chỉ được nạp khi thật sự đọc tới. Không có nó thì mỗi lần
    # liệt kê tài khoản sẽ kéo toàn bộ ảnh của mọi người vào bộ nhớ.
    avatar: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, deferred=True)
    avatar_mime: Mapped[str | None] = mapped_column(Text, nullable=True)
    avatar_updated_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Giá trị tổng hợp từ coin_transactions; CSDL có CHECK không cho âm.
    coin_balance: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=_NOW)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=_NOW)
    last_login_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    sessions: Mapped[list[Session]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    @property
    def role_enum(self) -> Role:
        return Role(self.role)

    def can_act_as(self, required: Role) -> bool:
        return self.role_enum.can_act_as(required)

    @property
    def has_avatar(self) -> bool:
        """Kiểm tra qua avatar_mime để không phải nạp cả ảnh chỉ để biết có hay không."""
        return self.avatar_mime is not None


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=_NOW)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped[User] = relationship(back_populates="sessions", lazy="joined")


class CoinPackage(Base):
    """Gói xu rao bán."""

    __tablename__ = "coin_packages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String, unique=True)
    name: Mapped[str] = mapped_column(Text)
    coins: Mapped[int] = mapped_column(Integer)
    bonus_coins: Mapped[int] = mapped_column(Integer, default=0)
    price_vnd: Mapped[int] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=_NOW)

    @property
    def total_coins(self) -> int:
        return self.coins + self.bonus_coins


class PaymentOrder(Base):
    """Đơn nạp xu. Giữ lại cả khi tài khoản đã bị xoá, nên user_id cho phép NULL."""

    __tablename__ = "payment_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reference: Mapped[str] = mapped_column(String, unique=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    username_snapshot: Mapped[str] = mapped_column(Text)
    package_id: Mapped[int | None] = mapped_column(
        ForeignKey("coin_packages.id", ondelete="SET NULL"), nullable=True
    )
    coins: Mapped[int] = mapped_column(Integer)
    amount_vnd: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String, default="pending")
    provider: Mapped[str] = mapped_column(String, default="manual")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=_NOW)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=_NOW)
    expires_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    confirmed_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    package: Mapped[CoinPackage | None] = relationship(lazy="joined")


class CoinTransaction(Base):
    """Một dòng sổ cái. Chỉ ghi thêm, không sửa và không xoá."""

    __tablename__ = "coin_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    amount: Mapped[int] = mapped_column(Integer)
    balance_after: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String)
    order_id: Mapped[int | None] = mapped_column(
        ForeignKey("payment_orders.id", ondelete="SET NULL"), nullable=True
    )
    borehole_id: Mapped[int | None] = mapped_column(
        ForeignKey("boreholes.id", ondelete="SET NULL"), nullable=True
    )
    description: Mapped[str] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=_NOW)


class BoreholeUnlock(Base):
    """Quyền xem một hố khoan đã mua — vĩnh viễn, không hết hạn."""

    __tablename__ = "borehole_unlocks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    borehole_id: Mapped[int] = mapped_column(ForeignKey("boreholes.id", ondelete="CASCADE"))
    coins_spent: Mapped[int] = mapped_column(Integer)
    transaction_id: Mapped[int | None] = mapped_column(
        ForeignKey("coin_transactions.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=_NOW)

    borehole: Mapped[Borehole] = relationship(lazy="joined")
