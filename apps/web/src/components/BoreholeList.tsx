import { Borehole } from "@geostrata/shared";

interface BoreholeListProps {
  boreholes: Borehole[];
  selectedId: string | null;
  onSelect: (b: Borehole) => void;
  loading: boolean;
}

export default function BoreholeList({
  boreholes,
  selectedId,
  onSelect,
  loading,
}: BoreholeListProps) {
  if (loading) {
    return <div className="panel-list">Đang tải dữ liệu...</div>;
  }

  return (
    <div className="panel-list">
      <div className="panel-title">
        Lỗ khoan trong bán kính ({boreholes.length})
      </div>
      {boreholes.length === 0 && (
        <div className="panel-empty">
          Chưa có dữ liệu. Hãy nhập tọa độ hoặc nhấp lên bản đồ.
        </div>
      )}
      {boreholes.map((b) => (
        <button
          key={b.id}
          className={`panel-item ${b.id === selectedId ? "active" : ""}`}
          onClick={() => onSelect(b)}
        >
          <span className="item-name">{b.ten}</span>
          <span className="item-meta">
            {b.distance}m · sâu {b.doSau}m
          </span>
        </button>
      ))}
    </div>
  );
}