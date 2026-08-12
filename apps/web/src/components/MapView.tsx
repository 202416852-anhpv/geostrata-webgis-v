import { useEffect, useMemo } from "react";
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { Borehole } from "@geostrata/shared";

function ClickHandler({
  onPick,
}: {
  onPick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e: L.LeafletMouseEvent) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function RecenterView({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, 17);
  }, [map, center]);
  return null;
}

interface MapViewProps {
  center: [number, number];
  onPick: (lat: number, lng: number) => void;
  boreholes: Borehole[];
  radius: number;
  selectedId: string | null;
  onSelect: (b: Borehole) => void;
}

export default function MapView({
  center,
  onPick,
  boreholes,
  radius,
  selectedId,
  onSelect,
}: MapViewProps) {
  const markerIcon = useMemo(
    () =>
      L.divIcon({
        className: "",
        html: `<div style="width:20px;height:20px;border-radius:50%;background:#d9534f;border:2px solid #fff;"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      }),
    []
  );

  const boreholeIcon = useMemo(
    () =>
      L.divIcon({
        className: "",
        html: `<div style="width:16px;height:16px;border-radius:50%;background:#0056b3;border:2px solid #fff;"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
    []
  );

  const selectedIcon = useMemo(
    () =>
      L.divIcon({
        className: "",
        html: `<div style="width:24px;height:24px;border-radius:50%;background:#ffc107;border:3px solid #fff;"></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      }),
    []
  );

  return (
    <MapContainer
      center={center}
      zoom={17}
      style={{ width: "100%", height: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <RecenterView center={center} />
      <ClickHandler onPick={onPick} />
      <Circle center={center} radius={radius} pathOptions={{ color: "#0056b3", weight: 1.5, dashArray: "6 4" }} />
      <Marker position={center} icon={markerIcon}>
        <Popup>
          Tâm tìm kiếm: {center[0].toFixed(6)}, {center[1].toFixed(6)}
        </Popup>
      </Marker>
      {boreholes.map((b) => (
        <Marker
          key={b.id}
          position={[b.lat, b.lng]}
          icon={b.id === selectedId ? selectedIcon : boreholeIcon}
          eventHandlers={{ click: () => onSelect(b) }}
        >
          <Popup>
            <strong>{b.ten}</strong>
            <br />
            Cách {b.distance}m · sâu {b.doSau}m
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}