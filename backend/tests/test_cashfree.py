from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.billing import router
from app.config import settings
from app.models import PaymentOrder, User
from app.security import aware
from app.services import cashfree


@pytest.fixture
def cf_app(monkeypatch):
    monkeypatch.setattr(settings, "cashfree_app_id", "TEST_CF_APP_ID")
    monkeypatch.setattr(settings, "cashfree_secret", SecretStr("test_secret_key_1234567890"))
    monkeypatch.setattr(settings, "cashfree_env", "sandbox")
    app = FastAPI()
    app.include_router(router, prefix="/api")
    return app


def test_cashfree_plans_catalog(cf_app, monkeypatch):
    monkeypatch.setattr(settings, "local_test_mode", False)
    client = TestClient(cf_app)
    res = client.get("/api/billing/plans")
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

    # Compute valid signature
    import base64
    import hashlib
    import hmac

    valid_sig = base64.b64encode(
        hmac.new(b"my_secret_key", timestamp.encode("utf-8") + raw_body, hashlib.sha256).digest()
    ).decode("utf-8")

    assert cashfree.verify_webhook_signature(raw_body, timestamp, valid_sig) is True
    assert cashfree.verify_webhook_signature(raw_body, timestamp, "invalid_sig") is False
