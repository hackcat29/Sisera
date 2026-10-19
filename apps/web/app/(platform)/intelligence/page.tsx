import { Activity, ArrowUpRight, Bot, Newspaper, ScanSearch } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "../../../auth";
import { NewsBrowser } from "../../../components/news-browser";
import { PageHeader } from "../../../components/page-header";
import { ChangesFeed } from "../../../components/platform/event-feed";
import {
  getMarketOverview,
  getPrivateMarkets,
  getPublicStocks,
  getPythReferences,
  getStockNews,
} from "../../../lib/api";
import { signTone } from "../../../lib/sign";

export const metadata: Metadata = {
  title: "Intelligence",
  description:
    "Why prices moved: token moves beside company news, reference prices, and the wider market.",
};

export const dynamic = "force-dynamic";

const formatUsd = (value: string | null) =>
  value && Number.isFinite(Number(value))
    ? `$${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`
    : "—";

const utcTime = (value: string) =>
  `${new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }).format(new Date(value))} UTC`;

export default async function IntelligencePage() {
  const session = await auth();
  const identity = {
    accessToken: session?.accessToken,
    localOperator: process.env.SISERA_LOCAL_OPERATOR_MODE === "true",
  };
  const [publicResult, privateResult, overviewResult] = await Promise.allSettled([
    getPublicStocks(identity),
    getPrivateMarkets(identity),
    getMarketOverview(identity),
  ]);
  const overview = overviewResult.status === "fulfilled" ? overviewResult.value : null;
  const stocks = publicResult.status === "fulfilled" ? publicResult.value : [];
  const privateMarkets = privateResult.status === "fulfilled" ? privateResult.value : [];
  const referenceSymbols = [
    ...new Set(
      stocks
        .filter((stock) => stock.dexPriceUsd && !stock.tradingHalted)
        .sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0))
        .slice(0, 20)
        .map((stock) => stock.underlyingSymbol),
    ),
  ];
  const references = referenceSymbols.length
    ? await getPythReferences(referenceSymbols, identity).catch(() => [])
    : [];
  const referenceBySymbol = new Map(
    references
      .filter((reference) => reference.referenceFreshness !== "stale")
      .map((reference) => [reference.symbol.toUpperCase(), reference]),
  );
  const publicDivergences = stocks
    .flatMap((stock) => {
      const reference = referenceBySymbol.get(
        `EQUITY.US.${stock.underlyingSymbol.toUpperCase()}/USD`,
      );
      const spot = Number(stock.dexPriceUsd);
      const fair = Number(reference?.price);
      if (!reference || !Number.isFinite(spot) || !Number.isFinite(fair) || spot <= 0 || fair <= 0)
        return [];
      return [{ stock, reference, premiumPct: (spot / fair - 1) * 100 }];
    })
    .sort((a, b) => Math.abs(b.premiumPct) - Math.abs(a.premiumPct))
    .slice(0, 5);
  const movers = stocks
    .filter((stock) => stock.dexPriceUsd && stock.change24hPct != null)
    .sort((a, b) => Math.abs(b.change24hPct ?? 0) - Math.abs(a.change24hPct ?? 0))
    .slice(0, 5);
  const divergences = privateMarkets
    .filter((asset) => Number.isFinite(Number(asset.premiumDiscountPct)))
    .sort((a, b) => Math.abs(Number(b.premiumDiscountPct)) - Math.abs(Number(a.premiumDiscountPct)))
    .slice(0, 5);
  const focus =
    privateMarkets.find((asset) => asset.instrument.baseAsset === "OPENAI") ?? privateMarkets[0];
  const headlineSymbols = [
    ...new Set([
      ...movers.slice(0, 3).map((stock) => stock.symbol),
      ...divergences.slice(0, 3).map((asset) => asset.instrument.baseAsset),
    ]),
  ];
  const coverage = await Promise.allSettled(
    headlineSymbols.map((symbol) => getStockNews(symbol, identity)),
  );
  const headlines = coverage
    .flatMap((result, index) =>
      result.status === "fulfilled"
        ? result.value.data.map((item) => ({
            ...item,
            company: headlineSymbols[index] ?? "Market",
          }))
        : [],
    )
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 60);

  return (
    <div>
      <PageHeader
        eyebrow="See what others miss"
        title="Market intelligence"
        description="Connect the dots between price, market activity, company news, and the bigger picture before your next decision."
        actions={
          <div className="flex items-center gap-3">
            <Link
              prefetch={false}
              href="/copilot"
              className="border border-bronze-300 bg-bronze-300 px-3 py-2 text-xs font-semibold text-ink hover:bg-bronze-200"
            >
              Ask Sisera AI
            </Link>
            <Link
              prefetch={false}
              href="/agents"
              className="inline-flex items-center gap-1 text-xs text-bronze-300"
            >
              Explore strategies <ArrowUpRight size={13} />
            </Link>
          </div>
        }
      />
      <div className="p-4 md:px-6">
        <ChangesFeed />
      </div>
      <div className="grid gap-px border-b border-line bg-line sm:grid-cols-3">
        {[
          [
            "Market mood",
            overview?.sentiment
              ? `${overview.sentiment.score} / 100 · ${overview.sentiment.label}`
              : "Explore market signals",
          ],
          [
            "Crypto market value",
            overview?.global?.marketCapUsd == null
              ? "See broader markets"
              : `$${Intl.NumberFormat("en-US", { notation: "compact" }).format(overview.global.marketCapUsd)}`,
          ],
          [
            "Tokenized stock activity",
            overview?.rwaStocks.length
              ? `${overview.rwaStocks.length} markets in view`
              : "Browse tokenized stocks",
          ],
        ].map(([label, value]) => (
          <div key={label} className="bg-panel p-5">
            <p className="data-label">{label}</p>
            <p className="mt-3 text-lg font-medium text-white">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 p-4 md:p-6 xl:grid-cols-2">
        <section className="rounded-lg border border-line bg-panel xl:col-span-2">
          <div className="border-b border-line p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Activity size={16} className="text-bronze-300" />
              Where stock tokens differ
            </h2>
            <p className="mt-2 text-xs text-slate-400">
              Compare token prices with the underlying shares. Differences can reflect market hours,
              liquidity, or trading costs.
              {publicDivergences[0]
                ? ` Share prices as of ${utcTime(publicDivergences[0].reference.feedUpdateTimestamp)}.`
                : ""}
            </p>
          </div>
          {publicDivergences.length ? (
            <div className="grid gap-px bg-line md:grid-cols-2 xl:grid-cols-5">
              {publicDivergences.map(({ stock, reference, premiumPct }) => (
                <Link
                  prefetch={false}
                  key={stock.mint}
                  href={`/stocks/${encodeURIComponent(stock.symbol)}`}
                  className="bg-panel p-4 hover:bg-white/[.025]"
                >
                  <p className="text-xs font-semibold text-white">{stock.symbol}</p>
                  <p className="mt-1 truncate text-[10px] text-slate-500">{stock.name}</p>
                  <p className={`mt-3 font-mono text-xl ${signTone(premiumPct)}`}>
                    {premiumPct > 0 ? "+" : ""}
                    {premiumPct.toFixed(2)}%
                  </p>
                  <p className="mt-2 font-mono text-[10px] text-slate-400">
                    Token {formatUsd(stock.dexPriceUsd)} · share {formatUsd(reference.price)}
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <div className="p-5">
              <p className="text-sm text-slate-300">
                Explore the most active stocks while the underlying share market updates.
              </p>
              <Link
                prefetch={false}
                href="/stocks"
                className="mt-3 inline-block text-xs text-bronze-300"
              >
                Browse stocks →
              </Link>
            </div>
          )}
        </section>
        <section className="rounded-lg border border-line bg-panel">
          <div className="border-b border-line p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <ScanSearch size={16} className="text-bronze-300" />
              Public stock movement
            </h2>
            <p className="mt-2 text-xs text-slate-400">
              Largest 24h moves among tokens trading on Solana
              {movers[0] ? `, as of ${utcTime(movers[0].fetchedAt)}` : ""}.
            </p>
          </div>
          {movers.length ? (
            <div className="divide-y divide-line">
              {movers.map((stock) => (
                <Link
                  prefetch={false}
                  key={stock.mint}
                  href={`/stocks/${encodeURIComponent(stock.symbol)}`}
                  className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-white/[.025]"
                >
                  <div>
                    <p className="text-sm font-semibold text-white">{stock.name}</p>
                    <p className="mt-1 font-mono text-[10px] text-slate-500">{stock.symbol}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm text-white">{formatUsd(stock.dexPriceUsd)}</p>
                    <p className={`mt-1 font-mono text-xs ${signTone(stock.change24hPct ?? 0)}`}>
                      {(stock.change24hPct ?? 0) > 0 ? "+" : ""}
                      {(stock.change24hPct ?? 0).toFixed(2)}%
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="p-6">
              <p className="text-sm text-slate-300">
                Find the companies and token markets on your radar.
              </p>
              <Link
                prefetch={false}
                href="/stocks"
                className="mt-3 inline-block text-xs text-bronze-300"
              >
                Explore public stocks →
              </Link>
            </div>
          )}
          <Link
            href="/stocks"
            className="block border-t border-line px-5 py-3 text-xs text-bronze-300"
          >
            Open stock screener →
          </Link>
        </section>
        <section className="rounded-lg border border-line bg-panel">
          <div className="border-b border-line p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <ScanSearch size={16} className="text-bronze-300" />
              Private companies in motion
            </h2>
            <p className="mt-2 text-xs text-slate-400">
              Where private-market tokens sit relative to their company marks. Figures show the
              premium or discount to the mark.
            </p>
          </div>
          {divergences.length ? (
            <div className="divide-y divide-line">
              {divergences.map((asset) => (
                <Link
                  prefetch={false}
                  key={asset.instrument.id}
                  href={`/private-markets/${encodeURIComponent(asset.instrument.baseAsset)}`}
                  className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-white/[.025]"
                >
                  <div>
                    <p className="text-sm font-semibold text-white">{asset.company}</p>
                    <p className="mt-1 font-mono text-[10px] text-slate-500">
                      Token {formatUsd(asset.tokenPrice)} · mark {formatUsd(asset.markPrice)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={`font-mono text-sm ${signTone(Number(asset.premiumDiscountPct))}`}
                    >
                      {Number(asset.premiumDiscountPct) > 0 ? "+" : ""}
                      {Number(asset.premiumDiscountPct).toFixed(2)}%
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="p-6">
              <p className="text-sm text-slate-300">
                Discover private companies and see how their token prices compare.
              </p>
              <Link href="/private-markets" className="mt-3 inline-block text-xs text-bronze-300">
                Explore private markets →
              </Link>
            </div>
          )}
          <Link
            href="/private-markets"
            className="block border-t border-line px-5 py-3 text-xs text-bronze-300"
          >
            Open private market screener →
          </Link>
        </section>
        <section className="rounded-lg border border-line bg-panel">
          <div className="border-b border-line p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Newspaper size={16} className="text-bronze-300" />
              In the news
            </h2>
            <p className="mt-2 text-xs text-slate-400">
              Filter recent coverage by company and time. Read the full story before drawing a
              conclusion.
            </p>
          </div>
          {headlines.length ? (
            <NewsBrowser articles={headlines} />
          ) : (
            <div className="p-6">
              <p className="text-sm text-slate-300">
                See what is moving prices even when company headlines are quiet.
              </p>
              <Link href="/macro" className="mt-3 inline-block text-xs text-bronze-300">
                Explore the market climate →
              </Link>
            </div>
          )}
          {focus && (
            <Link
              href={`/private-markets/${encodeURIComponent(focus.instrument.baseAsset)}`}
              className="block border-t border-line px-5 py-3 text-xs text-bronze-300"
            >
              Explore {focus.company} more deeply →
            </Link>
          )}
        </section>
        <section className="rounded-lg border border-line bg-panel p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Bot size={16} className="text-bronze-300" />
            From research to an agent
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Take a closer look at an asset, ask Sisera for an assessment, then turn your thesis into
            a strategy with clear limits.
          </p>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            Strategy agents begin with research and practice before any capital is involved.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/agents"
              className="rounded border border-bronze-400/30 bg-bronze-400/[.08] px-3 py-2 text-xs text-bronze-300"
            >
              Explore agents
            </Link>
            <Link
              href="/risk"
              className="rounded border border-line px-3 py-2 text-xs text-slate-300"
            >
              See your risk
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
