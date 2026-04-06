import { WorkerEntrypoint } from "cloudflare:workers";

interface CodeSearchProps {
  owner: string;
  repo: string;
  branch: string;
  githubPat: string;
}

interface GrepResult {
  file: string;
  line: number;
  content: string;
}

interface SymbolInfo {
  name: string;
  kind: string;
  line: number;
}

/**
 * CodeSearch RPC binding — search code, find files, and extract symbols
 * from a GitHub repository. Uses the GitHub Code Search API and tree API.
 */
export class CodeSearch extends WorkerEntrypoint<Env, CodeSearchProps> {
  private get props() {
    return this.ctx.props;
  }

  private get headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.props.githubPat}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "agent-orchestrator",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  async grep(
    pattern: string,
    options?: { glob?: string; maxResults?: number }
  ): Promise<GrepResult[]> {
    const maxResults = options?.maxResults ?? 50;
    let query = `${pattern} repo:${this.props.owner}/${this.props.repo}`;
    if (options?.glob) {
      query += ` path:${options.glob}`;
    }

    const resp = await fetch(
      `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=${maxResults}`,
      { headers: { ...this.headers, Accept: "application/vnd.github.text-match+json" } }
    );

    if (!resp.ok) {
      throw new Error(`CodeSearch.grep failed: ${resp.status}`);
    }

    const data = (await resp.json()) as {
      items: Array<{
        path: string;
        text_matches?: Array<{
          fragment: string;
          matches: Array<{ text: string; indices: number[] }>;
        }>;
      }>;
    };

    const results: GrepResult[] = [];
    for (const item of data.items) {
      if (item.text_matches) {
        for (const match of item.text_matches) {
          const lines = match.fragment.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i]?.includes(pattern)) {
              results.push({ file: item.path, line: i + 1, content: lines[i]! });
            }
          }
        }
      } else {
        results.push({ file: item.path, line: 0, content: "" });
      }
    }

    return results.slice(0, maxResults);
  }

  async findFiles(glob: string): Promise<string[]> {
    const resp = await fetch(
      `https://api.github.com/repos/${this.props.owner}/${this.props.repo}/git/trees/${this.props.branch}?recursive=1`,
      { headers: this.headers }
    );
    if (!resp.ok) throw new Error(`CodeSearch.findFiles failed: ${resp.status}`);

    const data = (await resp.json()) as {
      tree: Array<{ path: string; type: string }>;
    };

    const pattern = globToRegex(glob);
    return data.tree
      .filter((item) => item.type === "blob" && pattern.test(item.path))
      .map((item) => item.path);
  }

  async getSymbols(file: string): Promise<SymbolInfo[]> {
    const resp = await fetch(
      `https://api.github.com/repos/${this.props.owner}/${this.props.repo}/contents/${file}?ref=${this.props.branch}`,
      { headers: this.headers }
    );
    if (!resp.ok) throw new Error(`CodeSearch.getSymbols failed: ${resp.status}`);

    const data = (await resp.json()) as { content: string; encoding: string };
    const content = atob(data.content.replace(/\n/g, ""));

    return extractSymbols(content, file);
  }
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function extractSymbols(content: string, file: string): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];
  const lines = content.split("\n");
  const ext = file.split(".").pop() ?? "";

  const patterns: Array<{ regex: RegExp; kind: string }> =
    ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx"
      ? [
          { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/m, kind: "function" },
          { regex: /^(?:export\s+)?class\s+(\w+)/m, kind: "class" },
          { regex: /^(?:export\s+)?interface\s+(\w+)/m, kind: "interface" },
          { regex: /^(?:export\s+)?type\s+(\w+)/m, kind: "type" },
          { regex: /^(?:export\s+)?const\s+(\w+)\s*=/m, kind: "const" },
          { regex: /^(?:export\s+)?enum\s+(\w+)/m, kind: "enum" },
        ]
      : ext === "py"
        ? [
            { regex: /^def\s+(\w+)/m, kind: "function" },
            { regex: /^class\s+(\w+)/m, kind: "class" },
            { regex: /^(\w+)\s*=/m, kind: "variable" },
          ]
        : [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const { regex, kind } of patterns) {
      const match = line.match(regex);
      if (match?.[1]) {
        symbols.push({ name: match[1], kind, line: i + 1 });
      }
    }
  }

  return symbols;
}
