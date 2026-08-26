"""Tra cứu địa điểm bằng tên, qua dịch vụ Nominatim của OpenStreetMap.

Vì sao đi vòng qua backend thay vì gọi thẳng từ trình duyệt:

* Nominatim yêu cầu mỗi ứng dụng khai báo User-Agent riêng để nhận diện, mà mã
  JavaScript trong trình duyệt không được phép đặt header này.
* Chính sách sử dụng giới hạn 1 yêu cầu/giây. Gọi từ trình duyệt thì mỗi người
  dùng là một nguồn riêng, không cách nào kiểm soát; gọi tập trung ở đây thì
  chặn được bằng một hàng đợi duy nhất.
* Cùng một địa danh được tra đi tra lại rất nhiều, nên bộ nhớ đệm ở máy chủ cắt
  được phần lớn lưu lượng.

Dùng urllib của thư viện chuẩn để không phải thêm phụ thuộc mới; các endpoint
đều là hàm đồng bộ nên FastAPI đã chạy chúng trong luồng riêng.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict
from dataclasses import dataclass

logger = logging.getLogger(__name__)


class GeocodingUnavailableError(RuntimeError):
    """Không hỏi được dịch vụ bên ngoài — mất mạng, quá hạn chờ hoặc bị chặn."""


@dataclass(frozen=True)
class BoundingBox:
    south: float
    west: float
    north: float
    east: float


@dataclass(frozen=True)
class Place:
    name: str
    display_name: str
    lat: float
    lng: float
    category: str | None
    bbox: BoundingBox | None


class _Throttle:
    """Giữ khoảng cách tối thiểu giữa hai lần gọi ra ngoài.

    Có khoá vì FastAPI chạy các hàm đồng bộ trên nhiều luồng, nếu không thì hai
    yêu cầu đến cùng lúc sẽ cùng vượt qua phép kiểm tra.
    """

    def __init__(self, min_interval_s: float) -> None:
        self._min_interval = min_interval_s
        self._lock = threading.Lock()
        self._last_call = 0.0

    def wait(self) -> None:
        with self._lock:
            delay = self._min_interval - (time.monotonic() - self._last_call)
            if delay > 0:
                time.sleep(delay)
            self._last_call = time.monotonic()


class _TtlCache:
    """Bộ đệm LRU có hạn dùng, đủ cho nhu cầu tra địa danh."""

    def __init__(self, max_entries: int, ttl_s: float) -> None:
        self._max_entries = max_entries
        self._ttl = ttl_s
        self._lock = threading.Lock()
        self._items: OrderedDict[str, tuple[float, list[Place]]] = OrderedDict()

    def get(self, key: str) -> list[Place] | None:
        with self._lock:
            found = self._items.get(key)
            if found is None:
                return None
            stored_at, value = found
            if time.monotonic() - stored_at > self._ttl:
                del self._items[key]
                return None
            self._items.move_to_end(key)
            return value

    def put(self, key: str, value: list[Place]) -> None:
        with self._lock:
            self._items[key] = (time.monotonic(), value)
            self._items.move_to_end(key)
            while len(self._items) > self._max_entries:
                self._items.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()


def parse_places(payload: list[dict]) -> list[Place]:
    """Chuyển phản hồi thô của Nominatim sang cấu trúc của ứng dụng.

    Bỏ qua các mục thiếu toạ độ thay vì làm hỏng cả kết quả tìm kiếm.
    """
    places: list[Place] = []
    for item in payload:
        try:
            lat = float(item["lat"])
            lng = float(item["lon"])
        except (KeyError, TypeError, ValueError):
            continue

        display_name = str(item.get("display_name", "")).strip()
        if not display_name:
            continue

        bbox = None
        raw_box = item.get("boundingbox")
        # Nominatim trả về [nam, bắc, tây, đông] dưới dạng chuỗi.
        if isinstance(raw_box, list) and len(raw_box) == 4:
            try:
                south, north, west, east = (float(value) for value in raw_box)
                bbox = BoundingBox(south=south, west=west, north=north, east=east)
            except (TypeError, ValueError):
                bbox = None

        places.append(
            Place(
                name=str(item.get("name") or display_name.split(",")[0]).strip(),
                display_name=display_name,
                lat=lat,
                lng=lng,
                category=item.get("type") or item.get("class"),
                bbox=bbox,
            )
        )
    return places


class NominatimClient:
    def __init__(
        self,
        base_url: str,
        user_agent: str,
        *,
        country_codes: str = "",
        timeout_s: float = 6.0,
        min_interval_s: float = 1.0,
        cache_entries: int = 256,
        cache_ttl_s: float = 3600.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._user_agent = user_agent
        self._country_codes = country_codes
        self._timeout = timeout_s
        self._throttle = _Throttle(min_interval_s)
        self._cache = _TtlCache(cache_entries, cache_ttl_s)

    def search(self, query: str, limit: int = 6) -> list[Place]:
        cleaned = " ".join(query.split())
        if len(cleaned) < 2:
            return []

        cache_key = f"{cleaned.lower()}|{limit}"
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        params = {
            "q": cleaned,
            "format": "jsonv2",
            "limit": str(limit),
            "addressdetails": "0",
            "accept-language": "vi",
        }
        if self._country_codes:
            params["countrycodes"] = self._country_codes

        url = f"{self._base_url}/search?{urllib.parse.urlencode(params)}"
        request = urllib.request.Request(url, headers={"User-Agent": self._user_agent})

        self._throttle.wait()
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            logger.warning("Không gọi được Nominatim: %s", exc)
            raise GeocodingUnavailableError("Không kết nối được dịch vụ tra cứu địa điểm") from exc
        except json.JSONDecodeError as exc:
            logger.warning("Nominatim trả về dữ liệu không hợp lệ")
            raise GeocodingUnavailableError("Dịch vụ tra cứu trả về dữ liệu không đọc được") from exc

        if not isinstance(payload, list):
            raise GeocodingUnavailableError("Dịch vụ tra cứu trả về dữ liệu không đúng định dạng")

        places = parse_places(payload)
        self._cache.put(cache_key, places)
        return places
