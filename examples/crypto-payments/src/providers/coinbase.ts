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
import { minorToMajorString } from "../money.js";

export interface CoinbaseProviderConfig {
  apiKey: string;
  webhookSecret: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

const COINBASE_API = "https://api.commerce.coinbase.com";

/** Coinbase Commerce timeline status -> normalized status. */
function mapStatus(timeline: Array<{ status: string }> | undefined): PaymentStatusValue {
  const last = timeline?.[timeline.length - 1]?.status?.toUpperCase();
  switch (last) {
    case "COMPLETED":
    case "RESOLVED":
      return "confirmed";
    case "EXPIRED":
      return "expired";
    case "CANCELED":
    case "UNRESOLVED":
      return "failed";
    default:
      return "pending";
  }
}

/**
 * Coinbase Commerce adapter — native cryptocurrency payments (BTC, ETH, USDC,
 * ...). Charges return a hosted checkout URL. Webhooks are verified via the
 * `X-CC-Webhook-Signature` header (hex HMAC-SHA256 of the raw body).
 */
export class CoinbaseProvider implements PaymentProvider {
  readonly id = "coinbase";
  private readonly fetchImpl: typeof fetch;
  private readonly apiBase: string;

  constructor(private readonly config: CoinbaseProviderConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.apiBase = (config.apiBase ?? COINBASE_API).replace(/\/+$/, "");
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "X-CC-Api-Key": this.config.apiKey,
      "X-CC-Version": "2018-03-22",
    };
  }

  async createCharge(input: CreateChargeInput): Promise<Charge> {
    // Coinbase prices in major units; convert using the currency's precision
    // (2 for most fiat, 0 for JPY/KRW, more for crypto tickers).
    const amountMajor = minorToMajorString(input.amount.amountMinor, input.amount.currency);
    const resp = await this.fetchImpl(`${this.apiBase}/charges`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        name: input.description.slice(0, 100),
        description: input.description,
        pricing_type: "fixed_price",
        local_price: { amount: amountMajor, currency: input.amount.currency },
        metadata: input.metadata ?? {},
        redirect_url: input.redirectUrl,
      }),
    });
    if (!resp.ok) {
      throw new PaymentProviderError(this.id, resp.status, await resp.text());
    }
    const { data } = (await resp.json()) as {
      data: { id: string; hosted_url: string; timeline?: Array<{ status: string }> };
    };
    return {
      id: data.id,
      provider: this.id,
      status: mapStatus(data.timeline),
      amount: input.amount,
      checkoutUrl: data.hosted_url,
      metadata: input.metadata,
      createdAt: new Date().toISOString(),
    };
  }

  async verifyPayment(chargeId: string): Promise<PaymentStatus> {
    const resp = await this.fetchImpl(`${this.apiBase}/charges/${chargeId}`, {
      headers: this.headers(),
    });
    if (!resp.ok) {
      throw new PaymentProviderError(this.id, resp.status, await resp.text());
    }
    const { data } = (await resp.json()) as {
      data: { timeline?: Array<{ status: string }> };
    };
    return { id: chargeId, status: mapStatus(data.timeline) };
  }

  async handleWebhook(req: WebhookRequest): Promise<WebhookEvent> {
    const signature = req.headers["x-cc-webhook-signature"] ?? "";
    const expected = hmacSha256Hex(this.config.webhookSecret, req.rawBody);
    if (!safeEqualHex(signature, expected)) {
      throw new WebhookVerificationError("Invalid Coinbase webhook signature");
    }
    const parsed = JSON.parse(req.rawBody) as {
      event: { id: string; type: string; data: { id: string } };
    };
    const { id, type, data } = parsed.event;
    switch (type) {
      case "charge:confirmed":
      case "charge:resolved":
        return { type: "payment.confirmed", chargeId: data.id, status: "confirmed", eventId: id, raw: parsed };
      case "charge:failed":
        return { type: "payment.failed", chargeId: data.id, status: "failed", eventId: id, raw: parsed };
      case "charge:pending":
        return { type: "payment.pending", chargeId: data.id, status: "pending", eventId: id, raw: parsed };
      default:
        return { type: "unknown", chargeId: data.id, status: "pending", eventId: id, raw: parsed };
    }
  }
}
