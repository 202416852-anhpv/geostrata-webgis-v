-- =============================================================================
-- 001 — Tài khoản, phiên đăng nhập và dấu vết chỉnh sửa lỗ khoan
--
-- File này do backend chạy lúc khởi động (app/migrate.py), KHÔNG phải PostgreSQL
-- tự chạy như db/init/. Nhờ vậy nó áp được cho cả CSDL mới lẫn CSDL đã có sẵn
-- dữ liệu, nên không phải xoá volume khi nâng cấp.
--
-- Mọi câu lệnh đều idempotent: chạy lại nhiều lần vẫn cho cùng kết quả.
-- =============================================================================

-- Tài khoản người dùng --------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            serial PRIMARY KEY,
    username      text        NOT NULL UNIQUE,
    full_name     text        NOT NULL,
    email         text        UNIQUE,
    password_hash text        NOT NULL,
    role          text        NOT NULL DEFAULT 'user'
                  CHECK (role IN ('admin', 'manager', 'user')),
    is_active     boolean     NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz
);

COMMENT ON TABLE users IS 'Tài khoản đăng nhập hệ thống';
COMMENT ON COLUMN users.role IS
    'admin = toàn quyền + quản lý tài khoản; manager = nhập/sửa lỗ khoan; user = chỉ tra cứu';
COMMENT ON COLUMN users.password_hash IS 'Băm bằng bcrypt, không bao giờ lưu mật khẩu gốc';

-- Phiên đăng nhập -------------------------------------------------------------
-- Dùng token ngẫu nhiên lưu phía server thay cho JWT: đăng xuất, khoá tài khoản
-- hay hạ quyền đều có hiệu lực NGAY, không phải chờ token hết hạn.
CREATE TABLE IF NOT EXISTS sessions (
    id          serial PRIMARY KEY,
    user_id     integer     NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash  char(64)    NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    user_agent  text
);

COMMENT ON TABLE sessions IS 'Phiên đăng nhập đang hoạt động';
COMMENT ON COLUMN sessions.token_hash IS
    'SHA-256 của token. Token gốc chỉ tồn tại ở trình duyệt, CSDL rò rỉ cũng không mạo danh được';

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

-- Dấu vết chỉnh sửa lỗ khoan --------------------------------------------------
ALTER TABLE boreholes
    ADD COLUMN IF NOT EXISTS created_by integer REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE boreholes
    ADD COLUMN IF NOT EXISTS updated_by integer REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE boreholes
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN boreholes.created_by IS 'Người nhập lỗ khoan; NULL = dữ liệu do seeder sinh';
COMMENT ON COLUMN boreholes.updated_by IS 'Người sửa gần nhất';

CREATE INDEX IF NOT EXISTS boreholes_created_by_idx ON boreholes (created_by);
