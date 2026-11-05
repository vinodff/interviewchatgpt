import math
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import LiveSession, UsageBucket, UsageConnection, User


def month_key() -> str:
    return datetime.now(UTC).strftime("%Y-%m")


def base_allowance_minutes(plan: str) -> int:
    plan_extra = {
        "free": 0,
        "starter": settings.starter_minutes,
        "pro": settings.pro_minutes,
        "value": settings.value_minutes,
    }.get(plan, 0)
    return settings.free_minutes + plan_extra


def minute_limit(user: User) -> int | float | None:
    if settings.testing_user(user.id):
        return None
    base_mins = base_allowance_minutes(user.plan)
    credit_sec = getattr(user, "credit_seconds", 0) or 0
    if credit_sec <= 0:
        return base_mins
    total = base_mins + credit_sec / 60
    return int(total) if isinstance(total, float) and total.is_integer() else total


async def used_seconds(db: AsyncSession, user_id: str) -> int:
    value = await db.get(UsageBucket, (user_id, month_key()))
    return value.seconds if value else 0


async def user_dict(db: AsyncSession, user: User) -> dict:
    used = round((await used_seconds(db, user.id)) / 60, 2)
    limit = minute_limit(user)
    credit_sec = getattr(user, "credit_seconds", 0) or 0
    plan_base = base_allowance_minutes(user.plan)
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "plan": user.plan,
        "github_username": user.github_username,
        "profile": user.profile,
        "preferences": user.preferences,
        "phone": getattr(user, "phone", None),
        "github_verified": bool(user.github_verified_id),
        "github_verified_username": user.github_verified_username,
        "minutes_used": used,
        "minute_limit": limit,
        "monthly_minute_limit": plan_base,
        "credit_minutes_remaining": max(0, round(credit_sec / 60, 2)) if limit is not None else None,
        "testing_mode": settings.testing_user(user.id),
        "billing_account": bool(user.stripe_customer_id or user.cf_customer_id or credit_sec > 0),
    }


async def charge(db: AsyncSession, user_id: str, session_id: str, seconds: int) -> int:
    """Charge connected time atomically, first consuming monthly base plan, then purchased credits."""
    user = await db.scalar(select(User).where(User.id == user_id).with_for_update())
    if not user:
        return 0
    builder = pg_insert if db.bind.dialect.name == "postgresql" else sqlite_insert
    await db.execute(builder(UsageBucket).values(user_id=user_id, month=month_key(), seconds=0).on_conflict_do_nothing())
    bucket = await db.scalar(select(UsageBucket).where(UsageBucket.user_id == user_id, UsageBucket.month == month_key()).with_for_update())

    if settings.testing_user(user.id):
        accepted = max(0, seconds)
        bucket.seconds += accepted
        await db.execute(update(LiveSession).where(LiveSession.id == session_id, LiveSession.user_id == user_id).values(billed_seconds=LiveSession.billed_seconds + accepted))
        await db.commit()
        return accepted

    base_secs = base_allowance_minutes(user.plan) * 60
    remaining_base = max(0, base_secs - bucket.seconds)
    to_bucket = min(max(0, seconds), remaining_base)
    remaining_request = max(0, seconds) - to_bucket
    credit_secs = getattr(user, "credit_seconds", 0) or 0
    to_credits = min(remaining_request, max(0, credit_secs))
    accepted = to_bucket + to_credits

    bucket.seconds += to_bucket
    if to_credits > 0:
        user.credit_seconds = max(0, credit_secs - to_credits)
    await db.execute(update(LiveSession).where(LiveSession.id == session_id, LiveSession.user_id == user_id).values(billed_seconds=LiveSession.billed_seconds + accepted))
    await db.commit()
    return accepted


async def charge_connection(db: AsyncSession, user_id: str, session_id: str, connection_id: str, total_seconds: int) -> int:
    """Idempotent cumulative accounting survives cancellation immediately after commit."""
    user = await db.scalar(select(User).where(User.id == user_id).with_for_update())
    live = await db.scalar(select(LiveSession).where(LiveSession.id == session_id, LiveSession.user_id == user_id))
    if not user or not live:
        return 0
    builder = pg_insert if db.bind.dialect.name == "postgresql" else sqlite_insert
    await db.execute(builder(UsageConnection).values(id=connection_id, session_id=session_id, charged_seconds=0).on_conflict_do_nothing())
    connection = await db.get(UsageConnection, connection_id, with_for_update=True)
    if connection.session_id != session_id:
        raise ValueError("Usage connection does not belong to this session")
    target = max(connection.charged_seconds, total_seconds)
    delta = target - connection.charged_seconds

    await db.execute(builder(UsageBucket).values(user_id=user_id, month=month_key(), seconds=0).on_conflict_do_nothing())
    bucket = await db.get(UsageBucket, (user_id, month_key()), with_for_update=True)

    if settings.testing_user(user.id):
        accepted = delta
        connection.charged_seconds = target
        bucket.seconds += accepted
        live.billed_seconds += accepted
        await db.commit()
        return accepted

    base_secs = base_allowance_minutes(user.plan) * 60
    remaining_base = max(0, base_secs - bucket.seconds)
    to_bucket = min(delta, remaining_base)
    remaining_request = delta - to_bucket
    credit_secs = getattr(user, "credit_seconds", 0) or 0
    to_credits = min(remaining_request, max(0, credit_secs))
    accepted = to_bucket + to_credits

    connection.charged_seconds += accepted
    bucket.seconds += to_bucket
    if to_credits > 0:
        user.credit_seconds = max(0, credit_secs - to_credits)
    live.billed_seconds += accepted
    await db.commit()
    return accepted


def session_dict(item: LiveSession) -> dict:
    return {"id": item.id, "title": item.title, "status": item.status, "audio_mode": item.audio_mode,
            "retention": item.retention, "created_at": item.created_at.isoformat(),
            "ended_at": item.ended_at.isoformat() if item.ended_at else None, "summary": item.summary,
            "metrics": item.metrics, "billed_seconds": item.billed_seconds,
            "minutes": math.ceil(item.billed_seconds / 60)}
