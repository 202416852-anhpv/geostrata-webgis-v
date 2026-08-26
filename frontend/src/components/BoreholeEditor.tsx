/** Biểu mẫu thêm / sửa lỗ khoan và địa tầng — dành cho manager trở lên. */

import { useCallback, useEffect, useState, type FormEvent } from "react";
import * as api from "../api";
import { ApiError } from "../api";
import { useMapPick } from "../map/MapPickContext";
import FormError from "./FormError";
import Icon from "./Icon";
import type {
  Borehole,
  BoreholeSection,
  LayerInput,
  LocationKind,
  Project,
  SoilType,
} from "../types";

interface DraftLayer {
  soil_code: string;
  top_depth_m: string;
  bottom_depth_m: string;
}

interface BoreholeEditorProps {
  /** Có giá trị = chế độ sửa; bỏ trống = thêm mới. */
  existing?: BoreholeSection | null;
  defaultCenter: [number, number];
  onSaved: (borehole: Borehole) => void;
  onClose: () => void;
}

/**
 * Kiểm tra địa tầng ngay trên trình duyệt.
 *
 * Backend cũng kiểm tra y hệt (schemas.py) — đây chỉ là để người nhập thấy lỗi
 * ngay, không phải để thay thế. Ràng buộc thật luôn nằm ở phía máy chủ.
 */
function validateLayers(layers: DraftLayer[], depth: number): string | null {
  if (layers.length === 0) return null;

  const parsed = layers.map((layer, index) => ({
    index,
    soil: layer.soil_code,
    top: Number(layer.top_depth_m),
    bottom: Number(layer.bottom_depth_m),
  }));

  for (const layer of parsed) {
    if (!layer.soil) return `Lớp ${layer.index + 1}: chưa chọn loại đất`;
    if (!Number.isFinite(layer.top) || !Number.isFinite(layer.bottom)) {
      return `Lớp ${layer.index + 1}: độ sâu không hợp lệ`;
    }
    if (layer.bottom <= layer.top) {
      return `Lớp ${layer.index + 1}: đáy phải sâu hơn đỉnh`;
    }
  }

  const ordered = [...parsed].sort((a, b) => a.top - b.top);
  if (Math.abs(ordered[0].top) > 0.01) return "Lớp đầu tiên phải bắt đầu từ 0 m";

  for (let i = 0; i < ordered.length - 1; i += 1) {
    if (Math.abs(ordered[i].bottom - ordered[i + 1].top) > 0.01) {
      return `Địa tầng hở hoặc chồng lớp tại ${ordered[i].bottom} m và ${ordered[i + 1].top} m`;
    }
  }

  const last = ordered.at(-1)!;
  if (Math.abs(last.bottom - depth) > 0.01) {
    return `Lớp cuối kết thúc ở ${last.bottom} m nhưng lỗ khoan sâu ${depth} m`;
  }
  return null;
}

