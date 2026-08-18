/** Hồ sơ cá nhân: sửa thông tin, đổi ảnh đại diện, đổi mật khẩu. */

import { useRef, useState, type FormEvent } from "react";
import * as api from "../api";
import { ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";
import { ROLE_LABEL, type ClientConfig } from "../types";
import Avatar, { invalidateAvatarCache } from "./Avatar";
import PasswordInput from "./PasswordInput";
import Icon from "./Icon";

const MIN_PASSWORD = 8;

export default function ProfilePanel({
  config,
  onClose,
}: {
  config: ClientConfig | null;
  onClose: () => void;
}) {
  const { user, setUser } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    full_name: user?.full_name ?? "",
    email: user?.email ?? "",
    phone: user?.phone ?? "",
    job_title: user?.job_title ?? "",
    organization: user?.organization ?? "",
  });
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const maxAvatarKb = Math.round((config?.max_avatar_bytes ?? 512_000) / 1024);

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const updated = await api.updateProfile({
        full_name: form.full_name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        job_title: form.job_title.trim() || null,
        organization: form.organization.trim() || null,
      });
      setUser(updated);
      setNotice("Đã lưu hồ sơ");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không lưu được hồ sơ");
    } finally {
      setBusy(false);
    }
  };

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setNotice(null);
    // Chặn sớm ở trình duyệt cho phản hồi nhanh; máy chủ vẫn kiểm tra lại.
    if (file.size > (config?.max_avatar_bytes ?? 512_000)) {
      setError(`Ảnh nặng ${Math.round(file.size / 1024)} KB, vượt giới hạn ${maxAvatarKb} KB`);
      return;
    }
    setBusy(true);
    try {
      const updated = await api.uploadAvatar(file);
      invalidateAvatarCache(updated.id);
      setUser(updated);
      setNotice("Đã cập nhật ảnh đại diện");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không tải được ảnh lên");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const removeAvatar = async () => {
    setBusy(true);
    try {
      const updated = await api.deleteAvatar();
      invalidateAvatarCache(updated.id);
      setUser(updated);
      setNotice("Đã xoá ảnh đại diện");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không xoá được ảnh");
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (passwords.next !== passwords.confirm) {
      setError("Hai lần nhập mật khẩu mới không khớp");
      return;
    }
    if (passwords.next.length < MIN_PASSWORD) {
      setError(`Mật khẩu mới cần ít nhất ${MIN_PASSWORD} ký tự`);
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await api.changePassword(passwords.current, passwords.next);
      setPasswords({ current: "", next: "", confirm: "" });
      setNotice("Đã đổi mật khẩu. Các thiết bị khác sẽ phải đăng nhập lại.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không đổi được mật khẩu");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel narrow" role="dialog" aria-modal="true" aria-label="Hồ sơ cá nhân">
        <header className="modal-header">
          <h2>
            <Icon name="user" size={18} /> Hồ sơ cá nhân
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
        {notice && (
          <div className="notice">
            <Icon name="check" /> {notice}
          </div>
        )}

        <div className="profile-head">
          <Avatar user={user} size="lg" />
          <div className="profile-identity">
            <strong>{user.full_name}</strong>
            <span className="cell-sub">@{user.username}</span>
            <span className={`role-tag role-${user.role}`}>{ROLE_LABEL[user.role]}</span>
            <div className="avatar-actions">
              <button type="button" onClick={() => fileInput.current?.click()} disabled={busy}>
                <Icon name="image" /> Đổi ảnh
              </button>
              {user.has_avatar && (
                <button
                  type="button"
                  className="danger"
                  onClick={() => void removeAvatar()}
                  disabled={busy}
                >
                  <Icon name="trash" /> Xoá ảnh
                </button>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                onChange={(e) => void pickAvatar(e.target.files?.[0])}
              />
            </div>
            <span className="field-hint">PNG, JPEG, WebP hoặc GIF, tối đa {maxAvatarKb} KB</span>
          </div>
        </div>

        <form className="stack-form" onSubmit={saveProfile}>
          <div className="modal-section-title">
            <Icon name="info" size={13} /> Thông tin
          </div>
          <div className="form-grid">
            <label>
              Họ và tên
              <input
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                required
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
            <label>
              Điện thoại
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </label>
            <label>
              Chức danh
              <input
                value={form.job_title}
                onChange={(e) => setForm({ ...form, job_title: e.target.value })}
                placeholder="Kỹ sư địa chất"
              />
            </label>
            <label className="form-wide">
              Đơn vị công tác
              <input
                value={form.organization}
                onChange={(e) => setForm({ ...form, organization: e.target.value })}
              />
            </label>
          </div>
          <div className="modal-footer">
            <button type="submit" className="primary" disabled={busy}>
              Lưu hồ sơ
            </button>
          </div>
        </form>

        <form className="stack-form" onSubmit={savePassword}>
          <div className="modal-section-title">
            <Icon name="key" size={13} /> Đổi mật khẩu
          </div>
          <PasswordInput
            label="Mật khẩu hiện tại"
            value={passwords.current}
            onChange={(value) => setPasswords({ ...passwords, current: value })}
            required
          />
          <PasswordInput
            label="Mật khẩu mới"
            value={passwords.next}
            onChange={(value) => setPasswords({ ...passwords, next: value })}
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            required
            hint={`Ít nhất ${MIN_PASSWORD} ký tự`}
          />
          <PasswordInput
            label="Nhập lại mật khẩu mới"
            value={passwords.confirm}
            onChange={(value) => setPasswords({ ...passwords, confirm: value })}
            autoComplete="new-password"
            required
          />
          <div className="modal-footer">
            <button type="submit" className="primary" disabled={busy}>
              Đổi mật khẩu
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
