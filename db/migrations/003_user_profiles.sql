-- =============================================================================
-- 003 — Hồ sơ người dùng: thông tin liên hệ và ảnh đại diện
--
-- Ảnh lưu thẳng trong CSDL dưới dạng bytea thay vì ghi ra đĩa: hệ thống chạy
-- local bằng Docker, giữ ảnh trong CSDL thì sao lưu/khôi phục chỉ cần một
-- pg_dump, không phải quản lý thêm volume và không sợ lệch dữ liệu với file.
-- Đổi lại phải giới hạn dung lượng ảnh (xem MAX_AVATAR_BYTES ở backend).
--
-- Idempotent: chạy lại nhiều lần vẫn ra cùng kết quả.
-- =============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS organization text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar bytea;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_mime text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_updated_at timestamptz;

COMMENT ON COLUMN users.phone IS 'Số điện thoại liên hệ';
COMMENT ON COLUMN users.job_title IS 'Chức danh, ví dụ: Kỹ sư địa chất';
COMMENT ON COLUMN users.organization IS 'Đơn vị công tác';
COMMENT ON COLUMN users.avatar IS 'Ảnh đại diện dạng nhị phân; truy vấn danh sách không nạp cột này';
COMMENT ON COLUMN users.avatar_updated_at IS 'Dùng làm khoá cache phía trình duyệt';

DO $$
BEGIN
    -- Ảnh và kiểu MIME phải đi cùng nhau, nếu không sẽ không trả nổi HTTP response.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_avatar_consistent') THEN
        ALTER TABLE users ADD CONSTRAINT users_avatar_consistent
            CHECK ((avatar IS NULL AND avatar_mime IS NULL)
                OR (avatar IS NOT NULL AND avatar_mime IS NOT NULL));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_avatar_mime_allowed') THEN
        ALTER TABLE users ADD CONSTRAINT users_avatar_mime_allowed
            CHECK (avatar_mime IS NULL
                OR avatar_mime IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif'));
    END IF;
END $$;

-- Email dùng để đăng nhập lại / liên hệ nên không được phân biệt hoa thường.
-- Chỉ mục duy nhất theo lower(email) chặn "A@x.com" và "a@x.com" cùng tồn tại.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key
    ON users (lower(email)) WHERE email IS NOT NULL;
