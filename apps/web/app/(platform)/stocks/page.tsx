import { auth } from "../../../auth";
import { LiveRefresh } from "../../../components/live-refresh";
import { PageHeader } from "../../../components/page-header";
import { PublicStockScreener } from "../../../components/public-stock-screener";
import { getPublicStocks, getStockNews } from "../../../lib/api";

export const dynamic = "force-dynamic";

export default async function StocksPage() {
  const session = await auth();
  const identity = {
    accessToken: session?.accessToken,
    localOperator: process.env.SISERA_LOCAL_OPERATOR_MODE === "true",
  };
  const stocks = await getPublicStocks(identity).catch(() => []);
  const newsResults = await Promise.allSettled(
    stocks.slice(0, 4).map((stock) => getStockNews(stock.symbol, identity)),
  );
  const news = [
    ...new Map(
      newsResults
        .flatMap((result) => (result.status === "fulfilled" ? result.value.data : []))
        .map((item) => [item.url, item]),
    ).values(),
  ]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 8);
  return (
    <div className="min-h-full bg-ink">
      <PageHeader
        eyebrow="Solana / Tokenized Equities"
        title="Public stocks"
        description="Discover tokenized equities on Solana. Inspect observed market quotes, available liquidity, and independent reference data before deciding to trade."
        actions={<LiveRefresh />}
      />
      <PublicStockScreener stocks={stocks} />
      <section className="m-4 border border-line bg-panel md:m-6">
        <h2 className="border-b border-line px-5 py-4 text-sm font-semibold text-white">
          Recent stock news
        </h2>
        {news.length ? (
          <div className="divide-y divide-line">
            {news.map((item) => (
              <a
                key={item.url}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block px-5 py-3 hover:bg-white/[.025]"
              >
                <p className="text-xs font-medium text-slate-100">{item.title}</p>
                <p className="mt-1 font-mono text-[10px] text-slate-500">
                  {item.publisher} · {new Date(item.publishedAt).toLocaleString()}
                </p>
              </a>
            ))}
          </div>
        ) : (
          <p className="p-5 text-xs text-slate-400">
            No current articles returned by connected news sources.
          </p>
        )}
      </section>
    </div>
  );
}
