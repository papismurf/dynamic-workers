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
import { minorToMajorString } from "../money.js";

export interface PayPalProviderConfig {
  clientId: string;
  clientSecret: string;
  webhookId: string;
  env?: "sandbox" | "live";
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

const BASES = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
};

function mapStatus(status: string): PaymentStatusValue {
  switch (status) {
    // Only a captured order counts as paid. APPROVED means the buyer approved
    // but funds have not been captured yet, so it must remain pending.
    case "COMPLETED":
      return "confirmed";
    case "VOIDED":
      return "failed";
    case "CREATED":
    case "SAVED":
    case "APPROVED":
    case "PAYER_ACTION_REQUIRED":
      return "pending";
    default:
      return "pending";
  }
}

/**
 * PayPal adapter using the Orders API v2. Unlike Stripe/Coinbase (local HMAC),
 * PayPal webhooks are verified server-side by calling PayPal's
 * verify-webhook-signature endpoint with the configured webhook id — the
 * authoritative method PayPal recommends.
 */
export class PayPalProvider implements PaymentProvider {
  readonly id = "paypal";
  private readonly fetchImpl: typeof fetch;
  private readonly apiBase: string;

  constructor(private readonly config: PayPalProviderConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.apiBase = (config.apiBase ?? BASES[config.env ?? "sandbox"]).replace(/\/+$/, "");
  }

  private async accessToken(): Promise<string> {
    const auth = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString("base64");
    const resp = await this.fetchImpl(`${this.apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!resp.ok) {
      throw new PaymentProviderError(this.id, resp.status, await resp.text());
    }
    return ((await resp.json()) as { access_token: string }).access_token;
  }

  async createCharge(input: CreateChargeInput): Promise<Charge> {
    const token = await this.accessToken();
    const value = minorToMajorString(input.amount.amountMinor, input.amount.currency);
    const resp = await this.fetchImpl(`${this.apiBase}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(input.idempotencyKey ? { "PayPal-Request-Id": input.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            description: input.description,
            amount: { currency_code: input.amount.currency, value },
            custom_id: input.metadata?.orderId,
          },
        ],
        application_context: input.redirectUrl
          ? { return_url: input.redirectUrl, cancel_url: input.redirectUrl }
          : undefined,
      }),
    });
    if (!resp.ok) {
      throw new PaymentProviderError(this.id, resp.status, await resp.text());
    }
    const order = (await resp.json()) as {
      id: string;
      status: string;
      links: Array<{ rel: string; href: string }>;
    };
    return {
      id: order.id,
      provider: this.id,
      status: mapStatus(order.status),
      amount: input.amount,
      checkoutUrl: order.links.find((l) => l.rel === "approve")?.href,
      metadata: input.metadata,
      createdAt: new Date().toISOString(),
    };
  }

  async verifyPayment(chargeId: string): Promise<PaymentStatus> {
    const token = await this.accessToken();
    const resp = await this.fetchImpl(`${this.apiBase}/v2/checkout/orders/${chargeId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      throw new PaymentProviderError(this.id, resp.status, await resp.text());
    }
    const order = (await resp.json()) as { status: string };
    return { id: chargeId, status: mapStatus(order.status) };
  }

  async handleWebhook(req: WebhookRequest): Promise<WebhookEvent> {
    const token = await this.accessToken();
    const h = req.headers;
    const verifyResp = await this.fetchImpl(
      `${this.apiBase}/v1/notifications/verify-webhook-signature`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          auth_algo: h["paypal-auth-algo"],
          cert_url: h["paypal-cert-url"],
          transmission_id: h["paypal-transmission-id"],
          transmission_sig: h["paypal-transmission-sig"],
          transmission_time: h["paypal-transmission-time"],
          webhook_id: this.config.webhookId,
          webhook_event: JSON.parse(req.rawBody),
        }),
      }
    );
    if (!verifyResp.ok) {
      throw new PaymentProviderError(this.id, verifyResp.status, await verifyResp.text());
    }
    const { verification_status } = (await verifyResp.json()) as {
      verification_status: string;
    };
    if (verification_status !== "SUCCESS") {
      throw new WebhookVerificationError("PayPal webhook signature not verified");
    }

    const event = JSON.parse(req.rawBody) as {
      id: string;
      event_type: string;
      resource: {
        id: string;
        supplementary_data?: { related_ids?: { order_id?: string } };
      };
    };
    // On capture events resource.id is the capture id; the order id (our charge
    // id from createCharge) lives under supplementary_data.related_ids.
    const chargeId = event.resource.supplementary_data?.related_ids?.order_id ?? event.resource.id;
    switch (event.event_type) {
      case "PAYMENT.CAPTURE.COMPLETED":
        return { type: "payment.confirmed", chargeId, status: "confirmed", eventId: event.id, raw: event };
      // Buyer approved but funds not yet captured — not paid.
      case "CHECKOUT.ORDER.APPROVED":
        return { type: "payment.pending", chargeId, status: "pending", eventId: event.id, raw: event };
      case "PAYMENT.CAPTURE.DENIED":
      case "CHECKOUT.ORDER.DECLINED":
        return { type: "payment.failed", chargeId, status: "failed", eventId: event.id, raw: event };
      default:
        return { type: "unknown", chargeId, status: "pending", eventId: event.id, raw: event };
    }
  }
}
