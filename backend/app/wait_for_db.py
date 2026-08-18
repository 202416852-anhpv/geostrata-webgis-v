"""Chờ PostgreSQL sẵn sàng trước khi chạy seed / khởi động API."""

from __future__ import annotations

import logging
import sys
import time

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.database import engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [wait-db] %(message)s")
logger = logging.getLogger(__name__)


def wait(timeout_s: int = 60, interval_s: float = 1.5) -> bool:
    deadline = time.monotonic() + timeout_s
    attempt = 0
    while time.monotonic() < deadline:
        attempt += 1
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            logger.info("CSDL sẵn sàng sau %d lần thử", attempt)
            return True
        except SQLAlchemyError as exc:
            logger.info("Lần %d: CSDL chưa sẵn sàng (%s)", attempt, type(exc).__name__)
            time.sleep(interval_s)
    logger.error("Hết thời gian chờ %ds mà CSDL vẫn chưa sẵn sàng", timeout_s)
    return False


if __name__ == "__main__":
    sys.exit(0 if wait() else 1)
