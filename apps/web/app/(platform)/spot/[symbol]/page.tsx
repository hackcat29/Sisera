import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "../../../../auth";
import { AssetTabs } from "../../../../components/asset-tabs";
import { LiveSpotPrice } from "../../../../components/live-price";
import { MarketOrderTicket } from "../../../../components/market-order-ticket";
import { PageHeader } from "../../../../components/page-header";
import { SignInToTrade } from "../../../../components/sign-in-to-trade";
import { TradingChart } from "../../../../components/trading-chart";
import { TradingViewChart } from "../../../../components/tradingview-chart";
import {
  getCandles,
  getCryptoProfile,
  getMarket,
  getMarketIntelligence,
  getMarketOverview,
  getOrderBook,
} from "../../../../lib/api";

export async function generateMetadata({
  params,
}: { params: Promise<{ symbol: string }> }): Promise<Metadata> {
  const { symbol } = await params;
  const ticker = decodeURIComponent(symbol).toUpperCase();
  return {
    title: `${ticker} spot price, chart, and order book`,
    description: `${ticker} spot market with chart, order book depth, price structure, and order entry.`,
    alternates: { canonical: `/spot/${encodeURIComponent(ticker)}` },
  };
}

export const dynamic = "force-dynamic";

export default async function SpotMarketPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = await params;
  const symbol = /^[A-Z0-9]{5,20}$/.test(rawSymbol) ? rawSymbol : "BTCUSDT";
  const session = await auth();
  const signedIn = Boolean(session) || process.env.SISERA_LOCAL_OPERATOR_MODE === "true";
  const identity = {
    accessToken: session?.accessToken,
    localOperator: process.env.SISERA_LOCAL_OPERATOR_MODE === "true",
  };
  const [marketResult, candlesResult, depthResult, analysisResult, overviewResult] =
    await Promise.allSettled([
      getMarket(symbol, identity, "binance"),
      getCandles(symbol, "15m", identity, "binance"),
      getOrderBook(symbol, identity, "binance"),
      getMarketIntelligence(symbol, identity, "binance"),
      getMarketOverview(identity),
    ]);
  const market = marketResult.status === "fulfilled" ? marketResult.value : null;
  const candles = candlesResult.status === "fulfilled" ? candlesResult.value : [];
  const depth = depthResult.status === "fulfilled" ? depthResult.value : null;
  const analysis = analysisResult.status === "fulfilled" ? analysisResult.value : null;
  const overview = overviewResult.status === "fulfilled" ? overviewResult.value : null;
  const baseSymbol = symbol.endsWith("USDT") ? symbol.slice(0, -4) : symbol;
  const asset = overview?.crypto.find((item) => item.symbol === baseSymbol);
  const profile = asset ? await getCryptoProfile(asset.id, identity).catch(() => null) : null;
  const formatMoney = (value: number | null | undefined) =>
    value == null
      ? "Market data pending"
      : `$${Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value)}`;
  return (
    <div>
      <PageHeader
        eyebrow="Crypto / Spot"
        title={market?.instrument.displaySymbol ?? symbol}
        description="Follow price, liquidity and the bigger market story before placing a trade."
        actions={
          <Link href="/markets?venue=binance" className="text-xs text-bronze-300">
            ← Spot markets
          </Link>
        }
      />
      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="border border-line bg-panel p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="data-label">Last traded · USDT</p>
              <p className="mt-1 font-mono text-2xl text-white">
                <LiveSpotPrice
                  symbol={symbol}
                  fallback={market ? Number(market.snapshot.last) : null}
                />
              </p>
            </div>
            {market?.snapshot.quality.observedAt && (
              <p className="font-mono text-xs text-slate-400">
                Updated {new Date(market.snapshot.quality.observedAt).toLocaleTimeString()}
              </p>
            )}
          </div>
          <AssetTabs
            tabs={[
              {
                id: "chart",
                label: "Chart",
                panel: (
                  <TradingChart
                    source={{ kind: "binance", id: symbol }}
                    initialBars={candles.map((candle) => ({
                      time: candle.time,
                      open: Number(candle.open),
                      high: Number(candle.high),
                      low: Number(candle.low),
                      close: Number(candle.close),
                      volume: Number(candle.volume),
                    }))}
                    defaultInterval="15m"
                    height={440}
                  />
                ),
              },
              {
                id: "tradingview",
                label: "TradingView",
                panel: <TradingViewChart symbol={`BINANCE:${symbol}`} interval="15" height={520} />,
              },
            ]}
          />
        </section>
        <aside className="space-y-4">
          <section className="border border-line bg-panel">
            {signedIn ? (
              <MarketOrderTicket
                bid={market?.snapshot.bid}
                ask={market?.snapshot.ask}
                symbol={symbol}
              />
            ) : (
              <SignInToTrade label={symbol} returnTo={`/spot/${encodeURIComponent(symbol)}`} />
            )}
          </section>
          <section className="border border-line bg-panel p-4">
            <h2 className="text-sm font-semibold text-white">Spot order book</h2>
            {depth ? (
              <SpotDepth
                bids={depth.bids}
                asks={depth.asks}
                receivedAt={depth.quality.receivedAt}
              />
            ) : (
              <p className="mt-4 text-xs leading-5 text-slate-400">
                Bids and asks are reconnecting. Live orders still use a fresh quote from Binance.
              </p>
            )}
          </section>
          <section className="border border-line bg-panel p-4">
            <h2 className="text-sm font-semibold text-white">Spot analysis</h2>
            {analysis ? (
              <div className="mt-3 space-y-2 text-xs text-slate-300">
                <p>
                  Direction:{" "}
                  <span className="font-semibold text-bronze-300">{analysis.direction}</span>
                </p>
                <p>Confidence: {(analysis.confidence * 100).toFixed(0)}%</p>
                <p>Regime: {analysis.regime.replace("_", " ")}</p>
                <p className="text-slate-500">Based on {analysis.sampleSize} verified candles.</p>
              </div>
            ) : (
              <p className="mt-3 text-xs leading-5 text-slate-400">
                A trend reading will appear after enough recent trading history is available.
              </p>
            )}
          </section>
        </aside>
      </div>
      <section className="mx-4 mb-4 rounded-lg border border-line bg-panel p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">The wider picture</p>
            <h2 className="mt-1 text-base font-semibold text-white">
              {asset?.name ?? baseSymbol} at a glance
            </h2>
          </div>
          <Link href="/macro" className="text-xs text-bronze-300 hover:text-white">
            Explore market trends →
          </Link>
        </div>
        <div className="mt-5 grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Market value", formatMoney(asset?.marketCapUsd)],
            ["24h trading", formatMoney(asset?.volume24hUsd)],
            [
              "Market share",
              asset?.dominancePct == null
                ? "Market data pending"
                : `${asset.dominancePct.toFixed(2)}%`,
            ],
            [
              "30 day change",
              asset?.change30dPct == null
                ? "Market data pending"
                : `${asset.change30dPct > 0 ? "+" : ""}${asset.change30dPct.toFixed(2)}%`,
            ],
          ].map(([label, value]) => (
            <div key={label} className="bg-panel p-4">
              <p className="data-label">{label}</p>
              <p className="mt-2 font-mono text-lg text-white">{value}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-slate-500">
          Market-wide figures provide context. The trade ticket uses the live spot quote shown
          above.
        </p>
      </section>
      {profile && (
        <section className="mx-4 mb-4 rounded-lg border border-line bg-panel p-5">
          <p className="eyebrow">About the asset</p>
          <h2 className="mt-2 text-lg font-semibold text-white">Get to know {profile.name}</h2>
          <p className="mt-3 max-w-4xl text-sm leading-7 text-slate-300">
            {profile.description
              ? `${profile.description.slice(0, 650)}${profile.description.length > 650 ? "…" : ""}`
              : `${profile.name} is one of the assets tracked in Sisera’s crypto market view.`}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {profile.categories.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-line px-3 py-1 text-[11px] text-slate-400"
              >
                {tag}
              </span>
            ))}
          </div>
          {profile.website && (
            <a
              href={profile.website}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-block text-xs text-bronze-300 hover:text-white"
            >
              Visit project website ↗
            </a>
          )}
        </section>
      )}
    </div>
  );
}

