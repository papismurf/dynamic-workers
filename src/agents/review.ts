/**
 * Review Agent — performs code review, identifies bugs, suggests improvements.
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
    list(dir: string): Promise<string[]>;
  };
  GIT: {
    diff(base?: string): Promise<string>;
    log(count?: number): Promise<Array<{ sha: string; message: string; author: string }>>;
  };
  LLM: {
    chat(params: {
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
      maxTokens?: number;
      temperature?: number;
    }): Promise<{ content: string; inputTokens: number; outputTokens: number; model: string }>;
  };
  SEARCH: {
    grep(pattern: string, options?: { glob?: string }): Promise<Array<{ file: string; line: number; content: string }>>;
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

interface ReviewComment {
  file: string;
  line: number;
  severity: "info" | "warning" | "error";
  message: string;
  suggestion?: string;
}

export class ReviewAgent extends WorkerEntrypoint {
  declare env: AgentEnv;

  async run(): Promise<string> {
    const { description, files, targetFiles } = this.env.CONFIG;
    const startTime = Date.now();

    console.log(`[review] Starting: ${description}`);

    const diff = await this.env.GIT.diff();
    const sourceFiles: Record<string, string> = {};
    for (const file of targetFiles) {
      try {
        sourceFiles[file] = files[file] ?? (await this.env.FS.read(file));
      } catch {
        console.warn(`[review] Could not read ${file}`);
      }
    }

    const pastFeedback = await this.env.MEMORY.get("review-patterns");

    const systemPrompt = [
      "You are a senior code reviewer. Analyze the code for:",
      "1. Bugs and logic errors",
      "2. Security vulnerabilities (injection, auth issues, data exposure)",
      "3. Performance problems (N+1 queries, unnecessary allocations, blocking ops)",
      "4. Code quality (naming, structure, duplication, complexity)",
      "5. Missing error handling",
      "6. Type safety issues",
      "",
      "Return your review as a JSON array of comments:",
      '```json',
      '[',
      '  {',
      '    "file": "path/to/file.ts",',
      '    "line": 42,',
      '    "severity": "error",',
      '    "message": "Description of the issue",',
      '    "suggestion": "Optional code fix"',
      '  }',
      ']',
      '```',
      "",
      "Severity levels:",
      "- error: Bugs, security issues, or breaking problems",
      "- warning: Performance issues, potential problems, or bad patterns",
      "- info: Style improvements, suggestions, or minor enhancements",
      pastFeedback ? `\nKnown patterns from past reviews:\n${pastFeedback}` : "",
    ].join("\n");

    const sourceContext = Object.entries(sourceFiles)
      .map(([path, code]) => {
        const numbered = code
          .split("\n")
          .map((line, i) => `${i + 1}: ${line}`)
          .join("\n");
        return `--- ${path} ---\n${numbered}`;
      })
      .join("\n\n");

    const userPrompt = [
      `Task: ${description}`,
      diff ? `\nDiff to review:\n${diff}` : "",
      `\nFull source files:\n${sourceContext}`,
    ]
      .filter(Boolean)
      .join("\n");

    const response = await this.env.LLM.chat({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      maxTokens: 4096,
      temperature: 0,
    });

    const comments = parseReviewComments(response.content);
    const severity = categorizeSeverity(comments);

    console.log(
      `[review] Found ${comments.length} issues: ${severity.errors} errors, ${severity.warnings} warnings, ${severity.infos} info`
    );

    if (comments.length > 0) {
      const patterns = comments
        .filter((c) => c.severity === "error")
        .map((c) => c.message)
        .slice(0, 10)
        .join("\n");
      if (patterns) {
        await this.env.MEMORY.set("review-patterns", patterns);
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(`[review] Complete in ${durationMs}ms`);

    return JSON.stringify({
      success: true,
      files: {},
      summary: `Code review: ${comments.length} comments (${severity.errors} errors, ${severity.warnings} warnings, ${severity.infos} info)`,
      reviewComments: comments,
      overallAssessment: severity.errors > 0 ? "changes_requested" : "approved",
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
}

function parseReviewComments(content: string): ReviewComment[] {
  const jsonMatch = content.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  if (!jsonMatch?.[1]) return [];

  try {
    const parsed = JSON.parse(jsonMatch[1]);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c: unknown): c is ReviewComment =>
        typeof c === "object" &&
        c !== null &&
        "file" in c &&
        "message" in c &&
        "severity" in c
    );
  } catch {
    return [];
  }
}

function categorizeSeverity(comments: ReviewComment[]) {
  return {
    errors: comments.filter((c) => c.severity === "error").length,
    warnings: comments.filter((c) => c.severity === "warning").length,
    infos: comments.filter((c) => c.severity === "info").length,
  };
}

function estimateCost(input: number, output: number): number {
  return (input * 3 + output * 15) / 1_000_000;
}

export default {
  async fetch(_request: Request): Promise<Response> {
    return new Response("Review agent — use the run() entrypoint", {
      status: 200,
    });
  },
};
