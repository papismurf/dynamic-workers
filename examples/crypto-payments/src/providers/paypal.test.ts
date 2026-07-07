import { test } from "node:test";
import assert from "node:assert/strict";
import { PayPalProvider } from "./paypal.js";

/**
 * Build a fetch stub that routes by URL path. PayPal calls the OAuth token
 * endpoint before every operation, so that is always stubbed.
 */
function stubFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const href = typeof url === "string" ? url : url.toString();
    if (href.includes("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "tok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    for (const [needle, make] of Object.entries(routes)) {
      if (href.includes(needle)) return make();
    }
    throw new Error(`unexpected fetch to ${href}`);
  }) as typeof fetch;
}

function provider(fetchImpl: typeof fetch): PayPalProvider {
  return new PayPalProvider({
    clientId: "id",
    clientSecret: "secret",
    webhookId: "wh_1",
    env: "sandbox",
    fetchImpl,
  });
}

test("createCharge sends currency-correct amount and maps CREATED -> pending", async () => {
  let sentBody = "";
  const p = provider(
    (async (url: string | URL | Request, init?: RequestInit) => {
      const href = url.toString();
      if (href.includes("/v1/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
      }
      sentBody = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          id: "ORDER1",
          status: "CREATED",
          links: [{ rel: "approve", href: "https://paypal.com/approve/ORDER1" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch
  );
  const charge = await p.createCharge({
    amount: { amountMinor: 2500, currency: "USD" },
    description: "Order 42",
  });
  assert.equal(charge.id, "ORDER1");
  assert.equal(charge.status, "pending");
  assert.equal(charge.checkoutUrl, "https://paypal.com/approve/ORDER1");
  assert.match(sentBody, /"value":"25\.00"/);
});

test("handleWebhook confirms only a captured order and resolves the order id", async () => {
  const p = provider(
    stubFetch({
      "/v1/notifications/verify-webhook-signature": () =>
        new Response(JSON.stringify({ verification_status: "SUCCESS" }), { status: 200 }),
    })
  );
  const body = JSON.stringify({
    id: "evt_1",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: "CAPTURE123",
      supplementary_data: { related_ids: { order_id: "ORDER1" } },
    },
  });
  const event = await p.handleWebhook({ rawBody: body, headers: {} });
  assert.equal(event.type, "payment.confirmed");
  assert.equal(event.chargeId, "ORDER1"); // order id, not the capture id
});

test("handleWebhook treats an approved-but-uncaptured order as pending", async () => {
  const p = provider(
    stubFetch({
      "/v1/notifications/verify-webhook-signature": () =>
        new Response(JSON.stringify({ verification_status: "SUCCESS" }), { status: 200 }),
    })
  );
  const body = JSON.stringify({
    id: "evt_2",
    event_type: "CHECKOUT.ORDER.APPROVED",
    resource: { id: "ORDER1" },
  });
  const event = await p.handleWebhook({ rawBody: body, headers: {} });
  assert.equal(event.status, "pending");
});

test("handleWebhook rejects when PayPal fails signature verification", async () => {
  const p = provider(
    stubFetch({
      "/v1/notifications/verify-webhook-signature": () =>
        new Response(JSON.stringify({ verification_status: "FAILURE" }), { status: 200 }),
    })
  );
  const body = JSON.stringify({
    id: "evt_3",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: { id: "ORDER1" },
  });
  await assert.rejects(p.handleWebhook({ rawBody: body, headers: {} }), /not verified/);
});
