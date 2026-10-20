import type { OrderBook } from "@sisera/domain";
import { formatMoney } from "@sisera/ui";
import { ArrowUpRight, BookOpen, CandlestickChart, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "../../../auth";
import { DeltaBadge } from "../../../components/delta-badge";
import { LivePerpPrice } from "../../../components/live-price";
import { LiveRefresh } from "../../../components/live-refresh";
import { PerpMarketStrip } from "../../../components/perp-market-strip";
import { PerpTradeTicket } from "../../../components/perp-trade-ticket";
import { SignInToTrade } from "../../../components/sign-in-to-trade";
import { TerminalDetails } from "../../../components/terminal-details";
import { TradingChart } from "../../../components/trading-chart";
import {
  type Venue,
  getCandles,
  getMarket,
  getMarketIntelligence,
  getMarkets,
  getOrderBook,
  getReferenceMarkets,
} from "../../../lib/api";
import { signTone } from "../../../lib/sign";

export const metadata: Metadata = {
  title: "Perpetuals terminal",
  description: "Charts, order book, and order entry for perpetual and spot markets.",
};

export const dynamic = "force-dynamic";

const universe = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];
const intervals = ["1m", "5m", "15m", "1h", "4h", "1d"];

export default async function TerminalPage({
  searchParams,
}: { searchParams: Promise<{ symbol?: string; interval?: string; venue?: string }> }) {
  const parameters = await searchParams;
  if (parameters.venue === "binance")
    redirect(`/spot/${universe.includes(parameters.symbol ?? "") ? parameters.symbol : "BTCUSDT"}`);
  if (!parameters.venue) redirect("/terminal?venue=hyperliquid");
  const venue: Venue = "hyperliquid";
  // Any Hyperliquid perpetual can be opened; the provider maps BTCUSDT-style symbols to coins.
  const symbol = /^[A-Z0-9]{2,12}USDT$/.test(parameters.symbol ?? "")
    ? (parameters.symbol as string)
    : "BTCUSDT";
  const interval = intervals.includes(parameters.interval ?? "")
    ? (parameters.interval as string)
    : "15m";
  const session = await auth();
  const signedIn = Boolean(session) || process.env.SISERA_LOCAL_OPERATOR_MODE === "true";
  const identity = {
    accessToken: session?.accessToken,
    localOperator: process.env.SISERA_LOCAL_OPERATOR_MODE === "true",
  };
  const [marketResult, universeResult, candlesResult, depthResult, intelligenceResult] =
    await Promise.allSettled([
      getMarket(symbol, identity, venue),
      getMarkets(universe, identity, venue),
      getCandles(symbol, interval, identity, venue),
      getOrderBook(symbol, identity, venue),
      getMarketIntelligence(symbol, identity, venue),
    ]);
  const market = marketResult.status === "fulfilled" ? marketResult.value : null;
  const markets = universeResult.status === "fulfilled" ? universeResult.value.data : [];
  const candles = candlesResult.status === "fulfilled" ? candlesResult.value : [];
  const depth = depthResult.status === "fulfilled" ? depthResult.value : null;
  const intelligence = intelligenceResult.status === "fulfilled" ? intelligenceResult.value : null;
  const snapshot = market?.snapshot;
  const references = !snapshot ? await getReferenceMarkets(universe, identity).catch(() => []) : [];
  const reference = references.find((item) => item.symbol === symbol);

  return (
    <div className="min-h-full bg-ink px-4 pb-8 pt-6 md:px-6">
      <div className="mx-auto max-w-[1920px]">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">Markets / Execution</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-[-0.035em] text-slate-50">
              Perpetual markets
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <LiveRefresh />
          </div>
        </div>

        <div className="mb-4 flex items-center gap-2 border-b border-line pb-3 text-xs">
          <Link
            href={`/terminal?symbol=${symbol}&interval=${interval}&venue=hyperliquid`}
            className={`rounded px-3 py-2 ${venue === "hyperliquid" ? "bg-bronze-400/10 text-bronze-300" : "text-slate-400"}`}
          >
            Hyperliquid perps
          </Link>
          <Link href="/markets" className="rounded px-3 py-2 text-slate-400">
            Crypto spot →
          </Link>
          <span className="ml-auto text-[10px] text-slate-500">
            Prices shown for the selected market
          </span>
        </div>

        <PerpMarketStrip active={symbol} interval={interval} />

        <section className="mb-4 rounded-lg border border-line bg-panel px-5 py-4">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <div className="flex min-w-44 items-center gap-3 border-r border-line pr-8">
              <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-[#273943] font-mono text-lg font-semibold text-[#f4d8b8]">
                {market?.instrument.baseAsset.slice(0, 1) ?? symbol.slice(0, 1)}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-50">
                  {market?.instrument.displaySymbol ?? `${symbol.replace("USDT", "")} / USD`}
                </h2>
                <p className="font-mono text-[10px] uppercase tracking-wide text-slate-500">
                  {market ? "Perpetual market" : "Market price"}
                </p>
              </div>
            </div>
            <div className="min-w-36">
              <p className="data-label">{venue === "hyperliquid" ? "Mark price" : "Last traded"}</p>
              <div className="mt-1 flex items-center gap-3">
                <span className="font-mono text-[24px] font-medium tracking-[-0.04em] text-slate-50">
                  <LivePerpPrice
                    coin={symbol.replace(/USDT$/, "")}
                    fallback={
                      snapshot?.last != null
                        ? Number(snapshot.last)
                        : reference
                          ? reference.priceUsd
                          : null
                    }
                  />
                </span>
                <DeltaBadge value={snapshot?.change24hPct ?? reference?.change24hPct?.toString()} />
              </div>
            </div>
            <MarketMetric label="Best bid" value={formatMoney(snapshot?.bid)} />
            <MarketMetric label="Best ask" value={formatMoney(snapshot?.ask)} />
            <MarketMetric
              label="24h trading"
              value={formatCompact(snapshot?.volume24h ?? reference?.volume24hUsd?.toString())}
            />
            <div className="ml-auto">
              {snapshot ? (
                <div className="text-right">
                  <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300">
                    <span className="size-1.5 rounded-full bg-emerald-300" /> Live market
                  </span>
                  <p className="mt-1 font-mono text-[10px] text-slate-500">
                    Updated {new Date(snapshot.quality.receivedAt).toLocaleTimeString()}
                  </p>
                </div>
              ) : reference ? (
                <div className="text-right">
                  <span className="text-xs text-amber-200">Price for research only</span>
                  <p className="mt-1 font-mono text-[10px] text-slate-500">
                    Updated {new Date(reference.observedAt).toLocaleTimeString()}
                  </p>
                </div>
              ) : (
                <span className="text-xs text-amber-300">Market prices reconnecting</span>
              )}
            </div>
          </div>
        </section>

        {/* On small screens the ticket follows the chart, ahead of the order book. */}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_270px_300px]">
          <div className="order-1 min-w-0 xl:order-none">
            <TradingChart
              source={{ kind: venue === "hyperliquid" ? "hyperliquid" : "binance", id: symbol }}
              title={market?.instrument.displaySymbol ?? symbol}
              initialBars={candles.map((candle) => ({
                time: candle.time,
                open: Number(candle.open),
                high: Number(candle.high),
                low: Number(candle.low),
                close: Number(candle.close),
                volume: Number(candle.volume),
              }))}
              defaultInterval={
                (["1m", "5m", "15m", "1h", "4h", "1d"] as const).find(
                  (value) => value === interval,
                ) ?? "15m"
              }
              height={510}
            />
          </div>

          <section className="order-3 overflow-hidden rounded-lg border border-line bg-panel xl:order-none xl:min-h-[570px]">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <BookOpen size={15} className="text-bronze-300" /> Order book
              </h3>
              <span className="font-mono text-[10px] text-slate-500">L2 · 20 levels</span>
            </div>
            {depth ? (
              <OrderBookPanel book={depth} quoteAsset={market?.instrument.quoteAsset ?? "USDT"} />
            ) : (
              <DataUnavailable
                title="Order book reconnecting"
                detail="Current bids and asks will appear when market depth returns. Trading remains paused without a live quote."
              />
            )}
          </section>

          <aside className="order-2 overflow-hidden rounded-lg border border-line bg-panel xl:order-none xl:min-h-[570px]">
            {signedIn ? (
              <PerpTradeTicket
                coin={symbol.replace(/USDT$/, "")}
                symbol={symbol}
                fallbackPrice={
                  snapshot?.last != null ? Number(snapshot.last) : (reference?.priceUsd ?? null)
                }
              />
            ) : (
              <SignInToTrade label={"perpetuals"} returnTo={"/terminal?venue=hyperliquid"} />
            )}
          </aside>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <TerminalDetails intelligence={intelligence} coin={symbol.replace(/USDT$/, "")} />
          <section className="rounded-lg border border-line bg-panel p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <ShieldCheck size={16} className="text-bronze-300" /> Execution controls
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-400">
              Every order is checked against your leverage and size limits at the live mark price
              before it reaches Hyperliquid. Your trading key can trade but never withdraw.
            </p>
            <Link
              href="/risk"
              className="mt-5 inline-flex items-center gap-1 text-xs font-medium text-bronze-300 hover:text-bronze-200"
            >
              Review risk controls <ArrowUpRight size={14} />
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}

function MarketMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="data-label">{label}</p>
      <p className="mt-1 font-mono text-sm text-slate-200">{value}</p>
    </div>
  );
}

