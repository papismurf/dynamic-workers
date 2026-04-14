/**
 * Shared Playwright fixtures for the e2e suite.
 *
 *   - `api`          request context pointed at the worker
 *   - `taskId`       a freshly-created task id scoped to this test
 *   - `wsUrl`        helper for constructing wss/ws URLs from the baseURL
 *
 * Tests that only need HTTP can take `{ api }`; tests that need to stream
 * should take `{ taskId, wsUrl }` and open a `ws://` connection with the
 * `ws` npm package.
 */
import { test as base, type APIRequestContext } from "@playwright/test";

export interface Fixtures {
  api: APIRequestContext;
  taskId: string;
  wsUrl: (path: string) => string;
}

export const test = base.extend<Fixtures>({
  api: async ({ request }, use) => {
    await use(request);
  },

  taskId: async ({ request, baseURL }, use) => {
    const resp = await request.post(`${baseURL}/tasks`, {
      data: {
        tasks: [
          {
            description: "playwright-e2e task",
            agentType: "codegen",
            repo: {
              owner: "e2e",
              repo: "repo",
              branch: "agent/e2e",
              baseBranch: "main",
              files: {},
            },
          },
        ],
      },
    });
    if (!resp.ok()) {
      throw new Error(
        `Could not create a task fixture (status ${resp.status()}): ${await resp.text()}`
      );
    }
    const body = (await resp.json()) as { taskIds: string[] };
    await use(body.taskIds[0]!);
  },

  wsUrl: async ({ baseURL }, use) => {
    if (!baseURL) throw new Error("baseURL not set");
    const wsBase = baseURL.replace(/^http/, "ws");
    await use((path: string) => `${wsBase}${path}`);
  },
});

export { expect } from "@playwright/test";
