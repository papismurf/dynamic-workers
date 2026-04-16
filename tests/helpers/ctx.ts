/**
 * ExecutionContext fake: tracks waitUntil() promises so tests can await
 * background work deterministically.
 */

export interface FakeExecutionContext extends ExecutionContext {
  readonly promises: Promise<unknown>[];
  /** Resolve when all queued waitUntil() promises settle. */
  flush(): Promise<void>;
}

export function createExecutionContext(): FakeExecutionContext {
  const promises: Promise<unknown>[] = [];

  const ctx = {
    waitUntil(promise: Promise<unknown>): void {
      promises.push(
        promise.catch((err) => {
          // Surface unhandled waitUntil errors; tests assert on them if needed.
          // eslint-disable-next-line no-console
          console.error("[ctx.waitUntil] rejected:", err);
          throw err;
        })
      );
    },
    passThroughOnException(): void {
      /* no-op in tests */
    },
    props: {},
    get promises(): Promise<unknown>[] {
      return promises;
    },
    async flush(): Promise<void> {
      // Settle in snapshot-order; waitUntil chains can enqueue more, so loop
      // until the queue stabilizes.
      let i = 0;
      while (i < promises.length) {
        await promises[i]!.catch(() => {
          /* errors already logged */
        });
        i += 1;
      }
    },
  };

  return ctx as unknown as FakeExecutionContext;
}
