/** Hồ sơ cá nhân: sửa thông tin, đổi ảnh đại diện, đổi mật khẩu. */

import { useRef, useState, type FormEvent } from "react";
import * as api from "../api";
import { ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";
import { ROLE_LABEL, type ClientConfig } from "../types";
import Avatar, { invalidateAvatarCache } from "./Avatar";
import FormError from "./FormError";
import Icon from "./Icon";
import PasswordInput from "./PasswordInput";
import { useToast } from "./Toast";

const MIN_PASSWORD = 8;

export default function ProfilePanel({
  config,
  onClose,
}: {
  config: ClientConfig | null;
  onClose: () => void;
}) {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    full_name: user?.full_name ?? "",
    email: user?.email ?? "",
    phone: user?.phone ?? "",
    job_title: user?.job_title ?? "",
    organization: user?.organization ?? "",
  });
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });

  // Mỗi biểu mẫu giữ lỗi riêng: lưu hồ sơ hỏng thì không được xoá mất lỗi của
  // phần đổi mật khẩu, và ngược lại.
  const [profileError, setProfileError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [busyAvatar, setBusyAvatar] = useState(false);

  if (!user) return null;

  const maxAvatarKb = Math.round((config?.max_avatar_bytes ?? 512_000) / 1024);

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setProfileError(null);
    setSavingProfile(true);
    try {
      const updated = await api.updateProfile({
        full_name: form.full_name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        job_title: form.job_title.trim() || null,
        organization: form.organization.trim() || null,
      });
      setUser(updated);
      toast.success("Đã lưu hồ sơ");
    } catch (err) {
      setProfileError(err instanceof ApiError ? err.message : "Không lưu được hồ sơ");
    } finally {
      setSavingProfile(false);
    }
  };

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    // Chặn sớm ở trình duyệt cho phản hồi nhanh; máy chủ vẫn kiểm tra lại.
    if (file.size > (config?.max_avatar_bytes ?? 512_000)) {
      toast.error(`Ảnh nặng ${Math.round(file.size / 1024)} KB, vượt giới hạn ${maxAvatarKb} KB`);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setBusyAvatar(true);
    try {
      const updated = await api.uploadAvatar(file);
      invalidateAvatarCache(updated.id);
      setUser(updated);
      toast.success("Đã cập nhật ảnh đại diện");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không tải được ảnh lên");
    } finally {
      setBusyAvatar(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const removeAvatar = async () => {
    setBusyAvatar(true);
    try {
      const updated = await api.deleteAvatar();
      invalidateAvatarCache(updated.id);
      setUser(updated);
      toast.success("Đã xoá ảnh đại diện");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không xoá được ảnh");
    } finally {
      setBusyAvatar(false);
    }
  };

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!passwords.current) {
      setPasswordError("Nhập mật khẩu hiện tại để xác nhận");
      return;
    }
    if (passwords.next !== passwords.confirm) {
      setPasswordError("Hai lần nhập mật khẩu mới không khớp");
      return;
    }
    if (passwords.next.length < MIN_PASSWORD) {
      setPasswordError(`Mật khẩu mới cần ít nhất ${MIN_PASSWORD} ký tự`);
      return;
    }
    if (passwords.next === passwords.current) {
      setPasswordError("Mật khẩu mới phải khác mật khẩu hiện tại");
      return;
    }

    setPasswordError(null);
    setSavingPassword(true);
    try {
      await api.changePassword(passwords.current, passwords.next);
      setPasswords({ current: "", next: "", confirm: "" });
      toast.success("Đã đổi mật khẩu. Các thiết bị khác sẽ phải đăng nhập lại.");
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : "Không đổi được mật khẩu");
    } finally {
      setSavingPassword(false);
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

        <div className="profile-head">
          <Avatar user={user} size="lg" />
          <div className="profile-identity">
            <strong>{user.full_name}</strong>
            <span className="cell-sub">@{user.username}</span>
            <span className={`role-tag role-${user.role}`}>{ROLE_LABEL[user.role]}</span>
            <div className="avatar-actions">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={busyAvatar}
              >
                <Icon name="image" /> {busyAvatar ? "Đang xử lý..." : "Đổi ảnh"}
              </button>
              {user.has_avatar && (
                <button
                  type="button"
                  className="danger"
                  onClick={() => void removeAvatar()}
                  disabled={busyAvatar}
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
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
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

          {/* Lỗi nằm ngay trên nút bấm đã gây ra nó, không đẩy lên đầu hộp thoại. */}
          <FormError message={profileError} />

          <div className="modal-footer">
            <button type="submit" className="primary" disabled={savingProfile}>
              {savingProfile ? "Đang lưu..." : "Lưu hồ sơ"}
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

          <FormError message={passwordError} />

          <div className="modal-footer">
            <button type="submit" className="primary" disabled={savingPassword}>
              {savingPassword ? "Đang đổi..." : "Đổi mật khẩu"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
