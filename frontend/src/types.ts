/**
 * Kiểu dữ liệu phản chiếu schema của backend (backend/app/schemas.py).
 * Giữ nguyên tên trường của API để không cần tầng ánh xạ trung gian.
 */

export type LayerPattern =
  | "hatch"
  | "crosshatch"
  | "dots"
  | "gravel"
  | "sand"
  | "dense";

/** Mức độ xác định vị trí hố khoan. */
export type LocationKind = "point" | "project_area";

export const LOCATION_KIND_LABEL: Record<LocationKind, string> = {
  point: "Có toạ độ",
  project_area: "Chưa rõ vị trí",
};

export interface Borehole {
  id: number;
  code: string;
  name: string;
  /** null khi location_kind = "project_area". */
  lat: number | null;
  lng: number | null;
  location_kind: LocationKind;
  drilling_company: string | null;
  depth_m: number;
  ground_level_m: number | null;
  water_level_m: number | null;
  drilled_on: string | null;
  /** null khi là hố khoan đơn lẻ. */
  project_code: string | null;
  project_name: string | null;
  distance_m: number | null;
  created_by_username?: string | null;
}

export interface Vertex {
  lat: number;
  lng: number;
}

export interface ProjectVertex extends Vertex {
  ordinal: number;
}

export interface Project {
  id: number;
  code: string;
  name: string;
  location_label: string | null;
  built_year: number | null;
  scale_description: string | null;
  vertices: ProjectVertex[];
  /** true khi đủ 3 đỉnh trở lên và đường bao không tự cắt. */
  has_boundary: boolean;
  area_m2: number | null;
  perimeter_m: number | null;
  borehole_count: number;
}

export interface ProjectWritePayload {
  name: string;
  location_label?: string | null;
  built_year?: number | null;
  scale_description?: string | null;
  vertices: Vertex[];
}

export interface ProjectCreatePayload extends ProjectWritePayload {
  code: string;
}

export interface GeoLayer {
  layer_code: string;
  ordinal: number;
  top_depth_m: number;
  bottom_depth_m: number;
  thickness_m: number;
  soil_code: string;
  name: string;
  description: string;
  color: string;
  pattern: LayerPattern;
}

export interface BoreholeSection {
  borehole: Borehole;
  /** null khi là hố khoan đơn lẻ. */
  project: Project | null;
  layers: GeoLayer[];
  max_depth_m: number;
}

export interface BoreholeSearchResult {
  lat: number;
  lng: number;
  radius_m: number;
  count: number;
  boreholes: Borehole[];
}

// --- Tài khoản và phân quyền -------------------------------------------------

export type Role = "admin" | "manager" | "user";

/** Quyền theo cấp bậc, khớp với app/models.py phía backend. */
export const ROLE_LEVEL: Record<Role, number> = { user: 1, manager: 2, admin: 3 };

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Quản trị viên",
  manager: "Quản lý",
  user: "Người dùng",
};

export function canActAs(role: Role, required: Role): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[required];
}

export interface User {
  id: number;
  username: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  organization: string | null;
  role: Role;
  is_active: boolean;
  /** Ảnh lấy qua GET /api/users/{id}/avatar, không nhúng trong JSON. */
  has_avatar: boolean;
  avatar_updated_at: string | null;
  created_at: string;
  last_login_at: string | null;
}

export interface RegisterPayload {
  username: string;
  full_name: string;
  password: string;
  email?: string | null;
  phone?: string | null;
  job_title?: string | null;
  organization?: string | null;
}

export interface ProfileUpdatePayload {
  full_name: string;
  email?: string | null;
  phone?: string | null;
  job_title?: string | null;
  organization?: string | null;
}

export interface RegistrationConfig {
  allow_self_registration: boolean;
  min_password_length: number;
}

export interface LoginResult {
  access_token: string;
  token_type: "bearer";
  expires_at: string;
  user: User;
}

export interface UserCreatePayload {
  username: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  job_title?: string | null;
  organization?: string | null;
  password: string;
  role: Role;
}

export interface UserUpdatePayload {
  full_name?: string;
  email?: string | null;
  phone?: string | null;
  job_title?: string | null;
  organization?: string | null;
  role?: Role;
  is_active?: boolean;
  password?: string;
}

// --- Ghi dữ liệu lỗ khoan ----------------------------------------------------

export interface LayerInput {
  soil_code: string;
  top_depth_m: number;
  bottom_depth_m: number;
  layer_code?: string | null;
}

export interface BoreholeWritePayload {
  name?: string | null;
  lat: number | null;
  lng: number | null;
  location_kind: LocationKind;
  drilling_company?: string | null;
  depth_m: number;
  ground_level_m?: number | null;
  water_level_m?: number | null;
  drilled_on?: string | null;
  layers: LayerInput[];
}

export interface BoreholeCreatePayload extends BoreholeWritePayload {
  code: string;
  /** Bỏ trống để tạo hố khoan đơn lẻ. */
  project_code?: string | null;
}

export interface BulkCreatePayload {
  project?: ProjectCreatePayload | null;
  project_code?: string | null;
  boreholes: (BoreholeWritePayload & { code: string })[];
}

export interface BulkCreateResult {
  project: Project | null;
  created_count: number;
  boreholes: Borehole[];
}

export interface SoilType {
  code: string;
  name: string;
  description: string;
  color: string;
  pattern: LayerPattern;
  is_fill: boolean;
  strata_order: number;
}

export interface ClientConfig {
  default_search_radius_m: number;
  min_search_radius_m: number;
  max_search_radius_m: number;
  max_results: number;
  allow_self_registration: boolean;
  max_avatar_bytes: number;
}
