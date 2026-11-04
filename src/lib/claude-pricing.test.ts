import { describe, expect, it } from "vitest";
import { costBreakdown, costInDollars, ratesFor, type UsageFigures } from "./claude-pricing";

const MILLION = 1_000_000;
const figures = (overrides: Partial<UsageFigures>): UsageFigures => ({
  model: "claude-opus-5-5",
  speed: "standard",
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  webSearchRequests: 0,
  ...overrides,
});

describe("ratesFor", () => {
  it.each([
    ["claude-fable-5-1", { input: 10, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 0.25, output: 50 }],
    ["claude-opus-5-5", { input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20 }],
    ["claude-opus-4-8", { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 }],
    ["claude-sonnet-5-5", { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1, output: 10 }],
    ["claude-haiku-5-5", { input: 0.1, cacheWrite5m: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01, output: 0.5 }],
  ])("has the published prices of %s", (model, expected) => {
    expect(ratesFor(model, "standard", 0)).toEqual(expected);
  });

  it("charges Haiku 5.5 more above 100,000 tokens of prompt, and not at it", () => {
    expect(ratesFor("claude-haiku-5-5", "standard", 100_000)?.input).toBe(0.1);
    expect(ratesFor("claude-haiku-5-5", "standard", 100_001)).toEqual({
      input: 0.5,
      cacheWrite5m: 0.625,
      cacheWrite1h: 1,
      cacheRead: 0.05,
      output: 2.5,
    });
  });

  it("does not charge other models by the length of the prompt", () => {
    expect(ratesFor("claude-opus-5-5", "standard", 900_000)?.input).toBe(4);
  });

  it("doubles fast mode on the models that have it, cache included", () => {
    expect(ratesFor("claude-opus-5-5", "fast", 0)).toEqual({
      input: 8,
      output: 40,
      cacheRead: 0.4,
      cacheWrite5m: 10,
      cacheWrite1h: 16,
    });
    expect(ratesFor("claude-opus-4-8", "fast", 0)).toMatchObject({ input: 10, output: 50 });
    expect(ratesFor("claude-sonnet-5-5", "fast", 0)?.input).toBe(2);
  });

  it("recognises a model written with its date", () => {
    expect(ratesFor("claude-opus-4-5-20251101", "standard", 0)?.input).toBe(5);
  });

  it("knows nothing of an unknown model", () => {
    expect(ratesFor("claude-future-9", "standard", 0)).toBeNull();
  });
});

describe("costBreakdown", () => {
  it("tells apart what each kind of token costs", () => {
    expect(
      costBreakdown(
        figures({
          inputTokens: MILLION,
          outputTokens: MILLION,
          cacheReadTokens: MILLION,
          cacheWrite5mTokens: MILLION,
          cacheWrite1hTokens: MILLION,
          webSearchRequests: 100,
        }),
        0,
      ),
    ).toEqual({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 13, webSearch: 1 });
  });

  it("has nothing to say about an unknown model", () => {
    expect(costBreakdown(figures({ model: "claude-future-9" }), 0)).toBeNull();
  });
});

describe("costInDollars", () => {
  it("prices each kind of token at its own rate", () => {
    const cost = costInDollars(
      figures({
        inputTokens: MILLION,
        outputTokens: MILLION,
        cacheReadTokens: MILLION,
        cacheWrite5mTokens: MILLION,
        cacheWrite1hTokens: MILLION,
      }),
      0,
    );
    expect(cost).toBeCloseTo(4 + 20 + 0.2 + 5 + 8);
  });

  it("adds web searches, at $10 per thousand", () => {
    expect(costInDollars(figures({ webSearchRequests: 3 }), 0)).toBeCloseTo(0.03);
  });

  it("does not take an unknown model for a free one", () => {
    expect(costInDollars(figures({ model: "claude-future-9", outputTokens: MILLION }), 0)).toBeNull();
  });
});
