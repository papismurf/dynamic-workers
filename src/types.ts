// ---------------------------------------------------------------------------
// Task & Agent type definitions
// ---------------------------------------------------------------------------

export type AgentType =
  | "codegen"
  | "test"
  | "review"
  | "refactor"
  | "debug"
  | "dependency";

export type TaskStatus =
  | "pending"
  | "assigned"
  | "running"
  | "review"
  | "approved"
  | "completed"
  | "failed"
  | "cancelled";

export interface RepoContext {
  owner: string;
  repo: string;
  branch: string;
  baseBranch: string;
  files: Record<string, string>;
}

export interface TaskRequest {
  description: string;
  agentType: AgentType;
  repo: RepoContext;
  config?: AgentConfig;
  parentTaskId?: string;
}

export interface AgentConfig {
  model?: string;
  provider?: string;
  maxTokens?: number;
  temperature?: number;
  maxRetries?: number;
  cpuLimitMs?: number;
  subrequestLimit?: number;
}

export interface SubTask {
  id: string;
  agentType: AgentType;
  description: string;
  context: Record<string, unknown>;
  dependencies: string[];
}

export interface TaskState {
  id: string;
  status: TaskStatus;
  request: TaskRequest;
  subtasks: SubTask[];
  results: Record<string, AgentResult>;
  error?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  reviewUrl?: string;
  cost?: CostBreakdown;
}

export interface AgentResult {
  subtaskId: string;
  agentType: AgentType;
  success: boolean;
  output: AgentOutput;
  error?: string;
  cost: CostBreakdown;
  durationMs: number;
}

export interface AgentOutput {
  files: Record<string, string>;
  summary: string;
  diff?: string;
  prUrl?: string;
  testResults?: TestResult[];
  reviewComments?: ReviewComment[];
}

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

export interface ReviewComment {
  file: string;
  line: number;
  severity: "info" | "warning" | "error";
  message: string;
  suggestion?: string;
}

export interface CostBreakdown {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  cpuTimeMs: number;
  subrequests: number;
}

// ---------------------------------------------------------------------------
// API request / response shapes
// ---------------------------------------------------------------------------

export interface CreateTaskRequest {
  tasks: TaskRequest[];
}

export interface CreateTaskResponse {
  taskIds: string[];
}

export interface TaskStatusResponse {
  task: TaskState;
}

export interface ReviewDecision {
  taskId: string;
  decision: "approve" | "reject" | "revise";
  feedback?: string;
}

export interface UsageResponse {
  tasks: Array<{ taskId: string; cost: CostBreakdown }>;
  aggregate: CostBreakdown;
}

// ---------------------------------------------------------------------------
// Agent tool API types — these TypeScript interfaces are given to LLM agents
// so they understand the bindings available in their sandbox.
// ---------------------------------------------------------------------------

/**
 * FileSystem binding — scoped to a specific repository directory.
 * Available as `env.FS` inside agent Dynamic Workers.
 */
export interface FileSystemAPI {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  list(directory: string): Promise<string[]>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  readJson<T = unknown>(path: string): Promise<T>;
}

/**
 * Git binding — scoped to a specific repository.
 * Available as `env.GIT` inside agent Dynamic Workers.
 */
export interface GitAPI {
  diff(baseBranch?: string): Promise<string>;
  commit(message: string, files: string[]): Promise<string>;
  branch(name: string): Promise<void>;
  push(): Promise<void>;
  log(count?: number): Promise<Array<{ sha: string; message: string; author: string }>>;
  status(): Promise<Array<{ file: string; status: string }>>;
}

/**
 * LLM binding — calls an AI model with managed credentials.
 * Available as `env.LLM` inside agent Dynamic Workers.
 */
export interface LLMAPI {
  chat(params: {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    maxTokens?: number;
    temperature?: number;
    stop?: string[];
  }): Promise<{
    content: string;
    inputTokens: number;
    outputTokens: number;
    model: string;
  }>;
}

/**
 * CodeSearch binding — search code within the repository.
 * Available as `env.SEARCH` inside agent Dynamic Workers.
 */
export interface CodeSearchAPI {
  grep(pattern: string, options?: { glob?: string; maxResults?: number }): Promise<
    Array<{ file: string; line: number; content: string }>
  >;
  findFiles(glob: string): Promise<string[]>;
  getSymbols(file: string): Promise<
    Array<{ name: string; kind: string; line: number }>
  >;
}

/**
 * Memory binding — persists learnings across agent invocations.
 * Available as `env.MEMORY` inside agent Dynamic Workers.
 */
export interface MemoryAPI {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  list(prefix: string): Promise<string[]>;
  delete(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Log types (shared with observability pipeline)
// ---------------------------------------------------------------------------

export interface LogEntry {
  level: string;
  message: string;
  timestamp: number;
  workerId?: string;
  taskId?: string;
}

export interface StreamEvent {
  type: "log" | "progress" | "result" | "error";
  taskId: string;
  subtaskId?: string;
  data: unknown;
  timestamp: number;
}
