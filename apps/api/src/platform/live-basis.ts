import {
  type BasisArbitrageOpportunity,
  calculateBasisArbitrageOpportunities,
} from "@sisera/policy";
import { z } from "zod";

const positive = z.coerce.number().finite().positive();
const Book = z.object({
  coin: z.string(),
  time: z.number(),
  levels: z.tuple([
    z.array(z.object({ px: positive, sz: positive })),
    z.array(z.object({ px: positive, sz: positive })),
  ]),
});
const Metadata = z.tuple([
  z.object({
    universe: z.array(z.object({ name: z.string(), isDelisted: z.boolean().optional() })),
  }),
  z.array(
    z.object({
      funding: z.coerce.number().finite(),
      dayNtlVlm: z.coerce.number().finite().nonnegative(),
    }),
  ),
]);
const Spot = z.object({
  symbol: z.string(),
  bidPrice: positive,
  askPrice: positive,
  bidQty: positive,
  askQty: positive,
});
export type LiveBasis = BasisArbitrageOpportunity & {
  source: string;
  spotSymbol: string;
  perpSymbol: string;
  quoteAgeMs: number;
  availableNotionalUsd: number;
  roundTripFeeBps: number;
  estimatedEntrySpreadCostBps: number;
  holdingDays: number;
  expectedCarryUsd: number;
  expectedNetUsd: number;
  quoteNotionalUsd: number;
  settlementBasis: "USDC/USDC" | "USDT/USDC";
  conversionRate: number;
  fundingVariable: true;
  requiredCapitalUsd: number;
  netReturnOnCapitalAprPct: number;
};

