import asyncio
import logging
import secrets

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache import coordination
from app.config import settings
from app.models import BillingEvent, User
from app.security import current_user, database, rate_limit

router = APIRouter(prefix="/billing", tags=["billing"])
logger = logging.getLogger(__name__)
# Bound each provider operation below coordination lease durations; SDK's 80s default is too long.
stripe.default_http_client = stripe.RequestsClient(timeout=10)
stripe.max_network_retries = 0


async def customer_subscriptions(customer_id: str):
    result = await asyncio.to_thread(stripe.Subscription.list, customer=customer_id, status="all", limit=100,
                                    api_key=settings.stripe_secret_key.get_secret_value())
    if result.has_more:
        raise HTTPException(503, "Billing history requires operator review before this action")
    return result.data


def matches_plan(subscription) -> bool:
    return any(item.price.id == settings.stripe_price_id for item in subscription["items"].data)


def configured():
    if not settings.stripe_secret_key.get_secret_value() or not settings.stripe_price_id:
        raise HTTPException(503, "Billing is not configured by the application operator yet")


@router.post("/checkout")
async def checkout(user: User = Depends(current_user), db: AsyncSession = Depends(database)):
    configured()
    await rate_limit("checkout:" + user.id, 5, 60)
    lease = "billing:" + user.id
    lease_value = secrets.token_urlsafe(16)
    if not await coordination.set(lease, lease_value, 60, nx=True):
        raise HTTPException(409, "Billing is already being updated")
    try:
        user = await db.scalar(select(User).where(User.id == user.id).with_for_update())
        if not user:
            raise HTTPException(401, "This account is no longer available")
        if user.plan == "pro":
            raise HTTPException(409, "You already have Pro. Use Manage subscription")
        key = settings.stripe_secret_key.get_secret_value()
        if user.stripe_customer_id:
            subscriptions = await customer_subscriptions(user.stripe_customer_id)
            if any(item.status not in {"canceled", "incomplete_expired"} for item in subscriptions):
                raise HTTPException(409, "A subscription already exists. Use Manage subscription to update it")
        if not user.stripe_customer_id:
            customer = await asyncio.to_thread(stripe.Customer.create, email=user.email, metadata={"user_id": user.id}, api_key=key, idempotency_key="customer:" + user.id)
            user.stripe_customer_id = customer.id
            await db.commit()
        open_sessions = await asyncio.to_thread(stripe.checkout.Session.list, customer=user.stripe_customer_id, status="open", limit=100, api_key=key)
        if open_sessions.has_more:
            raise HTTPException(503, "Open checkout history requires operator review")
        for old_checkout in open_sessions.data:
            if old_checkout.mode == "subscription":
                return {"url": old_checkout.url}
        # A stable short-lived idempotency key avoids double subscriptions from repeated clicks.
        from datetime import UTC, datetime
        attempt = int(datetime.now(UTC).timestamp()) // 600
        session = await asyncio.to_thread(stripe.checkout.Session.create,
            api_key=key, mode="subscription", customer=user.stripe_customer_id,
            line_items=[{"price": settings.stripe_price_id, "quantity": 1}],
            success_url=settings.public_url + "/?billing=success", cancel_url=settings.public_url + "/?billing=cancelled",
            client_reference_id=user.id, subscription_data={"metadata": {"user_id": user.id}},
            idempotency_key=f"checkout:{user.id}:{attempt}")
        return {"url": session.url}
    except stripe.StripeError:
        logger.warning("Stripe checkout failed")
        raise HTTPException(502, "The payment provider is unavailable. Please try again") from None
    finally:
        await coordination.release(lease, lease_value)


@router.post("/portal")
async def portal(user: User = Depends(current_user)):
    configured()
    if not user.stripe_customer_id:
        raise HTTPException(409, "No billing account exists yet")
    try:
        session = await asyncio.to_thread(stripe.billing_portal.Session.create, customer=user.stripe_customer_id, return_url=settings.public_url + "/", api_key=settings.stripe_secret_key.get_secret_value())
        return {"url": session.url}
    except stripe.StripeError:
        raise HTTPException(502, "The billing portal is temporarily unavailable") from None


@router.post("/webhook")
async def webhook(request: Request, db: AsyncSession = Depends(database)):
    secret = settings.stripe_webhook_secret.get_secret_value()
    if not secret:
        raise HTTPException(503, "Billing webhook is not configured")
    payload = await request.body()
    try:
        event = stripe.Webhook.construct_event(payload, request.headers.get("stripe-signature", ""), secret)
    except (ValueError, stripe.SignatureVerificationError):
        raise HTTPException(400, "Invalid webhook signature") from None
    if await db.get(BillingEvent, event.id):
        return {"ok": True}
    obj = event.data.object
    if event.type.startswith("customer.subscription."):
        customer_id = obj.customer
    elif event.type == "checkout.session.completed" and obj.get("subscription"):
        customer_id = obj.customer
    else:
        return {"ok": True}
    # Fetch authoritative state; old, out-of-order events cannot restore expired access.
    lock_key = "billing-sync:" + str(customer_id)
    if not await coordination.set(lock_key, event.id, 30, nx=True):
        raise HTTPException(503, "Subscription update in progress; retry webhook")
    try:
        user = await db.scalar(select(User).where(User.stripe_customer_id == customer_id).with_for_update())
        if user:
            # Serialize before fetching provider state, so a delayed old event cannot commit after a newer one.
            subscriptions = await customer_subscriptions(customer_id)
            active = [item for item in subscriptions if item.status in {"active", "trialing"} and matches_plan(item)]
            user.plan = "pro" if active else "free"
            user.stripe_subscription_id = active[0].id if active else None
        db.add(BillingEvent(id=event.id))
        await db.commit()
    except IntegrityError:
        await db.rollback()
    except stripe.StripeError:
        raise HTTPException(502, "Subscription verification failed; retry webhook") from None
    finally:
        await coordination.release(lock_key, event.id)
    return {"ok": True}
