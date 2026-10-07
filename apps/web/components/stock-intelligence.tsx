import { ArrowUpRight, CircleAlert, RadioTower } from "lucide-react";
import Link from "next/link";
import { auth } from "../auth";
import { getPrivateMarkets, getPublicStocks, getStockNews } from "../lib/api";
import { signTone } from "../lib/sign";
import { NewsBrowser } from "./news-browser";
import { PageHeader } from "./page-header";

export async function StockIntelligence() {
  const session = await auth();
  const identity = {
    accessToken: session?.accessToken,
    localOperator: process.env.SISERA_LOCAL_OPERATOR_MODE === "true",
  };
  const [assets, publicStocks] = await Promise.all([
    getPrivateMarkets(identity).catch(() => []),
    getPublicStocks(identity).catch(() => []),
  ]);
  const ranked = [...assets].sort(
    (left, right) =>
      Math.abs(Number(right.premiumDiscountPct)) - Math.abs(Number(left.premiumDiscountPct)),
  );
  const coveredSymbols = [
    ...publicStocks.slice(0, 4).map((stock) => stock.symbol),
    ...assets.slice(0, 3).map((asset) => asset.instrument.baseAsset),
  ];
  const coverage = await Promise.allSettled(
    coveredSymbols.map((symbol) => getStockNews(symbol, identity)),
  );
  const articles = coverage
    .flatMap((result, index) =>
      result.status === "fulfilled"
        ? result.value.data.map((article) => ({
            ...article,
            company: coveredSymbols[index] ?? "Market",
          }))
        : [],
    )
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
    .slice(0, 50);

  return (
    <div className="min-h-full bg-ink">
      <PageHeader
        eyebrow="Stock research"
        title="Stock intelligence"
        description="Find price differences, company news and market context for the stocks you follow."
        actions={
          <Link
            href="/intelligence?universe=perps"
            className="rounded border border-line px-3 py-2 text-xs text-slate-400 hover:text-white"
          >
            Perpetuals research →
          </Link>
        }
      />
      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,.7fr)] md:p-6">
        <section className="border border-line bg-panel p-4 xl:col-span-2">
          <h2 className="text-sm font-semibold text-white">Public stock coverage</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {publicStocks.slice(0, 12).map((stock) => (
              <Link
                key={stock.mint}
                href={`/stocks/${encodeURIComponent(stock.symbol)}`}
                className="rounded border border-line px-3 py-2 text-xs text-slate-300 hover:text-bronze-300"
              >
                {stock.symbol} ·{" "}
                {stock.priceUsd ? `$${Number(stock.priceUsd).toFixed(2)}` : "unpriced"}
              </Link>
            ))}
          </div>
          {!publicStocks.length && (
            <p className="mt-3 text-xs text-slate-400">
              Public stocks are refreshing. Explore private market activity below.
            </p>
          )}
        </section>
        <section className="overflow-hidden rounded-lg border border-line bg-panel">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <p className="eyebrow">Private companies</p>
              <h2 className="mt-1 text-base font-semibold text-white">Largest price gaps</h2>
            </div>
            <RadioTower size={16} className="text-bronze-300" />
          </div>
          {ranked.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[590px] text-left text-xs">
                <thead className="border-b border-line font-mono text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Company</th>
                    <th className="px-5 py-3 text-right font-medium">Token</th>
                    <th className="px-5 py-3 text-right font-medium">Issuer mark</th>
                    <th className="px-5 py-3 text-right font-medium">Premium / discount</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((asset) => {
                    const gap = Number(asset.premiumDiscountPct);
                    return (
                      <tr
                        key={asset.instrument.id}
                        className="border-b border-line/70 last:border-0 hover:bg-white/[.025]"
                      >
                        <td className="px-5 py-3">
                          <Link
                            href={`/private-markets/${encodeURIComponent(asset.instrument.baseAsset)}`}
                            className="inline-flex items-center gap-1 font-semibold text-slate-100 hover:text-bronze-300"
                          >
                            {asset.company}
                            <ArrowUpRight size={12} />
                          </Link>
                          <p className="mt-1 font-mono text-[10px] text-slate-500">
                            {asset.instrument.baseAsset} · Solana
                          </p>
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-slate-200">
                          ${Number(asset.tokenPrice).toFixed(2)}
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-slate-400">
                          ${Number(asset.markPrice).toFixed(2)}
                        </td>
                        <td className={`px-5 py-3 text-right font-mono ${signTone(gap)}`}>
                          {gap > 0 ? "+" : ""}
                          {gap.toFixed(2)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex items-center gap-2 p-5 text-sm text-slate-400">
              <CircleAlert size={16} /> Private market comparisons are refreshing. Browse public
              stocks above.
            </div>
          )}
          <p className="border-t border-line px-5 py-3 font-mono text-[10px] text-slate-500">
            {assets[0]
              ? `Updated ${new Date(assets[0].fetchedAt).toLocaleString()}`
              : "Market view updating"}
          </p>
        </section>
        <section className="rounded-lg border border-line bg-panel">
          <div className="border-b border-line px-5 py-4">
            <p className="eyebrow">Company events</p>
            <h2 className="mt-1 text-base font-semibold text-white">Recent coverage</h2>
          </div>
          {articles.length ? (
            <NewsBrowser articles={articles} />
          ) : (
            <p className="p-5 text-sm text-slate-400">
              New company coverage will appear here. Explore the market and company pages in the
              meantime.
            </p>
          )}
        </section>
      </div>
      <p className="px-6 pb-6 text-xs leading-5 text-slate-500">
        Indicative mark gap · execution and redemption unverified.
      </p>
    </div>
  );
}
