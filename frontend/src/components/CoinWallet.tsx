/** Ví xu: xem số dư, nạp xu và tra lịch sử giao dịch. */

import { useCallback, useEffect, useState } from "react";
import * as api from "../api";
import { ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";
import {
  formatVnd,
  ORDER_STATUS_LABEL,
  TRANSACTION_KIND_LABEL,
  type CoinPackage,
  type CoinTransaction,
  type OrderCreateResult,
  type PaymentOrder,
  type UnlockedBorehole,
  type Wallet,
} from "../types";
import FormError from "./FormError";
import Icon from "./Icon";
import { useToast } from "./Toast";

type Tab = "topup" | "history" | "unlocks";

interface CoinWalletProps {
  /** Thẻ mở sẵn khi bật ví. Mở từ nút 'Đã mua' thì vào thẳng danh sách đã mua. */
  initialTab?: Tab;
  /** Đưa bản đồ tới hố khoan đã mua và mở mặt cắt. */
  onLocate: (item: UnlockedBorehole) => void;
  onClose: () => void;
}

export default function CoinWallet({
  initialTab = "topup",
  onLocate,
  onClose,
}: CoinWalletProps) {
  const { refresh } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>(initialTab);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [packages, setPackages] = useState<CoinPackage[]>([]);
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [transactions, setTransactions] = useState<CoinTransaction[]>([]);
  const [unlocks, setUnlocks] = useState<UnlockedBorehole[]>([]);
  const [pendingPayment, setPendingPayment] = useState<OrderCreateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [w, p, o, t, u] = await Promise.all([
        api.fetchWallet(),
        api.fetchCoinPackages(),
        api.fetchMyOrders(),
        api.fetchCoinTransactions(),
        api.fetchMyUnlocks(),
      ]);
      setWallet(w);
      setPackages(p);
      setOrders(o);
      setTransactions(t);
      setUnlocks(u);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không tải được thông tin ví");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const buyPackage = async (pack: CoinPackage) => {
    setError(null);
    setBusy(true);
    try {
      const result = await api.createCoinOrder(pack.code);
      setPendingPayment(result);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không tạo được đơn nạp xu");
    } finally {
      setBusy(false);
    }
  };

  const cancelOrder = async (order: PaymentOrder) => {
    try {
      await api.cancelMyOrder(order.id);
      toast.success(`Đã huỷ đơn ${order.reference}`);
      if (pendingPayment?.order.id === order.id) setPendingPayment(null);
      await reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không huỷ được đơn");
    }
  };

  const copyReference = async (reference: string) => {
    try {
      await navigator.clipboard.writeText(reference);
      toast.success("Đã sao chép mã tham chiếu");
    } catch {
      // Trình duyệt chặn clipboard thì mã vẫn hiện trên màn hình để chép tay.
      toast.info(`Mã tham chiếu: ${reference}`);
    }
  };

  /** Sau khi admin duyệt, người dùng bấm nút này để lấy số dư mới. */
  const refreshBalance = async () => {
    await reload();
    await refresh();
    toast.info("Đã cập nhật số dư");
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-label="Ví xu">
        <header className="modal-header">
          <h2>
            <Icon name="coin" size={18} /> Ví xu
          </h2>
          <button type="button" className="close-btn-inline" onClick={onClose} aria-label="Đóng">
            <Icon name="close" size={18} />
          </button>
        </header>

        <FormError message={error} />

        {wallet && (
          <div className="wallet-summary">
            <div className="wallet-balance">
              <span className="wallet-label">Số dư</span>
              <strong>
                <Icon name="coin" size={22} /> {wallet.balance.toLocaleString("vi-VN")}
              </strong>
              <span className="field-hint">{wallet.unlock_cost} xu / hố khoan</span>
            </div>
            <dl className="wallet-stats">
              <div>
                <dt>Đã nạp</dt>
                <dd>{wallet.total_topped_up.toLocaleString("vi-VN")}</dd>
              </div>
              <div>
                <dt>Đã tiêu</dt>
                <dd>{wallet.total_spent.toLocaleString("vi-VN")}</dd>
              </div>
              <div>
                <dt>Hố khoan đã mua</dt>
                <dd>{wallet.unlocked_count}</dd>
              </div>
            </dl>
          </div>
        )}

        <div className="tab-bar" role="tablist">
          {(
            [
              ["topup", "Nạp xu"],
              ["history", "Lịch sử"],
              ["unlocks", "Đã mua"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? "active" : ""}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "topup" && (
          <>
            {pendingPayment ? (
              <div className="transfer-card">
                <div className="modal-section-title">
                  <Icon name="info" size={13} /> Chuyển khoản để hoàn tất
                </div>
                <p className="hint">
                  Chuyển đúng số tiền và ghi <strong>đúng mã tham chiếu</strong> vào nội dung.
                  Xu được cộng sau khi quản trị viên xác nhận đã nhận tiền.
                </p>
                <dl className="transfer-details">
                  <div>
                    <dt>Ngân hàng</dt>
                    <dd>{pendingPayment.bank.bank_name}</dd>
                  </div>
                  <div>
                    <dt>Số tài khoản</dt>
                    <dd className="tabular">{pendingPayment.bank.account_number}</dd>
                  </div>
                  <div>
                    <dt>Chủ tài khoản</dt>
                    <dd>{pendingPayment.bank.account_name}</dd>
                  </div>
                  <div>
                    <dt>Số tiền</dt>
                    <dd className="tabular">{formatVnd(pendingPayment.order.amount_vnd)}</dd>
                  </div>
                  <div className="transfer-reference">
                    <dt>Nội dung chuyển khoản</dt>
                    <dd>
                      <code>{pendingPayment.bank.transfer_note}</code>
                      <button
                        type="button"
                        onClick={() => void copyReference(pendingPayment.bank.transfer_note)}
                      >
                        Sao chép
                      </button>
                    </dd>
                  </div>
                </dl>
                <div className="modal-footer">
                  <button type="button" onClick={() => setPendingPayment(null)}>
                    Chọn gói khác
                  </button>
                  <button type="button" className="primary" onClick={() => void refreshBalance()}>
                    <Icon name="check" /> Tôi đã chuyển khoản
                  </button>
                </div>
              </div>
            ) : (
              <ul className="package-grid">
                {packages.map((pack) => (
                  <li key={pack.code} className="package-card">
                    <span className="package-name">{pack.name}</span>
                    <strong className="package-coins">
                      <Icon name="coin" size={18} /> {pack.total_coins.toLocaleString("vi-VN")}
                    </strong>
                    {pack.bonus_coins > 0 && (
                      <span className="package-bonus">
                        {pack.coins} + {pack.bonus_coins} tặng
                      </span>
                    )}
                    <span className="package-price">{formatVnd(pack.price_vnd)}</span>
                    <button
                      type="button"
                      className="primary"
                      disabled={busy}
                      onClick={() => void buyPackage(pack)}
                    >
                      Chọn gói
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {orders.length > 0 && (
              <>
                <div className="modal-section-title">Đơn nạp gần đây</div>
                <table className="user-table">
                  <thead>
                    <tr>
                      <th>Mã</th>
                      <th>Xu</th>
                      <th>Số tiền</th>
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
                        <td className="tabular">{order.coins}</td>
                        <td className="tabular">{formatVnd(order.amount_vnd)}</td>
                        <td>
                          <span className={`order-status is-${order.status}`}>
                            {ORDER_STATUS_LABEL[order.status]}
                          </span>
                        </td>
                        <td className="cell-actions">
                          {order.status === "pending" && (
                            <button type="button" onClick={() => void cancelOrder(order)}>
                              Huỷ
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}

        {tab === "history" &&
          (transactions.length === 0 ? (
            <div className="panel-empty">Chưa có giao dịch nào.</div>
          ) : (
            <table className="user-table">
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Nội dung</th>
                  <th>Thay đổi</th>
                  <th>Số dư</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((entry) => (
                  <tr key={entry.id}>
                    <td className="cell-sub">
                      {new Date(entry.created_at).toLocaleString("vi-VN")}
                    </td>
                    <td>
                      {entry.description}
                      <div className="cell-sub">{TRANSACTION_KIND_LABEL[entry.kind]}</div>
                    </td>
                    <td className={`tabular ${entry.amount > 0 ? "amount-in" : "amount-out"}`}>
                      {entry.amount > 0 ? "+" : ""}
                      {entry.amount}
                    </td>
                    <td className="tabular">{entry.balance_after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}

        {tab === "unlocks" &&
          (unlocks.length === 0 ? (
            <div className="panel-empty">
              Chưa mua hố khoan nào. Chọn một hố khoan trên bản đồ rồi bấm mở khoá.
            </div>
          ) : (
            <>
              <table className="user-table">
                <thead>
                  <tr>
                    <th>Hố khoan</th>
                    <th>Công trình</th>
                    <th>Vị trí</th>
                    <th>Độ sâu</th>
                    <th>Ngày mua</th>
                    <th aria-label="Thao tác" />
                  </tr>
                </thead>
                <tbody>
                  {unlocks.map((item) => (
                    <tr key={item.borehole_id}>
                      <td>
                        <strong>{item.borehole_code}</strong>
                        {item.drilling_company && (
                          <div className="cell-sub">{item.drilling_company}</div>
                        )}
                      </td>
                      <td>
                        {item.project_code ? (
                          <>
                            {item.project_code}
                            <div className="cell-sub">{item.project_name}</div>
                          </>
                        ) : (
                          <span className="cell-sub">Hố khoan đơn lẻ</span>
                        )}
                      </td>
                      <td className="tabular">
                        {item.lat !== null && item.lng !== null ? (
                          <>
                            {item.lat.toFixed(5)}
                            <div className="cell-sub tabular">{item.lng.toFixed(5)}</div>
                          </>
                        ) : (
                          <span className="cell-sub">Theo cả công trình</span>
                        )}
                      </td>
                      <td className="tabular">{item.depth_m} m</td>
                      <td className="cell-sub">
                        {new Date(item.created_at).toLocaleDateString("vi-VN")}
                        <div className="cell-sub">{item.coins_spent} xu</div>
                      </td>
                      <td className="cell-actions">
                        <button type="button" className="primary" onClick={() => onLocate(item)}>
                          <Icon name={item.lat === null ? "layers" : "crosshair"} />{" "}
                          {item.lat === null ? "Xem mặt cắt" : "Xem trên bản đồ"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="hint">
                Đã mua một lần thì xem lại bao nhiêu lần cũng được, không tốn thêm xu.
              </p>
            </>
          ))}
      </div>
    </div>
  );
}
