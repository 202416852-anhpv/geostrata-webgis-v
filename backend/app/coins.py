"""Nghiệp vụ ví xu: nạp, tiêu và mua quyền xem hố khoan.

Đây là phần liên quan tới tiền nên mọi thao tác đều tuân thủ ba quy tắc:

1. **Khoá dòng người dùng trước khi động vào số dư.** ``SELECT ... FOR UPDATE``
   khiến hai yêu cầu song song của cùng một tài khoản phải xếp hàng; không có
   nó thì cả hai cùng đọc số dư cũ và cùng trừ, gây tiêu lố.
2. **Ghi sổ cái cùng lúc với cập nhật số dư**, trong cùng một giao dịch. Không
   bao giờ có chuyện số dư đổi mà không có dòng giải thích.
3. **Không tự ý commit.** Router quyết định thời điểm commit, nhờ vậy một chuỗi
   thao tác hoặc thành công trọn vẹn hoặc quay lui trọn vẹn.
"""

from __future__ import annotations

import datetime as dt
import secrets

from sqlalchemy import select, update
from sqlalchemy.orm import Session, lazyload

from app.models import BoreholeUnlock, CoinPackage, CoinTransaction, PaymentOrder, User

# Bỏ các ký tự dễ đọc nhầm khi chép tay vào nội dung chuyển khoản (0/O, 1/I).
_REFERENCE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"


class CoinError(RuntimeError):
    """Lỗi nghiệp vụ ví xu — router chuyển thành mã HTTP phù hợp."""


class OrderNotFoundError(CoinError):
    """Không có đơn với id đó — router chuyển thành 404."""


class InsufficientCoinsError(CoinError):
    def __init__(self, balance: int, required: int) -> None:
        self.balance = balance
        self.required = required
        super().__init__(f"Số dư {balance} xu, cần {required} xu")


def lock_user(db: Session, user_id: int) -> User:
    """Khoá dòng người dùng tới hết giao dịch hiện tại."""
    return db.execute(select(User).where(User.id == user_id).with_for_update()).scalar_one()


def credit(
    db: Session,
    user_id: int,
    amount: int,
    *,
    kind: str,
    description: str,
    order_id: int | None = None,
) -> CoinTransaction:
    """Cộng xu vào ví và ghi một dòng sổ cái."""
    if amount <= 0:
        raise CoinError("Số xu cộng vào phải lớn hơn 0")

    user = lock_user(db, user_id)
    user.coin_balance += amount
    entry = CoinTransaction(
        user_id=user_id,
        amount=amount,
        balance_after=user.coin_balance,
        kind=kind,
        order_id=order_id,
        description=description,
    )
    db.add(entry)
    db.flush()
    return entry


def debit(
    db: Session,
    user_id: int,
    amount: int,
    *,
    kind: str,
    description: str,
    borehole_id: int | None = None,
) -> CoinTransaction:
    """Trừ xu khỏi ví. Ném lỗi nếu không đủ, KHÔNG bao giờ để số dư âm."""
    if amount <= 0:
        raise CoinError("Số xu trừ đi phải lớn hơn 0")

    user = lock_user(db, user_id)
    if user.coin_balance < amount:
        raise InsufficientCoinsError(balance=user.coin_balance, required=amount)

    user.coin_balance -= amount
    entry = CoinTransaction(
        user_id=user_id,
        # Ghi số âm để tổng sổ cái luôn bằng số dư hiện tại.
        amount=-amount,
        balance_after=user.coin_balance,
        kind=kind,
        borehole_id=borehole_id,
        description=description,
    )
    db.add(entry)
    db.flush()
    return entry


def get_unlock(db: Session, user_id: int, borehole_id: int) -> BoreholeUnlock | None:
    stmt = select(BoreholeUnlock).where(
        BoreholeUnlock.user_id == user_id, BoreholeUnlock.borehole_id == borehole_id
    )
    return db.execute(stmt).scalar_one_or_none()


def unlock_borehole(
    db: Session, user_id: int, borehole_id: int, borehole_code: str, cost: int
) -> tuple[BoreholeUnlock, bool]:
    """Mua quyền xem một hố khoan.

    Trả về (quyền xem, có vừa trừ tiền hay không). Mua lại hố đã mở thì không
    tính tiền lần nữa — quyền xem là vĩnh viễn.

    Nếu hai yêu cầu chạy song song cùng lọt qua bước kiểm tra ở đây, ràng buộc
    UNIQUE(user_id, borehole_id) sẽ chặn cái thứ hai và cả giao dịch của nó quay
    lui, nên khoản trừ tiền cũng bị huỷ theo.
    """
    existing = get_unlock(db, user_id, borehole_id)
    if existing is not None:
        return existing, False

    if cost == 0:
        unlock = BoreholeUnlock(user_id=user_id, borehole_id=borehole_id, coins_spent=0)
        db.add(unlock)
        db.flush()
        return unlock, True

    entry = debit(
        db,
        user_id,
        cost,
        kind="purchase",
        description=f"Mở khoá hố khoan {borehole_code}",
        borehole_id=borehole_id,
    )
    unlock = BoreholeUnlock(
        user_id=user_id,
        borehole_id=borehole_id,
        coins_spent=cost,
        transaction_id=entry.id,
    )
    db.add(unlock)
    db.flush()
    return unlock, True


# =============================================================================
# Đơn nạp xu
# =============================================================================


def generate_reference(db: Session) -> str:
    """Mã tham chiếu ngắn để chép vào nội dung chuyển khoản."""
    for _ in range(20):
        code = "GS" + "".join(secrets.choice(_REFERENCE_ALPHABET) for _ in range(6))
        exists = db.execute(
            select(PaymentOrder.id).where(PaymentOrder.reference == code)
        ).scalar_one_or_none()
        if exists is None:
            return code
    raise CoinError("Không sinh được mã tham chiếu, thử lại sau")


