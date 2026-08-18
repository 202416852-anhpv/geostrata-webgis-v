/** Ô nhập toạ độ và bán kính tìm kiếm. */

import { useEffect, useState, type FormEvent } from "react";
import type { ClientConfig } from "../types";

interface SearchPanelProps {
  center: [number, number];
  radiusM: number;
  config: ClientConfig | null;
  loading: boolean;
  onSearch: (lat: number, lng: number, radiusM: number) => void;
}

export default function SearchPanel({
  center,
  radiusM,
  config,
  loading,
  onSearch,
}: SearchPanelProps) {
  const [lat, setLat] = useState(String(center[0]));
  const [lng, setLng] = useState(String(center[1]));
  const [radius, setRadius] = useState(String(radiusM));
  const [invalid, setInvalid] = useState<string | null>(null);

  // Click trên bản đồ cũng phải cập nhật lại ô nhập.
  useEffect(() => {
    setLat(center[0].toFixed(6));
    setLng(center[1].toFixed(6));
  }, [center]);

  useEffect(() => {
    setRadius(String(radiusM));
  }, [radiusM]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const latValue = Number(lat);
    const lngValue = Number(lng);
    const radiusValue = Number(radius);

    if (!Number.isFinite(latValue) || Math.abs(latValue) > 90) {
      setInvalid("Vĩ độ phải nằm trong khoảng -90 đến 90");
      return;
    }
    if (!Number.isFinite(lngValue) || Math.abs(lngValue) > 180) {
      setInvalid("Kinh độ phải nằm trong khoảng -180 đến 180");
      return;
    }
    const min = config?.min_search_radius_m ?? 10;
    const max = config?.max_search_radius_m ?? 5000;
    if (!Number.isFinite(radiusValue) || radiusValue < min || radiusValue > max) {
      setInvalid(`Bán kính phải nằm trong khoảng ${min} - ${max} m`);
      return;
    }

    setInvalid(null);
    onSearch(latValue, lngValue, radiusValue);
  };

  return (
    <form className="coord-form" onSubmit={handleSubmit}>
      <label>
        Vĩ độ (lat)
        <input type="number" step="any" value={lat} onChange={(e) => setLat(e.target.value)} />
      </label>
      <label>
        Kinh độ (lng)
        <input type="number" step="any" value={lng} onChange={(e) => setLng(e.target.value)} />
      </label>
      <label>
        Bán kính tìm kiếm (m)
        <input
          type="number"
          step="10"
          min={config?.min_search_radius_m}
          max={config?.max_search_radius_m}
          value={radius}
          onChange={(e) => setRadius(e.target.value)}
        />
      </label>
      {invalid && <div className="field-error">{invalid}</div>}
      <button type="submit" disabled={loading}>
        {loading ? "Đang tìm..." : "Tìm lỗ khoan"}
      </button>
    </form>
  );
}
