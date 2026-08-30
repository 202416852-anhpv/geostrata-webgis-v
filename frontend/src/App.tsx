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
import { distanceM, offsetPoint } from "./map/geo";
import UserManagement from "./components/UserManagement";
import {
  ROLE_LABEL,
  type Borehole,
  type BoreholeSection,
  type BoundingBox,
  type ClientConfig,
  type Place,
  type Project,
  type UnlockedBorehole,
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
  const [showWallet, setShowWallet] = useState<false | "topup" | "unlocks">(false);
  // Lọc xuống chỉ những hố đã mua, áp cho cả danh sách lẫn bản đồ để hai bên khớp nhau.
  const [onlyUnlocked, setOnlyUnlocked] = useState(false);
  const [showPayments, setShowPayments] = useState(false);
  // Hố khoan người dùng bấm vào nhưng chưa mua quyền xem.
  const [locked, setLocked] = useState<{ borehole: Borehole; message: string } | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);

  // Huỷ request cũ khi người dùng bấm liên tiếp, tránh kết quả về sai thứ tự.
  const searchAbort = useRef<AbortController | null>(null);
  const sectionAbort = useRef<AbortController | null>(null);

  /** Trả về danh sách vừa tìm được, hoặc null nếu hỏng / bị huỷ giữa chừng. */
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
      return result.boreholes;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return null;
      setError(err instanceof ApiError ? err.message : "Có lỗi xảy ra khi tìm lỗ khoan");
      setBoreholes([]);
      return null;
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

  /**
   * Đưa bản đồ tới một công trình.
   *
   * Bán kính lấy theo nửa đường chéo khung bao cộng lề, để danh sách bên trái
   * phủ đúng các hố khoan của công trình chứ không chỉ vài hố gần tâm.
   */
  const locateProject = useCallback(
    async (project: Project) => {
      const box = project.bbox;
      if (!box) {
        toast.info(
          `Công trình ${project.code} chưa có ranh giới lẫn hố khoan nào có toạ độ, ` +
            "nên chưa xác định được vị trí trên bản đồ.",
        );
        return;
      }
      setShowProjects(false);

      const half =
        distanceM({ lat: box.south, lng: box.west }, { lat: box.north, lng: box.east }) / 2;
      const radius = Math.round(
        Math.min(
          config?.max_search_radius_m ?? 5000,
          Math.max(config?.default_search_radius_m ?? FALLBACK_RADIUS_M, half * 1.25),
        ),
      );

      // Bản sao mới mỗi lần bấm: bản đồ chỉ phóng lại khi khung bao đổi tham
      // chiếu, nếu truyền thẳng đối tượng cũ thì bấm lần hai sẽ không nhúc nhích.
      setFocusBounds({ ...box });
      await search((box.south + box.north) / 2, (box.west + box.east) / 2, radius);
    },
    [config, search, toast],
  );

  /** Từ ví xu nhảy tới một hố khoan đã mua rồi mở luôn mặt cắt. */
  const locateUnlocked = useCallback(
    async (item: UnlockedBorehole) => {
      setShowWallet(false);

      // Hố khoan khai theo cả công trình thì không có toạ độ để dời bản đồ tới;
      // vẫn mở được mặt cắt vì quyền xem đã mua rồi.
      if (item.lat === null || item.lng === null) {
        toast.info(`${item.borehole_code} chưa rõ vị trí chính xác, chỉ xem được mặt cắt.`);
        sectionAbort.current?.abort();
        setSelected(null);
        setLocked(null);
        setSectionLoading(true);
        try {
          setSection(await fetchSection(item.borehole_id));
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Có lỗi xảy ra khi tải mặt cắt");
        } finally {
          setSectionLoading(false);
        }
        return;
      }

      // Đổi tâm thôi thì chưa đủ: người dùng có thể đã kéo bản đồ đi nơi khác mà
      // tâm vẫn giữ nguyên. Đặt khung bao quanh bán kính tìm kiếm để lần nào bấm
      // bản đồ cũng phóng về đúng chỗ.
      const centre = { lat: item.lat, lng: item.lng };
      const sw = offsetPoint(centre, -radiusM, -radiusM);
      const ne = offsetPoint(centre, radiusM, radiusM);
      setFocusBounds({ south: sw.lat, west: sw.lng, north: ne.lat, east: ne.lng });

      const found = await search(item.lat, item.lng, radiusM);
      const target = found?.find((b) => b.id === item.borehole_id);
      if (target) await handleSelect(target);
    },
    [search, radiusM, handleSelect, toast],
  );

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
        setShowWallet("topup");
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

  // Vai trò quản lý trở lên xem được mọi hố khoan nên không cần phân biệt khoá/mở.
  const paysForData = Boolean(config?.coins_enabled) && !can("manager");
  const visible = onlyUnlocked && paysForData ? boreholes.filter((b) => b.is_unlocked) : boreholes;

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
              onClick={() => setShowWallet("topup")}
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
          {paysForData && (
            <button type="button" onClick={() => setShowWallet("unlocks")}>
              <Icon name="key" /> Đã mua
            </button>
          )}
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
          boreholes={visible}
          selectedId={selected?.id ?? null}
          loading={loading}
          showFilter={paysForData}
          onlyUnlocked={onlyUnlocked}
          onFilterChange={setOnlyUnlocked}
          onSelect={handleSelect}
        />
      </aside>

      <main className="map-area">
        <MapView
          center={center}
          radiusM={radiusM}
          boreholes={visible}
          projects={projects}
          selectedId={selected?.id ?? null}
          showLockState={paysForData}
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
              <button type="button" className="link-inline" onClick={() => setShowWallet("topup")}>
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
          onLocate={(project) => void locateProject(project)}
          onChanged={() => void reloadProjects()}
          onClose={() => setShowProjects(false)}
        />
      )}

      {showWallet && (
        <CoinWallet
          initialTab={showWallet}
          onLocate={(item) => void locateUnlocked(item)}
          onClose={() => setShowWallet(false)}
        />
      )}

      {showPayments && <PaymentAdmin onClose={() => setShowPayments(false)} />}

      {showProfile && <ProfilePanel config={config} onClose={() => setShowProfile(false)} />}

      {showUsers && <UserManagement onClose={() => setShowUsers(false)} />}
    </div>
  );
}
