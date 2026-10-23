import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "../../../../auth";
import { PredictionResearchPanel } from "../../../../components/prediction-research-panel";
import { PredictionTradeTicket } from "../../../../components/prediction-trade-ticket";
import { ProbabilityChart } from "../../../../components/probability-chart";
import { SignInToTrade } from "../../../../components/sign-in-to-trade";
import { TokenAvatar } from "../../../../components/token-avatar";
import { TradingChart } from "../../../../components/trading-chart";
import { getPredictionMarket, getPredictionResearch } from "../../../../lib/api";
import { predictionLogos } from "../../../../lib/asset-logo";
import { signTone } from "../../../../lib/sign";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const market = await getPredictionMarket(decodeURIComponent(id), {}).catch(() => null);
  const title = market?.data.title ?? "Prediction market";
  return {
    title: `${title} odds and research`,
    description: `Live odds, probability history, order book depth, and research for "${title}".`,
  };
}

const pct = (value: number | null | undefined, digits = 1) =>
  value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
const points = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)} pts`;
const usd = (value: number | null | undefined) =>
  value == null
    ? "—"
    : `$${Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value)}`;
const days = (value: number | null | undefined) =>
  value == null
    ? "—"
    : value < 1
      ? `${Math.max(1, Math.round(value * 24))}h`
      : `${value.toFixed(1)}d`;

export default async function PredictionMarketPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const session = await auth();
  const signedIn = Boolean(session) || process.env.SISERA_LOCAL_OPERATOR_MODE === "true";
  const identity = {
    accessToken: session?.accessToken,
    localOperator: process.env.SISERA_LOCAL_OPERATOR_MODE === "true",
  };
  const [marketResult, research] = await Promise.all([
    getPredictionMarket(id, identity).catch(() => null),
    getPredictionResearch(id, identity).catch(() => null),
  ]);
  if (!marketResult) notFound();
  const market = marketResult.data;
  const yes =
    market.pricingAvailable === false ? null : Number(market.outcomes[0]?.probability ?? 0);
  const no =
    market.pricingAvailable === false
      ? null
      : Number(market.outcomes[1]?.probability ?? 1 - (yes ?? 0));
  const stats = research?.stats;
  const book = research?.orderBook;
  const underlying = research?.underlying;
  const edge = underlying
    ? (underlying.modelProbability - underlying.marketProbability) * 100
    : null;

  const statTiles: Array<[string, string, string?]> = [
    ["24h change", points(stats?.change24hPts), signTone(stats?.change24hPts)],
    ["7d change", points(stats?.change7dPts), signTone(stats?.change7dPts)],
    ["30d change", points(stats?.change30dPts), signTone(stats?.change30dPts)],
    ["Since open", points(stats?.sinceOpenPts), signTone(stats?.sinceOpenPts)],
    ["High / low", stats?.high != null ? `${pct(stats.high, 0)} / ${pct(stats.low, 0)}` : "—"],
    [
      "Daily volatility",
      stats?.dailyVolatilityPts != null ? `${stats.dailyVolatilityPts.toFixed(1)} pts` : "—",
    ],
    [
      "Largest drawdown",
      stats?.maxDrawdownPts != null ? `${stats.maxDrawdownPts.toFixed(1)} pts` : "—",
    ],
    ["Time above 50%", pct(stats?.shareOfTimeAbove50, 0)],
    ["Open for", days(stats?.daysOpen)],
    ["Closes in", days(stats?.daysToClose)],
    ["Market volume", usd(market.volumeUsd)],
    ["Event volume 24h", usd(market.eventVolume24hUsd)],
  ];

  return (
    <div className="min-h-full bg-ink">
      <header className="flex flex-wrap items-end justify-between gap-6 border-b border-line px-4 py-5 sm:px-6">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2.5">
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded border ${
                market.phase === "secondary"
                  ? "border-purple-500/40 bg-purple-500/15 text-purple-300"
                  : "border-sky-500/40 bg-sky-500/15 text-sky-300"
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  market.phase === "secondary" ? "bg-purple-400" : "bg-sky-400 animate-pulse"
                }`}
              />
              {market.phase === "secondary"
                ? "Secondary Phase · Graduated CLOB"
                : "Primary Phase · Bonding Curve AMM"}
            </span>
            <p className="data-label text-bronze-300">
              <Link href="/predictions" className="hover:text-bone">
                Predictions
              </Link>{" "}
              · {[market.category, market.subcategory].filter(Boolean).join(" · ")}
            </p>
          </div>
          <h1 className="display mt-2 flex items-center gap-3 text-[28px] leading-tight text-bone">
            {predictionLogos(market) && (
              <TokenAvatar
                src={predictionLogos(market)}
                symbol={market.category ?? market.title}
                size={44}
                className="rounded-lg"
              />
            )}
            <span>{market.title}</span>
          </h1>
          {market.closesAt && (
            <p className="mt-2 text-[13px] text-slate-400">
              Closes {new Date(market.closesAt).toUTCString()}
            </p>
          )}
          {market.quality.source === "panta-onchain" && (
            <p className="mt-2 text-xs text-slate-400">
              {market.quality.status === "stale"
                ? "Last known indicative prices; refresh temporarily unavailable."
                : "Indicative prices."}{" "}
              Executable offers and fees are confirmed by a live venue quote.
            </p>
          )}
        </div>
        <div className="flex gap-px border border-line bg-line">
          <div className="bg-panel px-6 py-3 text-center">
            <p className="data-label">Yes</p>
            <p className="num mt-1 text-2xl text-[var(--up)]">{pct(yes)}</p>
          </div>
          <div className="bg-panel px-6 py-3 text-center">
            <p className="data-label">No</p>
            <p className="num mt-1 text-2xl text-[var(--down)]">{pct(no)}</p>
          </div>
        </div>
      </header>

      <div className="grid gap-4 p-4 md:p-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {research ? (
            <PredictionResearchPanel research={research} section="brief" />
          ) : (
            <p className="border border-line bg-panel p-5 text-sm text-slate-400">
              Event research is temporarily unavailable.
            </p>
          )}
          {research?.history.length ? (
            <section className="border border-line bg-panel">
              <div className="flex items-center justify-between border-b border-line px-5 py-3">
                <h2 className="text-sm font-semibold text-bone">Yes probability over time</h2>
                <span className="font-mono text-[11px] text-slate-400">
                  {research?.sources.includes("polymarket-clob")
                    ? "Polymarket · historical observations"
                    : "Probability history unavailable"}
                </span>
              </div>
              <ProbabilityChart history={research?.history ?? []} />
            </section>
          ) : (
            <p className="border border-line bg-panel px-5 py-3 text-xs leading-6 text-slate-500">
              Panta has no compatible probability history for this event yet. Momentum, RSI, and
              historical volatility remain unavailable.
            </p>
          )}

          {Boolean(research?.history.length) && (
            <section className="border border-line bg-panel">
              <h2 className="border-b border-line px-5 py-3 text-sm font-semibold text-bone">
                Historical statistics
              </h2>
              <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 xl:grid-cols-4">
                {statTiles.map(([label, value, tone]) => (
                  <div key={label} className="bg-panel px-5 py-3.5">
                    <dt className="data-label">{label}</dt>
                    <dd className={`num mt-1.5 text-base ${tone || "text-bone"}`}>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {research && <PredictionResearchPanel research={research} section="details" />}

          {underlying && (
            <section className="border border-line bg-panel">
              <div className="border-b border-line px-5 py-3">
                <h2 className="text-sm font-semibold text-bone">
                  {underlying.symbol.replace("USDT", "")} price research
                </h2>
                <p className="mt-1 text-[12px] text-slate-400">
                  This market resolves on {underlying.symbol.replace("USDT", "")}{" "}
                  {underlying.kind === "touch" ? "touching" : "closing"}{" "}
                  {underlying.direction === "up" ? "at or above" : "at or below"} $
                  {underlying.strike.toLocaleString()}.
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3">
                {(
                  [
                    [
                      "Current price",
                      `$${underlying.spot.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
                    ],
                    [
                      "Distance to strike",
                      `${underlying.distancePct > 0 ? "+" : ""}${underlying.distancePct.toFixed(2)}%`,
                      signTone(
                        underlying.direction === "up"
                          ? -underlying.distancePct
                          : underlying.distancePct,
                      ),
                    ],
                    [
                      "30d volatility (annualized)",
                      `${(underlying.annualizedVolatility * 100).toFixed(0)}%`,
                    ],
                    ["Market implies", pct(underlying.marketProbability)],
                    ["Volatility model", pct(underlying.modelProbability)],
                    [
                      `Happened in the past year (${underlying.historicalWindows} windows)`,
                      pct(underlying.historicalFrequency),
                    ],
                  ] as Array<[string, string, string?]>
                ).map(([label, value, tone]) => (
                  <div key={label} className="bg-panel px-5 py-3.5">
                    <dt className="data-label">{label}</dt>
                    <dd className={`num mt-1.5 text-base ${tone || "text-bone"}`}>{value}</dd>
                  </div>
                ))}
              </dl>
              {edge != null && (
                <p className="border-t border-line px-5 py-3 text-[13px] text-slate-300">
                  The volatility model puts YES{" "}
                  <span className={`num ${signTone(edge)}`}>{Math.abs(edge).toFixed(1)} pts</span>{" "}
                  {edge >= 0 ? "above" : "below"} the market price. The model assumes no drift and
                  constant volatility; treat it as one input, not a forecast.
                </p>
              )}
              <div className="border-t border-line p-3">
                <TradingChart
                  source={{ kind: "binance", id: underlying.symbol }}
                  title={underlying.symbol}
                  defaultInterval="1d"
                  height={360}
                  markers={[{ price: underlying.strike, label: "Strike" }]}
                />
              </div>
            </section>
          )}

          {research?.related && research.related.length > 0 && (
            <section className="border border-line bg-panel">
              <h2 className="border-b border-line px-5 py-3 text-sm font-semibold text-bone">
                Other outcomes in this event
              </h2>
              <div className="divide-y divide-line">
                {research.related.slice(0, 20).map((item) => (
                  <Link
                    prefetch={false}
                    key={item.id}
                    href={`/predictions/${encodeURIComponent(item.id)}`}
                    className="flex items-center justify-between gap-4 px-5 py-2.5 text-[13px] hover:bg-white/[.03]"
                  >
                    <span className="text-slate-200">{item.title}</span>
                    <span className="num text-bone">{pct(item.probability)}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {market.resolutionRules && (
            <section className="border border-line bg-panel p-5">
              <h2 className="text-sm font-semibold text-bone">How this market resolves</h2>
              <p className="mt-3 whitespace-pre-line text-[13px] leading-6 text-slate-300">
                {market.resolutionRules}
              </p>
            </section>
          )}
        </div>

        <aside className="space-y-4 self-start lg:sticky lg:top-4">
          {signedIn ? (
            <PredictionTradeTicket
              marketId={market.id}
              marketTitle={market.title}
              marketStatus={market.status}
              marketPhase={market.phase}
              isGraduated={market.isGraduated}
              resolvedWinner={
                market.status === "resolved" ? (yes === 1 ? "yes" : no === 1 ? "no" : null) : null
              }
            />
          ) : (
            <SignInToTrade
              label="this market"
              returnTo={`/predictions/${encodeURIComponent(market.id)}`}
            />
          )}
          <section className="border border-line bg-panel">
            <h2 className="border-b border-line px-5 py-3 text-sm font-semibold text-bone">
              Order book
            </h2>
            {book ? (
              <dl className="grid grid-cols-2 gap-px bg-line">
                {(
                  [
                    ["Best bid", pct(book.bestBid)],
                    ["Best ask", pct(book.bestAsk)],
                    ["Spread", book.spread != null ? `${(book.spread * 100).toFixed(1)}¢` : "—"],
                    ["Last trade", pct(book.lastTrade)],
                    ["Bids within 5¢", usd(book.bidDepthUsd)],
                    ["Asks within 5¢", usd(book.askDepthUsd)],
                  ] as Array<[string, string]>
                ).map(([label, value]) => (
                  <div key={label} className="bg-panel px-4 py-3">
                    <dt className="data-label">{label}</dt>
                    <dd className="num mt-1 text-sm text-bone">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="px-5 py-4 text-[13px] text-slate-400">
                This market has no compatible order book. A live Panta quote determines executable
                price and fees.
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
