/**
 * Minimal in-memory DurableObjectStorage shaped after the subset used by
 * state.ts (get, put, delete, list). Sufficient for unit + integration tests
 * of TaskManager and CostTracker.
 */
export class InMemoryStorage {
  private readonly map = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    // Structured-clone semantics aren't critical for our tests, but a shallow
    // JSON round-trip catches accidental non-serializable state.
    this.map.set(key, JSON.parse(JSON.stringify(value)));
  }

  async delete(key: string): Promise<boolean> {
    return this.map.delete(key);
  }

  async list<T = unknown>(): Promise<Map<string, T>> {
    return new Map(this.map) as Map<string, T>;
  }
}
