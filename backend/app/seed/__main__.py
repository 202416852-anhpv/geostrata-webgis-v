"""Nạp dữ liệu từ thư mục ``data/`` vào CSDL.

    python -m app.seed              # bỏ qua nếu CSDL đã có dữ liệu
    python -m app.seed --force      # xoá sạch rồi nạp lại
    python -m app.seed --dry-run    # chỉ in thống kê, không ghi CSDL

Toàn bộ dữ liệu tất định theo `seed` khai báo trong data/projects.json:
cùng file đầu vào luôn cho ra cùng bộ dữ liệu.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from random import Random

from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from app import repository
from app.config import get_settings
from app.database import SessionLocal
from app.models import Borehole, BoreholeLayer, Project, ProjectVertex, SoilType
from app.seed.generator import SoilTypeSpec, build_boreholes

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [seed] %(message)s")
logger = logging.getLogger(__name__)


def load_json(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def sync_soil_types(db: Session, records: list[dict]) -> dict[str, int]:
    """Upsert danh mục đất, trả về map code -> id."""
    existing = {row.code: row for row in db.execute(select(SoilType)).scalars()}
    for record in records:
        row = existing.get(record["code"])
        if row is None:
            row = SoilType(**record)
            db.add(row)
        else:
            for key, value in record.items():
                setattr(row, key, value)
    db.flush()
    return {row.code: row.id for row in db.execute(select(SoilType)).scalars()}


def seed_users(db: Session, data_dir: Path) -> int:
    """Tạo tài khoản mặc định nếu CSDL chưa có tài khoản nào.

    Chỉ chạy khi bảng users còn rỗng, nên seed lại dữ liệu khảo sát không bao giờ
    ghi đè mật khẩu mà người dùng đã tự đổi.
    """
    if repository.count_users(db):
        logger.info("Đã có tài khoản trong CSDL, bỏ qua seed tài khoản")
        return 0

    settings = get_settings()
    users_file = data_dir / "users.json"
    if users_file.exists():
        records = load_json(users_file)
    else:
        # Không có file thì ít nhất phải có một admin, nếu không sẽ không ai đăng nhập được.
        records = [
            {
                "username": settings.bootstrap_admin_username,
                "full_name": "Quản trị hệ thống",
                "password": settings.bootstrap_admin_password,
                "role": "admin",
                "email": None,
            }
        ]

    for record in records:
        repository.create_user(
            db,
            username=record["username"],
            full_name=record["full_name"],
            password=record["password"],
            role=record.get("role", "user"),
            email=record.get("email"),
        )
        logger.info("Tạo tài khoản %-12s vai trò %s", record["username"], record.get("role", "user"))

    logger.warning("ĐỔI MẬT KHẨU MẶC ĐỊNH NGAY trước khi dùng ngoài môi trường local")
    return len(records)


def seed_project(
    db: Session,
    project_cfg: dict,
    soil_ids: dict[str, int],
    catalog: list[SoilTypeSpec],
) -> int:
    project = db.execute(select(Project).where(Project.code == project_cfg["code"])).scalar_one_or_none()
    if project is None:
        project = Project(code=project_cfg["code"])
        db.add(project)

    project.name = project_cfg["name"]
    project.location_label = project_cfg.get("location_label")
    project.built_year = project_cfg.get("built_year")
    project.scale_description = project_cfg.get("scale_description")
    db.flush()

    # Ranh giới: xoá đỉnh cũ và flush trước, nếu không bộ đỉnh mới sẽ đụng
    # UNIQUE(project_id, ordinal) vì SQLAlchemy chạy INSERT trước DELETE.
    db.execute(delete(ProjectVertex).where(ProjectVertex.project_id == project.id))
    db.execute(delete(Borehole).where(Borehole.project_id == project.id))
    db.flush()

    for index, vertex in enumerate(project_cfg.get("boundary", []), start=1):
        db.add(ProjectVertex(project_id=project.id, ordinal=index, lat=vertex["lat"], lng=vertex["lng"]))
    db.flush()

    rng = Random(project_cfg["seed"])
    specs = build_boreholes(project_cfg, catalog, rng)

    for spec in specs:
        borehole = Borehole(
            project_id=project.id,
            code=spec.code,
            name=spec.name,
            lat=spec.lat,
            lng=spec.lng,
            depth_m=spec.depth_m,
            ground_level_m=spec.ground_level_m,
            water_level_m=spec.water_level_m,
            drilled_on=spec.drilled_on,
        )
        borehole.layers = [
            BoreholeLayer(
                soil_type_id=soil_ids[layer.soil_code],
                layer_code=layer.layer_code,
                ordinal=layer.ordinal,
                top_depth_m=layer.top_depth_m,
                bottom_depth_m=layer.bottom_depth_m,
            )
            for layer in spec.layers
        ]
        db.add(borehole)

    db.flush()
    logger.info(
        "Công trình %s: %d lỗ khoan, %d lớp địa tầng",
        project_cfg["code"],
        len(specs),
        sum(len(s.layers) for s in specs),
    )
    return len(specs)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Nạp dữ liệu mẫu GeoStrata")
    parser.add_argument("--force", action="store_true", help="Xoá dữ liệu cũ rồi nạp lại")
    parser.add_argument("--dry-run", action="store_true", help="Chỉ tính toán, không ghi CSDL")
    parser.add_argument("--data-dir", type=Path, default=None, help="Thư mục chứa *.json")
    args = parser.parse_args(argv)

    settings = get_settings()
    data_dir: Path = args.data_dir or settings.data_dir
    soil_records = load_json(data_dir / "soil_types.json")
    project_records = load_json(data_dir / "projects.json")
    catalog = [SoilTypeSpec(**record) for record in soil_records]

    if args.dry_run:
        total = 0
        for cfg in project_records:
            specs = build_boreholes(cfg, catalog, Random(cfg["seed"]))
            total += len(specs)
            logger.info("[dry-run] %s -> %d lỗ khoan", cfg["code"], len(specs))
        logger.info("[dry-run] Tổng %d lỗ khoan, không ghi CSDL", total)
        return 0

    with SessionLocal() as db:
        # Tài khoản seed độc lập với dữ liệu khảo sát: CSDL nâng cấp từ bản cũ đã
        # có sẵn lỗ khoan nhưng chưa có tài khoản nào, vẫn phải tạo được admin.
        seed_users(db, data_dir)
        db.commit()

        existing = db.execute(text("SELECT count(*) FROM boreholes")).scalar_one()
        if existing and not args.force:
            logger.info("CSDL đã có %d lỗ khoan, bỏ qua seed. Dùng --force để nạp lại.", existing)
            return 0

        if args.force:
            logger.warning("--force: xoá toàn bộ dữ liệu lỗ khoan và công trình")
            db.execute(delete(BoreholeLayer))
            db.execute(delete(Borehole))
            db.execute(delete(Project))
            db.flush()

        soil_ids = sync_soil_types(db, soil_records)
        total = sum(seed_project(db, cfg, soil_ids, catalog) for cfg in project_records)
        db.commit()

    logger.info("Hoàn tất: %d lỗ khoan trong %d công trình", total, len(project_records))
    return 0


if __name__ == "__main__":
    sys.exit(main())
