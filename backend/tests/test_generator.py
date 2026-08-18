"""Kiểm thử logic sinh dữ liệu — chốt lại các lỗi đã sửa từ bản Node cũ."""

from __future__ import annotations

import json
import math
from pathlib import Path
from random import Random

import pytest

from app.seed.generator import (
    M_PER_DEG_LAT,
    SoilTypeSpec,
    build_boreholes,
    build_layers,
    grid_positions,
    offset_point,
    split_thickness,
)


def _find_data_dir() -> Path:
    """Thư mục data nằm ở gốc repo khi chạy local, ở /app/data khi chạy trong container."""
    for candidate in (Path(__file__).resolve().parents[2] / "data", Path("/app/data")):
        if (candidate / "soil_types.json").exists():
            return candidate
    raise RuntimeError("Không tìm thấy thư mục data/")


DATA_DIR = _find_data_dir()


@pytest.fixture(scope="module")
def catalog() -> list[SoilTypeSpec]:
    records = json.loads((DATA_DIR / "soil_types.json").read_text(encoding="utf-8"))
    return [SoilTypeSpec(**record) for record in records]


@pytest.fixture(scope="module")
def projects() -> list[dict]:
    return json.loads((DATA_DIR / "projects.json").read_text(encoding="utf-8"))


# --- Hình học ----------------------------------------------------------------


def test_offset_point_distance_is_accurate() -> None:
    lat, lng = offset_point(10.7769, 106.6953, east_m=100.0, north_m=0.0)
    metres_per_deg_lng = M_PER_DEG_LAT * math.cos(math.radians(10.7769))
    assert (lng - 106.6953) * metres_per_deg_lng == pytest.approx(100.0, abs=0.01)
    assert lat == pytest.approx(10.7769)


def test_grid_returns_exactly_rows_times_cols() -> None:
    """Bản Node cũ đặt count=60 nhưng chỉ trả về ~38 điểm; lưới thì luôn đủ."""
    positions = grid_positions(10.0, 106.0, rows=8, cols=8, spacing_m=25, jitter_m=5, rng=Random(1))
    assert len(positions) == 64
    assert len(set(positions)) == 64, "không được có hai lỗ khoan trùng toạ độ"


def test_grid_is_deterministic() -> None:
    a = grid_positions(10.0, 106.0, 5, 5, 25, 5, Random(42))
    b = grid_positions(10.0, 106.0, 5, 5, 25, 5, Random(42))
    assert a == b


# --- Chia bề dày -------------------------------------------------------------


@pytest.mark.parametrize("depth,count", [(30.0, 5), (45.5, 8), (60.0, 6), (25.0, 5)])
def test_thickness_sums_exactly_to_depth(depth: float, count: int) -> None:
    """Lỗi cũ: các lớp có thể dừng trước đáy, chừa khoảng trống trên bản vẽ."""
    parts = split_thickness(depth, count, min_thickness_m=1.5, rng=Random(7))
    assert sum(parts) == pytest.approx(depth, abs=0.05)
    assert len(parts) == count
    assert all(p >= 1.4 for p in parts), "mọi lớp phải đạt bề dày tối thiểu"


def test_thickness_rejects_impossible_split() -> None:
    with pytest.raises(ValueError):
        split_thickness(depth_m=5.0, count=10, min_thickness_m=1.5, rng=Random(0))


# --- Địa tầng ----------------------------------------------------------------


def test_layers_cover_full_depth_without_gaps(catalog: list[SoilTypeSpec]) -> None:
    for seed in range(50):
        layers = build_layers(45.0, catalog, Random(seed), 5, 8, 1.5, 0.8)
        assert layers[0].top_depth_m == 0.0, "lớp đầu phải bắt đầu từ mặt đất"
        assert layers[-1].bottom_depth_m == pytest.approx(45.0), "lớp cuối phải chạm đáy lỗ khoan"
        for prev, nxt in zip(layers, layers[1:], strict=False):
            assert prev.bottom_depth_m == nxt.top_depth_m, "không được hở hoặc chồng lớp"
            assert nxt.bottom_depth_m > nxt.top_depth_m


def test_no_duplicate_soil_in_one_borehole(catalog: list[SoilTypeSpec]) -> None:
    """Lỗi cũ: chỉ bốc lại một lần nên vẫn lọt lớp trùng loại đất."""
    for seed in range(100):
        layers = build_layers(50.0, catalog, Random(seed), 5, 8, 1.5, 0.7)
        codes = [layer.soil_code for layer in layers]
        assert len(codes) == len(set(codes))


def test_layers_follow_stratigraphic_order(catalog: list[SoilTypeSpec]) -> None:
    order = {soil.code: soil.strata_order for soil in catalog}
    for seed in range(50):
        layers = build_layers(50.0, catalog, Random(seed), 5, 8, 1.5, 0.7)
        orders = [order[layer.soil_code] for layer in layers]
        assert orders == sorted(orders), "trầm tích trẻ phải nằm trên trầm tích già"


def test_layer_codes_follow_report_convention(catalog: list[SoilTypeSpec]) -> None:
    fill_codes = {soil.code for soil in catalog if soil.is_fill}
    for seed in range(50):
        layers = build_layers(50.0, catalog, Random(seed), 5, 8, 1.5, 1.0)
        assert layers[0].soil_code in fill_codes
        assert layers[0].layer_code == "k", 'lớp đất đắp phải mang mã "k"'
        numbered = [layer.layer_code for layer in layers[1:]]
        assert numbered == [str(i) for i in range(1, len(numbered) + 1)]


def test_ordinals_are_contiguous(catalog: list[SoilTypeSpec]) -> None:
    layers = build_layers(40.0, catalog, Random(3), 5, 8, 1.5, 0.5)
    assert [layer.ordinal for layer in layers] == list(range(1, len(layers) + 1))


# --- Toàn bộ công trình ------------------------------------------------------


def test_every_project_generates_valid_data(catalog: list[SoilTypeSpec], projects: list[dict]) -> None:
    for cfg in projects:
        specs = build_boreholes(cfg, catalog, Random(cfg["seed"]))
        expected = cfg["grid"]["rows"] * cfg["grid"]["cols"]
        assert len(specs) == expected
        assert len({spec.code for spec in specs}) == expected, "mã lỗ khoan phải duy nhất trong công trình"
        for spec in specs:
            assert cfg["depth"]["min_m"] <= spec.depth_m <= cfg["depth"]["max_m"]
            assert spec.layers, "mọi lỗ khoan phải có ít nhất một lớp"
            assert spec.layers[-1].bottom_depth_m == pytest.approx(spec.depth_m)
            assert spec.water_level_m >= 0


def test_seeding_is_reproducible(catalog: list[SoilTypeSpec], projects: list[dict]) -> None:
    cfg = projects[0]
    first = build_boreholes(cfg, catalog, Random(cfg["seed"]))
    second = build_boreholes(cfg, catalog, Random(cfg["seed"]))
    assert first == second
