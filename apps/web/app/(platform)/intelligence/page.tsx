import { ArrowUpRight, Bot, Newspaper, ScanSearch } from "lucide-react";
import Link from "next/link";
import { auth } from "../../../auth";
import { PageHeader } from "../../../components/page-header";
import { getPrivateMarkets, getPublicStocks, getStockNews } from "../../../lib/api";

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
  const [publicResult, privateResult] = await Promise.allSettled([
    getPublicStocks(identity),
    getPrivateMarkets(identity),
  ]);
  const stocks = publicResult.status === "fulfilled" ? publicResult.value : [];
  const privateMarkets = privateResult.status === "fulfilled" ? privateResult.value : [];
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
  const news = focus
    ? await getStockNews(focus.instrument.baseAsset, identity).catch(() => null)
    : null;

  return (
    <div>
      <PageHeader
        eyebrow="Research / Evidence desk"
        title="Market intelligence"
        description="A research queue from observed Solana prices and provider marks. Movement and divergence are screening signals, not trading recommendations."
        actions={
          <Link href="/agents" className="inline-flex items-center gap-1 text-xs text-cyan-300">
            Agent research <ArrowUpRight size={13} />
          </Link>
        }
      />
      <div className="grid gap-4 p-4 md:p-6 xl:grid-cols-2">
        <section className="rounded-lg border border-line bg-panel">
          <div className="border-b border-line p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <ScanSearch size={16} className="text-cyan-300" />
              Public stock movement
            </h2>
            <p className="mt-2 text-xs text-slate-400">
              Largest absolute 24h changes among tokens with observed Solana prices.
            </p>
          </div>
          {movers.length ? (
            <div className="divide-y divide-line">
              {movers.map((stock) => (
                <Link
                  key={stock.mint}
                  href={`/stocks/${encodeURIComponent(stock.symbol)}`}
                  className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-white/[.025]"
                >
                  <div>
                    <p className="text-sm font-semibold text-white">{stock.name}</p>
                    <p className="mt-1 font-mono text-[10px] text-slate-500">
                      {stock.symbol} · xStocks · {utcTime(stock.fetchedAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm text-white">{formatUsd(stock.dexPriceUsd)}</p>
                    <p
                      className={`mt-1 font-mono text-xs ${(stock.change24hPct ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                    >
                      {(stock.change24hPct ?? 0) > 0 ? "+" : ""}
                      {(stock.change24hPct ?? 0).toFixed(2)}%
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="p-6 text-sm text-slate-400">
              No priced public stock observations are available.
            </p>
          )}
          <Link
            href="/stocks"
            className="block border-t border-line px-5 py-3 text-xs text-cyan-300"
          >
            Open stock screener →
          </Link>
        </section>
        <section className="rounded-lg border border-line bg-panel">
          <div className="border-b border-line p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <ScanSearch size={16} className="text-cyan-300" />
              Private market divergence
            </h2>
            <p className="mt-2 text-xs text-slate-400">
              Largest absolute differences between PreStocks token prices and provider marks.
            </p>
          </div>
          {divergences.length ? (
            <div className="divide-y divide-line">
              {divergences.map((asset) => (
                <Link
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
                      className={`font-mono text-sm ${Number(asset.premiumDiscountPct) >= 0 ? "text-amber-300" : "text-emerald-300"}`}
                    >
                      {Number(asset.premiumDiscountPct) > 0 ? "+" : ""}
                      {Number(asset.premiumDiscountPct).toFixed(2)}%
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-slate-500">PreStocks mark</p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="p-6 text-sm text-slate-400">
              No private market observations are available.
            </p>
          )}
          <Link
            href="/private-markets"
            className="block border-t border-line px-5 py-3 text-xs text-cyan-300"
          >
            Open private market screener →
          </Link>
        </section>
        <section className="rounded-lg border border-line bg-panel">
          <div className="border-b border-line p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Newspaper size={16} className="text-cyan-300" />
              Source headlines
            </h2>
            <p className="mt-2 text-xs text-slate-400">
              Recent headlines for {focus?.company ?? "the selected market"}. Open the source before
              drawing a conclusion.
            </p>
          </div>
          {news?.data.length ? (
            <div className="divide-y divide-line">
              {news.data.slice(0, 4).map((item) => (
                <a
                  key={item.url}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-5 py-4 hover:bg-white/[.025]"
                >
                  <p className="text-sm font-medium text-white">
                    {item.title} <ArrowUpRight size={12} className="inline text-cyan-300" />
                  </p>
                  <p className="mt-2 font-mono text-[10px] text-slate-500">
                    {item.publisher} · {utcTime(item.publishedAt)} · {item.provider}
                  </p>
                </a>
              ))}
            </div>
          ) : (
            <p className="p-6 text-sm text-slate-400">No recent company headlines were returned.</p>
          )}
          {focus && (
            <Link
              href={`/private-markets/${encodeURIComponent(focus.instrument.baseAsset)}`}
              className="block border-t border-line px-5 py-3 text-xs text-cyan-300"
            >
              Review {focus.company} and run AI assessment →
            </Link>
          )}
        </section>
        <section className="rounded-lg border border-line bg-panel p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Bot size={16} className="text-cyan-300" />
            From research to an agent
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Inspect the asset evidence, generate an on-demand assessment, then draft an agent with a
            defined market universe, capital budget, and risk limits.
          </p>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            Current agent templates and assessments are research tools. Autonomous order execution
            requires the risk and reconciliation gates to be enabled.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/agents"
              className="rounded border border-cyan-400/30 bg-cyan-400/[.08] px-3 py-2 text-xs text-cyan-300"
            >
              Open agent workspace
            </Link>
            <Link
              href="/risk"
              className="rounded border border-line px-3 py-2 text-xs text-slate-300"
            >
              Review risk state
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
