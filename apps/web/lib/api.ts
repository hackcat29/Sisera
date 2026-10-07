import type {
  Candle,
  Instrument,
  MarketSnapshot,
  OrderBook,
  PredictionMarket,
} from "@sisera/domain";
import { serverApiUrl } from "./server-api-url";

export type MarketRow = { instrument: Instrument; snapshot: MarketSnapshot };
export type PreStock = {
  instrument: Instrument;
  company: string;
  description: string | null;
  imageUrl: string | null;
  productUrl: string | null;
  tokenPrice: string;
  markPrice: string;
  impliedValuation: string;
  markValuation: string;
  premiumDiscountPct: string;
  marketCap: string;
  supply: string;
  liquidityUsd: null;
  holders: null;
  updatedAt: null;
  fetchedAt: string;
  source: "prestocks";
};
export type SolanaWallet = {
  address: string;
  solLamports: string;
  holdings: Array<{
    mint: string;
    symbol: string | null;
    name: string | null;
    rawBalance: string;
    decimals: number;
  }>;
  fetchedAt: string;
  source: "helius-das" | "solana-rpc";
  reconciled: false;
};
export type HyperEvmWallet = {
  address: string;
  hypeWei: string;
  usdcRaw: string;
  usdcMint: string;
  source: "hyperevm-rpc";
  fetchedAt: string;
};
export type StockNewsItem = {
  title: string;
  summary: string | null;
  url: string;
  publishedAt: string;
  publisher: string;
  provider: "gnews" | "finnhub" | "gdelt" | "marketaux" | "google-news" | "bing-news";
};
export type SocialPost = {
  id: string;
  platform: "x" | "telegram" | "reddit" | "discord";
  community: string;
  text: string;
  url: string;
  publishedAt: string;
};
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
  tradingHalted: boolean;
  fetchedAt: string;
  source: "xstocks";
};
export type RwaMarket = {
  name: string;
  symbol: string;
  assetType: string;
  averageTokenPriceUsd: number | null;
  tokenizedMarketCapUsd: number | null;
  tokenizedVolume24hUsd: number | null;
  updatedAt: string | null;
  tokens: Array<{
    name: string;
    symbol: string;
    priceUsd: number | null;
    marketCapUsd: number | null;
    volume24hUsd: number | null;
    issuer: string | null;
    cryptoId: number | null;
  }>;
  markets: string[];
};
export type RwaProfile = {
  name: string;
  symbol: string;
  industry: string | null;
  employees: number | null;
  founded: string | null;
  website: string | null;
  primaryExchange: string | null;
  description: string | null;
};
export type MarketOverview = {
  global: {
    marketCapUsd: number | null;
    volume24hUsd: number | null;
    altcoinMarketCapUsd: number | null;
    altcoinVolume24hUsd: number | null;
    btcDominancePct: number | null;
    ethDominancePct: number | null;
    activeAssets: number | null;
    updatedAt: string;
  } | null;
  sentiment: { score: number; label: string; updatedAt: string } | null;
  crypto: Array<{
    id: number;
    name: string;
    symbol: string;
    rank: number | null;
    priceUsd: number | null;
    marketCapUsd: number | null;
    volume24hUsd: number | null;
    dominancePct: number | null;
    change1hPct: number | null;
    change24hPct: number | null;
    change7dPct: number | null;
    change30dPct: number | null;
    circulatingSupply: number | null;
    maxSupply: number | null;
    updatedAt: string;
  }>;
  rwaStocks: RwaMarket[];
};
export type CryptoProfile = {
  name: string;
  symbol: string;
  description: string | null;
  categories: string[];
  launchedAt: string | null;
  website: string | null;
  explorer: string | null;
};
export type PythReference = {
  symbol: string;
  price: string;
  confidence: string | null;
  marketSession: string | null;
  feedUpdateTimestamp: string;
  referenceFreshness: "live" | "carried_forward" | "stale";
  ageMs: number;
  source: "pyth-core" | "public-equity";
};
export type ClawpumpToken = {
  mint?: string;
  address?: string;
  symbol: string;
  name: string;
  verified?: boolean;
  price?: string | number | null;
  marketCap?: string | number | null;
  liquidity?: string | number | null;
};
export type Venue = "binance" | "hyperliquid";
export type MacroRegime = {
  state: "risk_on" | "mixed" | "risk_off";
  rationale: string;
  sources: Array<{
    id: "VIXCLS" | "DGS10" | "T10Y2Y";
    value: number;
    asOf: string;
    source: "fred";
  }>;
  tenYearChange20d: number;
  fetchedAt: string;
};
export type AgentTemplate = {
  id: string;
  name: string;
  description: string;
  universe: readonly string[];
  timeframe: string;
  factors: readonly string[];
  risk: string;
  rules?: {
    entry: ReadonlyArray<{ type: string } & Record<string, unknown>>;
    exit: ReadonlyArray<{ type: string } & Record<string, unknown>>;
  } | null;
};
export type CustomAgent = {
  id: string;
  name: string;
  version: string;
  stage: string;
  autonomy: string;
  hasRules?: boolean;
  manifestHash: string | null;
  createdAt: string;
  policy: {
    description?: string;
    universe?: string[];
    timeframe?: string;
    factors?: string[];
    capitalAllocation?: { maxCapitalUsd: number; maxTradeNotionalUsd: number };
    riskGuardrails?: { maxDailyDrawdownPct: number; maxOpenPositions: number };
  };
};
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
export type ChainTvl = {
  name: string;
  tvlUsd: number;
  tokenSymbol: string | null;
  chainId: string | null;
  observedAt: string;
  source: "defillama";
};
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
export type ReferenceMarket = {
  symbol: string;
  name: string;
  priceUsd: number;
  change24hPct: number | null;
  volume24hUsd: number | null;
  observedAt: string;
  source: "coingecko";
};
export type MarketIntelligence = {
  score: number;
  regime: "risk_on" | "risk_off" | "transition";
  direction: "long" | "short" | "neutral";
  confidence: number;
  signals: Array<{
    id: string;
    label: string;
    value: number;
    score: number;
    direction: "bullish" | "bearish" | "neutral";
    confidence: number;
  }>;
  observedAt: string;
  sampleSize: number;
};

