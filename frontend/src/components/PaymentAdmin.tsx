/** Màn thống kê và duyệt thanh toán — chỉ admin. */

import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "../api";
import { ApiError } from "../api";
import {
  formatVnd,
  ORDER_STATUS_LABEL,
  type OrderStatus,
  type PaymentOrder,
  type PaymentStats,
} from "../types";
import ConfirmDialog from "./ConfirmDialog";
import Icon from "./Icon";
import { useToast } from "./Toast";

type Tab = "stats" | "orders";
type StatusFilter = OrderStatus | "all";

/** Biểu đồ cột doanh thu theo ngày, vẽ bằng div nên không cần thư viện đồ thị. */
function RevenueChart({ stats }: { stats: PaymentStats }) {
  const points = stats.revenue_by_day;
  const peak = Math.max(1, ...points.map((p) => p.revenue_vnd));

  if (points.length === 0) {
    return <div className="panel-empty">Chưa có doanh thu trong khoảng thời gian này.</div>;
  }

  return (
    <div className="revenue-chart" role="img" aria-label={`Doanh thu ${points.length} ngày gần nhất`}>
      {points.map((point) => (
        <div className="revenue-bar" key={point.day}>
          <div
            className="revenue-bar-fill"
            style={{ height: `${Math.max(4, (point.revenue_vnd / peak) * 100)}%` }}
            title={`${new Date(point.day).toLocaleDateString("vi-VN")}: ${formatVnd(point.revenue_vnd)} · ${point.orders} đơn`}
          />
          <span className="revenue-bar-label">
            {new Date(point.day).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function PaymentAdmin({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("stats");
  const [stats, setStats] = useState<PaymentStats | null>(null);
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingReject, setPendingReject] = useState<PaymentOrder | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [s, o] = await Promise.all([
        api.fetchPaymentStats(30),
        api.fetchAllOrders(filter === "all" ? undefined : filter),
      ]);
      setStats(s);
      setOrders(o);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không tải được dữ liệu thanh toán");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const confirm = async (order: PaymentOrder) => {
    try {
      await api.confirmOrder(order.id);
      toast.success(`Đã cộng ${order.coins} xu cho ${order.username}`);
      await reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không xác nhận được đơn");
    }
  };

  const reject = async () => {
    if (!pendingReject) return;
    const order = pendingReject;
    setPendingReject(null);
    try {
      await api.rejectOrder(order.id);
      toast.success(`Đã từ chối đơn ${order.reference}`);
      await reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không từ chối được đơn");
    }
  };

  const pendingCount = useMemo(
    () => (stats ? stats.pending_orders : 0),
    [stats],
  );

  return (
    <>
      <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal-panel" role="dialog" aria-modal="true" aria-label="Quản trị thanh toán">
          <header className="modal-header">
            <h2>
              <Icon name="coin" size={18} /> Thanh toán
              {pendingCount > 0 && <span className="count-badge">{pendingCount} chờ duyệt</span>}
            </h2>
            <button type="button" className="close-btn-inline" onClick={onClose} aria-label="Đóng">
              <Icon name="close" size={18} />
            </button>
          </header>

          {error && (
            <div className="error" role="alert">
              <Icon name="alert" /> {error}
            </div>
          )}

          <div className="tab-bar" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "stats"}
              className={tab === "stats" ? "active" : ""}
              onClick={() => setTab("stats")}
            >
              Thống kê
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "orders"}
              className={tab === "orders" ? "active" : ""}
              onClick={() => setTab("orders")}
            >
              Duyệt đơn
            </button>
          </div>

          {loading && <div className="panel-empty">Đang tải...</div>}

          {!loading && tab === "stats" && stats && (
            <>
              <ul className="stat-grid">
                <li className="stat-card is-primary">
                  <span className="stat-label">Doanh thu {stats.period_days} ngày</span>
                  <strong>{formatVnd(stats.period_revenue_vnd)}</strong>
                  <span className="cell-sub">{stats.period_paid_orders} đơn trong kỳ</span>
                </li>
                <li className="stat-card">
                  <span className="stat-label">Doanh thu luỹ kế</span>
                  <strong>{formatVnd(stats.revenue_vnd)}</strong>
                  <span className="cell-sub">{stats.paid_orders} đơn từ trước tới nay</span>
                </li>
                <li className="stat-card">
                  <span className="stat-label">Giá trị đơn trung bình</span>
                  <strong>{formatVnd(stats.average_order_vnd)}</strong>
                  <span className="cell-sub">{stats.paying_users} người đã mua</span>
                </li>
                <li className="stat-card">
                  <span className="stat-label">Tỉ lệ chuyển đổi</span>
                  <strong>{(stats.conversion_rate * 100).toFixed(1)}%</strong>
                  <span className="cell-sub">
                    Trên các đơn đã ngã ngũ · {stats.cancelled_orders} huỷ ·{" "}
                    {stats.expired_orders} hết hạn · {stats.pending_orders} còn chờ
                  </span>
                </li>
                <li className="stat-card">
                  <span className="stat-label">Xu đang lưu hành</span>
                  <strong>{stats.coins_outstanding.toLocaleString("vi-VN")}</strong>
                  <span className="cell-sub">
                    Phát hành {stats.coins_issued.toLocaleString("vi-VN")} · đã tiêu{" "}
                    {stats.coins_spent.toLocaleString("vi-VN")}
                  </span>
                </li>
              </ul>

              <div className="modal-section-title">
                Doanh thu {stats.period_days} ngày gần nhất
              </div>
              <RevenueChart stats={stats} />

              <div className="stat-columns">
                <div>
                  <div className="modal-section-title">Khách chi nhiều nhất</div>
                  {stats.top_spenders.length === 0 ? (
                    <div className="panel-empty">Chưa có dữ liệu.</div>
                  ) : (
                    <table className="user-table">
                      <thead>
                        <tr>
                          <th>Tài khoản</th>
                          <th>Đơn</th>
                          <th>Doanh thu</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.top_spenders.map((row) => (
                          <tr key={`${row.user_id}-${row.username}`}>
                            <td>{row.username}</td>
                            <td className="tabular">{row.orders}</td>
                            <td className="tabular">{formatVnd(row.revenue_vnd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div>
                  <div className="modal-section-title">Hố khoan được mua nhiều</div>
                  {stats.popular_boreholes.length === 0 ? (
                    <div className="panel-empty">Chưa có lượt mua nào.</div>
                  ) : (
                    <table className="user-table">
                      <thead>
                        <tr>
                          <th>Hố khoan</th>
                          <th>Lượt mua</th>
                          <th>Xu thu</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.popular_boreholes.map((row) => (
                          <tr key={row.borehole_id}>
                            <td>
                              <strong>{row.borehole_code}</strong>
                              <div className="cell-sub">{row.project_code ?? "Đơn lẻ"}</div>
                            </td>
                            <td className="tabular">{row.unlocks}</td>
                            <td className="tabular">{row.coins_earned}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </>
          )}

          {!loading && tab === "orders" && (
            <>
              <div className="filter-bar">
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as StatusFilter)}
                  aria-label="Lọc theo trạng thái"
                >
                  <option value="pending">Chờ thanh toán</option>
                  <option value="paid">Đã thanh toán</option>
                  <option value="cancelled">Đã huỷ</option>
                  <option value="expired">Hết hạn</option>
                  <option value="all">Tất cả</option>
                </select>
              </div>

              {orders.length === 0 ? (
                <div className="panel-empty">Không có đơn nào ở trạng thái này.</div>
              ) : (
                <table className="user-table">
                  <thead>
                    <tr>
                      <th>Mã</th>
                      <th>Tài khoản</th>
                      <th>Xu</th>
                      <th>Số tiền</th>
                      <th>Tạo lúc</th>
                      <th>Trạng thái</th>
                      <th aria-label="Thao tác" />
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr key={order.id}>
                        <td>
                          <code>{order.reference}</code>
                        </td>
                        <td>{order.username}</td>
                        <td className="tabular">{order.coins}</td>
                        <td className="tabular">{formatVnd(order.amount_vnd)}</td>
                        <td className="cell-sub">
                          {new Date(order.created_at).toLocaleString("vi-VN")}
                        </td>
                        <td>
                          <span className={`order-status is-${order.status}`}>
                            {ORDER_STATUS_LABEL[order.status]}
                          </span>
                        </td>
                        <td className="cell-actions">
                          {order.status === "pending" && (
                            <>
                              <button
                                type="button"
                                className="primary"
                                onClick={() => void confirm(order)}
                              >
                                <Icon name="check" /> Đã nhận tiền
                              </button>
                              <button
                                type="button"
                                className="danger"
                                onClick={() => setPendingReject(order)}
                              >
                                Từ chối
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <p className="hint">
                Chỉ bấm “Đã nhận tiền” sau khi đối chiếu sao kê ngân hàng thấy đúng số tiền và
                đúng mã tham chiếu. Xu được cộng ngay khi xác nhận và không thu hồi tự động được.
              </p>
            </>
          )}
        </div>
      </div>

      {pendingReject && (
        <ConfirmDialog
          title="Từ chối đơn nạp xu"
          message={`Từ chối đơn ${pendingReject.reference} của ${pendingReject.username}?`}
          detail={`Đơn ${formatVnd(pendingReject.amount_vnd)} sẽ chuyển sang trạng thái đã huỷ và không cộng xu.`}
          confirmLabel="Từ chối đơn"
          destructive
          onConfirm={() => void reject()}
          onCancel={() => setPendingReject(null)}
        />
      )}
    </>
  );
}
