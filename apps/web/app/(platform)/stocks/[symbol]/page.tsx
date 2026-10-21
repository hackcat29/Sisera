import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "../../../../auth";
import { AssetTabs } from "../../../../components/asset-tabs";
import { AssetEventFeed } from "../../../../components/platform/event-feed";
import { ImpactWidget } from "../../../../components/platform/impact-widget";
import { SignInToTrade } from "../../../../components/sign-in-to-trade";
import { StockAssessment } from "../../../../components/stock-assessment";
import { StockLiveStats } from "../../../../components/stock-live-stats";
import { StockTradeTicket } from "../../../../components/stock-trade-ticket";
import { TradingChart } from "../../../../components/trading-chart";
import { TradingViewChart } from "../../../../components/tradingview-chart";
import {
  getPublicStocks,
  getPythReference,
  getRwaDetail,
  getSolanaTokenHistory,
  getStockNews,
} from "../../../../lib/api";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: { params: Promise<{ symbol: string }> }): Promise<Metadata> {
  const { symbol } = await params;
  const ticker = decodeURIComponent(symbol);
  return {
    title: `${ticker} price, premium to share, and news`,
    description: `Live ${ticker} token price on Solana compared with the underlying share, with liquidity, trading activity, and company news.`,
    alternates: { canonical: `/stocks/${encodeURIComponent(ticker)}` },
  };
}

const compact = (value: number | null | undefined) =>
  value == null ? "—" : `$${Intl.NumberFormat("en-US", { notation: "compact" }).format(value)}`;

