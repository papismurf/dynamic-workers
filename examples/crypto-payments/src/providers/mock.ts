import { randomUUID } from "node:crypto";
import type {
  Charge,
  CreateChargeInput,
  PaymentProvider,
  PaymentStatus,
  WebhookEvent,
  WebhookRequest,
} from "../types.js";
import { WebhookVerificationError } from "../types.js";
import { hmacSha256Hex, safeEqualHex } from "../crypto.js";

export interface MockProviderConfig {
  webhookSecret: string;
}

/**
 * Deterministic, network-free provider for local demos and tests. Charges are
 * held in memory. Webhooks are HMAC-signed with the same scheme real providers
 * use, so signature-verification logic is exercised without live credentials.
 */
export class MockProvider implements PaymentProvider {
  readonly id = "mock";
  private readonly charges = new Map<string, Charge>();

  constructor(private readonly config: MockProviderConfig) {}

  async createCharge(input: CreateChargeInput): Promise<Charge> {
    const id = `mock_${randomUUID()}`;
    const charge: Charge = {
      id,
      provider: this.id,
      status: "pending",
      amount: input.amount,
      checkoutUrl: `https://mock.local/checkout/${id}`,
      metadata: input.metadata,
      createdAt: new Date().toISOString(),
    };
    this.charges.set(id, charge);
    return charge;
  }

  async verifyPayment(chargeId: string): Promise<PaymentStatus> {
    const charge = this.charges.get(chargeId);
    return { id: chargeId, status: charge?.status ?? "failed" };
  }

  /** Test helper: mark a charge as paid (simulates the payer completing). */
  markPaid(chargeId: string): void {
    const charge = this.charges.get(chargeId);
    if (charge) charge.status = "confirmed";
  }

  /** Test helper: produce a valid signature for a webhook payload. */
  sign(rawBody: string): string {
    return hmacSha256Hex(this.config.webhookSecret, rawBody);
  }

  async handleWebhook(req: WebhookRequest): Promise<WebhookEvent> {
    const signature = req.headers["x-mock-signature"] ?? "";
    const expected = hmacSha256Hex(this.config.webhookSecret, req.rawBody);
    if (!safeEqualHex(signature, expected)) {
      throw new WebhookVerificationError("Invalid mock webhook signature");
    }
    const event = JSON.parse(req.rawBody) as {
      id?: string;
      chargeId: string;
      status: WebhookEvent["status"];
    };
    const existing = this.charges.get(event.chargeId);
    if (existing) existing.status = event.status;
    return {
      type:
        event.status === "confirmed"
          ? "payment.confirmed"
          : event.status === "failed"
            ? "payment.failed"
            : "payment.pending",
      chargeId: event.chargeId,
      status: event.status,
      eventId: event.id,
      raw: event,
    };
  }
}
