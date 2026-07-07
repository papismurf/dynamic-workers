import { test } from "node:test";
import assert from "node:assert/strict";
import { createPaymentProvider } from "./registry.js";
import { MockProvider } from "./mock.js";
import { StripeProvider } from "./stripe.js";
import { CoinbaseProvider } from "./coinbase.js";
import { hmacSha256Hex } from "../crypto.js";
import type { WebhookRequest } from "../types.js";

test("registry selects providers and rejects unknown ids", () => {
  assert.equal(createPaymentProvider("mock", {}).id, "mock");
  assert.throws(() => createPaymentProvider("nope", {}), /Unknown payment provider/);
  assert.throws(() => createPaymentProvider("stripe", {}), /Stripe credentials/);
});

test("MockProvider: create + verify + signed webhook lifecycle", async () => {
  const provider = new MockProvider({ webhookSecret: "s3cret" });
  const charge = await provider.createCharge({
    amount: { amountMinor: 500, currency: "USD" },
    description: "Test order",
  });
  assert.equal(charge.status, "pending");
  assert.ok(charge.checkoutUrl);

  const payload = JSON.stringify({ id: "evt_1", chargeId: charge.id, status: "confirmed" });
  const req: WebhookRequest = {
    rawBody: payload,
    headers: { "x-mock-signature": provider.sign(payload) },
  };
  const event = await provider.handleWebhook(req);
  assert.equal(event.type, "payment.confirmed");
  assert.equal((await provider.verifyPayment(charge.id)).status, "confirmed");
});

test("MockProvider: rejects an invalid webhook signature", async () => {
  const provider = new MockProvider({ webhookSecret: "s3cret" });
  const payload = JSON.stringify({ chargeId: "x", status: "confirmed" });
  await assert.rejects(
    provider.handleWebhook({ rawBody: payload, headers: { "x-mock-signature": "deadbeef" } }),
    /Invalid mock webhook signature/
  );
});

test("StripeProvider: createCharge maps a Checkout Session and verifies signatures", async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({ id: "cs_123", url: "https://checkout.stripe.com/x", status: "open" }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as typeof fetch;

  const provider = new StripeProvider({
    secretKey: "sk_test",
    webhookSecret: "whsec_test",
    fetchImpl,
  });
  const charge = await provider.createCharge({
    amount: { amountMinor: 1000, currency: "USD" },
    description: "Pro plan",
  });
  assert.equal(charge.id, "cs_123");
  assert.equal(charge.checkoutUrl, "https://checkout.stripe.com/x");
  assert.equal(charge.status, "pending");

  // Valid signed webhook -> confirmed.
  const body = JSON.stringify({
    id: "evt_1",
    type: "checkout.session.completed",
    data: { object: { id: "cs_123" } },
  });
  const t = Math.floor(Date.now() / 1000);
  const sig = hmacSha256Hex("whsec_test", `${t}.${body}`);
  const event = await provider.handleWebhook({
    rawBody: body,
    headers: { "stripe-signature": `t=${t},v1=${sig}` },
  });
  assert.equal(event.type, "payment.confirmed");

  // Tampered signature -> rejected.
  await assert.rejects(
    provider.handleWebhook({
      rawBody: body,
      headers: { "stripe-signature": `t=${t},v1=deadbeef` },
    }),
    /Invalid Stripe webhook signature/
  );

  // Stale timestamp -> rejected (replay protection).
  const staleSig = hmacSha256Hex("whsec_test", `1000.${body}`);
  await assert.rejects(
    provider.handleWebhook({
      rawBody: body,
      headers: { "stripe-signature": `t=1000,v1=${staleSig}` },
    }),
    /outside tolerance/
  );
});

test("CoinbaseProvider: verifies the X-CC-Webhook-Signature HMAC", async () => {
  const provider = new CoinbaseProvider({ apiKey: "k", webhookSecret: "cbsecret" });
  const body = JSON.stringify({
    event: { id: "e1", type: "charge:confirmed", data: { id: "chg_1" } },
  });
  const event = await provider.handleWebhook({
    rawBody: body,
    headers: { "x-cc-webhook-signature": hmacSha256Hex("cbsecret", body) },
  });
  assert.equal(event.type, "payment.confirmed");
  assert.equal(event.chargeId, "chg_1");

  await assert.rejects(
    provider.handleWebhook({ rawBody: body, headers: { "x-cc-webhook-signature": "00" } }),
    /Invalid Coinbase webhook signature/
  );
});
