/** Ô nhập mật khẩu kèm nút hiện / ẩn. */

import { useId, useState } from "react";
import Icon from "./Icon";

interface PasswordInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  autoFocus?: boolean;
  /** Gợi ý hiển thị dưới ô nhập, ví dụ yêu cầu độ dài. */
  hint?: string;
}

export default function PasswordInput({
  label,
  value,
  onChange,
  autoComplete = "current-password",
  placeholder,
  required = false,
  minLength,
  autoFocus = false,
  hint,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const hintId = useId();

  return (
    <label className="password-field">
      {label}
      <span className="password-wrap">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          autoFocus={autoFocus}
          aria-describedby={hint ? hintId : undefined}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((current) => !current)}
          // Nút nằm trong <label>, không đặt aria-label thì trình đọc màn hình
          // sẽ đọc luôn nhãn của ô nhập.
          aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
          aria-pressed={visible}
          title={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
        >
          <Icon name={visible ? "eye-off" : "eye"} size={16} />
        </button>
      </span>
      {hint && (
        <span className="field-hint" id={hintId}>
          {hint}
        </span>
      )}
    </label>
  );
}
