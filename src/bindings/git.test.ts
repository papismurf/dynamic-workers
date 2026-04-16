/**
 * Git binding tests. The commit path chains four GitHub API calls
 * (ref → commit → tree → commit → updateRef); tests verify the chain
 * wires shas correctly without re-deriving the real API shape.
 */
import { Git } from "./git.js";
import {
  createFetchMock,
  jsonResponse,
} from "../../tests/helpers/fetch.js";

function makeGit() {
  return new Git(
    {
      props: {
        owner: "acme",
        repo: "api",
        branch: "agent/x",
        baseBranch: "main",
        githubPat: "ghp_xxx",
      },
      storage: undefined,
    } as never,
    {} as never
  );
}

describe("Git.diff", () => {
  it("returns combined per-file patch output", async () => {
    const fx = createFetchMock().on(
      "GET https://api.github.com/repos/acme/api/compare/main...agent/x",
      () =>
        jsonResponse({
          files: [
            { filename: "a.ts", patch: "@@ -1 +1 @@\n-a\n+b" },
            { filename: "bin.png" /* no patch */ },
          ],
        })
    );
    fx.install();
    try {
      const diff = await makeGit().diff();
      expect(diff).toContain("--- a.ts");
      expect(diff).toContain("--- bin.png\n(binary)");
    } finally {
      fx.restore();
    }
  });

  it("returns empty string on 404", async () => {
    const fx = createFetchMock().on(
      "GET https://api.github.com/repos/acme/api/compare/*",
      () => jsonResponse({}, 404)
    );
    fx.install();
    try {
      expect(await makeGit().diff()).toBe("");
    } finally {
      fx.restore();
    }
  });
});

describe("Git.commit", () => {
  it("chains ref → tree → commit → updateRef and returns the new sha", async () => {
    const fx = createFetchMock()
      .on(
        "GET https://api.github.com/repos/acme/api/git/ref/heads/agent/x",
        () => jsonResponse({ object: { sha: "BRANCH_SHA" } })
      )
      .on(
        "GET https://api.github.com/repos/acme/api/git/commits/BRANCH_SHA",
        () => jsonResponse({ tree: { sha: "BASE_TREE" } })
      )
      .on("POST https://api.github.com/repos/acme/api/git/trees", (_req, call) => {
        const body = JSON.parse(call.body ?? "{}") as {
          base_tree: string;
          tree: Array<{ path: string; content: string }>;
        };
        expect(body.base_tree).toBe("BASE_TREE");
        expect(body.tree.map((t) => t.path)).toEqual(["a.ts"]);
        return jsonResponse({ sha: "NEW_TREE" });
      })
      .on(
        "POST https://api.github.com/repos/acme/api/git/commits",
        (_req, call) => {
          const body = JSON.parse(call.body ?? "{}") as {
            message: string;
            tree: string;
            parents: string[];
          };
          expect(body.tree).toBe("NEW_TREE");
          expect(body.parents).toEqual(["BRANCH_SHA"]);
          expect(body.message).toBe("feat: add a");
          return jsonResponse({ sha: "NEW_COMMIT" });
        }
      )
      .on(
        "PATCH https://api.github.com/repos/acme/api/git/refs/heads/agent/x",
        (_req, call) => {
          const body = JSON.parse(call.body ?? "{}") as { sha: string };
          expect(body.sha).toBe("NEW_COMMIT");
          return jsonResponse({});
        }
      );
    fx.install();
    try {
      const sha = await makeGit().commit("feat: add a", { "a.ts": "x" });
      expect(sha).toBe("NEW_COMMIT");
    } finally {
      fx.restore();
    }
  });
});

describe("Git.branch", () => {
  it("creates a branch from baseBranch sha", async () => {
    let createdRef: string | undefined;
    const fx = createFetchMock()
      .on(
        "GET https://api.github.com/repos/acme/api/git/ref/heads/main",
        () => jsonResponse({ object: { sha: "BASE" } })
      )
      .on(
        "POST https://api.github.com/repos/acme/api/git/refs",
        (_req, call) => {
          const body = JSON.parse(call.body ?? "{}") as { ref: string; sha: string };
          createdRef = body.ref;
          expect(body.sha).toBe("BASE");
          return jsonResponse({});
        }
      );
    fx.install();
    try {
      await makeGit().branch("agent/new");
      expect(createdRef).toBe("refs/heads/agent/new");
    } finally {
      fx.restore();
    }
  });

  it("swallows 422 (branch already exists)", async () => {
    const fx = createFetchMock()
      .on(
        "GET https://api.github.com/repos/acme/api/git/ref/heads/main",
        () => jsonResponse({ object: { sha: "BASE" } })
      )
      .on(
        "POST https://api.github.com/repos/acme/api/git/refs",
        () => jsonResponse({ message: "Reference already exists" }, 422)
      );
    fx.install();
    try {
      await expect(makeGit().branch("agent/dup")).resolves.toBeUndefined();
    } finally {
      fx.restore();
    }
  });
});

describe("Git.status / log / createPullRequest / push", () => {
  it("log returns the latest n commits", async () => {
    const fx = createFetchMock().on(
      "GET https://api.github.com/repos/acme/api/commits*",
      () =>
        jsonResponse([
          { sha: "s1", commit: { message: "a", author: { name: "Alice" } } },
          { sha: "s2", commit: { message: "b", author: { name: "Bob" } } },
        ])
    );
    fx.install();
    try {
      const entries = await makeGit().log(2);
      expect(entries).toEqual([
        { sha: "s1", message: "a", author: "Alice" },
        { sha: "s2", message: "b", author: "Bob" },
      ]);
    } finally {
      fx.restore();
    }
  });

  it("status maps the compare response", async () => {
    const fx = createFetchMock().on(
      "GET https://api.github.com/repos/acme/api/compare/main...agent/x",
      () =>
        jsonResponse({
          files: [
            { filename: "a.ts", status: "modified" },
            { filename: "b.ts", status: "added" },
          ],
        })
    );
    fx.install();
    try {
      const rows = await makeGit().status();
      expect(rows).toEqual([
        { file: "a.ts", status: "modified" },
        { file: "b.ts", status: "added" },
      ]);
    } finally {
      fx.restore();
    }
  });

  it("createPullRequest returns html_url on success", async () => {
    const fx = createFetchMock().on(
      "POST https://api.github.com/repos/acme/api/pulls",
      () => jsonResponse({ html_url: "https://github.com/acme/api/pull/42" })
    );
    fx.install();
    try {
      const url = await makeGit().createPullRequest("t", "b");
      expect(url).toBe("https://github.com/acme/api/pull/42");
    } finally {
      fx.restore();
    }
  });

  it("push is a noop (GitHub API creates are already remote)", async () => {
    await expect(makeGit().push()).resolves.toBeUndefined();
  });
});
