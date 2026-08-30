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
  /** false khi vai trò user chưa mua quyền xem hố khoan này. */
  is_unlocked: boolean;
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
  /** Khung bao gồm ranh giới và hố khoan, để đưa bản đồ tới công trình. */
  bbox: BoundingBox | null;
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
  coin_balance: number;
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

// --- Tra cứu địa điểm --------------------------------------------------------

export interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface Place {
  name: string;
  display_name: string;
  lat: number;
  lng: number;
  category: string | null;
  /** Khung bao để phóng bản đồ vừa khít; null với điểm đơn lẻ. */
  bbox: BoundingBox | null;
}

export interface PlaceSearchResult {
  query: string;
  count: number;
  places: Place[];
}

// --- Ví xu và thanh toán -----------------------------------------------------

export type OrderStatus = "pending" | "paid" | "cancelled" | "expired";
export type TransactionKind =
  | "topup" | "purchase" | "refund" | "admin_grant" | "admin_revoke";

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Chờ thanh toán",
  paid: "Đã thanh toán",
  cancelled: "Đã huỷ",
  expired: "Hết hạn",
};

export const TRANSACTION_KIND_LABEL: Record<TransactionKind, string> = {
  topup: "Nạp xu",
  purchase: "Mua hố khoan",
  refund: "Hoàn xu",
  admin_grant: "Được cộng",
  admin_revoke: "Bị thu hồi",
};

export interface CoinPackage {
  id: number;
  code: string;
  name: string;
  coins: number;
  bonus_coins: number;
  total_coins: number;
  price_vnd: number;
}

export interface CoinTransaction {
  id: number;
  amount: number;
  balance_after: number;
  kind: TransactionKind;
  description: string;
  created_at: string;
}

export interface Wallet {
  balance: number;
  unlock_cost: number;
  total_topped_up: number;
  total_spent: number;
  unlocked_count: number;
}

export interface BankInfo {
  bank_name: string;
  account_number: string;
  account_name: string;
  transfer_note: string;
}

export interface PaymentOrder {
  id: number;
  reference: string;
  username: string;
  coins: number;
  amount_vnd: number;
  status: OrderStatus;
  provider: string;
  note: string | null;
  created_at: string;
  expires_at: string | null;
  paid_at: string | null;
}

export interface OrderCreateResult {
  order: PaymentOrder;
  bank: BankInfo;
}

export interface UnlockResult {
  borehole_id: number;
  borehole_code: string;
  coins_spent: number;
  balance: number;
  newly_unlocked: boolean;
}

export interface UnlockedBorehole {
  borehole_id: number;
  borehole_code: string;
  project_code: string | null;
  project_name: string | null;
  /** null khi hố khoan chưa rõ vị trí. */
  lat: number | null;
  lng: number | null;
  location_kind: LocationKind;
  depth_m: number;
  drilling_company: string | null;
  drilled_on: string | null;
  coins_spent: number;
  created_at: string;
}

export interface RevenuePoint {
  day: string;
  orders: number;
  revenue_vnd: number;
  coins: number;
}

export interface TopSpender {
  user_id: number | null;
  username: string;
  orders: number;
  revenue_vnd: number;
}

export interface PopularBorehole {
  borehole_id: number;
  borehole_code: string;
  project_code: string | null;
  unlocks: number;
  coins_earned: number;
}

export interface PaymentStats {
  period_days: number;
  period_revenue_vnd: number;
  period_paid_orders: number;
  revenue_vnd: number;
  paid_orders: number;
  pending_orders: number;
  cancelled_orders: number;
  expired_orders: number;
  conversion_rate: number;
  coins_issued: number;
  coins_spent: number;
  coins_outstanding: number;
  paying_users: number;
  unlocks_total: number;
  average_order_vnd: number;
  revenue_by_day: RevenuePoint[];
  top_spenders: TopSpender[];
  popular_boreholes: PopularBorehole[];
}

/** Định dạng tiền theo cách viết Việt Nam: 100.000 ₫ */
export function formatVnd(amount: number): string {
  return `${amount.toLocaleString("vi-VN")} ₫`;
}

export interface ClientConfig {
  default_search_radius_m: number;
  min_search_radius_m: number;
  max_search_radius_m: number;
  max_results: number;
  allow_self_registration: boolean;
  max_avatar_bytes: number;
  geocode_enabled: boolean;
  coins_enabled: boolean;
  borehole_unlock_cost: number;
}
