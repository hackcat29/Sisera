import { Buffer } from "node:buffer";
import type {
  Candle,
  Instrument,
  MarketSnapshot,
  OrderBook,
  PredictionMarket,
} from "@sisera/domain";
import { z } from "zod";
import { MarketDataUnavailableError } from "./errors.js";

export { MarketDataUnavailableError } from "./errors.js";
export { PreStocksProvider, type PreStock } from "./prestocks.js";
export { FredMacroProvider, classifyMacro, type MacroRegime } from "./fred-macro.js";
export {
  PythCoreProvider,
  decimalFromMantissa,
  fairValue,
  parsePythReference,
  type PythReference,
} from "./pyth-core.js";

export interface MarketDataProvider {
  readonly id: string;
  getInstrument(symbol: string): Promise<Instrument>;
  getSnapshot(symbol: string): Promise<MarketSnapshot>;
}

export type ReferenceMarket = {
  symbol: string;
  name: string;
  priceUsd: number;
  change24hPct: number | null;
  volume24hUsd: number | null;
  observedAt: string;
  source: "coingecko";
};

const referenceIds: Record<string, string> = {
  BTCUSDT: "bitcoin",
  ETHUSDT: "ethereum",
  SOLUSDT: "solana",
  BNBUSDT: "binancecoin",
  XRPUSDT: "ripple",
  DOGEUSDT: "dogecoin",
  ADAUSDT: "cardano",
  AVAXUSDT: "avalanche-2",
  LINKUSDT: "chainlink",
  SUIUSDT: "sui",
  LTCUSDT: "litecoin",
  TRXUSDT: "tron",
};

const CoinGeckoMarket = z.object({
  id: z.string(),
  name: z.string(),
  current_price: z.number().positive().nullable(),
  price_change_percentage_24h: z.number().nullable(),
  total_volume: z.number().nonnegative().nullable(),
  last_updated: z.string().datetime(),
});

export class CoinGeckoReferenceProvider {
  private cache: { symbols: string[]; until: number; rows: ReferenceMarket[] } | null = null;

  constructor(
    private readonly baseUrl = "https://api.coingecko.com",
    private readonly fetcher: Fetch = globalThis.fetch,
  ) {}

  async list(symbols: readonly string[]): Promise<ReferenceMarket[]> {
    const requested = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))].filter(
      (symbol) => referenceIds[symbol],
    );
    if (requested.length === 0) return [];
    if (
      this.cache &&
      this.cache.until > Date.now() &&
      requested.every((symbol) => this.cache?.symbols.includes(symbol))
    ) {
      const bySymbol = new Map(this.cache.rows.map((row) => [row.symbol, row]));
      return requested.flatMap((symbol) => {
        const row = bySymbol.get(symbol);
        return row ? [row] : [];
      });
    }
    const ids = requested.map((symbol) => referenceIds[symbol]);
    let response: Response;
    try {
      response = await this.fetcher(
        `${this.baseUrl}/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids.join(","))}&price_change_percentage=24h`,
        { headers: { accept: "application/json" }, signal: AbortSignal.timeout(6000) },
      );
    } catch {
      throw new MarketDataUnavailableError("CoinGecko reference data request failed");
    }
    if (!response.ok) throw new MarketDataUnavailableError(`CoinGecko returned ${response.status}`);
    const payload = z.array(CoinGeckoMarket).parse(await response.json());
    const byId = new Map(payload.map((row) => [row.id, row]));
    const rows = requested.flatMap((symbol) => {
      const market = byId.get(referenceIds[symbol] ?? "");
      if (!market?.current_price) return [];
      return [
        {
          symbol,
          name: market.name,
          priceUsd: market.current_price,
          change24hPct: market.price_change_percentage_24h,
          volume24hUsd: market.total_volume,
          observedAt: market.last_updated,
          source: "coingecko" as const,
        },
      ];
    });
    this.cache = { symbols: requested, until: Date.now() + 60_000, rows };
    return rows;
  }
}

type Fetch = typeof globalThis.fetch;

const HyperliquidMeta = z.tuple([
  z.object({
    universe: z.array(
      z.object({
        name: z.string(),
        szDecimals: z.number().int(),
        isDelisted: z.boolean().optional(),
      }),
    ),
  }),
  z.array(
    z.object({
      markPx: z.string().optional(),
      midPx: z.string().nullish(),
      prevDayPx: z.string().optional(),
      dayNtlVlm: z.string().optional(),
      funding: z.string().optional(),
      openInterest: z.string().optional(),
      oraclePx: z.string().optional(),
    }),
  ),
]);
const HyperliquidBook = z.object({
  coin: z.string(),
  time: z.number().int(),
  levels: z.tuple([
    z.array(z.object({ px: z.string(), sz: z.string() })),
    z.array(z.object({ px: z.string(), sz: z.string() })),
  ]),
});
const HyperliquidCandles = z.array(
  z.object({
    t: z.number().int(),
    o: z.string(),
    h: z.string(),
    l: z.string(),
    c: z.string(),
    v: z.string(),
  }),
);

export type PerpetualMetric = {
  symbol: string;
  markPrice: string;
  oraclePrice: string | null;
  fundingRate: string | null;
  openInterestBase: string | null;
  volume24hUsd: string | null;
  observedAt: string;
  source: "hyperliquid-perps";
};

const HyperliquidAccountState = z.object({
  marginSummary: z.object({
    accountValue: z.string(),
    totalNtlPos: z.string(),
    totalMarginUsed: z.string(),
  }),
  withdrawable: z.string(),
  assetPositions: z.array(
    z.object({
      position: z.object({
        coin: z.string(),
        szi: z.string(),
        entryPx: z.string(),
        positionValue: z.string(),
        unrealizedPnl: z.string(),
        marginUsed: z.string(),
        liquidationPx: z.string().nullish(),
        leverage: z.object({ type: z.string(), value: z.number() }),
      }),
    }),
  ),
});

export type PublicPerpAccount = {
  address: string;
  accountValue: string;
  notionalExposure: string;
  marginUsed: string;
  withdrawable: string;
  positions: Array<{
    coin: string;
    size: string;
    entryPrice: string;
    notional: string;
    unrealizedPnl: string;
    marginUsed: string;
    liquidationPrice: string | null;
    leverage: number;
    marginType: string;
  }>;
  fetchedAt: string;
  source: "hyperliquid-clearinghouse";
};

export class HyperliquidPerpProvider implements MarketDataProvider {
  readonly id = "hyperliquid-perps";
  private metadata: { until: number; value: z.infer<typeof HyperliquidMeta> } | null = null;
  private metadataRequest: Promise<z.infer<typeof HyperliquidMeta>> | null = null;

  constructor(
    private readonly baseUrl = "https://api.hyperliquid.xyz",
    private readonly fetcher: Fetch = globalThis.fetch,
  ) {}

