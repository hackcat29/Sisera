import { describe, expect, it } from "vitest";
import { JupiterPredictionTradingClient } from "../src/jupiter-prediction.js";
import { settlePredictionPaperOrder } from "../src/prediction-paper.js";

describe("prediction paper orders", () => {
  it("deducts a 0.5% fee, debits cash, and accumulates contracts", () => {
    const initial = { cashUsd: "100", positions: {} };
    const order = {
      marketId: "MARKET-123",
      outcome: "yes" as const,
      depositUsd: "10",
      priceUsd: "0.4",
    };
    const first = settlePredictionPaperOrder(initial, order);
    expect(first.feeUsd).toBe("0.05");
    expect(first.contracts).toBe("24.875");
    expect(first.state.cashUsd).toBe("90");
    const second = settlePredictionPaperOrder(first.state, order);
    expect(second.state.positions["MARKET-123:yes"]).toEqual({
      contracts: "49.75",
      costUsd: "20",
    });
  });

  it("supports selling prediction paper contracts and crediting cash", () => {
    const state = {
      cashUsd: "50",
      positions: {
        "MARKET-123:yes": { contracts: "50", costUsd: "20" },
      },
    };
    const sellResult = settlePredictionPaperOrder(state, {
      marketId: "MARKET-123",
      outcome: "yes",
      depositUsd: "10",
      priceUsd: "0.5",
      side: "sell",
    });
    // Selling 10 / 0.5 = 20 contracts at 0.5 = $10 gross - $0.05 fee = $9.95 net proceeds
    expect(sellResult.contracts).toBe("20");
    expect(sellResult.feeUsd).toBe("0.05");
    expect(sellResult.state.cashUsd).toBe("59.95");
    expect(sellResult.state.positions["MARKET-123:yes"]?.contracts).toBe("30");
  });

  it("rejects an unaffordable order and an invalid outcome price", () => {
    const state = { cashUsd: "5", positions: {} };
    expect(() =>
      settlePredictionPaperOrder(state, {
        marketId: "MARKET-123",
        outcome: "no",
        depositUsd: "10",
        priceUsd: "0.6",
      }),
    ).toThrow("Insufficient paper USDC");
    expect(() =>
      settlePredictionPaperOrder(state, {
        marketId: "MARKET-123",
        outcome: "no",
        depositUsd: "5",
        priceUsd: "1",
      }),
    ).toThrow("price below $1");
  });

  it("quotes an open market without preparing a live transaction", async () => {
    const requests: string[] = [];
    const client = new JupiterPredictionTradingClient("https://example.test", undefined, (async (
      url: string,
    ) => {
      requests.push(url);
      return new Response(
        JSON.stringify(
          url.includes("/markets/")
            ? {
                marketId: "MARKET-123",
                status: "open",
                closeTime: Math.floor(Date.now() / 1000) + 3600,
                rulesPrimary: "Official result",
                pricing: { buyYesPriceUsd: 400000, buyNoPriceUsd: 600000 },
              }
            : { trading_active: true },
        ),
      );
    }) as typeof fetch);
    expect((await client.quote("MARKET-123", false)).priceUsd).toBe("0.600000");
    expect(requests).toHaveLength(2);
    expect(requests.some((url) => url.endsWith("/orders"))).toBe(false);
  });
});