def lock_order(db: Session, order_id: int) -> PaymentOrder | None:
    """Khoá dòng đơn hàng tới hết giao dịch hiện tại.

    Bắt buộc phải khoá TRƯỚC khi đọc trạng thái để quyết định. Không khoá thì
    hai yêu cầu trái ngược nhau (admin xác nhận và người dùng huỷ) cùng đọc được
    "pending", cùng đi qua chốt kiểm tra, và kẻ ghi sau đè lên kẻ ghi trước —
    đơn có thể mang trạng thái "đã huỷ" trong khi xu đã cộng vào ví.
    """
    return db.execute(
        select(PaymentOrder)
        .where(PaymentOrder.id == order_id)
        # PaymentOrder.package khai lazy="joined" nên truy vấn mặc định sinh ra
        # LEFT OUTER JOIN, mà PostgreSQL từ chối FOR UPDATE trên nhánh có thể
        # NULL của outer join. Tắt nạp kèm cho riêng câu khoá này.
        .options(lazyload(PaymentOrder.package))
        .with_for_update()
        # populate_existing: nếu đối tượng đã nằm sẵn trong session (do một lần
        # đọc trước đó, chẳng hạn để kiểm tra chủ sở hữu), SQLAlchemy mặc định
        # trả lại bản cũ trong bộ nhớ và KHÔNG đọc lại giá trị vừa khoá. Khi đó
        # khoá có mà trạng thái vẫn cũ, chốt kiểm tra thành vô dụng.
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()


def create_order(
    db: Session, user: User, package: CoinPackage, ttl_hours: int, provider: str
) -> PaymentOrder:
    now = dt.datetime.now(dt.timezone.utc)
    order = PaymentOrder(
        reference=generate_reference(db),
        user_id=user.id,
        username_snapshot=user.username,
        package_id=package.id,
        # Chốt số xu và số tiền tại thời điểm đặt: gói có đổi giá sau này thì
        # đơn cũ vẫn giữ nguyên điều kiện đã cam kết.
        coins=package.coins + package.bonus_coins,
        amount_vnd=package.price_vnd,
        status="pending",
        provider=provider,
        created_at=now,
        updated_at=now,
        expires_at=now + dt.timedelta(hours=ttl_hours),
    )
    db.add(order)
    db.flush()
    return order


def confirm_order(
    db: Session, order_id: int, admin_id: int | None
) -> tuple[PaymentOrder, CoinTransaction]:
    """Xác nhận đã nhận tiền và cộng xu.

    Nhận id chứ không nhận đối tượng, vì phải tự khoá dòng rồi mới đọc trạng
    thái — có vậy hai lần bấm liên tiếp, hay một lần bấm trùng với thao tác huỷ
    của người dùng, mới không cộng xu sai.
    """
    order = lock_order(db, order_id)
    if order is None:
        raise OrderNotFoundError(f"Không tìm thấy đơn id={order_id}")
    if order.status != "pending":
        raise CoinError(f"Đơn {order.reference} đang ở trạng thái {order.status}, không xác nhận được")
    if order.user_id is None:
        raise CoinError(f"Đơn {order.reference} không còn gắn với tài khoản nào")

    now = dt.datetime.now(dt.timezone.utc)
    order.status = "paid"
    order.paid_at = now
    order.updated_at = now
    order.confirmed_by = admin_id

    entry = credit(
        db,
        order.user_id,
        order.coins,
        kind="topup",
        description=f"Nạp xu theo đơn {order.reference}",
        order_id=order.id,
    )
    return order, entry


def cancel_order(db: Session, order_id: int, reason: str) -> PaymentOrder:
    """Huỷ đơn. Khoá dòng trước khi đọc trạng thái, cùng lý do như confirm_order."""
    order = lock_order(db, order_id)
    if order is None:
        raise OrderNotFoundError(f"Không tìm thấy đơn id={order_id}")
    if order.status != "pending":
        raise CoinError(f"Đơn {order.reference} đang ở trạng thái {order.status}, không huỷ được")

    order.status = "cancelled"
    order.note = reason
    order.updated_at = dt.datetime.now(dt.timezone.utc)
    db.flush()
    return order


def expire_stale_orders(db: Session) -> int:
    """Đánh dấu hết hạn các đơn quá thời gian mà chưa thấy tiền về.

    Dùng MỘT câu UPDATE có điều kiện thay vì đọc rồi ghi: PostgreSQL tự khoá
    từng dòng khi ghi, nên đơn đang được admin xác nhận sẽ không bị hô biến
    thành hết hạn giữa chừng.
    """
    now = dt.datetime.now(dt.timezone.utc)
    result = db.execute(
        update(PaymentOrder)
        .where(PaymentOrder.status == "pending", PaymentOrder.expires_at < now)
        .values(status="expired", updated_at=now)
        # "fetch" để các đối tượng đang nằm trong session cũng được cập nhật.
        # Với False thì rowcount đúng nhưng đối tượng đã nạp vẫn giữ trạng thái
        # cũ — một cái bẫy chờ sẵn cho người sửa code sau này.
        .execution_options(synchronize_session="fetch")
    )
    return result.rowcount


def format_vnd(amount: int) -> str:
    return f"{amount:,}".replace(",", ".") + " ₫"


__all__ = [
    "CoinError",
    "InsufficientCoinsError",
    "OrderNotFoundError",
    "cancel_order",
    "confirm_order",
    "create_order",
    "credit",
    "debit",
    "expire_stale_orders",
    "format_vnd",
    "generate_reference",
    "get_unlock",
    "lock_order",
    "lock_user",
    "unlock_borehole",
]
