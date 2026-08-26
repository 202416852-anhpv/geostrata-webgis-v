"""Kiểm thử bộ tra cứu địa điểm: đọc dữ liệu, bộ đệm và hạn tốc.

Không gọi ra Internet — phần gọi mạng được thay bằng hàm giả.
"""

from __future__ import annotations

import threading
import time

import pytest

from app.geocoding import (
    GeocodingUnavailableError,
    NominatimClient,
    _Throttle,
    _TtlCache,
    parse_places,
)

SAMPLE = [
    {
        "name": "Quận 1",
        "display_name": "Quận 1, Thành phố Hồ Chí Minh, Việt Nam",
        "lat": "10.7756587",
        "lon": "106.7004238",
        "type": "administrative",
        "boundingbox": ["10.7621", "10.7930", "106.6836", "106.7166"],
    }
]


# --- Đọc dữ liệu trả về ------------------------------------------------------


def test_parses_a_normal_result() -> None:
    places = parse_places(SAMPLE)
    assert len(places) == 1
    place = places[0]
    assert place.name == "Quận 1"
    assert place.lat == pytest.approx(10.7756587)
    assert place.lng == pytest.approx(106.7004238)
    assert place.category == "administrative"


def test_bounding_box_order_is_translated() -> None:
    """Nominatim trả [nam, bắc, tây, đông]; ứng dụng dùng tên trường rõ nghĩa."""
    bbox = parse_places(SAMPLE)[0].bbox
    assert bbox is not None
    assert bbox.south == pytest.approx(10.7621)
    assert bbox.north == pytest.approx(10.7930)
    assert bbox.west == pytest.approx(106.6836)
    assert bbox.east == pytest.approx(106.7166)


@pytest.mark.parametrize(
    "broken",
    [
        {"display_name": "Thiếu toạ độ"},
        {"lat": "khong-phai-so", "lon": "106.7", "display_name": "X"},
        {"lat": "10.7", "lon": "106.7", "display_name": "   "},
        {},
    ],
)
def test_skips_unusable_entries_instead_of_failing(broken: dict) -> None:
    """Một mục hỏng không được làm mất cả danh sách kết quả."""
    places = parse_places([broken, *SAMPLE])
    assert len(places) == 1
    assert places[0].name == "Quận 1"


def test_missing_bounding_box_is_tolerated() -> None:
    item = {k: v for k, v in SAMPLE[0].items() if k != "boundingbox"}
    assert parse_places([item])[0].bbox is None


def test_malformed_bounding_box_is_dropped_not_fatal() -> None:
    item = SAMPLE[0] | {"boundingbox": ["a", "b", "c", "d"]}
    assert parse_places([item])[0].bbox is None


def test_name_falls_back_to_first_part_of_address() -> None:
    item = {k: v for k, v in SAMPLE[0].items() if k != "name"}
    assert parse_places([item])[0].name == "Quận 1"


# --- Bộ đệm ------------------------------------------------------------------


def test_cache_returns_stored_value() -> None:
    cache = _TtlCache(max_entries=4, ttl_s=60)
    cache.put("a", [])
    assert cache.get("a") == []
    assert cache.get("chua-co") is None


def test_cache_expires_entries() -> None:
    cache = _TtlCache(max_entries=4, ttl_s=0.05)
    cache.put("a", [])
    time.sleep(0.08)
    assert cache.get("a") is None


def test_cache_evicts_least_recently_used() -> None:
    cache = _TtlCache(max_entries=2, ttl_s=60)
    cache.put("a", [])
    cache.put("b", [])
    cache.get("a")  # "a" vừa dùng nên "b" mới là mục cũ nhất
    cache.put("c", [])
    assert cache.get("a") is not None
    assert cache.get("b") is None
    assert cache.get("c") is not None


# --- Hạn tốc -----------------------------------------------------------------


def test_throttle_spaces_out_calls() -> None:
    throttle = _Throttle(min_interval_s=0.05)
    started = time.monotonic()
    for _ in range(3):
        throttle.wait()
    # Lần đầu đi ngay, hai lần sau mỗi lần chờ một nhịp.
    assert time.monotonic() - started >= 0.1


def test_throttle_is_safe_across_threads() -> None:
    """FastAPI chạy hàm đồng bộ trên nhiều luồng nên bộ hạn tốc phải có khoá."""
    throttle = _Throttle(min_interval_s=0.03)
    stamps: list[float] = []
    lock = threading.Lock()

    def call() -> None:
        throttle.wait()
        with lock:
            stamps.append(time.monotonic())

    threads = [threading.Thread(target=call) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    stamps.sort()
    gaps = [b - a for a, b in zip(stamps, stamps[1:], strict=False)]
    assert all(gap >= 0.025 for gap in gaps), f"có hai lần gọi quá sát nhau: {gaps}"


# --- Toàn bộ client ----------------------------------------------------------


def make_client(**overrides) -> NominatimClient:
    options = {
        "base_url": "https://example.invalid",
        "user_agent": "test",
        "min_interval_s": 0,
        "timeout_s": 0.1,
    } | overrides
    return NominatimClient(**options)


@pytest.mark.parametrize("query", ["", " ", "a"])
def test_short_query_never_calls_upstream(query: str) -> None:
    """Gõ một ký tự thì chưa tra cứu, tránh phí lượt gọi có giới hạn."""
    assert make_client().search(query) == []


def test_network_failure_raises_domain_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """Lỗi mạng phải thành lỗi nghiệp vụ để router trả 503 thay vì 500."""

    def explode(*_args, **_kwargs):
        raise OSError("mat mang")

    monkeypatch.setattr("app.geocoding.urllib.request.urlopen", explode)
    with pytest.raises(GeocodingUnavailableError):
        make_client().search("Quận 1")
