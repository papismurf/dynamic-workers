/**
 * CodeSearch binding tests. Covers grep pattern assembly, glob-to-regex for
 * findFiles, and symbol extraction per language.
 */
import { CodeSearch } from "./search.js";
import {
  createFetchMock,
  jsonResponse,
} from "../../tests/helpers/fetch.js";

function makeSearch() {
  return new CodeSearch(
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

describe("CodeSearch.grep", () => {
  it("builds a repo-scoped query and returns per-line hits", async () => {
    const fx = createFetchMock().on(
      "GET https://api.github.com/search/code*",
      (_req, call) => {
        expect(call.url).toContain(encodeURIComponent("foo repo:acme/api"));
        return jsonResponse({
          items: [
            {
              path: "src/a.ts",
              text_matches: [
                {
                  fragment: "line1\nhas foo here\nline3",
                  matches: [{ text: "foo", indices: [4, 7] }],
                },
              ],
            },
          ],
        });
      }
    );
    fx.install();
    try {
      const hits = await makeSearch().grep("foo");
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({ file: "src/a.ts", content: "has foo here" });
    } finally {
      fx.restore();
    }
  });

  it("appends path: filter when glob is provided", async () => {
    const fx = createFetchMock().on(
      "GET https://api.github.com/search/code*",
      (_req, call) => {
        expect(call.url).toContain(encodeURIComponent("path:src/**"));
        return jsonResponse({ items: [] });
      }
    );
    fx.install();
    try {
      await makeSearch().grep("x", { glob: "src/**" });
    } finally {
      fx.restore();
    }
  });

  it("throws on non-ok", async () => {
    const fx = createFetchMock().on(
      "GET https://api.github.com/search/code*",
      () => jsonResponse({}, 403)
    );
    fx.install();
    try {
      await expect(makeSearch().grep("x")).rejects.toThrow(/403/);
    } finally {
      fx.restore();
    }
  });
});

describe("CodeSearch.findFiles", () => {
  it("filters the recursive tree by glob pattern", async () => {
    const fx = createFetchMock().on(
      "GET https://api.github.com/repos/acme/api/git/trees/main*",
      () =>
        jsonResponse({
          tree: [
            { path: "src/a.ts", type: "blob" },
            { path: "src/b.test.ts", type: "blob" },
            { path: "src/c.md", type: "blob" },
            { path: "src", type: "tree" },
          ],
        })
    );
    fx.install();
    try {
      const files = await makeSearch().findFiles("src/**/*.ts");
      expect(files).toEqual(["src/a.ts", "src/b.test.ts"]);
    } finally {
      fx.restore();
    }
  });
});

describe("CodeSearch.getSymbols", () => {
  it("extracts TS function / class / interface / type / const declarations", async () => {
    const src = [
      "export function add(a: number, b: number): number { return a + b; }",
      "export class Foo {}",
      "export interface IBar {}",
      "export type TBaz = string;",
      "export const answer = 42;",
    ].join("\n");
    const fx = createFetchMock().on(
      "GET https://api.github.com/repos/acme/api/contents/*",
      () => jsonResponse({ content: b64(src), encoding: "base64" })
    );
    fx.install();
    try {
      const symbols = await makeSearch().getSymbols("src/a.ts");
      const kinds = symbols.map((s) => `${s.kind}:${s.name}`);
      expect(kinds).toEqual([
        "function:add",
        "class:Foo",
        "interface:IBar",
        "type:TBaz",
        "const:answer",
      ]);
    } finally {
      fx.restore();
    }
  });

  it("returns [] for unknown file extensions", async () => {
    const fx = createFetchMock().on(
      "GET https://api.github.com/repos/acme/api/contents/*",
      () => jsonResponse({ content: b64("hello"), encoding: "base64" })
    );
    fx.install();
    try {
      expect(await makeSearch().getSymbols("README.md")).toEqual([]);
    } finally {
      fx.restore();
    }
  });
});
