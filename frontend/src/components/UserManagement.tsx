/** Quản lý tài khoản — chỉ admin. */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import * as api from "../api";
import { ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";
import { ROLE_LABEL, type Role, type User } from "../types";
import Avatar from "./Avatar";
import PasswordInput from "./PasswordInput";
import Icon from "./Icon";

const ROLES: Role[] = ["user", "manager", "admin"];
const MIN_PASSWORD = 8;

type RoleFilter = Role | "all";

export default function UserManagement({ onClose }: { onClose: () => void }) {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await api.listUsers());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không tải được danh sách tài khoản");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Bọc mọi thao tác ghi để thông báo lỗi / thành công nhất quán. */
  const runAction = useCallback(
    async (action: () => Promise<unknown>, successMessage: string) => {
      setError(null);
      setNotice(null);
      try {
        await action();
        setNotice(successMessage);
        await reload();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Thao tác thất bại");
      }
    },
    [reload],
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

  const removeUser = (target: User) => {
    if (!window.confirm(`Xoá vĩnh viễn tài khoản "${target.username}"?`)) return;
    return runAction(() => api.deleteUser(target.id), `Đã xoá tài khoản ${target.username}`);
  };

  const resetPassword = (target: User) => {
    const next = window.prompt(
      `Đặt mật khẩu mới cho "${target.username}" (ít nhất ${MIN_PASSWORD} ký tự).\nMọi phiên đăng nhập của người này sẽ bị huỷ.`,
    );
    if (next === null) return;
    if (next.length < MIN_PASSWORD) {
      setError(`Mật khẩu cần ít nhất ${MIN_PASSWORD} ký tự`);
      return;
    }
    return runAction(
      () => api.updateUser(target.id, { password: next }),
      `Đã đặt lại mật khẩu cho ${target.username}`,
    );
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
              setError(null);
              setNotice(`Đã tạo tài khoản ${username}`);
              setShowCreate(false);
              await reload();
            }}
            onError={setError}
          />
        )}

        {loading ? (
          <div className="panel-empty">Đang tải...</div>
        ) : visible.length === 0 ? (
          <div className="panel-empty">Không có tài khoản nào khớp bộ lọc.</div>
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
                      onClick={() => void resetPassword(item)}
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
                      onClick={() => void removeUser(item)}
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
  );
}

function CreateUserForm({
  onCreated,
  onError,
}: {
  onCreated: (username: string) => Promise<void>;
  onError: (message: string) => void;
}) {
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
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
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
      onError(err instanceof ApiError ? err.message : "Không tạo được tài khoản");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="inline-form" onSubmit={handleSubmit}>
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
        <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
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
      <PasswordInput
        label="Mật khẩu"
        value={form.password}
        onChange={(value) => setForm({ ...form, password: value })}
        autoComplete="new-password"
        minLength={MIN_PASSWORD}
        required
        hint={`Ít nhất ${MIN_PASSWORD} ký tự`}
      />
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
      <button type="submit" disabled={busy}>
        {busy ? "Đang tạo..." : "Tạo tài khoản"}
      </button>
    </form>
  );
}
