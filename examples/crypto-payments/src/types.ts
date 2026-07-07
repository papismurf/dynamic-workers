/**
 * Payment domain types + the PaymentProvider port.
 *
 * This mirrors the ports-and-adapters pattern used by the orchestrator's LLM
 * provider layer: one interface, many interchangeable adapters selected by
 * configuration. See docs/adr/0003-payment-provider-abstraction.md.
 */

export type PaymentStatusValue =
  | "pending"
  | "confirmed"
  | "failed"
  | "expired"
  | "refunded";

/** Money is represented in minor units (e.g. cents) to avoid float errors. */
export interface Money {
  /** Integer amount in the currency's smallest unit (cents, satoshi-equivalent). */
  amountMinor: number;
  /** ISO 4217 for fiat (USD, EUR) or a crypto ticker (BTC, ETH, USDC). */
  currency: string;
}

export interface CreateChargeInput {
  amount: Money;
  /** Human-readable description shown to the payer. */
  description: string;
  /** Caller-supplied idempotency key; adapters should forward where supported. */
  idempotencyKey?: string;
  /** Arbitrary metadata echoed back on the charge. */
  metadata?: Record<string, string>;
  /** Where to send the payer after completion, when the provider supports it. */
  redirectUrl?: string;
}

export interface Charge {
  /** Provider-native charge/session/order id. */
  id: string;
  provider: string;
  status: PaymentStatusValue;
  amount: Money;
  /** Hosted checkout / approval URL the payer is redirected to, if any. */
  checkoutUrl?: string;
  metadata?: Record<string, string>;
  createdAt: string;
}

export interface PaymentStatus {
  id: string;
  status: PaymentStatusValue;
}

export interface WebhookRequest {
  /** Raw request body bytes/string — required for signature verification. */
  rawBody: string;
  headers: Record<string, string>;
}

export interface WebhookEvent {
  /** Normalized event type. */
  type: "payment.confirmed" | "payment.failed" | "payment.pending" | "unknown";
  chargeId: string;
  status: PaymentStatusValue;
  /** The provider-native event id (for audit/deduplication). */
  eventId?: string;
  raw?: unknown;
}

/**
 * A payment backend. Every adapter (Stripe, PayPal, crypto, mock) implements
 * this identical contract so swapping providers is a configuration change.
 */
export interface PaymentProvider {
  readonly id: string;
  createCharge(input: CreateChargeInput): Promise<Charge>;
  verifyPayment(chargeId: string): Promise<PaymentStatus>;
  /**
   * Parse and verify an incoming webhook. Implementations MUST verify the
   * provider signature and throw {@link WebhookVerificationError} on failure
   * before trusting any event data.
   */
  handleWebhook(req: WebhookRequest): Promise<WebhookEvent>;
}

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

export class PaymentProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status: number,
    message: string
  ) {
    super(`${provider} ${status}: ${message}`);
    this.name = "PaymentProviderError";
  }
}
