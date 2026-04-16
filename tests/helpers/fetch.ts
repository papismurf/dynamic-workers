/**
 * Route-based fetch stub. Tests register matchers against
 * `method + hostname + path` patterns and assert which ones fired.
 *
 * Usage:
 *   const fx = createFetchMock();
 *   fx.on("POST https://api.github.com/repos/:owner/:repo/pulls",
 *         () => jsonResponse({ html_url: "https://github.com/x/y/pull/1" }));
 *   fx.install();
 *   ...run code...
 *   expect(fx.calls).toHaveLength(1);
 *   fx.restore();
 */

export interface FetchCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

type Handler = (req: Request, call: FetchCall) => Response | Promise<Response>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

export interface FetchMock {
  on(route: string, handler: Handler): FetchMock;
  install(): void;
  restore(): void;
  readonly calls: FetchCall[];
  unmatched(): FetchCall[];
}

export function createFetchMock(): FetchMock {
  const routes: Route[] = [];
  const calls: FetchCall[] = [];
  const unmatched: FetchCall[] = [];
  let original: typeof fetch | undefined;

  const parse = (route: string): { method: string; pattern: RegExp; keys: string[] } => {
    const [method, urlPattern] = route.split(" ");
    if (!method || !urlPattern) throw new Error(`Bad route: ${route}`);
    const keys: string[] = [];
    // Escape regex metacharacters except our ':param' and '*' placeholders.
    const escaped = urlPattern.replace(/[.+^${}()|[\]\\?]/g, "\\$&");
    const source = escaped
      .replace(/:(\w+)/g, (_m, k: string) => {
        keys.push(k);
        return "([^/]+)";
      })
      .replace(/\*/g, ".*");
    return { method: method.toUpperCase(), pattern: new RegExp(`^${source}$`), keys };
  };

  const impl: FetchMock = {
    on(route, handler) {
      const { method, pattern, keys } = parse(route);
      routes.push({ method, pattern, keys, handler });
      return impl;
    },

    install() {
      if (original) throw new Error("FetchMock already installed");
      original = globalThis.fetch;
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> => {
        const req = input instanceof Request ? input : new Request(input, init);
        const body = req.body ? await req.clone().text() : null;
        const headers: Record<string, string> = {};
        req.headers.forEach((v, k) => {
          headers[k] = v;
        });
        const call: FetchCall = {
          method: req.method.toUpperCase(),
          url: req.url,
          headers,
          body,
        };
        calls.push(call);

        for (const route of routes) {
          if (route.method !== call.method) continue;
          if (route.pattern.test(call.url)) {
            return route.handler(req, call);
          }
        }

        unmatched.push(call);
        return new Response(
          JSON.stringify({ error: "no_route", call }),
          { status: 599, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;
    },

    restore() {
      if (original) {
        globalThis.fetch = original;
        original = undefined;
      }
    },

    calls,
    unmatched: () => unmatched,
  };

  return impl;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}
