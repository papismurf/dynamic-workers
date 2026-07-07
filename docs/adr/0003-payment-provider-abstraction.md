# ADR-0003: Payment Provider Abstraction (example app)

- Status: Proposed
- Date: 2026-07-07
- Deciders: Orchestrator maintainers
- Related: ADR-0001, ADR-0002

## Context

Task 2 requires a **new, standalone** example in the examples directory: a cryptocurrency payment application that can switch between Stripe, PayPal, or any crypto payment provider in a platform-agnostic, modular way. Its purpose is to demonstrate that the same ports-and-adapters pattern used for LLM providers and runtimes generalizes to another domain (payments).

This example is distinct from the existing `examples/fastapi-crypto-terminal`, which is a CoinGecko price / AI-analysis terminal and contains no payment logic. The new payment example will live in its own subdirectory (e.g. `examples/crypto-payments`) and does not modify the existing terminal.

## Decision

Model payments as a `PaymentProvider` port with a uniform contract, mirroring ADR-0002's registry approach:

```ts
interface PaymentProvider {
  readonly id: string;                                  // "stripe" | "paypal" | "coinbase-commerce" | "mock"
  createCharge(input: CreateChargeInput): Promise<Charge>;
  verifyPayment(chargeId: string): Promise<PaymentStatus>;
  handleWebhook(req: WebhookRequest): Promise<WebhookEvent>;   // MUST verify signatures
}
```

Adapters at launch:
- `StripeProvider` (card + crypto via Stripe where available).
- `PayPalProvider`.
- `CoinbaseCommerceProvider` (native crypto).
- `MockProvider` (deterministic, for tests and offline demos).

Provider is chosen by a `PAYMENT_PROVIDER` env var via a factory. Webhook handlers MUST verify provider signatures before trusting events. No secrets in code; `.env.example` only.

## Consequences

Positive:
- Demonstrates the modular adapter pattern beyond LLMs.
- Swapping providers is a config change, not a code change.
- `MockProvider` enables tests/CI without live credentials.

Negative / trade-offs:
- Each provider has distinct webhook/signature semantics that must be normalized carefully (security-sensitive).

Neutral:
- The example is additive and independent of the orchestrator core; it can ship on its own branch/PR.
