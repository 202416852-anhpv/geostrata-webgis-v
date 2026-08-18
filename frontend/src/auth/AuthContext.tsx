/** Trạng thái đăng nhập dùng chung cho toàn ứng dụng. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as api from "../api";
import { canActAs, type RegisterPayload, type Role, type User } from "../types";

interface AuthState {
  user: User | null;
  /** true trong lúc khôi phục phiên từ token đã lưu, tránh nháy màn đăng nhập. */
  initialising: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Cập nhật user trong context sau khi tự sửa hồ sơ hoặc đổi ảnh. */
  setUser: (user: User) => void;
  can: (required: Role) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initialising, setInitialising] = useState(true);

  // Bất kỳ request nào gặp 401 (token hết hạn, admin khoá tài khoản, đổi vai trò)
  // đều đưa người dùng về màn đăng nhập ngay.
  useEffect(() => {
    api.setUnauthorizedHandler(() => setUser(null));
    return () => api.setUnauthorizedHandler(null);
  }, []);

  // Khôi phục phiên từ token trong localStorage khi mở lại trang.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      if (!api.getToken()) {
        setInitialising(false);
        return;
      }
      try {
        setUser(await api.fetchMe(controller.signal));
      } catch {
        api.setToken(null);
      } finally {
        if (!controller.signal.aborted) setInitialising(false);
      }
    })();
    return () => controller.abort();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await api.login(username, password);
    setUser(result.user);
  }, []);

  const register = useCallback(async (payload: RegisterPayload) => {
    const result = await api.register(payload);
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    setUser(await api.fetchMe());
  }, []);

  const can = useCallback(
    (required: Role) => (user === null ? false : canActAs(user.role, required)),
    [user],
  );

  const value = useMemo<AuthState>(
    () => ({ user, initialising, login, register, logout, refresh, setUser, can }),
    [user, initialising, login, register, logout, refresh, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (context === null) throw new Error("useAuth phải nằm trong <AuthProvider>");
  return context;
}
