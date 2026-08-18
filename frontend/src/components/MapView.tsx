/** Bản đồ Leaflet: chọn điểm tìm kiếm và hiển thị lỗ khoan. */

import L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import {
  Circle,
  MapContainer,
  Marker,
  Polygon,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import type { Borehole, Project } from "../types";

const INITIAL_ZOOM = 17;

/** Đọc token màu từ CSS để marker đổi theo giao diện sáng/tối. */
function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function circleIcon(size: number, colourToken: string, fallback: string, border: number): L.DivIcon {
  const background = token(colourToken, fallback);
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${background};border:${border}px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(event) {
      onPick(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

/**
 * Dời bản đồ tới tâm mới nhưng GIỮ NGUYÊN mức zoom người dùng đang xem.
 * Bản cũ ép zoom về 17 sau mỗi lần đổi tâm, phá thao tác phóng to/thu nhỏ.
 */
function RecenterView({ center }: { center: [number, number] }) {
  const map = useMap();
  const previous = useRef<[number, number] | null>(null);

  useEffect(() => {
    const [lat, lng] = center;
    const last = previous.current;
    if (last && last[0] === lat && last[1] === lng) return;
    previous.current = [lat, lng];
    map.setView(center, map.getZoom(), { animate: last !== null });
  }, [map, center]);

  return null;
}

interface MapViewProps {
  center: [number, number];
  radiusM: number;
  boreholes: Borehole[];
  projects: Project[];
  selectedId: number | null;
  onPick: (lat: number, lng: number) => void;
  onSelect: (borehole: Borehole) => void;
  /** Bật khi đang nhặt điểm ranh giới công trình. */
  pickingVertices?: boolean;
}

export default function MapView({
  center,
  radiusM,
  boreholes,
  projects,
  selectedId,
  onPick,
  onSelect,
  pickingVertices = false,
}: MapViewProps) {
  // Hố khoan khai "chưa rõ vị trí" không có toạ độ nên không vẽ được lên bản đồ.
  const mappable = useMemo(
    () => boreholes.filter((b) => b.lat !== null && b.lng !== null),
    [boreholes],
  );
  const boundaries = useMemo(
    () => projects.filter((p) => p.has_boundary && p.vertices.length >= 3),
    [projects],
  );

  const centerIcon = useMemo(() => circleIcon(18, "--color-map-centre", "#dc2626", 2), []);
  const boreholeIcon = useMemo(() => circleIcon(14, "--color-map-marker", "#1e40af", 2), []);
  const selectedIcon = useMemo(
    () => circleIcon(22, "--color-map-marker-selected", "#d97706", 3),
    [],
  );

  return (
    <MapContainer center={center} zoom={INITIAL_ZOOM} style={{ width: "100%", height: "100%" }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <RecenterView center={center} />
      <ClickHandler onPick={onPick} />

      {boundaries.map((project) => (
        <Polygon
          key={project.id}
          positions={project.vertices.map((v) => [v.lat, v.lng] as [number, number])}
          pathOptions={{ color: token("--color-map-boundary", "#6d3fd4"), weight: 2, fillOpacity: 0.08 }}
        >
          <Tooltip sticky>
            <strong>{project.name}</strong>
            <br />
            {project.code}
            {project.built_year && ` · xây ${project.built_year}`}
            <br />
            {project.area_m2 !== null && `Diện tích ${project.area_m2.toLocaleString("vi-VN")} m²`}
            <br />
            {project.borehole_count} hố khoan
          </Tooltip>
        </Polygon>
      ))}

      {!pickingVertices && (
      <Circle
        center={center}
        radius={radiusM}
        pathOptions={{
          color: token("--color-map-ring", "#1e40af"),
          weight: 1.5,
          dashArray: "6 4",
          fillOpacity: 0.04,
        }}
      />
      )}

      {!pickingVertices && (
        <Marker position={center} icon={centerIcon}>
          <Popup>
            Tâm tìm kiếm: {center[0].toFixed(6)}, {center[1].toFixed(6)}
            <br />
            Bán kính: {radiusM} m
          </Popup>
        </Marker>
      )}

      {mappable.map((borehole) => (
        <Marker
          key={borehole.id}
          position={[borehole.lat!, borehole.lng!]}
          icon={borehole.id === selectedId ? selectedIcon : boreholeIcon}
          eventHandlers={{ click: () => onSelect(borehole) }}
        >
          <Popup>
            <strong>{borehole.name}</strong>
            <br />
            {borehole.project_code ?? "hố khoan đơn lẻ"} · sâu {borehole.depth_m} m
            {borehole.distance_m !== null && (
              <>
                <br />
                Cách tâm {borehole.distance_m} m
              </>
            )}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
