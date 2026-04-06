import { WorkerEntrypoint } from "cloudflare:workers";

interface FileSystemProps {
  owner: string;
  repo: string;
  branch: string;
  githubPat: string;
  basePath?: string;
}

/**
 * FileSystem RPC binding — exposes read/write/list/delete scoped to a GitHub repo.
 *
 * Agents call methods like `env.FS.read("src/index.ts")` — they never see
 * the GitHub PAT or know which repo they're operating on.
 */
export class FileSystem extends WorkerEntrypoint<Env, FileSystemProps> {
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

  private apiUrl(path: string): string {
    const base = this.props.basePath ?? "";
    const full = base ? `${base}/${path}` : path;
    return `https://api.github.com/repos/${this.props.owner}/${this.props.repo}/contents/${full}?ref=${this.props.branch}`;
  }

  async read(path: string): Promise<string> {
    const resp = await fetch(this.apiUrl(path), { headers: this.headers });
    if (!resp.ok) {
      throw new Error(`FS.read failed for ${path}: ${resp.status} ${resp.statusText}`);
    }
    const data = (await resp.json()) as { content: string; encoding: string };
    if (data.encoding !== "base64") {
      throw new Error(`Unexpected encoding: ${data.encoding}`);
    }
    return atob(data.content.replace(/\n/g, ""));
  }

  async write(path: string, content: string): Promise<void> {
    const existing = await this.getSha(path);
    const body: Record<string, unknown> = {
      message: `agent: update ${path}`,
      content: btoa(content),
      branch: this.props.branch,
    };
    if (existing) {
      body.sha = existing;
    }

    const resp = await fetch(this.apiUrl(path), {
      method: "PUT",
      headers: this.headers,
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`FS.write failed for ${path}: ${resp.status} ${err}`);
    }
  }

  async list(directory: string): Promise<string[]> {
    const resp = await fetch(this.apiUrl(directory), { headers: this.headers });
    if (!resp.ok) {
      if (resp.status === 404) return [];
      throw new Error(`FS.list failed for ${directory}: ${resp.status}`);
    }
    const items = (await resp.json()) as Array<{ name: string; type: string; path: string }>;
    if (!Array.isArray(items)) return [];
    return items.map((item) => (item.type === "dir" ? `${item.path}/` : item.path));
  }

  async delete(path: string): Promise<void> {
    const sha = await this.getSha(path);
    if (!sha) {
      throw new Error(`FS.delete: file not found: ${path}`);
    }
    const resp = await fetch(this.apiUrl(path), {
      method: "DELETE",
      headers: this.headers,
      body: JSON.stringify({
        message: `agent: delete ${path}`,
        sha,
        branch: this.props.branch,
      }),
    });
    if (!resp.ok) {
      throw new Error(`FS.delete failed for ${path}: ${resp.status}`);
    }
  }

  async exists(path: string): Promise<boolean> {
    const resp = await fetch(this.apiUrl(path), {
      method: "HEAD",
      headers: this.headers,
    });
    return resp.ok;
  }

  async readJson<T = unknown>(path: string): Promise<T> {
    const content = await this.read(path);
    return JSON.parse(content) as T;
  }

  private async getSha(path: string): Promise<string | null> {
    const resp = await fetch(this.apiUrl(path), { headers: this.headers });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { sha: string };
    return data.sha;
  }
}
