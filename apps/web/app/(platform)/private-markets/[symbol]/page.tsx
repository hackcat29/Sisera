import { ArrowLeft, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "../../../../auth";
import { StockAssessment } from "../../../../components/stock-assessment";
import { StockTradeTicket } from "../../../../components/stock-trade-ticket";
import { getPrivateMarkets, getStockNews } from "../../../../lib/api";

export const dynamic = "force-dynamic";

export default async function PreStockDetail({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const session = await auth();
  const identity = {
    accessToken: session?.accessToken,
    localOperator: process.env.SISERA_LOCAL_OPERATOR_MODE === "true",
  };
  const markets = await getPrivateMarkets(identity).catch(() => []);
  const asset = markets.find(
    (item) => item.instrument.baseAsset.toLowerCase() === symbol.toLowerCase(),
  );
  if (!asset) notFound();
  const news = await getStockNews(asset.instrument.baseAsset, identity).catch(() => null);
  const premium = Number(asset.premiumDiscountPct);
  return (
    <div className="min-h-full p-4 md:p-8">
      <Link
        href="/private-markets"
        className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-white"
      >
        <ArrowLeft size={14} /> Private markets
      </Link>
      <div className="mt-8 border-b border-line pb-6">
        <p className="eyebrow">PreStocks / Solana / {asset.instrument.baseAsset}</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">{asset.company}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">{asset.description}</p>
      </div>
      <div className="mt-6 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Token price", `$${Number(asset.tokenPrice).toFixed(2)}`],
          ["PreStocks mark", `$${Number(asset.markPrice).toFixed(2)}`],
          ["Premium / discount", `${premium >= 0 ? "+" : ""}${premium.toFixed(2)}%`],
          ["Implied valuation", `$${(Number(asset.impliedValuation) / 1e9).toFixed(2)}B`],
        ].map(([label, value]) => (
          <div key={label} className="bg-panel p-5">
            <p className="data-label">{label}</p>
            <p className="mt-3 font-mono text-2xl text-white">{value}</p>
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-lg border border-line bg-panel p-6">
          <h2 className="text-sm font-semibold text-white">Asset identity</h2>
          <dl className="mt-5 space-y-4 text-xs">
            <div>
              <dt className="text-slate-500">Solana mint</dt>
              <dd className="mt-1 break-all font-mono text-slate-200">{asset.instrument.mint}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Mark valuation</dt>
              <dd className="mt-1 font-mono text-slate-200">
                ${Number(asset.markValuation).toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Source</dt>
              <dd className="mt-1 font-mono text-slate-200">
                PreStocks · fetched {new Date(asset.fetchedAt).toLocaleString()}
              </dd>
            </div>
          </dl>
          {asset.productUrl && (
            <a
              href={asset.productUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center gap-2 text-xs text-cyan-300"
            >
              Official product page <ArrowUpRight size={13} />
            </a>
          )}
        </section>
        <div className="self-start lg:sticky lg:top-4">
          <StockTradeTicket
            mint={asset.instrument.mint ?? ""}
            symbol={asset.instrument.baseAsset}
            price={asset.tokenPrice}
          />
        </div>
      </div>
      <StockAssessment symbol={asset.instrument.baseAsset} />
      <section className="mt-4 rounded-lg border border-line bg-panel">
        <div className="border-b border-line px-6 py-4">
          <h2 className="text-sm font-semibold text-white">Company news</h2>
          <p className="mt-1 text-xs text-slate-500">Latest headlines for {asset.company}</p>
        </div>
        {news?.data.length ? (
          <div className="divide-y divide-line">
            {news.data.slice(0, 6).map((item) => (
              <a
                key={item.url}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block px-6 py-4 hover:bg-white/[.025]"
              >
                <div className="flex items-start justify-between gap-5">
                  <p className="text-sm font-medium text-slate-100">{item.title}</p>
                  <ArrowUpRight size={13} className="shrink-0 text-cyan-300" />
                </div>
                <p className="mt-2 font-mono text-[10px] text-slate-500">
                  {item.publisher} · {new Date(item.publishedAt).toLocaleString()} · {item.provider}
                </p>
              </a>
            ))}
          </div>
        ) : (
          <p className="px-6 py-5 text-sm text-slate-400">No recent company headlines found.</p>
        )}
      </section>
    </div>
  );
}
