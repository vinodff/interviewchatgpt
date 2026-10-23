import base64
import hashlib
import hmac
import logging
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


def is_configured() -> bool:
    return bool(settings.cashfree_app_id and settings.cashfree_secret.get_secret_value())


def get_base_url() -> str:
    env = (settings.cashfree_env or "").lower().strip()
    if env in {"prod", "production"}:
        return "https://api.cashfree.com/pg"
    return "https://sandbox.cashfree.com/pg"


def get_headers() -> dict[str, str]:
    return {
        "x-client-id": settings.cashfree_app_id,
        "x-client-secret": settings.cashfree_secret.get_secret_value(),
        "x-api-version": settings.cashfree_api_version,
        "Content-Type": "application/json",
    }


async def create_cashfree_order(
    order_id: str,
    amount: float,
    user_id: str,
    user_name: str,
    user_email: str,
    user_phone: str | None = None,
    return_url: str = "",
    plan_name: str = "",
) -> dict[str, Any]:
    if not is_configured():
        raise RuntimeError("Cashfree credentials are not configured")

    clean_cust_id = "cust_" + user_id.replace("-", "")[:24]
    payload = {
        "order_id": order_id,
        "order_amount": round(float(amount), 2),
        "order_currency": "INR",
        "customer_details": {
            "customer_id": clean_cust_id,
            "customer_name": (user_name or "InterviewWin User")[:50],
            "customer_email": user_email or "user@interviewpilot.live",
            "customer_phone": (user_phone or "9999999999").replace(" ", "").replace("-", "")[-10:],
        },
        "order_note": f"InterviewWin {plan_name or 'Subscription'} Plan",
    }

    order_meta: dict[str, Any] = {}
    target_return = return_url or f"{settings.public_url}/interview?view=billing&cf_order_id={{order_id}}"
    if target_return.startswith("https://"):
        order_meta["return_url"] = target_return
    notify_url = f"{settings.public_url}/api/billing/cashfree/webhook"
    if notify_url.startswith("https://"):
        order_meta["notify_url"] = notify_url
    if order_meta:
        payload["order_meta"] = order_meta

    url = f"{get_base_url()}/orders"
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(url, json=payload, headers=get_headers())
        if response.status_code not in (200, 201):
            logger.error("Cashfree order creation failed [%s]: %s", response.status_code, response.text)
            try:
                error_body = response.json()
                msg = error_body.get("message") or "Failed to initiate payment with Cashfree"
            except Exception:
                msg = f"Cashfree returned error HTTP {response.status_code}"
            raise ValueError(msg)
        return response.json()


async def fetch_cashfree_order(order_id: str) -> dict[str, Any]:
    if not is_configured():
        raise RuntimeError("Cashfree credentials are not configured")

    url = f"{get_base_url()}/orders/{order_id}"
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(url, headers=get_headers())
        if response.status_code != 200:
            logger.error("Cashfree fetch order failed [%s]: %s", response.status_code, response.text)
            raise ValueError(f"Order {order_id} could not be retrieved from Cashfree")
        return response.json()


async def fetch_cashfree_payments(order_id: str) -> list[dict[str, Any]]:
    if not is_configured():
        return []

    url = f"{get_base_url()}/orders/{order_id}/payments"
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(url, headers=get_headers())
        if response.status_code != 200:
            return []
        data = response.json()
        return data if isinstance(data, list) else []


def verify_webhook_signature(raw_body: bytes, timestamp: str, signature: str) -> bool:
    secret = settings.cashfree_secret.get_secret_value()
    if not secret or not timestamp or not signature:
        return False
    try:
        data = timestamp.encode("utf-8") + raw_body
        computed = base64.b64encode(hmac.new(secret.encode("utf-8"), data, hashlib.sha256).digest()).decode("utf-8")
        return hmac.compare_digest(computed, signature)
    except Exception as e:
        logger.warning("Error verifying Cashfree webhook signature: %s", e)
        return False
