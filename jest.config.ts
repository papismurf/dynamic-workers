/**
 * Jest configuration for the Agent Orchestrator test suite.
 *
 * - ESM + ts-jest: the source tree is "type": "module", so tests run through
 *   ts-jest's ESM preset with `--experimental-vm-modules` (see npm scripts).
 * - Two projects: "unit" for fast, colocated *.test.ts files and "integration"
 *   for end-to-end flows under tests/integration/.
 * - `cloudflare:workers` is not resolvable in Node. moduleNameMapper rewrites
 *   it (and its `node:` sibling) to a test shim in tests/helpers/ that
 *   implements just enough of DurableObject / WorkerEntrypoint / RpcTarget /
 *   exports for unit tests to exercise real source behavior.
 * - The source uses NodeNext-style `.js` specifiers in some places; jest has
 *   to undo that at resolution time so ts-jest can find the real `.ts` file.
 * - Coverage gates at 80% lines/branches for /src — tests themselves are
 *   excluded via `collectCoverageFrom`.
 */
import type { Config } from "jest";

const shared: Partial<Config> = {
  preset: "ts-jest/presets/default-esm",
  extensionsToTreatAsEsm: [".ts"],
  testEnvironment: "node",
  moduleNameMapper: {
    // Strip `.js` from relative import specifiers so ts-jest can resolve the
    // real `.ts` files on disk.
    "^(\\.{1,2}/.*)\\.js$": "$1",
    // Redirect the virtual `cloudflare:workers` module to our in-repo shim.
    "^cloudflare:workers$": "<rootDir>/tests/helpers/cloudflare-workers.ts",
    // Same treatment for the bundler — called inside runAgent() but never
    // needed for behavior under test.
    "^@cloudflare/worker-bundler$":
      "<rootDir>/tests/helpers/worker-bundler.ts",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "tsconfig.test.json",
        diagnostics: {
          // Tests build a lot of partial/fake Env-like objects; relax only
          // the specific noise that doesn't improve test quality.
          ignoreCodes: ["TS151001"],
        },
      },
    ],
  },
  // Deterministic tests: no real timers, no wall-clock sleeps.
  fakeTimers: { enableGlobally: false },
  clearMocks: true,
  restoreMocks: true,
};

const config: Config = {
  ...shared,
  projects: [
    {
      ...shared,
      displayName: "unit",
      // Colocated unit tests live next to their source files.
      testMatch: ["<rootDir>/src/**/*.test.ts"],
    },
    {
      ...shared,
      displayName: "integration",
      testMatch: ["<rootDir>/tests/integration/**/*.test.ts"],
      // Integration tests may set up broader fixtures; give them longer.
      testTimeout: 15000,
    },
  ],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.test.ts",
    "!src/env.d.ts",
    // Agent source strings are executed inside Dynamic Workers, not Node —
    // they're covered through their public entry (getAgentSource lookup).
    "!src/agents/codegen.ts",
    "!src/agents/review.ts",
    "!src/agents/test.ts",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};

export default config;
