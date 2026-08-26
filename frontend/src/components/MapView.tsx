/** Bản đồ Leaflet: chọn điểm tìm kiếm và hiển thị lỗ khoan. */

import L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import {
  Circle,
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  Rectangle,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { distanceM } from "../map/geo";
import { sessionVertices, useMapPick } from "../map/MapPickContext";
import type { Borehole, BoundingBox, Project } from "../types";

const INITIAL_ZOOM = 17;

/** Đọc token màu từ CSS để marker đổi theo giao diện sáng/tối. */
function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** Đỉnh đang vẽ: đánh số để thấy rõ thứ tự nối các điểm. */
function vertexIcon(index: number, numbered: boolean): L.DivIcon {
  const colour = token("--color-accent", "#d97706");
  const size = numbered ? 22 : 16;
  return L.divIcon({
    className: "",
    html:
      `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${colour};` +
      `border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35);color:#fff;font:600 11px/` +
      `${size - 4}px sans-serif;text-align:center">${numbered ? index : ""}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
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

/**
 * Điều hướng thao tác chuột trên bản đồ.
 *
 * Khi đang có phiên chọn toạ độ, cú nhấp phải đi vào phiên đó chứ không được
 * kích hoạt tìm kiếm như bình thường — nếu không, mỗi lần đặt một đỉnh ranh
 * giới là danh sách hố khoan lại bị nạp lại.
 */
function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  const pick = useMapPick();

  useMapEvents({
    click(event) {
      const point = { lat: event.latlng.lat, lng: event.latlng.lng };
      if (pick.isPicking) {
        pick.addPoint(point);
        return;
      }
      onPick(point.lat, point.lng);
    },
    mousemove(event) {
      // Xem trước hình chữ nhật / hình tròn ngay khi rê chuột.
      if (!pick.isPicking) return;
      const mode = pick.session?.mode;
      if (mode !== "rectangle" && mode !== "circle") return;
      if (pick.session && pick.session.points.length !== 1) return;
      pick.setHover({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}

/** Lớp vẽ xem trước trong lúc chọn toạ độ. */
function PickLayer() {
  const { session } = useMapPick();
  if (!session) return null;

  const vertices = sessionVertices(session);
  const outline = { color: token("--color-accent", "#d97706"), weight: 2, fillOpacity: 0.12 };
  const marks = session.points.map((point, index) => (
    <Marker
      key={`${point.lat}-${point.lng}-${index}`}
      position={[point.lat, point.lng]}
      icon={vertexIcon(index + 1, session.mode === "polygon")}
    />
  ));

  if (session.mode === "circle" && session.points.length >= 1) {
    const edge = session.points[1] ?? session.hover;
    return (
      <>
        {edge && (
          <Circle center={[session.points[0].lat, session.points[0].lng]}
            radius={distanceM(session.points[0], edge)} pathOptions={outline} />
        )}
        {marks}
      </>
    );
  }

  if (session.mode === "rectangle" && session.points.length >= 1) {
    const corner = session.points[1] ?? session.hover;
    return (
      <>
        {corner && (
          <Rectangle
            bounds={[
              [session.points[0].lat, session.points[0].lng],
              [corner.lat, corner.lng],
            ]}
            pathOptions={outline}
          />
        )}
        {marks}
      </>
    );
  }

  return (
    <>
      {vertices.length >= 3 && (
        <Polygon positions={vertices.map((v) => [v.lat, v.lng] as [number, number])}
          pathOptions={outline} />
      )}
      {session.mode === "polygon" && vertices.length === 2 && (
        <Polyline positions={vertices.map((v) => [v.lat, v.lng] as [number, number])}
          pathOptions={{ ...outline, dashArray: "5 4" }} />
      )}
      {marks}
    </>
  );
}

/**
 * Điều khiển khung nhìn bản đồ.
 *
 * Gộp hai việc vào một chỗ vì nếu tách thành hai component, cả hai cùng gọi
 * setView trong một lần render và cái chạy sau sẽ xoá kết quả của cái trước.
 *
 * - Có khung bao mới (chọn địa điểm từ ô tìm kiếm): phóng vừa khít khung đó.
 * - Chỉ đổi tâm: dời tới nhưng GIỮ NGUYÊN mức zoom người dùng đang xem.
 */
function ViewController({
  center,
  focusBounds,
}: {
  center: [number, number];
  focusBounds: BoundingBox | null;
}) {
  const map = useMap();
  const lastCenter = useRef<[number, number] | null>(null);
  const lastBounds = useRef<BoundingBox | null>(null);

  useEffect(() => {
    if (!focusBounds || focusBounds === lastBounds.current) return;
    lastBounds.current = focusBounds;
    // Ghi nhận luôn tâm để lần chạy sau không dời lại chồng lên.
    lastCenter.current = center;
    map.fitBounds(
      [
        [focusBounds.south, focusBounds.west],
        [focusBounds.north, focusBounds.east],
      ],
      { padding: [40, 40], maxZoom: 18 },
    );
  }, [map, focusBounds, center]);

  useEffect(() => {
    const [lat, lng] = center;
    const last = lastCenter.current;
    if (last && last[0] === lat && last[1] === lng) return;
    lastCenter.current = [lat, lng];
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
  /** Khung bao của địa điểm vừa chọn từ ô tìm kiếm. */
  focusBounds: BoundingBox | null;
  onPick: (lat: number, lng: number) => void;
  onSelect: (borehole: Borehole) => void;
}

export default function MapView({
  center,
  radiusM,
  boreholes,
  projects,
  selectedId,
  focusBounds,
  onPick,
  onSelect,
}: MapViewProps) {
  const { isPicking } = useMapPick();
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
      <ViewController center={center} focusBounds={focusBounds} />
      <ClickHandler onPick={onPick} />
      <PickLayer />

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

      {!isPicking && (
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

      {!isPicking && (
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