  async listMarkets(
    symbols: readonly string[],
  ): Promise<Array<{ instrument: Instrument; snapshot: MarketSnapshot }>> {
    const requested = [...new Set(symbols.map(perpCoin))].slice(0, 20);
    const metadata = await this.getMetadata();
    const available = requested.filter((coin) =>
      metadata[0].universe.some((asset) => asset.name === coin && !asset.isDelisted),
    );
    const results = await Promise.allSettled(
      available.map(async (coin) => ({
        instrument: this.instrumentFromMetadata(coin, metadata),
        snapshot: await this.snapshotFromMetadata(coin, metadata),
      })),
    );
    return results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  }

  async getInstrument(symbol: string): Promise<Instrument> {
    return this.instrumentFromMetadata(perpCoin(symbol), await this.getMetadata());
  }

  async getSnapshot(symbol: string): Promise<MarketSnapshot> {
    const coin = perpCoin(symbol);
    return this.snapshotFromMetadata(coin, await this.getMetadata());
  }

  async getOrderBook(symbol: string, limit = 20): Promise<OrderBook> {
    const coin = perpCoin(symbol);
    const startedAt = Date.now();
    const book = HyperliquidBook.parse(await this.request({ type: "l2Book", coin }));
    if (book.coin !== coin || !book.levels[0][0] || !book.levels[1][0])
      throw new MarketDataUnavailableError(`Hyperliquid depth unavailable for ${coin}`);
    const receivedAt = new Date().toISOString();
    return {
      instrumentId: `hyperliquid:${coin}:perpetual`,
      sequence: String(book.time),
      bids: book.levels[0]
        .slice(0, limit)
        .map((level) => ({ price: level.px, quantity: level.sz })),
      asks: book.levels[1]
        .slice(0, limit)
        .map((level) => ({ price: level.px, quantity: level.sz })),
      quality: {
        status: "live",
        source: this.id,
        observedAt: new Date(book.time).toISOString(),
        receivedAt,
        latencyMs: Date.now() - startedAt,
        sequence: String(book.time),
      },
    };
  }

  async getCandles(symbol: string, interval = "15m", limit = 240): Promise<Candle[]> {
    const coin = perpCoin(symbol);
    const duration = intervalDuration(interval);
    const endTime = Date.now();
    const startTime = endTime - duration * Math.min(Math.max(limit, 30), 500) - duration;
    const payload = HyperliquidCandles.parse(
      await this.request({ type: "candleSnapshot", req: { coin, interval, startTime, endTime } }),
    );
    return payload.slice(-limit).map((row) => ({
      time: Math.floor(row.t / 1000),
      open: row.o,
      high: row.h,
      low: row.l,
      close: row.c,
      volume: row.v,
    }));
  }

  async listPerpetualMetrics(symbols: readonly string[]): Promise<PerpetualMetric[]> {
    const metadata = await this.getMetadata();
    const observedAt = new Date().toISOString();
    return [...new Set(symbols.map(perpCoin))].flatMap((coin) => {
      const index = metadata[0].universe.findIndex(
        (asset) => asset.name === coin && !asset.isDelisted,
      );
      const context = metadata[1][index];
      if (index < 0 || !context?.markPx) return [];
      return [
        {
          symbol: coin,
          markPrice: context.markPx,
          oraclePrice: context.oraclePx ?? null,
          fundingRate: context.funding ?? null,
          openInterestBase: context.openInterest ?? null,
          volume24hUsd: context.dayNtlVlm ?? null,
          observedAt,
          source: "hyperliquid-perps" as const,
        },
      ];
    });
  }

  async getPublicAccount(address: string): Promise<PublicPerpAccount> {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw new Error("Invalid public wallet address");
    const payload = HyperliquidAccountState.parse(
      await this.request({ type: "clearinghouseState", user: address }),
    );
    return {
      address,
      accountValue: payload.marginSummary.accountValue,
      notionalExposure: payload.marginSummary.totalNtlPos,
      marginUsed: payload.marginSummary.totalMarginUsed,
      withdrawable: payload.withdrawable,
      positions: payload.assetPositions.map(({ position }) => ({
        coin: position.coin,
        size: position.szi,
        entryPrice: position.entryPx,
        notional: position.positionValue,
        unrealizedPnl: position.unrealizedPnl,
        marginUsed: position.marginUsed,
        liquidationPrice: position.liquidationPx ?? null,
        leverage: position.leverage.value,
        marginType: position.leverage.type,
      })),
      fetchedAt: new Date().toISOString(),
      source: "hyperliquid-clearinghouse",
    };
  }

  private instrumentFromMetadata(
    coin: string,
    metadata: z.infer<typeof HyperliquidMeta>,
  ): Instrument {
    const asset = metadata[0].universe.find((item) => item.name === coin && !item.isDelisted);
    if (!asset) throw new MarketDataUnavailableError(`Unknown Hyperliquid perpetual ${coin}`);
    return {
      id: `hyperliquid:${coin}:perpetual`,
      venue: "hyperliquid",
      venueSymbol: coin,
      displaySymbol: `${coin} / USDC`,
      assetClass: "crypto",
      type: "perpetual",
      baseAsset: coin,
      quoteAsset: "USDC",
      priceIncrement: "0.00000001",
      quantityIncrement: decimalIncrement(asset.szDecimals),
      contractMultiplier: "1",
      status: "active",
    };
  }

  private async snapshotFromMetadata(
    coin: string,
    metadata: z.infer<typeof HyperliquidMeta>,
  ): Promise<MarketSnapshot> {
    const index = metadata[0].universe.findIndex(
      (asset) => asset.name === coin && !asset.isDelisted,
    );
    const context = metadata[1][index];
    if (index < 0 || !context?.markPx)
      throw new MarketDataUnavailableError(`Hyperliquid mark unavailable for ${coin}`);
    const book = await this.getOrderBook(coin);
    const bid = book.bids[0]?.price;
    const ask = book.asks[0]?.price;
    if (!bid || !ask)
      throw new MarketDataUnavailableError(`Hyperliquid quote unavailable for ${coin}`);
    const previous = Number(context.prevDayPx);
    const change =
      previous > 0 ? ((Number(context.markPx) / previous - 1) * 100).toFixed(4) : undefined;
    return {
      instrumentId: `hyperliquid:${coin}:perpetual`,
      bid,
      ask,
      last: context.markPx,
      ...(change ? { change24hPct: change } : {}),
      ...(context.dayNtlVlm ? { volume24h: context.dayNtlVlm } : {}),
      quality: book.quality,
    };
  }

  private async getMetadata(): Promise<z.infer<typeof HyperliquidMeta>> {
    if (this.metadata && this.metadata.until > Date.now()) return this.metadata.value;
    if (!this.metadataRequest) {
      this.metadataRequest = this.request({ type: "metaAndAssetCtxs" })
        .then((payload) => {
          const value = HyperliquidMeta.parse(payload);
          this.metadata = { until: Date.now() + 5000, value };
          return value;
        })
        .finally(() => {
          this.metadataRequest = null;
        });
    }
    return this.metadataRequest;
  }

  private async request(body: object): Promise<unknown> {
    try {
      const response = await this.fetcher(`${this.baseUrl}/info`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok)
        throw new MarketDataUnavailableError(`Hyperliquid returned ${response.status}`);
      return await response.json();
    } catch (error) {
      if (error instanceof MarketDataUnavailableError) throw error;
      throw new MarketDataUnavailableError("Hyperliquid market data request failed");
    }
  }
}

