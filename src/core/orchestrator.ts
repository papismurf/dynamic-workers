import type {
  AgentResult,
  CostBreakdown,
  LogEntry,
  ReviewDecision,
  SubTask,
  TaskRequest,
  TaskState,
  UsageResponse,
} from "../types.js";
import type { AgentRuntime, StateStore } from "./ports.js";
import { decomposeTask } from "./decompose.js";
import { Semaphore } from "./semaphore.js";
import { aggregateCosts, zeroCost } from "./state-machine.js";

export interface OrchestratorOptions {
  /** Max agents allowed to run concurrently across all in-flight tasks. */
  maxParallelAgents?: number;
  /** Self-heal retry attempts for a failed agent. */
  maxAgentRetries?: number;
  /** Optional sink for streamed agent logs. */
  onLog?: (taskId: string, entry: LogEntry) => void;
  /** Override task decomposition (primarily for testing the scheduler). */
  decompose?: (request: TaskRequest) => SubTask[];
  /** Injectable uuid for tests. */
  uuid?: () => string;
}

function addCosts(a: CostBreakdown, b: CostBreakdown): CostBreakdown {
  return aggregateCosts([{ cost: a }, { cost: b }]);
}

/**
 * Runtime-neutral orchestration engine. Owns task decomposition, concurrent
 * dependency-aware scheduling, self-heal retries, and the review/cost flow.
 * All I/O is injected via the {@link StateStore} and {@link AgentRuntime}
 * ports, so the same engine runs on Cloudflare, locally, or self-hosted.
 */
export class Orchestrator {
  private readonly semaphore: Semaphore;
  private readonly maxAgentRetries: number;
  private readonly decompose: (request: TaskRequest) => SubTask[];
  private readonly uuid: () => string;

  constructor(
    private readonly store: StateStore,
    private readonly runtime: AgentRuntime,
    private readonly opts: OrchestratorOptions = {}
  ) {
    this.semaphore = new Semaphore(opts.maxParallelAgents ?? 4);
    this.maxAgentRetries = opts.maxAgentRetries ?? 3;
    this.decompose = opts.decompose ?? decomposeTask;
    this.uuid = opts.uuid ?? (() => globalThis.crypto.randomUUID());
  }

  /** Create a task and begin executing it in the background. Returns its id. */
  async createTask(request: TaskRequest): Promise<string> {
    const taskId = this.uuid();
    await this.store.create(taskId, request);
    // Fire-and-forget; callers poll getTask(). execute() records its own errors
    // and never rejects, so there is no unhandled rejection.
    void this.execute(taskId, request);
    return taskId;
  }

  async getTask(id: string): Promise<TaskState | null> {
    return this.store.get(id);
  }

  async getUsage(since?: number): Promise<UsageResponse> {
    return this.store.getUsage(since);
  }

  /**
   * Execute a task to completion (or failure). Runs subtasks in dependency
   * waves; independent subtasks within a wave run concurrently (bounded by the
   * semaphore). Dependents of a failed subtask are skipped rather than run.
   */
  async execute(taskId: string, request: TaskRequest): Promise<void> {
    try {
      const subtasks = this.decompose(request);
      // Start from a clean slate so revise re-runs don't leave orphan results
      // or double-count cost.
      await this.store.clearResults(taskId);
      await this.store.setSubtasks(taskId, subtasks);
      await this.store.transition(taskId, "running");

      const completed = new Set<string>();
      const failed = new Set<string>();
      const pending = [...subtasks];

      while (pending.length > 0) {
        const ready = pending.filter((st) =>
          st.dependencies.every((dep) => completed.has(dep))
        );
        if (ready.length === 0) {
          throw new Error("Circular dependency detected in subtasks");
        }

        // Subtasks whose dependency failed are skipped (not executed).
        const toRun: SubTask[] = [];
        for (const st of ready) {
          if (st.dependencies.some((dep) => failed.has(dep))) {
            await this.recordSkipped(taskId, st);
            completed.add(st.id);
            failed.add(st.id);
            this.remove(pending, st);
          } else {
            toRun.push(st);
          }
        }
        if (toRun.length === 0) continue;

        const settledResults = await Promise.allSettled(
          toRun.map((st) => this.semaphore.run(() => this.runOne(taskId, st, request)))
        );

        for (let i = 0; i < toRun.length; i++) {
          const subtask = toRun[i]!;
          const settled = settledResults[i]!;
          this.remove(pending, subtask);

          let final: AgentResult;
          if (settled.status === "fulfilled") {
            final = settled.value.success
              ? settled.value
              : await this.selfHeal(taskId, subtask, settled.value, request);
          } else {
            final = {
              subtaskId: subtask.id,
              agentType: subtask.agentType,
              success: false,
              output: { files: {}, summary: "" },
              error: settled.reason?.message ?? "Unknown error",
              cost: zeroCost(),
              durationMs: 0,
            };
          }

          await this.store.addResult(taskId, { ...final, subtaskId: subtask.id });
          completed.add(subtask.id);
          if (!final.success) failed.add(subtask.id);
        }
      }

      await this.store.transition(taskId, failed.size === 0 ? "review" : "failed");

      const state = await this.store.get(taskId);
      if (state?.cost) await this.store.recordCost(taskId, state.cost);
    } catch (err) {
      await this.store.setError(
        taskId,
        err instanceof Error ? err.message : "Unknown error"
      );
    }
  }

