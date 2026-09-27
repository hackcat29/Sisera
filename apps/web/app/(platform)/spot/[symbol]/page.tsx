import Link from "next/link";
import { auth } from "../../../../auth";
import { MarketChart } from "../../../../components/market-chart";
import { MarketOrderTicket } from "../../../../components/market-order-ticket";
import { PageHeader } from "../../../../components/page-header";
import { getCandles, getMarket, getMarketIntelligence, getOrderBook } from "../../../../lib/api";

export const dynamic = "force-dynamic";

export default async function SpotMarketPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = await params;
  const symbol = /^[A-Z0-9]{5,20}$/.test(rawSymbol) ? rawSymbol : "BTCUSDT";
  const session = await auth();
  const identity = {
    accessToken: session?.accessToken,
    localOperator: process.env.SISERA_LOCAL_OPERATOR_MODE === "true",
  };
  const [marketResult, candlesResult, depthResult, analysisResult] = await Promise.allSettled([
    getMarket(symbol, identity, "binance"),
    getCandles(symbol, "15m", identity, "binance"),
    getOrderBook(symbol, identity, "binance"),
    getMarketIntelligence(symbol, identity, "binance"),
  ]);
  const market = marketResult.status === "fulfilled" ? marketResult.value : null;
  const candles = candlesResult.status === "fulfilled" ? candlesResult.value : [];
  const depth = depthResult.status === "fulfilled" ? depthResult.value : null;
  const analysis = analysisResult.status === "fulfilled" ? analysisResult.value : null;
  return (
    <div>
      <PageHeader
        eyebrow="Crypto spot / Binance"
        title={market?.instrument.displaySymbol ?? symbol}
        description="Spot market quotes, candles and depth from Binance. This view does not route perpetual orders."
        actions={
          <Link href="/markets?venue=binance" className="text-xs text-cyan-300">
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
                {market ? Number(market.snapshot.last).toLocaleString() : "Unavailable"}
              </p>
            </div>
            <p className="font-mono text-xs text-slate-400">
              {market?.snapshot.quality.source ?? "Source unavailable"}
            </p>
          </div>
          {candles.length ? (
            <div className="h-[440px]">
              <MarketChart candles={candles} />
            </div>
          ) : (
            <p className="grid h-[440px] place-items-center text-sm text-slate-400">
              Spot candles unavailable
            </p>
          )}
        </section>
        <aside className="space-y-4">
          <section className="border border-line bg-panel">
            <MarketOrderTicket
              venue="binance"
              bid={market?.snapshot.bid}
              ask={market?.snapshot.ask}
              symbol={symbol}
              quoteAsset="USDT"
              quoteObservedAt={market?.snapshot.quality.observedAt}
              quoteStatus={market?.snapshot.quality.status}
            />
          </section>
          <section className="border border-line bg-panel p-4">
            <h2 className="text-sm font-semibold text-white">Spot order book</h2>
            {depth ? (
              <div className="mt-4 space-y-2 font-mono text-xs">
                <div className="flex justify-between text-slate-500">
                  <span>Bid · USDT</span>
                  <span>Ask · USDT</span>
                </div>
                {Array.from(
                  { length: Math.min(10, depth.bids.length, depth.asks.length) },
                  (_, index) => (
                    <div
                      key={`${depth.bids[index]?.price}-${depth.asks[index]?.price}`}
                      className="flex justify-between border-t border-line pt-2"
                    >
                      <span className="text-emerald-300">{depth.bids[index]?.price}</span>
                      <span className="text-rose-300">{depth.asks[index]?.price}</span>
                    </div>
                  ),
                )}
                <p className="pt-2 text-[10px] text-slate-500">
                  {depth.quality.source} · {new Date(depth.quality.receivedAt).toLocaleTimeString()}
                </p>
              </div>
            ) : (
              <p className="mt-4 text-xs text-slate-400">Order book unavailable</p>
            )}
          </section>
          <section className="border border-line bg-panel p-4">
            <h2 className="text-sm font-semibold text-white">Spot analysis</h2>
            {analysis ? (
              <div className="mt-3 space-y-2 text-xs text-slate-300">
                <p>
                  Direction:{" "}
                  <span className="font-semibold text-cyan-300">{analysis.direction}</span>
                </p>
                <p>Confidence: {(analysis.confidence * 100).toFixed(0)}%</p>
                <p>Regime: {analysis.regime.replace("_", " ")}</p>
                <p className="text-slate-500">Based on {analysis.sampleSize} verified candles.</p>
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-400">Verified history unavailable</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
