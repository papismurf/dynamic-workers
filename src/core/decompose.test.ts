/**
 * Unit tests for task decomposition — the pure task -> subtask fan-out.
 */
import { decomposeTask } from "./decompose.js";
import type { TaskRequest } from "../types.js";

const base = (over: Partial<TaskRequest> = {}): TaskRequest => ({
  description: "Add a feature",
  agentType: "codegen",
  repo: { owner: "a", repo: "b", branch: "c", baseBranch: "main", files: { "a.ts": "x" } },
  ...over,
});

describe("decomposeTask", () => {
  it("fans a codegen task out to code -> test -> review with dependencies", () => {
    const subtasks = decomposeTask(base());
    expect(subtasks.map((s) => s.agentType)).toEqual(["codegen", "test", "review"]);

    const [code, test, review] = subtasks;
    expect(code!.dependencies).toEqual([]);
    expect(test!.dependencies).toEqual([code!.id]);
    expect(review!.dependencies).toEqual([code!.id, test!.id]);

    // Every subtask gets a distinct id and carries the repo files as context.
    const ids = new Set(subtasks.map((s) => s.id));
    expect(ids.size).toBe(3);
    for (const s of subtasks) {
      expect(s.context).toMatchObject({ files: { "a.ts": "x" } });
    }
  });

  it("produces a single standalone subtask for non-codegen types", () => {
    for (const agentType of ["debug", "refactor", "review"] as const) {
      const subtasks = decomposeTask(base({ agentType }));
      expect(subtasks).toHaveLength(1);
      expect(subtasks[0]!.agentType).toBe(agentType);
      expect(subtasks[0]!.dependencies).toEqual([]);
      expect(subtasks[0]!.description).toBe("Add a feature");
    }
  });
});