type Level = { price: string; quantity: string };

function formatLevelPrice(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: value >= 1000 ? 2 : value >= 1 ? 2 : 4,
    maximumFractionDigits: value >= 1000 ? 2 : value >= 1 ? 4 : 8,
  });
}

/** Ten levels each side, asks above bids, with size bars scaled to the largest level shown. */
function SpotDepth({
  bids,
  asks,
  receivedAt,
}: { bids: Level[]; asks: Level[]; receivedAt: string }) {
  const topAsks = asks.slice(0, 10).reverse();
  const topBids = bids.slice(0, 10);
  const largest = Math.max(
    1e-12,
    ...[...topAsks, ...topBids].map((level) => Number(level.quantity)),
  );
  const bestAsk = Number(asks[0]?.price);
  const bestBid = Number(bids[0]?.price);
  const spread = bestAsk - bestBid;
  const row = (level: Level, side: "bid" | "ask") => (
    <div key={`${side}-${level.price}`} className="relative grid h-6 grid-cols-2 items-center px-1">
      <span className={`relative z-10 ${side === "bid" ? "text-emerald-300" : "text-rose-300"}`}>
        {formatLevelPrice(Number(level.price))}
      </span>
      <span className="relative z-10 text-right text-slate-300">
        {Number(level.quantity).toLocaleString("en-US", { maximumFractionDigits: 5 })}
      </span>
      <span
        className={`absolute inset-y-0.5 right-0 ${side === "bid" ? "bg-emerald-400/[0.09]" : "bg-rose-400/[0.09]"}`}
        style={{ width: `${(Number(level.quantity) / largest) * 100}%` }}
      />
    </div>
  );
  return (
    <div className="mt-3 font-mono text-[11px]">
      <div className="grid grid-cols-2 px-1 pb-1 text-[10px] text-slate-500">
        <span>Price · USDT</span>
        <span className="text-right">Size</span>
      </div>
      {topAsks.map((level) => row(level, "ask"))}
      <div className="my-1 flex justify-between border-y border-line px-1 py-1.5 text-slate-400">
        <span>Spread</span>
        <span>
          {Number.isFinite(spread) ? formatLevelPrice(spread) : "—"}
          {Number.isFinite(spread) && bestBid > 0
            ? ` · ${((spread / bestBid) * 10_000).toFixed(1)} bps`
            : ""}
        </span>
      </div>
      {topBids.map((level) => row(level, "bid"))}
      <p className="pt-2 text-[10px] text-slate-500">
        Updated {new Date(receivedAt).toLocaleTimeString()}
      </p>
    </div>
  );
}