const DeFiLlamaChain = z.object({
  name: z.string(),
  tvl: z.number().nonnegative(),
  tokenSymbol: z.string().nullish(),
  chainId: z.union([z.string(), z.number()]).nullish(),
});

export type ChainTvl = {
  name: string;
  tvlUsd: number;
  tokenSymbol: string | null;
  chainId: string | null;
  observedAt: string;
  source: "defillama";
};

export class DeFiLlamaChainProvider {
  private cache: { until: number; rows: ChainTvl[] } | null = null;

  constructor(
    private readonly baseUrl = "https://api.llama.fi",
    private readonly fetcher: Fetch = globalThis.fetch,
  ) {}

  async listChains(limit = 20): Promise<ChainTvl[]> {
    if (this.cache && this.cache.until > Date.now()) return this.cache.rows.slice(0, limit);
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}/v2/chains`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(6000),
      });
    } catch {
      throw new MarketDataUnavailableError("DeFiLlama chain TVL request failed");
    }
    if (!response.ok) throw new MarketDataUnavailableError(`DeFiLlama returned ${response.status}`);
    const payload = z.array(DeFiLlamaChain).parse(await response.json());
    const observedAt = new Date().toISOString();
    const rows = payload
      .filter((chain) => chain.tvl > 0)
      .sort((left, right) => right.tvl - left.tvl)
      .map((chain) => ({
        name: chain.name,
        tvlUsd: chain.tvl,
        tokenSymbol: chain.tokenSymbol ?? null,
        chainId: chain.chainId == null ? null : String(chain.chainId),
        observedAt,
        source: "defillama" as const,
      }));
    this.cache = { until: Date.now() + 60_000, rows };
    return rows.slice(0, limit);
  }
}

function perpCoin(symbol: string): string {
  const coin = symbol.toUpperCase().replace(/USDT$|USDC$|-USD$/, "");
  if (!/^[A-Z0-9]{2,12}$/.test(coin)) throw new Error("Invalid perpetual symbol");
  return coin;
}

function intervalDuration(interval: string): number {
  const durations: Record<string, number> = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
  };
  const duration = durations[interval];
  if (!duration) throw new Error("Unsupported Hyperliquid interval");
  return duration;
}

function decimalIncrement(decimals: number): string {
  return decimals === 0 ? "1" : `0.${"0".repeat(decimals - 1)}1`;
}

const BinanceBookTicker = z.object({
  symbol: z.string(),
  bidPrice: z.string(),
  askPrice: z.string(),
});
const BinanceTicker = z.object({
  lastPrice: z.string(),
  priceChangePercent: z.string(),
  quoteVolume: z.string(),
});
const BinanceBatchTicker = BinanceTicker.extend({ symbol: z.string() });
const BinanceExchangeInfo = z.object({
  symbols: z.array(
    z.object({
      symbol: z.string(),
      baseAsset: z.string(),
      quoteAsset: z.string(),
      status: z.string(),
      filters: z.array(z.record(z.unknown())),
    }),
  ),
});
const BinanceKlines = z.array(z.array(z.union([z.string(), z.number()])).min(6));
const BinanceDepth = z.object({
  lastUpdateId: z.number(),
  bids: z.array(z.tuple([z.string(), z.string()])),
  asks: z.array(z.tuple([z.string(), z.string()])),
});

export class BinanceSpotProvider implements MarketDataProvider {
  readonly id = "binance-spot";
  private healthyUntil = 0;
  private unavailableUntil = 0;
  private probe: Promise<void> | null = null;

  constructor(
    private readonly baseUrl = "https://data-api.binance.vision",
    private readonly fetcher: Fetch = globalThis.fetch,
  ) {}

  async listMarkets(
    symbols: readonly string[],
  ): Promise<Array<{ instrument: Instrument; snapshot: MarketSnapshot }>> {
    const requested = [...new Set(symbols.map(normalizeSymbol))].slice(0, 20);
    if (requested.length === 0) return [];
    const query = `symbols=${encodeURIComponent(JSON.stringify(requested))}`;
    const startedAt = Date.now();
    const [infoPayload, bookPayload, tickerPayload] = await Promise.all([
      this.request(`/api/v3/exchangeInfo?${query}`),
      this.request(`/api/v3/ticker/bookTicker?${query}`),
      this.request(`/api/v3/ticker/24hr?${query}`),
    ]);
    const info = BinanceExchangeInfo.parse(infoPayload);
    const books = new Map(
      z
        .array(BinanceBookTicker)
        .parse(bookPayload)
        .map((row) => [row.symbol, row]),
    );
    const tickers = new Map(
      z
        .array(BinanceBatchTicker)
        .parse(tickerPayload)
        .map((row) => [row.symbol, row]),
    );
    const instruments = new Map(info.symbols.map((market) => [market.symbol, market]));
    const receivedAt = new Date();
    return requested.flatMap((symbol) => {
      const market = instruments.get(symbol);
      const book = books.get(symbol);
      const ticker = tickers.get(symbol);
      if (!market || !book || !ticker) return [];
      const priceFilter = market.filters.find((filter) => filter.filterType === "PRICE_FILTER");
      const lotFilter = market.filters.find((filter) => filter.filterType === "LOT_SIZE");
      return [
        {
          instrument: {
            id: `binance:${symbol}:spot`,
            venue: "binance",
            venueSymbol: symbol,
            displaySymbol: `${market.baseAsset} / ${market.quoteAsset}`,
            assetClass: "crypto" as const,
            type: "spot" as const,
            baseAsset: market.baseAsset,
            quoteAsset: market.quoteAsset,
            priceIncrement: readString(priceFilter, "tickSize", "0.00000001"),
            quantityIncrement: readString(lotFilter, "stepSize", "0.00000001"),
            contractMultiplier: "1",
            status: market.status === "TRADING" ? ("active" as const) : ("halted" as const),
          },
          snapshot: {
            instrumentId: `binance:${symbol}:spot`,
            bid: book.bidPrice,
            ask: book.askPrice,
            last: ticker.lastPrice,
            change24hPct: ticker.priceChangePercent,
            volume24h: ticker.quoteVolume,
            quality: {
              status: "live" as const,
              source: this.id,
              observedAt: receivedAt.toISOString(),
              receivedAt: receivedAt.toISOString(),
              latencyMs: receivedAt.getTime() - startedAt,
            },
          },
        },
      ];
    });
  }

  async getInstrument(symbol: string): Promise<Instrument> {
    const normalized = normalizeSymbol(symbol);
    const payload = await this.request(
      `/api/v3/exchangeInfo?symbol=${encodeURIComponent(normalized)}`,
    );
    const parsed = BinanceExchangeInfo.safeParse(payload);
    const market = parsed.success ? parsed.data.symbols[0] : undefined;
    if (!market) throw new MarketDataUnavailableError(`Unknown Binance symbol ${normalized}`);
    const priceFilter = market.filters.find((filter) => filter.filterType === "PRICE_FILTER");
    const lotFilter = market.filters.find((filter) => filter.filterType === "LOT_SIZE");
    return {
      id: `binance:${market.symbol}:spot`,
      venue: "binance",
      venueSymbol: market.symbol,
      displaySymbol: `${market.baseAsset} / ${market.quoteAsset}`,
      assetClass: "crypto",
      type: "spot",
      baseAsset: market.baseAsset,
      quoteAsset: market.quoteAsset,
      priceIncrement: readString(priceFilter, "tickSize", "0.00000001"),
      quantityIncrement: readString(lotFilter, "stepSize", "0.00000001"),
      contractMultiplier: "1",
      status: market.status === "TRADING" ? "active" : "halted",
    };
  }

  async getSnapshot(symbol: string): Promise<MarketSnapshot> {
    const normalized = normalizeSymbol(symbol);
    const startedAt = Date.now();
    const [bookPayload, tickerPayload] = await Promise.all([
      this.request(`/api/v3/ticker/bookTicker?symbol=${encodeURIComponent(normalized)}`),
      this.request(`/api/v3/ticker/24hr?symbol=${encodeURIComponent(normalized)}`),
    ]);
    const book = BinanceBookTicker.parse(bookPayload);
    const ticker = BinanceTicker.parse(tickerPayload);
    const receivedAt = new Date();
    return {
      instrumentId: `binance:${book.symbol}:spot`,
      bid: book.bidPrice,
      ask: book.askPrice,
      last: ticker.lastPrice,
      change24hPct: ticker.priceChangePercent,
      volume24h: ticker.quoteVolume,
      quality: {
        status: "live",
        source: this.id,
        observedAt: receivedAt.toISOString(),
        receivedAt: receivedAt.toISOString(),
        latencyMs: receivedAt.getTime() - startedAt,
      },
    };
  }

  async getCandles(symbol: string, interval = "15m", limit = 240): Promise<Candle[]> {
    const normalized = normalizeSymbol(symbol);
    if (!/^(1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w)$/.test(interval)) {
      throw new Error("Invalid candle interval");
    }
    const payload = BinanceKlines.parse(
      await this.request(
        `/api/v3/klines?symbol=${encodeURIComponent(normalized)}&interval=${interval}&limit=${Math.min(Math.max(limit, 10), 1000)}`,
      ),
    );
    return payload.map((row) => ({
      time: Math.floor(Number(row[0]) / 1000),
      open: String(row[1]),
      high: String(row[2]),
      low: String(row[3]),
      close: String(row[4]),
      volume: String(row[5]),
    }));
  }

  async getOrderBook(symbol: string, limit = 20): Promise<OrderBook> {
    const normalized = normalizeSymbol(symbol);
    const startedAt = Date.now();
    const depth = BinanceDepth.parse(
      await this.request(
        `/api/v3/depth?symbol=${encodeURIComponent(normalized)}&limit=${normalizeDepth(limit)}`,
      ),
    );
    const receivedAt = new Date();
    return {
      instrumentId: `binance:${normalized}:spot`,
      sequence: String(depth.lastUpdateId),
      bids: depth.bids.map(([price, quantity]) => ({ price, quantity })),
      asks: depth.asks.map(([price, quantity]) => ({ price, quantity })),
      quality: {
        status: "live",
        source: this.id,
        observedAt: receivedAt.toISOString(),
        receivedAt: receivedAt.toISOString(),
        latencyMs: receivedAt.getTime() - startedAt,
        sequence: String(depth.lastUpdateId),
      },
    };
  }

  private async request(path: string): Promise<unknown> {
    await this.ensureAvailable();
    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        headers: { accept: "application/json", "user-agent": "sisera-market-data/0.2" },
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) throw new MarketDataUnavailableError(`Binance returned ${response.status}`);
      return response.json();
    } catch (error) {
      if (error instanceof MarketDataUnavailableError) throw error;
      throw new MarketDataUnavailableError("Binance market data request failed");
    }
  }

  private async ensureAvailable(): Promise<void> {
    if (Date.now() < this.unavailableUntil)
      throw new MarketDataUnavailableError("Binance market data is temporarily unavailable");
    if (Date.now() < this.healthyUntil) return;
    if (!this.probe) {
      this.probe = (async () => {
        try {
          const response = await this.fetcher(`${this.baseUrl}/api/v3/ping`, {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(2500),
          });
          if (!response.ok)
            throw new MarketDataUnavailableError(`Binance returned ${response.status}`);
          this.healthyUntil = Date.now() + 30_000;
        } catch {
          this.unavailableUntil = Date.now() + 10_000;
          throw new MarketDataUnavailableError("Binance market data is temporarily unavailable");
        } finally {
          this.probe = null;
        }
      })();
    }
    await this.probe;
  }
}

const PANTA_EVENT_DISCRIMINATOR = [125, 192, 125, 158, 9, 115, 152, 233];
const PANTA_EVENT_DISCRIMINATOR_BASE64 = Buffer.from(PANTA_EVENT_DISCRIMINATOR).toString("base64");

/**
 * Panta Market prediction provider.
 * Combines Panta's USDC API registry with its on-chain Event directory, which
 * also contains legacy P2P markets omitted by the registry. On-chain state is
 * also the fallback when the API is unavailable or no API key is configured.
 */
/**
 * Panta's pictures are 1024px originals on Cloudinary; ask it for a small square, which is all a
 * market thumbnail needs. Other hosts are left as they are.
 */
function thumbnail(url: string) {
  return url.replace(
    /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(?!c_)/,
    "$1c_fill,w_160,h_160,q_auto,f_auto/",
  );
}

export class PantaPredictionProvider {
  private cache: { until: number; markets: PredictionMarket[] } | null = null;
  private pending: Promise<PredictionMarket[]> | null = null;
  private registryIds = new Set<string>();
  /** Cover pictures by event address; a market's picture rarely changes. */
  private readonly pictures = new Map<string, { until: number; url: string | null }>();

  constructor(
    private readonly baseUrl = "https://live-api.panta.market/api/v1",
    private readonly apiKey?: string,
    private readonly fetcher: Fetch = globalThis.fetch,
    private readonly rpcUrl = "https://mainnet.helius-rpc.com/?api-key=9d40fe27-02d9-4756-91b7-6b639d75de67",
    private readonly programId = "6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp",
    /** Panta's public event API, which serves the cover picture its site shows per market. */
    private readonly eventsUrl = "https://production-api.balr.fun/api/v1/events",
  ) {}

  /**
   * Cover pictures for these markets, by event address. Neither Panta's registry nor the on-chain
   * account includes one, so each comes from the event record panta.market itself loads. Events
   * are looked up one at a time: the full list is large and Panta's server often cuts it off
   * mid-response. Pictures are kept for six hours; a failed lookup is retried on the next refresh,
   * and a market without one simply shows none.
   */
  private async picturesFor(ids: readonly string[]): Promise<Map<string, string>> {
    const now = Date.now();
    const missing = [...new Set(ids)]
      .filter((id) => (this.pictures.get(id)?.until ?? 0) <= now)
      .slice(0, 60);
    for (let start = 0; start < missing.length; start += 6) {
      await Promise.all(
        missing.slice(start, start + 6).map(async (id) => {
          try {
            const response = await this.fetcher(
              `${this.eventsUrl.replace(/\/$/, "")}/registry/${encodeURIComponent(id)}`,
              { headers: { accept: "application/json" }, signal: AbortSignal.timeout(6000) },
            );
            if (response.status === 404) {
              this.pictures.set(id, { until: now + 6 * 3_600_000, url: null });
              return;
            }
            if (!response.ok) return;
            const payload = (await response.json()) as { data?: { images?: unknown } };
            const images = payload?.data?.images;
            const picture = Array.isArray(images)
              ? images.find(
                  (url): url is string => typeof url === "string" && url.startsWith("https://"),
                )
              : undefined;
            this.pictures.set(id, {
              until: now + 6 * 3_600_000,
              url: picture ? thumbnail(picture) : null,
            });
          } catch {
            // Retried on the next refresh.
          }
        }),
      );
    }
    const found = new Map<string, string>();
    for (const id of ids) {
      const url = this.pictures.get(id)?.url;
      if (url) found.set(id, url);
    }
    return found;
  }

  private withPicture(market: PredictionMarket, pictures: Map<string, string>): PredictionMarket {
    if (market.imageUrl) return market;
    const picture =
      pictures.get(market.id) ?? (market.eventId ? pictures.get(market.eventId) : null);
    return picture ? { ...market, imageUrl: picture } : market;
  }

  async listOpenMarkets(limit = 20): Promise<PredictionMarket[]> {
    const markets = await this.loadAll();
    return markets
      .filter(
        (market) =>
          market.status === "open" &&
          (!market.closesAt || Date.parse(market.closesAt) > Date.now()),
      )
      .slice(0, limit);
  }

  async getMarket(id: string): Promise<PredictionMarket | null> {
    const market = await this.findMarket(id);
    return market
      ? this.withPicture(market, await this.picturesFor([market.eventId ?? market.id]))
      : null;
  }

  private async findMarket(id: string): Promise<PredictionMarket | null> {
    const markets = await this.loadAll();
    const found = markets.find((market) => market.id === id);
    // Legacy P2P accounts are absent from the USDC registry. The detail endpoint
    // mislabels their SOL amounts as USDC and can return incompatible secondary
    // last trades (e.g. YES=1 and NO=1). Keep their on-chain reference data.
    if (found?.quality.source === "panta-onchain" && !this.registryIds.has(id)) return found;
    // Catalog prices may be null; market detail refreshes on-chain spot prices.

    // Direct lookup via Panta API if configured
    if (this.apiKey) {
      try {
        const response = await this.fetcher(
          `${this.baseUrl.replace(/\/$/, "")}/markets/${encodeURIComponent(id)}/`,
          {
            headers: {
              accept: "application/json",
              "x-api-key": this.apiKey,
            },
            signal: AbortSignal.timeout(6000),
          },
        );
        if (response.ok) {
          const payload = await response.json();
          const parsed = parsePantaApiMarket(payload, {
            status: "live",
            source: "panta-api",
            observedAt: new Date().toISOString(),
            receivedAt: new Date().toISOString(),
            latencyMs: 50,
          });
          if (parsed) return parsed;
        }
      } catch {}
    }

    if (found) return found;

    // Direct lookup on-chain via Solana RPC
    try {
      const response = await this.fetcher(this.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getAccountInfo",
          params: [id, { encoding: "base64" }],
        }),
        signal: AbortSignal.timeout(6000),
      });
      if (response.ok) {
        const payload = (await response.json()) as {
          result?: { value?: { data?: [string, ...unknown[]] } };
        };
        const base64Data = payload?.result?.value?.data?.[0];
        if (typeof base64Data === "string") {
          const buf = Buffer.from(base64Data, "base64");
          return decodePantaEventAccount(id, buf, {
            status: "live",
            source: "panta-onchain",
            observedAt: new Date().toISOString(),
            receivedAt: new Date().toISOString(),
            latencyMs: 50,
          });
        }
      }
    } catch {}

    return null;
  }

  /** Markets in the same event, for comparing sibling outcomes. */
  async listEventMarkets(eventId: string): Promise<PredictionMarket[]> {
    const markets = await this.loadAll();
    return markets.filter((market) => market.eventId === eventId);
  }

  private async loadAll(): Promise<PredictionMarket[]> {
    const refresh = () => {
      this.pending ??= this.loadMarkets()
        .then(async (markets) => {
          // Only markets on the list need a picture; resolved archives are never shown.
          const pictures = await this.picturesFor(
            markets
              .filter(
                (market) =>
                  market.status === "open" &&
                  (!market.closesAt || Date.parse(market.closesAt) > Date.now()),
              )
              .map((market) => market.eventId ?? market.id),
          );
          const pictured = markets.map((market) => this.withPicture(market, pictures));
          if (this.cache) this.cache = { ...this.cache, markets: pictured };
          return pictured;
        })
        .finally(() => {
          this.pending = null;
        });
      return this.pending;
    };
    if (this.cache) {
      if (this.cache.until <= Date.now()) void refresh().catch(() => undefined);
      return this.cache.markets;
    }
    return refresh();
  }

  private async loadMarkets(): Promise<PredictionMarket[]> {
    const startedAt = Date.now();
    const isCustomFetcher = this.fetcher !== globalThis.fetch;

    // Exercise the same cursor traversal for injected Panta clients and production.
    if (isCustomFetcher && this.baseUrl.includes("panta.market")) {
      const markets = await this.fetchPantaApi(startedAt);
      this.cache = { until: Date.now() + 60_000, markets };
      return markets;
    }

    // Preserve the legacy event adapter for injected non-Panta clients.
    if (isCustomFetcher) {
      const url = `${this.baseUrl.replace(/\/$/, "")}/events?includeMarkets=true&start=0&end=99`;

      const response = await this.fetcher(url, {
        headers: {
          accept: "application/json",
          ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new MarketDataUnavailableError(`Prediction market fetch returned ${response.status}`);
      }

      const payload = (await response.json()) as {
        data?: Array<Record<string, unknown>>;
        items?: Array<Record<string, unknown>>;
      };
      const quality = {
        status: "delayed" as const,
        source: "jupiter-api",
        observedAt: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
      };

      let markets: PredictionMarket[] = [];
      if (Array.isArray(payload?.data)) {
        if (
          payload.data.length > 0 &&
          Array.isArray((payload.data[0] as { markets?: unknown[] })?.markets)
        ) {
          markets = payload.data.flatMap((event: unknown) => parsePredictionEvent(event, quality));
        } else {
          markets = payload.data
            .map((item: unknown) => parsePantaApiMarket(item, quality))
            .filter((m: PredictionMarket | null): m is PredictionMarket => m !== null);
        }
      } else if (Array.isArray(payload?.items)) {
        markets = payload.items
          .map((item: unknown) => parsePantaApiMarket(item, quality))
          .filter((m: PredictionMarket | null): m is PredictionMarket => m !== null);
      }

      this.cache = { until: Date.now() + 60_000, markets };
      return markets;
    }

    // 1. Try Panta REST API if API key is provided
    if (this.apiKey) {
      try {
        const apiMarkets = await this.fetchPantaApi(startedAt);
        if (apiMarkets.length > 0) {
          this.cache = { until: Date.now() + 60_000, markets: apiMarkets };
          return apiMarkets;
        }
      } catch {
        // Fallback to on-chain bot scanning
      }
    }

    // 2. Fallback to on-chain Solana RPC (what market maker bot uses)
    try {
      const onchainMarkets = await this.fetchOnChain(startedAt);
      if (onchainMarkets.length > 0) {
        this.cache = { until: Date.now() + 60_000, markets: onchainMarkets };
        return onchainMarkets;
      }
    } catch {
      // Fall through
    }

    if (this.cache?.markets?.length) return this.cache.markets;
    throw new MarketDataUnavailableError("Panta prediction market data is unavailable");
  }

  private async fetchPantaApi(startedAt: number): Promise<PredictionMarket[]> {
    const items: unknown[] = [];
    const cursors = new Set<string>();
    // A single deadline bounds the whole catalog refresh, including later pages.
    const signal = AbortSignal.timeout(10000);
    let cursor: string | null = null;
    for (let page = 0; page < 20; page++) {
      const url = new URL(`${this.baseUrl.replace(/\/$/, "")}/markets/`);
      url.searchParams.set("limit", "50");
      if (cursor) url.searchParams.set("cursor", cursor);
      const response = await this.fetcher(url.toString(), {
        headers: {
          accept: "application/json",
          ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
        },
        signal,
      });
      if (!response.ok) throw new Error(`Panta API responded with ${response.status}`);
      const payload = (await response.json()) as {
        items?: unknown[];
        data?: unknown[];
        nextCursor?: unknown;
      };
      items.push(
        ...(Array.isArray(payload?.items)
          ? payload.items
          : Array.isArray(payload?.data)
            ? payload.data
            : []),
      );
      cursor =
        typeof payload.nextCursor === "string" && payload.nextCursor ? payload.nextCursor : null;
      if (!cursor) break;
      if (cursors.has(cursor) || page === 19) {
        throw new Error("Panta catalog pagination did not complete");
      }
      cursors.add(cursor);
    }
    const quality = {
      status: "live" as const,
      source: "panta-api",
      observedAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
    };
    const markets = new Map<string, PredictionMarket>();
    const registryIds = new Set<string>();
    const knownTitles = new Map(this.cache?.markets.map((market) => [market.id, market.title]));
    const incomplete = new Set<string>();
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const id = typeof row.marketId === "string" ? row.marketId : row.id;
      if (typeof id === "string") registryIds.add(id);
      const market =
        parsePantaApiMarket(item, quality) ??
        (typeof id === "string" && knownTitles.has(id)
          ? parsePantaApiMarket({ ...row, title: knownTitles.get(id) }, quality)
          : null);
      if (market) {
        markets.set(market.id, market);
        continue;
      }
      const closesAt = pantaCloseTime(row);
      if (
        typeof id === "string" &&
        !pantaMarketClosed(row) &&
        (!closesAt || closesAt * 1000 > Date.now())
      )
        incomplete.add(id);
    }
    // Some registry rows omit the event title; detail can recover its on-chain metadata.
    // Keep requests bounded and skip resolved/expired rows rather than RPC-reading the archive.
    const ids = [...incomplete];
    for (let start = 0; start < ids.length && !signal.aborted; start += 4) {
      await Promise.all(
        ids.slice(start, start + 4).map(async (id) => {
          for (let attempt = 0; attempt < 2 && !signal.aborted; attempt++) {
            try {
              const response = await this.fetcher(
                `${this.baseUrl.replace(/\/$/, "")}/markets/${encodeURIComponent(id)}/`,
                {
                  headers: {
                    accept: "application/json",
                    ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
                  },
                  signal,
                },
              );
              if (!response.ok) return;
              const market = parsePantaApiMarket(await response.json(), quality);
              if (market?.id === id) {
                markets.set(id, market);
                return;
              }
              // A successful response can still omit metadata when Panta's RPC read fails.
            } catch {
              // A failed metadata lookup must not hide the other complete catalog rows.
              return;
            }
          }
        }),
      );
    }
    // The REST registry is not a complete directory: active legacy P2P markets
    // visible on panta.market can be absent from every catalog page. Discover
    // those accounts every refresh, rather than using chain discovery only
    // when the API fails. Registry entries remain authoritative for USDC markets.
    try {
      const onchain = await this.fetchOnChain(startedAt);
      for (const market of onchain) {
        if (!markets.has(market.id)) markets.set(market.id, market);
      }
    } catch {
      // A transient RPC failure must not remove previously discovered P2P events.
      for (const market of this.cache?.markets ?? []) {
        if (market.quality.source === "panta-onchain" && !markets.has(market.id))
          markets.set(market.id, { ...market, quality: { ...market.quality, status: "stale" } });
      }
    }
    this.registryIds = registryIds;
    return [...markets.values()];
  }

  private async fetchOnChain(startedAt: number): Promise<PredictionMarket[]> {
    const response = await this.fetcher(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getProgramAccounts",
        params: [
          this.programId,
          {
            encoding: "base64",
            filters: [
              {
                memcmp: {
                  offset: 0,
                  bytes: PANTA_EVENT_DISCRIMINATOR_BASE64,
                  encoding: "base64",
                },
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Solana RPC responded with ${response.status}`);
    const payload = (await response.json()) as {
      result?: Array<{ pubkey?: string; account?: { data?: [string, ...unknown[]] } }>;
    };
    if (!Array.isArray(payload?.result)) throw new Error("Panta on-chain directory unavailable");
    const accounts = payload.result;
    const quality = {
      status: "live" as const,
      source: "panta-onchain",
      observedAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
    };
    const markets: PredictionMarket[] = [];
    for (const entry of accounts) {
      const pubkey = entry?.pubkey;
      const base64Data = entry?.account?.data?.[0];
      if (typeof pubkey === "string" && typeof base64Data === "string") {
        const buf = Buffer.from(base64Data, "base64");
        const market = decodePantaEventAccount(pubkey, buf, quality);
        if (market) markets.push(market);
      }
    }
    return markets.sort((a, b) => (b.volumeUsd ?? 0) - (a.volumeUsd ?? 0));
  }

  private async fetchLegacyEvents(startedAt: number): Promise<PredictionMarket[]> {
    const url = new URL(`${this.baseUrl.replace(/\/$/, "")}/events`);
    url.searchParams.set("includeMarkets", "true");
    url.searchParams.set("start", "0");
    url.searchParams.set("end", "99");
    const response = await this.fetcher(url.toString(), {
      headers: {
        accept: "application/json",
        ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Legacy events responded with ${response.status}`);
    const payload = (await response.json()) as { data?: unknown[] };
    const quality = {
      status: "delayed" as const,
      source: "panta-prediction-api",
      observedAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
    };
    if (Array.isArray(payload?.data)) {
      return payload.data.flatMap((event: unknown) => parsePredictionEvent(event, quality));
    }
    return [];
  }
}

/** Backward-compatibility alias for PantaPredictionProvider. */
export { PantaPredictionProvider as JupiterPredictionProvider };

function pantaTimestamp(value: unknown): number | null {
  const seconds =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? /^\d+(\.\d+)?$/.test(value)
          ? Number(value)
          : Date.parse(value) / 1000
        : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function pantaCloseTime(item: Record<string, unknown>): number | null {
  return (
    pantaTimestamp(item.endTime) ??
    pantaTimestamp(item.resolutionTime) ??
    pantaTimestamp(item.closeTime)
  );
}

function pantaMarketClosed(item: Record<string, unknown>): boolean {
  return (
    item.resolved === true ||
    item.cancelled === true ||
    item.isResolved === true ||
    item.isCancelled === true ||
    [item.status, item.phase].some((phase) =>
      ["resolved", "cancelled", "closed"].includes(String(phase).toLowerCase()),
    )
  );
}

function parsePantaApiMarket(
  raw: unknown,
  quality: PredictionMarket["quality"],
): PredictionMarket | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const marketId =
    typeof item.marketId === "string"
      ? item.marketId
      : typeof item.id === "string"
        ? item.id
        : null;
  if (!marketId) return null;
  const title =
    typeof item.title === "string" && item.title.trim()
      ? item.title
      : typeof item.question === "string"
        ? item.question
        : "";
  if (!title.trim()) return null;
  const categoryName = typeof item.category === "string" ? item.category.trim() : "";
  const category = categoryName
    ? categoryName[0]?.toUpperCase() + categoryName.slice(1).toLowerCase()
    : "General";
  const subcategory =
    typeof item.marketType === "string"
      ? item.marketType
      : typeof item.subcategory === "string"
        ? item.subcategory
        : null;
  const images = Array.isArray(item.images) ? item.images : [];
  const imageUrl =
    typeof images[0] === "string"
      ? images[0]
      : typeof item.imageUrl === "string"
        ? item.imageUrl
        : null;
  const startTime = pantaTimestamp(item.startTime);
  const closeSec = pantaCloseTime(item);
  const closesAt = closeSec ? new Date(closeSec * 1000).toISOString() : null;
  const openedAt = startTime ? new Date(startTime * 1000).toISOString() : null;
  const volumeUsd =
    item.totalVolumeUsdc != null
      ? Number(item.totalVolumeUsdc)
      : item.volumeUsdc != null
        ? Number(item.volumeUsdc)
        : item.volumeUsd != null
          ? Number(item.volumeUsd)
          : null;
  const rule =
    typeof item.resolutionRules === "string"
      ? item.resolutionRules.trim()
      : typeof item.resolutionRule === "string"
        ? item.resolutionRule.trim()
        : "";
  const sources = Array.isArray(item.sources)
    ? item.sources.filter(
        (source): source is string => typeof source === "string" && /^https?:\/\//.test(source),
      )
    : [];
  // The creation description may be promotional text, not settlement criteria.
  const resolutionRules = rule ? [rule, ...sources].join("\n") : null;

  let yes = item.yesPrice != null ? Number(item.yesPrice) : null;
  let no = item.noPrice != null ? Number(item.noPrice) : null;
  if (item.pricing && typeof item.pricing === "object") {
    const p = item.pricing as Record<string, unknown>;
    if (typeof p.yes === "number") yes ??= p.yes;
    if (typeof p.no === "number") no ??= p.no;
    if (typeof p.buyYesPriceUsd === "number") yes ??= p.buyYesPriceUsd / 1_000_000;
    if (typeof p.buyNoPriceUsd === "number") no ??= p.buyNoPriceUsd / 1_000_000;
  }
  const pricingAvailable =
    yes != null &&
    no != null &&
    Number.isFinite(yes) &&
    Number.isFinite(no) &&
    yes >= 0 &&
    yes <= 1 &&
    no >= 0 &&
    no <= 1;
  const yesProb = yes != null && Number.isFinite(yes) ? Math.min(Math.max(yes, 0), 1) : 0.5;
  const noProb = no != null && Number.isFinite(no) ? Math.min(Math.max(no, 0), 1) : 1 - yesProb;

  return {
    id: marketId,
    provider: "panta",
    pricingAvailable,
    underlyingProvider: "panta",
    title,
    eventId: typeof item.campaignId === "string" ? item.campaignId : marketId,
    eventTitle: title,
    marketTitle: title,
    category,
    subcategory,
    imageUrl,
    openedAt,
    volumeUsd,
    eventVolume24hUsd: null,
    venueTokenIds: [],
    resolutionRules,
    closesAt,
    status: pantaMarketClosed(item) ? "closed" : "open",
    outcomes: [
      {
        id: `${marketId}:yes`,
        label: "YES",
        probability: String(yesProb),
        sellPrice: String(yesProb),
      },
      { id: `${marketId}:no`, label: "NO", probability: String(noProb), sellPrice: String(noProb) },
    ],
    quality,
  };
}

function decodePantaEventAccount(
  pubkey: string,
  buf: Buffer | Uint8Array,
  quality: PredictionMarket["quality"],
): PredictionMarket | null {
  try {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    if (b.length < 340) return null;
    let offset = 8; // discriminator
    offset += 32; // creator
    const startTime = Number(b.readBigInt64LE(offset));
    offset += 8;
    const endTime = Number(b.readBigInt64LE(offset));
    offset += 8;
    const resolutionTime = Number(b.readBigInt64LE(offset));
    offset += 8;
    offset += 8 * 3; // createdAt, resolvedAt, cancelledAt
    offset += 16 * 2; // totalYesShares, totalNoShares
    const virtualSolReserves = Number(b.readBigUInt64LE(offset));
    offset += 16;
    const virtualYesShares = Number(b.readBigUInt64LE(offset));
    offset += 16;
    offset += 16; // lastYesPrice
    offset += 16;
    offset += 16 + 16 + 8 + 16 + 16 + 16 + 16 + 16 + 8 + 16; // remaining metrics

    if (offset + 4 > b.length) return null;
    const qLen = b.readUInt32LE(offset);
    offset += 4;
    if (offset + qLen > b.length) return null;
    const question = b.subarray(offset, offset + qLen).toString("utf8");
    offset += qLen;

    if (offset + 4 > b.length) return null;
    const rLen = b.readUInt32LE(offset);
    offset += 4;
    if (offset + rLen > b.length) return null;
    const resolutionRule = b.subarray(offset, offset + rLen).toString("utf8");
    offset += rLen;

    if (offset + 4 > b.length) return null;
    const sLen = b.readUInt32LE(offset);
    offset += 4;
    const sources: string[] = [];
    for (let i = 0; i < sLen; i++) {
      if (offset + 4 > b.length) break;
      const len = b.readUInt32LE(offset);
      offset += 4;
      if (offset + len > b.length) break;
      sources.push(b.subarray(offset, offset + len).toString("utf8"));
      offset += len;
    }

    offset += 16; // activeVolume
    offset += 3; // bumps
    offset++; // isActive (phase flag; graduated events may still be open)
    const isGraduated = b.readUInt8(offset++) === 1;
    const isResolved = b.readUInt8(offset++) === 1;
    const isCancelled = b.readUInt8(offset++) === 1;

    const totalLiquidity = virtualSolReserves + virtualYesShares;
    const rawYes = totalLiquidity > 0 ? virtualSolReserves / totalLiquidity : 0.5;
    const yes = Math.min(Math.max(rawYes, 0.01), 0.99);
    const no = 1 - yes;

    let category = "General";
    const textTarget = `${sources.join(" ")} ${question}`;
    if (/crypto|\bbtc\b|\beth\b|\bsol\b|\bhype\b|bitcoin/i.test(textTarget)) category = "Crypto";
    else if (/sport|cup|fifa|goal|fight|nba|nfl/i.test(textTarget)) category = "Sports";
    else if (/politics|election|minister|president|senate/i.test(textTarget)) category = "Politics";
    else if (/finance|economy|market|treasury/i.test(textTarget)) category = "Finance";

    const closeSec =
      Number(endTime) > 0
        ? Number(endTime)
        : Number(resolutionTime) > 0
          ? Number(resolutionTime)
          : null;
    const closesAt = closeSec ? new Date(closeSec * 1000).toISOString() : null;
    const openedAt =
      Number(startTime) > 0 ? new Date(Number(startTime) * 1000).toISOString() : null;

    return {
      id: pubkey,
      provider: "panta",
      underlyingProvider: "panta",
      pricingAvailable: totalLiquidity > 0,
      title: question,
      eventId: pubkey,
      eventTitle: question,
      marketTitle: question,
      category,
      subcategory: isGraduated ? "secondary" : "primary",
      imageUrl: null,
      openedAt,
      closesAt,
      // Legacy accounts contain SOL totals, not USD or a rolling 24h volume.
      volumeUsd: null,
      eventVolume24hUsd: null,
      venueTokenIds: [],
      resolutionRules: resolutionRule || "Resolved according to on-chain Panta rules.",
      status: isResolved || isCancelled ? "closed" : "open",
      outcomes: [
        {
          id: `${pubkey}:yes`,
          label: "YES",
          probability: yes.toFixed(4),
          sellPrice: yes.toFixed(4),
        },
        { id: `${pubkey}:no`, label: "NO", probability: no.toFixed(4), sellPrice: no.toFixed(4) },
      ],
      quality,
    };
  } catch {
    return null;
  }
}

const usdMicros = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number / 1_000_000 : null;
};

function parsePredictionEvent(
  event: unknown,
  quality: PredictionMarket["quality"],
): PredictionMarket[] {
  if (!event || typeof event !== "object") return [];
  const row = event as Record<string, unknown>;
  const metadata =
    row.metadata && typeof row.metadata === "object"
      ? (row.metadata as Record<string, unknown>)
      : {};
  const eventTitle = typeof metadata.title === "string" ? metadata.title : "";
  const eventId = typeof row.eventId === "string" ? row.eventId : null;
  if (!Array.isArray(row.markets)) return [];
  return row.markets.flatMap((raw): PredictionMarket[] => {
    if (!raw || typeof raw !== "object") return [];
    const market = raw as Record<string, unknown>;
    if (typeof market.marketId !== "string" || market.status !== "open") return [];
    const pricing =
      market.pricing && typeof market.pricing === "object"
        ? (market.pricing as Record<string, unknown>)
        : {};
    const yes = Number(pricing.buyYesPriceUsd) / 1_000_000;
    const sellYes = Number(pricing.sellYesPriceUsd) / 1_000_000;
    // Many venue markets quote only the YES side; NO is then the complement of the YES bid.
    const quotedNo = Number(pricing.buyNoPriceUsd) / 1_000_000;
    const no =
      Number.isFinite(quotedNo) && quotedNo > 0
        ? quotedNo
        : Number.isFinite(sellYes) && sellYes > 0
          ? 1 - sellYes
          : 1 - yes;
    const quotedSellNo = Number(pricing.sellNoPriceUsd) / 1_000_000;
    const sellNo =
      Number.isFinite(quotedSellNo) && quotedSellNo > 0 ? quotedSellNo : Math.max(0, 1 - yes);
    if (![yes, no].every((price) => Number.isFinite(price) && price > 0 && price < 1)) return [];
    const close = Number(market.closeTime);
    if (!Number.isFinite(close) || close * 1000 <= Date.now()) return [];
    if (typeof market.rulesPrimary !== "string" || !market.rulesPrimary.trim()) return [];
    const open = Number(market.openTime);
    const marketTitle = typeof market.title === "string" ? market.title : "";
    const team =
      market.team && typeof market.team === "object"
        ? (market.team as Record<string, unknown>)
        : null;
    const tokenIds = Array.isArray(market.clobTokenIds)
      ? market.clobTokenIds.filter((id): id is string => typeof id === "string")
      : [];
    return [
      {
        id: market.marketId,
        provider: "jupiter",
        underlyingProvider: typeof market.provider === "string" ? market.provider : null,
        title:
          marketTitle && marketTitle !== eventTitle
            ? `${eventTitle} · ${marketTitle}`
            : eventTitle || marketTitle,
        eventId,
        eventTitle: eventTitle || null,
        marketTitle: marketTitle || null,
        category: typeof row.category === "string" ? row.category : null,
        subcategory: typeof row.subcategory === "string" ? row.subcategory : null,
        imageUrl:
          (typeof market.imageUrl === "string" && market.imageUrl) ||
          (team && typeof team.imageUrl === "string" ? team.imageUrl : null) ||
          (typeof metadata.imageUrl === "string" ? metadata.imageUrl : null),
        openedAt: Number.isFinite(open) && open > 0 ? new Date(open * 1000).toISOString() : null,
        volumeUsd: usdMicros(pricing.volume) !== null ? Number(pricing.volume) : null,
        eventVolume24hUsd: usdMicros(row.volume24hr),
        venueTokenIds: tokenIds,
        resolutionRules: market.rulesPrimary,
        closesAt: new Date(close * 1000).toISOString(),
        status: "open",
        outcomes: [
          {
            id: `${market.marketId}:yes`,
            label: "YES",
            probability: String(yes),
            ...(Number.isFinite(sellYes) && sellYes > 0 && sellYes <= yes
              ? { sellPrice: String(sellYes) }
              : {}),
          },
          {
            id: `${market.marketId}:no`,
            label: "NO",
            probability: String(no),
            ...(sellNo > 0 && sellNo <= no ? { sellPrice: String(sellNo) } : {}),
          },
        ],
        quality,
      },
    ];
  });
}

function normalizeSymbol(symbol: string): string {
  const normalized = symbol.replaceAll(/[\s/_-]/g, "").toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(normalized)) throw new Error("Invalid market symbol");
  return normalized;
}

function normalizeDepth(limit: number): number {
  const permitted = [5, 10, 20, 50, 100, 500, 1000];
  return permitted.find((candidate) => candidate >= limit) ?? 1000;
}

function readString(
  record: Record<string, unknown> | undefined,
  key: string,
  fallback: string,
): string {
  const value = record?.[key];
  return typeof value === "string" ? value : fallback;
}
