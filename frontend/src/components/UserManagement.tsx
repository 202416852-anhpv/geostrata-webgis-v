/** Quản lý tài khoản — chỉ admin. */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import * as api from "../api";
import { ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";
import { ROLE_LABEL, type Role, type User } from "../types";
import Avatar from "./Avatar";
import ConfirmDialog from "./ConfirmDialog";
import FormError from "./FormError";
import Icon from "./Icon";
import PasswordInput from "./PasswordInput";
import { useToast } from "./Toast";

const ROLES: Role[] = ["user", "manager", "admin"];
const MIN_PASSWORD = 8;

type RoleFilter = Role | "all";

export default function UserManagement({ onClose }: { onClose: () => void }) {
  const { user: currentUser } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  const [pendingDelete, setPendingDelete] = useState<User | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await api.listUsers());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Không tải được danh sách tài khoản");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Mọi thao tác ghi đều báo kết quả bằng toast — luôn thấy dù đang cuộn ở đâu. */
  const runAction = useCallback(
    async (action: () => Promise<unknown>, successMessage: string) => {
      try {
        await action();
        toast.success(successMessage);
        await reload();
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Thao tác thất bại");
      }
    },
    [reload, toast],
  );

  const changeRole = (target: User, role: Role) =>
    runAction(
      () => api.updateUser(target.id, { role }),
      `Đã đổi vai trò của ${target.username} thành ${ROLE_LABEL[role]}. Người này phải đăng nhập lại.`,
    );

  const toggleActive = (target: User) =>
    runAction(
      () => api.updateUser(target.id, { is_active: !target.is_active }),
      target.is_active ? `Đã khoá tài khoản ${target.username}` : `Đã mở khoá ${target.username}`,
    );

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    await runAction(() => api.deleteUser(target.id), `Đã xoá tài khoản ${target.username}`);
  };

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.filter((item) => {
      if (roleFilter !== "all" && item.role !== roleFilter) return false;
      if (!needle) return true;
      return [item.username, item.full_name, item.email, item.organization]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(needle));
    });
  }, [users, query, roleFilter]);

  const counts = useMemo(() => {
    const byRole = { admin: 0, manager: 0, user: 0 };
    for (const item of users) byRole[item.role] += 1;
    return byRole;
  }, [users]);

  return (
    <>
      <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal-panel" role="dialog" aria-modal="true" aria-label="Quản lý tài khoản">
          <header className="modal-header">
            <h2>
              <Icon name="users" size={18} /> Tài khoản
              <span className="count-badge">{users.length}</span>
            </h2>
            <button type="button" className="close-btn-inline" onClick={onClose} aria-label="Đóng">
              <Icon name="close" size={18} />
            </button>
          </header>

          {loadError && (
            <div className="error" role="alert">
              <Icon name="alert" /> {loadError}
            </div>
          )}

          <div className="filter-bar">
            <span className="filter-search">
              <Icon name="search" size={15} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tìm theo tên, tài khoản, email, đơn vị..."
                aria-label="Tìm tài khoản"
              />
            </span>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
              aria-label="Lọc theo vai trò"
            >
              <option value="all">Tất cả vai trò ({users.length})</option>
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]} ({counts[role]})
                </option>
              ))}
            </select>
            <button type="button" onClick={() => setShowCreate((value) => !value)}>
              <Icon name={showCreate ? "close" : "plus"} />
              {showCreate ? "Đóng biểu mẫu" : "Thêm tài khoản"}
            </button>
          </div>

          {showCreate && (
            <CreateUserForm
              onCreated={async (username) => {
                toast.success(`Đã tạo tài khoản ${username}`);
                setShowCreate(false);
                await reload();
              }}
            />
          )}

          {resetTarget && (
            <ResetPasswordForm
              target={resetTarget}
              onDone={async (username) => {
                setResetTarget(null);
                toast.success(`Đã đặt lại mật khẩu cho ${username}. Mọi phiên đã bị huỷ.`);
                await reload();
              }}
              onCancel={() => setResetTarget(null)}
            />
          )}

          {loading ? (
            <div className="panel-empty">Đang tải...</div>
          ) : visible.length === 0 ? (
            <div className="panel-empty">
              {users.length === 0
                ? "Chưa có tài khoản nào."
                : "Không có tài khoản nào khớp bộ lọc. Thử xoá bớt từ khoá hoặc chọn lại vai trò."}
            </div>
          ) : (
            <ul className="user-cards">
              {visible.map((item) => {
                const isSelf = item.id === currentUser?.id;
                return (
                  <li key={item.id} className={`user-card ${item.is_active ? "" : "is-disabled"}`}>
                    <Avatar user={item} size="md" />

                    <div className="user-card-main">
                      <div className="user-card-name">
                        <strong>{item.full_name}</strong>
                        {isSelf && <span className="self-tag">bạn</span>}
                        {!item.is_active && (
                          <span className="badge-off">
                            <Icon name="lock" size={13} /> Đã khoá
                          </span>
                        )}
                      </div>
                      <div className="cell-sub">
                        @{item.username}
                        {item.email && ` · ${item.email}`}
                        {item.phone && ` · ${item.phone}`}
                      </div>
                      {(item.job_title || item.organization) && (
                        <div className="cell-sub">
                          {[item.job_title, item.organization].filter(Boolean).join(" — ")}
                        </div>
                      )}
                    </div>

                    <div className="user-card-role">
                      <select
                        value={item.role}
                        disabled={isSelf}
                        title={isSelf ? "Không thể tự đổi vai trò của mình" : undefined}
                        onChange={(e) => void changeRole(item, e.target.value as Role)}
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABEL[role]}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="user-card-actions">
                      <button
                        type="button"
                        onClick={() => setResetTarget(item)}
                        title="Đặt lại mật khẩu"
                      >
                        <Icon name="key" />
                      </button>
                      <button
                        type="button"
                        disabled={isSelf}
                        onClick={() => void toggleActive(item)}
                        title={item.is_active ? "Khoá tài khoản" : "Mở khoá tài khoản"}
                      >
                        <Icon name={item.is_active ? "lock" : "lock-open"} />
                        {item.is_active ? "Khoá" : "Mở khoá"}
                      </button>
                      <button
                        type="button"
                        className="danger"
                        disabled={isSelf}
                        onClick={() => setPendingDelete(item)}
                        title="Xoá tài khoản"
                      >
                        <Icon name="trash" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="hint">
            Đổi vai trò, khoá tài khoản hoặc đặt lại mật khẩu sẽ huỷ toàn bộ phiên đăng nhập
            của người đó ngay lập tức.
          </p>
        </div>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Xoá tài khoản"
          message={`Xoá vĩnh viễn tài khoản "${pendingDelete.username}" (${pendingDelete.full_name})?`}
          detail="Dữ liệu khảo sát do người này nhập vẫn được giữ nguyên, chỉ mất thông tin người nhập."
          confirmLabel="Xoá tài khoản"
          destructive
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );
}

/** Đặt lại mật khẩu bằng biểu mẫu trong app thay cho window.prompt, vốn hiện mật khẩu dạng chữ thường. */
function ResetPasswordForm({
  target,
  onDone,
  onCancel,
}: {
  target: User;
  onDone: (username: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError(`Mật khẩu cần ít nhất ${MIN_PASSWORD} ký tự`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.updateUser(target.id, { password });
      await onDone(target.username);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không đặt lại được mật khẩu");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="project-form" onSubmit={handleSubmit}>
      <div className="modal-section-title">
        <Icon name="key" size={13} /> Đặt lại mật khẩu cho {target.username}
      </div>
      <PasswordInput
        label="Mật khẩu mới"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        minLength={MIN_PASSWORD}
        required
        autoFocus
        hint={`Ít nhất ${MIN_PASSWORD} ký tự. Mọi phiên đăng nhập của người này sẽ bị huỷ.`}
      />
      <FormError message={error} />
      <div className="modal-footer">
        <button type="button" onClick={onCancel}>
          Huỷ
        </button>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Đang đặt lại..." : "Đặt lại mật khẩu"}
        </button>
      </div>
    </form>
  );
}

function CreateUserForm({ onCreated }: { onCreated: (username: string) => Promise<void> }) {
  const [form, setForm] = useState({
    username: "",
    full_name: "",
    email: "",
    phone: "",
    job_title: "",
    organization: "",
    password: "",
  });
  const [role, setRole] = useState<Role>("user");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.createUser({
        username: form.username.trim(),
        full_name: form.full_name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        job_title: form.job_title.trim() || null,
        organization: form.organization.trim() || null,
        password: form.password,
        role,
      });
      await onCreated(form.username.trim());
      setForm({
        username: "",
        full_name: "",
        email: "",
        phone: "",
        job_title: "",
        organization: "",
        password: "",
      });
      setRole("user");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không tạo được tài khoản");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="project-form" onSubmit={handleSubmit}>
      <div className="form-grid">
        <label>
          Tên đăng nhập
          <input
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            required
            minLength={3}
            pattern="[a-zA-Z0-9._\-]+"
            title="Chỉ dùng chữ không dấu, số và các ký tự . _ -"
          />
        </label>
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
          />
        </label>
        <label>
          Đơn vị
          <input
            value={form.organization}
            onChange={(e) => setForm({ ...form, organization: e.target.value })}
          />
        </label>
        <div className="form-wide">
          <PasswordInput
            label="Mật khẩu"
            value={form.password}
            onChange={(value) => setForm({ ...form, password: value })}
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            required
            hint={`Ít nhất ${MIN_PASSWORD} ký tự`}
          />
        </div>
        <label>
          Vai trò
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((item) => (
              <option key={item} value={item}>
                {ROLE_LABEL[item]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <FormError message={error} />

      <div className="modal-footer">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Đang tạo..." : "Tạo tài khoản"}
        </button>
      </div>
    </form>
  );
}
