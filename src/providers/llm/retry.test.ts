import { withRetry } from "./retry.js";

/** Deterministic: inject a no-op sleep so no wall-clock time passes. */
const noSleep = async () => {};

describe("withRetry", () => {
  it("retries retryable failures then succeeds", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("503 service unavailable");
        return "ok";
      },
      "Test",
      { sleep: noSleep }
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("does not retry non-retryable failures", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new Error("400 bad request");
        },
        "Test",
        { sleep: noSleep }
      )
    ).rejects.toThrow(/Test failed after 3 attempts: 400 bad request/);
    expect(attempts).toBe(1);
  });

  it("gives up after maxRetries on persistent retryable failures", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new Error("429 rate limited");
        },
        "Test",
        { sleep: noSleep, maxRetries: 4 }
      )
    ).rejects.toThrow(/failed after 4 attempts/);
    expect(attempts).toBe(4);
  });
});
