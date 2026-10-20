import { unstable_cache } from "next/cache";
import Link from "next/link";
import { type ApiIdentity, getPrivateMarkets, getPublicStocks } from "../lib/api";
import { LiveTokenChange, LiveTokenPrice } from "./live-price";

type TickerItem = {
  href: string;
  mint: string;
  symbol: string;
  price: number;
  change: number | null;
};

/** A scrolling strip of tokenized stock and private-market prices. Renders nothing without data. */
export async function TickerTape({
  identity,
  compact = false,
}: {
  identity: ApiIdentity;
  compact?: boolean;
}) {
  // The strip renders on every workspace page, so signed-in sessions share one copy of this
  // market-wide data for 30 seconds instead of each render spending the API's per-route rate limit.
  // Anonymous requests use a separate key so they never receive data fetched with a session.
  const audience = identity.accessToken || identity.localOperator ? "session" : "public";
  const [stocks, privateMarkets] = await unstable_cache(
    () =>
      Promise.all([
        getPublicStocks(identity).catch(() => []),
        getPrivateMarkets(identity).catch(() => []),
      ]),
    ["ticker-tape", audience],
    { revalidate: 30 },
  )();
  const items: TickerItem[] = [
    ...stocks
      .filter((stock) => stock.dexPriceUsd && stock.change24hPct != null)
      .sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0))
      .slice(0, 14)
      .map((stock) => ({
        href: `/stocks/${encodeURIComponent(stock.symbol)}`,
        mint: stock.mint,
        symbol: stock.symbol,
        price: Number(stock.dexPriceUsd),
        change: stock.change24hPct,
      })),
    ...privateMarkets
      .filter((market) => Number.isFinite(Number(market.tokenPrice)))
      .slice(0, 6)
      .map((market) => ({
        href: `/private-markets/${encodeURIComponent(market.instrument.baseAsset)}`,
        mint: market.instrument.venueSymbol,
        symbol: market.instrument.baseAsset,
        price: Number(market.tokenPrice),
        change: null,
      })),
  ];
  if (items.length < 3) return null;

  const row = (hidden: boolean) =>
    items.map((item) => (
      <Link
        prefetch={false}
        key={`${hidden ? "b" : "a"}-${item.href}`}
        href={item.href}
        tabIndex={hidden ? -1 : undefined}
        className="flex shrink-0 items-center gap-2 border-r border-line px-4 hover:bg-white/[.03]"
      >
        <span className="text-slate-300">{item.symbol}</span>
        <LiveTokenPrice mint={item.mint} fallback={item.price} className="text-bone" />
        <LiveTokenChange mint={item.mint} fallback={item.change} />
      </Link>
    ));

  return (
    <div
      className={`relative overflow-hidden border-b border-line bg-ink-deep font-mono text-[11px] ${compact ? "h-8" : "h-9"}`}
    >
      <div className="ticker-track flex h-full w-max items-center">
        <div className="flex h-full items-center">{row(false)}</div>
        <div className="flex h-full items-center" aria-hidden="true">
          {row(true)}
        </div>
      </div>
    </div>
  );
}
