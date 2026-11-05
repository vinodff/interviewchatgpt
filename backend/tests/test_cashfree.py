import base64
import hashlib
import hmac
import json
import secrets
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select

from app.billing import router
from app.config import settings
from app.db import SessionLocal, engine
from app.models import Base, PaymentOrder, User
from app.services import cashfree
from tests.test_api import client as client
from tests.test_api import signup

pytest_plugins = ["tests.test_api"]


@pytest.fixture
def cf_app(monkeypatch):
    monkeypatch.setattr(settings, "cashfree_app_id", "TEST_CF_APP_ID")
    monkeypatch.setattr(settings, "cashfree_secret", SecretStr("test_secret_key_1234567890"))
    monkeypatch.setattr(settings, "cashfree_env", "sandbox")
    app_instance = FastAPI()
    app_instance.include_router(router, prefix="/api")
    return app_instance


def test_cashfree_plans_catalog(cf_app, monkeypatch):
    monkeypatch.setattr(settings, "local_test_mode", False)
    c = TestClient(cf_app)
    res = c.get("/api/billing/plans")
    assert res.status_code == 200
    data = res.json()
    assert data["gateway"] == "cashfree"
    plan_ids = [p["id"] for p in data["plans"]]
    assert plan_ids == ["free", "starter", "pro", "value"]

    # Verify amounts in INR
    amounts = {p["id"]: p["amount"] for p in data["plans"]}
    assert amounts["starter"] == 10000  # ₹100
    assert amounts["pro"] == 20000      # ₹200
    assert amounts["value"] == 50000    # ₹500


def test_webhook_signature_verification(monkeypatch):
    monkeypatch.setattr(settings, "cashfree_secret", SecretStr("my_secret_key"))
    timestamp = "1729674000"
    raw_body = b'{"data":{"order":{"order_id":"ipo_123"}}}'

    valid_sig = base64.b64encode(
        hmac.new(b"my_secret_key", timestamp.encode("utf-8") + raw_body, hashlib.sha256).digest()
    ).decode("utf-8")

    assert cashfree.verify_webhook_signature(raw_body, timestamp, valid_sig) is True
    assert cashfree.verify_webhook_signature(raw_body, timestamp, "invalid_sig") is False


@pytest.mark.asyncio
async def test_order_and_user_store_phone(monkeypatch):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    monkeypatch.setattr(settings, "cashfree_app_id", "test-app-id")
    monkeypatch.setattr(settings, "cashfree_secret", SecretStr("test-secret"))
    monkeypatch.setattr(settings, "cashfree_env", "sandbox")
    monkeypatch.setattr(
        cashfree,
        "create_cashfree_order",
        AsyncMock(return_value={"order_id": "ipo_phone_test", "payment_session_id": "sess_123"}),
    )

    test_email = f"phoneuser_{secrets.token_hex(4)}@example.com"
    order_id = f"ipo_phone_test_{secrets.token_hex(4)}"

    async with SessionLocal() as db:
        user = User(email=test_email, name="Phone User", password_hash="hash")
        db.add(user)
        await db.commit()
        user_id = user.id

        order = PaymentOrder(
            order_id=order_id,
            user_id=user_id,
            plan_id="starter",
            amount=100.0,
            currency="INR",
            status="ACTIVE",
            payment_session_id="sess_123",
            phone="9876543210",
        )
        db.add(order)
        user.phone = "9876543210"
        await db.commit()

    async with SessionLocal() as db:
        fetched_order = await db.scalar(select(PaymentOrder).where(PaymentOrder.order_id == order_id))
        assert fetched_order is not None
        assert fetched_order.phone == "9876543210"

        fetched_user = await db.get(User, user_id)
        assert fetched_user is not None
        assert fetched_user.phone == "9876543210"


