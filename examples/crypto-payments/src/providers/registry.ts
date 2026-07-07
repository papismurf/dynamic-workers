import type { PaymentProvider } from "../types.js";
import { MockProvider } from "./mock.js";
import { StripeProvider } from "./stripe.js";
import { CoinbaseProvider } from "./coinbase.js";
import { PayPalProvider } from "./paypal.js";

export interface ProviderCredentials {
  stripe?: { secretKey: string; webhookSecret: string };
  paypal?: {
    clientId: string;
    clientSecret: string;
    webhookId: string;
    env?: "sandbox" | "live";
  };
  coinbase?: { apiKey: string; webhookSecret: string };
  mock?: { webhookSecret: string };
}

/**
 * Build a {@link PaymentProvider} from an id + credentials. Adding a provider
 * is a single case here — the rest of the app depends only on the port.
 */
export function createPaymentProvider(
  id: string,
  creds: ProviderCredentials
): PaymentProvider {
  switch (id.toLowerCase()) {
    case "stripe":
      if (!creds.stripe) throw new Error("Stripe credentials are required");
      return new StripeProvider(creds.stripe);
    case "paypal":
      if (!creds.paypal) throw new Error("PayPal credentials are required");
      return new PayPalProvider(creds.paypal);
    case "coinbase":
      if (!creds.coinbase) throw new Error("Coinbase credentials are required");
      return new CoinbaseProvider(creds.coinbase);
    case "mock":
      return new MockProvider(creds.mock ?? { webhookSecret: "dev-secret" });
    default:
      throw new Error(
        `Unknown payment provider "${id}". Supported: stripe, paypal, coinbase, mock.`
      );
  }
}

export const SUPPORTED_PROVIDERS = ["stripe", "paypal", "coinbase", "mock"] as const;
