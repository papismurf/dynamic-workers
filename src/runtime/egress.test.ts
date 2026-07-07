import { EgressPolicy, EgressBlockedError } from "./egress.js";

describe("EgressPolicy", () => {
  const policy = new EgressPolicy({
    allowedDomains: ["api.openai.com", "api.anthropic.com"],
    credentials: {
      "api.anthropic.com": "sk-ant",
      "api.openai.com": "sk-oai",
    },
  });

  it("allows exact and subdomain matches only", () => {
    expect(policy.isAllowed("api.openai.com")).toBe(true);
    expect(policy.isAllowed("eu.api.openai.com")).toBe(true);
    expect(policy.isAllowed("evil.com")).toBe(false);
    expect(policy.isAllowed("openai.com.evil.com")).toBe(false);
  });

  it("injects Anthropic-style credentials", () => {
    const headers = new Headers();
    policy.injectCredentials(new URL("https://api.anthropic.com/v1/messages"), headers);
    expect(headers.get("x-api-key")).toBe("sk-ant");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
  });

  it("injects Bearer credentials for other hosts", () => {
    const headers = new Headers();
    policy.injectCredentials(new URL("https://api.openai.com/v1/chat/completions"), headers);
    expect(headers.get("authorization")).toBe("Bearer sk-oai");
  });

  it("guardedFetch blocks disallowed hosts and forwards allowed ones", async () => {
    let seen: Request | undefined;
    const base = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen = input instanceof Request ? input : new Request(input, init);
      return new Response("ok");
    }) as typeof fetch;

    const guarded = policy.guardedFetch(base);

    await expect(guarded("https://evil.com/x")).rejects.toBeInstanceOf(
      EgressBlockedError
    );

    const resp = await guarded("https://api.openai.com/v1/models");
    expect(await resp.text()).toBe("ok");
    expect(seen?.headers.get("authorization")).toBe("Bearer sk-oai");
  });
});