function DataUnavailable({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="grid min-h-[440px] place-items-center p-6 text-center">
      <div>
        <p className="text-sm font-medium text-slate-200">{title}</p>
        <p className="mt-2 text-xs text-slate-400">{detail}</p>
      </div>
    </div>
  );
}

function OrderBookPanel({ book, quoteAsset }: { book: OrderBook; quoteAsset: string }) {
  const asks = book.asks.slice(0, 10).reverse();
  const bids = book.bids.slice(0, 10);
  const max = Math.max(1, ...[...asks, ...bids].map((level) => Number(level.quantity)));
  return (
    <div className="font-mono text-[11px]">
      <div className="grid grid-cols-2 border-b border-line px-4 py-2 text-[10px] text-slate-500">
        <span>Price ({quoteAsset})</span>
        <span className="text-right">Size</span>
      </div>
      {asks.map((level) => (
        <DepthRow key={`ask-${level.price}`} level={level} max={max} side="ask" />
      ))}
      <div className="flex items-center justify-between border-y border-line bg-[#1b2b34] px-4 py-2 text-xs">
        <span className="text-slate-500">Spread</span>
        <span className="text-slate-200">
          {(Number(book.asks[0]?.price ?? 0) - Number(book.bids[0]?.price ?? 0)).toFixed(2)}
        </span>
      </div>
      {bids.map((level) => (
        <DepthRow key={`bid-${level.price}`} level={level} max={max} side="bid" />
      ))}
      <p className="border-t border-line px-4 py-3 text-[10px] text-slate-500">
        Updated {new Date(book.quality.receivedAt).toLocaleTimeString()}
      </p>
    </div>
  );
}

function DepthRow({
  level,
  max,
  side,
}: { level: { price: string; quantity: string }; max: number; side: "bid" | "ask" }) {
  return (
    <div className="relative grid h-7 grid-cols-2 items-center px-4">
      <span className={`relative z-10 ${side === "bid" ? "text-emerald-300" : "text-rose-300"}`}>
        {Number(level.price).toLocaleString(undefined, { maximumFractionDigits: 4 })}
      </span>
      <span className="relative z-10 text-right text-slate-300">
        {Number(level.quantity).toFixed(4)}
      </span>
      <span
        className={`absolute inset-y-0 right-0 ${side === "bid" ? "bg-emerald-400/[0.08]" : "bg-rose-400/[0.08]"}`}
        style={{ width: `${(Number(level.quantity) / max) * 100}%` }}
      />
    </div>
  );
}

function formatCompact(value?: string | null) {
  if (!value) return "—";
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(
        number,
      )
    : "—";
}
