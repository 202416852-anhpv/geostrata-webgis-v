"""Kiểm tra ảnh đại diện trước khi lưu vào CSDL."""

from __future__ import annotations

# Nhận diện kiểu ảnh bằng CHỮ KÝ BYTE ở đầu file, không tin Content-Type do client
# khai: header đó người gửi đặt tuỳ ý, không phản ánh nội dung thật.
_SIGNATURES: list[tuple[bytes, str]] = [
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
]

ALLOWED_MIMES = {"image/png", "image/jpeg", "image/webp", "image/gif"}


class InvalidImageError(ValueError):
    pass


def detect_mime(data: bytes) -> str:
    """Trả về kiểu MIME suy ra từ nội dung; ném lỗi nếu không phải ảnh hỗ trợ."""
    if not data:
        raise InvalidImageError("Tệp rỗng")

    for signature, mime in _SIGNATURES:
        if data.startswith(signature):
            return mime

    # WebP: "RIFF" + 4 byte kích thước + "WEBP"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"

    raise InvalidImageError("Chỉ nhận ảnh PNG, JPEG, WebP hoặc GIF")


def validate_avatar(data: bytes, max_bytes: int) -> str:
    if len(data) > max_bytes:
        # Router chỉ đọc tối đa max_bytes + 1 byte nên không biết dung lượng thật;
        # chỉ nêu giới hạn thay vì báo một con số sai.
        raise InvalidImageError(f"Ảnh vượt quá giới hạn {max_bytes // 1024} KB")
    return detect_mime(data)
