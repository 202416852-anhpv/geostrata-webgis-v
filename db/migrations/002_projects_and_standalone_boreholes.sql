-- =============================================================================
-- 002 — Hồ sơ công trình đầy đủ, ranh giới đa giác, và hố khoan đơn lẻ
--
-- Ba nghiệp vụ cần hỗ trợ:
--   (1) Thêm một hoặc vài hố khoan ĐƠN LẺ, không thuộc công trình nào.
--   (2) Thêm một công trình kèm danh sách hố khoan bên trong.
--   (3) Thêm địa tầng gắn với CẢ CÔNG TRÌNH khi không rõ vị trí hố khoan.
--
-- Idempotent: chạy lại nhiều lần vẫn ra cùng kết quả.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Hồ sơ công trình
-- ---------------------------------------------------------------------------
ALTER TABLE projects ADD COLUMN IF NOT EXISTS built_year integer;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS scale_description text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS boundary geography(Polygon, 4326);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_by integer REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_by integer REFERENCES users (id) ON DELETE SET NULL;

-- Địa điểm là mô tả tự do, không bắt buộc.
ALTER TABLE projects ALTER COLUMN location_label DROP NOT NULL;

COMMENT ON COLUMN projects.built_year IS 'Năm xây dựng công trình';
COMMENT ON COLUMN projects.scale_description IS 'Quy mô công trình, mô tả tự do: số tầng, diện tích sàn, chiều dài tuyến...';
COMMENT ON COLUMN projects.boundary IS
    'Ranh giới công trình, do trigger tự dựng từ project_vertices. NULL khi có dưới 3 điểm hoặc đường bao tự cắt.';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_built_year_range') THEN
        ALTER TABLE projects ADD CONSTRAINT projects_built_year_range
            CHECK (built_year IS NULL OR built_year BETWEEN 1800 AND 2200);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS projects_boundary_gix ON projects USING gist (boundary);

-- ---------------------------------------------------------------------------
-- 2. Các điểm toạ độ tạo nên ranh giới công trình (điểm 1 -> điểm n)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_vertices (
    id         serial PRIMARY KEY,
    project_id integer NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    ordinal    integer NOT NULL CHECK (ordinal > 0),
    lat        double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lng        double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
    UNIQUE (project_id, ordinal)
);

COMMENT ON TABLE project_vertices IS
    'Các đỉnh ranh giới công trình theo thứ tự nhập. Nối lần lượt điểm 1 -> n rồi khép về điểm 1.';

CREATE INDEX IF NOT EXISTS project_vertices_project_idx ON project_vertices (project_id, ordinal);

-- Dựng lại đa giác ranh giới từ danh sách đỉnh.
CREATE OR REPLACE FUNCTION refresh_project_boundary(p_project_id integer) RETURNS void AS $$
DECLARE
    v_count integer;
    v_line  geometry;
    v_poly  geometry;
