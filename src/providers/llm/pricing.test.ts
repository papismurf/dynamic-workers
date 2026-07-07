import { estimateCostUsd, priceFor } from "./pricing.js";

describe("pricing", () => {
  it("matches versioned model ids by longest prefix", () => {
    expect(priceFor("claude-sonnet-4-20250514")).toEqual({
      inputPerMTok: 3,
      outputPerMTok: 15,
    });
    expect(priceFor("gpt-4o-mini")?.inputPerMTok).toBe(0.15);
    // gpt-4o (not mini) resolves to the gpt-4o price, not gpt-4o-mini.
    expect(priceFor("gpt-4o-2024-08-06")?.inputPerMTok).toBe(2.5);
  });

  it("estimates cost from token usage", () => {
    // 1M input @ $3 + 1M output @ $15 = $18
    expect(estimateCostUsd("claude-sonnet-4", 1_000_000, 1_000_000)).toBeCloseTo(18);
  });

  it("returns 0 for unknown / self-hosted models", () => {
    expect(priceFor("llama3")).toBeUndefined();
    expect(estimateCostUsd("llama3", 1000, 1000)).toBe(0);
  });
});