export type ApiIdentity = { accessToken?: string | undefined; localOperator?: boolean | undefined };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly requestId: string | null,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function accountErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "The service is temporarily unavailable. Please retry.";
  const detail = error.requestId ? ` Reference ${error.requestId}.` : "";
  if (error.status === 401) return `Your session has expired. Sign in again.${detail}`;
  if (error.status === 403) return `This account does not have access.${detail}`;
  if (/database|identity_store|persistence/.test(error.code))
    return `Account database is unavailable.${detail}`;
  if (error.code === "provider_credentials_invalid")
    return `Clawpump API credentials require attention from the operator.${detail}`;
  if (error.code === "provider_rate_limited")
    return `Clawpump is rate limited. Try again shortly.${detail}`;
  if (error.status === 503) return `The data provider is unavailable.${detail}`;
  return `The request failed.${detail}`;
}

function identityHeaders(identity: ApiIdentity): HeadersInit {
  if (identity.accessToken?.startsWith("guest:") || identity.accessToken?.startsWith("wallet:"))
    return process.env.NODE_ENV !== "production"
      ? { "x-sisera-dev-role": "viewer", "x-sisera-dev-subject": "web-local" }
      : {};
  if (identity.accessToken) return { authorization: `Bearer ${identity.accessToken}` };
  if (identity.localOperator && process.env.NODE_ENV !== "production")
    return { "x-sisera-dev-role": "admin", "x-sisera-dev-subject": "web-local" };
  return {};
}

