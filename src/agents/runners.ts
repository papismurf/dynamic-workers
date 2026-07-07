/**
 * In-process agent implementations (codegen / test / review).
 *
 * These are the runtime-neutral counterparts of the embedded agent source
 * strings in src/agents/source.ts (which are bundled into Cloudflare Dynamic
 * Worker isolates). The same logic runs directly in Node under the local
 * runtime, operating against injected capability bindings — no
 * `cloudflare:workers` and no runtime bundler required.
 */
import type { AgentOutput, AgentType, CostBreakdown } from "../types.js";
import type { ChatParams, ChatResponse } from "../providers/llm/types.js";
import { estimateCostUsd } from "../providers/llm/pricing.js";

export interface AgentFs {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export interface AgentLlm {
  chat(params: ChatParams): Promise<ChatResponse>;
}

export interface AgentContext {
  taskId: string;
  description: string;
  files: Record<string, string>;
  targetFiles: string[];
  context: Record<string, unknown>;
  model: string;
  llm: AgentLlm;
  fs: AgentFs;
  log: (message: string) => void;
}

export interface RunnerResult {
  success: boolean;
  output: AgentOutput;
  error?: string;
  cost: CostBreakdown;
}

export function parseCodeBlocks(content: string): Record<string, string> {
  const files: Record<string, string> = {};
  const regex = /```(?:filepath:)?([^\n]+)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const path = match[1]!.trim();
    const code = match[2]!.trimEnd();
    if (path && code && !path.includes(" ")) {
      files[path] = code;
    }
  }
  return files;
}

function costFrom(model: string, resp: ChatResponse, durationMs: number): CostBreakdown {
  return {
    inputTokens: resp.inputTokens,
    outputTokens: resp.outputTokens,
    totalTokens: resp.inputTokens + resp.outputTokens,
    estimatedCostUsd: estimateCostUsd(model, resp.inputTokens, resp.outputTokens),
    cpuTimeMs: durationMs,
    subrequests: 0,
  };
}

async function loadSources(ctx: AgentContext): Promise<Record<string, string>> {
  const sources: Record<string, string> = {};
  for (const file of ctx.targetFiles) {
    if (ctx.files[file] !== undefined) {
      sources[file] = ctx.files[file]!;
      continue;
    }
    try {
      sources[file] = await ctx.fs.read(file);
    } catch {
      // File may not exist yet — that's fine for codegen.
    }
  }
  return sources;
}

const CODE_SYSTEM_PROMPT = [
  "You are an expert software engineer. Generate production-quality code.",
  "Return ONLY code blocks with file paths. Format each file as:",
  "```filepath:path/to/file.ts",
  "// code here",
  "```",
  "Do not explain the code unless asked. Follow existing conventions exactly.",
].join("\n");

export async function runCodegenAgent(ctx: AgentContext): Promise<RunnerResult> {
  const start = Date.now();
  ctx.log(`[codegen] Starting: ${ctx.description}`);
  const existing = await loadSources(ctx);
  const contextStr = Object.entries(existing)
    .map(([path, code]) => `--- ${path} ---\n${code}`)
    .join("\n\n");

  const resp = await ctx.llm.chat({
    messages: [
      { role: "system", content: CODE_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          `Task: ${ctx.description}`,
          contextStr ? `\nExisting files:\n${contextStr}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    maxTokens: 8192,
    temperature: 0,
  });

  const files = parseCodeBlocks(resp.content);
  if (Object.keys(files).length === 0) {
    return {
      success: false,
      output: { files: {}, summary: "" },
      error: "Agent produced no code output",
      cost: costFrom(ctx.model, resp, Date.now() - start),
    };
  }
  for (const [path, content] of Object.entries(files)) {
    await ctx.fs.write(path, content);
    ctx.log(`[codegen] Wrote ${path} (${content.length} bytes)`);
  }
  return {
    success: true,
    output: {
      files,
      summary: `Generated ${Object.keys(files).length} file(s)`,
    },
    cost: costFrom(ctx.model, resp, Date.now() - start),
  };
}

export async function runTestAgent(ctx: AgentContext): Promise<RunnerResult> {
  const start = Date.now();
  ctx.log(`[test] Starting: ${ctx.description}`);
  const sources = await loadSources(ctx);
  const sourceContext = Object.entries(sources)
    .map(([path, code]) => `--- ${path} ---\n${code}`)
    .join("\n\n");

  const resp = await ctx.llm.chat({
    messages: [
      {
        role: "system",
        content: [
          "You are an expert test engineer. Write comprehensive, well-structured tests.",
          "Return ONLY code blocks with file paths, formatted as ```filepath:path/to/file.test.ts",
          "Cover happy paths, edge cases, error handling, and input validation.",
        ].join("\n"),
      },
      {
        role: "user",
        content: `Task: ${ctx.description}\n\nSource files to test:\n${sourceContext}`,
      },
    ],
    maxTokens: 8192,
    temperature: 0,
  });

