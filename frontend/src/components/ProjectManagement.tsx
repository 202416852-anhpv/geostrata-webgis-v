/** Quản lý hồ sơ công trình và ranh giới — manager trở lên. */

import { useCallback, useEffect, useState, type FormEvent } from "react";
import * as api from "../api";
import { ApiError } from "../api";
import type { Project, Vertex } from "../types";
import ConfirmDialog from "./ConfirmDialog";
import FormError from "./FormError";
import Icon from "./Icon";
import { useToast } from "./Toast";

interface DraftVertex {
  lat: string;
  lng: string;
}

interface ProjectManagementProps {
  /** Điểm đang xem trên bản đồ, dùng làm gợi ý khi thêm đỉnh mới. */
  mapCenter: [number, number];
  canEdit: boolean;
  canDelete: boolean;
  onChanged: () => void;
  onClose: () => void;
}

const EMPTY_FORM = {
  code: "",
  name: "",
  location_label: "",
  built_year: "",
  scale_description: "",
};

export default function ProjectManagement({
  mapCenter,
  canEdit,
  canDelete,
  onChanged,
  onClose,
}: ProjectManagementProps) {
  const toast = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Lỗi của biểu mẫu để riêng và hiện ngay cạnh nút Lưu, không đẩy lên đầu.
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);

  const [editing, setEditing] = useState<Project | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [vertices, setVertices] = useState<DraftVertex[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setProjects(await api.fetchProjects());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Không tải được danh sách công trình");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openCreate = () => {
    setEditing(null);
    setCreating(true);
    setForm({ ...EMPTY_FORM });
    setVertices([]);
    setFormError(null);
  };

  const openEdit = (project: Project) => {
    setCreating(false);
    setEditing(project);
    setForm({
      code: project.code,
      name: project.name,
      location_label: project.location_label ?? "",
      built_year: project.built_year === null ? "" : String(project.built_year),
      scale_description: project.scale_description ?? "",
    });
    setVertices(project.vertices.map((v) => ({ lat: String(v.lat), lng: String(v.lng) })));
    setFormError(null);
  };

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
  };

  const addVertex = () => {
    // Điểm mới lấy theo tâm bản đồ đang xem cho đỡ phải gõ tay.
    setVertices((current) => [
      ...current,
      { lat: mapCenter[0].toFixed(6), lng: mapCenter[1].toFixed(6) },
    ]);
  };

  const updateVertex = (index: number, patch: Partial<DraftVertex>) => {
    setVertices((current) => current.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  };

  const removeVertex = (index: number) => {
    setVertices((current) => current.filter((_, i) => i !== index));
  };

  const moveVertex = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= vertices.length) return;
    setVertices((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setFormError("Tên công trình không được để trống");
      return;
    }

    const parsed: Vertex[] = [];
    for (const [index, vertex] of vertices.entries()) {
      const lat = Number(vertex.lat);
      const lng = Number(vertex.lng);
      if (!Number.isFinite(lat) || Math.abs(lat) > 90) {
        setFormError(`Điểm ${index + 1}: vĩ độ không hợp lệ`);
        return;
      }
      if (!Number.isFinite(lng) || Math.abs(lng) > 180) {
        setFormError(`Điểm ${index + 1}: kinh độ không hợp lệ`);
        return;
      }
      parsed.push({ lat, lng });
    }

    const payload = {
      name: form.name.trim(),
      location_label: form.location_label.trim() || null,
      built_year: form.built_year === "" ? null : Number(form.built_year),
      scale_description: form.scale_description.trim() || null,
      vertices: parsed,
    };

    setFormError(null);
    setBusy(true);
    try {
      const saved = editing
        ? await api.updateProject(editing.id, payload)
        : await api.createProject({ ...payload, code: form.code.trim() });

      // Ranh giới không dựng được thì phải nói rõ, đừng để tưởng đã lưu xong.
      if (parsed.length > 0 && !saved.has_boundary) {
        toast.info(
          parsed.length < 3
            ? `Đã lưu ${parsed.length} điểm. Cần từ 3 điểm trở lên mới tạo được ranh giới.`
            : "Đã lưu các điểm nhưng đường bao tự cắt nhau nên chưa tạo được ranh giới. Hãy kiểm tra lại thứ tự điểm.",
        );
      } else {
        toast.success(
          saved.has_boundary
            ? `Đã lưu công trình ${saved.code}, ranh giới ${saved.area_m2?.toLocaleString("vi-VN")} m².`
            : `Đã lưu công trình ${saved.code}.`,
        );
      }
      closeForm();
      await reload();
      onChanged();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Không lưu được công trình");
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const project = pendingDelete;
    setPendingDelete(null);
    try {
      await api.deleteProject(project.id);
      toast.success(`Đã xoá công trình ${project.code}`);
      await reload();
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không xoá được công trình");
    }
  };

  const showForm = creating || editing !== null;

  return (
    <>
      <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal-panel" role="dialog" aria-modal="true" aria-label="Quản lý công trình">
        <header className="modal-header">
          <h2>
            <Icon name="building" size={18} /> Công trình
            <span className="count-badge">{projects.length}</span>
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

        {canEdit && !showForm && (
          <div className="modal-toolbar">
            <button type="button" onClick={openCreate}>
              <Icon name="plus" /> Thêm công trình
            </button>
          </div>
        )}

        {showForm && (
          <form className="project-form" onSubmit={handleSubmit}>
            <div className="form-grid">
              <label>
                Mã công trình
                <input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  disabled={editing !== null}
                  placeholder="CT-01"
                  required
                />
              </label>
              <label>
                Tên công trình
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </label>
              <label>
                Năm xây dựng
                <input
                  type="number"
                  min={1800}
                  max={2200}
                  value={form.built_year}
                  onChange={(e) => setForm({ ...form, built_year: e.target.value })}
                  placeholder="2020"
                />
              </label>
              <label>
                Địa điểm
                <input
                  value={form.location_label}
                  onChange={(e) => setForm({ ...form, location_label: e.target.value })}
                  placeholder="Quận 1, TP.HCM"
                />
              </label>
              <label className="form-wide">
                Quy mô công trình
                <input
                  value={form.scale_description}
                  onChange={(e) => setForm({ ...form, scale_description: e.target.value })}
                  placeholder="18 tầng, 2 tầng hầm, 24.000 m² sàn"
                />
              </label>
            </div>

            <div className="modal-section-title">
              <span>
                <Icon name="map-pin" size={13} /> Toạ độ ranh giới ({vertices.length} điểm)
              </span>
              <button type="button" onClick={addVertex}>
                <Icon name="plus" /> Thêm điểm
              </button>
            </div>

            {vertices.length === 0 && (
              <p className="panel-empty">
                Chưa có điểm nào. Ranh giới là tuỳ chọn — cần từ 3 điểm trở lên, nối lần
                lượt điểm 1 → điểm n rồi tự khép về điểm 1.
              </p>
            )}
            {vertices.length > 0 && vertices.length < 3 && (
              <p className="field-error">Cần thêm ít nhất {3 - vertices.length} điểm nữa mới tạo được ranh giới.</p>
            )}

            {vertices.map((vertex, index) => (
              <div className="vertex-row" key={index}>
                <span className="vertex-index">{index + 1}</span>
                <input
                  type="number"
                  step="any"
                  value={vertex.lat}
                  onChange={(e) => updateVertex(index, { lat: e.target.value })}
                  aria-label={`Vĩ độ điểm ${index + 1}`}
                  placeholder="Vĩ độ"
                />
                <input
                  type="number"
                  step="any"
                  value={vertex.lng}
                  onChange={(e) => updateVertex(index, { lng: e.target.value })}
                  aria-label={`Kinh độ điểm ${index + 1}`}
                  placeholder="Kinh độ"
                />
                <button
                  type="button"
                  onClick={() => moveVertex(index, -1)}
                  aria-label={`Đưa điểm ${index + 1} lên trên`}
                >
                  <Icon name="arrow-up" />
                </button>
                <button
                  type="button"
                  onClick={() => moveVertex(index, 1)}
                  aria-label={`Đưa điểm ${index + 1} xuống dưới`}
                >
                  <Icon name="arrow-down" />
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => removeVertex(index)}
                  aria-label={`Xoá điểm ${index + 1}`}
                >
                  <Icon name="trash" />
                </button>
              </div>
            ))}

            <FormError message={formError} />

            <div className="modal-footer">
              <button type="button" onClick={closeForm}>
                Huỷ
              </button>
              <button type="submit" className="primary" disabled={busy}>
                {busy ? "Đang lưu..." : editing ? "Lưu thay đổi" : "Thêm công trình"}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="panel-empty">Đang tải...</div>
        ) : (
          <table className="user-table">
            <thead>
              <tr>
                <th>Công trình</th>
                <th>Năm XD</th>
                <th>Ranh giới</th>
                <th>Hố khoan</th>
                {canEdit && <th aria-label="Thao tác" />}
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <td>
                    <strong>{project.code}</strong>
                    <div className="cell-sub">{project.name}</div>
                    {project.scale_description && (
                      <div className="cell-sub">{project.scale_description}</div>
                    )}
                  </td>
                  <td>{project.built_year ?? "—"}</td>
                  <td>
                    {project.has_boundary ? (
                      <>
                        <span className="badge-ok">{project.vertices.length} điểm</span>
                        <div className="cell-sub">
                          {project.area_m2?.toLocaleString("vi-VN")} m²
                        </div>
                      </>
                    ) : project.vertices.length > 0 ? (
                      <span className="badge-off">{project.vertices.length} điểm, chưa khép</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{project.borehole_count}</td>
                  {canEdit && (
                    <td className="cell-actions">
                      <button type="button" onClick={() => openEdit(project)} title="Sửa công trình">
                        <Icon name="edit" />
                      </button>
                      {canDelete && (
                        <button
                          type="button"
                          className="danger"
                          onClick={() => setPendingDelete(project)}
                          title="Xoá công trình"
                        >
                          <Icon name="trash" />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        </div>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Xoá công trình"
          message={`Xoá công trình "${pendingDelete.name}" (${pendingDelete.code})?`}
          detail={
            pendingDelete.borehole_count > 0
              ? `${pendingDelete.borehole_count} hố khoan bên trong sẽ bị xoá theo và không khôi phục được.`
              : "Công trình này chưa có hố khoan nào."
          }
          confirmLabel="Xoá công trình"
          destructive
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );
}
