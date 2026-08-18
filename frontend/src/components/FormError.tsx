/**
 * Lỗi của một biểu mẫu, đặt NGAY CẠNH nút bấm đã gây ra nó.
 *
 * Tự đưa tiêu điểm về mình khi xuất hiện, nhờ vậy:
 *  - trình duyệt cuộn tới đúng chỗ, người dùng không phải tự tìm;
 *  - trình đọc màn hình đọc lên ngay nội dung lỗi.
 */

import { useEffect, useRef } from "react";
import Icon from "./Icon";

export default function FormError({ message }: { message: string | null }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (message) ref.current?.focus();
  }, [message]);

  if (!message) return null;

  return (
    <div
      ref={ref}
      className="error form-error"
      role="alert"
      // tabIndex -1: nhận được focus bằng mã nhưng không chen vào thứ tự Tab.
      tabIndex={-1}
    >
      <Icon name="alert" />
      {message}
    </div>
  );
}
