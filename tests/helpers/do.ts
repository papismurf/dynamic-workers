/**
 * Durable Object namespace + stub fakes.
 *
 * src/index.ts calls env.TASK_MANAGER.idFromName(taskId).get(id) and then
 * treats the stub as a plain RPC object. We build a matching shape: each
 * idFromName(name) returns a synthetic DurableObjectId; get(id) instantiates
 * the DO class with a FakeCtx whose storage is scoped by id name. Subsequent
 * calls to get(id) return a stub backed by the *same* instance so state
 * persists across lookups, matching real DO semantics.
 */

import type { DurableObject } from "cloudflare:workers";
import { InMemoryStorage } from "./storage.js";

type DOConstructor<T extends DurableObject = DurableObject> = new (
  ctx: unknown,
  env: unknown
) => T;

export interface FakeDurableObjectNamespace<T extends DurableObject> extends DurableObjectNamespace {
  /** Testing hook: get the underlying instance for a name without the stub proxy. */
  _instanceFor(name: string): T;
}

export function createDONamespace<T extends DurableObject>(
  Klass: DOConstructor<T>,
  env: unknown
): FakeDurableObjectNamespace<T> {
  const instances = new Map<string, T>();

  const get = (name: string): T => {
    let inst = instances.get(name);
    if (!inst) {
      const ctx = { storage: new InMemoryStorage(), props: {} };
      inst = new Klass(ctx, env);
      instances.set(name, inst);
    }
    return inst;
  };

  const ns = {
    idFromName(name: string): DurableObjectId {
      // Encode the lookup key in the id so `get()` can recover it.
      return { toString: () => name, equals: () => false, name } as unknown as DurableObjectId;
    },
    newUniqueId(): DurableObjectId {
      const name = `unique-${Math.random().toString(36).slice(2)}`;
      return this.idFromName(name);
    },
    idFromString(s: string): DurableObjectId {
      return this.idFromName(s);
    },
    get(id: DurableObjectId): DurableObjectStub {
      const name = (id as unknown as { name?: string }).name ?? id.toString();
      const instance = get(name);
      // Production code in index.ts coerces stubs into typed RPC objects —
      // we return the raw instance so method calls land on real code.
      return instance as unknown as DurableObjectStub;
    },
    jurisdiction(): FakeDurableObjectNamespace<T> {
      return ns;
    },
    _instanceFor(name: string): T {
      return get(name);
    },
  };

  return ns as unknown as FakeDurableObjectNamespace<T>;
}
