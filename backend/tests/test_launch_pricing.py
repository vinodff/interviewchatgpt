from types import SimpleNamespace

import pytest
import stripe
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.billing import router, subscription_plan, verified_price
from app.config import settings
from app.usage import minute_limit
from tests.test_api import client as client
from tests.test_api import signup


def test_three_public_plans_show_real_limits_without_credentials(monkeypatch):
    monkeypatch.setattr(settings, "stripe_secret_key", SecretStr(""))
    monkeypatch.setattr(settings, "cashfree_app_id", "")
    monkeypatch.setattr(settings, "local_test_mode", False)
    app = FastAPI()
    app.include_router(router, prefix="/api")
    response = TestClient(app).get("/api/billing/plans")
    assert response.status_code == 200
    plans = response.json()["plans"]
    assert [item["id"] for item in plans] == ["free", "starter", "pro", "value"]
    assert [item["minutes"] for item in plans] == [settings.free_minutes, settings.starter_minutes, settings.pro_minutes, settings.value_minutes]
    assert [item["amount"] for item in plans] == [0, settings.starter_price_minor, settings.pro_price_minor, settings.value_price_minor]
    assert all(not item["checkout_available"] for item in plans)
    assert "secret" not in response.text and "price_id" not in response.text


def test_starter_has_its_own_allowance(monkeypatch):
    monkeypatch.setattr(settings, "local_test_mode", False)
    assert minute_limit(SimpleNamespace(id="person", plan="starter")) == settings.starter_minutes
    assert minute_limit(SimpleNamespace(id="person", plan="pro")) == settings.pro_minutes
    assert minute_limit(SimpleNamespace(id="person", plan="free")) == settings.free_minutes


@pytest.mark.asyncio
async def test_checkout_rejects_a_price_that_differs_from_advertised_plan(monkeypatch):
    monkeypatch.setattr(settings, "stripe_secret_key", SecretStr("test-only"))
    monkeypatch.setattr(settings, "stripe_webhook_secret", SecretStr("test-only"))
    monkeypatch.setattr(settings, "stripe_starter_price_id", "price_starter")
    price = {"active": True, "type": "recurring", "currency": "inr", "unit_amount": 1,
             "billing_scheme": "per_unit", "recurring": {"interval": "month", "interval_count": 1, "usage_type": "licensed"}}
    monkeypatch.setattr(stripe.Price, "retrieve", lambda *_args, **_kwargs: price)
    with pytest.raises(HTTPException) as error:
        await verified_price("starter")
    assert error.value.status_code == 503
    price["unit_amount"] = settings.starter_price_minor
    assert await verified_price("starter") == "price_starter"
    price["recurring"]["interval"] = "year"
    with pytest.raises(HTTPException):
        await verified_price("starter")


def test_starter_subscription_is_recognized_without_promoting_it_to_pro(monkeypatch):
    monkeypatch.setattr(settings, "stripe_starter_price_id", "price_starter")
    monkeypatch.setattr(settings, "stripe_price_id", "price_pro")
    subscription = {"items": SimpleNamespace(data=[SimpleNamespace(price=SimpleNamespace(id="price_starter"))])}
    assert subscription_plan(subscription) == "starter"
    subscription["items"].data[0].price.id = "price_unrelated"
    assert subscription_plan(subscription) is None


def test_checkout_uses_selected_starter_price_and_returns_to_billing(client, monkeypatch):
    signup(client)
    monkeypatch.setattr(settings, "stripe_secret_key", SecretStr("test-only"))
    monkeypatch.setattr(settings, "stripe_webhook_secret", SecretStr("test-only"))
    monkeypatch.setattr(settings, "stripe_starter_price_id", "price_starter")
    monkeypatch.setattr(stripe.Price, "retrieve", lambda *_args, **_kwargs: {"active": True, "type": "recurring", "currency": "inr", "unit_amount": settings.starter_price_minor, "billing_scheme": "per_unit", "recurring": {"interval": "month", "interval_count": 1, "usage_type": "licensed"}})
    monkeypatch.setattr(stripe.Customer, "create", lambda **_kwargs: SimpleNamespace(id="cus_test"))
    monkeypatch.setattr(stripe.checkout.Session, "list", lambda **_kwargs: SimpleNamespace(data=[], has_more=False))
    captured = {}

    def create(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(url="https://checkout.stripe.com/test-session")

    monkeypatch.setattr(stripe.checkout.Session, "create", create)
    response = client.post("/api/billing/checkout", json={"plan": "starter"})
    assert response.status_code == 200
    assert captured["line_items"] == [{"price": "price_starter", "quantity": 1}]
    assert captured["success_url"].endswith("/interview?view=billing&billing=success")
    assert captured["cancel_url"].endswith("/interview?view=billing&billing=cancelled")
    # A browser return must never activate a paid plan; only signed provider updates can.
    assert client.get("/api/auth/me").json()["plan"] == "free"


def test_changing_plans_back_does_not_reuse_an_expired_checkout(client, monkeypatch):
    signup(client)
    monkeypatch.setattr(settings, "stripe_secret_key", SecretStr("test-only"))
    monkeypatch.setattr(settings, "stripe_webhook_secret", SecretStr("test-only"))
    monkeypatch.setattr(settings, "stripe_starter_price_id", "price_starter")
    monkeypatch.setattr(settings, "stripe_price_id", "price_pro")
    monkeypatch.setattr(stripe.Price, "retrieve", lambda price, **_kwargs: {"active": True, "type": "recurring", "currency": "inr", "unit_amount": settings.starter_price_minor if price == "price_starter" else settings.pro_price_minor, "billing_scheme": "per_unit", "recurring": {"interval": "month", "interval_count": 1, "usage_type": "licensed"}})
    monkeypatch.setattr(stripe.Customer, "create", lambda **_kwargs: SimpleNamespace(id="cus_test"))
    monkeypatch.setattr(stripe.Subscription, "list", lambda **_kwargs: SimpleNamespace(data=[], has_more=False))
    sessions, attempts = [], {}
    monkeypatch.setattr(stripe.checkout.Session, "list", lambda **_kwargs: SimpleNamespace(data=[item for item in sessions if item.status == "open"], has_more=False))

    def create(**kwargs):
        attempt = kwargs["idempotency_key"]
        if attempt in attempts:
            return attempts[attempt]
        item = SimpleNamespace(id=f"cs_{len(sessions)}", mode="subscription", status="open", metadata=kwargs["metadata"], url=f"https://checkout.stripe.com/cs_{len(sessions)}")
        attempts[attempt] = item
        sessions.append(item)
        return item

    def expire(session_id, **_kwargs):
        next(item for item in sessions if item.id == session_id).status = "expired"

    monkeypatch.setattr(stripe.checkout.Session, "create", create)
    monkeypatch.setattr(stripe.checkout.Session, "expire", expire)
    urls = [client.post("/api/billing/checkout", json={"plan": plan}).json()["url"] for plan in ["starter", "pro", "starter"]]
    assert len(set(urls)) == 3
    assert [item.status for item in sessions] == ["expired", "expired", "open"]
