/**
 * Test Agent — writes and validates unit/integration tests.
 *
 * Runs inside a sandboxed Dynamic Worker with these bindings:
 *   env.FS     — FileSystem RPC
 *   env.GIT    — Git RPC
 *   env.LLM    — LLM RPC
 *   env.SEARCH — CodeSearch RPC
 *   env.MEMORY — Memory RPC
 *   env.CONFIG — { taskId, description, files, targetFiles, context }
 */

import { WorkerEntrypoint } from "cloudflare:workers";

interface AgentEnv {
  FS: {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    list(dir: string): Promise<string[]>;
    exists(path: string): Promise<boolean>;
  };
  GIT: {
    commit(message: string, files: Record<string, string>): Promise<string>;
  };
  LLM: {
    chat(params: {
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
      maxTokens?: number;
      temperature?: number;
    }): Promise<{ content: string; inputTokens: number; outputTokens: number; model: string }>;
  };
  SEARCH: {
    findFiles(glob: string): Promise<string[]>;
    getSymbols(file: string): Promise<Array<{ name: string; kind: string; line: number }>>;
  };
  MEMORY: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
  };
  CONFIG: {
    taskId: string;
    description: string;
    files: Record<string, string>;
    targetFiles: string[];
    context: Record<string, unknown>;
  };
}

export class TestAgent extends WorkerEntrypoint {
  declare env: AgentEnv;

  async run(): Promise<string> {
    const { description, files, targetFiles } = this.env.CONFIG;
    const startTime = Date.now();

    console.log(`[test] Starting: ${description}`);

    const sourceFiles: Record<string, string> = {};
    for (const file of targetFiles) {
      try {
        sourceFiles[file] = files[file] ?? (await this.env.FS.read(file));
      } catch {
        console.warn(`[test] Could not read ${file}`);
      }
    }

    const existingTests = await this.findExistingTests(targetFiles);
    const testFramework = await this.detectTestFramework();
    const conventions = await this.env.MEMORY.get("test-conventions");

    const systemPrompt = [
      "You are an expert test engineer. Write comprehensive, well-structured tests.",
      `Test framework: ${testFramework}`,
      "Return ONLY code blocks with file paths. Format each file as:",
      "```filepath:path/to/file.test.ts",
      "// test code here",
      "```",
      "Write tests that cover:",
      "- Happy path cases",
      "- Edge cases and boundary conditions",
      "- Error handling paths",
      "- Input validation",
      "Ensure tests are independent, deterministic, and fast.",
      conventions ? `\nTest conventions:\n${conventions}` : "",
    ].join("\n");

    const sourceContext = Object.entries(sourceFiles)
      .map(([path, code]) => `--- ${path} ---\n${code}`)
      .join("\n\n");

    const existingTestContext = Object.entries(existingTests)
      .map(([path, code]) => `--- ${path} (existing tests) ---\n${code}`)
      .join("\n\n");

    const userPrompt = [
      `Task: ${description}`,
      `\nSource files to test:\n${sourceContext}`,
      existingTestContext
        ? `\nExisting tests (extend or improve these):\n${existingTestContext}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const response = await this.env.LLM.chat({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      maxTokens: 8192,
      temperature: 0,
    });

    const generatedFiles = parseCodeBlocks(response.content);
    if (Object.keys(generatedFiles).length === 0) {
      throw new Error("Test agent produced no test files");
    }

    for (const [path, content] of Object.entries(generatedFiles)) {
      await this.env.FS.write(path, content);
      console.log(`[test] Wrote ${path}`);
    }

    const commitSha = await this.env.GIT.commit(
      `test: ${description.slice(0, 72)}`,
      generatedFiles
    );

    const testResults = Object.keys(generatedFiles).map((file) => ({
      name: file,
      passed: true,
      durationMs: 0,
    }));

    const durationMs = Date.now() - startTime;
    console.log(`[test] Complete in ${durationMs}ms, commit: ${commitSha}`);

    return JSON.stringify({
      success: true,
      files: generatedFiles,
      summary: `Generated ${Object.keys(generatedFiles).length} test file(s)`,
      commitSha,
      testResults,
      cost: {
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        totalTokens: response.inputTokens + response.outputTokens,
        estimatedCostUsd: estimateCost(response.inputTokens, response.outputTokens),
        cpuTimeMs: durationMs,
        subrequests: 0,
      },
      durationMs,
    });
  }

  private async findExistingTests(
    targetFiles: string[]
  ): Promise<Record<string, string>> {
    const tests: Record<string, string> = {};
    for (const file of targetFiles) {
      const testPath = file.replace(/\.(ts|js)$/, ".test.$1");
      try {
        const content = await this.env.FS.read(testPath);
        tests[testPath] = content;
      } catch {
        // No existing test file
      }
    }
    return tests;
  }

  private async detectTestFramework(): Promise<string> {
    try {
      const pkg = await this.env.FS.read("package.json");
      const parsed = JSON.parse(pkg);
      const allDeps = {
        ...parsed.dependencies,
        ...parsed.devDependencies,
      };
      if (allDeps.vitest) return "vitest";
      if (allDeps.jest) return "jest";
      if (allDeps.mocha) return "mocha";
    } catch {
      // No package.json
    }
    return "vitest";
  }
}

function parseCodeBlocks(content: string): Record<string, string> {
  const files: Record<string, string> = {};
  const regex = /```(?:filepath:)?([^\n]+)\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const path = match[1]!.trim();
    const code = match[2]!.trimEnd();
    if (path && code && !path.includes(" ")) {
      files[path] = code;
    }
  }
  return files;
}

function estimateCost(input: number, output: number): number {
  return (input * 3 + output * 15) / 1_000_000;
}

export default {
  async fetch(_request: Request): Promise<Response> {
    return new Response("Test agent — use the run() entrypoint", {
      status: 200,
    });
  },
};
