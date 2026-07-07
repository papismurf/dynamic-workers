/**
 * Executable entry point for the crypto-payments example.
 * Run with `npm start` (uses PAYMENT_PROVIDER from the environment).
 */
import { loadConfig } from "./config.js";
import { createPaymentProvider } from "./providers/registry.js";
import { PaymentService } from "./payment-service.js";
import { createServer } from "./server.js";

const config = loadConfig();
const provider = createPaymentProvider(config.provider, config.credentials);
const service = new PaymentService(provider);
const server = createServer(service);

server.listen(config.port, config.host, () => {
  console.log(
    `[crypto-payments] listening on http://${config.host}:${config.port} (provider=${provider.id})`
  );
});
