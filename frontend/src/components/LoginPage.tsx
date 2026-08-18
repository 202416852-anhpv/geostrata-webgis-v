/** Màn hình đăng nhập và tự đăng ký. */

import { useEffect, useState, type FormEvent } from "react";
import * as api from "../api";
import { ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";
import PasswordInput from "./PasswordInput";
import Icon from "./Icon";

const MIN_PASSWORD = 8;

type Tab = "login" | "register";

export default function LoginPage() {
  const { login, register } = useAuth();
  const [tab, setTab] = useState<Tab>("login");
  const [allowRegister, setAllowRegister] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Đăng nhập
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Đăng ký
  const [form, setForm] = useState({
    username: "",
    full_name: "",
    email: "",
    phone: "",
    organization: "",
    password: "",
    confirm: "",
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await api.fetchRegistrationConfig();
        if (!cancelled) setAllowRegister(config.allow_self_registration);
      } catch {
        // Không hỏi được thì cứ ẩn tab đăng ký, đăng nhập vẫn dùng bình thường.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const switchTab = (next: Tab) => {
    setTab(next);
    setError(null);
  };

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError("Nhập đầy đủ tên đăng nhập và mật khẩu");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Đăng nhập thất bại");
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (event: FormEvent) => {
    event.preventDefault();
    if (form.password !== form.confirm) {
      setError("Hai lần nhập mật khẩu không khớp");
      return;
    }
    if (form.password.length < MIN_PASSWORD) {
      setError(`Mật khẩu cần ít nhất ${MIN_PASSWORD} ký tự`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await register({
        username: form.username.trim(),
        full_name: form.full_name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        organization: form.organization.trim() || null,
        password: form.password,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Đăng ký thất bại");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <Icon name="drill" size={34} />
          <span className="login-brand-text">
            <strong>GeoStrata</strong>
            <span>WebGIS lỗ khoan địa chất</span>
          </span>
        </div>

        {allowRegister && (
          <div className="tab-bar" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "login"}
              className={tab === "login" ? "active" : ""}
              onClick={() => switchTab("login")}
            >
              Đăng nhập
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "register"}
              className={tab === "register" ? "active" : ""}
              onClick={() => switchTab("register")}
            >
              Đăng ký
            </button>
          </div>
        )}

        {error && (
          <div className="error" role="alert">
            <Icon name="alert" /> {error}
          </div>
        )}

        {tab === "login" ? (
          <form className="login-form" onSubmit={handleLogin}>
            <label>
              Tên đăng nhập hoặc email
              <input
                type="text"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>

            <PasswordInput label="Mật khẩu" value={password} onChange={setPassword} />

            <button type="submit" className="primary-btn" disabled={busy}>
              <Icon name="lock-open" /> {busy ? "Đang đăng nhập..." : "Đăng nhập"}
            </button>

            <p className="login-hint">
              Tài khoản mặc định khi cài local: <code>admin / admin123</code>,{" "}
              <code>quanly / quanly123</code>, <code>nguoidung / nguoidung123</code>. Hãy đổi
              mật khẩu sau lần đăng nhập đầu tiên.
            </p>
          </form>
        ) : (
          <form className="login-form" onSubmit={handleRegister}>
            <label>
              Tên đăng nhập
              <input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                autoComplete="username"
                minLength={3}
                pattern="[a-zA-Z0-9._\-]+"
                title="Chỉ dùng chữ không dấu, số và các ký tự . _ -"
                required
                autoFocus
              />
            </label>
            <label>
              Họ và tên
              <input
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                autoComplete="name"
                required
              />
            </label>
            <label>
              Email <span className="optional">(tuỳ chọn)</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                autoComplete="email"
              />
            </label>
            <div className="login-row">
              <label>
                Điện thoại <span className="optional">(tuỳ chọn)</span>
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  autoComplete="tel"
                />
              </label>
              <label>
                Đơn vị <span className="optional">(tuỳ chọn)</span>
                <input
                  value={form.organization}
                  onChange={(e) => setForm({ ...form, organization: e.target.value })}
                />
              </label>
            </div>

            <PasswordInput
              label="Mật khẩu"
              value={form.password}
              onChange={(value) => setForm({ ...form, password: value })}
              autoComplete="new-password"
              minLength={MIN_PASSWORD}
              required
              hint={`Ít nhất ${MIN_PASSWORD} ký tự`}
            />
            <PasswordInput
              label="Nhập lại mật khẩu"
              value={form.confirm}
              onChange={(value) => setForm({ ...form, confirm: value })}
              autoComplete="new-password"
              required
            />

            <button type="submit" className="primary-btn" disabled={busy}>
              <Icon name="user" /> {busy ? "Đang tạo tài khoản..." : "Đăng ký"}
            </button>

            <p className="login-hint">
              Tài khoản mới có quyền <strong>tra cứu</strong>. Cần thêm hoặc sửa dữ liệu
              khảo sát thì nhờ quản trị viên nâng quyền.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
