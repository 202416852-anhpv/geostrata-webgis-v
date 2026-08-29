"""Kiểm thử nghiệp vụ ví xu.

Dùng SQLite trong bộ nhớ, không cần PostgreSQL. Đổi lại SQLite bỏ qua
``FOR UPDATE`` và không có CHECK của lược đồ thật, nên phần chống tranh chấp và
chống số dư âm ở tầng CSDL được kiểm bằng kịch bản đầu-cuối riêng
(scratchpad/verify_coins.py) chạy trên PostgreSQL thật.

Ở đây tập trung vào những quy tắc thuần logic: cộng trừ đúng, sổ cái khớp số dư,
không tính tiền hai lần, không cộng xu hai lần.
"""

from __future__ import annotations

import datetime as dt

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app import coins
from app.database import Base
from app.models import (
    Borehole,
    BoreholeUnlock,
    CoinPackage,
    CoinTransaction,
    PaymentOrder,
    User,
)


@pytest.fixture
def db():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    # Chỉ dựng các bảng cần cho ví xu; bảng hố khoan có cột PostGIS không tạo
    # được trên SQLite nên bỏ qua bằng cách chỉ tạo những bảng liên quan.
    Base.metadata.create_all(
        engine,
        tables=[
            User.__table__,
            CoinPackage.__table__,
            Borehole.__table__,
            CoinTransaction.__table__,
            PaymentOrder.__table__,
            BoreholeUnlock.__table__,
        ],
    )
    with Session(engine) as session:
        yield session


