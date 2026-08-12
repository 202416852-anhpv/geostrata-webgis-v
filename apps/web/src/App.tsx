import { useCallback, useEffect, useState } from "react";
import { Borehole, BoreholeSection } from "@geostrata/shared";
import MapView from "./components/MapView";
import CoordInput from "./components/CoordInput";
import BoreholeList from "./components/BoreholeList";
import CrossSection from "./components/CrossSection";
import { fetchBoreholes, fetchSection } from "./api";

const RADIUS = 50;

export default function App() {
  const [center, setCenter] = useState<[number, number]>([10.7769, 106.6953]);
  const [boreholes, setBoreholes] = useState<Borehole[]>([]);
  const [selected, setSelected] = useState<Borehole | null>(null);
  const [section, setSection] = useState<BoreholeSection | null>(null);
  const [loading, setLoading] = useState(false);
  const [sectionLoading, setSectionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (lat: number, lng: number) => {
    setCenter([lat, lng]);
    setSelected(null);
    setSection(null);
    setError(null);
    setLoading(true);
    try {
      const res = await fetchBoreholes(lat, lng, RADIUS);
      setBoreholes(res.boreholes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra");
      setBoreholes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    search(center[0], center[1]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = useCallback(async (b: Borehole) => {
    setSelected(b);
    setSection(null);
    setSectionLoading(true);
    setError(null);
    try {
      const s = await fetchSection(b);
      setSection(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra");
    } finally {
      setSectionLoading(false);
    }
  }, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <strong>GeoStrata</strong>
          <span>WebGIS Lỗ Khoan Địa Chất</span>
        </div>

        <div className="panel">
          <div className="panel-title">Vị trí tìm kiếm</div>
          <CoordInput onSearch={search} loading={loading} />
          <div className="hint">
            Hoặc nhấp trực tiếp lên bản đồ bên phải. Phạm vi tìm:{" "}
            <strong>{RADIUS} m</strong>
          </div>
        </div>

        {error && <div className="error">{error}</div>}

        <BoreholeList
          boreholes={boreholes}
          selectedId={selected?.id ?? null}
          onSelect={handleSelect}
          loading={loading}
        />

        {selected && (
          <div className="panel selected-info">
            Đã chọn <strong>{selected.ten}</strong>
          </div>
        )}
      </aside>

      <main className="map-area">
        <MapView
          center={center}
          onPick={(lat, lng) => search(lat, lng)}
          boreholes={boreholes}
          radius={RADIUS}
          selectedId={selected?.id ?? null}
          onSelect={handleSelect}
        />
      </main>

      {(sectionLoading || section) && (
        <div className="section-overlay">
          <button
            className="close-btn"
            onClick={() => {
              setSelected(null);
              setSection(null);
            }}
          >
            ✕
          </button>
          {sectionLoading ? (
            <div className="panel-list">Đang tạo mặt cắt...</div>
          ) : (
            section && <CrossSection section={section} />
          )}
        </div>
      )}
    </div>
  );
}