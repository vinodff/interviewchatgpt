import { describe, expect, it } from "vitest";
import { checkoutOrder, paymentPhone, stripeDestination, validOrderId } from "../lib/billing-checkout";

describe("payment checkout validation", () => {
  it("requires a real Indian mobile number and normalizes the country prefix", () => {
    expect(paymentPhone("+91 98765-43210")).toBe("9876543210");
    for (const phone of ["", "1234567890", "0000000000", "987654321", "987654321012", "abc9876543210"]) expect(paymentPhone(phone)).toBeNull();
  });
  it("rejects path injection or unbounded order IDs", () => {
    expect(validOrderId("ipo_1234-abc")).toBe(true);
    for (const id of ["", "../auth/logout", "order?token=secret", "x".repeat(101), null]) expect(validOrderId(id)).toBe(false);
  });
  it("uses only a validated checkout matching the requested price and mode", () => {
    const order = { order_id: "ipo_123", payment_session_id: "session", plan: "starter", amount: 100, environment: "production" };
    expect(checkoutOrder(order, "starter", 100)).toMatchObject({ order_id: "ipo_123", environment: "production" });
    for (const override of [{ environment: "live" }, { amount: 99 }, { plan: "value" }, { payment_session_id: "" }, { order_id: "../bad" }]) expect(() => checkoutOrder({ ...order, ...override }, "starter", 100)).toThrow();
  });
  it("restricts both checkout and billing-portal redirects to secure Stripe hosts", () => {
    expect(stripeDestination("https://billing.stripe.com/session/test")).toBe("https://billing.stripe.com/session/test");
    for (const url of ["http://stripe.com", "https://stripe.com.attacker.test", "https://attacker.test/stripe.com", "javascript:alert(1)", "https://name:password@stripe.com"]) expect(() => stripeDestination(url)).toThrow();
  });
});
