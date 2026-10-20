import type { PublicStock, ReferenceMarket, SolanaWallet } from "./api";

export type ValuedHolding = {
  mint: string;
  symbol: string;
  name: string | null;
  icon: string | null;
  amount: number;
  priceUsd: number | null;
  valueUsd: number | null;
  source: "jupiter" | "xstocks" | "unpriced";
};

export type WalletObservation = {
  /** Tokens worth showing, most valuable first. */
  holdings: ValuedHolding[];
  /** Likely spam airdrops, kept out of every total. */
  suspicious: ValuedHolding[];
  pricedValueUsd: number;
  unpricedCount: number;
  largestSharePct: number | null;
  solValueUsd: number | null;
  /** USDC plus USDT, the balance that is ready to trade. */
  stablecoinUsd: number;
};

const STABLECOINS = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
]);

/**
 * Values a Solana wallet. The API prices every token through Jupiter; tokenized stocks fall back to
 * their xStocks quote when that price is missing.
 */
export function valueSolanaWallet(
  wallet: SolanaWallet,
  stocks: readonly PublicStock[],
  referenceMarkets: readonly ReferenceMarket[],
  now = Date.now(),
): WalletObservation {
  const byMint = new Map(stocks.map((stock) => [stock.mint, stock]));
  const valued = wallet.holdings.map((holding) => {
    const amount = Number(holding.rawBalance) / 10 ** holding.decimals;
    const stock = byMint.get(holding.mint);
    const stockPrice = Number(stock?.dexPriceUsd);
    const stockFresh =
      stock &&
      now - Date.parse(stock.fetchedAt) <= 5 * 60_000 &&
      !stock.tradingHalted &&
      Number.isFinite(stockPrice) &&
      stockPrice > 0;
    const price =
      holding.priceUsd != null && holding.priceUsd > 0
        ? holding.priceUsd
        : stockFresh
          ? stockPrice
          : null;
    const priced = price != null && Number.isFinite(amount) && amount >= 0;
    return {
      suspicious: holding.suspicious === true,
      holding: {
        mint: holding.mint,
        symbol: holding.symbol ?? stock?.symbol ?? holding.name ?? "Unknown token",
        name: holding.name ?? null,
        icon: holding.icon ?? null,
        amount,
        priceUsd: priced ? price : null,
        valueUsd: priced ? amount * price : null,
        source: !priced
          ? "unpriced"
          : holding.priceUsd != null && holding.priceUsd > 0
            ? "jupiter"
            : "xstocks",
      } satisfies ValuedHolding,
    };
  });
  const holdings = valued
    .filter((item) => !item.suspicious)
    .map((item) => item.holding)
    .sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
  const pricedValueUsd = holdings.reduce((sum, holding) => sum + (holding.valueUsd ?? 0), 0);
  const largestValue = Math.max(0, ...holdings.map((holding) => holding.valueUsd ?? 0));
  const sol = referenceMarkets.find((market) => market.symbol === "SOLUSDT");
  const solFresh = sol && now - Date.parse(sol.observedAt) <= 5 * 60_000;
  const solValueUsd =
    wallet.solValueUsd ??
    (solFresh && Number.isFinite(sol.priceUsd) && sol.priceUsd > 0
      ? (Number(wallet.solLamports) / 1e9) * sol.priceUsd
      : null);
  return {
    holdings,
    suspicious: valued.filter((item) => item.suspicious).map((item) => item.holding),
    pricedValueUsd,
    unpricedCount: holdings.filter((holding) => holding.valueUsd === null).length,
    largestSharePct: pricedValueUsd > 0 ? (largestValue / pricedValueUsd) * 100 : null,
    solValueUsd,
    stablecoinUsd: holdings
      .filter((holding) => STABLECOINS.has(holding.mint))
      .reduce((sum, holding) => sum + (holding.valueUsd ?? 0), 0),
  };
}
