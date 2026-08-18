/** Lớp gọi API duy nhất của frontend. */

import type {
  Borehole,
  BoreholeCreatePayload,
  BoreholeSearchResult,
  BoreholeSection,
  BoreholeWritePayload,
  BulkCreatePayload,
  BulkCreateResult,
  ClientConfig,
  LoginResult,
  ProfileUpdatePayload,
  Project,
  ProjectCreatePayload,
  ProjectWritePayload,
  RegisterPayload,
  RegistrationConfig,
  SoilType,
  User,
  UserCreatePayload,
  UserUpdatePayload,
} from "./types";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";
const TOKEN_KEY = "geostrata.token";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// --- Lưu token ---------------------------------------------------------------

let inMemoryToken: string | null = null;

export function getToken(): string | null {
  if (inMemoryToken !== null) return inMemoryToken;
  try {
    inMemoryToken = localStorage.getItem(TOKEN_KEY);
  } catch {
    inMemoryToken = null; // trình duyệt chặn localStorage (chế độ riêng tư)
  }
  return inMemoryToken;
}

export function setToken(token: string | null): void {
  inMemoryToken = token;
  try {
    if (token === null) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Không lưu được thì phiên chỉ sống trong tab hiện tại — vẫn dùng được.
  }
}

/** Gọi khi gặp 401 để lớp trên biết mà đưa người dùng về màn đăng nhập. */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

// --- Hàm gọi chung -----------------------------------------------------------

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  auth?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, signal, auth = true } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("Không kết nối được tới máy chủ", 0);
  }

  if (response.status === 401) {
    setToken(null);
    onUnauthorized?.();
    throw new ApiError("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại", 401);
  }

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/** FastAPI trả lỗi dạng {"detail": ...}; với 422 thì detail là mảng lỗi từng trường. */
async function readErrorMessage(response: Response): Promise<string> {
  const detail = await response
    .json()
    .then((body) => body?.detail)
    .catch(() => null);

  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const first = detail[0];
    const field = Array.isArray(first?.loc) ? first.loc.at(-1) : null;
    const message = first?.msg ?? "Dữ liệu không hợp lệ";
    return field ? `${field}: ${message}` : message;
  }
  return `Máy chủ trả về lỗi ${response.status}`;
}

// --- Xác thực ----------------------------------------------------------------

export async function login(username: string, password: string): Promise<LoginResult> {
  const result = await request<LoginResult>("/auth/login", {
    method: "POST",
    body: { username, password },
    auth: false,
  });
  setToken(result.access_token);
  return result;
}

export async function logout(): Promise<void> {
  try {
    await request<void>("/auth/logout", { method: "POST" });
  } finally {
    // Kể cả khi máy chủ không phản hồi, phía client vẫn phải quên token.
    setToken(null);
  }
}

export function fetchRegistrationConfig(signal?: AbortSignal): Promise<RegistrationConfig> {
  return request<RegistrationConfig>("/auth/registration", { signal, auth: false });
}

export async function register(payload: RegisterPayload): Promise<LoginResult> {
  const result = await request<LoginResult>("/auth/register", {
    method: "POST",
    body: payload,
    auth: false,
  });
  setToken(result.access_token);
  return result;
}

export function updateProfile(payload: ProfileUpdatePayload): Promise<User> {
  return request<User>("/auth/me", { method: "PUT", body: payload });
}

/** Tải ảnh đại diện. Dùng multipart nên không đi qua hàm request() vốn gửi JSON. */
export async function uploadAvatar(file: File): Promise<User> {
  const form = new FormData();
  form.append("file", file);
  const token = getToken();

  const response = await fetch(`${BASE_URL}/auth/me/avatar`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (response.status === 401) {
    setToken(null);
    onUnauthorized?.();
    throw new ApiError("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại", 401);
  }
  if (!response.ok) throw new ApiError(await readErrorMessage(response), response.status);
  return response.json() as Promise<User>;
}

export function deleteAvatar(): Promise<User> {
  return request<User>("/auth/me/avatar", { method: "DELETE" });
}

export function fetchMe(signal?: AbortSignal): Promise<User> {
  return request<User>("/auth/me", { signal });
}

export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return request<void>("/auth/change-password", {
    method: "POST",
    body: { current_password: currentPassword, new_password: newPassword },
  });
}

