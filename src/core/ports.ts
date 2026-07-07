/**
 * Ports (interfaces) for the runtime-neutral orchestration core. Adapters live
 * under src/core (state stores) and src/runtime (agent runtimes). See
 * docs/platform-agnostic-feasibility.md.
 */
import type {
  AgentResult,
  CostBreakdown,
  LogEntry,
  SubTask,
  TaskRequest,
  TaskState,
  TaskStatus,
  UsageResponse,
} from "../types.js";

/**
 * Persists task state and cost records. Implementations: in-memory (dev),
 * Durable Objects (Cloudflare), SQL/Redis (self-host).
 */
export interface StateStore {
  create(id: string, request: TaskRequest): Promise<TaskState>;
  get(id: string): Promise<TaskState | null>;
  setSubtasks(id: string, subtasks: SubTask[]): Promise<void>;
  transition(id: string, status: TaskStatus): Promise<void>;
  addResult(id: string, result: AgentResult): Promise<void>;
  /** Clear all accumulated results/cost for a task (used on revise re-runs). */
  clearResults(id: string): Promise<void>;
  setReviewUrl(id: string, url: string): Promise<void>;
  setError(id: string, error: string): Promise<void>;
  recordCost(id: string, cost: CostBreakdown): Promise<void>;
  getUsage(since?: number): Promise<UsageResponse>;
}

/** How/where a single agent executes, including its isolation + egress policy. */
export interface AgentRuntime {
  runAgent(spec: AgentRunSpec): Promise<AgentResult>;
}

export interface AgentRunSpec {
  taskId: string;
  subtask: SubTask;
  request: TaskRequest;
  /** Optional log callback for streaming agent output. */
  onLog?: (entry: LogEntry) => void;
  /** Cooperative cancellation. */
  signal?: AbortSignal;
}
