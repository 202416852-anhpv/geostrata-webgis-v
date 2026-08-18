"""Sinh dữ liệu khảo sát tất định (deterministic) cho môi trường local.

Đây là logic thuần, không chạm CSDL, nên kiểm thử được bằng pytest.

Khác biệt so với bản Node cũ (`generator.ts`) — các lỗi đã sửa:

1. Lỗ khoan nằm trên lưới khảo sát có kiểm soát, số lượng đúng bằng rows*cols;
   bản cũ sinh 240 điểm trong bán kính 2.5R rồi lọc nên chỉ giữ lại ~16%,
   luôn ít hơn con số `count = 60` mà tham số gợi ý.
2. Địa tầng chọn theo THỨ TỰ TRẦM TÍCH nên không bao giờ lặp lại loại đất;
   bản cũ chỉ bốc lại ngẫu nhiên đúng một lần nên vẫn lọt lớp trùng.
3. Bề dày các lớp được chuẩn hoá để tổng đúng bằng chiều sâu lỗ khoan;
   bản cũ có thể dừng sớm, để trống phần đáy bản vẽ.
4. Màu gắn với loại đất trong danh mục, không gắn theo chỉ số vòng lặp.
"""

from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass
from random import Random

M_PER_DEG_LAT = 111_320.0


@dataclass(frozen=True)
class SoilTypeSpec:
    code: str
    name: str
    description: str
    color: str
    pattern: str
    is_fill: bool
    strata_order: int


@dataclass(frozen=True)
class LayerSpec:
    ordinal: int
    layer_code: str
    soil_code: str
    top_depth_m: float
    bottom_depth_m: float


@dataclass(frozen=True)
class BoreholeSpec:
    code: str
    name: str
    lat: float
    lng: float
    depth_m: float
    ground_level_m: float
    water_level_m: float
    drilled_on: dt.date
    layers: list[LayerSpec]


def offset_point(lat: float, lng: float, east_m: float, north_m: float) -> tuple[float, float]:
    """Dời một điểm đi (east_m, north_m) mét, trả về (lat, lng)."""
    d_lat = north_m / M_PER_DEG_LAT
    d_lng = east_m / (M_PER_DEG_LAT * math.cos(math.radians(lat)))
    return lat + d_lat, lng + d_lng


def grid_positions(
    center_lat: float,
    center_lng: float,
    rows: int,
    cols: int,
    spacing_m: float,
    jitter_m: float,
    rng: Random,
) -> list[tuple[float, float]]:
    """Lưới khoan rows x cols quanh tâm, có xê dịch ngẫu nhiên cho tự nhiên."""
    positions: list[tuple[float, float]] = []
    for row in range(rows):
        for col in range(cols):
            north = (row - (rows - 1) / 2) * spacing_m + rng.uniform(-jitter_m, jitter_m)
            east = (col - (cols - 1) / 2) * spacing_m + rng.uniform(-jitter_m, jitter_m)
            lat, lng = offset_point(center_lat, center_lng, east, north)
            positions.append((round(lat, 7), round(lng, 7)))
    return positions


def select_soil_sequence(
    catalog: list[SoilTypeSpec],
    layer_count: int,
    include_fill: bool,
    rng: Random,
) -> list[SoilTypeSpec]:
    """Chọn chuỗi loại đất theo đúng thứ tự trầm tích, không trùng lặp.

    Vì luôn giữ nguyên thứ tự `strata_order` tăng dần, kết quả vừa hợp lý về
    địa chất (trẻ trên, già dưới) vừa loại trừ hoàn toàn lớp trùng.
    """
    ordered = sorted(catalog, key=lambda s: s.strata_order)
    fill_types = [s for s in ordered if s.is_fill]
    body_types = [s for s in ordered if not s.is_fill]
    layer_count = max(1, layer_count)

    sequence: list[SoilTypeSpec] = []
    # Chỉ chèn lớp đắp khi còn chỗ cho ít nhất một lớp đất tự nhiên bên dưới.
    if include_fill and fill_types and layer_count > 1:
        sequence.append(fill_types[0])

    body_count = max(1, min(layer_count - len(sequence), len(body_types)))
    chosen = rng.sample(body_types, body_count)
    chosen.sort(key=lambda s: s.strata_order)
    sequence.extend(chosen)
    return sequence


