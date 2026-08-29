"""Tầng truy cập dữ liệu — chỗ duy nhất trong backend biết về SQL.

Router chỉ gọi các hàm ở đây, không tự viết truy vấn.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session, joinedload

from app.models import (
    Borehole,
    BoreholeLayer,
    BoreholeUnlock,
    Project,
    ProjectVertex,
    SoilType,
    User,
)
from app.models import Session as UserSession
from app.schemas import (
    BoreholeOut,
    BoreholeSectionOut,
    BoreholeWriteBase,
    GeoLayerOut,
    ProjectCreateIn,
    ProjectOut,
    ProjectUpdateIn,
    SoilTypeOut,
    VertexIn,
    VertexOut,
)
from app.security import generate_session_token, hash_password, hash_token

# Truy vấn không gian: ST_DWithin trên geography dùng được chỉ mục GiST,
# ST_Distance trả về mét nên không cần tự tính haversine nữa.
_SEARCH_SQL = text(
    """
    WITH ref AS (
        SELECT ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography AS g
    )
    SELECT b.id,
           b.code,
           b.name,
           b.lat,
           b.lng,
           b.location_kind,
           b.depth_m,
           b.ground_level_m,
           b.water_level_m,
           b.drilling_company,
           b.drilled_on,
           p.code AS project_code,
           p.name AS project_name,
           ST_Distance(b.geom, ref.g) AS distance_m
    FROM boreholes b
    -- LEFT JOIN chứ không phải JOIN: hố khoan đơn lẻ có project_id NULL,
    -- INNER JOIN sẽ loại sạch chúng khỏi kết quả tìm kiếm.
    LEFT JOIN projects p ON p.id = b.project_id
    CROSS JOIN ref
    WHERE ST_DWithin(b.geom, ref.g, :radius_m)
    ORDER BY distance_m ASC, b.code ASC
    LIMIT :limit
    """
)


def search_boreholes(db: Session, lat: float, lng: float, radius_m: float, limit: int) -> list[BoreholeOut]:
    """Tìm lỗ khoan trong bán kính, sắp xếp theo khoảng cách tăng dần."""
    rows = db.execute(
        _SEARCH_SQL, {"lat": lat, "lng": lng, "radius_m": radius_m, "limit": limit}
    ).mappings()
    return [
        BoreholeOut(
            id=row["id"],
            code=row["code"],
            name=row["name"],
            lat=row["lat"],
            lng=row["lng"],
            location_kind=row["location_kind"],
            depth_m=float(row["depth_m"]),
            ground_level_m=_opt_float(row["ground_level_m"]),
            water_level_m=_opt_float(row["water_level_m"]),
            drilling_company=row["drilling_company"],
            drilled_on=row["drilled_on"],
            project_code=row["project_code"],
            project_name=row["project_name"],
            distance_m=round(float(row["distance_m"]), 1),
        )
        for row in rows
    ]


def get_borehole(db: Session, borehole_id: int) -> Borehole | None:
    stmt = (
        select(Borehole)
        .options(joinedload(Borehole.project), joinedload(Borehole.layers))
        .where(Borehole.id == borehole_id)
    )
    return db.execute(stmt).unique().scalar_one_or_none()


def get_section(db: Session, borehole_id: int) -> BoreholeSectionOut | None:
    """Lấy mặt cắt của đúng lỗ khoan có id này.

    Dữ liệu đọc từ CSDL nên mặt cắt luôn khớp với lỗ khoan hiển thị trên bản đồ
    và trong danh sách — khác hẳn phiên bản cũ sinh lại dữ liệu ở mỗi request.
    """
    borehole = get_borehole(db, borehole_id)
    if borehole is None:
        return None

    layers = [
        GeoLayerOut(
            layer_code=layer.layer_code,
            ordinal=layer.ordinal,
            top_depth_m=float(layer.top_depth_m),
            bottom_depth_m=float(layer.bottom_depth_m),
            thickness_m=round(float(layer.bottom_depth_m) - float(layer.top_depth_m), 2),
            soil_code=layer.soil_type.code,
            name=layer.soil_type.name,
            description=layer.soil_type.description,
            color=layer.soil_type.color,
            pattern=layer.soil_type.pattern,
        )
        for layer in borehole.layers
    ]

    return BoreholeSectionOut(
        borehole=to_borehole_out(borehole),
        # Hố khoan đơn lẻ không có công trình — bản vẽ vẫn dựng được.
        project=to_project_out(db, borehole.project) if borehole.project else None,
        layers=layers,
        max_depth_m=float(borehole.depth_m),
    )


def list_soil_types(db: Session) -> list[SoilTypeOut]:
    stmt = select(SoilType).order_by(SoilType.strata_order)
    return [SoilTypeOut.model_validate(row) for row in db.execute(stmt).scalars()]


def unlocked_borehole_ids(db: Session, user_id: int) -> set[int]:
    """Tập id hố khoan người này đã mua quyền xem."""
    rows = db.execute(
        select(BoreholeUnlock.borehole_id).where(BoreholeUnlock.user_id == user_id)
    ).scalars()
    return set(rows)


def count_boreholes(db: Session) -> int:
    return db.execute(text("SELECT count(*) FROM boreholes")).scalar_one()


def to_borehole_out(borehole: Borehole) -> BoreholeOut:
    return BoreholeOut(
        id=borehole.id,
        code=borehole.code,
        name=borehole.name,
        lat=borehole.lat,
        lng=borehole.lng,
        location_kind=borehole.location_kind,
        depth_m=float(borehole.depth_m),
        ground_level_m=_opt_float(borehole.ground_level_m),
        water_level_m=_opt_float(borehole.water_level_m),
        drilling_company=borehole.drilling_company,
        drilled_on=borehole.drilled_on,
        project_code=borehole.project.code if borehole.project else None,
        project_name=borehole.project.name if borehole.project else None,
        distance_m=None,
        created_by_username=borehole.author.username if borehole.author else None,
    )


# =============================================================================
# Công trình và ranh giới
# =============================================================================

# Diện tích / chu vi tính từ cột boundary do trigger dựng — không lưu trùng lặp.
_PROJECT_METRICS_SQL = text(
    """
    SELECT id,
           (boundary IS NOT NULL) AS has_boundary,
           CASE WHEN boundary IS NOT NULL THEN round(ST_Area(boundary)::numeric, 1) END      AS area_m2,
           CASE WHEN boundary IS NOT NULL THEN round(ST_Perimeter(boundary)::numeric, 1) END AS perimeter_m,
           (SELECT count(*) FROM boreholes b WHERE b.project_id = projects.id)               AS borehole_count
    FROM projects
    WHERE id = ANY(:ids)
    """
)


def _project_metrics(db: Session, project_ids: list[int]) -> dict[int, dict]:
    if not project_ids:
        return {}
    rows = db.execute(_PROJECT_METRICS_SQL, {"ids": project_ids}).mappings()
    return {row["id"]: dict(row) for row in rows}


def to_project_out(db: Session, project: Project) -> ProjectOut:
    metrics = _project_metrics(db, [project.id]).get(project.id, {})
    return _build_project_out(project, metrics)


def _build_project_out(project: Project, metrics: dict) -> ProjectOut:
    return ProjectOut(
        id=project.id,
        code=project.code,
        name=project.name,
        location_label=project.location_label,
        built_year=project.built_year,
        scale_description=project.scale_description,
        vertices=[
            VertexOut(ordinal=v.ordinal, lat=v.lat, lng=v.lng) for v in project.vertices
        ],
        has_boundary=bool(metrics.get("has_boundary", False)),
        area_m2=_opt_float(metrics.get("area_m2")),
        perimeter_m=_opt_float(metrics.get("perimeter_m")),
        borehole_count=int(metrics.get("borehole_count", 0)),
    )


def list_projects(db: Session) -> list[ProjectOut]:
    stmt = select(Project).options(joinedload(Project.vertices)).order_by(Project.code)
    projects = list(db.execute(stmt).unique().scalars())
    metrics = _project_metrics(db, [p.id for p in projects])
    return [_build_project_out(p, metrics.get(p.id, {})) for p in projects]


def get_project(db: Session, project_id: int) -> Project | None:
    stmt = select(Project).options(joinedload(Project.vertices)).where(Project.id == project_id)
    return db.execute(stmt).unique().scalar_one_or_none()


def get_project_by_code(db: Session, code: str) -> Project | None:
    stmt = select(Project).options(joinedload(Project.vertices)).where(Project.code == code)
    return db.execute(stmt).unique().scalar_one_or_none()


def _apply_vertices(db: Session, project: Project, vertices: list[VertexIn]) -> None:
    """Thay toàn bộ đỉnh ranh giới; trigger trong CSDL sẽ dựng lại đa giác.

    Phải xoá đỉnh cũ và flush TRƯỚC khi chèn đỉnh mới. SQLAlchemy gom lệnh theo
    loại thao tác và chạy INSERT trước DELETE, nên nếu không tách ra thì bộ đỉnh
    mới sẽ đụng UNIQUE(project_id, ordinal) với bộ cũ chưa kịp xoá.
    """
    if project.vertices:
        project.vertices.clear()
        db.flush()

    project.vertices = [
        ProjectVertex(ordinal=index, lat=vertex.lat, lng=vertex.lng)
        for index, vertex in enumerate(vertices, start=1)
    ]


def create_project(db: Session, payload: ProjectCreateIn, actor: User) -> Project:
    project = Project(
        code=payload.code,
        name=payload.name,
        location_label=payload.location_label,
        built_year=payload.built_year,
        scale_description=payload.scale_description,
        created_by=actor.id,
        updated_by=actor.id,
    )
    _apply_vertices(db, project, payload.vertices)
    db.add(project)
    db.flush()
    return project


def update_project(db: Session, project: Project, payload: ProjectUpdateIn, actor: User) -> Project:
    project.name = payload.name
    project.location_label = payload.location_label
    project.built_year = payload.built_year
    project.scale_description = payload.scale_description
    project.updated_at = dt.datetime.now(dt.timezone.utc)
    project.updated_by = actor.id
    _apply_vertices(db, project, payload.vertices)
    db.flush()
    return project


def delete_project(db: Session, project: Project) -> None:
    """Xoá công trình kéo theo hố khoan bên trong (ON DELETE CASCADE)."""
    db.delete(project)
    db.flush()


def list_project_boreholes(db: Session, project_id: int) -> list[BoreholeOut]:
    stmt = (
        select(Borehole)
        .options(joinedload(Borehole.project))
        .where(Borehole.project_id == project_id)
        .order_by(Borehole.code)
    )
    return [to_borehole_out(b) for b in db.execute(stmt).unique().scalars()]


# =============================================================================
# Tài khoản và phiên đăng nhập
# =============================================================================


def get_user_by_username(db: Session, username: str) -> User | None:
    return db.execute(select(User).where(User.username == username)).scalar_one_or_none()


def get_user(db: Session, user_id: int) -> User | None:
    return db.get(User, user_id)


def list_users(db: Session) -> list[User]:
    return list(db.execute(select(User).order_by(User.username)).scalars())


def count_users(db: Session) -> int:
    return db.execute(select(func.count()).select_from(User)).scalar_one()


def count_admins(db: Session, exclude_user_id: int | None = None) -> int:
    """Đếm admin đang hoạt động — dùng để chặn việc xoá mất admin cuối cùng."""
    stmt = select(func.count()).select_from(User).where(User.role == "admin", User.is_active.is_(True))
    if exclude_user_id is not None:
        stmt = stmt.where(User.id != exclude_user_id)
    return db.execute(stmt).scalar_one()


def get_user_by_email(db: Session, email: str) -> User | None:
    """So khớp không phân biệt hoa thường, khớp với chỉ mục lower(email)."""
    return db.execute(select(User).where(func.lower(User.email) == email.lower())).scalar_one_or_none()


def create_user(
    db: Session,
    *,
    username: str,
    full_name: str,
    password: str,
    role: str,
    email: str | None = None,
    phone: str | None = None,
    job_title: str | None = None,
    organization: str | None = None,
) -> User:
    now = dt.datetime.now(dt.timezone.utc)
    user = User(
        username=username,
        full_name=full_name,
        email=email,
        phone=phone,
        job_title=job_title,
        organization=organization,
        password_hash=hash_password(password),
        role=role,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    db.add(user)
    db.flush()
    return user


def set_avatar(db: Session, user: User, data: bytes, mime: str) -> None:
    user.avatar = data
    user.avatar_mime = mime
    user.avatar_updated_at = dt.datetime.now(dt.timezone.utc)
    touch_user(db, user)


def clear_avatar(db: Session, user: User) -> None:
    user.avatar = None
    user.avatar_mime = None
    user.avatar_updated_at = None
    touch_user(db, user)


def load_avatar(db: Session, user_id: int) -> tuple[bytes, str] | None:
    """Đọc riêng ảnh, tránh kéo cột bytea vào các truy vấn khác."""
    row = db.execute(
        select(User.avatar, User.avatar_mime).where(User.id == user_id)
    ).one_or_none()
    if row is None or row[0] is None or row[1] is None:
        return None
    return bytes(row[0]), row[1]


def touch_user(db: Session, user: User) -> None:
    user.updated_at = dt.datetime.now(dt.timezone.utc)
    db.flush()


def delete_user(db: Session, user: User) -> None:
    db.delete(user)
    db.flush()


def create_session(
    db: Session, user: User, ttl_hours: int, user_agent: str | None
) -> tuple[str, UserSession]:
    """Tạo phiên mới, trả về (token gốc, bản ghi phiên).

    Token gốc chỉ tồn tại trong lần trả về này; CSDL chỉ giữ bản băm.
    """
    now = dt.datetime.now(dt.timezone.utc)
    # Dọn phiên hết hạn nhân tiện, khỏi cần cron riêng.
    db.execute(delete(UserSession).where(UserSession.expires_at < now))

    token = generate_session_token()
    session = UserSession(
        user_id=user.id,
        token_hash=hash_token(token),
        created_at=now,
        expires_at=now + dt.timedelta(hours=ttl_hours),
        user_agent=(user_agent or "")[:500] or None,
    )
    db.add(session)
    user.last_login_at = now
    db.flush()
    return token, session


def get_active_user_by_token(db: Session, token: str) -> User | None:
    """Tra người dùng từ token phiên; None nếu token sai, hết hạn hoặc tài khoản bị khoá."""
    stmt = select(UserSession).where(UserSession.token_hash == hash_token(token))
    session = db.execute(stmt).unique().scalar_one_or_none()
    if session is None:
        return None
    if session.expires_at <= dt.datetime.now(dt.timezone.utc):
        return None
    if not session.user.is_active:
        return None
    return session.user


def revoke_session(db: Session, token: str) -> bool:
    result = db.execute(delete(UserSession).where(UserSession.token_hash == hash_token(token)))
    db.flush()
    return result.rowcount > 0


def revoke_all_sessions(db: Session, user_id: int) -> int:
    """Đá toàn bộ phiên của một tài khoản — dùng khi khoá hoặc đổi vai trò."""
    result = db.execute(delete(UserSession).where(UserSession.user_id == user_id))
    db.flush()
    return result.rowcount


def revoke_other_sessions(db: Session, user_id: int, keep_token: str) -> int:
    """Đá mọi phiên khác nhưng giữ phiên đang gọi — dùng sau khi đổi mật khẩu."""
    result = db.execute(
        delete(UserSession).where(
            UserSession.user_id == user_id,
            UserSession.token_hash != hash_token(keep_token),
        )
    )
    db.flush()
    return result.rowcount


# =============================================================================
# Ghi dữ liệu lỗ khoan
# =============================================================================


def get_borehole_by_code(db: Session, project_id: int | None, code: str) -> Borehole | None:
    """Tra hố khoan theo mã trong phạm vi một công trình, hoặc trong nhóm đơn lẻ.

    ``project_id IS NULL`` phải viết bằng ``is_(None)``: trong SQL, ``= NULL``
    không bao giờ đúng nên so sánh thường sẽ luôn trả về rỗng.
    """
    condition = Borehole.project_id.is_(None) if project_id is None else Borehole.project_id == project_id
    stmt = select(Borehole).where(condition, Borehole.code == code)
    return db.execute(stmt).unique().scalar_one_or_none()


def _soil_types_by_code(db: Session) -> dict[str, SoilType]:
    return {soil.code: soil for soil in db.execute(select(SoilType)).scalars()}


def build_layers(db: Session, payload: BoreholeWriteBase) -> list[BoreholeLayer]:
    """Chuyển danh sách lớp từ request thành bản ghi, tự đánh mã lớp nếu thiếu.

    Schema đã bảo đảm các lớp liền mạch và phủ hết chiều sâu; ở đây chỉ còn
    việc ánh xạ mã loại đất và đánh số theo quy ước hồ sơ.
    """
    catalog = _soil_types_by_code(db)
    unknown = sorted({layer.soil_code for layer in payload.layers} - catalog.keys())
    if unknown:
        raise ValueError(f"Mã loại đất không có trong danh mục: {', '.join(unknown)}")

    layers: list[BoreholeLayer] = []
    numbered = 0
    for ordinal, item in enumerate(payload.layers, start=1):
        soil = catalog[item.soil_code]
        if item.layer_code:
            layer_code = item.layer_code
        elif soil.is_fill:
            layer_code = "k"
        else:
            numbered += 1
            layer_code = str(numbered)
        layers.append(
            BoreholeLayer(
                soil_type_id=soil.id,
                layer_code=layer_code,
                ordinal=ordinal,
                top_depth_m=item.top_depth_m,
                bottom_depth_m=item.bottom_depth_m,
            )
        )
    return layers


def create_borehole(
    db: Session,
    *,
    project: Project | None,
    code: str,
    payload: BoreholeWriteBase,
    actor: User,
) -> Borehole:
    """Tạo hố khoan. ``project=None`` cho hố khoan đơn lẻ."""
    now = dt.datetime.now(dt.timezone.utc)
    borehole = Borehole(
        project_id=project.id if project else None,
        code=code,
        name=payload.name or code,
        lat=payload.lat,
        lng=payload.lng,
        location_kind=payload.location_kind,
        depth_m=payload.depth_m,
        ground_level_m=payload.ground_level_m,
        water_level_m=payload.water_level_m,
        drilling_company=payload.drilling_company,
        drilled_on=payload.drilled_on,
        created_at=now,
        updated_at=now,
        created_by=actor.id,
        updated_by=actor.id,
    )
    borehole.layers = build_layers(db, payload)
    db.add(borehole)
    db.flush()
    return borehole


def update_borehole(db: Session, borehole: Borehole, payload: BoreholeWriteBase, actor: User) -> Borehole:
    borehole.name = payload.name or borehole.code
    borehole.lat = payload.lat
    borehole.lng = payload.lng
    borehole.location_kind = payload.location_kind
    borehole.depth_m = payload.depth_m
    borehole.ground_level_m = payload.ground_level_m
    borehole.water_level_m = payload.water_level_m
    borehole.drilling_company = payload.drilling_company
    borehole.drilled_on = payload.drilled_on
    borehole.updated_at = dt.datetime.now(dt.timezone.utc)
    borehole.updated_by = actor.id
    # cascade="all, delete-orphan" xoá các lớp cũ khi gán danh sách mới.
    borehole.layers = build_layers(db, payload)
    db.flush()
    return borehole


def delete_borehole(db: Session, borehole: Borehole) -> None:
    db.delete(borehole)
    db.flush()


def _opt_float(value: object) -> float | None:
    return None if value is None else float(value)  # type: ignore[arg-type]
