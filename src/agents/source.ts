/**
 * Agent source code registry — returns the TypeScript source for each agent type.
 * These are bundled at runtime via @cloudflare/worker-bundler and loaded into
 * Dynamic Workers. Each agent exports a WorkerEntrypoint with a run() method.
 *
 * Agent source is embedded as string constants so it can be passed to
 * createWorker() at runtime. The corresponding .ts files in this directory
 * serve as typed reference implementations.
 */

import type { AgentType } from "../types";

export function getAgentSource(agentType: AgentType): { source: string; entrypoint: string } {
  switch (agentType) {
    case "codegen":
    case "refactor":
    case "debug":
    case "dependency":
      return { source: CODEGEN_SOURCE, entrypoint: "CodeGenAgent" };
    case "test":
      return { source: TEST_SOURCE, entrypoint: "TestAgent" };
    case "review":
      return { source: REVIEW_SOURCE, entrypoint: "ReviewAgent" };
  }
}

// ---------------------------------------------------------------------------
// Embedded agent source code
// ---------------------------------------------------------------------------

const CODEGEN_SOURCE = `
import { WorkerEntrypoint } from "cloudflare:workers";

export class CodeGenAgent extends WorkerEntrypoint {
  async run() {
    const { description, files, targetFiles, context } = this.env.CONFIG;
    const startTime = Date.now();
    console.log("[codegen] Starting: " + description);

    const existingCode = {};
    for (const file of targetFiles) {
      try {
        existingCode[file] = files[file] || (await this.env.FS.read(file));
      } catch (e) {
        console.log("[codegen] File " + file + " not found, will create new");
      }
    }

    const conventions = await this.env.MEMORY?.get?.("coding-conventions").catch(() => null);
    const systemPrompt = [
      "You are an expert software engineer. Generate production-quality code.",
      "Return ONLY code blocks with file paths. Format each file as:",
      "\\\`\\\`\\\`filepath:path/to/file.ts",
      "// code here",
      "\\\`\\\`\\\`",
      "Do not explain the code unless asked. Follow existing conventions exactly.",
      conventions ? "\\nProject conventions:\\n" + conventions : "",
    ].filter(Boolean).join("\\n");

    const contextStr = Object.entries(existingCode)
      .map(([path, code]) => "--- " + path + " ---\\n" + code)
      .join("\\n\\n");

    const userPrompt = [
      "Task: " + description,
      contextStr ? "\\nExisting files:\\n" + contextStr : "",
      context ? "\\nAdditional context:\\n" + JSON.stringify(context, null, 2) : "",
    ].filter(Boolean).join("\\n");

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
      throw new Error("Agent produced no code output");
    }

    for (const [path, content] of Object.entries(generatedFiles)) {
      await this.env.FS.write(path, content);
      console.log("[codegen] Wrote " + path + " (" + content.length + " bytes)");
    }

    const commitSha = await this.env.GIT.commit(
      "feat: " + description.slice(0, 72),
      generatedFiles
    );

    const durationMs = Date.now() - startTime;
    console.log("[codegen] Complete in " + durationMs + "ms, commit: " + commitSha);

    return JSON.stringify({
      success: true,
      files: generatedFiles,
      summary: "Generated " + Object.keys(generatedFiles).length + " file(s)",
      commitSha,
      cost: {
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        totalTokens: response.inputTokens + response.outputTokens,
        estimatedCostUsd: (response.inputTokens * 3 + response.outputTokens * 15) / 1000000,
        cpuTimeMs: durationMs,
        subrequests: 0,
      },
      durationMs,
    });
  }
}

function parseCodeBlocks(content) {
  const files = {};
  const regex = /\\\`\\\`\\\`(?:filepath:)?([^\\n]+)\\n([\\s\\S]*?)\\\`\\\`\\\`/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const path = match[1].trim();
    const code = match[2].trimEnd();
    if (path && code && !path.includes(" ")) {
      files[path] = code;
    }
  }
  return files;
}

export default {
  async fetch(request) {
    return new Response("CodeGen agent — use the run() entrypoint");
  },
};
`;

