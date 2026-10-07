import type { OpenRouterChat } from "@sisera/copilot";
import { closePools, pool } from "@sisera/db";
import type { Candle } from "@sisera/domain";
import type { MarketEvent } from "@sisera/intelligence";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { AssetCatalog, CatalogAsset } from "../src/platform/catalog.js";
import type { HistoryService } from "../src/platform/history.js";
import type { IntelligenceService } from "../src/platform/intelligence-service.js";
import { LiveBasisService } from "../src/platform/live-basis.js";
import { publicEvaluation } from "../src/platform/marketplace-service.js";
import { type EvidenceFill, strategyPerformance } from "../src/platform/strategy-evidence.js";
import {
  ThematicResearchService,
  basketHistory,
  cappedWeights,
} from "../src/platform/thematic-research.js";

afterEach(() => vi.restoreAllMocks());
afterAll(() => closePools());
const now = Date.now();
function feed(
  options: { age?: number; size?: number; funding?: number; usdt?: boolean; fx?: number } = {},
) {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (body.type === "metaAndAssetCtxs")
      return Response.json([
        { universe: [{ name: "BTC" }, { name: "xyz:NVDA" }] },
        [
          { funding: String(options.funding ?? 0.00003), dayNtlVlm: "1000000" },
          { funding: "0.001", dayNtlVlm: "1000000" },
        ],
      ]);
    if (body.type === "l2Book")
      return Response.json({
        coin: "BTC",
        time: Date.now() - (options.age ?? 0),
        levels: [[{ px: "101", sz: String(options.size ?? 1000) }], [{ px: "101.01", sz: "1000" }]],
      });
    return Response.json([
      {
        symbol: options.usdt ? "BTCUSDT" : "BTCUSDC",
        bidPrice: "99.99",
        askPrice: "100",
        bidQty: "1000",
        askQty: "1000",
      },
      {
        symbol: "USDCUSDT",
        bidPrice: String(options.fx ?? 0.999),
        askPrice: "1.001",
        bidQty: "100000",
        askQty: "100000",
      },
    ]);
  });
}
describe("live venue carry", () => {
  it("uses executable prices, variable funding and roundtrip costs", async () => {
    const f = feed();
    const quotes = await new LiveBasisService("https://spot.test", "https://perp.test", f).list(
      5000,
    );
    expect(quotes).toHaveLength(1);
    const q = quotes[0];
    expect(q?.asset).toBe("BTC");
    expect(q?.expectedCarryUsd).toBeCloseTo(108);
    expect(q?.expectedNetUsd).toBeLessThan(108);
    expect(q?.spotPriceUsd).toBe(100);
    expect(q?.perpPriceUsd).toBe(101);
    expect(q).toMatchObject({
      liquidationBufferPct: null,
      settlementBasis: "USDC/USDC",
      recommendedLeverage: 1,
    });
  });
  it("rejects stale and shallow books and handles negative funding", async () => {
    expect(await new LiveBasisService("s", "p", feed({ age: 20000 })).list()).toEqual([]);
    expect(await new LiveBasisService("s", "p", feed({ size: 1 })).list()).toEqual([]);
    const quotes = await new LiveBasisService("s", "p", feed({ funding: -0.00001 })).list();
    expect(quotes[0]?.status).toBe("unfavorable");
  });
  it("converts USDT costs through the current USDC book and rejects depegs", async () => {
    const quotes = await new LiveBasisService("s", "p", feed({ usdt: true })).list();
    expect(quotes[0]?.spotPriceUsd).toBeCloseTo(100 / 0.999);
    expect(quotes[0]?.roundTripFeeBps).toBe(50);
    expect(await new LiveBasisService("s", "p", feed({ usdt: true, fx: 0.9 })).list()).toEqual([]);
  });
  it("never reuses quotes after expiry or fabricates a provider fallback", async () => {
    const f = feed();
    const service = new LiveBasisService("s", "p", f);
    await service.list();
    f.mockRejectedValue(new Error("Offline"));
    await expect(service.list(5000, 30, true)).rejects.toThrow("Offline");
  });
});
const candle = (i: number): Candle => ({
  time: Math.floor(now / 1000) - 86400 * (60 - i),
  open: "100",
  high: "105",
  low: "95",
  close: String(100 + i + (i % 3) * 2),
  volume: "1000",
});
const assets = Array.from(
  { length: 4 },
  (_, i) =>
    ({
      key: `robot${i}`,
      kind: "public_equity",
      symbol: `R${i}x`,
      underlying: `R${i}`,
      name: `Robotics ${i}`,
      sector: "Automation",
      mint: "1".repeat(32),
      priceUsd: 100,
      priceSource: "jupiter-price",
      observedAt: new Date().toISOString(),
      liquidityUsd: 1000000,
      referenceFresh: true,
      tradingHalted: false,
      premiumPct: 1,
    }) as CatalogAsset,
);
function event(a: CatalogAsset): MarketEvent {
  return {
    id: `event:${a.key}`,
    headline: `${a.name} announces robot deployment`,
    lastSeenAt: new Date().toISOString(),
    sentiment: "positive",
    severity: "medium",
    certainty: "confirmed",
    assets: [{ key: a.key, symbol: a.symbol, relevance: 1 }],
    sources: [
      {
        url: `https://source.test/${a.key}`,
        publisher: "Company",
        title: "Robot deployment",
        publishedAt: new Date().toISOString(),
      },
    ],
  } as MarketEvent;
}
function researcher(db?: string, chat: OpenRouterChat | null = null, list = assets) {
  return new ThematicResearchService(
    { list: async () => list } as unknown as AssetCatalog,
    {
      forTopic: async () => list.map(event),
      forAsset: async (a: CatalogAsset) => ({ events: [event(a)] }),
    } as unknown as IntelligenceService,
    {
      equity: async () => ({
        candles: Array.from({ length: 61 }, (_, i) => candle(i)),
        basis: "Exchange share proxy",
      }),
    } as unknown as HistoryService,
    chat,
    db,
  );
}
describe("sourced research", () => {
  it("allocates exact weights within caps and uses common observed history", () => {
    const weights = cappedWeights([10, 1, 1, 1], 35);
    expect(weights.reduce((s, v) => s + v, 0)).toBe(100);
    expect(Math.max(...weights)).toBeLessThanOrEqual(35);
    expect(() => cappedWeights([1, 1], 35)).toThrow();
    expect(basketHistory([{ weightPct: 100, candles: [] }]).sharpe).toBeNull();
    expect(
      basketHistory([{ weightPct: 100, candles: Array.from({ length: 61 }, (_, i) => candle(i)) }])
        .observations,
    ).toBe(60);
  });
  it("creates immutable sourced drafts, rejects forged ownership and invalid forks", async () => {
    const service = researcher();
    const take = await service.compile("alice", "Robotics companies", 10000);
    expect(take.autopilot).toBe(false);
    expect(take.constituents).toHaveLength(4);
    expect(take.research?.sources.length).toBeGreaterThan(0);
    expect(take.metrics.estimatedSharpe).not.toBeNull();
    await expect(service.saved("bob", take.id)).rejects.toThrow("not found");
    await expect(
      service.fork("alice", take.id, undefined, [{ symbol: "R0x", weightPct: 99 }]),
    ).rejects.toThrow("Weights");
    const fork = await service.fork("alice", take.id, 5000);
    expect(fork.forkedFromId).toBe(take.id);
    expect(fork.targetTotalNotionalUsd).toBe(5000);
  });
  it("keeps excess capital unallocated when too few sourced companies meet the cap", async () => {
    const take = await researcher(undefined, null, assets.slice(0, 2)).compile(
      "alice",
      "Robotics",
      10000,
    );
    expect(take.constituents.map((c) => c.weightPct)).toEqual([35, 35]);
    expect(take.cashWeightPct).toBe(30);
    expect(take.cashNotionalUsd).toBe(3000);
    expect(
      take.constituents.reduce((sum, c) => sum + c.targetNotionalUsd, 0) + take.cashNotionalUsd,
    ).toBe(10000);
    expect(take.metrics.estimatedSharpe).not.toBeNull();
  });
  it("rejects invented model keys and evidence citations", async () => {
    const chat = {
      complete: vi
        .fn()
        .mockResolvedValueOnce(JSON.stringify({ keys: ["fake"] }))
        .mockResolvedValueOnce(
          JSON.stringify({
            selections: [{ key: "robot0", evidenceIds: ["fake-source"], score: 10 }],
          }),
        ),
    } as unknown as OpenRouterChat;
    await expect(researcher(undefined, chat).compile("alice", "Robotics")).rejects.toThrow(
      "No sourced",
    );
  });
  it("excludes stale instruments rather than suggesting an example basket", async () => {
    await expect(
      researcher(
        undefined,
        null,
        assets.map((a) => ({ ...a, observedAt: new Date(now - 600000).toISOString() })),
      ).compile("alice", "Robotics"),
    ).rejects.toThrow("No sourced");
  });
});
const db = process.env.MARKETPLACE_TEST_DATABASE_URL;
describe.skipIf(!db)("research persistence", () => {
  it("survives JSONB key ordering, remains account scoped and cannot be edited", async () => {
    if (!db) return;
    const subject = `research:${crypto.randomUUID()}`;
    const take = await researcher(db).compile(subject, "Robotics");
    const loaded = await researcher(db).saved(subject, take.id);
    expect(loaded.id).toBe(take.id);
    await expect(researcher(db).saved("other", take.id)).rejects.toThrow("not found");
    await expect(
      pool(db)`UPDATE thematic_research SET report = '{}' WHERE id = ${take.id}`,
    ).rejects.toThrow("append only");
  });
});
const fill = (
  id: string,
  side: string,
  quantity: number,
  priceUsd: number,
  feeUsd = 1,
): EvidenceFill => ({
  id,
  side,
  quantity,
  priceUsd,
  feeUsd,
  mode: "live",
  venue: "solana",
  instrumentKey: "token",
  signature: null,
  occurredAt: new Date(now + Number(id) * 1000).toISOString(),
  verified: false,
});
describe("strategy performance attribution", () => {
  it("allocates FIFO entry and exit fees and avoids inventing missing cost basis", () => {
    const p = strategyPerformance([fill("1", "buy", 2, 100, 2), fill("2", "sell", 1, 120, 1)]);
    expect(p.feeAdjustedRealizedUsd).toBe(18);
    expect(p.openPositions[0]?.quantity).toBe(1);
    const unknown = strategyPerformance([fill("1", "sell", 2, 120)]);
    expect(unknown.status).toBe("unknown_basis");
    expect(unknown.feeAdjustedRealizedUsd).toBeNull();
  });
  it("deduplicates signatures and separates long and short inventory", () => {
    const buy = { ...fill("1", "buy", 1, 100), signature: "signature" };
    expect(
      strategyPerformance([buy, { ...buy, id: "duplicate" }, fill("2", "sell", 1, 120)]).trades,
    ).toBe(2);
    expect(
      strategyPerformance([
        { ...fill("1", "sell", 1, 120), venue: "hyperliquid" },
        { ...fill("2", "buy", 1, 100), venue: "hyperliquid" },
      ]).feeAdjustedRealizedUsd,
    ).toBe(18);
  });
});

describe("public evaluation evidence", () => {
  it("exposes quantitative evidence while stripping private settings", () => {
    const evidence = publicEvaluation({
      engine: "sisera-backtest-v1",
      liveWallet: "secret",
      perSymbol: [
        {
          entry: "BTCUSDT",
          outcome: "passed",
          years: 5.1,
          metrics: { sharpeRatio: 2, maxDrawdownPct: 8 },
          rules: { private: true },
        },
      ],
    });
    expect(evidence).not.toHaveProperty("liveWallet");
    expect(evidence?.perSymbol?.[0]).not.toHaveProperty("rules");
    expect(evidence?.perSymbol?.[0]?.metrics?.sharpeRatio).toBe(2);
  });
});