async function getJson<T>(path: string, identity: ApiIdentity, timeoutMs = 5000): Promise<T> {
  const response = await fetch(`${serverApiUrl()}${path}`, {
    headers: { accept: "application/json", ...identityHeaders(identity) },
    // Signed-in requests are always fresh; public pages share a short-lived cache.
    ...(identity.accessToken || identity.localOperator
      ? { cache: "no-store" as const }
      : { next: { revalidate: 60 } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      typeof payload?.error === "string" ? payload.error : "request_failed",
      response.headers.get("x-request-id") ??
        (typeof payload?.requestId === "string" ? payload.requestId : null),
      typeof payload?.message === "string"
        ? payload.message
        : `Sisera API returned ${response.status}`,
    );
  }
  return response.json() as Promise<T>;
}

export function getMarket(symbol: string, identity: ApiIdentity, venue: Venue = "binance") {
  return getJson<{ instrument: Instrument; snapshot: MarketSnapshot }>(
    `/v1/markets/${encodeURIComponent(symbol)}?venue=${venue}`,
    identity,
  );
}

export async function getMarkets(
  symbols: readonly string[],
  identity: ApiIdentity,
  venue: Venue = "binance",
) {
  return getJson<{ data: MarketRow[]; unavailable: Array<{ symbol: string; reason: string }> }>(
    `/v1/markets?symbols=${encodeURIComponent(symbols.join(","))}&venue=${venue}`,
    identity,
  );
}

export async function getReferenceMarkets(symbols: readonly string[], identity: ApiIdentity) {
  const payload = await getJson<{ data: ReferenceMarket[] }>(
    `/v1/reference-markets?symbols=${encodeURIComponent(symbols.join(","))}`,
    identity,
    8000,
  );
  return payload.data;
}

export async function getPrivateMarkets(identity: ApiIdentity) {
  const payload = await getJson<{ data: PreStock[] }>("/v1/private-markets", identity, 9000);
  return payload.data;
}

export async function getPublicStocks(identity: ApiIdentity) {
  const payload = await getJson<{ data: PublicStock[] }>("/v1/public-stocks", identity, 15000);
  return payload.data;
}

export async function getMarketOverview(identity: ApiIdentity) {
  const payload = await getJson<{ data: MarketOverview }>("/v1/market-overview", identity, 10000);
  return payload.data;
}

export async function getCryptoProfile(id: number, identity: ApiIdentity) {
  const payload = await getJson<{ data: CryptoProfile }>(
    `/v1/crypto/${id}/profile`,
    identity,
    10000,
  );
  return payload.data;
}

export async function getRwaStocks(identity: ApiIdentity) {
  const payload = await getJson<{ data: RwaMarket[] }>("/v1/rwa/stocks", identity, 10000);
  return payload.data;
}

export async function getRwaDetail(symbol: string, identity: ApiIdentity) {
  const payload = await getJson<{ data: { market: RwaMarket | null; profile: RwaProfile | null } }>(
    `/v1/rwa/${encodeURIComponent(symbol)}`,
    identity,
    10000,
  );
  return payload.data;
}

export type TokenHistoryPoint = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd: number | null;
};

export async function getRwaTokenHistory(
  symbol: string,
  token: string,
  period: "hourly" | "daily",
  identity: ApiIdentity,
) {
  const payload = await getJson<{ data: TokenHistoryPoint[] }>(
    `/v1/rwa/${encodeURIComponent(symbol)}/history?token=${encodeURIComponent(token)}&period=${period}`,
    identity,
    12000,
  );
  return payload.data;
}

export async function getSolanaTokenHistory(
  mint: string,
  interval: "1h" | "1d",
  identity: ApiIdentity,
) {
  const payload = await getJson<{ data: TokenHistoryPoint[] }>(
    `/v1/solana/tokens/${encodeURIComponent(mint)}/history?interval=${interval}`,
    identity,
    12000,
  );
  return payload.data;
}

export async function getPythReference(symbol: string, identity: ApiIdentity) {
  const payload = await getJson<{ data: PythReference }>(
    `/v1/pyth/reference?symbol=${encodeURIComponent(symbol)}`,
    identity,
    9000,
  );
  return payload.data;
}

export async function getPythReferences(symbols: readonly string[], identity: ApiIdentity) {
  const payload = await getJson<{ data: PythReference[] }>(
    `/v1/pyth/references?symbols=${encodeURIComponent(symbols.join(","))}`,
    identity,
    10000,
  );
  return payload.data;
}

export async function getStockNews(symbol: string, identity: ApiIdentity) {
  return getJson<{ data: StockNewsItem[]; providers: string[]; delayedPossible: boolean }>(
    `/v1/stocks/${encodeURIComponent(symbol)}/news`,
    identity,
    9000,
  );
}

export function getSocialFeed(identity: ApiIdentity) {
  return getJson<{ data: SocialPost[]; sources: Record<string, string>; fetchedAt: string }>(
    "/v1/social-feed",
    identity,
    14000,
  );
}

export async function searchClawpump(query: string, identity: ApiIdentity) {
  return getJson<{
    data: { tokens: ClawpumpToken[]; droppedUnverified?: number };
    source: "clawpump";
  }>(`/v1/clawpump/search?query=${encodeURIComponent(query)}`, identity, 9000);
}

export type JupiterQuote = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string | null;
  router: string;
  requestId: string;
  executable: false;
};
export async function getJupiterQuote(
  inputMint: string,
  outputMint: string,
  amount: string,
  identity: ApiIdentity,
) {
  const query = new URLSearchParams({ inputMint, outputMint, amount });
  const result = await getJson<{ data: JupiterQuote }>(
    `/v1/solana/quote?${query}`,
    identity,
    11000,
  );
  return result.data;
}

