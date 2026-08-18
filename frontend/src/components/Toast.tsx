/**
 * Thông báo nổi, dùng cho phản hồi THÀNH CÔNG và các lỗi không gắn với một ô nhập.
 *
 * Lý do cần: trước đây thông báo đặt ở đầu hộp thoại, còn nút bấm nằm cuối. Hộp
 * thoại cuộn được nên khi người dùng bấm Lưu ở cuối, thông báo hiện ngoài tầm
 * nhìn — trông như hệ thống không phản hồi gì.
 *
 * Toast neo cố định theo màn hình nên luôn thấy, bất kể đang cuộn tới đâu.
 * Lỗi gắn với một form cụ thể thì KHÔNG dùng toast mà đặt ngay cạnh nút bấm
 * (xem FormError) để người nhập biết phải sửa ở đâu.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Icon, { type IconName } from "./Icon";

type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

// Lỗi để lâu hơn vì người đọc cần thời gian hiểu và xử lý.
const LIFETIME_MS: Record<ToastKind, number> = {
  success: 4000,
  info: 5000,
  error: 8000,
};

const ICONS: Record<ToastKind, IconName> = {
  success: "check",
  error: "alert",
  info: "info",
};

const LABELS: Record<ToastKind, string> = {
  success: "Thành công",
  error: "Lỗi",
  info: "Thông tin",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current++;
      // Giữ tối đa 3 thông báo để không che mất nội dung phía dưới.
      setToasts((current) => [...current.slice(-2), { id, kind, message }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), LIFETIME_MS[kind]),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push("success", message),
      error: (message) => push("error", message),
      info: (message) => push("info", message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* aria-live="polite" + role="status": trình đọc màn hình đọc lên khi nội
          dung đổi nhưng KHÔNG cướp tiêu điểm bàn phím của người dùng. */}
      <div className="toast-stack" role="status" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.kind}`}>
            <Icon name={ICONS[toast.kind]} size={17} />
            <span className="toast-body">
              <span className="toast-label">{LABELS[toast.kind]}</span>
              {toast.message}
            </span>
            <button
              type="button"
              className="toast-close"
              onClick={() => dismiss(toast.id)}
              aria-label="Đóng thông báo"
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (context === null) throw new Error("useToast phải nằm trong <ToastProvider>");
  return context;
}
