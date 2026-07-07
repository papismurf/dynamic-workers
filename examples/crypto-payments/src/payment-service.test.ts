import { test } from "node:test";
import assert from "node:assert/strict";
import { PaymentService } from "./payment-service.js";
import { MockProvider } from "./providers/mock.js";

function service() {
  const provider = new MockProvider({ webhookSecret: "s" });
  return { svc: new PaymentService(provider), provider };
}

test("createCharge validates input", async () => {
  const { svc } = service();
  await assert.rejects(
    svc.createCharge({ amount: { amountMinor: 0, currency: "USD" }, description: "x" }),
    /positive integer/
  );
  await assert.rejects(
    svc.createCharge({ amount: { amountMinor: 100, currency: "USD" }, description: "" }),
    /description is required/
  );
  await assert.rejects(
    svc.createCharge({ amount: { amountMinor: 100, currency: "US" }, description: "x" }),
    /currency/
  );
});

test("createCharge -> webhook confirms -> status reflects it", async () => {
  const { svc, provider } = service();
  const charge = await svc.createCharge({
    amount: { amountMinor: 2500, currency: "USD" },
    description: "Order 42",
    metadata: { orderId: "42" },
  });
  assert.equal(charge.status, "pending");
  assert.equal(svc.getCharge(charge.id)?.status, "pending");

  const payload = JSON.stringify({ id: "evt", chargeId: charge.id, status: "confirmed" });
  const event = await svc.handleWebhook({
    rawBody: payload,
    headers: { "x-mock-signature": provider.sign(payload) },
  });
  assert.equal(event.status, "confirmed");
  assert.equal(svc.getCharge(charge.id)?.status, "confirmed");
});

test("provider is swappable via the port (service is provider-agnostic)", () => {
  const { svc } = service();
  assert.equal(svc.providerId, "mock");
});
