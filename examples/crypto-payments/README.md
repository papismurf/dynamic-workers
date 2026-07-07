# Crypto Payments — platform-agnostic, modular payment service

A small, self-contained payment service that switches between **Stripe**,
**PayPal**, **Coinbase Commerce (crypto)**, or a built-in **Mock** provider with a
single environment variable. It applies the same **ports-and-adapters** pattern
that the orchestrator uses for LLM providers: one interface, many interchangeable
adapters selected at runtime.

> See [`docs/adr/0003-payment-provider-abstraction.md`](../../docs/adr/0003-payment-provider-abstraction.md)
> for the design rationale.

## Why this shape

- **One port, many adapters.** Every backend implements the same
  [`PaymentProvider`](src/types.ts) contract (`createCharge`, `verifyPayment`,
  `handleWebhook`). Swapping providers is a config change, not a code change.
- **No provider lock-in in business logic.** [`PaymentService`](src/payment-service.ts)
  contains all validation/bookkeeping and depends only on the port.
- **Secure webhooks by default.** Each adapter verifies the provider signature
  (HMAC-SHA256 with a timing-safe compare; PayPal uses its verification API)
  before any event is trusted. Verification failures raise
  `WebhookVerificationError` → HTTP 400.
- **Money is integer minor units.** Amounts are cents/smallest-unit integers to
  avoid floating-point rounding bugs.

## Architecture

```
                       ┌─────────────────────┐
   HTTP  ──────────▶   │   Node HTTP server   │  (server.ts)
                       └──────────┬──────────┘
                                  │
                       ┌──────────▼──────────┐
                       │   PaymentService    │  validation + bookkeeping
                       └──────────┬──────────┘
                                  │  PaymentProvider (port)
        ┌──────────────┬──────────┴──────────┬──────────────┐
        ▼              ▼                      ▼              ▼
   StripeProvider  PayPalProvider     CoinbaseProvider   MockProvider
   (Checkout)      (Orders v2)        (Commerce, crypto) (in-memory)
```

## Quick start

```bash
cd examples/crypto-payments
npm install
cp .env.example .env        # defaults to the mock provider
npm start                   # http://127.0.0.1:8990
```

Then create a charge and confirm it via a signed mock webhook:

```bash
# Create a $25.00 charge
curl -s -X POST http://127.0.0.1:8990/charges \
  -H 'content-type: application/json' \
  -d '{"amount":{"amountMinor":2500,"currency":"USD"},"description":"Order 42"}'

# Check its status
curl -s http://127.0.0.1:8990/charges/<charge-id>
```

## Switching providers

Set `PAYMENT_PROVIDER` and the matching credentials in `.env`:

| Provider   | `PAYMENT_PROVIDER` | Required env vars                                                        |
| ---------- | ------------------ | ----------------------------------------------------------------------- |
| Mock       | `mock`             | `MOCK_WEBHOOK_SECRET` (optional)                                        |
| Stripe     | `stripe`           | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`                            |
| PayPal     | `paypal`           | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_ENV` |
| Coinbase   | `coinbase`         | `COINBASE_API_KEY`, `COINBASE_WEBHOOK_SECRET`                          |

No application code changes — the [registry](src/providers/registry.ts) builds
the right adapter from configuration.

## HTTP API

| Method | Path               | Description                                              |
| ------ | ------------------ | -------------------------------------------------------- |
| GET    | `/health`          | Liveness + active provider id                            |
| POST   | `/charges`         | Create a charge → `201` with `checkoutUrl` when hosted   |
| GET    | `/charges/:id`     | Fetch current status                                     |
| POST   | `/webhooks/:name`  | Provider webhook (raw body; signature-verified)          |

Point your provider's webhook at `/webhooks/<provider>` (e.g.
`/webhooks/stripe`). The server reads the raw body and passes it to the adapter
for signature verification.

## Adding a new provider

1. Implement [`PaymentProvider`](src/types.ts) in `src/providers/<name>.ts`
   (verify the signature in `handleWebhook`).
2. Add a `case` to [`createPaymentProvider`](src/providers/registry.ts) and its
   credential shape.
3. Add config wiring in [`config.ts`](src/config.ts).

## Testing

```bash
npm run typecheck
npm test          # Node's built-in test runner via tsx
```

Tests cover provider selection, charge mapping, and — importantly — webhook
signature verification for valid, tampered, and replayed payloads.