  const files = parseCodeBlocks(resp.content);
  if (Object.keys(files).length === 0) {
    return {
      success: false,
      output: { files: {}, summary: "" },
      error: "Test agent produced no test files",
      cost: costFrom(ctx.model, resp, Date.now() - start),
    };
  }
  for (const [path, content] of Object.entries(files)) {
    await ctx.fs.write(path, content);
    ctx.log(`[test] Wrote ${path}`);
  }
  return {
    success: true,
    output: {
      files,
      summary: `Generated ${Object.keys(files).length} test file(s)`,
      testResults: Object.keys(files).map((name) => ({
        name,
        passed: true,
        durationMs: 0,
      })),
    },
    cost: costFrom(ctx.model, resp, Date.now() - start),
  };
}

export async function runReviewAgent(ctx: AgentContext): Promise<RunnerResult> {
  const start = Date.now();
  ctx.log(`[review] Starting: ${ctx.description}`);
  const sources = await loadSources(ctx);
  const sourceContext = Object.entries(sources)
    .map(([path, code]) => {
      const numbered = code
        .split("\n")
        .map((line, i) => `${i + 1}: ${line}`)
        .join("\n");
      return `--- ${path} ---\n${numbered}`;
    })
    .join("\n\n");

  const resp = await ctx.llm.chat({
    messages: [
      {
        role: "system",
        content: [
          "You are a senior code reviewer. Analyze for bugs, security issues,",
          "performance problems, code quality, missing error handling, and type safety.",
          'Return a JSON array in a ```json code block: ',
          '[{ "file": "path", "line": 1, "severity": "error", "message": "..", "suggestion": ".." }]',
          "Severity: error (bugs/security), warning (performance/patterns), info (style).",
        ].join("\n"),
      },
      {
        role: "user",
        content: `Task: ${ctx.description}\n\nSource files:\n${sourceContext}`,
      },
    ],
    maxTokens: 4096,
    temperature: 0,
  });

  let comments: AgentOutput["reviewComments"] = [];
  const jsonMatch = resp.content.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  if (jsonMatch?.[1]) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (Array.isArray(parsed)) {
        comments = parsed.filter(
          (c) => c && c.file && c.message && c.severity
        );
      }
    } catch {
      // Non-JSON review output — treat as zero structured comments.
    }
  }
  const errors = comments!.filter((c) => c.severity === "error").length;
  return {
    success: true,
    output: {
      files: {},
      summary: `Code review: ${comments!.length} comments (${errors} errors)`,
      reviewComments: comments,
    },
    cost: costFrom(ctx.model, resp, Date.now() - start),
  };
}

export function getRunner(
  agentType: AgentType
): (ctx: AgentContext) => Promise<RunnerResult> {
  switch (agentType) {
    case "test":
      return runTestAgent;
    case "review":
      return runReviewAgent;
    default:
      return runCodegenAgent;
  }
}
