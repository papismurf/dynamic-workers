/**
 * FileSystem binding tests. Every method hits the GitHub Contents API via
 * fetch; we assert on the method, path, headers, and body shape.
 */
import { FileSystem } from "./filesystem.js";
import {
  createFetchMock,
  jsonResponse,
} from "../../tests/helpers/fetch.js";

function makeFs() {
  return new FileSystem(
    {
      props: {
        owner: "acme",
        repo: "api",
        branch: "main",
        githubPat: "ghp_xxx",
      },
      storage: undefined,
    } as never,
    {} as never
  );
}

function b64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

describe("FileSystem.read", () => {
  it("decodes base64 content from the GitHub contents endpoint", async () => {
    const fx = createFetchMock().on(
      "GET https://api.github.com/repos/acme/api/contents/src/index.ts*",
      () =>
        jsonResponse({ content: b64("export const x = 1;\n"), encoding: "base64" })
    );
    fx.install();
    try {
      const fs = makeFs();
      expect(await fs.read("src/index.ts")).toBe("export const x = 1;\n");
    } finally {
      fx.restore();
    }
  });

  it("throws on unexpected encoding", async () => {
    const fx = createFetchMock().on(
      "GET https://api.github.com/repos/acme/api/contents/*",
      () => jsonResponse({ content: "raw", encoding: "utf8" })
    );
    fx.install();
    try {
      await expect(makeFs().read("x")).rejects.toThrow(/encoding/);
    } finally {
      fx.restore();
    }
  });

  it("throws with status info on non-ok", async () => {
    const fx = createFetchMock().on(
      "GET https://api.github.com/repos/acme/api/contents/*",
      () => jsonResponse({ message: "Not Found" }, 404)
    );
    fx.install();
    try {
      await expect(makeFs().read("missing.ts")).rejects.toThrow(/404/);
    } finally {
      fx.restore();
    }
  });
});

describe("FileSystem.write", () => {
  it("PUTs with sha when the file exists", async () => {
    let sawSha: string | undefined;
    const fx = createFetchMock()
      .on(
        "GET https://api.github.com/repos/acme/api/contents/x.ts*",
        () => jsonResponse({ sha: "abc123", content: "", encoding: "base64" })
      )
      .on(
        "PUT https://api.github.com/repos/acme/api/contents/x.ts*",
        (_req, call) => {
          const body = JSON.parse(call.body ?? "{}") as {
            sha?: string;
            content: string;
          };
          sawSha = body.sha;
          expect(body.content).toBe(b64("new\n"));
          return jsonResponse({ content: { sha: "new-sha" } });
        }
      );
    fx.install();
    try {
      await makeFs().write("x.ts", "new\n");
      expect(sawSha).toBe("abc123");
    } finally {
      fx.restore();
    }
  });

  it("creates a new file when no sha is returned (404)", async () => {
    const fx = createFetchMock()
      .on(
        "GET https://api.github.com/repos/acme/api/contents/new.ts*",
        () => jsonResponse({ message: "Not Found" }, 404)
      )
      .on(
        "PUT https://api.github.com/repos/acme/api/contents/new.ts*",
        (_req, call) => {
          const body = JSON.parse(call.body ?? "{}") as { sha?: string };
          expect(body.sha).toBeUndefined();
          return jsonResponse({ content: { sha: "first" } });
        }
      );
    fx.install();
    try {
      await makeFs().write("new.ts", "first\n");
    } finally {
      fx.restore();
    }
  });
});

describe("FileSystem.list / exists / readJson / delete", () => {
  it("list returns paths (dirs suffixed with slash)", async () => {
    const fx = createFetchMock().on(
      "GET https://api.github.com/repos/acme/api/contents/src*",
      () =>
        jsonResponse([
          { name: "index.ts", type: "file", path: "src/index.ts" },
          { name: "utils", type: "dir", path: "src/utils" },
        ])
    );
    fx.install();
    try {
      const out = await makeFs().list("src");
      expect(out).toEqual(["src/index.ts", "src/utils/"]);
    } finally {
      fx.restore();
    }
  });

  it("list returns [] on 404", async () => {
    const fx = createFetchMock().on(
      "GET https://api.github.com/repos/acme/api/contents/nope*",
      () => jsonResponse({}, 404)
    );
    fx.install();
    try {
      expect(await makeFs().list("nope")).toEqual([]);
    } finally {
      fx.restore();
    }
  });

  it("exists uses HEAD and maps status to boolean", async () => {
    const fx = createFetchMock()
      .on(
        "HEAD https://api.github.com/repos/acme/api/contents/exists.ts*",
        () => new Response(null, { status: 200 })
      )
      .on(
        "HEAD https://api.github.com/repos/acme/api/contents/missing.ts*",
        () => new Response(null, { status: 404 })
      );
    fx.install();
    try {
      expect(await makeFs().exists("exists.ts")).toBe(true);
      expect(await makeFs().exists("missing.ts")).toBe(false);
    } finally {
      fx.restore();
    }
  });

  it("readJson parses the decoded content", async () => {
    const fx = createFetchMock().on(
      "GET https://api.github.com/repos/acme/api/contents/config.json*",
      () =>
        jsonResponse({
          content: b64(JSON.stringify({ name: "x", version: "1.0.0" })),
          encoding: "base64",
        })
    );
    fx.install();
    try {
      const data = await makeFs().readJson<{ name: string }>("config.json");
      expect(data.name).toBe("x");
    } finally {
      fx.restore();
    }
  });

  it("delete fails when sha cannot be fetched", async () => {
    const fx = createFetchMock().on(
      "GET https://api.github.com/repos/acme/api/contents/*",
      () => jsonResponse({ message: "Not Found" }, 404)
    );
    fx.install();
    try {
      await expect(makeFs().delete("gone.ts")).rejects.toThrow(/not found/);
    } finally {
      fx.restore();
    }
  });
});
