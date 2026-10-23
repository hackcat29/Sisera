import type { PredictionMarket } from "@sisera/domain";
import { z } from "zod";

type Fetcher = typeof globalThis.fetch;

const PriceHistory = z.object({
  history: z.array(z.object({ t: z.number(), p: z.number() })),
});
const Book = z.object({
  bids: z.array(z.object({ price: z.string(), size: z.string() })).default([]),
  asks: z.array(z.object({ price: z.string(), size: z.string() })).default([]),
  last_trade_price: z.string().optional(),
});
const Kline = z
  .tuple([z.number(), z.string(), z.string(), z.string(), z.string()])
  .rest(z.unknown());

/** Binance pairs for the crypto assets Polymarket lists price markets on. */
const assetPairs: Record<string, string> = {
  btc: "BTCUSDT",
  bitcoin: "BTCUSDT",
  eth: "ETHUSDT",
  ethereum: "ETHUSDT",
  sol: "SOLUSDT",
  solana: "SOLUSDT",
  xrp: "XRPUSDT",
  doge: "DOGEUSDT",
  dogecoin: "DOGEUSDT",
  bnb: "BNBUSDT",
  ada: "ADAUSDT",
  cardano: "ADAUSDT",
  hype: "HYPEUSDT",
  sui: "SUIUSDT",
  link: "LINKUSDT",
  avax: "AVAXUSDT",
  ltc: "LTCUSDT",
};

type StrikeMarket = {
  pair: string;
  strike: number;
  kind: "touch" | "settle";
  direction: "up" | "down";
};

/** Reads the asset, strike, and payoff shape from a crypto price market's title. */
export function parseStrikeMarket(market: PredictionMarket): StrikeMarket | null {
  const eventTitle = market.eventTitle ?? market.title;
  const outcomeTitle = market.marketTitle ?? "";
  const words = [market.subcategory ?? "", ...eventTitle.toLowerCase().split(/[^a-z]+/)];
  const pair = words.map((word) => assetPairs[word.toLowerCase()]).find(Boolean);
  if (!pair) return null;
  const number =
    /(?:above|below|exceed|reach|hit|dip(?: to)?|[↑↓])\s*\$?([\d,]+(?:\.\d+)?)\s*(k|m)?/i.exec(
      `${eventTitle} ${outcomeTitle}`,
    ) ?? /\$([\d,]+(?:\.\d+)?)\s*(k|m)?/i.exec(outcomeTitle);
  if (!number?.[1]) return null;
  const scale =
    number[2]?.toLowerCase() === "k" ? 1_000 : number[2]?.toLowerCase() === "m" ? 1e6 : 1;
  const strike = Number(number[1].replaceAll(",", "")) * scale;
  if (!Number.isFinite(strike) || strike <= 0) return null;
  const title = eventTitle.toLowerCase();
  if (/\bhit\b|\breach\b|\bdip\b/.test(title))
    return {
      pair,
      strike,
      kind: "touch",
      direction: /↓|\bdip\b/i.test(`${eventTitle} ${outcomeTitle}`) ? "down" : "up",
    };
  if (/\babove\b|\bexceed\b/.test(title)) return { pair, strike, kind: "settle", direction: "up" };
  if (/\bbelow\b/.test(title)) return { pair, strike, kind: "settle", direction: "down" };
  return null;
}

// Standard normal CDF (Abramowitz–Stegun 7.1.26).
function normalCdf(x: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(x)) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

const pctChange = (from: number | undefined, to: number) =>
  from == null ? null : (to - from) * 100;

/** Latest probability at or before a moment, from an ascending history. */
function pointAt(history: Array<{ t: number; p: number }>, seconds: number) {
  let found: number | undefined;
  let observed = 0;
  for (const point of history) {
    if (point.t > seconds) break;
    found = point.p;
    observed = point.t;
  }
  return seconds - observed <= 3600 ? found : undefined;
}

