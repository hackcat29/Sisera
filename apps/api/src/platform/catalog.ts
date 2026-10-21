import type { UniverseAsset } from "@sisera/intelligence";
import type { PreStock, PreStocksProvider } from "@sisera/market-data";
import type { InstrumentRef } from "@sisera/policy";
import type { ClawpumpDirectory, DirectoryToken } from "../clawpump.js";
import type { LivePriceHub } from "../live-prices.js";
import type { PublicStock, XStocksClient } from "../xstocks.js";
import type { DexScreenerClient, TokenMarket } from "./dexscreener.js";

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOL_MINT = "So11111111111111111111111111111111111111112";

export type AssetKind = "public_equity" | "pre_ipo" | "agent_token";

export type CatalogAsset = {
  key: string;
  kind: AssetKind;
  symbol: string;
  name: string;
  mint: string;
  underlying: string;
  sector: string;
  priceUsd: number | null;
  priceSource: string;
  change1hPct: number | null;
  change24hPct: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  referencePriceUsd: number | null;
  referenceKind: "prestocks_mark" | "public_equity" | null;
  premiumPct: number | null;
  referenceFresh: boolean | null;
  impliedValuationUsd: number | null;
  referenceValuationUsd: number | null;
  tradingHalted: boolean;
  pairedStock: { symbol: string; mint: string } | null;
  imageUrl: string | null;
  observedAt: string;
};

const SECTORS: Array<[RegExp, string]> = [
  [/^(NVDA|AMD|AVGO|INTC|MU|TSM|QCOM|ARM|SKHY|DRAM|SNDK|ASML|MRVL)$/, "Semiconductors"],
  [/^(AAPL|MSFT|ORCL|CRM|ADBE|IBM|CSCO|DELL)$/, "Technology"],
  [/^(GOOGL|GOOG|META|NFLX|DIS|TTWO|RBLX|SPOT)$/, "Communication"],
  [/^(AMZN|TSLA|NKE|MCD|SBUX|HD|GME|AMC|GPRO|CMG|ABNB|UBER)$/, "Consumer"],
  [/^(COIN|HOOD|MSTR|CRCL|GLXY|BMNR|SBET|RIOT|MARA|CLSK)$/, "Crypto equities"],
  [/^(JPM|GS|BAC|MA|V|PYPL|SQ|XYZ|BRK\.B|BRKB|SCHW|AXP)$/, "Financials"],
  [/^(LLY|UNH|JNJ|PFE|MRK|MRNA|ABBV|NVO|TMO)$/, "Healthcare"],
  [/^(PLTR|SNOW|DDOG|NET|CRWD|SHOP|APP|OKTA)$/, "Software"],
  [/^(SPY|QQQ|VTI|IWM|DIA|TQQQ|VOO)$/, "Index ETF"],
  [/^(GLD|SLV|USO|IAU)$/, "Commodities"],
  [/^(KO|PEP|PG|WMT|COST|PM)$/, "Consumer staples"],
  [/^(XOM|CVX|COP)$/, "Energy"],
];
const PRIVATE_SECTORS: Array<[RegExp, string]> = [
  [
    /openai|anthropic|xai|perplexity|mistral|cohere|scale|safe superintelligence|thinking machines|cursor|anysphere/i,
    "Artificial intelligence",
  ],
  [/spacex|starlink|relativity|rocket|blue origin/i, "Aerospace"],
  [/neuralink|biotech|health/i, "Health technology"],
  [/kalshi|polymarket|stripe|revolut|ramp|plaid|chime|klarna|robinhood/i, "Fintech"],
  [/anduril|shield ai|palantir|helsing/i, "Defense technology"],
  [/databricks|canva|figma|notion|discord|epic games|shein|bytedance/i, "Software & internet"],
];

export function sectorFor(ticker: string, name = ""): string {
  const upper = ticker.toUpperCase().replace(/X$/, "");
  const hit = SECTORS.find(([pattern]) => pattern.test(upper));
  if (hit) return hit[1];
  const privateHit = PRIVATE_SECTORS.find(([pattern]) => pattern.test(`${name} ${ticker}`));
  return privateHit?.[1] ?? "Unclassified";
}

