/**
 * Ô tìm địa điểm bằng tên, nổi trên bản đồ.
 *
 * Gõ tới đâu gợi ý tới đó, nhưng có hoãn 400ms trước khi gọi: dịch vụ Nominatim
 * chỉ cho 1 yêu cầu mỗi giây, gọi theo từng phím sẽ vượt hạn ngay.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import * as api from "../api";
import { ApiError } from "../api";
import type { Place } from "../types";
import Icon from "./Icon";

const DEBOUNCE_MS = 400;
const MIN_QUERY = 2;

export default function PlaceSearch({ onSelect }: { onSelect: (place: Place) => void }) {
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(-1);

  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);

  const runSearch = useCallback(async (text: string) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;

    setLoading(true);
    setError(null);
    try {
      const result = await api.searchPlaces(text, controller.signal);
      setPlaces(result.places);
      setHighlight(result.places.length > 0 ? 0 : -1);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setPlaces([]);
      setError(err instanceof ApiError ? err.message : "Không tìm được địa điểm");
    } finally {
      if (abort.current === controller) setLoading(false);
    }
  }, []);

  // Hoãn gọi mạng cho tới khi người dùng ngừng gõ.
  useEffect(() => {
    const text = query.trim();
    if (text.length < MIN_QUERY) {
      abort.current?.abort();
      setPlaces([]);
      setError(null);
      setLoading(false);
      return;
    }
    const timer = setTimeout(() => void runSearch(text), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  // Nhấp ra ngoài thì đóng danh sách gợi ý.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const choose = (place: Place) => {
    onSelect(place);
    setQuery(place.name);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || places.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) => (current + 1) % places.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => (current - 1 + places.length) % places.length);
    } else if (event.key === "Enter" && highlight >= 0) {
      event.preventDefault();
      choose(places[highlight]);
    }
  };

  const showList = open && query.trim().length >= MIN_QUERY;

  return (
    <div className="place-search" ref={boxRef}>
      <div className="place-search-field">
        <Icon name="search" size={16} />
        <input
          type="search"
          value={query}
          placeholder="Tìm địa điểm: đường, phường, công trình..."
          aria-label="Tìm địa điểm trên bản đồ"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {query && (
          <button
            type="button"
            className="place-search-clear"
            onClick={() => {
              setQuery("");
              setPlaces([]);
              setOpen(false);
            }}
            aria-label="Xoá từ khoá"
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </div>

      {showList && (
        <ul className="place-results" id={listId} role="listbox">
          {loading && <li className="place-status">Đang tìm...</li>}

          {!loading && error && (
            <li className="place-status is-error">
              <Icon name="alert" size={14} /> {error}
            </li>
          )}

          {!loading && !error && places.length === 0 && (
            <li className="place-status">
              Không tìm thấy địa điểm nào. Thử bỏ dấu hoặc dùng tên đầy đủ hơn.
            </li>
          )}

          {!loading &&
            !error &&
            places.map((place, index) => (
              <li key={`${place.lat}-${place.lng}-${index}`} role="option" aria-selected={index === highlight}>
                <button
                  type="button"
                  className={index === highlight ? "active" : ""}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => choose(place)}
                >
                  <Icon name="map-pin" size={15} />
                  <span className="place-text">
                    <strong>{place.name}</strong>
                    <span className="place-address">{place.display_name}</span>
                  </span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
