import type { ProviderCredentials } from "./providers/registry.js";

export interface AppConfig {
  provider: string;
  port: number;
  host: string;
  credentials: ProviderCredentials;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const provider = (env.PAYMENT_PROVIDER ?? "mock").toLowerCase();
  return {
    provider,
    port: Number(env.PORT ?? 8990),
    host: env.HOST ?? "127.0.0.1",
    credentials: {
      stripe:
        env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET
          ? { secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET }
          : undefined,
      paypal:
        env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET && env.PAYPAL_WEBHOOK_ID
          ? {
              clientId: env.PAYPAL_CLIENT_ID,
              clientSecret: env.PAYPAL_CLIENT_SECRET,
              webhookId: env.PAYPAL_WEBHOOK_ID,
              env: env.PAYPAL_ENV === "live" ? "live" : "sandbox",
            }
          : undefined,
      coinbase:
        env.COINBASE_API_KEY && env.COINBASE_WEBHOOK_SECRET
          ? { apiKey: env.COINBASE_API_KEY, webhookSecret: env.COINBASE_WEBHOOK_SECRET }
          : undefined,
      mock: { webhookSecret: env.MOCK_WEBHOOK_SECRET ?? "dev-secret" },
    },
  };
}