export async function getSolanaWallet(address: string, identity: ApiIdentity) {
  const payload = await getJson<{ data: SolanaWallet }>(
    `/v1/solana/wallet/${encodeURIComponent(address)}`,
    identity,
    9000,
  );
  return payload.data;
}

export async function getHyperEvmWallet(address: string, identity: ApiIdentity) {
  const payload = await getJson<{ data: HyperEvmWallet }>(
    `/v1/wallets/hyperevm/${encodeURIComponent(address)}`,
    identity,
    9000,
  );
  return payload.data;
}

export async function getCandles(
  symbol: string,
  interval: string,
  identity: ApiIdentity,
  venue: Venue = "binance",
) {
  const payload = await getJson<{ data: Candle[]; interval: string }>(
    `/v1/markets/${encodeURIComponent(symbol)}/candles?interval=${encodeURIComponent(interval)}&limit=240&venue=${venue}`,
    identity,
  );
  return payload.data;
}

export async function getOrderBook(
  symbol: string,
  identity: ApiIdentity,
  venue: Venue = "binance",
) {
  const payload = await getJson<{ data: OrderBook }>(
    `/v1/markets/${encodeURIComponent(symbol)}/depth?limit=20&venue=${venue}`,
    identity,
  );
  return payload.data;
}

export async function getMarketIntelligence(
  symbol: string,
  identity: ApiIdentity,
  venue: Venue = "binance",
) {
  const payload = await getJson<{ data: MarketIntelligence }>(
    `/v1/markets/${encodeURIComponent(symbol)}/intelligence?venue=${venue}`,
    identity,
  );
  return payload.data;
}

export async function getPerpetualMetrics(identity: ApiIdentity) {
  const payload = await getJson<{ data: PerpetualMetric[] }>("/v1/perpetual-metrics", identity);
  return payload.data;
}

export async function getChains(identity: ApiIdentity) {
  const payload = await getJson<{ data: ChainTvl[] }>("/v1/chains?limit=20", identity, 8000);
  return payload.data;
}

export async function getMacroRegime(identity: ApiIdentity) {
  const payload = await getJson<{ data: MacroRegime }>("/v1/macro-regime", identity, 15000);
  return payload.data;
}