/** Public venue quotes only. No example feed, stale cache fallback, or execution authority. */
export class LiveBasisService {
  private cache: { until: number; notional: number; days: number; value: LiveBasis[] } | null =
    null;
  constructor(
    private readonly binanceUrl: string,
    private readonly hyperliquidUrl: string,
    private readonly fetcher: typeof fetch = globalThis.fetch,
  ) {}
  private async json(url: string, body?: object) {
    const response = await this.fetcher(url, {
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) throw new Error("Live quotes unavailable.");
    return response.json();
  }
  async list(notional = 5000, days = 30, force = false): Promise<LiveBasis[]> {
    if (
      !Number.isFinite(notional) ||
      notional <= 0 ||
      notional > 1_000_000 ||
      !Number.isFinite(days) ||
      days < 1 ||
      days > 365
    )
      throw new Error("Invalid basis quote size or horizon.");
    if (
      !force &&
      this.cache &&
      this.cache.until > Date.now() &&
      this.cache.notional === notional &&
      this.cache.days === days
    )
      return this.cache.value.map((o) => ({
        ...o,
        quoteAgeMs: Date.now() - Date.parse(o.observedAt),
      }));
    const [metaRaw, booksRaw] = await Promise.all([
      this.json(`${this.hyperliquidUrl}/info`, { type: "metaAndAssetCtxs" }),
      this.json(`${this.binanceUrl}/api/v3/ticker/bookTicker`),
    ]);
    const receivedAt = Date.now();
    const meta = Metadata.parse(metaRaw);
    const spots = new Map(
      z
        .array(z.unknown())
        .parse(booksRaw)
        .flatMap((r) => {
          const parsed = Spot.safeParse(r);
          return parsed.success ? [[parsed.data.symbol, parsed.data] as const] : [];
        }),
    );
    const candidates = meta[0].universe
      .flatMap((asset, i) => {
        const context = meta[1][i];
        const spot = spots.get(`${asset.name}USDC`) ?? spots.get(`${asset.name}USDT`);
        const fx = spots.get("USDCUSDT");
        const direct = spot?.symbol.endsWith("USDC");
        if (
          !direct &&
          (!fx ||
            fx.bidPrice > fx.askPrice ||
            Math.abs(fx.bidPrice - 1) > 0.02 ||
            Math.abs(fx.askPrice - 1) > 0.02)
        )
          return [];
        return !asset.isDelisted &&
          /^[A-Z0-9]{2,12}$/.test(asset.name) &&
          context &&
          spot &&
          spot.bidPrice <= spot.askPrice
          ? [{ asset, context, spot, fx, direct }]
          : [];
      })
      .sort((a, b) => b.context.dayNtlVlm - a.context.dayNtlVlm)
      .slice(0, 12);
    const results = await Promise.allSettled(
      candidates.map(async ({ asset, context, spot, fx, direct }) => {
        const book = Book.parse(
          await this.json(`${this.hyperliquidUrl}/info`, { type: "l2Book", coin: asset.name }),
        );
        const bid = book.levels[0][0];
        const ask = book.levels[1][0];
        const age = Date.now() - book.time;
        if (
          book.coin !== asset.name ||
          !bid ||
          !ask ||
          bid.px > ask.px ||
          age < -1000 ||
          age > 10_000 ||
          Date.now() - receivedAt > 10_000
        )
          return null;
        // Match asset units on both legs. Both books must cover the entire requested quantity within 20 bps.
        if (!direct && !fx) return null;
        const conversionRate = direct ? 1 : (fx?.bidPrice ?? 0);
        const spotAskUsd = spot.askPrice / conversionRate;
        const spotBidUsd = spot.bidPrice / (direct ? 1 : (fx?.askPrice ?? 0));
        if (!direct && notional > (fx?.bidQty ?? 0)) return null;
        const quantity = notional / spotAskUsd;
        const depth = book.levels[0]
          .filter((l) => l.px >= bid.px * 0.998)
          .reduce((s, l) => s + l.sz, 0);
        const availableNotionalUsd = Math.min(depth, spot.askQty) * spotAskUsd;
        if (quantity > depth || quantity > spot.askQty) return null;
        let remaining = quantity;
        let proceeds = 0;
        for (const level of book.levels[0]) {
          const size = Math.min(remaining, level.sz);
          proceeds += size * level.px;
          remaining -= size;
          if (remaining <= 1e-12) break;
        }
        if (remaining > 1e-9) return null;
        const perpPrice = proceeds / quantity;
        const observedAt = new Date(book.time).toISOString();
        const base = calculateBasisArbitrageOpportunities([
          {
            asset: asset.name,
            spotVenue: "binance",
            perpVenue: "hyperliquid",
            spotPriceUsd: spotAskUsd,
            perpPriceUsd: perpPrice,
            fundingRateHourlyPct: context.funding * 100,
            borrowCostAprPct: 0,
            observedAt,
          },
        ])[0];
        if (!base) return null;
        // Conservative modeled fees: 10 bps spot and 5 bps perp per side. Actual account tiers vary.
        const roundTripFeeBps = direct ? 30 : 50;
        const spreadBps =
          ((spotAskUsd - spotBidUsd) / spotAskUsd + (ask.px - bid.px) / bid.px) * 10_000;
        const expectedCarryUsd = notional * context.funding * 24 * days;
        const cost = (notional * (roundTripFeeBps + spreadBps)) / 10_000;
        const expectedNetUsd = expectedCarryUsd - cost;
        return {
          ...base,
          netYieldAprPct: (((expectedNetUsd / notional) * 365) / days) * 100,
          status:
            expectedNetUsd > notional * 0.02
              ? "optimal"
              : expectedNetUsd > 0
                ? "viable"
                : "unfavorable",
          source: "binance-bookTicker + hyperliquid-metaAndAssetCtxs/l2Book",
          spotSymbol: spot.symbol,
          perpSymbol: asset.name,
          quoteAgeMs: age,
          availableNotionalUsd,
          roundTripFeeBps,
          estimatedEntrySpreadCostBps: spreadBps,
          holdingDays: days,
          expectedCarryUsd,
          expectedNetUsd,
          quoteNotionalUsd: notional,
          settlementBasis: direct ? "USDC/USDC" : "USDT/USDC",
          conversionRate,
          fundingVariable: true,
          requiredCapitalUsd: notional * 2,
          netReturnOnCapitalAprPct: (((expectedNetUsd / (notional * 2)) * 365) / days) * 100,
        } as LiveBasis;
      }),
    );
    const value = results
      .flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []))
      .sort((a, b) => b.netYieldAprPct - a.netYieldAprPct);
    this.cache = { until: Date.now() + 3000, notional, days, value };
    return value;
  }
}
