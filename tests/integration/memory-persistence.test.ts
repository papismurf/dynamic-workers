/**
 * Integration: KV-backed agent memory survives across tasks. We write a
 * value via the Memory binding and read it back from a fresh binding
 * instance wired to the same KV namespace — mimicking how a second task
 * picks up conventions learned by the first.
 */
import { Memory } from "../../src/bindings/memory.js";
import { createFakeKV } from "../helpers/kv.js";
import { createClock } from "../helpers/clock.js";

function makeMemory(kv: ReturnType<typeof createFakeKV>, ns: string): Memory {
  return new Memory(
    { props: { namespace: ns, kvBinding: kv }, storage: undefined } as never,
    {} as never
  );
}

it("memory written in one binding is visible to a later binding", async () => {
  const clock = createClock();
  const kv = createFakeKV(clock);

  const writer = makeMemory(kv, "repo:acme/api");
  await writer.set("coding-conventions", "prefer named exports");
  await writer.set("review-patterns", "watch for unbounded loops");

  // Simulate a second task wiring a fresh Memory binding to the same KV.
  const reader = makeMemory(kv, "repo:acme/api");
  expect(await reader.get("coding-conventions")).toBe("prefer named exports");
  expect(await reader.get("review-patterns")).toBe("watch for unbounded loops");

  const keys = await reader.list("");
  expect(keys.sort()).toEqual(["coding-conventions", "review-patterns"]);
});

it("different namespaces are isolated", async () => {
  const clock = createClock();
  const kv = createFakeKV(clock);

  await makeMemory(kv, "repo:a/x").set("k", "A");
  await makeMemory(kv, "repo:b/y").set("k", "B");

  expect(await makeMemory(kv, "repo:a/x").get("k")).toBe("A");
  expect(await makeMemory(kv, "repo:b/y").get("k")).toBe("B");
});
