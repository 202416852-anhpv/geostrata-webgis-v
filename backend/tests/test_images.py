"""Kiểm thử nhận diện và giới hạn ảnh đại diện."""

from __future__ import annotations

import pytest

from app.images import InvalidImageError, detect_mime, validate_avatar

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 40
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 40
GIF87 = b"GIF87a" + b"\x00" * 40
GIF89 = b"GIF89a" + b"\x00" * 40
WEBP = b"RIFF" + b"\x24\x00\x00\x00" + b"WEBP" + b"\x00" * 40


@pytest.mark.parametrize(
    "data,expected",
    [
        (PNG, "image/png"),
        (JPEG, "image/jpeg"),
        (GIF87, "image/gif"),
        (GIF89, "image/gif"),
        (WEBP, "image/webp"),
    ],
)
def test_detects_supported_formats(data: bytes, expected: str) -> None:
    assert detect_mime(data) == expected


def test_rejects_empty_file() -> None:
    with pytest.raises(InvalidImageError, match="rỗng"):
        detect_mime(b"")


@pytest.mark.parametrize(
    "data",
    [
        b"<?php system($_GET[0]); ?>",
        b"GIF8" + b"\x00" * 40,  # gần giống GIF nhưng chữ ký sai
        b"RIFF" + b"\x00" * 4 + b"WAVE" + b"\x00" * 40,  # file âm thanh, không phải WebP
        b"\x00" * 64,
    ],
)
def test_rejects_non_images(data: bytes) -> None:
    """Kiểu ảnh suy từ nội dung, không tin Content-Type do client khai."""
    with pytest.raises(InvalidImageError):
        detect_mime(data)


def test_rejects_truncated_riff_header() -> None:
    with pytest.raises(InvalidImageError):
        detect_mime(b"RIFF")


def test_enforces_size_limit() -> None:
    oversized = PNG + b"\x00" * 2000
    with pytest.raises(InvalidImageError, match="vượt quá giới hạn"):
        validate_avatar(oversized, max_bytes=1000)


def test_accepts_image_within_limit() -> None:
    assert validate_avatar(PNG, max_bytes=512_000) == "image/png"


def test_size_checked_before_format() -> None:
    """Tệp quá lớn phải bị chặn ngay, không cần đọc hết mới biết định dạng."""
    with pytest.raises(InvalidImageError, match="vượt quá giới hạn"):
        validate_avatar(b"\x00" * 5000, max_bytes=1000)
