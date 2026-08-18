"""Kiểm thử quy tắc hồ sơ công trình và ba kịch bản thêm hố khoan."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas import BoreholeBulkCreateIn, BoreholeCreateIn, ProjectCreateIn

SQUARE = [
    {"lat": 10.7760, "lng": 106.6950},
    {"lat": 10.7760, "lng": 106.6959},
    {"lat": 10.7769, "lng": 106.6959},
    {"lat": 10.7769, "lng": 106.6950},
]


def borehole(**overrides) -> dict:
    return {"code": "HK-01", "depth_m": 30.0, "lat": 10.7769, "lng": 106.6953} | overrides


# --- Hồ sơ công trình --------------------------------------------------------


def test_only_name_and_code_are_required() -> None:
    """Năm xây dựng, quy mô, địa điểm, ranh giới đều không bắt buộc."""
    project = ProjectCreateIn(code="CT-01", name="Cầu Thủ Thiêm 4")
    assert project.built_year is None
    assert project.scale_description is None
    assert project.location_label is None
    assert project.vertices == []


def test_accepts_full_profile() -> None:
    project = ProjectCreateIn(
        code="CT-02",
        name="Toà nhà văn phòng",
        location_label="Quận 1, TP.HCM",
        built_year=2019,
        scale_description="12 tầng, 8.000 m² sàn",
        vertices=SQUARE,
    )
    assert project.built_year == 2019
    assert len(project.vertices) == 4


@pytest.mark.parametrize("year", [1799, 2201])
def test_rejects_implausible_built_year(year: int) -> None:
    with pytest.raises(ValidationError):
        ProjectCreateIn(code="CT-03", name="X", built_year=year)


def test_allows_one_or_two_points_without_boundary() -> None:
    """1-2 điểm vẫn lưu được để đánh dấu vị trí, chỉ là chưa thành ranh giới."""
    project = ProjectCreateIn(code="CT-04", name="X", vertices=SQUARE[:2])
    assert len(project.vertices) == 2


def test_rejects_three_points_that_are_not_distinct() -> None:
    duplicated = [SQUARE[0], SQUARE[0], SQUARE[0]]
    with pytest.raises(ValidationError, match="ít nhất 3 điểm khác nhau"):
        ProjectCreateIn(code="CT-05", name="X", vertices=duplicated)


@pytest.mark.parametrize("code", ["có dấu", "mã trống", "a b", "x/y"])
def test_rejects_invalid_project_code(code: str) -> None:
    with pytest.raises(ValidationError):
        ProjectCreateIn(code=code, name="X")


# --- Kịch bản 1: hố khoan đơn lẻ ---------------------------------------------


def test_standalone_borehole_needs_no_project() -> None:
    result = BoreholeCreateIn(**borehole())
    assert result.project_code is None
    assert result.location_kind == "point"


def test_standalone_borehole_still_needs_coordinates() -> None:
    with pytest.raises(ValidationError, match="đủ vĩ độ và kinh độ"):
        BoreholeCreateIn(**borehole(lat=None, lng=None))


def test_rejects_half_a_coordinate() -> None:
    with pytest.raises(ValidationError, match="đủ vĩ độ và kinh độ"):
        BoreholeCreateIn(**borehole(lng=None))


# --- Kịch bản 3: địa tầng gắn với cả công trình ------------------------------


def test_project_area_borehole_omits_coordinates() -> None:
    result = BoreholeCreateIn(
        **borehole(lat=None, lng=None, location_kind="project_area", project_code="CT-01")
    )
    assert result.lat is None
    assert result.project_code == "CT-01"


def test_project_area_borehole_requires_a_project() -> None:
    with pytest.raises(ValidationError, match="phải gắn với một công trình"):
        BoreholeCreateIn(**borehole(lat=None, lng=None, location_kind="project_area"))


def test_project_area_borehole_rejects_coordinates() -> None:
    """Khai chưa rõ vị trí mà vẫn gửi toạ độ là mâu thuẫn, phải chặn."""
    with pytest.raises(ValidationError, match="không nhận toạ độ"):
        BoreholeCreateIn(**borehole(location_kind="project_area", project_code="CT-01"))


# --- Kịch bản 2: nhập hàng loạt ----------------------------------------------


def test_bulk_creates_project_together_with_boreholes() -> None:
    payload = BoreholeBulkCreateIn(
        project={"code": "CT-10", "name": "Khu dân cư", "built_year": 2020, "vertices": SQUARE},
        boreholes=[borehole(code="HK-01"), borehole(code="HK-02")],
    )
    assert payload.project is not None
    assert len(payload.boreholes) == 2


def test_bulk_into_existing_project() -> None:
    payload = BoreholeBulkCreateIn(project_code="TTDH-CN", boreholes=[borehole()])
    assert payload.project is None
    assert payload.project_code == "TTDH-CN"


def test_bulk_of_standalone_boreholes() -> None:
    payload = BoreholeBulkCreateIn(boreholes=[borehole(code="HK-A"), borehole(code="HK-B")])
    assert payload.project is None and payload.project_code is None


def test_bulk_rejects_both_new_and_existing_project() -> None:
    with pytest.raises(ValidationError, match="Chỉ được chọn một trong hai"):
        BoreholeBulkCreateIn(
            project={"code": "CT-11", "name": "X"},
            project_code="TTDH-CN",
            boreholes=[borehole()],
        )


def test_bulk_rejects_duplicate_codes_in_one_batch() -> None:
    """Bắt trùng ngay ở tầng schema, khỏi để CSDL báo lỗi giữa chừng."""
    with pytest.raises(ValidationError, match="bị trùng trong danh sách"):
        BoreholeBulkCreateIn(boreholes=[borehole(code="HK-01"), borehole(code="HK-01")])


def test_bulk_rejects_unlocated_borehole_without_project() -> None:
    with pytest.raises(ValidationError, match="phải thuộc một công trình"):
        BoreholeBulkCreateIn(
            boreholes=[borehole(code="HK-9", lat=None, lng=None, location_kind="project_area")]
        )


def test_bulk_rejects_empty_request() -> None:
    with pytest.raises(ValidationError, match="ít nhất một hố khoan"):
        BoreholeBulkCreateIn(boreholes=[])


def test_bulk_allows_project_with_no_boreholes_yet() -> None:
    """Tạo công trình trước, nhập hố khoan sau là hợp lệ."""
    payload = BoreholeBulkCreateIn(project={"code": "CT-12", "name": "X"}, boreholes=[])
    assert payload.project is not None