const number = (value: string | number | null | undefined) => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * One view over the three Solana stock-linked universes Sisera trades: xStocks public equities,
 * PreStocks private companies and Clawpump agent tokens. Prices come from the freshest executable
 * source available (Jupiter live price, then DEX Screener, then the issuer catalogue); reference
 * values come from PreStocks marks and public equity quotes. Missing values stay null.
 */
export class AssetCatalog {
  private agentCache: { until: number; value: DirectoryToken[] } | null = null;

  constructor(
    private readonly xstocks: XStocksClient,
    private readonly prestocks: PreStocksProvider,
    private readonly directory: ClawpumpDirectory,
    private readonly dex: DexScreenerClient,
    private readonly livePrices: LivePriceHub,
    private readonly equityReferences: (
      tickers: string[],
    ) => Promise<Array<{ symbol: string; price: string; referenceFreshness: string }>>,
  ) {}

  /** The most active agent tokens (up to 500), refreshed every two minutes. */
  async agentTokens(): Promise<DirectoryToken[]> {
    if (this.agentCache && this.agentCache.until > Date.now()) return this.agentCache.value;
    const pages = await Promise.allSettled(
      [0, 100, 200, 300, 400].map((offset) =>
        this.directory.list({ sort: "volume", limit: 100, offset }),
      ),
    );
    const seen = new Set<string>();
    const value = pages
      .flatMap((page) => (page.status === "fulfilled" ? page.value.tokens : []))
      .filter((token) => {
        if (seen.has(token.mint)) return false;
        seen.add(token.mint);
        return true;
      });
    if (value.length) this.agentCache = { until: Date.now() + 120_000, value };
    return value.length ? value : (this.agentCache?.value ?? []);
  }

  async publicStocks(): Promise<PublicStock[]> {
    return this.xstocks.list().catch(() => []);
  }

  async privateStocks(): Promise<PreStock[]> {
    return this.prestocks.list().catch(() => []);
  }