export default function BoreholeEditor({
  existing,
  defaultCenter,
  onSaved,
  onClose,
}: BoreholeEditorProps) {
  const isEdit = Boolean(existing);
  const borehole = existing?.borehole;

  const pick = useMapPick();
  const [soilTypes, setSoilTypes] = useState<SoilType[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectCode, setProjectCode] = useState(borehole?.project_code ?? "");
  const [locationKind, setLocationKind] = useState<LocationKind>(
    borehole?.location_kind ?? "point",
  );
  const [drillingCompany, setDrillingCompany] = useState(borehole?.drilling_company ?? "");
  const [code, setCode] = useState(borehole?.code ?? "");
  const [lat, setLat] = useState(String(borehole?.lat ?? defaultCenter[0]));
  const [lng, setLng] = useState(String(borehole?.lng ?? defaultCenter[1]));
  const [depth, setDepth] = useState(String(borehole?.depth_m ?? 40));
  const [groundLevel, setGroundLevel] = useState(String(borehole?.ground_level_m ?? ""));
  const [waterLevel, setWaterLevel] = useState(String(borehole?.water_level_m ?? ""));
  const [drilledOn, setDrilledOn] = useState(borehole?.drilled_on ?? "");
  const [layers, setLayers] = useState<DraftLayer[]>(
    existing?.layers.map((layer) => ({
      soil_code: layer.soil_code,
      top_depth_m: String(layer.top_depth_m),
      bottom_depth_m: String(layer.bottom_depth_m),
    })) ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const [soils, projectList] = await Promise.all([
          api.fetchSoilTypes(controller.signal),
          api.fetchProjects(controller.signal),
        ]);
        setSoilTypes(soils);
        setProjects(projectList);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("Không tải được danh mục đất và công trình");
      }
    })();
    return () => controller.abort();
  }, []);

  /** Chọn vị trí hố khoan bằng cách nhấp lên bản đồ thay vì gõ toạ độ. */
  const pickLocation = async () => {
    const current = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
      ? [{ lat: Number(lat), lng: Number(lng) }]
      : [];
    const picked = await pick.start({
      label: "Vị trí hố khoan",
      modes: ["point"],
      initial: current,
    });
    if (!picked || picked.length === 0) return;
    setLat(picked[0].lat.toFixed(6));
    setLng(picked[0].lng.toFixed(6));
    setError(null);
  };

  /** Lớp mới nối tiếp đáy lớp cuối, để mặc định đã liền mạch. */
  const addLayer = useCallback(() => {
    setLayers((current) => {
      const previousBottom = current.at(-1)?.bottom_depth_m ?? "0";
      return [
        ...current,
        { soil_code: soilTypes[0]?.code ?? "", top_depth_m: previousBottom, bottom_depth_m: depth },
      ];
    });
  }, [soilTypes, depth]);

  const updateLayer = (index: number, patch: Partial<DraftLayer>) => {
    setLayers((current) =>
      current.map((layer, i) => (i === index ? { ...layer, ...patch } : layer)),
    );
  };

  const removeLayer = (index: number) => {
    setLayers((current) => current.filter((_, i) => i !== index));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const depthValue = Number(depth);
    const latValue = Number(lat);
    const lngValue = Number(lng);
    const needsCoordinates = locationKind === "point";

    if (!Number.isFinite(depthValue) || depthValue <= 0) {
      setError("Chiều sâu phải là số dương");
      return;
    }
    if (needsCoordinates && (!Number.isFinite(latValue) || Math.abs(latValue) > 90)) {
      setError("Vĩ độ không hợp lệ");
      return;
    }
    if (needsCoordinates && (!Number.isFinite(lngValue) || Math.abs(lngValue) > 180)) {
      setError("Kinh độ không hợp lệ");
      return;
    }
    if (locationKind === "project_area" && !projectCode) {
      setError("Hố khoan chưa rõ vị trí phải thuộc một công trình");
      return;
    }
    const layerError = validateLayers(layers, depthValue);
    if (layerError) {
      setError(layerError);
      return;
    }

    const payloadLayers: LayerInput[] = layers.map((layer) => ({
      soil_code: layer.soil_code,
      top_depth_m: Number(layer.top_depth_m),
      bottom_depth_m: Number(layer.bottom_depth_m),
    }));

    const common = {
      name: code.trim() || null,
      // Chưa rõ vị trí thì không gửi toạ độ — backend từ chối nếu gửi kèm.
      lat: needsCoordinates ? latValue : null,
      lng: needsCoordinates ? lngValue : null,
      location_kind: locationKind,
      drilling_company: drillingCompany.trim() || null,
      depth_m: depthValue,
      ground_level_m: groundLevel === "" ? null : Number(groundLevel),
      water_level_m: waterLevel === "" ? null : Number(waterLevel),
      drilled_on: drilledOn || null,
      layers: payloadLayers,
    };

    setError(null);
    setBusy(true);
    try {
      const saved = isEdit
        ? await api.updateBorehole(borehole!.id, common)
        : await api.createBorehole({
            ...common,
            code: code.trim(),
            project_code: projectCode || null,
          });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không lưu được lỗ khoan");
    } finally {
      setBusy(false);
    }
  };

  const depthValue = Number(depth);
  const liveError = validateLayers(layers, Number.isFinite(depthValue) ? depthValue : 0);

  return (
    <div
      className={`modal-overlay ${pick.isPicking ? "is-hidden" : ""}`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        className="modal-panel"
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "Sửa lỗ khoan" : "Thêm lỗ khoan"}
      >
        <header className="modal-header">
          <h2>
            <Icon name="drill" size={18} />
            {isEdit ? `Sửa hố khoan ${borehole?.code}` : "Thêm hố khoan"}
          </h2>
          <button type="button" className="close-btn-inline" onClick={onClose} aria-label="Đóng">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="form-grid">
          <label>
            Công trình
            <select value={projectCode} disabled={isEdit} onChange={(e) => setProjectCode(e.target.value)}>
              <option value="">— Không thuộc công trình nào —</option>
              {projects.map((project) => (
                <option key={project.code} value={project.code}>
                  {project.code} — {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Mã hố khoan
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={isEdit}
              placeholder="HK-01"
              required
            />
          </label>
          <label>
            Vị trí
            <select
              value={locationKind}
              onChange={(e) => setLocationKind(e.target.value as LocationKind)}
            >
              <option value="point">Có toạ độ</option>
              <option value="project_area">Chưa rõ vị trí (dùng chung cho công trình)</option>
            </select>
          </label>
          <label>
            Công ty khoan
            <input
              value={drillingCompany}
              onChange={(e) => setDrillingCompany(e.target.value)}
              placeholder="Tên đơn vị thi công khoan"
            />
          </label>
          {locationKind === "point" && (
            <>
              <div className="form-wide pick-row">
                <button type="button" className="primary" onClick={() => void pickLocation()}>
                  <Icon name="crosshair" /> Chọn vị trí trên bản đồ
                </button>
                <span className="field-hint">
                  Hoặc gõ trực tiếp toạ độ vào hai ô bên dưới.
                </span>
              </div>
              <label>
                Vĩ độ
                <input
                  type="number"
                  step="any"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  required
                />
              </label>
              <label>
                Kinh độ
                <input
                  type="number"
                  step="any"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  required
                />
              </label>
            </>
          )}
          <label>
            Chiều sâu (m)
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={depth}
              onChange={(e) => setDepth(e.target.value)}
              required
            />
          </label>
          <label>
            Cao độ mặt đất (m)
            <input
              type="number"
              step="0.01"
              value={groundLevel}
              onChange={(e) => setGroundLevel(e.target.value)}
            />
          </label>
          <label>
            Mực nước ngầm (m)
            <input
              type="number"
              step="0.1"
              min="0"
              value={waterLevel}
              onChange={(e) => setWaterLevel(e.target.value)}
            />
          </label>
          <label>
            Ngày khoan
            <input type="date" value={drilledOn} onChange={(e) => setDrilledOn(e.target.value)} />
          </label>
        </div>

        {locationKind === "project_area" && (
          <p className="hint">
            Địa tầng này áp cho cả công trình. Hố khoan sẽ không hiện trên bản đồ vì
            không có toạ độ, nhưng vẫn tra được trong danh sách hố khoan của công trình.
          </p>
        )}

        <div className="modal-section-title">
          <span>
            <Icon name="layers" size={13} /> Địa tầng
          </span>
          <button type="button" onClick={addLayer} disabled={soilTypes.length === 0}>
            <Icon name="plus" /> Thêm lớp
          </button>
        </div>

        {layers.length === 0 && (
          <p className="panel-empty">
            Chưa có lớp nào. Có thể lưu trước rồi nhập địa tầng sau, hoặc bấm “Thêm lớp”.
          </p>
        )}

        {layers.map((layer, index) => (
          <div className="layer-row" key={index}>
            <select
              value={layer.soil_code}
              onChange={(e) => updateLayer(index, { soil_code: e.target.value })}
              required
            >
              <option value="">— chọn loại đất —</option>
              {soilTypes.map((soil) => (
                <option key={soil.code} value={soil.code}>
                  {soil.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="0.1"
              min="0"
              value={layer.top_depth_m}
              onChange={(e) => updateLayer(index, { top_depth_m: e.target.value })}
              aria-label={`Đỉnh lớp ${index + 1}`}
            />
            <span className="layer-sep">→</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={layer.bottom_depth_m}
              onChange={(e) => updateLayer(index, { bottom_depth_m: e.target.value })}
              aria-label={`Đáy lớp ${index + 1}`}
            />
            <span className="layer-unit">m</span>
            <button
              type="button"
              className="danger"
              onClick={() => removeLayer(index)}
              aria-label={`Xoá lớp ${index + 1}`}
            >
              <Icon name="trash" />
            </button>
          </div>
        ))}

        {liveError && layers.length > 0 && (
          <div className="field-error">
            <Icon name="alert" size={13} /> {liveError}
          </div>
        )}

        <FormError message={error} />

        <div className="modal-footer">
          <button type="button" onClick={onClose}>
            Huỷ
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Đang lưu..." : isEdit ? "Lưu thay đổi" : "Thêm lỗ khoan"}
          </button>
        </div>
      </form>
    </div>
  );
}
