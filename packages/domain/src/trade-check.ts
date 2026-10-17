export type TradeCheckReport = {
  mint: string;
  name: string;
  symbol: string;
  checkedAt: string;
  market: {
    priceUsd: number | null;
    change1hPct: number | null;
    change24hPct: number | null;
    volume24hUsd: number | null;
    liquidityUsd: number | null;
    largestPoolUsd: number | null;
    marketCapUsd: number | null;
    fdvUsd: number | null;
    buys24h: number | null;
    sells24h: number | null;
    pools: number;
    dex: string | null;
    url: string | null;
  } | null;
  chain: {
    mintAuthority: string | null;
    freezeAuthority: string | null;
    supply: number;
    top10SampledWalletPct: number | null;
    largestSampledWalletPct: number | null;
    programAddressPct: number | null;
    sampledAccounts: number;
    sampledWallets: number;
  } | null;
  news: Array<{ title: string; url: string; publisher: string; publishedAt: string }>;
  newsStatus: "available" | "unavailable";
  summary: string;
  checks: Array<{
    id: string;
    title: string;
    status: "attention" | "observed" | "unknown";
    detail: string;
    source: "market" | "chain" | "news";
  }>;
  sources: Array<{
    id: string;
    label: string;
    url: string;
    status: "available" | "unavailable";
    observedAt: string;
  }>;
};

export type TradeCheckAnswer = {
  answer: string;
  sources: TradeCheckReport["sources"];
  checkedAt: string;
  mode: "data" | "ai";
};
