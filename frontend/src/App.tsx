import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";
import { ApiError, fetchClientConfig, fetchSection, searchBoreholes } from "./api";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import Avatar from "./components/Avatar";
import BoreholeEditor from "./components/BoreholeEditor";
import BoreholeList from "./components/BoreholeList";
import CoinWallet from "./components/CoinWallet";
import CrossSection from "./components/CrossSection";
import Icon from "./components/Icon";
import LoginPage from "./components/LoginPage";
import MapView from "./components/MapView";
import ProfilePanel from "./components/ProfilePanel";
import ProjectManagement from "./components/ProjectManagement";
import SearchPanel from "./components/SearchPanel";
import ThemeToggle from "./components/ThemeToggle";
import MapPickToolbar from "./components/MapPickToolbar";
import PaymentAdmin from "./components/PaymentAdmin";
import PlaceSearch from "./components/PlaceSearch";
import { ToastProvider, useToast } from "./components/Toast";
import { MapPickProvider, useMapPick } from "./map/MapPickContext";
import UserManagement from "./components/UserManagement";
import {
  ROLE_LABEL,
  type Borehole,
  type BoreholeSection,
  type BoundingBox,
  type ClientConfig,
  type Place,
  type Project,
} from "./types";

const INITIAL_CENTER: [number, number] = [10.7769, 106.6953];
const FALLBACK_RADIUS_M = 150;

export default function App() {
  return (
    <ToastProvider>
      <MapPickProvider>
        <AuthProvider>
          <Root />
        </AuthProvider>
      </MapPickProvider>
    </ToastProvider>
  );
}

/** Chọn màn hình theo trạng thái đăng nhập. */
function Root() {
  const { user, initialising } = useAuth();

  if (initialising) {
    return <div className="boot-screen">Đang khôi phục phiên đăng nhập...</div>;
  }
  return user ? <Workspace /> : <LoginPage />;
}

