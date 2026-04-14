/**
 * Agent source registry: each AgentType maps to the right embedded source
 * string and WorkerEntrypoint class name. These are the contracts runAgent()
 * relies on when provisioning a Dynamic Worker.
 */
import { getAgentSource } from "./source.js";
import type { AgentType } from "../types.js";

describe("getAgentSource", () => {
  const cases: Array<[AgentType, string]> = [
    ["codegen", "CodeGenAgent"],
    ["refactor", "CodeGenAgent"],
    ["debug", "CodeGenAgent"],
    ["dependency", "CodeGenAgent"],
    ["test", "TestAgent"],
    ["review", "ReviewAgent"],
  ];

  it.each(cases)("%s → entrypoint %s", (agentType, entrypoint) => {
    const { source, entrypoint: found } = getAgentSource(agentType);
    expect(found).toBe(entrypoint);
    expect(source.length).toBeGreaterThan(100);
    expect(source).toContain(`class ${entrypoint}`);
  });

  it("embedded agent source declares a WorkerEntrypoint with run()", () => {
    for (const [type] of cases) {
      const { source } = getAgentSource(type);
      expect(source).toMatch(/extends WorkerEntrypoint/);
      expect(source).toMatch(/async run\(\)/);
    }
  });

  it("codegen, refactor, debug, dependency all share the same source", () => {
    const codegen = getAgentSource("codegen");
    for (const t of ["refactor", "debug", "dependency"] as AgentType[]) {
      expect(getAgentSource(t)).toStrictEqual(codegen);
    }
  });
});
