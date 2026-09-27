import { describe, expect, it } from "vitest";
import {
  PythProProvider,
  decimalFromMantissa,
  fairValue,
  parsePythReference,
} from "../src/pyth-pro.js";

const now = 1_750_000_000_000;
const freshUs = String(now * 1000);
const payload = (feedUpdateTimestamp: string) => ({
  parsed: {
    timestampUs: freshUs,
    priceFeeds: [
      {
        priceFeedId: 922,
        price: "12345678",
        confidence: "12000",
        exponent: -5,
        marketSession: "regular",
        feedUpdateTimestamp,
      },
    ],
  },
});

describe("Pyth Pro reference pricing", () => {
  it("preserves decimal precision from mantissa and exponent", () => {
    expect(decimalFromMantissa("12345678", -5)).toBe("123.45678");
    expect(decimalFromMantissa("123", -5)).toBe("0.00123");
    expect(decimalFromMantissa("-100000", -5)).toBe("-1");
  });

  it("distinguishes a fresh feed from a carried-forward equity price", () => {
    expect(
      parsePythReference(payload(freshUs), "Equity.US.AAPL/USD", 922, now).referenceFreshness,
    ).toBe("live");
    const carried = parsePythReference(
      payload(String(now * 1000 - 2_000_000)),
      "Equity.US.AAPL/USD",
      922,
      now,
    );
    expect(carried.referenceFreshness).toBe("carried_forward");
    expect(carried.ageMs).toBe(2000);
    expect(
      parsePythReference(payload(String(now * 1000 - 7_000_000)), "Equity.US.AAPL/USD", 922, now)
        .referenceFreshness,
    ).toBe("stale");
  });

  it("computes divergence only when a real history is available", () => {
    const reference = parsePythReference(payload(freshUs), "Equity.US.AAPL/USD", 922, now);
    const comparison = fairValue("125", reference);
    expect(Number(comparison.premiumDiscountBps)).toBeGreaterThan(100);
    expect(comparison.divergenceZScore).toBeNull();
    expect(comparison.executable).toBe(false);
  });

  it("resolves an equity ticker to its exact Pyth symbol", async () => {
    const calls: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return Response.json(
        calls.length === 1
          ? [
              {
                pyth_lazer_id: 922,
                symbol: "Equity.US.AAPL/USD",
                name: "Apple",
                asset_type: "equity",
              },
            ]
          : payload(freshUs),
      );
    }) as typeof fetch;
    const provider = new PythProProvider(
      "test-key",
      "https://history.test",
      "https://prices.test",
      fetcher,
    );
    const result = await provider.getLatest("AAPL");
    expect(result.symbol).toBe("Equity.US.AAPL/USD");
    expect(calls).toHaveLength(2);
  });

  it("batches listed equities and ignores unrelated symbols", async () => {
    const calls: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return Response.json(
        calls.length === 1
          ? [
              {
                pyth_lazer_id: 922,
                symbol: "Equity.US.AAPL/USD",
                name: "Apple",
                asset_type: "equity",
              },
              {
                pyth_lazer_id: 923,
                symbol: "Equity.US.TSLA/USD",
                name: "Tesla",
                asset_type: "equity",
              },
            ]
          : payload(freshUs),
      );
    }) as typeof fetch;
    const provider = new PythProProvider(
      "test-key",
      "https://history.test",
      "https://prices.test",
      fetcher,
    );
    const result = await provider.getLatestEquities(["AAPL", "UNKNOWN"]);
    expect(result.map((item) => item.symbol)).toEqual(["Equity.US.AAPL/USD"]);
    expect(calls).toHaveLength(2);
  });
});
