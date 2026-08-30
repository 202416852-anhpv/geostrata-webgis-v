"""Ví xu của người dùng: xem số dư, nạp xu, mua quyền xem hố khoan."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app import coins, repository
from app.auth import get_current_user, require_user
from app.config import Settings, get_settings
from app.database import get_db
from app.models import (
    Borehole,
    BoreholeUnlock,
    CoinPackage,
    CoinTransaction,
    PaymentOrder,
    Role,
    User,
)
from app.schemas import (
    BankInfoOut,
    CoinPackageOut,
    CoinTransactionOut,
    ErrorOut,
    OrderCreateIn,
    OrderCreateOut,
    PaymentOrderOut,
    UnlockedBoreholeOut,
    UnlockOut,
    WalletOut,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/coins", tags=["coins"])


def unlock_cost_for(user: User, config: Settings) -> int:
    """Giá mở khoá áp cho một người dùng.

    Manager và admin là người của hệ thống, xem dữ liệu để làm việc nên không
    tính phí. Chỉ vai trò "user" mới phải trả xu.
    """
    if not config.coins_enabled:
        return 0
    if user.can_act_as(Role.MANAGER):
        return 0
    return config.borehole_unlock_cost


def _order_out(order: PaymentOrder) -> PaymentOrderOut:
    return PaymentOrderOut(
        id=order.id,
        reference=order.reference,
        username=order.username_snapshot,
        coins=order.coins,
        amount_vnd=order.amount_vnd,
        status=order.status,
        provider=order.provider,
        note=order.note,
        created_at=order.created_at,
        expires_at=order.expires_at,
        paid_at=order.paid_at,
    )


@router.get("/packages", response_model=list[CoinPackageOut], summary="Các gói xu đang bán")
def list_packages(
    db: Session = Depends(get_db),
    _actor: User = Depends(require_user),
) -> list[CoinPackageOut]:
    stmt = (
        select(CoinPackage)
        .where(CoinPackage.is_active.is_(True))
        .order_by(CoinPackage.sort_order, CoinPackage.price_vnd)
    )
    return [
        CoinPackageOut(
            id=row.id,
            code=row.code,
            name=row.name,
            coins=row.coins,
            bonus_coins=row.bonus_coins,
            total_coins=row.total_coins,
            price_vnd=row.price_vnd,
        )
        for row in db.execute(stmt).scalars()
    ]


@router.get("/wallet", response_model=WalletOut, summary="Số dư và thống kê ví")
def get_wallet(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    config: Settings = Depends(get_settings),
) -> WalletOut:
    topped_up = db.execute(
        select(func.coalesce(func.sum(CoinTransaction.amount), 0)).where(
            CoinTransaction.user_id == user.id, CoinTransaction.amount > 0
        )
    ).scalar_one()
    spent = db.execute(
        select(func.coalesce(func.sum(CoinTransaction.amount), 0)).where(
            CoinTransaction.user_id == user.id, CoinTransaction.amount < 0
        )
    ).scalar_one()
    unlocked = db.execute(
        select(func.count()).select_from(BoreholeUnlock).where(BoreholeUnlock.user_id == user.id)
    ).scalar_one()

    return WalletOut(
        balance=user.coin_balance,
        unlock_cost=unlock_cost_for(user, config),
        total_topped_up=int(topped_up),
        total_spent=abs(int(spent)),
        unlocked_count=int(unlocked),
    )


@router.get(
    "/transactions",
    response_model=list[CoinTransactionOut],
    summary="Lịch sử biến động xu",
)
def list_transactions(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[CoinTransactionOut]:
    stmt = (
        select(CoinTransaction)
        .where(CoinTransaction.user_id == user.id)
        .order_by(CoinTransaction.created_at.desc(), CoinTransaction.id.desc())
        .limit(100)
    )
    return [CoinTransactionOut.model_validate(row) for row in db.execute(stmt).scalars()]


@router.get("/unlocks", response_model=list[UnlockedBoreholeOut], summary="Hố khoan đã mua")
def list_unlocks(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[UnlockedBoreholeOut]:
    stmt = (
        select(BoreholeUnlock)
        # Nạp kèm công trình ngay trong một truy vấn, tránh mỗi hàng lại hỏi
        # CSDL thêm một lần khi đọc tên công trình.
        .options(joinedload(BoreholeUnlock.borehole).joinedload(Borehole.project))
        .where(BoreholeUnlock.user_id == user.id)
        .order_by(BoreholeUnlock.created_at.desc())
    )
    return [
        UnlockedBoreholeOut(
            borehole_id=row.borehole_id,
            borehole_code=row.borehole.code,
            project_code=row.borehole.project.code if row.borehole.project else None,
            project_name=row.borehole.project.name if row.borehole.project else None,
            lat=row.borehole.lat,
            lng=row.borehole.lng,
            location_kind=row.borehole.location_kind,
            depth_m=float(row.borehole.depth_m),
            drilling_company=row.borehole.drilling_company,
            drilled_on=row.borehole.drilled_on,
            coins_spent=row.coins_spent,
            created_at=row.created_at,
        )
        for row in db.execute(stmt).unique().scalars()
    ]


@router.get("/orders", response_model=list[PaymentOrderOut], summary="Đơn nạp xu của tôi")
def list_my_orders(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[PaymentOrderOut]:
    # Dọn các đơn quá hạn trước khi trả về, để trạng thái hiển thị luôn đúng.
    coins.expire_stale_orders(db)
    db.commit()

    stmt = (
        select(PaymentOrder)
        .where(PaymentOrder.user_id == user.id)
        .order_by(PaymentOrder.created_at.desc())
        .limit(50)
    )
    return [_order_out(row) for row in db.execute(stmt).unique().scalars()]


@router.post(
    "/orders",
    response_model=OrderCreateOut,
    status_code=status.HTTP_201_CREATED,
    responses={status.HTTP_400_BAD_REQUEST: {"model": ErrorOut}},
    summary="Tạo đơn nạp xu",
)
def create_order(
    payload: OrderCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    config: Settings = Depends(get_settings),
) -> OrderCreateOut:
    """Tạo đơn và trả về hướng dẫn chuyển khoản.

    Xu chỉ được cộng sau khi admin xác nhận đã nhận tiền — người dùng tự tạo đơn
    không làm thay đổi số dư.
    """
    if not config.coins_enabled:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Tính năng nạp xu đang tắt")

    package = db.execute(
        select(CoinPackage).where(
            CoinPackage.code == payload.package_code, CoinPackage.is_active.is_(True)
        )
    ).scalar_one_or_none()
    if package is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail=f"Không có gói xu mã {payload.package_code}"
        )

    order = coins.create_order(db, user, package, config.payment_order_ttl_hours, "manual")
    db.commit()

    logger.info(
        "%s tạo đơn nạp %s: %d xu / %d VND", user.username, order.reference, order.coins, order.amount_vnd
    )
    return OrderCreateOut(
        order=_order_out(order),
        bank=BankInfoOut(
            bank_name=config.bank_name,
            account_number=config.bank_account_number,
            account_name=config.bank_account_name,
            transfer_note=order.reference,
        ),
    )


@router.post(
    "/orders/{order_id}/cancel",
    response_model=PaymentOrderOut,
    responses={status.HTTP_404_NOT_FOUND: {"model": ErrorOut}},
    summary="Huỷ đơn nạp xu của mình",
)
def cancel_my_order(
    order_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PaymentOrderOut:
    # Khoá trước rồi mới kiểm tra chủ sở hữu. Đọc đơn ra ngoài khoá để kiểm tra
    # trước sẽ đưa bản cũ vào session và làm hỏng chính chốt trạng thái bên trong.
    try:
        order = coins.lock_order(db, order_id)
        if order is None or order.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Không tìm thấy đơn nạp xu")

        coins.cancel_order(db, order_id, "Người dùng tự huỷ")
        db.commit()
    except coins.CoinError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return _order_out(order)


@router.post(
    "/unlock/{borehole_id}",
    response_model=UnlockOut,
    responses={
        status.HTTP_402_PAYMENT_REQUIRED: {"model": ErrorOut},
        status.HTTP_404_NOT_FOUND: {"model": ErrorOut},
    },
    summary="Mua quyền xem một hố khoan",
)
def unlock_borehole(
    borehole_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    config: Settings = Depends(get_settings),
) -> UnlockOut:
    borehole = repository.get_borehole(db, borehole_id)
    if borehole is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Không tìm thấy hố khoan id={borehole_id}")

    cost = unlock_cost_for(user, config)
    try:
        unlock, charged = coins.unlock_borehole(db, user.id, borehole.id, borehole.code, cost)
        db.commit()
    except coins.InsufficientCoinsError as exc:
        db.rollback()
        # 402 Payment Required diễn tả đúng tình huống: yêu cầu hợp lệ nhưng
        # thiếu xu, nạp thêm rồi thử lại là được.
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            detail=f"Không đủ xu: cần {exc.required}, còn {exc.balance}. Hãy nạp thêm xu.",
        ) from exc
    except IntegrityError:
        # Hai yêu cầu song song cùng mua một hố: cái thứ hai đụng ràng buộc duy
        # nhất và quay lui, kể cả khoản trừ tiền. Trả về quyền đã có sẵn.
        db.rollback()
        existing = coins.get_unlock(db, user.id, borehole_id)
        if existing is None:
            raise
        unlock, charged = existing, False

    if charged:
        logger.info("%s mở khoá hố khoan %s với %d xu", user.username, borehole.code, cost)

    db.refresh(user)
    return UnlockOut(
        borehole_id=borehole.id,
        borehole_code=borehole.code,
        coins_spent=unlock.coins_spent,
        balance=user.coin_balance,
        newly_unlocked=charged,
    )