// --- Quản lý tài khoản (admin) -----------------------------------------------

export function listUsers(signal?: AbortSignal): Promise<User[]> {
  return request<User[]>("/users", { signal });
}

export function createUser(payload: UserCreatePayload): Promise<User> {
  return request<User>("/users", { method: "POST", body: payload });
}

export function updateUser(userId: number, payload: UserUpdatePayload): Promise<User> {
  return request<User>(`/users/${userId}`, { method: "PATCH", body: payload });
}

export function deleteUser(userId: number): Promise<void> {
  return request<void>(`/users/${userId}`, { method: "DELETE" });
}

// --- Dữ liệu khảo sát --------------------------------------------------------

export function fetchClientConfig(signal?: AbortSignal): Promise<ClientConfig> {
  return request<ClientConfig>("/config", { signal, auth: false });
}

export function fetchSoilTypes(signal?: AbortSignal): Promise<SoilType[]> {
  return request<SoilType[]>("/soil-types", { signal });
}

// --- Công trình --------------------------------------------------------------

export function fetchProjects(signal?: AbortSignal): Promise<Project[]> {
  return request<Project[]>("/projects", { signal });
}

export function fetchProject(projectId: number, signal?: AbortSignal): Promise<Project> {
  return request<Project>(`/projects/${projectId}`, { signal });
}

export function fetchProjectBoreholes(
  projectId: number,
  signal?: AbortSignal,
): Promise<Borehole[]> {
  return request<Borehole[]>(`/projects/${projectId}/boreholes`, { signal });
}

export function createProject(payload: ProjectCreatePayload): Promise<Project> {
  return request<Project>("/projects", { method: "POST", body: payload });
}

export function updateProject(projectId: number, payload: ProjectWritePayload): Promise<Project> {
  return request<Project>(`/projects/${projectId}`, { method: "PUT", body: payload });
}

export function deleteProject(projectId: number): Promise<void> {
  return request<void>(`/projects/${projectId}`, { method: "DELETE" });
}

export function searchBoreholes(
  lat: number,
  lng: number,
  radiusM: number,
  signal?: AbortSignal,
): Promise<BoreholeSearchResult> {
  const query = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    radius_m: String(radiusM),
  });
  return request<BoreholeSearchResult>(`/boreholes?${query}`, { signal });
}

/**
 * Lấy mặt cắt theo ID lỗ khoan.
 *
 * Bản cũ gửi kèm toạ độ của chính lỗ khoan rồi để server sinh lại cả bộ dữ liệu,
 * nên mặt cắt trả về thuộc một lỗ khoan khác. Nay chỉ cần ID, dữ liệu đọc thẳng
 * từ CSDL nên luôn khớp với lỗ khoan đang chọn.
 */
export function fetchSection(boreholeId: number, signal?: AbortSignal): Promise<BoreholeSection> {
  return request<BoreholeSection>(`/boreholes/${boreholeId}/section`, { signal });
}

export function createBorehole(payload: BoreholeCreatePayload): Promise<Borehole> {
  return request<Borehole>("/boreholes", { method: "POST", body: payload });
}

export function updateBorehole(boreholeId: number, payload: BoreholeWritePayload): Promise<Borehole> {
  return request<Borehole>(`/boreholes/${boreholeId}`, { method: "PUT", body: payload });
}

export function deleteBorehole(boreholeId: number): Promise<void> {
  return request<void>(`/boreholes/${boreholeId}`, { method: "DELETE" });
}

/** Thêm nhiều hố khoan trong một giao dịch, kèm tạo công trình nếu cần. */
export function createBoreholesBulk(payload: BulkCreatePayload): Promise<BulkCreateResult> {
  return request<BulkCreateResult>("/boreholes/bulk", { method: "POST", body: payload });
}
