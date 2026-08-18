import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";
import { ApiError, fetchClientConfig, fetchSection, searchBoreholes } from "./api";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import Avatar from "./components/Avatar";
import BoreholeEditor from "./components/BoreholeEditor";
import BoreholeList from "./components/BoreholeList";
import CrossSection from "./components/CrossSection";
import Icon from "./components/Icon";
import LoginPage from "./components/LoginPage";
import MapView from "./components/MapView";
import ProfilePanel from "./components/ProfilePanel";
import ProjectManagement from "./components/ProjectManagement";
import SearchPanel from "./components/SearchPanel";
import ThemeToggle from "./components/ThemeToggle";
import UserManagement from "./components/UserManagement";
import {
  ROLE_LABEL,
  type Borehole,
  type BoreholeSection,
  type ClientConfig,
  type Project,
} from "./types";

const INITIAL_CENTER: [number, number] = [10.7769, 106.6953];
const FALLBACK_RADIUS_M = 150;

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
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
  const { user, logout, can } = useAuth();

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
  const [showUsers, setShowUsers] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
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

  const handleSelect = useCallback(async (borehole: Borehole) => {
    sectionAbort.current?.abort();
    const controller = new AbortController();
    sectionAbort.current = controller;

    setSelected(borehole);
    setSection(null);
    setError(null);
    setSectionLoading(true);
    try {
      const result = await fetchSection(borehole.id, controller.signal);
      setSection(result);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof ApiError ? err.message : "Có lỗi xảy ra khi tải mặt cắt");
      setSelected(null);
    } finally {
      if (sectionAbort.current === controller) setSectionLoading(false);
    }
  }, []);

  const closeSection = useCallback(() => {
    sectionAbort.current?.abort();
    setSelected(null);
    setSection(null);
  }, []);

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
      await reloadProjects();
      // Hố khoan chưa rõ vị trí không có toạ độ để dời bản đồ tới.
      if (saved.lat !== null && saved.lng !== null) {
        await search(saved.lat, saved.lng, radiusM);
      } else {
        await search(center[0], center[1], radiusM);
      }
    },
    [search, radiusM, center, reloadProjects],
  );

  return (
    <div className="app">
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
          onPick={(lat, lng) => search(lat, lng, radiusM)}
          onSelect={handleSelect}
        />
      </main>

      {(sectionLoading || section) && (
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

      {showProfile && <ProfilePanel config={config} onClose={() => setShowProfile(false)} />}

      {showUsers && <UserManagement onClose={() => setShowUsers(false)} />}
    </div>
  );
}
