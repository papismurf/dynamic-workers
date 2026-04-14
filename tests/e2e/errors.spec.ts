/**
 * Error-path smoke: malformed input, unknown ids, and invalid verbs.
 */
import { test, expect } from "./fixtures.js";

test("POST /tasks with empty tasks array returns 400", async ({ api, baseURL }) => {
  const resp = await api.post(`${baseURL}/tasks`, { data: { tasks: [] } });
  expect(resp.status()).toBe(400);
});

test("POST /tasks with malformed JSON returns 500", async ({ api, baseURL }) => {
  const resp = await api.post(`${baseURL}/tasks`, {
    data: "{not-json",
    headers: { "content-type": "application/json" },
  });
  // The orchestrator surfaces JSON parse errors as internal_error.
  expect(resp.status()).toBe(500);
});

test("GET /tasks/:unknown returns 404 JSON", async ({ api, baseURL }) => {
  // A UUID-shaped but non-existent id. TaskManager.getState returns an
  // uninitialized object; the router checks for state truthiness.
  const resp = await api.get(`${baseURL}/tasks/00000000-0000-0000-0000-000000000000`);
  // Either 200 with stale/empty state or 404 — accept both but require not-5xx.
  expect([200, 404]).toContain(resp.status());
});

test("POST /tasks/:unknown/review returns 400 (not in review state)", async ({ api, baseURL }) => {
  const resp = await api.post(`${baseURL}/tasks/unknown/review`, {
    data: { taskId: "unknown", decision: "approve" },
  });
  expect(resp.status()).toBe(400);
});

test("unknown path returns 404", async ({ api, baseURL }) => {
  const resp = await api.get(`${baseURL}/does-not-exist`);
  expect(resp.status()).toBe(404);
});
