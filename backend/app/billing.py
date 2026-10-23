import asyncio
import json
import logging
import secrets
import time
from datetime import UTC, datetime
from typing import Literal

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache import coordination
from app.config import settings
from app.models import BillingEvent, PaymentOrder, User
from app.security import current_user, database, rate_limit
from app.services import cashfree

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


def subscription_plan(subscription) -> str | None:
    prices = {item.price.id for item in subscription["items"].data}
    if settings.stripe_price_id and settings.stripe_price_id in prices:
        return "pro"
    if settings.stripe_starter_price_id and settings.stripe_starter_price_id in prices:
        return "starter"
    return None


def price_id_for(plan: str) -> str:
    return settings.stripe_starter_price_id if plan == "starter" else settings.stripe_price_id


def configured(plan: str | None = None):
    price_available = price_id_for(plan) if plan else settings.stripe_price_id or settings.stripe_starter_price_id
    if not settings.stripe_secret_key.get_secret_value() or not price_available:
        raise HTTPException(503, "Paid plans are not available yet. Please contact support")


@router.get("/plans")
async def plans():
    cashfree_ready = cashfree.is_configured()
    stripe_ready = bool(settings.stripe_secret_key.get_secret_value() and settings.stripe_webhook_secret.get_secret_value())
    ready = (cashfree_ready or stripe_ready) and not settings.local_test_mode
    is_preview = False if cashfree_ready else settings.local_test_mode
    checkout_ok = ready or cashfree_ready
    return {"preview": is_preview, "gateway": "cashfree" if cashfree_ready else "stripe", "plans": [
        {"id": "free", "name": "Free", "minutes": settings.free_minutes, "amount": 0, "currency": "inr", "checkout_available": False},
        {"id": "starter", "name": "Starter", "minutes": settings.starter_minutes, "amount": settings.starter_price_minor, "currency": "inr", "checkout_available": checkout_ok},
        {"id": "pro", "name": "Popular", "minutes": settings.pro_minutes, "amount": settings.pro_price_minor, "currency": "inr", "checkout_available": checkout_ok},
        {"id": "value", "name": "Value", "minutes": settings.value_minutes, "amount": settings.value_price_minor, "currency": "inr", "checkout_available": checkout_ok},
    ]}


class CashfreeOrderRequest(BaseModel):
    plan: Literal["starter", "pro", "value"] = "starter"
    return_url: str | None = None
    phone: str | None = None


@router.post("/cashfree/create-order")
async def create_cashfree_order_endpoint(
    payload: CashfreeOrderRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(database),
):
    if not cashfree.is_configured():
        raise HTTPException(503, "Cashfree payments are not configured. Please set CASHFREE_APP_ID and CASHFREE_SECRET")

    await rate_limit("cf-order:" + user.id, 10, 60)

    plans_info = {
        "starter": {"amount": settings.starter_price_minor / 100, "name": "Starter"},
        "pro": {"amount": settings.pro_price_minor / 100, "name": "Popular"},
        "value": {"amount": settings.value_price_minor / 100, "name": "Value"},
    }
    plan_meta = plans_info.get(payload.plan)
    if not plan_meta:
        raise HTTPException(400, "Invalid plan selected")

    order_id = f"ipo_{int(time.time())}_{secrets.token_hex(4)}"
    try:
        cf_order = await cashfree.create_cashfree_order(
            order_id=order_id,
            amount=plan_meta["amount"],
            user_id=user.id,
            user_name=user.name,
            user_email=user.email,
            user_phone=payload.phone,
            return_url=payload.return_url or "",
            plan_name=plan_meta["name"],
        )
    except ValueError as err:
        raise HTTPException(502, str(err)) from None
    except Exception as err:
        logger.exception("Cashfree creation failed: %s", err)
        raise HTTPException(502, "Failed to connect to Cashfree payment gateway") from None

    order = PaymentOrder(
        order_id=order_id,
        user_id=user.id,
        plan_id=payload.plan,
        amount=plan_meta["amount"],
        currency="INR",
        status="ACTIVE",
        payment_session_id=cf_order.get("payment_session_id", ""),
        minutes_granted=0,
    )
    db.add(order)
    await db.commit()

    return {
        "order_id": order_id,
        "payment_session_id": cf_order.get("payment_session_id"),
        "cf_order_id": cf_order.get("cf_order_id"),
        "amount": plan_meta["amount"],
        "plan": payload.plan,
        "environment": (settings.cashfree_env or "production").lower(),
    }


