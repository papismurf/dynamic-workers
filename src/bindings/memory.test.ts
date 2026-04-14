/**
 * Memory binding tests — namespace scoping, TTL, list-prefix stripping.
 */
import { Memory } from "./memory.js";
import { createFakeKV } from "../../tests/helpers/kv.js";
import { createClock } from "../../tests/helpers/clock.js";

function makeMemory(namespace = "repo:acme/api") {
  const clock = createClock();
  const kv = createFakeKV(clock);
  const mem = new Memory(
    { props: { namespace, kvBinding: kv }, storage: undefined } as never,
    {} as never
  );
  return { mem, kv, clock };
}

describe("Memory binding", () => {
  it("prefixes keys with the namespace when reading and writing", async () => {
    const { mem, kv } = makeMemory("repo:acme/api");
    await mem.set("coding-conventions", "prefer named exports");
    expect(kv._dump()).toEqual({
      "repo:acme/api:coding-conventions": "prefer named exports",
    });
    expect(await mem.get("coding-conventions")).toBe("prefer named exports");
  });

  it("returns null for missing keys", async () => {
    const { mem } = makeMemory();
    expect(await mem.get("nope")).toBeNull();
  });

  it("honors ttlSeconds by expiring entries against the virtual clock", async () => {
    const { mem, clock } = makeMemory();
    await mem.set("ephemeral", "v", 60);
    expect(await mem.get("ephemeral")).toBe("v");
    clock.advance(61_000);
    expect(await mem.get("ephemeral")).toBeNull();
  });

  it("list() returns keys stripped of the namespace prefix", async () => {
    const { mem } = makeMemory("repo:x");
    await mem.set("a/1", "x");
    await mem.set("a/2", "y");
    await mem.set("b/1", "z");
    const keys = await mem.list("a/");
    expect(keys.sort()).toEqual(["a/1", "a/2"]);
  });

  it("delete removes the namespaced entry", async () => {
    const { mem, kv } = makeMemory("ns");
    await mem.set("k", "v");
    await mem.delete("k");
    expect(kv._size()).toBe(0);
  });
});
