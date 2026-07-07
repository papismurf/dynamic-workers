/**
 * Runtime-neutral task state-machine helpers.
 *
 * A pure copy of the transition table + cost aggregation from src/state.ts,
 * without the `cloudflare:workers` DurableObject import — so it runs in plain
 * Node (the local runtime) as well as inside Workers. See
 * docs/adr/0004-state-and-observability-portability.md.
 */
import type { AgentResult, CostBreakdown, TaskStatus } from "../types.js";

export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ["assigned", "cancelled", "failed"],
  assigned: ["running", "cancelled", "failed"],
  running: ["review", "completed", "failed", "cancelled"],
  review: ["approved", "failed", "cancelled"],
  approved: ["completed", "failed"],
  completed: [],
  failed: ["pending"],
  cancelled: [],
};

export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function zeroCost(): CostBreakdown {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    cpuTimeMs: 0,
    subrequests: 0,
  };
}

export function aggregateCosts(
  results: Array<Pick<AgentResult, "cost">>
): CostBreakdown {
  return results.reduce<CostBreakdown>((acc, r) => {
    if (!r.cost) return acc;
    return {
      inputTokens: acc.inputTokens + r.cost.inputTokens,
      outputTokens: acc.outputTokens + r.cost.outputTokens,
      totalTokens: acc.totalTokens + r.cost.totalTokens,
      estimatedCostUsd: acc.estimatedCostUsd + r.cost.estimatedCostUsd,
      cpuTimeMs: acc.cpuTimeMs + r.cost.cpuTimeMs,
      subrequests: acc.subrequests + r.cost.subrequests,
    };
  }, zeroCost());
}