  /** Submit a human review decision for a task in the `review` state. */
  async review(
    taskId: string,
    decision: ReviewDecision
  ): Promise<{ status: string } | { error: string }> {
    const state = await this.store.get(taskId);
    if (!state || state.status !== "review") {
      return { error: "Task is not in review state" };
    }

    if (decision.decision === "approve") {
      await this.store.transition(taskId, "approved");
      await this.store.transition(taskId, "completed");
      return { status: "approved" };
    }
    if (decision.decision === "reject") {
      await this.store.transition(taskId, "failed");
      await this.store.setError(
        taskId,
        `Rejected by reviewer: ${decision.feedback ?? "No reason given"}`
      );
      return { status: "rejected" };
    }
    if (decision.decision === "revise" && decision.feedback) {
      await this.store.transition(taskId, "failed");
      await this.store.transition(taskId, "pending");
      const revised: TaskRequest = {
        ...state.request,
        description: `${state.request.description}\n\nRevision requested: ${decision.feedback}`,
      };
      void this.execute(taskId, revised);
      return { status: "revision_requested" };
    }
    return { error: "Invalid decision" };
  }

  private remove(list: SubTask[], subtask: SubTask): void {
    const idx = list.indexOf(subtask);
    if (idx !== -1) list.splice(idx, 1);
  }

  private async recordSkipped(taskId: string, subtask: SubTask): Promise<void> {
    await this.store.addResult(taskId, {
      subtaskId: subtask.id,
      agentType: subtask.agentType,
      success: false,
      output: { files: {}, summary: "" },
      error: "Skipped: a dependency failed",
      cost: zeroCost(),
      durationMs: 0,
    });
  }

  private async runOne(
    taskId: string,
    subtask: SubTask,
    request: TaskRequest
  ): Promise<AgentResult> {
    return this.runtime.runAgent({
      taskId,
      subtask,
      request,
      onLog: this.opts.onLog
        ? (entry) => this.opts.onLog!(taskId, entry)
        : undefined,
    });
  }

  /**
   * Retry a failed subtask with error context. Returns the final result for the
   * subtask — successful if any retry succeeded, otherwise the last failure.
   * The returned cost accumulates the failed attempt plus every retry so token
   * usage is never dropped.
   */
  private async selfHeal(
    taskId: string,
    subtask: SubTask,
    failed: AgentResult,
    request: TaskRequest
  ): Promise<AgentResult> {
    let accumulatedCost = failed.cost;
    let last = failed;

    for (let attempt = 1; attempt <= this.maxAgentRetries; attempt++) {
      const retrySubtask: SubTask = {
        ...subtask,
        id: `${subtask.id}-retry-${attempt}`,
        description: [
          `RETRY (attempt ${attempt}/${this.maxAgentRetries}): ${subtask.description}`,
          `\nPrevious attempt failed with error: ${last.error}`,
          "\nPlease fix the issues and try again.",
        ].join(""),
        context: { ...subtask.context, previousError: last.error, attempt },
        dependencies: [],
      };
      try {
        const result = await this.semaphore.run(() =>
          this.runOne(taskId, retrySubtask, request)
        );
        accumulatedCost = addCosts(accumulatedCost, result.cost);
        if (result.success) return { ...result, cost: accumulatedCost };
        last = result;
      } catch {
        /* keep retrying until attempts are exhausted */
      }
    }
    return { ...last, cost: accumulatedCost };
  }
}
