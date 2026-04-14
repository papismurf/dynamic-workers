/**
 * In-memory KVNamespace fake. Implements the subset of the KV API used by
 * src/bindings/memory.ts: get / put / list (by prefix) / delete, with
 * optional TTL support that honors a virtual clock.
 */

import type { Clock } from "./clock.js";

export interface FakeKV extends KVNamespace {
  /** Testing hook: dump all current entries (post-TTL). */
  _dump(): Record<string, string>;
  /** Testing hook: count entries without triggering list(). */
  _size(): number;
}

interface Entry {
  value: string;
  expiresAt?: number;
}

export function createFakeKV(clock: Clock): FakeKV {
  const store = new Map<string, Entry>();

  const isExpired = (entry: Entry): boolean =>
    entry.expiresAt !== undefined && entry.expiresAt <= clock.now();

  const sweep = (): void => {
    for (const [k, v] of store) {
      if (isExpired(v)) store.delete(k);
    }
  };

  const kv = {
    async get(
      key: string,
      _typeOrOptions?: unknown
    ): Promise<string | null> {
      const entry = store.get(key);
      if (!entry) return null;
      if (isExpired(entry)) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },

    async getWithMetadata(): Promise<never> {
      throw new Error("getWithMetadata not implemented in fake KV");
    },

    async put(
      key: string,
      value: string | ArrayBuffer | ReadableStream,
      options?: KVNamespacePutOptions
    ): Promise<void> {
      if (typeof value !== "string") {
        throw new Error("Fake KV only supports string values");
      }
      const entry: Entry = { value };
      if (options?.expirationTtl) {
        entry.expiresAt = clock.now() + options.expirationTtl * 1000;
      }
      if (options?.expiration) {
        entry.expiresAt = options.expiration * 1000;
      }
      store.set(key, entry);
    },

    async delete(key: string): Promise<void> {
      store.delete(key);
    },

    async list(options?: KVNamespaceListOptions): Promise<KVNamespaceListResult<unknown, string>> {
      sweep();
      const prefix = options?.prefix ?? "";
      const keys = Array.from(store.keys())
        .filter((k) => k.startsWith(prefix))
        .sort()
        .map((name) => ({ name }));
      return {
        keys,
        list_complete: true,
        cacheStatus: null,
      } as unknown as KVNamespaceListResult<unknown, string>;
    },

    _dump(): Record<string, string> {
      sweep();
      return Object.fromEntries(
        Array.from(store.entries()).map(([k, v]) => [k, v.value])
      );
    },

    _size(): number {
      sweep();
      return store.size;
    },
  };

  return kv as unknown as FakeKV;
}
