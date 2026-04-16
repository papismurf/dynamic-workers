/**
 * Virtual clock used by the KV TTL simulation and anywhere tests need to
 * control "time" without installing jest fake timers globally. Jest fake
 * timers are still used for setTimeout-based retry/backoff in llm.ts and
 * index.ts self-heal — this clock is a lightweight companion for reading
 * `Date.now()`-style values deterministically.
 */
export interface Clock {
  now(): number;
  advance(ms: number): void;
  set(ms: number): void;
}

export function createClock(start = 1_700_000_000_000): Clock {
  let ts = start;
  return {
    now: () => ts,
    advance: (ms) => {
      ts += ms;
    },
    set: (ms) => {
      ts = ms;
    },
  };
}
