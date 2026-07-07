import type { SubTask, TaskRequest } from "../types.js";

const shortId = (): string =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).slice(
    0,
    8
  );

/**
 * Break a task request into a dependency graph of subtasks. Pure and
 * runtime-neutral (shared by the Cloudflare and local runtimes). A `codegen`
 * task fans out to code -> test -> review; other agent types run standalone.
 */
export function decomposeTask(taskReq: TaskRequest): SubTask[] {
  switch (taskReq.agentType) {
    case "codegen": {
      const codeId = shortId();
      const testId = shortId();
      const reviewId = shortId();
      return [
        {
          id: codeId,
          agentType: "codegen",
          description: taskReq.description,
          context: { files: taskReq.repo.files },
          dependencies: [],
        },
        {
          id: testId,
          agentType: "test",
          description: `Write tests for: ${taskReq.description}`,
          context: { files: taskReq.repo.files, dependsOn: codeId },
          dependencies: [codeId],
        },
        {
          id: reviewId,
          agentType: "review",
          description: `Review code generated for: ${taskReq.description}`,
          context: { files: taskReq.repo.files },
          dependencies: [codeId, testId],
        },
      ];
    }
    default:
      return [
        {
          id: shortId(),
          agentType: taskReq.agentType,
          description: taskReq.description,
          context: { files: taskReq.repo.files },
          dependencies: [],
        },
      ];
  }
}
