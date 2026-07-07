import { Semaphore } from "./semaphore.js";

describe("Semaphore", () => {
  it("never exceeds the configured concurrency", async () => {
    const sem = new Semaphore(3);
    let active = 0;
    let peak = 0;
    const task = () =>
      sem.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
      });
    await Promise.all(Array.from({ length: 12 }, task));
    expect(peak).toBeLessThanOrEqual(3);
    expect(active).toBe(0);
  });

  it("releases the permit even when the task throws", async () => {
    const sem = new Semaphore(1);
    await expect(
      sem.run(async () => {
        throw new Error("fail");
      })
    ).rejects.toThrow("fail");
    // If the permit leaked, this second run would hang; a resolved value proves release.
    await expect(sem.run(async () => "ok")).resolves.toBe("ok");
  });

  it("coerces invalid permit counts to at least 1", async () => {
    const sem = new Semaphore(0);
    await expect(sem.run(async () => 42)).resolves.toBe(42);
  });
});