@router.get("/cashfree/verify/{order_id}")
async def verify_cashfree_order_endpoint(
    order_id: str,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(database),
):
    order = await db.scalar(
        select(PaymentOrder).where(PaymentOrder.order_id == order_id, PaymentOrder.user_id == user.id)
    )
    if not order:
        raise HTTPException(404, "Order not found")

    if order.status == "PAID":
        return {
            "status": "PAID",
            "order_id": order.order_id,
            "plan": order.plan_id,
            "minutes_granted": order.minutes_granted,
        }

    try:
        cf_data = await cashfree.fetch_cashfree_order(order_id)
    except Exception as err:
        logger.warning("Could not fetch order %s from Cashfree: %s", order_id, err)
        return {
            "status": order.status,
            "order_id": order.order_id,
            "plan": order.plan_id,
            "minutes_granted": order.minutes_granted,
        }

    cf_status = cf_data.get("order_status", "").upper()
    if cf_status == "PAID":
        minutes_map = {
            "starter": settings.starter_minutes,
            "pro": settings.pro_minutes,
            "value": settings.value_minutes,
        }
        granted = minutes_map.get(order.plan_id, settings.starter_minutes)
        order.status = "PAID"
        order.paid_at = datetime.now(UTC)
        order.minutes_granted = granted
        order.cf_payment_id = str(cf_data.get("cf_order_id", ""))

        db_user = await db.get(User, user.id)
        if db_user:
            db_user.plan = order.plan_id

        await db.commit()
    elif cf_status in {"EXPIRED", "FAILED"}:
        order.status = cf_status
        await db.commit()

    return {
        "status": order.status,
        "order_id": order.order_id,
        "plan": order.plan_id,
        "minutes_granted": order.minutes_granted,
    }


@router.post("/cashfree/webhook")
async def cashfree_webhook(request: Request, db: AsyncSession = Depends(database)):
    timestamp = request.headers.get("x-webhook-timestamp", "")
    signature = request.headers.get("x-webhook-signature", "")
    body = await request.body()

    if not cashfree.verify_webhook_signature(body, timestamp, signature):
        raise HTTPException(400, "Invalid webhook signature")

    try:
        payload = json.loads(body.decode("utf-8"))
    except Exception:
        raise HTTPException(400, "Invalid JSON payload")

    data = payload.get("data", {})
    order_data = data.get("order", {})
    order_id = order_data.get("order_id")
    payment_data = data.get("payment", {})
    payment_status = payment_data.get("payment_status", "")

    if not order_id:
        return {"ok": True}

    if payment_status == "SUCCESS":
        order = await db.scalar(select(PaymentOrder).where(PaymentOrder.order_id == order_id).with_for_update())
        if order and order.status != "PAID":
            minutes_map = {
                "starter": settings.starter_minutes,
                "pro": settings.pro_minutes,
                "value": settings.value_minutes,
            }
            order.status = "PAID"
            order.paid_at = datetime.now(UTC)
            order.minutes_granted = minutes_map.get(order.plan_id, settings.starter_minutes)
            order.cf_payment_id = str(payment_data.get("cf_payment_id", ""))
            order.payment_method = str(payment_data.get("payment_group", ""))

            user = await db.get(User, order.user_id)
            if user:
                user.plan = order.plan_id

            await db.commit()

    return {"ok": True}


async def verified_price(plan: str) -> str:
    """Never send a customer to a price or billing interval different from the advertised plan."""
    configured(plan)
    if not settings.stripe_webhook_secret.get_secret_value():
        raise HTTPException(503, "Paid plans are not available yet. Please contact support")
    price_id = price_id_for(plan)
    price = await asyncio.to_thread(stripe.Price.retrieve, price_id, api_key=settings.stripe_secret_key.get_secret_value())
    recurring = price.get("recurring") or {}
    amount = settings.starter_price_minor if plan == "starter" else settings.pro_price_minor
    if not (price.get("active") and price.get("type") == "recurring" and price.get("currency") == "inr"
            and price.get("unit_amount") == amount and price.get("billing_scheme") == "per_unit"
            and not price.get("transform_quantity") and recurring.get("interval") == "month"
            and recurring.get("interval_count") == 1 and recurring.get("usage_type") == "licensed"):
        raise HTTPException(503, "The selected price is temporarily unavailable. Please contact support")
    return price_id


