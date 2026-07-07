/**
 * Minimal counting semaphore used to bound how many agents run concurrently.
 * Different LLM backends have very different parallelism ceilings (hosted APIs
 * vs. a single local GPU), so the orchestrator caps in-flight agents. See the
 * concurrency section of docs/platform-agnostic-feasibility.md.
 */
export class Semaphore {
  private available: number;
  private readonly queue: Array<() => void> = [];

  constructor(permits: number) {
    this.available = Math.max(1, Math.floor(permits));
  }

  private async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.available += 1;
    }
  }

  /** Run `fn` while holding a permit, releasing it even on error. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
