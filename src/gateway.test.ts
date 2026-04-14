/**
 * HttpGateway tests. These exercise the egress allow-list, credential
 * injection, and error-path responses without an actual agent Worker — we
 * construct the entrypoint with a synthetic ctx.props and drive its fetch()
 * method directly.
 */
import { HttpGateway } from "./gateway.js";
import { createFetchMock, jsonResponse } from "../tests/helpers/fetch.js";

interface GwProps {
  allowedDomains: string[];
  credentials: Record<string, string>;
  agentId: string;
  taskId: string;
}

function makeGateway(props: Partial<GwProps> = {}): HttpGateway {
  const ctx = {
    props: {
      allowedDomains: ["api.github.com", "api.anthropic.com", "api.openai.com"],
      credentials: {
        "api.github.com": "ghp_xxx",
        "api.anthropic.com": "sk-ant-xxx",
        "api.openai.com": "sk-openai-xxx",
      },
      agentId: "agent-1",
      taskId: "task-1",
      ...props,
    },
    storage: undefined,
  };
  return new HttpGateway(ctx as never, {} as never);
}

describe("HttpGateway.fetch — allow-list", () => {
  it("blocks hostnames not in the allow-list with a 403", async () => {
    const gw = makeGateway();
    const resp = await gw.fetch(new Request("https://evil.example.com/exfil"));
    expect(resp.status).toBe(403);
    const body = await resp.json() as { error: string; allowedDomains: string[] };
    expect(body.error).toBe("egress_blocked");
    expect(body.allowedDomains).toContain("api.github.com");
  });

  it("allows exact matches", async () => {
    const fx = createFetchMock()
      .on("GET https://api.github.com/*", () => jsonResponse({ ok: true }));
    fx.install();
    try {
      const gw = makeGateway();
      const resp = await gw.fetch(new Request("https://api.github.com/repos/a/b"));
      expect(resp.status).toBe(200);
    } finally {
      fx.restore();
    }
  });

  it("allows subdomain matches of an allowed apex", async () => {
    const fx = createFetchMock()
      .on("GET https://*.api.github.com/*", () => jsonResponse({ ok: true }));
    fx.install();
    try {
      const gw = makeGateway();
      const resp = await gw.fetch(
        new Request("https://uploads.api.github.com/files/x")
      );
      expect(resp.status).toBe(200);
    } finally {
      fx.restore();
    }
  });
});

describe("HttpGateway.fetch — credential injection", () => {
  it("injects Authorization: Bearer for GitHub", async () => {
    const fx = createFetchMock()
      .on("GET https://api.github.com/*", (_req, call) => {
        expect(call.headers["authorization"]).toBe("Bearer ghp_xxx");
        expect(call.headers["x-agent-id"]).toBe("agent-1");
        expect(call.headers["x-task-id"]).toBe("task-1");
        return jsonResponse({ ok: true });
      });
    fx.install();
    try {
      const gw = makeGateway();
      await gw.fetch(new Request("https://api.github.com/user"));
    } finally {
      fx.restore();
    }
  });

  it("injects x-api-key + anthropic-version for Anthropic", async () => {
    const fx = createFetchMock()
      .on("POST https://api.anthropic.com/*", (_req, call) => {
        expect(call.headers["x-api-key"]).toBe("sk-ant-xxx");
        expect(call.headers["anthropic-version"]).toBe("2023-06-01");
        return jsonResponse({ id: "msg_1" });
      });
    fx.install();
    try {
      const gw = makeGateway();
      await gw.fetch(
        new Request("https://api.anthropic.com/v1/messages", { method: "POST" })
      );
    } finally {
      fx.restore();
    }
  });

  it("injects Authorization: Bearer for OpenAI", async () => {
    const fx = createFetchMock()
      .on("POST https://api.openai.com/*", (_req, call) => {
        expect(call.headers["authorization"]).toBe("Bearer sk-openai-xxx");
        return jsonResponse({ id: "cmpl_1" });
      });
    fx.install();
    try {
      const gw = makeGateway();
      await gw.fetch(
        new Request("https://api.openai.com/v1/chat/completions", {
          method: "POST",
        })
      );
    } finally {
      fx.restore();
    }
  });

  it("does not inject credentials for domains without a matching entry", async () => {
    const fx = createFetchMock()
      .on("GET https://registry.npmjs.org/*", (_req, call) => {
        expect(call.headers["authorization"]).toBeUndefined();
        return jsonResponse({ name: "react" });
      });
    fx.install();
    try {
      const gw = makeGateway({
        allowedDomains: ["registry.npmjs.org"],
        credentials: { "api.github.com": "ghp_xxx" },
      });
      await gw.fetch(new Request("https://registry.npmjs.org/react"));
    } finally {
      fx.restore();
    }
  });
});

describe("HttpGateway.fetch — upstream failures", () => {
  it("returns 502 egress_error when upstream fetch throws", async () => {
    const fx = createFetchMock()
      .on("GET https://api.github.com/*", () => {
        throw new Error("boom");
      });
    fx.install();
    try {
      const gw = makeGateway();
      const resp = await gw.fetch(new Request("https://api.github.com/x"));
      expect(resp.status).toBe(502);
      const body = await resp.json() as { error: string };
      expect(body.error).toBe("egress_error");
    } finally {
      fx.restore();
    }
  });

  it("preserves upstream status and body on non-2xx", async () => {
    const fx = createFetchMock()
      .on("GET https://api.github.com/*", () => jsonResponse({ msg: "nope" }, 404));
    fx.install();
    try {
      const gw = makeGateway();
      const resp = await gw.fetch(new Request("https://api.github.com/missing"));
      expect(resp.status).toBe(404);
      expect(await resp.json()).toEqual({ msg: "nope" });
    } finally {
      fx.restore();
    }
  });
});