export async function researchPredictionMarket(
  market: PredictionMarket,
  siblings: PredictionMarket[],
  fetcher: Fetcher = globalThis.fetch,
  panta?: { baseUrl: string; apiKey?: string | undefined },
) {
  const nativePanta =
    market.underlyingProvider === "panta" || market.quality.source.startsWith("panta-");
  const yesToken = nativePanta ? undefined : market.venueTokenIds?.[0];
  const current = Number(market.outcomes[0]?.probability ?? 0);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const [historyResult, bookResult] = await Promise.allSettled([
    yesToken
      ? fetcher(
          `https://clob.polymarket.com/prices-history?market=${yesToken}&interval=max&fidelity=60`,
          { signal: AbortSignal.timeout(8000) },
        ).then(async (response) => {
          if (!response.ok) throw new Error("History unavailable");
          return PriceHistory.parse(await response.json()).history;
        })
      : Promise.resolve([]),
    yesToken
      ? fetcher(`https://clob.polymarket.com/book?token_id=${yesToken}`, {
          signal: AbortSignal.timeout(8000),
        }).then(async (response) => {
          if (!response.ok) throw new Error("Book unavailable");
          return Book.parse(await response.json());
        })
      : nativePanta && market.pricingAvailable !== false && panta
        ? fetcher(`${panta.baseUrl.replace(/\/$/, "")}/markets/${encodeURIComponent(market.id)}/`, {
            headers: {
              accept: "application/json",
              ...(panta.apiKey ? { "x-api-key": panta.apiKey } : {}),
            },
            signal: AbortSignal.timeout(8000),
          }).then(async (response) => {
            if (!response.ok) throw new Error("Panta book unavailable");
            const raw = (await response.json()) as Record<string, unknown>;
            const parseNum = (v: unknown) => {
              if (v == null) return null;
              const n = Number(v);
              return Number.isFinite(n) && n > 0 ? n : null;
            };
            const yesVal =
              parseNum(raw.primaryYesPrice) ??
              parseNum(raw.yesPrice) ??
              (raw.pricing && typeof raw.pricing === "object"
                ? parseNum((raw.pricing as Record<string, unknown>).yes)
                : null);
            const p = yesVal != null && yesVal > 0 && yesVal < 1 ? yesVal : current;
            if (!Number.isFinite(p) || p <= 0 || p >= 1) return null;
            const spreadBps = Number(raw.currentRoyaltyBps ?? 100);
            const halfSpread = Math.max(0.002, p * (spreadBps / 20_000));
            const bestBid = Math.max(0.01, p - halfSpread);
            const bestAsk = Math.min(0.99, p + halfSpread);
            const solReserves = Number(raw.virtualSolReserves ?? 0);
            const yesShares = Number(raw.virtualYesShares ?? 0);
            const bidDepth =
              solReserves > 0
                ? solReserves / 1_000_000
                : raw.totalVolumeUsdc
                  ? Number(raw.totalVolumeUsdc)
                  : 500;
            const askDepth = yesShares > 0 ? yesShares / 1_000_000 : bidDepth;
            const lastTradePrice = raw.lastYesPrice
              ? (Number(raw.lastYesPrice) > 1
                  ? Number(raw.lastYesPrice) / 1_000_000_000
                  : Number(raw.lastYesPrice)
                ).toFixed(4)
              : p.toFixed(4);
            return {
              bids: [{ price: bestBid.toFixed(4), size: (bidDepth / bestBid).toFixed(2) }],
              asks: [{ price: bestAsk.toFixed(4), size: (askDepth / bestAsk).toFixed(2) }],
              last_trade_price: lastTradePrice,
            };
          })
        : Promise.resolve(null),
  ]);
  const history =
    historyResult.status === "fulfilled"
      ? [
          ...new Map(
            historyResult.value
              .filter(
                (p) =>
                  Number.isFinite(p.t) &&
                  p.t > 0 &&
                  p.t <= nowSeconds &&
                  Number.isFinite(p.p) &&
                  p.p >= 0 &&
                  p.p <= 1,
              )
              .map((p) => [p.t, p]),
          ).values(),
        ].sort((a, b) => a.t - b.t)
      : [];
  const book = bookResult.status === "fulfilled" ? bookResult.value : null;

  // Probability statistics, in percentage points.
  const probabilities = history.map((point) => point.p);
  const deviation = (moves: number[]) => {
    const mean = moves.reduce((sum, move) => sum + move, 0) / moves.length;
    return Math.sqrt(moves.reduce((sum, move) => sum + (move - mean) ** 2, 0) / moves.length);
  };
  const dailyPoints = new Map<number, { t: number; p: number }>();
  for (const point of history) dailyPoints.set(Math.floor(point.t / 86_400), point);
  const daily = [...dailyPoints.values()];
  const dailyMoves = daily.slice(1).flatMap((point, i) => {
    const previous = daily[i];
    return previous && Math.floor(point.t / 86400) - Math.floor(previous.t / 86400) === 1
      ? [(point.p - previous.p) * 100]
      : [];
  });
  const volatility = dailyMoves.length >= 5 ? deviation(dailyMoves) : null;
  let peak = 0;
  let maxDrawdown = 0;
  for (const value of probabilities) {
    peak = Math.max(peak, value);
    maxDrawdown = Math.max(maxDrawdown, (peak - value) * 100);
  }
  const closesAt = market.closesAt ? Date.parse(market.closesAt) : null;
  const openedAt = market.openedAt
    ? Date.parse(market.openedAt)
    : history[0]
      ? history[0].t * 1000
      : null;
  // Weight by observed duration rather than by tick count. Do not bridge gaps over an hour.
  let coveredSeconds = 0;
  let above50Seconds = 0;
  for (let i = 0; i < history.length - 1; i++) {
    const point = history[i];
    const next = history[i + 1];
    if (!point || !next) continue;
    const duration = next.t - point.t;
    if (duration <= 0 || duration > 3600) continue;
    coveredSeconds += duration;
    if (point.p > 0.5) above50Seconds += duration;
  }
  const stats = {
    probability: market.pricingAvailable === false ? null : current,
    change24hPts:
      market.pricingAvailable === false
        ? null
        : pctChange(pointAt(history, nowSeconds - 86_400), current),
    change7dPts:
      market.pricingAvailable === false
        ? null
        : pctChange(pointAt(history, nowSeconds - 7 * 86_400), current),
    change30dPts:
      market.pricingAvailable === false
        ? null
        : pctChange(pointAt(history, nowSeconds - 30 * 86_400), current),
    sinceOpenPts: market.pricingAvailable === false ? null : pctChange(history[0]?.p, current),
    high: probabilities.length ? Math.max(...probabilities) : null,
    low: probabilities.length ? Math.min(...probabilities) : null,
    dailyVolatilityPts: volatility,
    maxDrawdownPts: probabilities.length ? maxDrawdown : null,
    shareOfTimeAbove50: coveredSeconds > 0 ? above50Seconds / coveredSeconds : null,
    daysOpen: openedAt ? (Date.now() - openedAt) / 86_400_000 : null,
    daysToClose: closesAt ? Math.max(0, (closesAt - Date.now()) / 86_400_000) : null,
    volumeUsd: market.volumeUsd ?? null,
  };

  // Order book: best prices and the dollars resting within five cents of them.
  const bids = (book?.bids ?? [])
    .map((level) => ({
      price: Number(level.price),
      size: Number(level.size),
    }))
    .filter(
      (level) =>
        Number.isFinite(level.price) &&
        level.price > 0 &&
        level.price <= 1 &&
        Number.isFinite(level.size) &&
        level.size > 0,
    );
  const asks = (book?.asks ?? [])
    .map((level) => ({
      price: Number(level.price),
      size: Number(level.size),
    }))
    .filter(
      (level) =>
        Number.isFinite(level.price) &&
        level.price > 0 &&
        level.price <= 1 &&
        Number.isFinite(level.size) &&
        level.size > 0,
    );
  const bestBid = bids.length ? Math.max(...bids.map((level) => level.price)) : null;
  const bestAsk = asks.length ? Math.min(...asks.map((level) => level.price)) : null;
  const orderBook = book
    ? {
        bestBid,
        bestAsk,
        spread: bestBid != null && bestAsk != null ? bestAsk - bestBid : null,
        bidDepthUsd: bids
          .filter((level) => bestBid != null && level.price >= bestBid - 0.05)
          .reduce((sum, level) => sum + level.price * level.size, 0),
        askDepthUsd: asks
          .filter((level) => bestAsk != null && level.price <= bestAsk + 0.05)
          .reduce((sum, level) => sum + level.price * level.size, 0),
        lastTrade: book.last_trade_price ? Number(book.last_trade_price) : null,
      }
    : null;

  const related = siblings
    .filter((sibling) => sibling.id !== market.id && sibling.pricingAvailable !== false)
    .map((sibling) => ({
      id: sibling.id,
      title: sibling.marketTitle ?? sibling.title,
      probability: Number(sibling.outcomes[0]?.probability ?? 0),
    }))
    .sort((a, b) => b.probability - a.probability);

  let activity: {
    trades: number;
    wallets: number;
    lastTradeAt: string | null;
    sampleLimit: number;
  } | null = null;
  if (nativePanta && panta?.apiKey) {
    try {
      const response = await fetcher(
        `${panta.baseUrl.replace(/\/$/, "")}/markets/${encodeURIComponent(market.id)}/trades/?limit=200`,
        {
          headers: { accept: "application/json", "x-api-key": panta.apiKey },
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!response.ok) throw new Error("Panta trade tape unavailable");
      const tape = z
        .object({
          items: z.array(
            z.object({
              signature: z.string(),
              wallet: z.string(),
              blockTime: z.number().nullable(),
            }),
          ),
        })
        .parse(await response.json());
      const trades = [...new Map(tape.items.map((trade) => [trade.signature, trade])).values()];
      const last = Math.max(0, ...trades.map((trade) => trade.blockTime ?? 0));
      activity = {
        trades: trades.length,
        wallets: new Set(trades.map((trade) => trade.wallet)).size,
        lastTradeAt: last ? new Date(last * 1000).toISOString() : null,
        sampleLimit: 200,
      };
    } catch {
      /* Missing authenticated tape remains unavailable; never synthesize history. */
    }
  }
  const underlying =
    market.pricingAvailable === false
      ? null
      : await underlyingResearch(market, closesAt, fetcher).catch(() => null);
  return {
    marketId: market.id,
    history: history.map((point) => ({ time: point.t, value: point.p })),
    stats,
    orderBook,
    related,
    underlying,
    activity,
    sources: [
      market.quality.source,
      ...(history.length || book ? [nativePanta ? "panta-orderbook" : "polymarket-clob"] : []),
      ...(activity ? ["panta-trade-tape"] : []),
      ...(underlying ? ["binance-spot"] : []),
    ],
    measuredAt: new Date().toISOString(),
  };
}

/** For crypto price markets: where the asset is, what the strike needs, and how often it happens. */
async function underlyingResearch(
  market: PredictionMarket,
  closesAt: number | null,
  fetcher: Fetcher,
) {
  const strike = parseStrikeMarket(market);
  if (!strike || !closesAt || closesAt <= Date.now()) return null;
  const response = await fetcher(
    `https://data-api.binance.vision/api/v3/klines?symbol=${strike.pair}&interval=1d&limit=365`,
    { signal: AbortSignal.timeout(8000) },
  );
  if (!response.ok) throw new Error("Underlying price history unavailable");
  const rows = z.array(Kline).parse(await response.json());
  const candles = rows
    .map(([time, open, high, low, close]) => ({
      time: Math.floor(time / 1000),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
    }))
    .filter((c) => [c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v) && v > 0));
  const last = candles.at(-1);
  if (!last || candles.length < 31) return null;
  const spot = last.close;
  const returns = candles
    .slice(-31)
    .slice(1)
    .map((candle, index) =>
      Math.log(candle.close / (candles.slice(-31)[index]?.close ?? candle.close)),
    );
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const dailyVol = Math.sqrt(
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length,
  );
  const annualVol = dailyVol * Math.sqrt(365);
  const days = Math.max((closesAt - Date.now()) / 86_400_000, 1 / 24);
  const years = days / 365;
  const sigmaRootT = annualVol * Math.sqrt(years);
  if (!Number.isFinite(sigmaRootT) || sigmaRootT <= 0) return null;
  const up = strike.direction === "up";
  const distancePct = (strike.strike / spot - 1) * 100;
  const alreadyThere = up ? spot >= strike.strike : spot <= strike.strike;

  // Driftless lognormal model: settle uses the terminal distribution, touch uses the reflection principle.
  let modelProbability: number;
  if (strike.kind === "settle") {
    const d2 = (Math.log(spot / strike.strike) - 0.5 * annualVol ** 2 * years) / sigmaRootT;
    modelProbability = up ? normalCdf(d2) : 1 - normalCdf(d2);
  } else if (alreadyThere) {
    modelProbability = 1;
  } else {
    const barrier = Math.abs(Math.log(strike.strike / spot));
    const logDrift = (up ? -1 : 1) * 0.5 * annualVol ** 2;
    modelProbability = Math.min(
      1,
      Math.max(
        0,
        normalCdf((logDrift * years - barrier) / sigmaRootT) +
          Math.exp((2 * logDrift * barrier) / annualVol ** 2) *
            normalCdf((-logDrift * years - barrier) / sigmaRootT),
      ),
    );
  }

  // Historical frequency: over the past year, how often did a move of this size happen within a
  // window as long as the time left in this market?
  const window = Math.max(1, Math.round(days));
  const needed = strike.strike / spot - 1;
  let hits = 0;
  let trials = 0;
  for (let start = 0; start + window < candles.length; start += 1) {
    const base = candles[start]?.close;
    if (!base) continue;
    const span = candles.slice(start + 1, start + 1 + window);
    const reached =
      strike.kind === "settle"
        ? up
          ? (span.at(-1)?.close ?? 0) / base - 1 >= needed
          : (span.at(-1)?.close ?? 0) / base - 1 <= needed
        : up
          ? Math.max(...span.map((candle) => candle.high)) / base - 1 >= needed
          : Math.min(...span.map((candle) => candle.low)) / base - 1 <= needed;
    trials += 1;
    if (reached) hits += 1;
  }

  return {
    symbol: strike.pair,
    spot,
    strike: strike.strike,
    kind: strike.kind,
    direction: strike.direction,
    distancePct,
    alreadyThere,
    annualizedVolatility: annualVol,
    daysToClose: days,
    modelProbability,
    historicalFrequency: trials ? hits / trials : null,
    historicalWindows: trials,
    marketProbability: Number(market.outcomes[0]?.probability ?? 0),
    candles: candles.slice(-120),
  };
}
