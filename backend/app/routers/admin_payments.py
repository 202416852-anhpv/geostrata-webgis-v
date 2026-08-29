"""Màn quản trị thanh toán: duyệt đơn nạp và thống kê doanh thu."""

from __future__ import annotations

import datetime as dt
import logging

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import coins
from app.auth import require_admin
from app.database import get_db
from app.models import Borehole, BoreholeUnlock, CoinTransaction, PaymentOrder, Project, User
from app.schemas import (
    CoinGrantIn,
    OrderStatusName,
    CoinTransactionOut,
    ErrorOut,
    PaymentOrderOut,
    PaymentStatsOut,
    PopularBoreholeOut,
    RevenuePointOut,
    TopSpenderOut,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin/payments", tags=["admin-payments"])


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


@router.get("/orders", response_model=list[PaymentOrderOut], summary="Danh sách đơn nạp xu")
def list_orders(
    status_filter: OrderStatusName | None = Query(
        None, alias="status", description="Bỏ trống để lấy tất cả trạng thái"
    ),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    _actor: User = Depends(require_admin),
) -> list[PaymentOrderOut]:
    coins.expire_stale_orders(db)
    db.commit()

    stmt = select(PaymentOrder).order_by(PaymentOrder.created_at.desc()).limit(limit)
    if status_filter:
        stmt = stmt.where(PaymentOrder.status == status_filter)
    return [_order_out(row) for row in db.execute(stmt).unique().scalars()]


@router.post(
    "/orders/{order_id}/confirm",
    response_model=PaymentOrderOut,
    responses={
        status.HTTP_404_NOT_FOUND: {"model": ErrorOut},
        status.HTTP_409_CONFLICT: {"model": ErrorOut},
    },
    summary="Xác nhận đã nhận tiền và cộng xu",
)
def confirm_order(
    order_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    actor: User = Depends(require_admin),
) -> PaymentOrderOut:
    """Chỉ đơn đang chờ mới xác nhận được, nên bấm hai lần không cộng xu hai lần."""
    try:
        order, _ = coins.confirm_order(db, order_id, actor.id)
        db.commit()
    except coins.OrderNotFoundError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except coins.CoinError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    logger.info(
        "%s xác nhận đơn %s: +%d xu cho %s",
        actor.username,
        order.reference,
        order.coins,
        order.username_snapshot,
    )
    return _order_out(order)


@router.post(
    "/orders/{order_id}/cancel",
    response_model=PaymentOrderOut,
    responses={status.HTTP_409_CONFLICT: {"model": ErrorOut}},
    summary="Từ chối đơn nạp xu",
)
def cancel_order(
    order_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    actor: User = Depends(require_admin),
) -> PaymentOrderOut:
    try:
        order = coins.cancel_order(db, order_id, f"Quản trị viên {actor.username} từ chối")
        db.commit()
    except coins.OrderNotFoundError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except coins.CoinError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return _order_out(order)


@router.post(
    "/grant",
    response_model=CoinTransactionOut,
    responses={status.HTTP_400_BAD_REQUEST: {"model": ErrorOut}},
    summary="Cộng hoặc trừ xu thủ công",
)
def grant_coins(
    payload: CoinGrantIn,
    db: Session = Depends(get_db),
    actor: User = Depends(require_admin),
) -> CoinTransactionOut:
    """Dùng khi cần bù xu do sự cố, hoặc thu hồi xu cấp nhầm.

    Mọi lần điều chỉnh đều để lại dấu vết trong sổ cái kèm lý do.
    """
    target = db.get(User, payload.user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Không tìm thấy tài khoản")
    if payload.amount == 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Số xu điều chỉnh phải khác 0")

    description = f"{payload.reason} (bởi {actor.username})"
    try:
        if payload.amount > 0:
            entry = coins.credit(
                db, target.id, payload.amount, kind="admin_grant", description=description
            )
        else:
            entry = coins.debit(
                db, target.id, -payload.amount, kind="admin_revoke", description=description
            )
        db.commit()
    except coins.InsufficientCoinsError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except coins.CoinError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    logger.info("%s điều chỉnh %+d xu cho %s: %s", actor.username, payload.amount, target.username, payload.reason)
    return CoinTransactionOut.model_validate(entry)


@router.get("/stats", response_model=PaymentStatsOut, summary="Thống kê thanh toán")
def payment_stats(
    days: int = Query(30, ge=1, le=365, description="Số ngày gần nhất đưa vào biểu đồ doanh thu"),
    db: Session = Depends(get_db),
    _actor: User = Depends(require_admin),
) -> PaymentStatsOut:
    coins.expire_stale_orders(db)
    db.commit()

    # --- Đếm đơn theo trạng thái --------------------------------------------
    by_status = dict(
        db.execute(
            select(PaymentOrder.status, func.count()).group_by(PaymentOrder.status)
        ).all()
    )
    paid = int(by_status.get("paid", 0))
    pending = int(by_status.get("pending", 0))
    cancelled = int(by_status.get("cancelled", 0))
    expired = int(by_status.get("expired", 0))
    total_orders = paid + pending + cancelled + expired
    decided_orders = paid + cancelled + expired

    revenue = int(
        db.execute(
            select(func.coalesce(func.sum(PaymentOrder.amount_vnd), 0)).where(
                PaymentOrder.status == "paid"
            )
        ).scalar_one()
    )

    # Số liệu trong kỳ đang xem. Trước đây thẻ số liệu là doanh thu toàn thời
    # gian trong khi biểu đồ bên dưới chỉ vẽ N ngày — hai con số cạnh nhau nhưng
    # không cùng phạm vi, rất dễ đọc nhầm.
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)
    period_revenue, period_paid = db.execute(
        select(
            func.coalesce(func.sum(PaymentOrder.amount_vnd), 0),
            func.count(),
        ).where(PaymentOrder.status == "paid", PaymentOrder.paid_at >= since)
    ).one()

    # --- Dòng xu ------------------------------------------------------------
    issued = int(
        db.execute(
            select(func.coalesce(func.sum(CoinTransaction.amount), 0)).where(
                CoinTransaction.amount > 0
            )
        ).scalar_one()
    )
    spent = abs(
        int(
            db.execute(
                select(func.coalesce(func.sum(CoinTransaction.amount), 0)).where(
                    CoinTransaction.amount < 0
                )
            ).scalar_one()
        )
    )

    paying_users = int(
        db.execute(
            select(func.count(func.distinct(PaymentOrder.user_id))).where(
                PaymentOrder.status == "paid"
            )
        ).scalar_one()
    )
    unlocks_total = int(db.execute(select(func.count()).select_from(BoreholeUnlock)).scalar_one())

    # --- Doanh thu theo ngày ------------------------------------------------
    day_column = func.date(PaymentOrder.paid_at).label("day")
    daily = db.execute(
        select(
            day_column,
            func.count().label("orders"),
            func.coalesce(func.sum(PaymentOrder.amount_vnd), 0).label("revenue"),
            func.coalesce(func.sum(PaymentOrder.coins), 0).label("coins"),
        )
        .where(PaymentOrder.status == "paid", PaymentOrder.paid_at >= since)
        .group_by(day_column)
        .order_by(day_column)
    ).all()

    # --- Người chi nhiều nhất ------------------------------------------------
    spenders = db.execute(
        select(
            PaymentOrder.user_id,
            PaymentOrder.username_snapshot,
            func.count().label("orders"),
            func.coalesce(func.sum(PaymentOrder.amount_vnd), 0).label("revenue"),
        )
        .where(PaymentOrder.status == "paid")
        .group_by(PaymentOrder.user_id, PaymentOrder.username_snapshot)
        .order_by(func.sum(PaymentOrder.amount_vnd).desc())
        .limit(10)
    ).all()

    # --- Hố khoan được mua nhiều nhất ---------------------------------------
    popular = db.execute(
        select(
            BoreholeUnlock.borehole_id,
            Borehole.code,
            Project.code.label("project_code"),
            func.count().label("unlocks"),
            func.coalesce(func.sum(BoreholeUnlock.coins_spent), 0).label("coins_earned"),
        )
        .join(Borehole, Borehole.id == BoreholeUnlock.borehole_id)
        .outerjoin(Project, Project.id == Borehole.project_id)
        .group_by(BoreholeUnlock.borehole_id, Borehole.code, Project.code)
        .order_by(func.count().desc())
        .limit(10)
    ).all()

    return PaymentStatsOut(
        period_days=days,
        period_revenue_vnd=int(period_revenue),
        period_paid_orders=int(period_paid),
        revenue_vnd=revenue,
        paid_orders=paid,
        pending_orders=pending,
        cancelled_orders=cancelled,
        expired_orders=expired,
        # Chỉ tính trên các đơn đã ngã ngũ. Đơn còn chờ thanh toán chưa phải là
        # thất bại, gộp vào mẫu số sẽ làm tỉ lệ thấp giả tạo mỗi khi có đơn mới.
        conversion_rate=round(paid / decided_orders, 4) if decided_orders else 0.0,
        coins_issued=issued,
        coins_spent=spent,
        coins_outstanding=issued - spent,
        paying_users=paying_users,
        unlocks_total=unlocks_total,
        average_order_vnd=round(revenue / paid) if paid else 0,
        revenue_by_day=[
            RevenuePointOut(day=row.day, orders=row.orders, revenue_vnd=int(row.revenue), coins=int(row.coins))
            for row in daily
        ],
        top_spenders=[
            TopSpenderOut(
                user_id=row.user_id,
                username=row.username_snapshot,
                orders=row.orders,
                revenue_vnd=int(row.revenue),
            )
            for row in spenders
        ],
        popular_boreholes=[
            PopularBoreholeOut(
                borehole_id=row.borehole_id,
                borehole_code=row.code,
                project_code=row.project_code,
                unlocks=row.unlocks,
                coins_earned=int(row.coins_earned),
            )
            for row in popular
        ],
    )