export async function getPublicPerpAccount(address: string, identity: ApiIdentity) {
  const payload = await getJson<{ data: PublicPerpAccount }>(
    `/v1/public-wallet/${encodeURIComponent(address)}`,
    identity,
    8000,
  );
  return payload.data;
}

export type PredictionPage = {
  data: PredictionMarket[];
  total: number;
  all: number;
  categories: Array<{ name: string; count: number }>;
};

/** One filtered, sorted page of open prediction markets, with category counts. */
export async function getPredictionMarkets(
  identity: ApiIdentity,
  query: {
    limit?: number;
    offset?: number;
    category?: string | undefined;
    q?: string | undefined;
    sort?: "volume" | "closing" | "contested";
  } = {},
) {
  const params = new URLSearchParams();
  params.set("limit", String(query.limit ?? 50));
  params.set("offset", String(query.offset ?? 0));
  if (query.category && query.category !== "all") params.set("category", query.category);
  if (query.q) params.set("q", query.q);
  params.set("sort", query.sort ?? "volume");
  return getJson<PredictionPage>(`/v1/prediction-markets?${params.toString()}`, identity, 10000);
}

export async function getAgents(identity: ApiIdentity) {
  return getJson<{ templates: AgentTemplate[]; custom: CustomAgent[]; persistence: string }>(
    "/v1/agents",
    identity,
  );
}

export type MarketActivityOrder = {
  id: string;
  venue: string;
  symbol: string;
  side: string;
  quantity: string;
  status: string;
  createdAt: string;
  mode: "paper" | "live";
  venueOrderId?: string | null;
};

export type AccountEvent = {
  id: string;
  source: string;
  sourceId: string;
  mode: "paper" | "live";
  status: string;
  detail: Record<string, string>;
  occurredAt: string;
};

export async function getAccountEvents(identity: ApiIdentity) {
  const payload = await getJson<{ data: AccountEvent[] }>("/v1/activity/events", identity, 8000);
  return payload.data;
}

export async function getMarketOrders(identity: ApiIdentity): Promise<MarketActivityOrder[]> {
  const [paper, live] = await Promise.all([
    getJson<{ data: Omit<MarketActivityOrder, "mode">[] }>("/v1/market-orders/paper", identity),
    getJson<{ data: Omit<MarketActivityOrder, "mode">[] }>("/v1/market-orders/live", identity),
  ]);
  return [
    ...paper.data.map((order) => ({ ...order, mode: "paper" as const })),
    ...live.data.map((order) => ({ ...order, mode: "live" as const })),
  ];
}

export async function getPredictionOrders(identity: ApiIdentity) {
  const payload = await getJson<{
    data: Array<{
      id: string;
      wallet: string;
      marketId: string;
      outcome: string;
      depositAmount: string;
      orderPubkey: string;
      status: string;
      signature: string | null;
      venueStatus: string | null;
      createdAt: string;
    }>;
  }>("/v1/prediction-orders", identity);
  return payload.data;
}

export async function getSolanaOrders(identity: ApiIdentity) {
  const payload = await getJson<{
    data: Array<{
      id: string;
      mode: string;
      status: string;
      wallet: string;
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
      signature: string | null;
      createdAt: string;
    }>;
  }>("/v1/solana/orders", identity);
  return payload.data;
}

export type SpotMarket = {
  symbol: string;
  base: string;
  quote: string;
  last: number;
  change24hPct: number;
  high24h: number;
  low24h: number;
  volume24hBase: number;
  volume24hUsd: number;
};

export async function getSpotUniverse(identity: ApiIdentity) {
  const payload = await getJson<{ data: SpotMarket[] }>("/v1/spot-universe", identity, 10000);
  return payload.data;
}

export type AgentToken = {
  mint: string;
  name: string;
  symbol: string;
  description: string | null;
  imageUrl: string | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  agentName: string | null;
  verified: boolean;
  graduated: boolean;
  tags: string[];
  website: string | null;
  twitter: string | null;
  createdAt: string | null;
  launchPlatform: string | null;
};

