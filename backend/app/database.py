"""Engine, session factory và dependency cho FastAPI."""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

settings = get_settings()

engine = create_engine(
    settings.database_url,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_pre_ping=True,  # tự phát hiện kết nối chết sau khi container db restart
    echo=settings.db_echo,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    """Dependency: mở session cho mỗi request và luôn đóng lại."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
