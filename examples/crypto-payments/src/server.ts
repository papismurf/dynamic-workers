import http from "node:http";
import type { CreateChargeInput } from "./types.js";
import { PaymentProviderError, WebhookVerificationError } from "./types.js";
import { PaymentService } from "./payment-service.js";

export interface RestResult {
  status: number;
  json: unknown;
}

const CHARGE_RE = /^\/charges\/([\w-]+)$/;

/**
 * Provider-agnostic REST routing. Returns null for unknown routes. The webhook
 * route is handled by the Node server (it needs the raw body).
 */
export async function handleRest(
  service: PaymentService,
  method: string,
  pathname: string,
  body: unknown
): Promise<RestResult | null> {
  if (pathname === "/health" && method === "GET") {
    return { status: 200, json: { status: "healthy", provider: service.providerId } };
  }

  if (pathname === "/charges" && method === "POST") {
    try {
      const charge = await service.createCharge(body as CreateChargeInput);
      return { status: 201, json: charge };
    } catch (err) {
      // Upstream provider failures shouldn't leak their response body; surface
      // only our own validation messages to the caller.
      if (err instanceof PaymentProviderError) {
        console.error("[crypto-payments] provider createCharge failed:", err);
        return { status: 502, json: { error: "Payment provider error" } };
      }
      return { status: 400, json: { error: (err as Error).message } };
    }
  }

  const match = pathname.match(CHARGE_RE);
  if (match && method === "GET") {
    const status = await service.getStatus(match[1]!);
    return { status: 200, json: status };
  }

  return null;
}

const WEBHOOK_RE = /^\/webhooks\/[\w-]+$/;

async function readRaw(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function lowerHeaders(req: http.IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : (v ?? "");
  }
  return out;
}

export function createServer(service: PaymentService): http.Server {
  return http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const method = req.method ?? "GET";

      try {
        // Webhooks need the raw body for signature verification.
        if (WEBHOOK_RE.test(url.pathname) && method === "POST") {
          const rawBody = await readRaw(req);
          try {
            const event = await service.handleWebhook({
              rawBody,
              headers: lowerHeaders(req),
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ received: true, event }));
          } catch (err) {
            if (err instanceof WebhookVerificationError) {
              // Safe to surface: it's about the signature, not upstream internals.
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: err.message }));
            } else {
              // Don't leak upstream provider error bodies to the caller.
              console.error("[crypto-payments] webhook processing failed:", err);
              res.writeHead(502, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Webhook processing failed" }));
            }
          }
          return;
        }

        let body: unknown;
        if (method === "POST") {
          const raw = (await readRaw(req)) || "{}";
          try {
            body = JSON.parse(raw);
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON body" }));
            return;
          }
        }
        const result = await handleRest(service, method, url.pathname, body);
        if (!result) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
          return;
        }
        res.writeHead(result.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result.json));
      } catch (err) {
        // Generic message only; details go to the server log.
        console.error("[crypto-payments] request failed:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    })();
  });
}
