import type { PredictionMarket } from "@sisera/domain";
import type { MarketEvent } from "@sisera/intelligence";
import { describe, expect, it, vi } from "vitest";
import { predictionInsights, probabilityRsi } from "../src/prediction-insights.js";
import { parseStrikeMarket, researchPredictionMarket } from "../src/prediction-research.js";
const now = Math.floor(Date.now() / 1000);
function market(overrides: Partial<PredictionMarket> = {}): PredictionMarket {
  return {
    id: "market123",
    provider: "panta",
    underlyingProvider: "polymarket",
    title: "Will Team A win the final?",
    closesAt: new Date(Date.now() + 86400000).toISOString(),
    status: "open",
    outcomes: [
      { id: "yes", label: "YES", probability: "0.6" },
      { id: "no", label: "NO", probability: "0.4" },
    ],
    venueTokenIds: ["yes-token"],
    resolutionRules:
      "Resolves according to the official league final result, including extra time. https://example.org/rules",
    quality: {
      status: "live",
      source: "test",
      observedAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      latencyMs: 1,
    },
    ...overrides,
  };
}
const noNetwork = vi.fn<typeof fetch>(async () => {
  throw new Error("Offline");
});
describe("prediction evidence and measures", () => {
  it("uses timestamps, sorts and deduplicates history, and measures moves from zero", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) =>
      String(url).includes("prices-history")
        ? Response.json({
            history: [
              { t: now, p: 0.6 },
              { t: now - 86400, p: 0 },
              { t: now - 86400, p: 0 },
              { t: now - 90000, p: 0.1 },
              { t: now + 60, p: 0.9 },
              { t: now - 100, p: 2 },
            ],
          })
        : Response.json({
            bids: [
              { price: "0.55", size: "10" },
              { price: "NaN", size: "10" },
            ],
            asks: [{ price: "0.65", size: "20" }],
          }),
    );
    const r = await researchPredictionMarket(market(), [], fetcher);
    expect(r.history).toHaveLength(3);
    expect(r.stats.change24hPts).toBe(60);
    expect(r.stats.shareOfTimeAbove50).toBe(0);
    expect(r.stats.dailyVolatilityPts).toBeNull();
    expect(r.orderBook?.spread).toBeCloseTo(0.1);
    expect(r.orderBook?.bidDepthUsd).toBe(5.5);
  });
  it("does not fabricate history, book depth or source success on failures", async () => {
    const r = await researchPredictionMarket(market(), [], noNetwork);
    expect(r.history).toEqual([]);
    expect(r.orderBook).toBeNull();
    expect(r.stats.dailyVolatilityPts).toBeNull();
    expect(r.sources).not.toContain("polymarket-clob");
  });
  it("uses Panta tape for native markets and never sends event IDs to Polymarket", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      expect(String(url)).toContain("/markets/market123/trades/");
      return Response.json({
        items: [
          { signature: "tx1", wallet: "w1", blockTime: now },
          { signature: "tx1", wallet: "w1", blockTime: now },
          { signature: "tx2", wallet: "w2", blockTime: now - 5 },
        ],
      });
    });
    const r = await researchPredictionMarket(
      market({ underlyingProvider: "panta", pricingAvailable: false }),
      [],
      fetcher,
      { baseUrl: "https://live-api.panta.market/api/v1", apiKey: "test" },
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(r.stats.probability).toBeNull();
    expect(r.orderBook).toBeNull();
    expect(r.activity).toMatchObject({ trades: 2, wallets: 2, sampleLimit: 200 });
  });
  it("parses the actual price threshold without mistaking years for strikes", () => {
    expect(
      parseStrikeMarket(market({ title: "Will Bitcoin exceed $120k in 2026?" })),
    ).toMatchObject({ pair: "BTCUSDT", strike: 120000, kind: "settle", direction: "up" });
    expect(parseStrikeMarket(market({ title: "Will Ethereum dip to $2,000?" }))).toMatchObject({
      strike: 2000,
      kind: "touch",
      direction: "down",
    });
    expect(parseStrikeMarket(market({ title: "Will Bitcoin be popular in 2026?" }))).toBeNull();
  });
  it("requires observations for RSI and labels missing pricing and event evidence", async () => {
    expect(probabilityRsi([0.5])).toBeNull();
    expect(probabilityRsi(Array(15).fill(0.5))).toBe(50);
    expect(probabilityRsi(Array.from({ length: 15 }, (_, i) => i / 20))).toBe(100);
    const m = market({ pricingAvailable: false, resolutionRules: null });
    const r = await researchPredictionMarket(m, [], noNetwork);
    const i = await predictionInsights(m, r);
    expect(i.mode).toBe("data");
    expect(i.technical.find((t) => t.label === "Market uncertainty")?.value).toBeNull();
    expect(i.fundamentals.find((t) => t.label === "Resolution criteria")?.status).toBe("missing");
    expect(i.brief.yesCase).toEqual([]);
  });
  it("only accepts AI briefs that cite known evidence and preserves a data fallback", async () => {
    const m = market();
    const r = await researchPredictionMarket(m, [], noNetwork);
    const chat = {
      complete: vi.fn().mockResolvedValue(
        JSON.stringify({
          summary: { text: "Issuer criteria include extra time.", evidenceIds: ["rules"] },
          yesCase: [],
          noCase: [],
          watch: [],
        }),
      ),
    };
    expect((await predictionInsights(m, r, [], chat)).mode).toBe("ai");
    chat.complete.mockResolvedValue(
      JSON.stringify({
        summary: { text: "Invented source", evidenceIds: ["fake"] },
        yesCase: [],
        noCase: [],
        watch: [],
      }),
    );
    expect((await predictionInsights(m, r, [], chat)).mode).toBe("data");
  });
  it("matches BTC to Bitcoin reporting without including other assets sharing a month or high", async () => {
    const m = market({ title: "Will BTC reach a new all-time high by December 31, 2026?" });
    const r = await researchPredictionMarket(m, [], noNetwork);
    const report = (headline: string): MarketEvent => ({
      id: headline,
      headline,
      primaryCategory: "analyst",
      categories: ["analyst"],
      severity: "low",
      sentiment: "neutral",
      certainty: "single_source",
      corroboration: 1,
      rumor: false,
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      impactScore: 0,
      assets: [],
      sources: [],
      basis: [],
    });
    const insights = await predictionInsights(m, r, [
      report("Ethereum forecast for December"),
      report("Solana reaches a new high"),
      report("Analyst forecasts Bitcoin reaching $125,000"),
      report("BTC trading volume rises"),
    ]);
    expect(
      insights.evidence.filter((item) => item.id.startsWith("news-")).map((item) => item.title),
    ).toEqual(["Analyst forecasts Bitcoin reaching $125,000", "BTC trading volume rises"]);
  });
});
