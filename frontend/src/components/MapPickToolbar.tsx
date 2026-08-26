/** Thanh công cụ nổi trên bản đồ trong lúc chọn toạ độ. */

import { useEffect } from "react";
import { approximateAreaM2, distanceM, formatArea } from "../map/geo";
import {
  MODE_HINT,
  MODE_LABEL,
  sessionComplete,
  sessionVertices,
  useMapPick,
  type PickMode,
} from "../map/MapPickContext";
import Icon, { type IconName } from "./Icon";

const MODE_ICON: Record<PickMode, IconName> = {
  point: "map-pin",
  polygon: "layers",
  rectangle: "square",
  circle: "circle",
};

export default function MapPickToolbar() {
  const pick = useMapPick();
  const { session } = pick;

  // Esc huỷ phiên chọn, Enter kết thúc — dùng capture để bắt trước hộp thoại.
  useEffect(() => {
    if (!session) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        pick.cancel();
      }
      if (event.key === "Enter" && sessionComplete(session)) {
        event.preventDefault();
        pick.finish();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [session, pick]);

  if (!session) return null;

  const vertices = sessionVertices(session);
  const ready = sessionComplete(session);

  let readout = "Chưa chọn điểm nào";
  if (session.mode === "point" && vertices.length === 1) {
    readout = `${vertices[0].lat.toFixed(6)}, ${vertices[0].lng.toFixed(6)}`;
  } else if (session.mode === "circle" && session.points.length >= 1) {
    const edge = session.points[1] ?? session.hover;
    const radius = edge ? distanceM(session.points[0], edge) : 0;
    readout = radius
      ? `Bán kính ${Math.round(radius).toLocaleString("vi-VN")} m · ${formatArea(approximateAreaM2(vertices))}`
      : "Nhấp ra mép để chọn bán kính";
  } else if (vertices.length >= 3) {
    readout = `${session.mode === "polygon" ? `${vertices.length} điểm · ` : ""}${formatArea(approximateAreaM2(vertices))}`;
  } else if (session.points.length > 0) {
    readout = `${session.points.length} điểm — cần thêm ${3 - session.points.length}`;
  }

  return (
    <div className="pick-toolbar" role="region" aria-label={`Chọn ${session.label} trên bản đồ`}>
      <div className="pick-head">
        <Icon name="map-pin" size={16} />
        <strong>{session.label}</strong>
      </div>

      {session.modes.length > 1 && (
        <div className="pick-modes" role="group" aria-label="Kiểu vẽ">
          {session.modes.map((mode) => (
            <button
              key={mode}
              type="button"
              className={session.mode === mode ? "active" : ""}
              aria-pressed={session.mode === mode}
              onClick={() => pick.setMode(mode)}
            >
              <Icon name={MODE_ICON[mode]} size={15} />
              {MODE_LABEL[mode]}
            </button>
          ))}
        </div>
      )}

      <p className="pick-hint">{MODE_HINT[session.mode]}</p>
      <p className="pick-readout">{readout}</p>

      <div className="pick-actions">
        {session.mode === "polygon" && (
          <button
            type="button"
            onClick={pick.undo}
            disabled={session.points.length === 0}
            title="Bỏ điểm vừa đặt"
          >
            <Icon name="undo" /> Lùi
          </button>
        )}
        <button type="button" onClick={pick.clear} disabled={session.points.length === 0}>
          <Icon name="trash" /> Xoá hết
        </button>
        <button type="button" onClick={pick.cancel}>
          Huỷ
        </button>
        <button type="button" className="primary" onClick={pick.finish} disabled={!ready}>
          <Icon name="check" /> Xong
        </button>
      </div>

      <p className="pick-keys">
        Phím tắt: <kbd>Enter</kbd> xong · <kbd>Esc</kbd> huỷ
      </p>
    </div>
  );
}