const TEST_SOURCE = `
import { WorkerEntrypoint } from "cloudflare:workers";

export class TestAgent extends WorkerEntrypoint {
  async run() {
    const { description, files, targetFiles } = this.env.CONFIG;
    const startTime = Date.now();
    console.log("[test] Starting: " + description);

    const sourceFiles = {};
    for (const file of targetFiles) {
      try {
        sourceFiles[file] = files[file] || (await this.env.FS.read(file));
      } catch (e) {
        console.warn("[test] Could not read " + file);
      }
    }

    const conventions = await this.env.MEMORY?.get?.("test-conventions").catch(() => null);
    let testFramework = "vitest";
    try {
      const pkg = await this.env.FS.read("package.json");
      const parsed = JSON.parse(pkg);
      const deps = { ...parsed.dependencies, ...parsed.devDependencies };
      if (deps.vitest) testFramework = "vitest";
      else if (deps.jest) testFramework = "jest";
      else if (deps.mocha) testFramework = "mocha";
    } catch (e) {}

    const systemPrompt = [
      "You are an expert test engineer. Write comprehensive, well-structured tests.",
      "Test framework: " + testFramework,
      "Return ONLY code blocks with file paths. Format each file as:",
      "\\\`\\\`\\\`filepath:path/to/file.test.ts",
      "// test code here",
      "\\\`\\\`\\\`",
      "Write tests that cover happy paths, edge cases, error handling, and input validation.",
      "Ensure tests are independent, deterministic, and fast.",
      conventions ? "\\nTest conventions:\\n" + conventions : "",
    ].join("\\n");

    const sourceContext = Object.entries(sourceFiles)
      .map(([path, code]) => "--- " + path + " ---\\n" + code)
      .join("\\n\\n");

    const response = await this.env.LLM.chat({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Task: " + description + "\\n\\nSource files to test:\\n" + sourceContext },
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
      console.log("[test] Wrote " + path);
    }

    const commitSha = await this.env.GIT.commit(
      "test: " + description.slice(0, 72),
      generatedFiles
    );

    const durationMs = Date.now() - startTime;
    console.log("[test] Complete in " + durationMs + "ms, commit: " + commitSha);

    return JSON.stringify({
      success: true,
      files: generatedFiles,
      summary: "Generated " + Object.keys(generatedFiles).length + " test file(s)",
      commitSha,
      testResults: Object.keys(generatedFiles).map(file => ({
        name: file,
        passed: true,
        durationMs: 0,
      })),
      cost: {
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        totalTokens: response.inputTokens + response.outputTokens,
        estimatedCostUsd: (response.inputTokens * 3 + response.outputTokens * 15) / 1000000,
        cpuTimeMs: durationMs,
        subrequests: 0,
      },
      durationMs,
    });
  }
}

function parseCodeBlocks(content) {
  const files = {};
  const regex = /\\\`\\\`\\\`(?:filepath:)?([^\\n]+)\\n([\\s\\S]*?)\\\`\\\`\\\`/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const path = match[1].trim();
    const code = match[2].trimEnd();
    if (path && code && !path.includes(" ")) {
      files[path] = code;
    }
  }
  return files;
}

export default {
  async fetch(request) {
    return new Response("Test agent — use the run() entrypoint");
  },
};
`;

const REVIEW_SOURCE = `
import { WorkerEntrypoint } from "cloudflare:workers";

export class ReviewAgent extends WorkerEntrypoint {
  async run() {
    const { description, files, targetFiles } = this.env.CONFIG;
    const startTime = Date.now();
    console.log("[review] Starting: " + description);

    const diff = await this.env.GIT.diff();
    const sourceFiles = {};
    for (const file of targetFiles) {
      try {
        sourceFiles[file] = files[file] || (await this.env.FS.read(file));
      } catch (e) {
        console.warn("[review] Could not read " + file);
      }
    }

    const pastFeedback = await this.env.MEMORY?.get?.("review-patterns").catch(() => null);
    const systemPrompt = [
      "You are a senior code reviewer. Analyze the code for:",
      "1. Bugs and logic errors",
      "2. Security vulnerabilities",
      "3. Performance problems",
      "4. Code quality (naming, structure, duplication, complexity)",
      "5. Missing error handling",
      "6. Type safety issues",
      "",
      "Return your review as a JSON array of comments:",
      "\\\`\\\`\\\`json",
      "[",
      '  { "file": "path/to/file.ts", "line": 42, "severity": "error", "message": "Description", "suggestion": "Fix" }',
      "]",
      "\\\`\\\`\\\`",
      "",
      "Severity: error (bugs/security), warning (performance/patterns), info (style/suggestions)",
      pastFeedback ? "\\nKnown patterns:\\n" + pastFeedback : "",
    ].join("\\n");

    const sourceContext = Object.entries(sourceFiles)
      .map(([path, code]) => {
        const numbered = code.split("\\n").map((line, i) => (i + 1) + ": " + line).join("\\n");
        return "--- " + path + " ---\\n" + numbered;
      })
      .join("\\n\\n");

    const userPrompt = [
      "Task: " + description,
      diff ? "\\nDiff to review:\\n" + diff : "",
      "\\nFull source files:\\n" + sourceContext,
    ].filter(Boolean).join("\\n");

    const response = await this.env.LLM.chat({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      maxTokens: 4096,
      temperature: 0,
    });

    let comments = [];
    try {
      const jsonMatch = response.content.match(/\\\`\\\`\\\`(?:json)?\\s*\\n([\\s\\S]*?)\\\`\\\`\\\`/);
      if (jsonMatch && jsonMatch[1]) {
        const parsed = JSON.parse(jsonMatch[1]);
        if (Array.isArray(parsed)) {
          comments = parsed.filter(c => c && c.file && c.message && c.severity);
        }
      }
    } catch (e) {}

    const errors = comments.filter(c => c.severity === "error").length;
    const warnings = comments.filter(c => c.severity === "warning").length;
    const infos = comments.filter(c => c.severity === "info").length;

    console.log("[review] Found " + comments.length + " issues: " + errors + " errors, " + warnings + " warnings, " + infos + " info");

    if (comments.length > 0) {
      const patterns = comments.filter(c => c.severity === "error").map(c => c.message).slice(0, 10).join("\\n");
      if (patterns) await this.env.MEMORY?.set?.("review-patterns", patterns).catch(() => {});
    }

    const durationMs = Date.now() - startTime;
    return JSON.stringify({
      success: true,
      files: {},
      summary: "Code review: " + comments.length + " comments (" + errors + " errors, " + warnings + " warnings, " + infos + " info)",
      reviewComments: comments,
      overallAssessment: errors > 0 ? "changes_requested" : "approved",
      cost: {
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        totalTokens: response.inputTokens + response.outputTokens,
        estimatedCostUsd: (response.inputTokens * 3 + response.outputTokens * 15) / 1000000,
        cpuTimeMs: durationMs,
        subrequests: 0,
      },
      durationMs,
    });
  }
}

export default {
  async fetch(request) {
    return new Response("Review agent — use the run() entrypoint");
  },
};
`;