def split_thickness(depth_m: float, count: int, min_thickness_m: float, rng: Random) -> list[float]:
    """Chia chiều sâu thành `count` lớp, tổng đúng bằng `depth_m`.

    Mỗi lớp được cấp trước `min_thickness_m`, phần dư chia theo trọng số ngẫu
    nhiên có thiên hướng dày dần theo chiều sâu — giống trầm tích thực tế.
    Ranh giới làm tròn 0.1 m theo kiểu cộng dồn nên không bao giờ hở hoặc chồng.
    """
    if count < 1:
        raise ValueError("count phải >= 1")
    if depth_m < count * min_thickness_m:
        raise ValueError(f"Không thể chia {depth_m}m thành {count} lớp dày tối thiểu {min_thickness_m}m")

    weights = [rng.uniform(0.7, 1.5) * (1.0 + 0.15 * i) for i in range(count)]
    total_weight = sum(weights)
    remainder = depth_m - count * min_thickness_m
    raw = [min_thickness_m + remainder * w / total_weight for w in weights]

    boundaries = [0.0]
    cursor = 0.0
    for thickness in raw[:-1]:
        cursor = round(cursor + thickness, 1)
        boundaries.append(cursor)
    boundaries.append(round(depth_m, 1))  # lớp cuối luôn chạm đáy lỗ khoan

    return [round(boundaries[i + 1] - boundaries[i], 1) for i in range(count)]


def build_layers(
    depth_m: float,
    catalog: list[SoilTypeSpec],
    rng: Random,
    min_layers: int,
    max_layers: int,
    min_thickness_m: float,
    fill_probability: float,
) -> list[LayerSpec]:
    """Dựng địa tầng đầy đủ cho một lỗ khoan, phủ kín từ 0 m tới đáy."""
    include_fill = rng.random() < fill_probability
    max_by_depth = max(1, int(depth_m // min_thickness_m))
    upper = max(1, min(max_layers, len(catalog), max_by_depth))
    lower = max(1, min(min_layers, upper))
    layer_count = rng.randint(lower, upper)

    soils = select_soil_sequence(catalog, layer_count, include_fill, rng)
    soils = soils[:max_by_depth]  # đảm bảo mọi lớp còn đủ bề dày tối thiểu
    thicknesses = split_thickness(depth_m, len(soils), min_thickness_m, rng)

    layers: list[LayerSpec] = []
    cursor = 0.0
    body_index = 0
    for ordinal, (soil, thickness) in enumerate(zip(soils, thicknesses, strict=True), start=1):
        top = round(cursor, 1)
        bottom = round(cursor + thickness, 1)
        if ordinal == len(soils):
            bottom = round(depth_m, 1)  # chống sai số dồn tích ở lớp cuối
        # Quy ước hồ sơ địa chất: lớp đất đắp mang mã "k", các lớp còn lại đánh số.
        if soil.is_fill:
            layer_code = "k"
        else:
            body_index += 1
            layer_code = str(body_index)
        layers.append(
            LayerSpec(
                ordinal=ordinal,
                layer_code=layer_code,
                soil_code=soil.code,
                top_depth_m=top,
                bottom_depth_m=bottom,
            )
        )
        cursor = bottom
    return layers


def build_boreholes(
    project: dict,
    catalog: list[SoilTypeSpec],
    rng: Random,
) -> list[BoreholeSpec]:
    """Sinh toàn bộ lỗ khoan của một công trình từ khai báo trong data/projects.json."""
    grid = project["grid"]
    depth_cfg = project["depth"]
    strata_cfg = project["stratigraphy"]
    prefix = project.get("borehole_prefix", "HK")

    positions = grid_positions(
        center_lat=grid["center_lat"],
        center_lng=grid["center_lng"],
        rows=grid["rows"],
        cols=grid["cols"],
        spacing_m=grid["spacing_m"],
        jitter_m=grid["jitter_m"],
        rng=rng,
    )

    start_date = dt.date(2024, 1, 8)
    boreholes: list[BoreholeSpec] = []
    for index, (lat, lng) in enumerate(positions, start=1):
        depth_m = round(rng.uniform(depth_cfg["min_m"], depth_cfg["max_m"]) * 2) / 2  # bội số 0.5 m
        code = f"{prefix}-{index:02d}"
        boreholes.append(
            BoreholeSpec(
                code=code,
                name=code,
                lat=lat,
                lng=lng,
                depth_m=depth_m,
                ground_level_m=round(rng.uniform(0.8, 3.5), 2),
                water_level_m=round(rng.uniform(0.8, 4.5), 2),
                drilled_on=start_date + dt.timedelta(days=index // 2),
                layers=build_layers(
                    depth_m=depth_m,
                    catalog=catalog,
                    rng=rng,
                    min_layers=strata_cfg["min_layers"],
                    max_layers=strata_cfg["max_layers"],
                    min_thickness_m=strata_cfg["min_thickness_m"],
                    fill_probability=strata_cfg["fill_probability"],
                ),
            )
        )
    return boreholes
