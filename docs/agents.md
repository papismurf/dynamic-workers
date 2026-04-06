# Agent Types & Tool API

Agents are autonomous software development programs that run inside sandboxed Cloudflare Dynamic Workers. Each agent receives a task description, file context, and a set of tool bindings. It uses an LLM to reason about the task, then calls tools to read code, write files, commit changes, and more.

---

## Agent Types

| Agent | Type Key | Description | Output |
|---|---|---|---|
| **CodeGen** | `codegen` | Generates new code from a natural language specification | New/modified files, git commit |
| **Test** | `test` | Writes unit and integration tests for specified source files | Test files, git commit |
| **Review** | `review` | Performs code review with structured, severity-rated comments | Review comments (JSON) |
| **Refactor** | `refactor` | Restructures existing code while preserving behavior | Modified files, git commit |
| **Debug** | `debug` | Diagnoses failures from error logs and proposes fixes | Patched files, git commit |
| **Dependency** | `dependency` | Audits and updates project dependencies | Updated package files, git commit |

Currently, `codegen`, `test`, and `review` have dedicated agent implementations. The `refactor`, `debug`, and `dependency` types use the CodeGen agent with task-specific prompts.

---

## Task Decomposition

When a `codegen` task is submitted, the orchestrator automatically decomposes it into three subtasks:

```
1. CodeGen subtask  (no dependencies)
       ↓
2. Test subtask     (depends on #1)
       ↓
3. Review subtask   (depends on #1 and #2)
```

For `test` or `review` tasks, a single subtask is created with no decomposition.

---

## Agent Execution Environment

Each agent runs in a V8 isolate with no direct network access. All external interactions happen through RPC bindings injected by the orchestrator.

### Available Bindings

| Binding | Env Key | Description |
|---|---|---|
| FileSystem | `env.FS` | Read, write, list, and delete files in the target repo |
| Git | `env.GIT` | Branch, commit, diff, and create pull requests |
| LLM | `env.LLM` | Call AI models (Anthropic Claude, OpenAI GPT) |
| CodeSearch | `env.SEARCH` | Grep code, find files by glob, extract symbols |
| Memory | `env.MEMORY` | Persistent key-value store for cross-invocation learning |
| Config | `env.CONFIG` | Task description, file context, and metadata |

### Config Object

Every agent receives an `env.CONFIG` with:

```typescript
{
  taskId: string;           // Parent task identifier
  description: string;      // Natural language task description
  files: Record<string, string>;  // File path → content map
  targetFiles: string[];    // List of files to operate on
  context: Record<string, unknown>;  // Additional structured context
}
```

---

## Tool API Reference

These TypeScript interfaces describe the tools available to agents. They are defined in `src/types.ts` and can be provided to an LLM as part of its system prompt so it understands what capabilities it has.

### FileSystem API (`env.FS`)

```typescript
interface FileSystemAPI {
  /** Read a file's content. Throws if the file does not exist. */
  read(path: string): Promise<string>;

  /** Write content to a file. Creates or overwrites. */
  write(path: string, content: string): Promise<void>;

  /** List entries in a directory. Directories end with '/'. */
  list(directory: string): Promise<string[]>;

  /** Delete a file. Throws if it does not exist. */
  delete(path: string): Promise<void>;

  /** Check if a file exists. */
  exists(path: string): Promise<boolean>;

  /** Read and parse a JSON file. */
  readJson<T = unknown>(path: string): Promise<T>;
}
```

### Git API (`env.GIT`)

```typescript
interface GitAPI {
  /** Get unified diff between the working branch and a base branch. */
  diff(baseBranch?: string): Promise<string>;

  /** Create a commit with the given files. Returns the commit SHA. */
  commit(message: string, files: Record<string, string>): Promise<string>;

  /** Create a new branch from the base branch. */
  branch(name: string): Promise<void>;

  /** No-op in GitHub API model (commits are already remote). */
  push(): Promise<void>;

  /** Get recent commit log entries. */
  log(count?: number): Promise<Array<{
    sha: string;
    message: string;
    author: string;
  }>>;

  /** Get the list of changed files between working and base branch. */
  status(): Promise<Array<{ file: string; status: string }>>;

  /** Create a pull request. Returns the PR URL. */
  createPullRequest(title: string, body: string): Promise<string>;
}
```

### LLM API (`env.LLM`)

```typescript
interface LLMAPI {
  /** Send a chat completion request. Returns the response with token counts. */
  chat(params: {
    messages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }>;
    maxTokens?: number;    // Default: 4096
    temperature?: number;  // Default: 0
    stop?: string[];
  }): Promise<{
    content: string;
    inputTokens: number;
    outputTokens: number;
    model: string;
  }>;
}
```

The LLM binding handles:
- Provider routing (Anthropic or OpenAI based on configuration)
- Automatic retry with exponential backoff (up to 3 attempts)
- Credential injection (the agent never sees API keys)

### CodeSearch API (`env.SEARCH`)

```typescript
interface CodeSearchAPI {
  /** Search for a pattern across the repository. */
  grep(pattern: string, options?: {
    glob?: string;       // File pattern filter
    maxResults?: number; // Default: 50
  }): Promise<Array<{
    file: string;
    line: number;
    content: string;
  }>>;

  /** Find files matching a glob pattern. */
  findFiles(glob: string): Promise<string[]>;

  /** Extract symbols (functions, classes, interfaces, etc.) from a file. */
  getSymbols(file: string): Promise<Array<{
    name: string;
    kind: string;  // "function" | "class" | "interface" | "type" | "const" | "enum"
    line: number;
  }>>;
}
```

### Memory API (`env.MEMORY`)

```typescript
interface MemoryAPI {
  /** Get a value by key. Returns null if not found. */
  get(key: string): Promise<string | null>;

  /** Set a value. Optionally with a TTL in seconds. */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;

  /** List all keys matching a prefix. */
  list(prefix: string): Promise<string[]>;

  /** Delete a key. */
  delete(key: string): Promise<void>;
}
```

Memory is namespaced per project (typically `owner/repo`), so agents working on different repos have isolated storage.

---

## Agent Output Format

Every agent's `run()` method returns a JSON string with this structure:

```typescript
{
  success: boolean;
  files: Record<string, string>;   // Files written by the agent
  summary: string;                  // Human-readable summary
  commitSha?: string;               // Git commit SHA if files were committed
  testResults?: TestResult[];       // For test agents
  reviewComments?: ReviewComment[]; // For review agents
  cost: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    cpuTimeMs: number;
    subrequests: number;
  };
  durationMs: number;
}
```

### Review Comment Format

```typescript
{
  file: string;                              // File path
  line: number;                              // Line number
  severity: "info" | "warning" | "error";    // Issue severity
  message: string;                           // Description of the issue
  suggestion?: string;                       // Optional code fix
}
```

---

## Adding a New Agent Type

1. Create the agent source code as a JavaScript string in `src/agents/source.ts`.
2. Add the agent type to the `AgentType` union in `src/types.ts`.
3. Add a `case` in `getAgentSource()` in `src/agents/source.ts`.
4. If the agent needs custom decomposition, add a `case` in `decomposeTask()` in `src/index.ts`.

The agent source must export a `WorkerEntrypoint` subclass with an `async run(): Promise<string>` method and a `default` export with a `fetch()` handler.
