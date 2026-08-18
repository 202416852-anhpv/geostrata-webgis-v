"""Áp các file SQL trong db/migrations theo thứ tự tên, mỗi file đúng một lần.

    python -m app.migrate            # áp những migration chưa chạy
    python -m app.migrate --status   # chỉ liệt kê trạng thái

Khác với db/init/ (PostgreSQL chỉ chạy khi volume còn rỗng), migration ở đây áp
được cho cả CSDL đang có dữ liệu, nên nâng cấp không cần xoá volume.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from sqlalchemy import text

from app.config import get_settings
from app.database import engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [migrate] %(message)s")
logger = logging.getLogger(__name__)

_TRACKING_TABLE = text(
    """
    CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
    )
    """
)


def discover(migrations_dir: Path) -> list[Path]:
    if not migrations_dir.is_dir():
        logger.warning("Không thấy thư mục migration: %s", migrations_dir)
        return []
    return sorted(migrations_dir.glob("*.sql"))


def applied_versions(conn) -> set[str]:
    rows = conn.execute(text("SELECT version FROM schema_migrations")).scalars()
    return set(rows)


def run(migrations_dir: Path, dry_run: bool = False) -> int:
    files = discover(migrations_dir)
    applied_count = 0

    with engine.begin() as conn:
        conn.execute(_TRACKING_TABLE)
        done = applied_versions(conn)

    for path in files:
        version = path.stem
        if version in done:
            logger.info("%-24s đã áp trước đó", version)
            continue
        if dry_run:
            logger.info("%-24s CHƯA áp", version)
            continue

        sql = path.read_text(encoding="utf-8")
        # Mỗi migration chạy trong một transaction: lỗi giữa chừng thì rollback
        # toàn bộ và không được ghi nhận là đã áp.
        with engine.begin() as conn:
            # exec_driver_sql chứ không phải text(): text() hiểu ":ten" là bind
            # parameter, sẽ làm hỏng những migration có ép kiểu "::" hay chuỗi
            # chứa dấu hai chấm.
            conn.exec_driver_sql(sql)
            conn.execute(
                text("INSERT INTO schema_migrations (version) VALUES (:v)"),
                {"v": version},
            )
        logger.info("%-24s ÁP THÀNH CÔNG", version)
        applied_count += 1

    if not dry_run:
        logger.info("Hoàn tất: áp mới %d migration", applied_count)
    return applied_count


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Chạy migration CSDL")
    parser.add_argument("--status", action="store_true", help="Chỉ liệt kê, không áp")
    parser.add_argument("--dir", type=Path, default=None, help="Thư mục chứa file .sql")
    args = parser.parse_args(argv)

    migrations_dir = args.dir or get_settings().migrations_dir
    run(migrations_dir, dry_run=args.status)
    return 0


if __name__ == "__main__":
    sys.exit(main())