export async function getAgentTokens(
  query: {
    sort?: "volume" | "new" | "mcap";
    q?: string | undefined;
    limit?: number;
    offset?: number;
  },
  identity: ApiIdentity,
) {
  const params = new URLSearchParams();
  if (query.sort) params.set("sort", query.sort);
  if (query.q) params.set("q", query.q);
  params.set("limit", String(query.limit ?? 60));
  params.set("offset", String(query.offset ?? 0));
  return getJson<{ data: AgentToken[]; total: number; hasMore: boolean }>(
    `/v1/agent-tokens?${params.toString()}`,
    identity,
    12000,
  );
}

export type PredictionResearch = {
  marketId: string;
  history: Array<{ time: number; value: number }>;
  stats: {
    probability: number;
    change24hPts: number | null;
    change7dPts: number | null;
    change30dPts: number | null;
    sinceOpenPts: number | null;
    high: number | null;
    low: number | null;
    dailyVolatilityPts: number | null;
    maxDrawdownPts: number | null;
    shareOfTimeAbove50: number | null;
    daysOpen: number | null;
    daysToClose: number | null;
    volumeUsd: number | null;
  };
  orderBook: {
    bestBid: number | null;
    bestAsk: number | null;
    spread: number | null;
    bidDepthUsd: number;
    askDepthUsd: number;
    lastTrade: number | null;
  } | null;
  related: Array<{ id: string; title: string; probability: number }>;
  underlying: {
    symbol: string;
    spot: number;
    strike: number;
    kind: "touch" | "settle";
    direction: "up" | "down";
    distancePct: number;
    alreadyThere: boolean;
    annualizedVolatility: number;
    daysToClose: number;
    modelProbability: number;
    historicalFrequency: number | null;
    historicalWindows: number;
    marketProbability: number;
    candles: Array<{ time: number; open: number; high: number; low: number; close: number }>;
  } | null;
  sources: string[];
  measuredAt: string;
};

export async function getPredictionMarket(id: string, identity: ApiIdentity) {
  return getJson<{ data: PredictionMarket; related: PredictionMarket[] }>(
    `/v1/prediction-markets/${encodeURIComponent(id)}`,
    identity,
    12000,
  );
}

export async function getPredictionResearch(id: string, identity: ApiIdentity) {
  const payload = await getJson<{ data: PredictionResearch }>(
    `/v1/prediction-markets/${encodeURIComponent(id)}/research`,
    identity,
    20000,
  );
  return payload.data;
}

export type AgentTokenDetail = {
  asset: {
    key: string;
    symbol: string;
    name: string;
    mint: string;
    priceUsd: number | null;
    change24hPct: number | null;
    liquidityUsd: number | null;
    volume24hUsd: number | null;
    marketCapUsd: number | null;
    imageUrl: string | null;
    pairedStock: { symbol: string; mint: string } | null;
  };
  token: {
    description: string | null;
    agentName: string | null;
    verified: boolean;
    xVerified: boolean;
    graduated: boolean;
    website: string | null;
    twitter: string | null;
    createdAt: string | null;
    quoteSymbol: string | null;
    creatorAllocationBps: number | null;
    vesting: { cliffDays: number | null; durationDays: number | null } | null;
    tags: string[];
  } | null;
  concentration: {
    top10WalletPct: number;
    top1WalletPct: number;
    programHeldPct: number;
    walletsSampled: number;
    method: string;
  } | null;
  risk: {
    score: number;
    level: string;
    components: Array<{ name: string; points: number; detail: string }>;
  };
  pairedStock: {
    symbol: string;
    name: string;
    priceUsd: number | null;
    change24hPct: number | null;
    relativePerformancePct: number | null;
  } | null;
};

export async function getAgentTokenDetail(mint: string, identity: ApiIdentity) {
  const payload = await getJson<{ data: AgentTokenDetail }>(
    `/v1/agent-market/tokens/${encodeURIComponent(mint)}`,
    identity,
    15000,
  );
  return payload.data;
}
