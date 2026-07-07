import type {
  Charge,
  CreateChargeInput,
  PaymentProvider,
  PaymentStatus,
  PaymentStatusValue,
  WebhookEvent,
  WebhookRequest,
} from "../types.js";
import { PaymentProviderError, WebhookVerificationError } from "../types.js";
import { hmacSha256Hex, safeEqualHex } from "../crypto.js";

export interface StripeProviderConfig {
  secretKey: string;
  webhookSecret: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
  /** Max age (seconds) allowed for a webhook timestamp; guards replay. */
  toleranceSeconds?: number;
}

const STRIPE_API = "https://api.stripe.com";

/**
 * Stripe adapter using Checkout Sessions for a hosted payment page. Supports
 * card and, where enabled on the account, crypto. Webhooks are verified with
 * the standard Stripe-Signature scheme (HMAC-SHA256 over `${t}.${payload}`).
 */
export class StripeProvider implements PaymentProvider {
  readonly id = "stripe";
  private readonly fetchImpl: typeof fetch;
  private readonly apiBase: string;
  private readonly tolerance: number;

  constructor(private readonly config: StripeProviderConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.apiBase = (config.apiBase ?? STRIPE_API).replace(/\/+$/, "");
    this.tolerance = config.toleranceSeconds ?? 300;
  }

  private mapStatus(sessionStatus: string, paymentStatus?: string): PaymentStatusValue {
    if (paymentStatus === "paid" || sessionStatus === "complete") return "confirmed";
    if (sessionStatus === "expired") return "expired";
    if (sessionStatus === "open") return "pending";
    return "pending";
  }

  async createCharge(input: CreateChargeInput): Promise<Charge> {
    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("line_items[0][quantity]", "1");
    form.set("line_items[0][price_data][currency]", input.amount.currency.toLowerCase());
    form.set("line_items[0][price_data][unit_amount]", String(input.amount.amountMinor));
    form.set("line_items[0][price_data][product_data][name]", input.description);
    if (input.redirectUrl) {
      form.set("success_url", input.redirectUrl);
      form.set("cancel_url", input.redirectUrl);
    } else {
      form.set("success_url", "https://example.com/success");
      form.set("cancel_url", "https://example.com/cancel");
    }
    for (const [k, v] of Object.entries(input.metadata ?? {})) {
      form.set(`metadata[${k}]`, v);
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (input.idempotencyKey) headers["Idempotency-Key"] = input.idempotencyKey;

    const resp = await this.fetchImpl(`${this.apiBase}/v1/checkout/sessions`, {
      method: "POST",
      headers,
      body: form.toString(),
    });
    if (!resp.ok) {
      throw new PaymentProviderError(this.id, resp.status, await resp.text());
    }
    const session = (await resp.json()) as {
      id: string;
      url?: string;
      status: string;
      payment_status?: string;
    };
    return {
      id: session.id,
      provider: this.id,
      status: this.mapStatus(session.status, session.payment_status),
      amount: input.amount,
      checkoutUrl: session.url,
      metadata: input.metadata,
      createdAt: new Date().toISOString(),
    };
  }

  async verifyPayment(chargeId: string): Promise<PaymentStatus> {
    const resp = await this.fetchImpl(
      `${this.apiBase}/v1/checkout/sessions/${chargeId}`,
      { headers: { Authorization: `Bearer ${this.config.secretKey}` } }
    );
    if (!resp.ok) {
      throw new PaymentProviderError(this.id, resp.status, await resp.text());
    }
    const session = (await resp.json()) as {
      status: string;
      payment_status?: string;
    };
    return { id: chargeId, status: this.mapStatus(session.status, session.payment_status) };
  }

  /** Verify Stripe-Signature: `t=<ts>,v1=<sig>`; sig = HMAC(`${t}.${body}`). */
  private verifySignature(rawBody: string, header: string): void {
    const parts = Object.fromEntries(
      header.split(",").map((kv) => kv.split("=", 2) as [string, string])
    );
    const timestamp = parts["t"];
    const signature = parts["v1"];
    if (!timestamp || !signature) {
      throw new WebhookVerificationError("Malformed Stripe-Signature header");
    }
    const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (Number.isNaN(ageSeconds) || ageSeconds > this.tolerance) {
      throw new WebhookVerificationError("Stripe webhook timestamp outside tolerance");
    }
    const expected = hmacSha256Hex(this.config.webhookSecret, `${timestamp}.${rawBody}`);
    if (!safeEqualHex(signature, expected)) {
      throw new WebhookVerificationError("Invalid Stripe webhook signature");
    }
  }

  async handleWebhook(req: WebhookRequest): Promise<WebhookEvent> {
    const header = req.headers["stripe-signature"] ?? "";
    this.verifySignature(req.rawBody, header);

    const event = JSON.parse(req.rawBody) as {
      id: string;
      type: string;
      data: { object: { id: string } };
    };
    const chargeId = event.data.object.id;
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        return { type: "payment.confirmed", chargeId, status: "confirmed", eventId: event.id, raw: event };
      case "checkout.session.async_payment_failed":
        return { type: "payment.failed", chargeId, status: "failed", eventId: event.id, raw: event };
      case "checkout.session.expired":
        return { type: "payment.failed", chargeId, status: "expired", eventId: event.id, raw: event };
      default:
        return { type: "unknown", chargeId, status: "pending", eventId: event.id, raw: event };
    }
  }
}
