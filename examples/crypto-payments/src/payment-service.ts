import type {
  Charge,
  CreateChargeInput,
  PaymentProvider,
  PaymentStatus,
  WebhookEvent,
  WebhookRequest,
} from "./types.js";

/**
 * Thin application service over a {@link PaymentProvider}. All business logic
 * (validation, charge bookkeeping) lives here and is provider-agnostic; the
 * concrete provider is injected, so switching Stripe <-> PayPal <-> crypto is
 * purely a construction-time decision.
 */
export class PaymentService {
  private readonly charges = new Map<string, Charge>();

  constructor(private readonly provider: PaymentProvider) {}

  get providerId(): string {
    return this.provider.id;
  }

  async createCharge(input: CreateChargeInput): Promise<Charge> {
    if (!Number.isInteger(input.amount.amountMinor) || input.amount.amountMinor <= 0) {
      throw new Error("amount.amountMinor must be a positive integer (minor units)");
    }
    if (!input.amount.currency || !/^[A-Za-z]{3,5}$/.test(input.amount.currency)) {
      throw new Error("amount.currency must be a 3-5 letter code");
    }
    if (!input.description?.trim()) {
      throw new Error("description is required");
    }
    const charge = await this.provider.createCharge(input);
    this.charges.set(charge.id, charge);
    return charge;
  }

  async getStatus(chargeId: string): Promise<PaymentStatus> {
    const status = await this.provider.verifyPayment(chargeId);
    const existing = this.charges.get(chargeId);
    if (existing) existing.status = status.status;
    return status;
  }

  /** Verify + apply an incoming webhook, updating local charge state. */
  async handleWebhook(req: WebhookRequest): Promise<WebhookEvent> {
    const event = await this.provider.handleWebhook(req);
    const charge = this.charges.get(event.chargeId);
    if (charge) charge.status = event.status;
    return event;
  }

  getCharge(chargeId: string): Charge | undefined {
    return this.charges.get(chargeId);
  }
}