BEGIN
    SELECT count(*) INTO v_count FROM project_vertices WHERE project_id = p_project_id;

    -- Dưới 3 điểm thì không thành đa giác; vẫn giữ các điểm đã nhập.
    IF v_count < 3 THEN
        UPDATE projects SET boundary = NULL WHERE id = p_project_id;
        RETURN;
    END IF;

    SELECT ST_MakeLine(ST_SetSRID(ST_MakePoint(lng, lat), 4326) ORDER BY ordinal)
      INTO v_line
      FROM project_vertices
     WHERE project_id = p_project_id;

    -- Khép vòng: điểm cuối phải trùng điểm đầu thì mới tạo được đa giác.
    IF NOT ST_Equals(ST_StartPoint(v_line), ST_EndPoint(v_line)) THEN
        v_line := ST_AddPoint(v_line, ST_StartPoint(v_line));
    END IF;

    v_poly := ST_MakePolygon(v_line);

    -- Đường bao tự cắt tạo ra đa giác không hợp lệ; ép kiểu sang geography sẽ
    -- lỗi và làm hỏng cả giao dịch, nên để NULL và báo lại ở tầng ứng dụng.
    IF NOT ST_IsValid(v_poly) THEN
        v_poly := NULL;
    END IF;

    UPDATE projects SET boundary = v_poly::geography WHERE id = p_project_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION project_vertices_sync_boundary() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM refresh_project_boundary(OLD.project_id);
        RETURN OLD;
    END IF;

    PERFORM refresh_project_boundary(NEW.project_id);
    IF TG_OP = 'UPDATE' AND OLD.project_id IS DISTINCT FROM NEW.project_id THEN
        PERFORM refresh_project_boundary(OLD.project_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS project_vertices_sync_boundary_trg ON project_vertices;
CREATE TRIGGER project_vertices_sync_boundary_trg
    AFTER INSERT OR UPDATE OR DELETE ON project_vertices
    FOR EACH ROW EXECUTE FUNCTION project_vertices_sync_boundary();

-- ---------------------------------------------------------------------------
-- 3. Hố khoan: thuộc công trình hoặc đứng riêng, có thể chưa rõ vị trí
-- ---------------------------------------------------------------------------
ALTER TABLE boreholes ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE boreholes ALTER COLUMN lat DROP NOT NULL;
ALTER TABLE boreholes ALTER COLUMN lng DROP NOT NULL;

ALTER TABLE boreholes ADD COLUMN IF NOT EXISTS drilling_company text;
ALTER TABLE boreholes ADD COLUMN IF NOT EXISTS location_kind text NOT NULL DEFAULT 'point';

COMMENT ON COLUMN boreholes.project_id IS 'NULL = hố khoan đơn lẻ, không thuộc công trình nào';
COMMENT ON COLUMN boreholes.drilling_company IS 'Đơn vị thi công khoan';
COMMENT ON COLUMN boreholes.location_kind IS
    'point = có toạ độ chính xác; project_area = chỉ biết thuộc công trình, chưa rõ vị trí hố khoan';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'boreholes_location_kind_valid') THEN
        ALTER TABLE boreholes ADD CONSTRAINT boreholes_location_kind_valid
            CHECK (location_kind IN ('point', 'project_area'));
    END IF;

    -- Có toạ độ thì phải đủ cả lat lẫn lng; chưa rõ vị trí thì bắt buộc gắn công trình.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'boreholes_location_consistent') THEN
        ALTER TABLE boreholes ADD CONSTRAINT boreholes_location_consistent
            CHECK (
                (location_kind = 'point' AND lat IS NOT NULL AND lng IS NOT NULL)
                OR (location_kind = 'project_area' AND project_id IS NOT NULL)
            );
    END IF;
END $$;

-- UNIQUE (project_id, code) sẵn có không ràng buộc được hố khoan đơn lẻ, vì
-- trong SQL hai giá trị NULL không bằng nhau. Cần chỉ mục riêng cho nhóm đó.
CREATE UNIQUE INDEX IF NOT EXISTS boreholes_standalone_code_key
    ON boreholes (code) WHERE project_id IS NULL;

CREATE INDEX IF NOT EXISTS boreholes_location_kind_idx ON boreholes (location_kind);

-- lat/lng giờ có thể NULL, geom phải theo cho đúng.
CREATE OR REPLACE FUNCTION boreholes_sync_geom() RETURNS trigger AS $$
BEGIN
    IF NEW.lat IS NULL OR NEW.lng IS NULL THEN
        NEW.geom := NULL;
    ELSE
        NEW.geom := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 4. View tra cứu công trình kèm số liệu tổng hợp
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_project_summary AS
SELECT
    p.id,
    p.code,
    p.name,
    p.location_label,
    p.built_year,
    p.scale_description,
    (SELECT count(*) FROM project_vertices v WHERE v.project_id = p.id)      AS vertex_count,
    (p.boundary IS NOT NULL)                                                  AS has_boundary,
    CASE WHEN p.boundary IS NOT NULL THEN round(ST_Area(p.boundary)::numeric, 1) END AS area_m2,
    CASE WHEN p.boundary IS NOT NULL THEN round(ST_Perimeter(p.boundary)::numeric, 1) END AS perimeter_m,
    (SELECT count(*) FROM boreholes b WHERE b.project_id = p.id)              AS borehole_count,
    (SELECT count(*) FROM boreholes b
      WHERE b.project_id = p.id AND b.location_kind = 'project_area')         AS unlocated_borehole_count
FROM projects p;

COMMENT ON VIEW v_project_summary IS 'Công trình kèm diện tích, chu vi và số hố khoan — tiện tra cứu bằng psql/Adminer';