export default async function PublicStockPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const session = await auth();
  const signedIn = Boolean(session) || process.env.SISERA_LOCAL_OPERATOR_MODE === "true";
  const identity = {
    accessToken: session?.accessToken,
    localOperator: process.env.SISERA_LOCAL_OPERATOR_MODE === "true",
  };
  const stocks = await getPublicStocks(identity).catch(() => []);
  const stock = stocks.find((item) => item.symbol.toLowerCase() === symbol.toLowerCase());
  if (!stock) notFound();
  const [news, reference, broaderMarket] = await Promise.all([
    getStockNews(stock.symbol, identity).catch(() => null),
    getPythReference(stock.underlyingSymbol, identity).catch(() => null),
    getRwaDetail(stock.underlyingSymbol, identity).catch(() => null),
  ]);
  const price = stock.dexPriceUsd ?? stock.priceUsd;
  const dexHistory = await getSolanaTokenHistory(stock.mint, "1h", identity).catch(() => []);
  const initialBars = dexHistory.map((point) => ({
    time: Math.floor(Date.parse(point.time) / 1000),
    open: point.open,
    high: point.high,
    low: point.low,
    close: point.close,
    volume: point.volumeUsd ?? 0,
  }));
  const referencePrice = reference ? Number(reference.price) : null;

  const comparison = (
    <div className="p-6">
      <p className="max-w-2xl text-[13px] leading-6 text-slate-400">
        How this token compares with the underlying share. The gap can reflect market hours,
        liquidity, and trading costs.
      </p>
      <dl className="mt-5 grid gap-px bg-line text-xs sm:grid-cols-2">
        {[
          [
            "Underlying share",
            referencePrice ? `$${referencePrice.toFixed(2)}` : "Latest price pending",
          ],
          [
            "Token price on Solana",
            stock.dexPriceUsd ? `$${Number(stock.dexPriceUsd).toFixed(2)}` : "—",
          ],
          [
            "Last share price",
            reference ? new Date(reference.feedUpdateTimestamp).toLocaleString() : "—",
          ],
          ["Price source", stock.dexPriceUsd ? "Solana market" : "Issuer price"],
        ].map(([label, value]) => (
          <div key={label} className="bg-panel py-3 pr-4">
            <dt className="text-slate-400">{label}</dt>
            <dd className="num mt-1.5 text-bone">{value}</dd>
          </div>
        ))}
        <div className="bg-panel py-3 sm:col-span-2">
          <dt className="text-slate-400">Token address for wallet verification</dt>
          <dd className="mt-1.5 break-all font-mono text-bone">{stock.mint}</dd>
        </div>
      </dl>
      {stock.chartUrl && (
        <a
          href={stock.chartUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-1 text-xs text-bronze-300 hover:text-white"
        >
          View market chart <ArrowUpRight size={12} />
        </a>
      )}
    </div>
  );

  const company =
    broaderMarket && (broaderMarket.market || broaderMarket.profile) ? (
      <div className="p-6">
        {broaderMarket.profile?.description && (
          <p className="max-w-4xl text-sm leading-7 text-slate-300">
            {broaderMarket.profile.description}
          </p>
        )}
        <div className="mt-5 grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Industry", broaderMarket.profile?.industry ?? "—"],
            ["Founded", broaderMarket.profile?.founded?.slice(0, 4) ?? "—"],
            ["Tokenized market value", compact(broaderMarket.market?.tokenizedMarketCapUsd)],
            ["24h token trading", compact(broaderMarket.market?.tokenizedVolume24hUsd)],
          ].map(([label, value]) => (
            <div key={label} className="bg-ink p-4">
              <p className="data-label">{label}</p>
              <p className="mt-2 text-sm font-medium text-bone">{value}</p>
            </div>
          ))}
        </div>
        {broaderMarket.market?.tokens.length ? (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-bone">Other versions of this stock</h3>
            <div className="mt-3 grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
              {broaderMarket.market.tokens.slice(0, 6).map((token) => (
                <div key={`${token.symbol}-${token.issuer}`} className="bg-ink p-4">
                  <p className="font-mono text-xs text-bronze-300">{token.symbol}</p>
                  <p className="mt-1 truncate text-xs text-slate-300">{token.name}</p>
                  <p className="num mt-2 text-sm text-bone">
                    {token.priceUsd == null ? "—" : `$${token.priceUsd.toFixed(2)}`}
                  </p>
                  {token.issuer && (
                    <p className="mt-1 text-[11px] text-slate-400">Issued by {token.issuer}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <p className="mt-4 text-[11px] text-slate-400">
          Market-wide token figures combine multiple issuers and are separate from the Solana price
          in the trade ticket.
        </p>
      </div>
    ) : null;

  const newsPanel = news?.data.length ? (
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
          <p className="mt-2 font-mono text-[11px] text-slate-400">
            {article.publisher} · {new Date(article.publishedAt).toLocaleString()}
          </p>
        </a>
      ))}
    </div>
  ) : (
    <p className="p-6 text-sm text-slate-400">No recent headlines from connected news sources.</p>
  );

  return (
    <div className="min-h-full bg-ink">
      <StockLiveStats
        logoUrl={stock.logoUrl}
        mint={stock.mint}
        name={stock.name}
        symbol={stock.symbol}
        underlyingSymbol={stock.underlyingSymbol}
        price={price ? Number(price) : null}
        change24hPct={stock.change24hPct}
        volume24hUsd={stock.volume24hUsd}
        liquidityUsd={stock.liquidityUsd}
        referencePrice={referencePrice}
        referenceLive={reference?.referenceFreshness === "live"}
      />
      <div className="grid gap-4 p-4 md:p-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <TradingChart
            source={{ kind: "solana", id: stock.mint }}
            title={`${stock.symbol} · Solana`}
            initialBars={initialBars}
            defaultInterval="1h"
          />
          <AssetTabs
            tabs={[
              { id: "compare", label: "Token vs share", panel: comparison },
              {
                id: "share",
                label: `${stock.underlyingSymbol} share chart`,
                panel: <TradingViewChart symbol={stock.underlyingSymbol} height={480} />,
              },
              ...(company ? [{ id: "company", label: "Company", panel: company }] : []),
              { id: "news", label: "News", panel: newsPanel },
            ]}
          />
          <StockAssessment symbol={stock.symbol} signedIn={signedIn} />
          <AssetEventFeed assetKey={stock.symbol} symbol={stock.symbol} />
        </div>
        <div className="space-y-4 self-start lg:sticky lg:top-4">
          {signedIn ? (
            <>
              <StockTradeTicket
                mint={stock.mint}
                symbol={stock.symbol}
                price={price}
                halted={stock.tradingHalted}
              />
              <ImpactWidget assetKey={stock.symbol} symbol={stock.symbol} />
            </>
          ) : (
            <SignInToTrade
              label={stock.symbol}
              returnTo={`/stocks/${encodeURIComponent(stock.symbol)}`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
