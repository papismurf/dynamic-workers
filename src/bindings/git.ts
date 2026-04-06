import { WorkerEntrypoint } from "cloudflare:workers";

interface GitProps {
  owner: string;
  repo: string;
  branch: string;
  baseBranch: string;
  githubPat: string;
}

/**
 * Git RPC binding — exposes branch, commit, diff, push operations
 * scoped to a specific GitHub repository. Agents never see the PAT.
 */
export class Git extends WorkerEntrypoint<Env, GitProps> {
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

  private api(path: string): string {
    return `https://api.github.com/repos/${this.props.owner}/${this.props.repo}/${path}`;
  }

  async diff(baseBranch?: string): Promise<string> {
    const base = baseBranch ?? this.props.baseBranch;
    const resp = await fetch(
      this.api(`compare/${base}...${this.props.branch}`),
      { headers: this.headers }
    );
    if (!resp.ok) {
      if (resp.status === 404) return "";
      throw new Error(`Git.diff failed: ${resp.status}`);
    }
    const data = (await resp.json()) as {
      files: Array<{ filename: string; patch?: string }>;
    };
    return data.files
      .map((f) => `--- ${f.filename}\n${f.patch ?? "(binary)"}`)
      .join("\n\n");
  }

  async commit(message: string, files: Record<string, string>): Promise<string> {
    const branchRef = await this.getRef(this.props.branch);
    const baseTree = await this.getCommitTree(branchRef);

    const tree = await this.createTree(
      baseTree,
      Object.entries(files).map(([path, content]) => ({
        path,
        mode: "100644" as const,
        type: "blob" as const,
        content,
      }))
    );

    const commit = await this.createCommit(message, tree, branchRef);
    await this.updateRef(this.props.branch, commit);

    return commit;
  }

  async branch(name: string): Promise<void> {
    const baseSha = await this.getRef(this.props.baseBranch);
    const resp = await fetch(this.api("git/refs"), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ ref: `refs/heads/${name}`, sha: baseSha }),
    });
    if (!resp.ok && resp.status !== 422) {
      throw new Error(`Git.branch failed: ${resp.status}`);
    }
  }

  async push(): Promise<void> {
    // In the GitHub API model, commits are already "pushed" when created
    // via the API. This method exists for interface parity.
  }

  async log(count = 10): Promise<Array<{ sha: string; message: string; author: string }>> {
    const resp = await fetch(
      this.api(`commits?sha=${this.props.branch}&per_page=${count}`),
      { headers: this.headers }
    );
    if (!resp.ok) throw new Error(`Git.log failed: ${resp.status}`);
    const commits = (await resp.json()) as Array<{
      sha: string;
      commit: { message: string; author: { name: string } };
    }>;
    return commits.map((c) => ({
      sha: c.sha,
      message: c.commit.message,
      author: c.commit.author.name,
    }));
  }

  async status(): Promise<Array<{ file: string; status: string }>> {
    const resp = await fetch(
      this.api(`compare/${this.props.baseBranch}...${this.props.branch}`),
      { headers: this.headers }
    );
    if (!resp.ok) {
      if (resp.status === 404) return [];
      throw new Error(`Git.status failed: ${resp.status}`);
    }
    const data = (await resp.json()) as {
      files: Array<{ filename: string; status: string }>;
    };
    return data.files.map((f) => ({ file: f.filename, status: f.status }));
  }

  async createPullRequest(title: string, body: string): Promise<string> {
    const resp = await fetch(this.api("pulls"), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        title,
        body,
        head: this.props.branch,
        base: this.props.baseBranch,
      }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Git.createPullRequest failed: ${resp.status} ${err}`);
    }
    const pr = (await resp.json()) as { html_url: string };
    return pr.html_url;
  }

  // --- Private helpers for GitHub Git Data API ---

  private async getRef(branch: string): Promise<string> {
    const resp = await fetch(this.api(`git/ref/heads/${branch}`), {
      headers: this.headers,
    });
    if (!resp.ok) throw new Error(`getRef(${branch}) failed: ${resp.status}`);
    const data = (await resp.json()) as { object: { sha: string } };
    return data.object.sha;
  }

  private async getCommitTree(commitSha: string): Promise<string> {
    const resp = await fetch(this.api(`git/commits/${commitSha}`), {
      headers: this.headers,
    });
    if (!resp.ok) throw new Error(`getCommitTree failed: ${resp.status}`);
    const data = (await resp.json()) as { tree: { sha: string } };
    return data.tree.sha;
  }

  private async createTree(
    baseTree: string,
    items: Array<{ path: string; mode: string; type: string; content: string }>
  ): Promise<string> {
    const resp = await fetch(this.api("git/trees"), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ base_tree: baseTree, tree: items }),
    });
    if (!resp.ok) throw new Error(`createTree failed: ${resp.status}`);
    const data = (await resp.json()) as { sha: string };
    return data.sha;
  }

  private async createCommit(
    message: string,
    treeSha: string,
    parentSha: string
  ): Promise<string> {
    const resp = await fetch(this.api("git/commits"), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        message,
        tree: treeSha,
        parents: [parentSha],
      }),
    });
    if (!resp.ok) throw new Error(`createCommit failed: ${resp.status}`);
    const data = (await resp.json()) as { sha: string };
    return data.sha;
  }

  private async updateRef(branch: string, sha: string): Promise<void> {
    const resp = await fetch(this.api(`git/refs/heads/${branch}`), {
      method: "PATCH",
      headers: this.headers,
      body: JSON.stringify({ sha }),
    });
    if (!resp.ok) throw new Error(`updateRef failed: ${resp.status}`);
  }
}