def test_cashfree_create_order_and_verify_credits(client, monkeypatch):
    monkeypatch.setattr("app.api.rate_limit", AsyncMock(return_value=True))
    monkeypatch.setattr("app.security.rate_limit", AsyncMock(return_value=True))
    test_user_email = f"cf_credits_{secrets.token_hex(4)}@example.com"
    signup(client, test_user_email)
    monkeypatch.setattr(settings, "cashfree_app_id", "test-app-id")
    monkeypatch.setattr(settings, "cashfree_secret", SecretStr("test-secret"))
    monkeypatch.setattr(settings, "cashfree_env", "sandbox")

    # Mock order creation
    mock_order = {"order_id": "ipo_test_123", "payment_session_id": "sess_cf_123", "cf_order_id": "123456"}
    monkeypatch.setattr(cashfree, "create_cashfree_order", AsyncMock(return_value=mock_order))

    # Reject invalid phone
    bad_res = client.post("/api/billing/cashfree/create-order", json={"plan": "starter", "phone": "12345"})
    assert bad_res.status_code == 422

    # Reject invalid return_url domain/scheme
    bad_url_res = client.post("/api/billing/cashfree/create-order", json={"plan": "starter", "phone": "9876543210", "return_url": "javascript:alert(1)"})
    assert bad_url_res.status_code == 422

    # Create order with valid phone
    create_res = client.post(
        "/api/billing/cashfree/create-order",
        json={"plan": "starter", "phone": "9876543210", "return_url": "http://localhost:3000/interview?view=billing"},
    )
    assert create_res.status_code == 200
    data = create_res.json()
    order_id = data["order_id"]
    assert order_id.startswith("ipo_")

    # Mock fetch order from cashfree
    monkeypatch.setattr(
        cashfree,
        "fetch_cashfree_order",
        AsyncMock(
            return_value={
                "order_id": order_id,
                "order_currency": "INR",
                "order_amount": settings.starter_price_minor / 100.0,
                "order_status": "PAID",
                "cf_order_id": "123456",
            }
        ),
    )

    # Verify order
    verify_res = client.get(f"/api/billing/cashfree/verify/{order_id}")
    assert verify_res.status_code == 200
    vdata = verify_res.json()
    assert vdata["status"] == "PAID"
    assert vdata["minutes_granted"] == settings.starter_minutes

    # Check user: plan remains "free", credit_seconds increased
    me_res = client.get("/api/auth/me")
    assert me_res.status_code == 200
    user_info = me_res.json()
    assert user_info["plan"] == "free"
    assert user_info["credit_seconds"] == settings.starter_minutes * 60

    # Idempotent verify does not double credits
    verify_res2 = client.get(f"/api/billing/cashfree/verify/{order_id}")
    assert verify_res2.status_code == 200
    me_res2 = client.get("/api/auth/me")
    assert me_res2.json()["credit_seconds"] == settings.starter_minutes * 60


def test_cashfree_webhook_credit_grant(client, monkeypatch):
    monkeypatch.setattr("app.api.rate_limit", AsyncMock(return_value=True))
    monkeypatch.setattr("app.security.rate_limit", AsyncMock(return_value=True))
    test_user_email = f"cf_wh_{secrets.token_hex(4)}@example.com"
    signup(client, test_user_email)
    monkeypatch.setattr(settings, "cashfree_app_id", "test-app-id")
    monkeypatch.setattr(settings, "cashfree_secret", SecretStr("webhook-secret-key-123"))
    monkeypatch.setattr(settings, "cashfree_env", "sandbox")

    # Create order first
    mock_order = {"order_id": "ipo_wh_test", "payment_session_id": "sess_wh_123", "cf_order_id": "999"}
    monkeypatch.setattr(cashfree, "create_cashfree_order", AsyncMock(return_value=mock_order))

    create_res = client.post(
        "/api/billing/cashfree/create-order",
        json={"plan": "pro", "phone": "9876543210"},
    )
    assert create_res.status_code == 200
    order_id = create_res.json()["order_id"]

    # Send webhook
    timestamp = "1729674000"
    payload = {
        "type": "PAYMENT_SUCCESS_WEBHOOK",
        "data": {
            "order": {
                "order_id": order_id,
                "order_amount": settings.pro_price_minor / 100.0,
                "order_currency": "INR",
                "order_status": "PAID",
            },
            "payment": {"cf_payment_id": 999111, "payment_status": "SUCCESS"},
        },
    }
    raw_body = json.dumps(payload).encode("utf-8")
    sig = base64.b64encode(
        hmac.new(b"webhook-secret-key-123", timestamp.encode("utf-8") + raw_body, hashlib.sha256).digest()
    ).decode("utf-8")

    wh_res = client.post(
        "/api/billing/cashfree/webhook",
        content=raw_body,
        headers={"x-webhook-timestamp": timestamp, "x-webhook-signature": sig, "content-type": "application/json"},
    )
    assert wh_res.status_code == 200
    assert wh_res.json() == {"ok": True}

    # User got pro minutes
    me_res = client.get("/api/auth/me")
    assert me_res.status_code == 200
    assert me_res.json()["credit_seconds"] == settings.pro_minutes * 60
    assert me_res.json()["plan"] == "free"
