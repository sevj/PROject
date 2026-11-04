/** The day the prices below were read from https://platform.claude.com/docs/en/about-claude/pricing */
export const PRICES_CHECKED_ON = "2026-11-04";

/** Dollars per million tokens. */
export type Rates = { input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number };

export type UsageFigures = {
  model: string;
  speed: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  webSearchRequests: number;
};

const WEB_SEARCH_DOLLARS = 10 / 1000;

/** Above this, Haiku 5.5 charges more for the whole request, cached tokens counted in. */
export const LONG_PROMPT_TOKENS = 100_000;

/** Cache writes are the same multiple of the input price on every model. Cache reads are not. */
const rates = (input: number, cacheRead: number, output: number): Rates => ({
  input,
  output,
  cacheRead,
  cacheWrite5m: input * 1.25,
  cacheWrite1h: input * 2,
});

const OPUS = rates(5, 0.5, 25);
const OPUS_OLD = rates(15, 1.5, 75);
const SONNET = rates(3, 0.3, 15);

const PRICES: Readonly<Record<string, Rates>> = {
  "claude-fable-5-1": rates(10, 0.25, 50),
  "claude-mythos-5-1": rates(10, 0.25, 50),
  "claude-fable-5": rates(10, 1, 50),
  "claude-mythos-5": rates(10, 1, 50),
  "claude-opus-5-5": rates(4, 0.2, 20),
  "claude-opus-5": OPUS,
  "claude-opus-4-8": OPUS,
  "claude-opus-4-7": OPUS,
  "claude-opus-4-6": OPUS,
  "claude-opus-4-5": OPUS,
  "claude-opus-4-1": OPUS_OLD,
  "claude-opus-4": OPUS_OLD,
  "claude-sonnet-5-5": rates(2, 0.1, 10),
  "claude-sonnet-5": rates(2, 0.2, 10),
  "claude-sonnet-4-6": SONNET,
  "claude-sonnet-4-5": SONNET,
  "claude-sonnet-4": SONNET,
  "claude-haiku-5-5": rates(0.1, 0.01, 0.5),
  "claude-haiku-4-5": rates(1, 0.1, 5),
  "claude-3-5-haiku": rates(0.8, 0.08, 4),
};

const HAIKU_5_5_LONG = rates(0.5, 0.05, 2.5);

/** Fast mode doubles every token price of these models, cache included. */
const FAST_MODELS: ReadonlySet<string> = new Set(["claude-opus-5-5", "claude-opus-5", "claude-opus-4-8"]);

const scale = (base: Rates, factor: number): Rates => ({
  input: base.input * factor,
  output: base.output * factor,
  cacheRead: base.cacheRead * factor,
  cacheWrite5m: base.cacheWrite5m * factor,
  cacheWrite1h: base.cacheWrite1h * factor,
});

/** Older models are written with the date of their snapshot, which does not change the price. */
const baseModel = (model: string) => model.replace(/-\d{8}$/, "");

/** What a price is known for, and nothing else: a model missing here is not a free model. */
export function ratesFor(model: string, speed: string | null, promptTokens: number): Rates | null {
  const id = baseModel(model);
  const base = id === "claude-haiku-5-5" && promptTokens > LONG_PROMPT_TOKENS ? HAIKU_5_5_LONG : PRICES[id];
  if (!base) return null;
  return speed === "fast" && FAST_MODELS.has(id) ? scale(base, 2) : base;
}

export type CostBreakdown = { input: number; output: number; cacheRead: number; cacheWrite: number; webSearch: number };

/**
 * What these figures would cost at the API's prices, or null when the model has no known
 * price. `promptTokens` is the prompt of one call, which figures added up cannot tell.
 */
export function costBreakdown(figures: UsageFigures, promptTokens: number): CostBreakdown | null {
  const prices = ratesFor(figures.model, figures.speed, promptTokens);
  if (!prices) return null;
  return {
    input: (figures.inputTokens * prices.input) / 1_000_000,
    output: (figures.outputTokens * prices.output) / 1_000_000,
    cacheRead: (figures.cacheReadTokens * prices.cacheRead) / 1_000_000,
    cacheWrite:
      (figures.cacheWrite5mTokens * prices.cacheWrite5m + figures.cacheWrite1hTokens * prices.cacheWrite1h) / 1_000_000,
    webSearch: figures.webSearchRequests * WEB_SEARCH_DOLLARS,
  };
}

export function costInDollars(figures: UsageFigures, promptTokens: number): number | null {
  const parts = costBreakdown(figures, promptTokens);
  return parts && parts.input + parts.output + parts.cacheRead + parts.cacheWrite + parts.webSearch;
}
