/**
 * Performance sanity check — submit N tasks concurrently, assert that no
 * response is 5xx and the p95 latency of /tasks POST is under the configured
 * threshold. Not a substitute for a real load test; guards against obvious
 * regressions like serialization bottlenecks or DO contention introduced
 * during refactors.
 *
 * Tune via PLAYWRIGHT_P95_MS (see playwright.config.ts).
 */
import { test, expect } from "./fixtures.js";

const CONCURRENCY = Number(process.env.PLAYWRIGHT_PERF_CONCURRENCY ?? 20);
const P95_MS = Number(process.env.PLAYWRIGHT_P95_MS ?? (process.env.CI ? 2000 : 750));

test(`POST /tasks x${CONCURRENCY} concurrent: no 5xx, p95 < ${P95_MS}ms`, async ({ api, baseURL }) => {
  const body = {
    tasks: [
      {
        description: "perf",
        agentType: "codegen",
        repo: {
          owner: "e2e",
          repo: "perf",
          branch: "agent/perf",
          baseBranch: "main",
          files: {},
        },
      },
    ],
  };

  const latencies: number[] = [];
  const statuses: number[] = [];

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      const start = performance.now();
      const resp = await api.post(`${baseURL}/tasks`, { data: body });
      latencies.push(performance.now() - start);
      statuses.push(resp.status());
    })
  );

  const fiveXX = statuses.filter((s) => s >= 500);
  expect(fiveXX).toEqual([]);

  latencies.sort((a, b) => a - b);
  const p95 = latencies[Math.floor(latencies.length * 0.95)]!;
  expect(p95).toBeLessThan(P95_MS);
});
