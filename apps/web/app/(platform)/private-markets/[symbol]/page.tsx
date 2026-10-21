import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "../../../../auth";
import { AssetTabs } from "../../../../components/asset-tabs";
import { AssetEventFeed } from "../../../../components/platform/event-feed";
import { ImpactWidget } from "../../../../components/platform/impact-widget";
import { PrivateLiveStats } from "../../../../components/private-live-stats";
import { SignInToTrade } from "../../../../components/sign-in-to-trade";
import { StockAssessment } from "../../../../components/stock-assessment";
import { StockTradeTicket } from "../../../../components/stock-trade-ticket";
import { TradingChart } from "../../../../components/trading-chart";
import { getPrivateMarkets, getSolanaTokenHistory, getStockNews } from "../../../../lib/api";

export async function generateMetadata({
  params,
}: { params: Promise<{ symbol: string }> }): Promise<Metadata> {
  const { symbol } = await params;
  const ticker = decodeURIComponent(symbol).toUpperCase();
  return {
    title: `${ticker} pre-IPO token price vs issuer mark`,
    description: `${ticker} private-company token price compared with the issuer mark and implied valuation, with price history and news.`,
    alternates: { canonical: `/private-markets/${encodeURIComponent(ticker)}` },
  };
}

export const dynamic = "force-dynamic";

export default async function PreStockDetail({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const session = await auth();
  const signedIn = Boolean(session) || process.env.SISERA_LOCAL_OPERATOR_MODE === "true";
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
  const history = asset.instrument.mint
    ? await getSolanaTokenHistory(asset.instrument.mint, "1h", identity).catch(() => [])
    : [];
  const mint = asset.instrument.mint ?? asset.instrument.venueSymbol;
  const initialBars = history.map((point) => ({
    time: Math.floor(Date.parse(point.time) / 1000),
    open: point.open,
    high: point.high,
    low: point.low,
    close: point.close,
    volume: point.volumeUsd ?? 0,
  }));
  const details = (
    <div className="p-6">
      <dl className="grid gap-px bg-line text-xs sm:grid-cols-2">
        {[
          ["Solana mint", mint],
          ["Mark valuation", `$${Number(asset.markValuation).toLocaleString()}`],
          ["Token supply", Number(asset.supply).toLocaleString()],
          ["Issuer mark as of", `${new Date(asset.fetchedAt).toUTCString()}`],
        ].map(([label, value]) => (
          <div key={label} className="bg-panel py-3 pr-4">
            <dt className="text-slate-400">{label}</dt>
            <dd className="mt-1.5 break-all font-mono text-bone">{value}</dd>
          </div>
        ))}
      </dl>
      {asset.productUrl && (
        <a
          href={asset.productUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex items-center gap-2 text-xs text-bronze-300"
        >
          Official product page <ArrowUpRight size={13} />
        </a>
      )}
      <p className="mt-4 text-[11px] text-slate-400">
        The issuer mark is an estimate of company value, not a verified fair value or an executable
        price.
      </p>
    </div>
  );
  const newsPanel = news?.data.length ? (
    <div className="divide-y divide-line">
      {news.data.slice(0, 10).map((item) => (
        <a
          key={item.url}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block px-6 py-4 hover:bg-white/[.03]"
        >
          <p className="text-sm text-slate-100">{item.title}</p>
          <p className="mt-2 font-mono text-[11px] text-slate-400">
            {item.publisher} · {new Date(item.publishedAt).toLocaleString()}
          </p>
        </a>
      ))}
    </div>
  ) : (
    <p className="p-6 text-sm text-slate-400">No recent company headlines found.</p>
  );

  return (
    <div className="min-h-full bg-ink">
      <PrivateLiveStats
        imageUrl={asset.imageUrl}
        mint={mint}
        company={asset.company}
        symbol={asset.instrument.baseAsset}
        description={asset.description}
        tokenPrice={Number(asset.tokenPrice)}
        markPrice={Number(asset.markPrice)}
        impliedValuation={Number(asset.impliedValuation)}
        markValuation={Number(asset.markValuation)}
      />
      <div className="grid gap-4 p-4 md:p-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <TradingChart
            source={{ kind: "solana", id: mint }}
            title={`${asset.instrument.baseAsset} · Solana`}
            initialBars={initialBars}
            defaultInterval="1h"
          />
          <AssetTabs
            tabs={[
              { id: "details", label: "Token details", panel: details },
              { id: "news", label: "News", panel: newsPanel },
            ]}
          />
          <StockAssessment symbol={asset.instrument.baseAsset} signedIn={signedIn} />
          <AssetEventFeed
            assetKey={asset.instrument.baseAsset}
            symbol={asset.instrument.baseAsset}
          />
        </div>
        <div className="space-y-4 self-start lg:sticky lg:top-4">
          {signedIn ? (
            <>
              <StockTradeTicket
                mint={mint}
                symbol={asset.instrument.baseAsset}
                price={asset.tokenPrice}
              />
              <ImpactWidget
                assetKey={asset.instrument.baseAsset}
                symbol={asset.instrument.baseAsset}
              />
            </>
          ) : (
            <SignInToTrade
              label={asset.instrument.baseAsset}
              returnTo={`/private-markets/${encodeURIComponent(asset.instrument.baseAsset)}`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
