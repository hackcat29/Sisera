import { ArrowLeft, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "../../../../auth";
import { StockTradeTicket } from "../../../../components/stock-trade-ticket";
import { getPublicStocks, getPythReference, getStockNews } from "../../../../lib/api";

export const dynamic = "force-dynamic";

export default async function PublicStockPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const session = await auth();
  const identity = {
    accessToken: session?.accessToken,
    localOperator: process.env.SISERA_LOCAL_OPERATOR_MODE === "true",
  };
  const stocks = await getPublicStocks(identity).catch(() => []);
  const stock = stocks.find((item) => item.symbol.toLowerCase() === symbol.toLowerCase());
  if (!stock) notFound();
  const [news, reference] = await Promise.all([
    getStockNews(stock.symbol, identity).catch(() => null),
    getPythReference(stock.underlyingSymbol, identity).catch(() => null),
  ]);
  const price = stock.dexPriceUsd ?? stock.priceUsd;
  const referencePrice = reference ? Number(reference.price) : null;
  const tokenPrice = stock.dexPriceUsd ? Number(stock.dexPriceUsd) : null;
  const premium =
    referencePrice && referencePrice > 0 && tokenPrice
      ? (tokenPrice / referencePrice - 1) * 100
      : null;
  return (
    <div className="min-h-full bg-ink p-4 md:p-8">
      <Link
        href="/stocks"
        className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-white"
      >
        <ArrowLeft size={14} /> Stocks
      </Link>
      <div className="mt-7 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div>
          <p className="eyebrow">Public stocks / {stock.symbol}</p>
          <h1 className="mt-2 text-3xl font-semibold text-white">{stock.name}</h1>
          <p className="mt-2 text-sm text-slate-400">{stock.underlyingSymbol} · Solana</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-3xl text-white">
            {price ? `$${Number(price).toFixed(2)}` : "—"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {stock.dexPriceUsd ? "Solana market" : "Issuer price"} · updated{" "}
            {new Date(stock.fetchedAt).toLocaleTimeString()}
          </p>
        </div>
      </div>
      <div className="mt-6 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
        {[
          [
            "24h change",
            stock.change24hPct == null
              ? "—"
              : `${stock.change24hPct > 0 ? "+" : ""}${stock.change24hPct.toFixed(2)}%`,
          ],
          [
            "24h volume",
            stock.volume24hUsd == null
              ? "—"
              : `$${Intl.NumberFormat("en-US", { notation: "compact" }).format(stock.volume24hUsd)}`,
          ],
          [
            "Liquidity",
            stock.liquidityUsd == null
              ? "—"
              : `$${Intl.NumberFormat("en-US", { notation: "compact" }).format(stock.liquidityUsd)}`,
          ],
        ].map(([label, value]) => (
          <div key={label} className="bg-panel p-5">
            <p className="data-label">{label}</p>
            <p className="mt-3 font-mono text-xl text-white">{value}</p>
          </div>
        ))}
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-lg border border-line bg-panel p-6">
          <h2 className="text-base font-semibold text-white">Market and reference</h2>
          <p className="mt-2 text-xs text-slate-400">
            The onchain quote and the underlying equity reference come from different markets. The
            comparison is indicative, not an executable spread.
          </p>
          <div className="mt-5 grid gap-4 text-xs sm:grid-cols-2">
            <div>
              <p className="text-slate-500">Pyth equity reference</p>
              <p className="mt-2 font-mono text-white">
                {referencePrice ? `$${referencePrice.toFixed(2)}` : "Unavailable"}
              </p>
            </div>
            <div>
              <p className="text-slate-500">Solana market price</p>
              <p className="mt-2 font-mono text-white">
                {stock.dexPriceUsd ? `$${Number(stock.dexPriceUsd).toFixed(2)}` : "—"}
              </p>
            </div>
            <div>
              <p className="text-slate-500">Token premium / discount</p>
              <p
                className={`mt-2 font-mono ${premium == null ? "text-slate-400" : premium >= 0 ? "text-amber-300" : "text-emerald-300"}`}
              >
                {premium == null
                  ? "Unavailable"
                  : `${premium > 0 ? "+" : ""}${premium.toFixed(2)}%`}
              </p>
            </div>
            <div>
              <p className="text-slate-500">Reference status</p>
              <p className="mt-2 font-mono text-white">
                {reference
                  ? `${reference.referenceFreshness.replace("_", " ")} · ${reference.marketSession ?? "session unknown"}`
                  : "Feed unavailable"}
              </p>
              {reference && (
                <p className="mt-1 text-[10px] text-slate-500">
                  Generated {new Date(reference.feedUpdateTimestamp).toLocaleString()}
                </p>
              )}
            </div>
            <div className="sm:col-span-2">
              <p className="text-slate-500">Token address</p>
              <p className="mt-2 break-all font-mono text-white">{stock.mint}</p>
            </div>
          </div>
          {stock.chartUrl && (
            <a
              href={stock.chartUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-white"
            >
              View market chart <ArrowUpRight size={12} />
            </a>
          )}
        </section>
        <div className="self-start lg:sticky lg:top-4">
          <StockTradeTicket
            mint={stock.mint}
            symbol={stock.symbol}
            price={price}
            halted={stock.tradingHalted}
          />
        </div>
      </div>
      <section className="mt-5 rounded-lg border border-line bg-panel">
        <div className="border-b border-line px-6 py-4">
          <h2 className="text-base font-semibold text-white">Company news</h2>
        </div>
        {news?.data.length ? (
          <div className="divide-y divide-line">
            {news.data.slice(0, 10).map((article) => (
              <a
                key={article.url}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block px-6 py-4 hover:bg-white/[.03]"
              >
                <p className="text-sm text-slate-100">{article.title}</p>
                <p className="mt-2 text-xs text-slate-500">
                  {article.publisher} · {new Date(article.publishedAt).toLocaleString()}
                </p>
              </a>
            ))}
          </div>
        ) : (
          <p className="p-6 text-sm text-slate-400">No recent headlines found.</p>
        )}
      </section>
    </div>
  );
}
