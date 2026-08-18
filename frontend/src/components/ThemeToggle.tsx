/** Chuyển giao diện sáng / tối, ghi nhớ lựa chọn giữa các phiên. */

import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon";

type Theme = "light" | "dark";

const STORAGE_KEY = "geostrata.theme";

function systemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStored(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => readStored() ?? systemTheme());

  useEffect(() => {
    // Ghi thuộc tính lên <html>: token trong tokens.css đọc theo data-theme.
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Không lưu được thì lựa chọn chỉ sống trong phiên hiện tại.
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  const nextLabel = theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối";

  return (
    <button
      type="button"
      className="icon-btn"
      onClick={toggle}
      aria-label={nextLabel}
      title={nextLabel}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
    </button>
  );
}
