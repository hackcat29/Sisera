import { describe, expect, it, vi } from "vitest";
import {
  DeFiLlamaChainProvider,
  HyperliquidPerpProvider,
  JupiterPredictionProvider,
} from "../src/index.js";

const metadata = [
  {
    universe: [
      { name: "BTC", szDecimals: 5 },
      { name: "ETH", szDecimals: 4 },
    ],
  },
  [
    {
      markPx: "84585",
      midPx: null,
      prevDayPx: "83427",
      dayNtlVlm: "3478202957",
      funding: "0.0000125",
      openInterest: "40042",
      oraclePx: "84598",
    },
    { markPx: "2700", prevDayPx: "2650", dayNtlVlm: "1500000" },
  ],
];
const book = {
  coin: "BTC",
  time: 1_790_327_091_934,
  levels: [[{ px: "84584", sz: "6.5" }], [{ px: "84585", sz: "0.5" }]],
};

describe("HyperliquidPerpProvider", () => {
  it("keeps perpetual marks, book quotes, funding, and candles sourced to Hyperliquid", async () => {
    const fetcher = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
      const request = JSON.parse(String(options.body));
      if (request.type === "metaAndAssetCtxs") return new Response(JSON.stringify(metadata));
      if (request.type === "l2Book") return new Response(JSON.stringify(book));
      return new Response(
        JSON.stringify([
          { t: 1_790_327_000_000, o: "84000", h: "84600", l: "83900", c: "84585", v: "100" },
        ]),
      );
    });
    const provider = new HyperliquidPerpProvider("https://example.test", fetcher);
    const instrument = await provider.getInstrument("BTCUSDT");
    const snapshot = await provider.getSnapshot("BTCUSDT");
    const depth = await provider.getOrderBook("BTCUSDT");
    const candles = await provider.getCandles("BTCUSDT", "15m", 30);
    const metrics = await provider.listPerpetualMetrics(["BTC"]);

    expect(instrument).toMatchObject({
      id: "hyperliquid:BTC:perpetual",
      type: "perpetual",
      quoteAsset: "USDC",
    });
    expect(snapshot).toMatchObject({
      bid: "84584",
      ask: "84585",
      last: "84585",
      volume24h: "3478202957",
    });
    expect(snapshot.quality.source).toBe("hyperliquid-perps");
    expect(depth.bids[0]).toEqual({ price: "84584", quantity: "6.5" });
    expect(candles[0]?.close).toBe("84585");
    expect(metrics[0]).toMatchObject({ fundingRate: "0.0000125", openInterestBase: "40042" });
    expect(
      fetcher.mock.calls.filter(
        (call) => JSON.parse(String(call[1].body)).type === "metaAndAssetCtxs",
      ),
    ).toHaveLength(1);
  });

  it("rejects unsupported symbols rather than substituting another market", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(metadata)));
    const provider = new HyperliquidPerpProvider("https://example.test", fetcher);
    await expect(provider.getInstrument("XYZUSDT")).rejects.toMatchObject({
      code: "MARKET_DATA_UNAVAILABLE",
    });
  });

  it("normalizes public account state without treating it as reconciled", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          marginSummary: { accountValue: "1000", totalNtlPos: "250", totalMarginUsed: "50" },
          withdrawable: "950",
          assetPositions: [
            {
              position: {
                coin: "BTC",
                szi: "0.01",
                entryPx: "80000",
                positionValue: "250",
                unrealizedPnl: "2",
                marginUsed: "50",
                liquidationPx: null,
                leverage: { type: "isolated", value: 5 },
              },
            },
          ],
        }),
      ),
    );
    const address = `0x${"1".repeat(40)}`;
    const account = await new HyperliquidPerpProvider(
      "https://example.test",
      fetcher,
    ).getPublicAccount(address);
    expect(account).toMatchObject({
      accountValue: "1000",
      notionalExposure: "250",
      source: "hyperliquid-clearinghouse",
    });
    expect(account.positions[0]).toMatchObject({
      coin: "BTC",
      liquidationPrice: null,
      leverage: 5,
    });
  });
});

describe("DeFiLlamaChainProvider", () => {
  it("sorts sourced TVL and caches the public snapshot", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          { name: "Solana", tvl: 10, tokenSymbol: "SOL" },
          { name: "Ethereum", tvl: 20, tokenSymbol: "ETH", chainId: 1 },
        ]),
      ),
    );
    const provider = new DeFiLlamaChainProvider("https://example.test", fetcher);
    expect((await provider.listChains(1))[0]).toMatchObject({
      name: "Ethereum",
      tvlUsd: 20,
      source: "defillama",
    });
    expect(await provider.listChains(2)).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("JupiterPredictionProvider", () => {
  it("uses only open markets with verified micro USD YES and NO prices", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              metadata: { title: "Test event" },
              markets: [
                { marketId: "unpriced", status: "open", pricing: {} },
                {
                  marketId: "priced",
                  title: "Outcome test",
                  status: "open",
                  closeTime: Math.floor(Date.now() / 1000) + 86400,
                  provider: "polymarket",
                  rulesPrimary: "Official result",
                  pricing: { buyYesPriceUsd: 400000, buyNoPriceUsd: 600000 },
                },
                {
                  marketId: "closed",
                  status: "closed",
                  pricing: { buyYesPriceUsd: 900000, buyNoPriceUsd: 100000 },
                },
              ],
            },
          ],
        }),
      ),
    );
    const provider = new JupiterPredictionProvider("https://example.test", undefined, fetcher);
    const result = await provider.listOpenMarkets(1);
    expect(result[0]?.outcomes.map((outcome) => outcome.probability)).toEqual(["0.4", "0.6"]);
    expect(result).toHaveLength(1);
    expect(result[0]?.provider).toBe("jupiter");
    expect(result[0]?.underlyingProvider).toBe("polymarket");
    expect(result[0]?.resolutionRules).toBe("Official result");
    expect(result[0]?.quality.status).toBe("delayed");
    expect(await provider.listOpenMarkets(1)).toHaveLength(1);
    // The catalog loads once; other requests fetch cover pictures.
    expect(
      fetcher.mock.calls.filter(([url]) => !String(url).includes("/api/v1/events")),
    ).toHaveLength(1);
  });
});
