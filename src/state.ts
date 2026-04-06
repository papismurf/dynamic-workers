import { DurableObject } from "cloudflare:workers";
import type {
  TaskState,
  TaskRequest,
  TaskStatus,
  SubTask,
  AgentResult,
  CostBreakdown,
} from "./types";

// ---------------------------------------------------------------------------
// TaskManager Durable Object — manages the full lifecycle of a task
// ---------------------------------------------------------------------------

export class TaskManager extends DurableObject {
  private state!: TaskState;
  private initialized = false;

  private async load(): Promise<TaskState> {
    if (this.initialized) return this.state;
    const stored = await this.ctx.storage.get<TaskState>("task");
    if (stored) {
      this.state = stored;
      this.initialized = true;
    }
    return this.state;
  }

  private async save(): Promise<void> {
    this.state.updatedAt = Date.now();
    await this.ctx.storage.put("task", this.state);
  }

  async initialize(id: string, request: TaskRequest): Promise<TaskState> {
    this.state = {
      id,
      status: "pending",
      request,
      subtasks: [],
      results: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.initialized = true;
    await this.save();
    return this.state;
  }

  async getState(): Promise<TaskState> {
    return this.load();
  }

  async setSubtasks(subtasks: SubTask[]): Promise<void> {
    await this.load();
    this.state.subtasks = subtasks;
    this.state.status = "assigned";
    await this.save();
  }

  async transition(status: TaskStatus): Promise<void> {
    await this.load();
    const valid = VALID_TRANSITIONS[this.state.status];
    if (!valid?.includes(status)) {
      throw new Error(
        `Invalid transition: ${this.state.status} -> ${status}`
      );
    }
    this.state.status = status;
    if (status === "completed" || status === "failed") {
      this.state.completedAt = Date.now();
    }
    await this.save();
  }

  async addResult(result: AgentResult): Promise<void> {
    await this.load();
    this.state.results[result.subtaskId] = result;
    this.state.cost = aggregateCosts(Object.values(this.state.results));
    await this.save();
  }

  async setReviewUrl(url: string): Promise<void> {
    await this.load();
    this.state.reviewUrl = url;
    await this.save();
  }

  async setError(error: string): Promise<void> {
    await this.load();
    this.state.error = error;
    this.state.status = "failed";
    this.state.completedAt = Date.now();
    await this.save();
  }

  async isComplete(): Promise<boolean> {
    await this.load();
    if (this.state.subtasks.length === 0) return false;
    return this.state.subtasks.every(
      (st) => this.state.results[st.id] !== undefined
    );
  }

  async allSucceeded(): Promise<boolean> {
    await this.load();
    return Object.values(this.state.results).every((r) => r.success);
  }
}

// ---------------------------------------------------------------------------
// CostTracker Durable Object — aggregates cost data across tasks
// ---------------------------------------------------------------------------

interface CostRecord {
  taskId: string;
  cost: CostBreakdown;
  timestamp: number;
}

export class CostTracker extends DurableObject {
  async record(taskId: string, cost: CostBreakdown): Promise<void> {
    const records = (await this.ctx.storage.get<CostRecord[]>("records")) ?? [];
    records.push({ taskId, cost, timestamp: Date.now() });
    await this.ctx.storage.put("records", records);
  }

  async getUsage(since?: number): Promise<{
    tasks: Array<{ taskId: string; cost: CostBreakdown }>;
    aggregate: CostBreakdown;
  }> {
    const records = (await this.ctx.storage.get<CostRecord[]>("records")) ?? [];
    const filtered = since
      ? records.filter((r) => r.timestamp >= since)
      : records;

    const tasks = filtered.map((r) => ({
      taskId: r.taskId,
      cost: r.cost,
    }));

    const aggregate = aggregateCosts(
      filtered.map((r) => ({ cost: r.cost }) as AgentResult)
    );

    return { tasks, aggregate };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ["assigned", "cancelled", "failed"],
  assigned: ["running", "cancelled", "failed"],
  running: ["review", "completed", "failed", "cancelled"],
  review: ["approved", "failed", "cancelled"],
  approved: ["completed", "failed"],
  completed: [],
  failed: ["pending"],
  cancelled: [],
};

function aggregateCosts(results: AgentResult[]): CostBreakdown {
  const zero: CostBreakdown = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    cpuTimeMs: 0,
    subrequests: 0,
  };

  return results.reduce((acc, r) => {
    if (!r.cost) return acc;
    return {
      inputTokens: acc.inputTokens + r.cost.inputTokens,
      outputTokens: acc.outputTokens + r.cost.outputTokens,
      totalTokens: acc.totalTokens + r.cost.totalTokens,
      estimatedCostUsd: acc.estimatedCostUsd + r.cost.estimatedCostUsd,
      cpuTimeMs: acc.cpuTimeMs + r.cost.cpuTimeMs,
      subrequests: acc.subrequests + r.cost.subrequests,
    };
  }, zero);
}
