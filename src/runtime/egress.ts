/**
 * Runtime-neutral egress policy: a domain allowlist plus credential injection.
 *
 * This is the same policy the Cloudflare HttpGateway enforces via
 * `globalOutbound`, extracted so every runtime shares one implementation. The
 * local runtime applies it to any agent-initiated fetch. See
 * docs/adr/0001-runtime-compute-abstraction.md.
 */
export interface EgressPolicyConfig {
  allowedDomains: string[];
  /** Map of domain -> credential; injected as the appropriate auth header. */
  credentials?: Record<string, string>;
}

export class EgressBlockedError extends Error {
  constructor(public readonly hostname: string) {
    super(`Outbound requests to ${hostname} are not permitted.`);
    this.name = "EgressBlockedError";
  }
}

export class EgressPolicy {
  constructor(private readonly config: EgressPolicyConfig) {}

  isAllowed(hostname: string): boolean {
    return this.config.allowedDomains.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    );
  }

  /** Attach the matching credential (if any) to the headers for `url`. */
  injectCredentials(url: URL, headers: Headers): void {
    for (const [domain, credential] of Object.entries(
      this.config.credentials ?? {}
    )) {
      if (url.hostname === domain || url.hostname.endsWith(`.${domain}`)) {
        if (domain.includes("anthropic")) {
          headers.set("x-api-key", credential);
          headers.set("anthropic-version", "2023-06-01");
        } else {
          headers.set("Authorization", `Bearer ${credential}`);
        }
        break;
      }
    }
  }

  /**
   * Returns a `fetch` wrapper that enforces the allowlist and injects
   * credentials. Blocked hosts throw {@link EgressBlockedError}.
   */
  guardedFetch(baseFetch: typeof fetch = fetch): typeof fetch {
    // Derive the arg types from `fetch` so this compiles under both the Worker
    // and Node lib typings (which name the input type differently).
    return (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1]
    ) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (!this.isAllowed(url.hostname)) {
        throw new EgressBlockedError(url.hostname);
      }
      const headers = new Headers(request.headers);
      this.injectCredentials(url, headers);
      return baseFetch(new Request(request, { headers }));
    }) as typeof fetch;
  }
}
