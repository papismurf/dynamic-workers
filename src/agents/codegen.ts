/**
 * CodeGen Agent — generates new code from a natural language spec and file context.
 *
 * Runs inside a sandboxed Dynamic Worker with these bindings:
 *   env.FS     — FileSystem RPC (read, write, list, exists)
 *   env.GIT    — Git RPC (branch, commit, diff, push)
 *   env.LLM    — LLM RPC (chat)
 *   env.SEARCH — CodeSearch RPC (grep, findFiles, getSymbols)
 *   env.MEMORY — Memory RPC (get, set, list)
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
    diff(base?: string): Promise<string>;
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

export class CodeGenAgent extends WorkerEntrypoint {
  declare env: AgentEnv;

  async run(): Promise<string> {
    const { description, files, targetFiles, context } = this.env.CONFIG;
    const startTime = Date.now();

    console.log(`[codegen] Starting: ${description}`);

    const existingCode: Record<string, string> = {};
    for (const file of targetFiles) {
      try {
        existingCode[file] = files[file] ?? (await this.env.FS.read(file));
      } catch {
        console.log(`[codegen] File ${file} not found, will create new`);
      }
    }

    const conventions = await this.env.MEMORY.get("coding-conventions");
    const relatedSymbols = await this.gatherContext(targetFiles);

    const systemPrompt = [
      "You are an expert software engineer. Generate production-quality code.",
      "Return ONLY code blocks with file paths. Format each file as:",
      "```filepath:path/to/file.ts",
      "// code here",
      "```",
      "Do not explain the code unless asked. Follow existing conventions exactly.",
      conventions ? `\nProject conventions:\n${conventions}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const contextStr = Object.entries(existingCode)
      .map(([path, code]) => `--- ${path} ---\n${code}`)
      .join("\n\n");

    const userPrompt = [
      `Task: ${description}`,
      contextStr ? `\nExisting files:\n${contextStr}` : "",
      relatedSymbols ? `\nRelated symbols:\n${relatedSymbols}` : "",
      context
        ? `\nAdditional context:\n${JSON.stringify(context, null, 2)}`
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
      throw new Error("Agent produced no code output");
    }

    for (const [path, content] of Object.entries(generatedFiles)) {
      await this.env.FS.write(path, content);
      console.log(`[codegen] Wrote ${path} (${content.length} bytes)`);
    }

    const commitSha = await this.env.GIT.commit(
      `feat: ${description.slice(0, 72)}`,
      generatedFiles
    );

    const durationMs = Date.now() - startTime;
    console.log(`[codegen] Complete in ${durationMs}ms, commit: ${commitSha}`);

    return JSON.stringify({
      success: true,
      files: generatedFiles,
      summary: `Generated ${Object.keys(generatedFiles).length} file(s)`,
      commitSha,
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

  private async gatherContext(targetFiles: string[]): Promise<string> {
    const symbols: string[] = [];
    for (const file of targetFiles.slice(0, 5)) {
      try {
        const syms = await this.env.SEARCH.getSymbols(file);
        if (syms.length > 0) {
          symbols.push(
            `${file}: ${syms.map((s) => `${s.kind} ${s.name}`).join(", ")}`
          );
        }
      } catch {
        // File might not exist yet
      }
    }
    return symbols.join("\n");
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
  async fetch(_request: Request, env: AgentEnv): Promise<Response> {
    return new Response("CodeGen agent — use the run() entrypoint", {
      status: 200,
    });
  },
};