  /** Builds catalog entries. Agent tokens are included only when `includeAgents` is set. */
  async list(
    options: { includeAgents?: boolean; withReferences?: boolean } = {},
  ): Promise<CatalogAsset[]> {
    const [publicStocks, privateStocks, agents] = await Promise.all([
      this.publicStocks(),
      this.privateStocks(),
      options.includeAgents ? this.agentTokens() : Promise.resolve([] as DirectoryToken[]),
    ]);
    const stockByMint = new Map(publicStocks.map((stock) => [stock.mint, stock]));
    const privateByMint = new Map(
      privateStocks.flatMap((stock) =>
        stock.instrument.mint ? [[stock.instrument.mint, stock] as const] : [],
      ),
    );
    const mints = [
      ...privateStocks.flatMap((stock) => (stock.instrument.mint ? [stock.instrument.mint] : [])),
      ...agents.map((token) => token.mint),
    ];
    const [dexMarkets, references] = await Promise.all([
      this.dex.markets(mints),
      options.withReferences
        ? this.equityReferences(
            publicStocks
              .filter((stock) => (stock.liquidityUsd ?? 0) > 1_000)
              .slice(0, 60)
              .map((stock) => stock.underlyingSymbol),
          ).catch(() => [])
        : Promise.resolve([]),
    ]);
    const live = this.livePrices.snapshot([
      ...publicStocks.map((stock) => stock.mint),
      ...mints,
    ]) as Record<
      string,
      { usd: number; change24hPct: number | null; underlyingUsd: number | null; at: number }
    >;
    const referenceByTicker = new Map(
      references.map((reference) => [
        reference.symbol
          .toUpperCase()
          .replace(/^EQUITY\.US\./, "")
          .replace(/\/USD$/, ""),
        reference,
      ]),
    );
    const now = new Date().toISOString();
    const assets: CatalogAsset[] = [];
    for (const stock of publicStocks) {
      const quote = live[stock.mint];
      const price = quote?.usd ?? number(stock.priceUsd) ?? number(stock.dexPriceUsd);
      const reference = referenceByTicker.get(stock.underlyingSymbol.toUpperCase());
      const referencePrice = quote?.underlyingUsd ?? number(reference?.price);
      const referenceFresh =
        quote?.underlyingUsd != null
          ? true
          : reference
            ? reference.referenceFreshness === "live"
            : null;
      assets.push({
        key: stock.symbol,
        kind: "public_equity",
        symbol: stock.symbol,
        name: stock.name,
        mint: stock.mint,
        underlying: stock.underlyingSymbol.toUpperCase(),
        sector: sectorFor(stock.underlyingSymbol, stock.name),
        priceUsd: price,
        priceSource: quote ? "jupiter-price" : stock.dexPriceUsd ? "dexscreener" : "unavailable",
        change1hPct: null,
        change24hPct: quote?.change24hPct ?? stock.change24hPct,
        volume24hUsd: stock.volume24hUsd,
        liquidityUsd: stock.liquidityUsd,
        marketCapUsd: null,
        referencePriceUsd: referencePrice ?? null,
        referenceKind: referencePrice != null ? "public_equity" : null,
        premiumPct: price != null && referencePrice ? (price / referencePrice - 1) * 100 : null,
        referenceFresh,
        impliedValuationUsd: null,
        referenceValuationUsd: null,
        tradingHalted: stock.tradingHalted,
        pairedStock: null,
        imageUrl: stock.logoUrl,
        observedAt: quote ? new Date(quote.at).toISOString() : stock.fetchedAt,
      });
    }
    for (const stock of privateStocks) {
      const mint = stock.instrument.mint ?? "";
      const market = dexMarkets.get(mint);
      const quote = live[mint];
      // DEX Screener's top pool can be quoted in an unrelated token, so it never sets the price here.
      const price = quote?.usd ?? number(stock.tokenPrice);
      const mark = number(stock.markPrice);
      assets.push({
        key: stock.instrument.baseAsset,
        kind: "pre_ipo",
        symbol: stock.instrument.baseAsset,
        name: stock.company,
        mint,
        underlying: stock.company,
        sector: sectorFor(stock.instrument.baseAsset, stock.company),
        priceUsd: price,
        priceSource: quote ? "jupiter-price" : "prestocks-indicative",
        change1hPct: market?.change1hPct ?? null,
        change24hPct: quote?.change24hPct ?? market?.change24hPct ?? null,
        volume24hUsd: market?.volume24hUsd ?? null,
        liquidityUsd: market?.liquidityUsd ?? null,
        marketCapUsd: number(stock.marketCap),
        referencePriceUsd: mark,
        referenceKind: mark != null ? "prestocks_mark" : null,
        premiumPct: price != null && mark ? (price / mark - 1) * 100 : null,
        // PreStocks publishes no mark timestamp, so freshness cannot be asserted.
        referenceFresh: null,
        impliedValuationUsd:
          price != null && mark
            ? (number(stock.markValuation) ?? 0) * (price / mark)
            : number(stock.impliedValuation),
        referenceValuationUsd: number(stock.markValuation),
        tradingHalted: false,
        pairedStock: null,
        imageUrl: stock.imageUrl,
        observedAt: quote
          ? new Date(quote.at).toISOString()
          : (market?.observedAt ?? stock.fetchedAt),
      });
    }
    for (const token of agents) {
      const market = dexMarkets.get(token.mint);
      const quote = live[token.mint];
      const pairedPublic = token.quoteMint ? stockByMint.get(token.quoteMint) : undefined;
      const pairedPrivate = token.quoteMint ? privateByMint.get(token.quoteMint) : undefined;
      const paired = pairedPublic
        ? { symbol: pairedPublic.symbol, mint: pairedPublic.mint }
        : pairedPrivate?.instrument.mint
          ? { symbol: pairedPrivate.instrument.baseAsset, mint: pairedPrivate.instrument.mint }
          : null;
      assets.push({
        key: token.mint,
        kind: "agent_token",
        symbol: token.symbol,
        name: token.agentName ?? token.name,
        mint: token.mint,
        underlying: paired
          ? (pairedPublic?.underlyingSymbol.toUpperCase() ?? paired.symbol)
          : token.mint,
        sector: "Agent tokens",
        priceUsd: quote?.usd ?? token.priceUsd ?? market?.priceUsd ?? null,
        priceSource: quote
          ? "jupiter-price"
          : token.priceUsd != null
            ? "clawpump-directory"
            : market?.priceUsd != null
              ? "dexscreener"
              : "unavailable",
        change1hPct: market?.change1hPct ?? null,
        change24hPct: quote?.change24hPct ?? market?.change24hPct ?? null,
        volume24hUsd: market?.volume24hUsd ?? token.volume24hUsd,
        liquidityUsd: market?.liquidityUsd ?? token.liquidityUsd,
        marketCapUsd: token.marketCapUsd ?? market?.marketCapUsd ?? null,
        referencePriceUsd: null,
        referenceKind: null,
        premiumPct: null,
        referenceFresh: null,
        impliedValuationUsd: null,
        referenceValuationUsd: null,
        tradingHalted: false,
        pairedStock: paired,
        imageUrl: token.imageUrl,
        observedAt: quote ? new Date(quote.at).toISOString() : (market?.observedAt ?? now),
      });
    }
    return assets;
  }

