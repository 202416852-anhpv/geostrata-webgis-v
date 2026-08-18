/** Danh sách lỗ khoan tìm được, sắp theo khoảng cách. */

import type { Borehole } from "../types";
import Icon from "./Icon";

interface BoreholeListProps {
  boreholes: Borehole[];
  selectedId: number | null;
  loading: boolean;
  onSelect: (borehole: Borehole) => void;
}

export default function BoreholeList({
  boreholes,
  selectedId,
  loading,
  onSelect,
}: BoreholeListProps) {
  if (loading) {
    return <div className="panel-list">Đang tải dữ liệu...</div>;
  }

  return (
    <div className="panel-list">
      <div className="panel-title">
        <Icon name="map-pin" size={13} /> Hố khoan trong bán kính
        <span className="count-badge">{boreholes.length}</span>
      </div>

      {boreholes.length === 0 && (
        <div className="panel-empty">
          Không có lỗ khoan nào ở khu vực này. Hãy tăng bán kính tìm kiếm hoặc chọn
          vị trí khác trên bản đồ.
        </div>
      )}

      {boreholes.map((borehole) => (
        <button
          key={borehole.id}
          type="button"
          className={`panel-item ${borehole.id === selectedId ? "active" : ""}`}
          onClick={() => onSelect(borehole)}
        >
          <span className="item-main">
            <span className="item-name">{borehole.name}</span>
            <span className="item-project">{borehole.project_code}</span>
          </span>
          <span className="item-meta">
            {borehole.distance_m !== null && <>{borehole.distance_m} m · </>}
            sâu {borehole.depth_m} m
          </span>
        </button>
      ))}
    </div>
  );
}
