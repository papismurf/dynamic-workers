/**
 * Unit tests for the in-process agent runners (the no-Cloudflare execution
 * path). Runners are driven with fake `llm` + `fs` capability objects so no
 * network or filesystem is touched.
 */
import { jest } from "@jest/globals";
import {
  parseCodeBlocks,
  runCodegenAgent,
  runTestAgent,
  runReviewAgent,
  getRunner,
  type AgentContext,
  type AgentFs,
} from "./runners.js";
import type { ChatParams, ChatResponse } from "../providers/llm/types.js";

function fakeFs(seed: Record<string, string> = {}): AgentFs & { store: Map<string, string> } {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async read(path) {
      const v = store.get(path);
      if (v === undefined) throw new Error(`not found: ${path}`);
      return v;
    },
    async write(path, content) {
      store.set(path, content);
    },
    async exists(path) {
      return store.has(path);
    },
  };
}

function ctxWith(
  content: string,
  over: Partial<AgentContext> = {}
): AgentContext {
  const resp: ChatResponse = {
    content,
    inputTokens: 100,
    outputTokens: 200,
    model: "gpt-4o",
  };
  return {
    taskId: "t1",
    description: "do a thing",
    files: {},
    targetFiles: [],
    context: {},
    model: "gpt-4o",
    llm: { chat: (_p: ChatParams) => Promise.resolve(resp) },
    fs: fakeFs(),
    log: () => {},
    ...over,
  };
}

describe("parseCodeBlocks", () => {
  it("extracts filepath-tagged code blocks", () => {
    const files = parseCodeBlocks(
      "text\n```filepath:src/a.ts\nconst a = 1;\n```\nmore\n```filepath:src/b.ts\nconst b = 2;\n```"
    );
    expect(Object.keys(files)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(files["src/a.ts"]).toBe("const a = 1;");
  });

  it("accepts a bare path without the filepath: prefix", () => {
    const files = parseCodeBlocks("```src/c.ts\nconst c = 3;\n```");
    expect(files["src/c.ts"]).toBe("const c = 3;");
  });

  it("ignores blocks whose 'path' contains spaces (e.g. language fences)", () => {
    const files = parseCodeBlocks("```ts title here\ncode\n```");
    expect(files).toEqual({});
  });

  it("ignores empty blocks", () => {
    expect(parseCodeBlocks("```src/x.ts\n\n```")).toEqual({});
  });
});

describe("runCodegenAgent", () => {
  it("writes generated files and reports cost + success", async () => {
    const fs = fakeFs();
    const ctx = ctxWith("```filepath:src/sum.ts\nexport const sum = 1;\n```", { fs });
    const res = await runCodegenAgent(ctx);
    expect(res.success).toBe(true);
    expect(res.output.files["src/sum.ts"]).toContain("export const sum");
    expect(fs.store.get("src/sum.ts")).toContain("export const sum");
    expect(res.cost.totalTokens).toBe(300);
    expect(res.cost.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("fails (without throwing) when the model returns no code", async () => {
    const res = await runCodegenAgent(ctxWith("sorry, no code"));
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no code output/);
  });

  it("loads existing sources from ctx.files and from fs, tolerating missing files", async () => {
    const chat = jest.fn((_p: ChatParams) =>
      Promise.resolve<ChatResponse>({
        content: "```filepath:out.ts\nx\n```",
        inputTokens: 1,
        outputTokens: 1,
        model: "gpt-4o",
      })
    );
    const ctx = ctxWith("", {
      files: { "inline.ts": "inline content" },
      targetFiles: ["inline.ts", "on-disk.ts", "missing.ts"],
      fs: fakeFs({ "on-disk.ts": "disk content" }),
      llm: { chat },
    });
    const res = await runCodegenAgent(ctx);
    expect(res.success).toBe(true);
    // Both the inline and on-disk sources should appear in the prompt.
    const userMsg = chat.mock.calls[0]![0].messages[1]!.content;
    expect(userMsg).toContain("inline content");
    expect(userMsg).toContain("disk content");
    expect(userMsg).not.toContain("missing.ts content");
  });
});

describe("runTestAgent", () => {
  it("writes test files and marks them passed", async () => {
    const res = await runTestAgent(
      ctxWith("```filepath:a.test.ts\ntest('x', ()=>{});\n```")
    );
    expect(res.success).toBe(true);
    expect(res.output.testResults).toEqual([
      { name: "a.test.ts", passed: true, durationMs: 0 },
    ]);
  });

  it("fails when the model returns no test files", async () => {
    const res = await runTestAgent(ctxWith("no tests"));
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no test files/);
  });
});

describe("runReviewAgent", () => {
  it("parses a JSON review block and counts errors", async () => {
    const review = JSON.stringify([
      { file: "a.ts", line: 1, severity: "error", message: "bug", suggestion: "fix" },
      { file: "a.ts", line: 2, severity: "warning", message: "slow" },
      { severity: "info" }, // dropped: missing file + message
    ]);
    const res = await runReviewAgent(ctxWith("```json\n" + review + "\n```"));
    expect(res.success).toBe(true);
    expect(res.output.reviewComments).toHaveLength(2);
    expect(res.output.summary).toContain("1 errors");
  });

  it("treats non-JSON review output as zero comments", async () => {
    const res = await runReviewAgent(ctxWith("```json\nnot json{\n```"));
    expect(res.success).toBe(true);
    expect(res.output.reviewComments).toEqual([]);
  });

  it("treats a non-array JSON payload as zero comments", async () => {
    const res = await runReviewAgent(ctxWith('```json\n{"file":"a"}\n```'));
    expect(res.output.reviewComments).toEqual([]);
  });

  it("handles output with no code block at all", async () => {
    const res = await runReviewAgent(ctxWith("looks good to me"));
    expect(res.output.reviewComments).toEqual([]);
  });
});

describe("getRunner", () => {
  it("maps agent types to the right runner (codegen is the default)", () => {
    expect(getRunner("test")).toBe(runTestAgent);
    expect(getRunner("review")).toBe(runReviewAgent);
    expect(getRunner("codegen")).toBe(runCodegenAgent);
    expect(getRunner("debug")).toBe(runCodegenAgent);
  });
});
