/** Hyperliquid's coin icons; a missing icon returns a web page, which the avatar skips. */
const HYPERLIQUID_ICONS = "https://app.hyperliquid.xyz/coins";

/**
 * Icons for a Hyperliquid perpetual. Thousand-unit contracts such as kPEPE use the base coin's
 * icon.
 */
export function perpLogos(coin: string) {
  const base = coin.replace(/^k(?=[A-Z])/, "");
  return [`${HYPERLIQUID_ICONS}/${coin}.svg`, `${HYPERLIQUID_ICONS}/${base}.svg`];
}

/**
 * Icons for a Hyperliquid spot token: the pair's own icon first, then the coin it represents, so
 * Unit Bitcoin (UBTC) shows the Bitcoin logo and Unit Fartcoin (UFART) the Fartcoin one.
 */
export function spotLogos(market: { token: string; symbol: string; name?: string | null }) {
  const name = market.name?.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  // Bridged tokens often name the coin first: "NEAR Protocol" (ONEAR), "XMR - Wagyu.xyz" (XMR1).
  const firstWord = market.name?.match(/^[A-Za-z0-9]+/)?.[0]?.toUpperCase();
  return [
    `${HYPERLIQUID_ICONS}/${market.token}_USDC.svg`,
    `${HYPERLIQUID_ICONS}/${market.symbol}.svg`,
    ...(name ? [`${HYPERLIQUID_ICONS}/${name}.svg`] : []),
    ...(firstWord ? [`${HYPERLIQUID_ICONS}/${firstWord}.svg`] : []),
  ];
}

/** Coins a prediction question is about, matched by name or ticker, mapped to their icon. */
const PREDICTION_COINS: Array<[RegExp, string]> = [
  [/\b(bitcoin|btc)\b/i, "BTC"],
  [/\b(ethereum|ether|eth)\b/i, "ETH"],
  [/\b(solana|sol)\b/i, "SOL"],
  [/\b(hyperliquid|hype)\b/i, "HYPE"],
  [/\b(dogecoin|doge)\b/i, "DOGE"],
  [/\b(xrp|ripple)\b/i, "XRP"],
  [/\b(bnb)\b/i, "BNB"],
  [/\b(pump\.?fun|pump)\b/i, "PUMP"],
];

/**
 * A prediction market's picture: its own image when the venue supplies one, otherwise the icon of
 * the coin the question is about. Returns null when neither exists.
 */
export function predictionLogos(market: { imageUrl?: string | null | undefined; title: string }) {
  // The coin named first is the subject: "Will Hyperliquid surpass Solana…" shows HYPE.
  const coin = PREDICTION_COINS.map(([pattern, symbol]) => ({
    symbol,
    at: market.title.search(pattern),
  }))
    .filter((match) => match.at >= 0)
    .sort((a, b) => a.at - b.at)[0]?.symbol;
  const sources = [market.imageUrl, coin ? `${HYPERLIQUID_ICONS}/${coin}.svg` : null].filter(
    (url): url is string => !!url,
  );
  return sources.length ? sources : null;
}
