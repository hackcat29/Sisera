import { z } from "zod";

const Mint = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Asset = z.object({
  name: z.string(),
  symbol: z.string(),
  description: z.string().nullable().optional(),
  logo: z.string().url().nullable().optional(),
  isTradingHalted: z.boolean(),
  underlying: z.object({ symbol: z.string(), type: z.string().nullable() }).nullable(),
  deployments: z.array(z.object({ address: z.string(), network: z.string() })),
});
const Page = z.object({ nodes: z.array(Asset), page: z.object({ hasNextPage: z.boolean() }) });
const DexPairs = z.array(
  z.object({
    chainId: z.string(),
    baseToken: z.object({ address: z.string() }),
    priceUsd: z.string().nullable().optional(),
    liquidity: z.object({ usd: z.number().nullable().optional() }).nullable().optional(),
    volume: z.object({ h24: z.number().nullable().optional() }).nullable().optional(),
    priceChange: z.object({ h24: z.number().nullable().optional() }).nullable().optional(),
    url: z.string().url().optional(),
  }),
);

export type PublicStock = {
  name: string;
  symbol: string;
  underlyingSymbol: string;
  mint: string;
  priceUsd: string | null;
  dexPriceUsd: string | null;
  change24hPct: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  chartUrl: string | null;
  /** The company logo published by the issuer. */
  logoUrl: string | null;
  tradingHalted: boolean;
  fetchedAt: string;
  source: "xstocks";
};

const featuredSymbols = [
  "AAPLx",
  "NVDAx",
  "TSLAx",
  "MSFTx",
  "GOOGLx",
  "AMZNx",
  "METAx",
  "COINx",
  "SPYx",
  "QQQx",
  "MSTRx",
  "HOODx",
  "PLTRx",
  "AMDx",
];

/** Runs async work over items with at most `limit` in flight. */
async function mapLimited<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>) {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        const item = items[index] as T;
        results[index] = await work(item).then(
          (value) => ({ status: "fulfilled", value }) as const,
          (reason) => ({ status: "rejected", reason }) as const,
        );
      }
    }),
  );
  return results;
}

export class XStocksClient {
  private cache: { until: number; value: PublicStock[] } | null = null;
  private catalogue: {
    until: number;
    assets: Array<{ asset: z.infer<typeof Asset>; mint: string }>;
  } | null = null;
  private pending: Promise<PublicStock[]> | null = null;

  constructor(private readonly fetcher: typeof fetch = globalThis.fetch) {}

  /** Every xStocks token deployed on Solana, with DEX prices and 24h activity. */
  async list(): Promise<PublicStock[]> {
    if (this.cache && this.cache.until > Date.now()) return this.cache.value;
    // Serve the previous snapshot while a refresh runs, so a slow provider never blocks a page.
    this.pending ??= this.refresh().finally(() => {
      this.pending = null;
    });
    if (this.cache) {
      // Nobody awaits a background refresh, so its failure must be handled here: an unhandled
      // rejection exits the API process. The stale snapshot keeps serving until the next try.
      this.pending.catch(() => undefined);
      return this.cache.value;
    }
    return this.pending;
  }

  /** The full catalogue changes rarely; it is paged 100 at a time and kept for ten minutes. */
  private async loadCatalogue() {
    if (this.catalogue && this.catalogue.until > Date.now()) return this.catalogue.assets;
    const assets: z.infer<typeof Asset>[] = [];
    for (let page = 0; page < 30; page += 1) {
      const response = await this.fetcher(
        `https://api.xstocks.fi/api/v2/public/assets?network=Solana&page=${page}&pageSize=100`,
        { signal: AbortSignal.timeout(10000) },
      );
      if (!response.ok) {
        if (page === 0) throw new Error(`xStocks returned ${response.status}`);
        break;
      }
      const parsed = Page.parse(await response.json());
      assets.push(...parsed.nodes);
      if (!parsed.page.hasNextPage) break;
    }
    const selected = [
      ...new Map(
        assets.flatMap((asset) => {
          const deployment = asset.deployments.find((item) => item.network === "Solana");
          if (!deployment || !Mint.safeParse(deployment.address).success) return [];
          return [[deployment.address, { asset, mint: deployment.address }] as const];
        }),
      ).values(),
    ];
    this.catalogue = { until: Date.now() + 10 * 60_000, assets: selected };
    return selected;
  }

  private async refresh(): Promise<PublicStock[]> {
    const catalogue = await this.loadCatalogue();
    const batches = Array.from({ length: Math.ceil(catalogue.length / 30) }, (_, index) =>
      catalogue.slice(index * 30, index * 30 + 30).map((item) => item.mint),
    );
    const dexPairs = await mapLimited(batches, 6, async (mints) => {
      const response = await this.fetcher(
        `https://api.dexscreener.com/tokens/v1/solana/${mints.join(",")}`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!response.ok) throw new Error(`DEX Screener returned ${response.status}`);
      return DexPairs.parse(await response.json());
    });
    const mints = new Set(catalogue.map((item) => item.mint));
    const bestPairs = new Map<string, z.infer<typeof DexPairs>[number]>();
    for (const result of dexPairs)
      if (result?.status === "fulfilled")
        for (const pair of result.value) {
          if (pair.chainId !== "solana" || !mints.has(pair.baseToken.address)) continue;
          const current = bestPairs.get(pair.baseToken.address);
          if (!current || (pair.liquidity?.usd ?? 0) > (current.liquidity?.usd ?? 0))
            bestPairs.set(pair.baseToken.address, pair);
        }
    // Keep the previous prices for tokens whose batch failed this round.
    const previous = new Map(this.cache?.value.map((stock) => [stock.mint, stock]));
    const fetchedAt = new Date().toISOString();
    const featured = new Map(featuredSymbols.map((symbol, index) => [symbol, index]));
    const value = catalogue
      .map(({ asset, mint }): PublicStock => {
        const pair = bestPairs.get(mint);
        const prior = previous.get(mint);
        return {
          name: asset.name,
          symbol: asset.symbol,
          underlyingSymbol: asset.underlying?.symbol ?? asset.symbol.replace(/x$/, ""),
          mint,
          priceUsd: null,
          dexPriceUsd: pair?.priceUsd ?? prior?.dexPriceUsd ?? null,
          change24hPct: pair?.priceChange?.h24 ?? prior?.change24hPct ?? null,
          volume24hUsd: pair?.volume?.h24 ?? prior?.volume24hUsd ?? null,
          liquidityUsd: pair?.liquidity?.usd ?? prior?.liquidityUsd ?? null,
          chartUrl: pair?.url ?? prior?.chartUrl ?? null,
          logoUrl: asset.logo?.startsWith("https://") ? asset.logo : null,
          tradingHalted: asset.isTradingHalted,
          fetchedAt: pair ? fetchedAt : (prior?.fetchedAt ?? fetchedAt),
          source: "xstocks",
        };
      })
      .sort((a, b) => {
        const featuredA = featured.get(a.symbol) ?? Number.POSITIVE_INFINITY;
        const featuredB = featured.get(b.symbol) ?? Number.POSITIVE_INFINITY;
        if (featuredA !== featuredB) return featuredA - featuredB;
        return (b.volume24hUsd ?? -1) - (a.volume24hUsd ?? -1);
      });
    this.cache = { until: Date.now() + 60_000, value };
    return value;
  }
}