function Workspace() {
  const { user, logout, can, refresh } = useAuth();
  const toast = useToast();
  const { isPicking } = useMapPick();

  const [config, setConfig] = useState<ClientConfig | null>(null);
  const [center, setCenter] = useState<[number, number]>(INITIAL_CENTER);
  const [radiusM, setRadiusM] = useState(FALLBACK_RADIUS_M);
  const [boreholes, setBoreholes] = useState<Borehole[]>([]);
  const [selected, setSelected] = useState<Borehole | null>(null);
  const [section, setSection] = useState<BoreholeSection | null>(null);
  const [loading, setLoading] = useState(true);
  const [sectionLoading, setSectionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [focusBounds, setFocusBounds] = useState<BoundingBox | null>(null);
  const [showUsers, setShowUsers] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showWallet, setShowWallet] = useState(false);
  const [showPayments, setShowPayments] = useState(false);
  // Hố khoan người dùng bấm vào nhưng chưa mua quyền xem.
  const [locked, setLocked] = useState<{ borehole: Borehole; message: string } | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);

  // Huỷ request cũ khi người dùng bấm liên tiếp, tránh kết quả về sai thứ tự.
  const searchAbort = useRef<AbortController | null>(null);
  const sectionAbort = useRef<AbortController | null>(null);

  const search = useCallback(async (lat: number, lng: number, radius: number) => {
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;

    setCenter([lat, lng]);
    setRadiusM(radius);
    setSelected(null);
    setSection(null);
    setError(null);
    setLoading(true);
    try {
      const result = await searchBoreholes(lat, lng, radius, controller.signal);
      setBoreholes(result.boreholes);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof ApiError ? err.message : "Có lỗi xảy ra khi tìm lỗ khoan");
      setBoreholes([]);
    } finally {
      if (searchAbort.current === controller) setLoading(false);
    }
  }, []);

  // Nạp cấu hình từ backend (bán kính mặc định) rồi tìm kiếm lần đầu.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let radius = FALLBACK_RADIUS_M;
      try {
        const clientConfig = await fetchClientConfig();
        if (cancelled) return;
        setConfig(clientConfig);
        radius = clientConfig.default_search_radius_m;
      } catch {
        // Không lấy được cấu hình thì vẫn chạy với giá trị dự phòng.
      }
      if (!cancelled) await search(INITIAL_CENTER[0], INITIAL_CENTER[1], radius);
    })();
    return () => {
      cancelled = true;
    };
  }, [search]);

  const reloadProjects = useCallback(async () => {
    try {
      setProjects(await api.fetchProjects());
    } catch {
      // Không có ranh giới thì bản đồ vẫn dùng được bình thường.
    }
  }, []);

  useEffect(() => {
    void reloadProjects();
  }, [reloadProjects]);

  /** Chọn một địa điểm từ ô tìm kiếm: phóng bản đồ tới đó. */
  const handlePlace = useCallback(
    (place: Place) => {
      setFocusBounds(place.bbox);
      // Đang vẽ ranh giới thì chỉ dời bản đồ, không nạp lại danh sách hố khoan —
      // nếu không, các đỉnh đang đặt dở sẽ bị xoá theo.
      if (isPicking) {
        setCenter([place.lat, place.lng]);
        return;
      }
      void search(place.lat, place.lng, radiusM);
    },
    [isPicking, search, radiusM],
  );

  const handleSelect = useCallback(async (borehole: Borehole) => {
    sectionAbort.current?.abort();
    const controller = new AbortController();
    sectionAbort.current = controller;

    setSelected(borehole);
    setSection(null);
    setLocked(null);
    setError(null);
    setSectionLoading(true);
    try {
      const result = await fetchSection(borehole.id, controller.signal);
      setSection(result);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      // 402 không phải lỗi: chỉ là chưa mua quyền xem, mời người dùng mở khoá.
      if (err instanceof ApiError && err.status === 402) {
        setLocked({ borehole, message: err.message });
      } else {
        setError(err instanceof ApiError ? err.message : "Có lỗi xảy ra khi tải mặt cắt");
        setSelected(null);
      }
    } finally {
      if (sectionAbort.current === controller) setSectionLoading(false);
    }
  }, []);

  const closeSection = useCallback(() => {
    sectionAbort.current?.abort();
    setSelected(null);
    setSection(null);
    setLocked(null);
  }, []);

  /** Mua quyền xem rồi mở luôn bản vẽ. */
  const unlockAndOpen = useCallback(async () => {
    if (!locked) return;
    setUnlocking(true);
    try {
      const result = await api.unlockBorehole(locked.borehole.id);
      toast.success(
        result.newly_unlocked
          ? `Đã mở khoá ${result.borehole_code}, còn ${result.balance} xu`
          : `${result.borehole_code} đã mở khoá từ trước`,
      );
      await refresh();
      setLocked(null);
      setSectionLoading(true);
      setSection(await fetchSection(locked.borehole.id));
      // Nạp lại danh sách để bỏ biểu tượng ổ khoá ở hố vừa mua.
      void search(center[0], center[1], radiusM);
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        toast.error(err.message);
        setShowWallet(true);
      } else {
        toast.error(err instanceof ApiError ? err.message : "Không mở khoá được");
      }
    } finally {
      setUnlocking(false);
      setSectionLoading(false);
    }
  }, [locked, toast, refresh, search, center, radiusM]);

  // Đóng bản vẽ bằng phím Esc.
  useEffect(() => {
    if (!section && !sectionLoading) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSection();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [section, sectionLoading, closeSection]);

  const handleSaved = useCallback(
    async (saved: Borehole) => {
      setEditorMode(null);
      toast.success(`Đã lưu hố khoan ${saved.code}`);
      await reloadProjects();
      // Hố khoan chưa rõ vị trí không có toạ độ để dời bản đồ tới.
      if (saved.lat !== null && saved.lng !== null) {
        await search(saved.lat, saved.lng, radiusM);
      } else {
        await search(center[0], center[1], radiusM);
      }
    },
    [search, radiusM, center, reloadProjects, toast],
  );

  return (
    <div className={`app ${isPicking ? "is-picking" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-logo">
          <Icon name="drill" size={26} />
          <span className="sidebar-logo-text">
            <strong>GeoStrata</strong>
            <span>WebGIS lỗ khoan địa chất</span>
          </span>
        </div>

        <div className="account-bar">
          {user && (
            <button
              type="button"
              className="account-info"
              onClick={() => setShowProfile(true)}
              title="Mở hồ sơ cá nhân"
            >
              <Avatar user={user} size="md" />
              <span className="account-text">
                <strong>{user.full_name}</strong>
                <span className={`role-tag role-${user.role}`}>{ROLE_LABEL[user.role]}</span>
              </span>
            </button>
          )}
          {config?.coins_enabled && user && !can("manager") && (
            <button
              type="button"
              className="coin-chip"
              onClick={() => setShowWallet(true)}
              title="Mở ví xu"
            >
              <Icon name="coin" size={15} />
              <span className="tabular">{user.coin_balance}</span>
            </button>
          )}
          <ThemeToggle />
          <button
            type="button"
            className="link-btn"
            onClick={() => void logout()}
            aria-label="Đăng xuất"
            title="Đăng xuất"
          >
            <Icon name="logout" size={18} />
          </button>
        </div>

        <div className="action-bar">
          {can("manager") && (
            <button type="button" onClick={() => setEditorMode("create")}>
              <Icon name="plus" /> Thêm hố khoan
            </button>
          )}
          <button type="button" onClick={() => setShowProjects(true)}>
            <Icon name="building" /> Công trình
          </button>
          {can("admin") && (
            <button type="button" onClick={() => setShowUsers(true)}>
              <Icon name="users" /> Tài khoản
            </button>
          )}
          {can("admin") && config?.coins_enabled && (
            <button type="button" onClick={() => setShowPayments(true)}>
              <Icon name="chart" /> Thanh toán
            </button>
          )}
        </div>

        <div className="panel">
          <div className="panel-title">
            <Icon name="search" size={13} /> Vị trí tìm kiếm
          </div>
          <SearchPanel
            center={center}
            radiusM={radiusM}
            config={config}
            loading={loading}
            onSearch={search}
          />
          <p className="hint">Hoặc nhấp trực tiếp lên bản đồ để đổi tâm tìm kiếm.</p>
        </div>

        {error && (
          <div className="error" role="alert">
            <Icon name="alert" /> {error}
          </div>
        )}

        <BoreholeList
          boreholes={boreholes}
          selectedId={selected?.id ?? null}
          loading={loading}
          onSelect={handleSelect}
        />
      </aside>

      <main className="map-area">
        <MapView
          center={center}
          radiusM={radiusM}
          boreholes={boreholes}
          projects={projects}
          selectedId={selected?.id ?? null}
          focusBounds={focusBounds}
          onPick={(lat, lng) => search(lat, lng, radiusM)}
          onSelect={handleSelect}
        />
        {(config?.geocode_enabled ?? true) && <PlaceSearch onSelect={handlePlace} />}
        <MapPickToolbar />
      </main>

      {(sectionLoading || section || locked) && (
        <div
          className="section-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Mặt cắt địa chất"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeSection();
          }}
        >
          <div className="section-tools">
            {can("manager") && section && (
              <button type="button" onClick={() => setEditorMode("edit")}>
                <Icon name="edit" /> Sửa hố khoan
              </button>
            )}
            <button
              type="button"
              className="close-btn-inline"
              onClick={closeSection}
              aria-label="Đóng bản vẽ"
              title="Đóng (Esc)"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
          {sectionLoading ? (
            <div className="section-loading">
              <Icon name="layers" /> Đang tải mặt cắt...
            </div>
          ) : locked ? (
            <div className="locked-card">
              <div className="locked-icon">
                <Icon name="unlock-coin" size={26} />
              </div>
              <h2>Mặt cắt {locked.borehole.code} đang khoá</h2>
              <p className="locked-message">{locked.message}</p>
              <p className="cell-sub">
                Mở khoá một lần, xem lại bao nhiêu lần cũng được. Số dư hiện tại:{" "}
                <strong>{user?.coin_balance ?? 0} xu</strong>.
              </p>
              <div className="locked-actions">
                <button type="button" onClick={closeSection}>
                  Để sau
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={unlocking}
                  onClick={() => void unlockAndOpen()}
                >
                  <Icon name="coin" />{" "}
                  {unlocking ? "Đang mở khoá..." : `Mở khoá ${config?.borehole_unlock_cost ?? 0} xu`}
                </button>
              </div>
              <button type="button" className="link-inline" onClick={() => setShowWallet(true)}>
                Nạp thêm xu
              </button>
            </div>
          ) : (
            section && <CrossSection section={section} />
          )}
        </div>
      )}

      {editorMode && (
        <BoreholeEditor
          existing={editorMode === "edit" ? section : null}
          defaultCenter={center}
          onSaved={handleSaved}
          onClose={() => setEditorMode(null)}
        />
      )}

      {showProjects && (
        <ProjectManagement
          mapCenter={center}
          canEdit={can("manager")}
          canDelete={can("admin")}
          onChanged={() => void reloadProjects()}
          onClose={() => setShowProjects(false)}
        />
      )}

      {showWallet && <CoinWallet onClose={() => setShowWallet(false)} />}

      {showPayments && <PaymentAdmin onClose={() => setShowPayments(false)} />}

      {showProfile && <ProfilePanel config={config} onClose={() => setShowProfile(false)} />}

      {showUsers && <UserManagement onClose={() => setShowUsers(false)} />}
    </div>
  );
}
