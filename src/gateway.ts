import { WorkerEntrypoint } from "cloudflare:workers";

interface HttpGatewayProps {
  allowedDomains: string[];
  credentials: Record<string, string>;
  agentId: string;
  taskId: string;
}

/**
 * HttpGateway — intercepts every outbound fetch() and connect() from
 * agent Dynamic Workers. Enforces a domain allowlist and injects
 * credentials without exposing secrets to agent code.
 */
export class HttpGateway extends WorkerEntrypoint<Env, HttpGatewayProps> {
  private get props() {
    return this.ctx.props;
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (!this.isDomainAllowed(url.hostname)) {
      console.warn(
        `[gateway] Blocked request from agent ${this.props.agentId} to ${url.hostname}`
      );
      return new Response(
        JSON.stringify({
          error: "egress_blocked",
          message: `Outbound requests to ${url.hostname} are not permitted.`,
          allowedDomains: this.props.allowedDomains,
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    const headers = new Headers(request.headers);
    this.injectCredentials(url, headers);

    headers.set("X-Agent-Id", this.props.agentId);
    headers.set("X-Task-Id", this.props.taskId);

    console.log(
      `[gateway] ${request.method} ${url.hostname}${url.pathname} (agent: ${this.props.agentId})`
    );

    try {
      return await fetch(new Request(request.url, {
        method: request.method,
        headers,
        body: request.body,
      }));
    } catch (err) {
      console.error(`[gateway] Fetch error: ${err}`);
      return new Response(
        JSON.stringify({ error: "egress_error", message: String(err) }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  private isDomainAllowed(hostname: string): boolean {
    return this.props.allowedDomains.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    );
  }

  private injectCredentials(url: URL, headers: Headers): void {
    const hostname = url.hostname;

    for (const [domain, credential] of Object.entries(this.props.credentials)) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) {
        if (domain.includes("github")) {
          headers.set("Authorization", `Bearer ${credential}`);
        } else if (domain.includes("anthropic")) {
          headers.set("x-api-key", credential);
          headers.set("anthropic-version", "2023-06-01");
        } else if (domain.includes("openai")) {
          headers.set("Authorization", `Bearer ${credential}`);
        } else {
          headers.set("Authorization", `Bearer ${credential}`);
        }
        break;
      }
    }
  }
}
