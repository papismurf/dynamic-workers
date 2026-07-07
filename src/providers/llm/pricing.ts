/**
 * Per-model pricing table (USD per 1M tokens). Used to estimate cost from
 * token usage across providers. Prices are approximate and easy to update;
 * unknown models fall back to zero cost (self-hosted models are free).
 */

export interface ModelPrice {
  /** USD per 1,000,000 input tokens. */
  inputPerMTok: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMTok: number;
}

/**
 * Matched by longest-prefix so versioned model ids (e.g.
 * "claude-sonnet-4-20250514") resolve to their family price.
 */
const PRICES: Record<string, ModelPrice> = {
  "claude-sonnet-4": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-opus-4": { inputPerMTok: 15, outputPerMTok: 75 },
  "claude-3-5-haiku": { inputPerMTok: 0.8, outputPerMTok: 4 },
  "gpt-4o-mini": { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  "gpt-4o": { inputPerMTok: 2.5, outputPerMTok: 10 },
  "gpt-4.1": { inputPerMTok: 2, outputPerMTok: 8 },
  "o3-mini": { inputPerMTok: 1.1, outputPerMTok: 4.4 },
  "deepseek-chat": { inputPerMTok: 0.27, outputPerMTok: 1.1 },
  "deepseek-reasoner": { inputPerMTok: 0.55, outputPerMTok: 2.19 },
};

export function priceFor(model: string): ModelPrice | undefined {
  let best: { key: string; price: ModelPrice } | undefined;
  for (const [key, price] of Object.entries(PRICES)) {
    // Require an exact match or a `-`/`.` boundary so "gpt-4o" does not match
    // an unrelated "gpt-4omni". Versioned ids like "gpt-4o-2024-08-06" match.
    const boundary = model.length === key.length || /[-.]/.test(model[key.length] ?? "");
    if (model.startsWith(key) && boundary && (!best || key.length > best.key.length)) {
      best = { key, price };
    }
  }
  return best?.price;
}

/**
 * Estimate cost in USD for a completed call. Returns 0 for unknown models
 * (e.g. self-hosted / open-source) rather than guessing.
 */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const price = priceFor(model);
  if (!price) return 0;
  return (
    (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) /
    1_000_000
  );
}
