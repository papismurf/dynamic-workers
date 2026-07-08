/**
 * Unit tests for the runtime-neutral state-machine helpers: transition
 * validation and cost aggregation.
 */
import {
  VALID_TRANSITIONS,
  isValidTransition,
  zeroCost,
  aggregateCosts,
} from "./state-machine.js";
import type { CostBreakdown, TaskStatus } from "../types.js";

const cost = (over: Partial<CostBreakdown> = {}): CostBreakdown => ({
  inputTokens: 1,
  outputTokens: 2,
  totalTokens: 3,
  estimatedCostUsd: 0.5,
  cpuTimeMs: 10,
  subrequests: 1,
  ...over,
});

describe("isValidTransition", () => {
  it("allows every edge declared in the table", () => {
    for (const [from, targets] of Object.entries(VALID_TRANSITIONS)) {
      for (const to of targets) {
        expect(isValidTransition(from as TaskStatus, to)).toBe(true);
      }
    }
  });

  it("rejects an undeclared edge", () => {
    expect(isValidTransition("pending", "completed")).toBe(false);
    expect(isValidTransition("review", "running")).toBe(false);
  });

  it("treats terminal states as having no outgoing edges", () => {
    expect(VALID_TRANSITIONS.completed).toEqual([]);
    expect(VALID_TRANSITIONS.cancelled).toEqual([]);
    expect(isValidTransition("completed", "running")).toBe(false);
  });

  it("returns false for an unknown source state", () => {
    expect(isValidTransition("bogus" as TaskStatus, "failed")).toBe(false);
  });

  it("permits failed -> pending so tasks can be retried", () => {
    expect(isValidTransition("failed", "pending")).toBe(true);
  });
});

describe("zeroCost", () => {
  it("is all zeros", () => {
    expect(zeroCost()).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      cpuTimeMs: 0,
      subrequests: 0,
    });
  });
});

describe("aggregateCosts", () => {
  it("returns zeroCost for an empty list", () => {
    expect(aggregateCosts([])).toEqual(zeroCost());
  });

  it("sums every field across results", () => {
    const total = aggregateCosts([{ cost: cost() }, { cost: cost() }]);
    expect(total).toEqual({
      inputTokens: 2,
      outputTokens: 4,
      totalTokens: 6,
      estimatedCostUsd: 1,
      cpuTimeMs: 20,
      subrequests: 2,
    });
  });

  it("skips entries without a cost", () => {
    const total = aggregateCosts([
      { cost: cost({ inputTokens: 5, totalTokens: 5 }) },
      // A result may carry no cost (e.g. a skipped subtask); it's ignored.
      { cost: undefined as unknown as CostBreakdown },
    ]);
    expect(total.inputTokens).toBe(5);
    expect(total.totalTokens).toBe(5);
  });
});
