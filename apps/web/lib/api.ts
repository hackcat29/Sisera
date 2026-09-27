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
export type PythReference = {
  symbol: string;
  price: string;
  confidence: string | null;
  marketSession: string | null;
  feedUpdateTimestamp: string;
  referenceFreshness: "live" | "carried_forward" | "stale";
  ageMs: number;
  source: "pyth-pro";
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
};
export type CustomAgent = {
  id: string;
  name: string;
  version: string;
  stage: string;
  autonomy: string;
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

type ApiIdentity = { accessToken?: string | undefined; localOperator?: boolean | undefined };

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
    cache: "no-store",
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

export async function getPredictionMarkets(identity: ApiIdentity) {
  const payload = await getJson<{ data: PredictionMarket[] }>(
    "/v1/prediction-markets?limit=24",
    identity,
  );
  return payload.data;
}

export async function getAgents(identity: ApiIdentity) {
  return getJson<{ templates: AgentTemplate[]; custom: CustomAgent[]; persistence: string }>(
    "/v1/agents",
    identity,
  );
}

export async function getLeaderboard(identity: ApiIdentity) {
  return getJson<{
    data: Array<{ name: string; pnlUsd: number; returnPct: number; observedAt: string }>;
    scope: string;
    baselineUsd: number;
    skippedUnpriced: number;
  }>("/v1/leaderboard", identity, 15000);
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
