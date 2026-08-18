-- =============================================================================
-- GeoStrata WebGIS - lược đồ CSDL
-- Script này được PostgreSQL tự chạy đúng MỘT lần, khi volume dữ liệu còn rỗng.
-- Muốn chạy lại: docker compose down -v && docker compose up -d
-- =============================================================================

-- Công trình khảo sát ---------------------------------------------------------
CREATE TABLE projects (
    id              serial PRIMARY KEY,
    code            text        NOT NULL UNIQUE,
    name            text        NOT NULL,
    location_label  text        NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE projects IS 'Công trình / dự án khảo sát địa chất';

-- Danh mục loại đất (dữ liệu tham chiếu) --------------------------------------
CREATE TABLE soil_types (
    id           serial PRIMARY KEY,
    code         text    NOT NULL UNIQUE,
    name         text    NOT NULL,
    description  text    NOT NULL,
    color        char(7) NOT NULL CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
    pattern      text    NOT NULL
                 CHECK (pattern IN ('hatch', 'crosshatch', 'dots', 'gravel', 'sand', 'dense')),
    is_fill      boolean NOT NULL DEFAULT false,
    strata_order integer NOT NULL CHECK (strata_order > 0),
    -- DEFERRED: khi sửa data/soil_types.json để sắp xếp lại cột địa tầng, seeder
    -- cập nhật lần lượt từng dòng và có thể trùng thứ tự giữa chừng. Kiểm tra ở
    -- thời điểm commit nên chỉ cần kết quả cuối cùng là hợp lệ.
    CONSTRAINT soil_types_strata_order_key UNIQUE (strata_order) DEFERRABLE INITIALLY DEFERRED
);

COMMENT ON TABLE soil_types IS 'Danh mục loại đất: tên, mô tả, màu và ký hiệu vẽ mặt cắt';
COMMENT ON COLUMN soil_types.strata_order IS
    'Vị trí trong cột địa tầng chuẩn (nhỏ = nông hơn). Dùng để sinh địa tầng đúng thứ tự trầm tích.';
COMMENT ON COLUMN soil_types.is_fill IS 'true = lớp đất đắp/san lấp, đánh mã lớp "k" theo quy ước hồ sơ địa chất';

-- Lỗ khoan --------------------------------------------------------------------
CREATE TABLE boreholes (
    id               serial PRIMARY KEY,
    project_id       integer NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    code             text    NOT NULL,
    name             text    NOT NULL,
    lat              double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lng              double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
    geom             geography(Point, 4326),
    depth_m          numeric(6, 2) NOT NULL CHECK (depth_m > 0),
    ground_level_m   numeric(6, 2),
    water_level_m    numeric(6, 2) CHECK (water_level_m IS NULL OR water_level_m >= 0),
    drilled_on       date,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, code)
);

COMMENT ON TABLE boreholes IS 'Lỗ khoan khảo sát; geom được trigger tự sinh từ lat/lng';
COMMENT ON COLUMN boreholes.depth_m IS 'Chiều sâu khoan (m)';
COMMENT ON COLUMN boreholes.ground_level_m IS 'Cao độ mặt đất so với mốc chuẩn (m)';
COMMENT ON COLUMN boreholes.water_level_m IS 'Chiều sâu mực nước ngầm tính từ mặt đất (m)';

-- geom luôn đồng bộ với lat/lng, bất kể ai ghi dữ liệu.
CREATE OR REPLACE FUNCTION boreholes_sync_geom() RETURNS trigger AS $$
BEGIN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER boreholes_sync_geom_trg
    BEFORE INSERT OR UPDATE OF lat, lng ON boreholes
    FOR EACH ROW EXECUTE FUNCTION boreholes_sync_geom();

CREATE INDEX boreholes_geom_gix ON boreholes USING gist (geom);
CREATE INDEX boreholes_project_idx ON boreholes (project_id);

-- Địa tầng của từng lỗ khoan --------------------------------------------------
CREATE TABLE borehole_layers (
    id            serial PRIMARY KEY,
    borehole_id   integer NOT NULL REFERENCES boreholes (id) ON DELETE CASCADE,
    soil_type_id  integer NOT NULL REFERENCES soil_types (id),
    layer_code    text    NOT NULL,
    ordinal       integer NOT NULL CHECK (ordinal > 0),
    top_depth_m   numeric(6, 2) NOT NULL CHECK (top_depth_m >= 0),
    bottom_depth_m numeric(6, 2) NOT NULL,
    CONSTRAINT layer_depth_order CHECK (bottom_depth_m > top_depth_m),
    UNIQUE (borehole_id, ordinal)
);

COMMENT ON TABLE borehole_layers IS 'Các lớp địa tầng theo chiều sâu của một lỗ khoan';
COMMENT ON COLUMN borehole_layers.layer_code IS 'Mã lớp hiển thị trên bản vẽ: "k" cho lớp đất đắp, còn lại 1, 2, 3...';

CREATE INDEX borehole_layers_borehole_idx ON borehole_layers (borehole_id, ordinal);

-- View tiện dụng: mặt cắt đã ghép sẵn với danh mục đất -------------------------
CREATE VIEW v_borehole_sections AS
SELECT
    b.id            AS borehole_id,
    b.code          AS borehole_code,
    b.depth_m       AS borehole_depth_m,
    l.ordinal,
    l.layer_code,
    l.top_depth_m,
    l.bottom_depth_m,
    (l.bottom_depth_m - l.top_depth_m) AS thickness_m,
    s.code          AS soil_code,
    s.name          AS soil_name,
    s.description   AS soil_description,
    s.color,
    s.pattern
FROM borehole_layers l
JOIN boreholes b  ON b.id = l.borehole_id
JOIN soil_types s ON s.id = l.soil_type_id
ORDER BY b.id, l.ordinal;
