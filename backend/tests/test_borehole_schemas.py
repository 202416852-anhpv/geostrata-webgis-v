"""Kiểm thử validator địa tầng khi nhập tay.

Dữ liệu sinh tự động đã bảo đảm các lớp liền mạch (xem test_generator.py); các
test dưới đây chốt rằng dữ liệu nhập qua API cũng không phá được bất biến đó.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas import BoreholeCreateIn


def make_payload(layers: list[tuple[str, float, float]], depth: float = 30.0) -> dict:
    return {
        "project_code": "TTDH-CN",
        "code": "HK-99",
        "lat": 10.7769,
        "lng": 106.6953,
        "depth_m": depth,
        "layers": [
            {"soil_code": code, "top_depth_m": top, "bottom_depth_m": bottom}
            for code, top, bottom in layers
        ],
    }


def test_accepts_contiguous_layers_covering_full_depth() -> None:
    payload = BoreholeCreateIn(
        **make_payload(
            [("fill", 0, 4.5), ("clay_stiff", 4.5, 18), ("sand_fine", 18, 30)],
            depth=30,
        )
    )
    assert len(payload.layers) == 3
    assert payload.layers[-1].bottom_depth_m == 30


def test_accepts_borehole_without_layers() -> None:
    """Cho phép tạo lỗ khoan trước, nhập địa tầng sau."""
    payload = BoreholeCreateIn(**make_payload([], depth=25))
    assert payload.layers == []


def test_layers_are_sorted_by_depth() -> None:
    payload = BoreholeCreateIn(
        **make_payload([("sand_fine", 18, 30), ("fill", 0, 4.5), ("clay_stiff", 4.5, 18)], depth=30)
    )
    assert [layer.top_depth_m for layer in payload.layers] == [0, 4.5, 18]


def test_rejects_layers_not_starting_at_surface() -> None:
    with pytest.raises(ValidationError, match="bắt đầu từ độ sâu 0"):
        BoreholeCreateIn(**make_payload([("fill", 1.5, 30)], depth=30))


def test_rejects_gap_between_layers() -> None:
    with pytest.raises(ValidationError, match="hở hoặc chồng lớp"):
        BoreholeCreateIn(**make_payload([("fill", 0, 10), ("sand_fine", 12, 30)], depth=30))


def test_rejects_overlapping_layers() -> None:
    with pytest.raises(ValidationError, match="hở hoặc chồng lớp"):
        BoreholeCreateIn(**make_payload([("fill", 0, 15), ("sand_fine", 12, 30)], depth=30))


def test_rejects_layers_not_reaching_bottom() -> None:
    with pytest.raises(ValidationError, match="nhưng lỗ khoan sâu"):
        BoreholeCreateIn(**make_payload([("fill", 0, 10), ("sand_fine", 10, 25)], depth=30))


def test_rejects_layers_deeper_than_borehole() -> None:
    with pytest.raises(ValidationError, match="nhưng lỗ khoan sâu"):
        BoreholeCreateIn(**make_payload([("fill", 0, 10), ("sand_fine", 10, 40)], depth=30))


def test_rejects_inverted_layer() -> None:
    with pytest.raises(ValidationError, match="đáy không sâu hơn đỉnh"):
        BoreholeCreateIn(**make_payload([("fill", 0, 10), ("sand_fine", 10, 10)], depth=10))


def test_tolerates_rounding_within_one_centimetre() -> None:
    """Ranh giới lưu numeric(6,2) nên sai số dưới 1 cm không được coi là lỗi."""
    payload = BoreholeCreateIn(**make_payload([("fill", 0, 10), ("sand_fine", 10.005, 30)], depth=30))
    assert len(payload.layers) == 2


@pytest.mark.parametrize("lat,lng", [(91, 0), (-91, 0), (0, 181), (0, -181)])
def test_rejects_out_of_range_coordinates(lat: float, lng: float) -> None:
    data = make_payload([], depth=30) | {"lat": lat, "lng": lng}
    with pytest.raises(ValidationError):
        BoreholeCreateIn(**data)


@pytest.mark.parametrize("depth", [0, -5])
def test_rejects_non_positive_depth(depth: float) -> None:
    with pytest.raises(ValidationError):
        BoreholeCreateIn(**make_payload([], depth=depth))