class CheckoutPlan(BaseModel):
    plan: Literal["starter", "pro"] = "pro"


@router.post("/checkout")
async def checkout(payload: CheckoutPlan | None = None, user: User = Depends(current_user), db: AsyncSession = Depends(database)):
    if settings.local_test_mode:
        raise HTTPException(403, "Payments are not available in preview access")
    selected = payload.plan if payload else "pro"
    configured(selected)
    await rate_limit("checkout:" + user.id, 5, 60)
    lease = "billing:" + user.id
    lease_value = secrets.token_urlsafe(16)
    if not await coordination.set(lease, lease_value, 120, nx=True):
        raise HTTPException(409, "Billing is already being updated")
    try:
        user = await db.scalar(select(User).where(User.id == user.id).with_for_update())
        if not user:
            raise HTTPException(401, "This account is no longer available")
        if user.plan != "free":
            raise HTTPException(409, "You already have a paid plan. Use Manage subscription")
        price_id = await verified_price(selected)
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
        pending = [item for item in open_sessions.data if item.mode == "subscription"]
        if len(pending) > 5:
            raise HTTPException(503, "Please contact support to review your pending payments")
        reusable = None
        for old_checkout in pending:
            if old_checkout.mode == "subscription":
                metadata = getattr(old_checkout, "metadata", None) or {}
                if reusable is None and metadata.get("plan") == selected and metadata.get("price_id") == price_id:
                    reusable = old_checkout
                    continue
                # A previous choice must not remain payable after the customer changes plans.
                old_plan, old_price = metadata.get("plan"), metadata.get("price_id")
                if old_plan in {"starter", "pro"} and old_price:
                    await coordination.delete(f"checkout-attempt:{user.id}:{old_plan}:{old_price}")
                await asyncio.to_thread(stripe.checkout.Session.expire, old_checkout.id, api_key=key)
        if reusable is not None:
            return {"url": reusable.url}
        # Retry the same provider operation after a timeout, but never revive an expired
        # checkout when a customer changes plans and then changes back.
        attempt_key = f"checkout-attempt:{user.id}:{selected}:{price_id}"
        attempt = await coordination.get(attempt_key)
        if not attempt:
            attempt = secrets.token_urlsafe(18)
            await coordination.set(attempt_key, attempt, 86400)
        session = await asyncio.to_thread(stripe.checkout.Session.create,
            api_key=key, mode="subscription", customer=user.stripe_customer_id,
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=settings.public_url + "/interview?view=billing&billing=success", cancel_url=settings.public_url + "/interview?view=billing&billing=cancelled",
            metadata={"plan": selected, "price_id": price_id},
            client_reference_id=user.id, subscription_data={"metadata": {"user_id": user.id}},
            idempotency_key=f"checkout:{user.id}:{selected}:{attempt}")
        return {"url": session.url}
    except stripe.StripeError:
        logger.warning("Stripe checkout failed")
        raise HTTPException(502, "The payment provider is unavailable. Please try again") from None
    finally:
        await coordination.release(lease, lease_value)


@router.post("/portal")
async def portal(user: User = Depends(current_user)):
    if settings.local_test_mode:
        raise HTTPException(403, "Payments are not available in preview access")
    if not settings.stripe_secret_key.get_secret_value():
        raise HTTPException(503, "Subscription management is temporarily unavailable. Please contact support")
    if not user.stripe_customer_id:
        raise HTTPException(409, "No billing account exists yet")
    try:
        session = await asyncio.to_thread(stripe.billing_portal.Session.create, customer=user.stripe_customer_id, return_url=settings.public_url + "/interview?view=billing", api_key=settings.stripe_secret_key.get_secret_value())
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
            active = [item for item in subscriptions if item.status in {"active", "trialing"} and subscription_plan(item)]
            active.sort(key=lambda item: subscription_plan(item) == "pro", reverse=True)
            user.plan = subscription_plan(active[0]) if active else "free"
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
