/**
 * Hộp thoại xác nhận trong ứng dụng, thay cho window.confirm.
 *
 * window.confirm có ba nhược điểm: giao diện khác hẳn phần còn lại, khoá toàn bộ
 * luồng JavaScript, và không nêu được hậu quả cụ thể của thao tác. Ở đây nút xoá
 * dùng màu cảnh báo, nội dung nói rõ sẽ mất những gì, và Esc luôn huỷ được.
 */

import { useEffect, useRef } from "react";
import Icon from "./Icon";

interface ConfirmDialogProps {
  title: string;
  message: string;
  /** Cảnh báo hậu quả kèm theo, ví dụ số bản ghi sẽ bị xoá theo. */
  detail?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  detail,
  confirmLabel = "Xác nhận",
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Tiêu điểm mặc định đặt ở nút Huỷ: bấm Enter theo phản xạ sẽ không xoá nhầm.
    cancelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);

  return (
    <div
      className="modal-overlay confirm-overlay"
      onClick={(event) => event.target === event.currentTarget && onCancel()}
    >
      <div
        className="modal-panel confirm-panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
      >
        <div className={`confirm-icon ${destructive ? "is-destructive" : ""}`}>
          <Icon name={destructive ? "trash" : "alert"} size={22} />
        </div>

        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-message" className="confirm-message">
          {message}
        </p>
        {detail && <p className="confirm-detail">{detail}</p>}

        <div className="modal-footer">
          <button type="button" ref={cancelRef} onClick={onCancel}>
            Huỷ
          </button>
          <button
            type="button"
            className={destructive ? "danger" : "primary"}
            onClick={onConfirm}
          >
            {destructive && <Icon name="trash" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
