/**
 * List prices in dollars per million tokens: [input, output]. Kept apart from
 * the client so the estimate is testable without a database.
 */
const PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-haiku-5-5': [0.1, 0.5],
};

export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Estimated cost in millionths of a dollar. Cache reads bill at 0.1x, writes at 1.25x. */
export function estimateCostMicros(model: string, usage: UsageLike): number {
  const [inPrice, outPrice] = PRICES[model] ?? PRICES['claude-opus-5-5'];
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const dollars =
    (usage.input_tokens * inPrice + cacheRead * inPrice * 0.1 + cacheWrite * inPrice * 1.25 + usage.output_tokens * outPrice) /
    1_000_000;
  return Math.round(dollars * 1_000_000);
}
