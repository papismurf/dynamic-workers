import type {
  AgentResult,
  CostBreakdown,
  SubTask,
  TaskRequest,
  TaskState,
  TaskStatus,
  UsageResponse,
} from "../types.js";
import type { StateStore } from "./ports.js";
import { aggregateCosts, isValidTransition } from "./state-machine.js";

interface CostRecord {
  taskId: string;
  cost: CostBreakdown;
  timestamp: number;
}

/**
 * Non-durable, in-process StateStore for local dev, tests, and single-node
 * self-hosting. Mirrors the semantics of the Durable-Object-backed store in
 * src/state.ts (same transition validation + cost aggregation).
 */
export class InMemoryStateStore implements StateStore {
  private readonly tasks = new Map<string, TaskState>();
  private readonly costs: CostRecord[] = [];

  private mutate(id: string, fn: (task: TaskState) => void): void {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task ${id} not found`);
    fn(task);
    task.updatedAt = Date.now();
  }

  async create(id: string, request: TaskRequest): Promise<TaskState> {
    const now = Date.now();
    const task: TaskState = {
      id,
      status: "pending",
      request,
      subtasks: [],
      results: {},
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(id, task);
    return structuredClone(task);
  }

  async get(id: string): Promise<TaskState | null> {
    const task = this.tasks.get(id);
    return task ? structuredClone(task) : null;
  }

  async setSubtasks(id: string, subtasks: SubTask[]): Promise<void> {
    this.mutate(id, (task) => {
      task.subtasks = subtasks;
      task.status = "assigned";
    });
  }

  async transition(id: string, status: TaskStatus): Promise<void> {
    this.mutate(id, (task) => {
      if (!isValidTransition(task.status, status)) {
        throw new Error(`Invalid transition: ${task.status} -> ${status}`);
      }
      task.status = status;
      if (status === "completed" || status === "failed") {
        task.completedAt = Date.now();
      }
    });
  }

  async addResult(id: string, result: AgentResult): Promise<void> {
    this.mutate(id, (task) => {
      task.results[result.subtaskId] = result;
      task.cost = aggregateCosts(Object.values(task.results));
    });
  }

  async clearResults(id: string): Promise<void> {
    this.mutate(id, (task) => {
      task.results = {};
      task.cost = undefined;
    });
  }

  async setReviewUrl(id: string, url: string): Promise<void> {
    this.mutate(id, (task) => {
      task.reviewUrl = url;
    });
  }

  async setError(id: string, error: string): Promise<void> {
    this.mutate(id, (task) => {
      task.error = error;
      task.status = "failed";
      task.completedAt = Date.now();
    });
  }

  async recordCost(id: string, cost: CostBreakdown): Promise<void> {
    this.costs.push({ taskId: id, cost, timestamp: Date.now() });
  }

  async getUsage(since?: number): Promise<UsageResponse> {
    const filtered = since
      ? this.costs.filter((r) => r.timestamp >= since)
      : this.costs;
    return {
      tasks: filtered.map((r) => ({ taskId: r.taskId, cost: r.cost })),
      aggregate: aggregateCosts(filtered.map((r) => ({ cost: r.cost }))),
    };
  }
}
