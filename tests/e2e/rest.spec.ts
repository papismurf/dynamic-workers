/**
 * REST smoke tests — hit the live wrangler dev server across every public
 * endpoint. Assertions focus on status codes and top-level response shape;
 * deep behavior belongs in the integration suite.
 */
import { test, expect } from "./fixtures.js";

test("GET /health returns the service descriptor", async ({ api, baseURL }) => {
  const resp = await api.get(`${baseURL}/health`);
  expect(resp.status()).toBe(200);
  const body = await resp.json();
  expect(body).toMatchObject({
    service: "agent-orchestrator",
    status: "healthy",
  });
});

test("POST /tasks → 201 + taskIds; GET /tasks/:id → 200", async ({ api, baseURL }) => {
  const create = await api.post(`${baseURL}/tasks`, {
    data: {
      tasks: [
        {
          description: "e2e",
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
  expect(create.status()).toBe(201);
  const { taskIds } = (await create.json()) as { taskIds: string[] };
  expect(taskIds).toHaveLength(1);

  const status = await api.get(`${baseURL}/tasks/${taskIds[0]}`);
  expect(status.status()).toBe(200);
  const { task } = (await status.json()) as { task: { id: string } };
  expect(task.id).toBe(taskIds[0]);
});

test("GET /usage returns a usage envelope", async ({ api, baseURL }) => {
  const resp = await api.get(`${baseURL}/usage`);
  expect(resp.status()).toBe(200);
  const body = await resp.json();
  expect(body).toHaveProperty("tasks");
  expect(body).toHaveProperty("aggregate");
});