  async byMint(mint: string): Promise<CatalogAsset | null> {
    const assets = await this.list();
    const known = assets.find((asset) => asset.mint === mint);
    if (known) return known;
    const token = await this.directory.find(mint).catch(() => null);
    if (!token) return null;
    this.agentCache = this.agentCache
      ? {
          ...this.agentCache,
          value: [...this.agentCache.value.filter((item) => item.mint !== mint), token],
        }
      : { until: Date.now() + 120_000, value: [token] };
    return (await this.list({ includeAgents: true })).find((asset) => asset.mint === mint) ?? null;
  }

  async byKey(key: string): Promise<CatalogAsset | null> {
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(key)) return this.byMint(key);
    const assets = await this.list({ withReferences: true });
    const lower = key.toLowerCase();
    return (
      assets.find((asset) => asset.key.toLowerCase() === lower) ??
      assets.find(
        (asset) => asset.symbol.toLowerCase() === lower || asset.underlying.toLowerCase() === lower,
      ) ??
      null
    );
  }

  /** Finds the asset a free-text request refers to, preferring exact ticker and name matches. */
  async resolveText(text: string): Promise<CatalogAsset | null> {
    const mint = text.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/)?.[0];
    if (mint) return this.byMint(mint);
    const assets = await this.list({ includeAgents: true });
    let best: { asset: CatalogAsset; score: number } | null = null;
    for (const asset of assets) {
      let score = 0;
      const tickers = [asset.symbol, asset.kind === "public_equity" ? asset.underlying : ""].filter(
        (value) => value.length >= 2,
      );
      for (const ticker of tickers) {
        const ambiguous = [
          "on",
          "it",
          "at",
          "ai",
          "as",
          "all",
          "for",
          "are",
          "so",
          "now",
          "net",
          "open",
        ].includes(ticker.toLowerCase());
        if (ambiguous && text.trim() !== ticker && !text.includes(`$${ticker}`)) continue;
        if (
          new RegExp(
            `(?:\\$|\\b)${ticker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
            asset.kind === "agent_token" ? "" : "i",
          ).test(text)
        )
          score = Math.max(score, ticker === asset.symbol ? 3 : 2.5);
      }
      const name = asset.name
        .replace(/\b(inc|corp|corporation|xstock|class [a-z])\b\.?/gi, "")
        .trim();
      if (
        name.length >= 3 &&
        new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)
      )
        score = Math.max(score, 2.8);
      if (asset.kind === "agent_token") score -= 0.5;
      if (
        score > 0 &&
        (!best ||
          score > best.score ||
          (score === best.score && (asset.liquidityUsd ?? 0) > (best.asset.liquidityUsd ?? 0)))
      )
        best = { asset, score };
    }
    return best?.asset ?? null;
  }

  static toInstrumentRef(asset: CatalogAsset): InstrumentRef {
    return {
      kind: asset.kind,
      symbol: asset.symbol.slice(0, 40),
      mint: asset.mint,
      name: asset.name.slice(0, 120),
    };
  }

  static toUniverse(asset: CatalogAsset): UniverseAsset {
    return {
      key: asset.key,
      symbol: asset.symbol,
      name: asset.name,
      kind: asset.kind,
      aliases: asset.kind === "public_equity" ? [asset.underlying] : [],
      sector: asset.sector,
    };
  }
}

export type { TokenMarket };
