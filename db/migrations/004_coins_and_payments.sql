-- =============================================================================
-- 004 — Ví xu, đơn nạp tiền và quyền xem hố khoan đã mua
--
-- Nguyên tắc kế toán áp dụng ở đây:
--
--  1. coin_transactions là SỔ CÁI CHỈ GHI THÊM. Mọi thay đổi số dư đều phải có
--     một dòng tương ứng, kèm số dư sau giao dịch để đối soát lại được.
--  2. users.coin_balance chỉ là giá trị tổng hợp cho nhanh. Nó luôn được cập
--     nhật trong CÙNG giao dịch với dòng sổ cái, và có ràng buộc không âm.
--  3. Hồ sơ thanh toán phải sống lâu hơn tài khoản: xoá người dùng thì đơn hàng
--     vẫn còn (user_id thành NULL) kèm ảnh chụp tên đăng nhập để tra cứu.
--
-- Idempotent: chạy lại nhiều lần vẫn ra cùng kết quả.
-- =============================================================================

-- --------------------------------------------------------------------------
-- 1. Ví xu
-- --------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS coin_balance integer NOT NULL DEFAULT 0;

DO $$
BEGIN
    -- Chốt cuối cùng chống số dư âm, kể cả khi tầng ứng dụng có lỗi.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_coin_balance_non_negative') THEN
        ALTER TABLE users ADD CONSTRAINT users_coin_balance_non_negative
            CHECK (coin_balance >= 0);
    END IF;
END $$;

COMMENT ON COLUMN users.coin_balance IS
    'Số dư xu, tổng hợp từ coin_transactions. Luôn cập nhật cùng giao dịch với sổ cái.';

-- --------------------------------------------------------------------------
-- 2. Gói xu bán ra
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coin_packages (
    id           serial PRIMARY KEY,
    code         text    NOT NULL UNIQUE,
    name         text    NOT NULL,
    coins        integer NOT NULL CHECK (coins > 0),
    bonus_coins  integer NOT NULL DEFAULT 0 CHECK (bonus_coins >= 0),
    price_vnd    integer NOT NULL CHECK (price_vnd >= 0),
    is_active    boolean NOT NULL DEFAULT true,
    sort_order   integer NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE coin_packages IS 'Các gói xu người dùng có thể mua';
COMMENT ON COLUMN coin_packages.bonus_coins IS 'Xu tặng thêm; tổng nhận được = coins + bonus_coins';

-- --------------------------------------------------------------------------
-- 3. Đơn nạp xu
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_orders (
    id             serial PRIMARY KEY,
    reference      text    NOT NULL UNIQUE,
    user_id        integer REFERENCES users (id) ON DELETE SET NULL,
    username_snapshot text NOT NULL,
    package_id     integer REFERENCES coin_packages (id) ON DELETE SET NULL,
    coins          integer NOT NULL CHECK (coins > 0),
    amount_vnd     integer NOT NULL CHECK (amount_vnd >= 0),
    status         text    NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'paid', 'cancelled', 'expired')),
    provider       text    NOT NULL DEFAULT 'manual',
    note           text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    expires_at     timestamptz,
    paid_at        timestamptz,
    confirmed_by   integer REFERENCES users (id) ON DELETE SET NULL
);

COMMENT ON TABLE payment_orders IS 'Đơn nạp xu; giữ lại cả khi tài khoản đã bị xoá';
COMMENT ON COLUMN payment_orders.reference IS 'Mã tham chiếu người dùng ghi vào nội dung chuyển khoản';
COMMENT ON COLUMN payment_orders.username_snapshot IS
    'Tên đăng nhập tại thời điểm đặt đơn — vẫn tra được sau khi tài khoản bị xoá';

CREATE INDEX IF NOT EXISTS payment_orders_user_idx ON payment_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_orders_status_idx ON payment_orders (status, created_at DESC);

-- --------------------------------------------------------------------------
-- 4. Sổ cái xu
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coin_transactions (
    id            serial PRIMARY KEY,
    user_id       integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- Dương = xu vào ví, âm = xu ra khỏi ví. Không cho phép dòng bằng 0.
    amount        integer NOT NULL CHECK (amount <> 0),
    balance_after integer NOT NULL CHECK (balance_after >= 0),
    kind          text    NOT NULL
                  CHECK (kind IN ('topup', 'purchase', 'refund', 'admin_grant', 'admin_revoke')),
    order_id      integer REFERENCES payment_orders (id) ON DELETE SET NULL,
    borehole_id   integer REFERENCES boreholes (id) ON DELETE SET NULL,
    description   text    NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE coin_transactions IS 'Sổ cái xu, chỉ ghi thêm — không sửa, không xoá dòng đã ghi';
COMMENT ON COLUMN coin_transactions.balance_after IS
    'Số dư ngay sau giao dịch, dùng để đối soát với users.coin_balance';

CREATE INDEX IF NOT EXISTS coin_transactions_user_idx ON coin_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coin_transactions_kind_idx ON coin_transactions (kind, created_at DESC);

-- --------------------------------------------------------------------------
-- 5. Quyền xem hố khoan đã mua
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS borehole_unlocks (
    id             serial PRIMARY KEY,
    user_id        integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    borehole_id    integer NOT NULL REFERENCES boreholes (id) ON DELETE CASCADE,
    coins_spent    integer NOT NULL CHECK (coins_spent >= 0),
    transaction_id integer REFERENCES coin_transactions (id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    -- Chốt chống mua trùng: hai yêu cầu chạy song song thì chỉ một cái ghi được.
    UNIQUE (user_id, borehole_id)
);

COMMENT ON TABLE borehole_unlocks IS 'Hố khoan mà người dùng đã mua quyền xem, vĩnh viễn';

CREATE INDEX IF NOT EXISTS borehole_unlocks_user_idx ON borehole_unlocks (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS borehole_unlocks_borehole_idx ON borehole_unlocks (borehole_id);

-- --------------------------------------------------------------------------
-- 6. View đối soát: phát hiện lệch giữa số dư và sổ cái
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_coin_balance_audit AS
SELECT
    u.id            AS user_id,
    u.username,
    u.coin_balance  AS recorded_balance,
    COALESCE(SUM(t.amount), 0) AS ledger_balance,
    u.coin_balance - COALESCE(SUM(t.amount), 0) AS difference
FROM users u
LEFT JOIN coin_transactions t ON t.user_id = u.id
GROUP BY u.id, u.username, u.coin_balance;

COMMENT ON VIEW v_coin_balance_audit IS
    'Số dư ghi trên tài khoản so với tổng sổ cái. Cột difference phải luôn bằng 0.';
