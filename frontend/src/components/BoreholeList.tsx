/** Danh sách lỗ khoan tìm được, sắp theo khoảng cách. */

import type { Borehole } from "../types";
import Icon from "./Icon";

interface BoreholeListProps {
  boreholes: Borehole[];
  selectedId: number | null;
  loading: boolean;
  /** Chỉ bật bộ lọc với vai trò phải trả xu — vai trò khác xem được tất cả. */
  showFilter: boolean;
  onlyUnlocked: boolean;
  onFilterChange: (onlyUnlocked: boolean) => void;
  onSelect: (borehole: Borehole) => void;
}

export default function BoreholeList({
  boreholes,
  selectedId,
  loading,
  showFilter,
  onlyUnlocked,
  onFilterChange,
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

      {showFilter && (
        <div className="segmented" role="group" aria-label="Lọc hố khoan">
          <button
            type="button"
            className={onlyUnlocked ? "" : "active"}
            aria-pressed={!onlyUnlocked}
            onClick={() => onFilterChange(false)}
          >
            Tất cả
          </button>
          <button
            type="button"
            className={onlyUnlocked ? "active" : ""}
            aria-pressed={onlyUnlocked}
            onClick={() => onFilterChange(true)}
          >
            <Icon name="key" size={12} /> Đã mua
          </button>
        </div>
      )}

      {boreholes.length === 0 && (
        <div className="panel-empty">
          {onlyUnlocked
            ? "Chưa mua hố khoan nào trong khu vực này. Bỏ lọc để xem tất cả hố khoan quanh đây."
            : "Không có lỗ khoan nào ở khu vực này. Hãy tăng bán kính tìm kiếm hoặc chọn vị trí khác trên bản đồ."}
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
            {!borehole.is_unlocked && (
              <Icon name="lock" size={12} label="Chưa mở khoá" />
            )}
            {borehole.distance_m !== null && <>{borehole.distance_m} m · </>}
            sâu {borehole.depth_m} m
          </span>
        </button>
      ))}
    </div>
  );
}