@pytest.fixture
def user(db: Session) -> User:
    now = dt.datetime.now(dt.timezone.utc)
    row = User(
        username="nguoimua",
        full_name="Nguoi Mua",
        password_hash="x",
        role="user",
        is_active=True,
        coin_balance=0,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.flush()
    return row


@pytest.fixture
def package(db: Session) -> CoinPackage:
    row = CoinPackage(
        code="BASIC", name="Goi co ban", coins=120, bonus_coins=10, price_vnd=100_000
    )
    db.add(row)
    db.flush()
    return row


# --- Cộng và trừ xu ----------------------------------------------------------


def test_credit_increases_balance_and_writes_ledger(db: Session, user: User) -> None:
    entry = coins.credit(db, user.id, 100, kind="topup", description="Nap thu")
    assert user.coin_balance == 100
    assert entry.amount == 100
    assert entry.balance_after == 100


def test_debit_records_negative_amount(db: Session, user: User) -> None:
    """Sổ cái ghi số âm khi tiêu, để tổng sổ cái luôn bằng số dư."""
    coins.credit(db, user.id, 100, kind="topup", description="Nap")
    entry = coins.debit(db, user.id, 30, kind="purchase", description="Mua")
    assert user.coin_balance == 70
    assert entry.amount == -30
    assert entry.balance_after == 70


def test_ledger_sum_always_equals_balance(db: Session, user: User) -> None:
    coins.credit(db, user.id, 100, kind="topup", description="a")
    coins.debit(db, user.id, 25, kind="purchase", description="b")
    coins.credit(db, user.id, 50, kind="admin_grant", description="c")
    coins.debit(db, user.id, 10, kind="purchase", description="d")

    entries = db.query(CoinTransaction).filter(CoinTransaction.user_id == user.id).all()
    assert sum(e.amount for e in entries) == user.coin_balance == 115


def test_debit_beyond_balance_is_refused(db: Session, user: User) -> None:
    coins.credit(db, user.id, 10, kind="topup", description="Nap")
    with pytest.raises(coins.InsufficientCoinsError) as info:
        coins.debit(db, user.id, 11, kind="purchase", description="Mua")
    assert info.value.balance == 10
    assert info.value.required == 11
    assert user.coin_balance == 10, "số dư không được đổi khi giao dịch bị từ chối"


def test_debit_exactly_to_zero_is_allowed(db: Session, user: User) -> None:
    coins.credit(db, user.id, 10, kind="topup", description="Nap")
    coins.debit(db, user.id, 10, kind="purchase", description="Mua")
    assert user.coin_balance == 0


@pytest.mark.parametrize("amount", [0, -5])
def test_rejects_non_positive_amounts(db: Session, user: User, amount: int) -> None:
    with pytest.raises(coins.CoinError):
        coins.credit(db, user.id, amount, kind="topup", description="x")
    with pytest.raises(coins.CoinError):
        coins.debit(db, user.id, amount, kind="purchase", description="x")


# --- Mua quyền xem -----------------------------------------------------------


def make_borehole(db: Session, code: str) -> Borehole:
    now = dt.datetime.now(dt.timezone.utc)
    row = Borehole(
        code=code, name=code, lat=10.7, lng=106.7, location_kind="point",
        depth_m=30, created_at=now, updated_at=now,
    )
    db.add(row)
    db.flush()
    return row


def test_unlock_charges_once(db: Session, user: User) -> None:
    borehole = make_borehole(db, "HK-01")
    coins.credit(db, user.id, 100, kind="topup", description="Nap")

    unlock, charged = coins.unlock_borehole(db, user.id, borehole.id, borehole.code, 10)
    assert charged is True
    assert unlock.coins_spent == 10
    assert user.coin_balance == 90


def test_unlocking_again_is_free(db: Session, user: User) -> None:
    """Quyền xem là vĩnh viễn: mở lại hố đã mua không được tính tiền lần nữa."""
    borehole = make_borehole(db, "HK-01")
    coins.credit(db, user.id, 100, kind="topup", description="Nap")

    coins.unlock_borehole(db, user.id, borehole.id, borehole.code, 10)
    _, charged = coins.unlock_borehole(db, user.id, borehole.id, borehole.code, 10)

    assert charged is False
    assert user.coin_balance == 90, "lần mở thứ hai không được trừ thêm xu"


def test_unlock_without_enough_coins_leaves_no_trace(db: Session, user: User) -> None:
    borehole = make_borehole(db, "HK-01")
    coins.credit(db, user.id, 5, kind="topup", description="Nap")

    with pytest.raises(coins.InsufficientCoinsError):
        coins.unlock_borehole(db, user.id, borehole.id, borehole.code, 10)

    assert user.coin_balance == 5
    assert coins.get_unlock(db, user.id, borehole.id) is None


def test_free_unlock_creates_no_transaction(db: Session, user: User) -> None:
    """Giá 0 xu (manager, hoặc tắt tính phí) thì không sinh dòng sổ cái nào."""
    borehole = make_borehole(db, "HK-01")
    unlock, charged = coins.unlock_borehole(db, user.id, borehole.id, borehole.code, 0)

    assert charged is True
    assert unlock.coins_spent == 0
    assert db.query(CoinTransaction).count() == 0


# --- Đơn nạp xu --------------------------------------------------------------


def test_order_locks_in_price_and_bonus(db: Session, user: User, package: CoinPackage) -> None:
    order = coins.create_order(db, user, package, ttl_hours=48, provider="manual")
    assert order.coins == 130, "số xu phải gồm cả phần tặng thêm"
    assert order.amount_vnd == 100_000
    assert order.status == "pending"
    assert order.username_snapshot == "nguoimua"


def test_order_does_not_credit_until_confirmed(db: Session, user: User, package: CoinPackage) -> None:
    coins.create_order(db, user, package, ttl_hours=48, provider="manual")
    assert user.coin_balance == 0


def test_confirm_credits_exactly_once(db: Session, user: User, package: CoinPackage) -> None:
    order = coins.create_order(db, user, package, ttl_hours=48, provider="manual")
    coins.confirm_order(db, order.id, admin_id=None)
    assert user.coin_balance == 130
    assert order.status == "paid"

    with pytest.raises(coins.CoinError):
        coins.confirm_order(db, order.id, admin_id=None)
    assert user.coin_balance == 130, "xác nhận lần hai không được cộng xu thêm"


def test_cancelled_order_cannot_be_confirmed(db: Session, user: User, package: CoinPackage) -> None:
    order = coins.create_order(db, user, package, ttl_hours=48, provider="manual")
    coins.cancel_order(db, order.id, "Doi y")
    with pytest.raises(coins.CoinError):
        coins.confirm_order(db, order.id, admin_id=None)
    assert user.coin_balance == 0


def test_paid_order_cannot_be_cancelled(db: Session, user: User, package: CoinPackage) -> None:
    order = coins.create_order(db, user, package, ttl_hours=48, provider="manual")
    coins.confirm_order(db, order.id, admin_id=None)
    with pytest.raises(coins.CoinError):
        coins.cancel_order(db, order.id, "Muon huy")


def test_expire_only_touches_overdue_pending_orders(
    db: Session, user: User, package: CoinPackage
) -> None:
    fresh = coins.create_order(db, user, package, ttl_hours=48, provider="manual")
    stale = coins.create_order(db, user, package, ttl_hours=48, provider="manual")
    stale.expires_at = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=1)
    db.flush()

    assert coins.expire_stale_orders(db) == 1
    assert stale.status == "expired"
    assert fresh.status == "pending"


def test_confirm_and_cancel_lock_the_order_row(db: Session, user: User, package: CoinPackage) -> None:
    """Cả hai thao tác phải tự khoá dòng đơn, không nhận đối tượng đã đọc sẵn.

    Nhận id buộc hàm phải đọc lại trạng thái dưới khoá; nhận đối tượng thì trạng
    thái có thể đã cũ so với CSDL.
    """
    import inspect

    for func in (coins.confirm_order, coins.cancel_order):
        params = list(inspect.signature(func).parameters)
        assert params[1].endswith("order_id"), f"{func.__name__} phải nhận order_id"


def test_references_are_unique_and_readable(db: Session) -> None:
    """Mã tham chiếu phải chép tay được: không có ký tự dễ nhầm 0/O, 1/I."""
    codes = {coins.generate_reference(db) for _ in range(50)}
    assert len(codes) == 50
    for code in codes:
        assert code.startswith("GS")
        assert not set(code[2:]) & set("01OI")


def test_vnd_formatting_uses_vietnamese_separator() -> None:
    assert coins.format_vnd(100_000) == "100.000 ₫"
    assert coins.format_vnd(0) == "0 ₫"
