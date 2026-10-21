"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { spotLogos } from "../lib/asset-logo";
import { type SpotMarket, spotMarkets } from "../lib/hyperliquid";
import { usePerpMid } from "../lib/market-streams";
import { formatSignedPct, signTone } from "../lib/sign";
import { LiveNumber } from "./live-number";
import { TokenAvatar } from "./token-avatar";

type SortKey = "volume" | "gainers" | "losers" | "name";
/** Pairs below this daily volume are hidden unless searched for; most are inactive. */
const ACTIVE_VOLUME_USD = 1000;
const price = (value: number) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: value >= 1 ? 2 : 4,
    maximumFractionDigits: value >= 1 ? 4 : 8,
  });
const compact = (value: number) =>
  `$${Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)}`;
const change = (market: SpotMarket, last: number) =>
  market.prevDayPx > 0 ? ((last - market.prevDayPx) / market.prevDayPx) * 100 : 0;

function Row({ market }: { market: SpotMarket }) {
  const router = useRouter();
  const last = usePerpMid(market.coin) ?? market.markPx;
  const move = change(market, last);
  const href = `/spot/${encodeURIComponent(market.symbol)}`;
  return (
    <tr
      onClick={() => router.push(href)}
      onKeyDown={(event) => {
        if (event.key === "Enter") router.push(href);
      }}
      className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-white/[.03]"
    >
      <td className="px-5 py-2.5">
        <Link
          prefetch={false}
          href={href}
          className="flex items-center gap-3"
          onClick={(event) => event.stopPropagation()}
        >
          <TokenAvatar src={spotLogos(market)} symbol={market.symbol} size={24} />
          <span>
            <span className="font-semibold text-bone">{market.symbol}</span>
            <span className="text-slate-400"> / USDC</span>
            {market.name !== market.symbol && (
              <span className="ml-2 text-[11px] text-slate-500">{market.name}</span>
            )}
          </span>
        </Link>
      </td>
      <td className="px-5 py-2.5 text-right text-bone">
        <LiveNumber value={last} display={price(last)} />
      </td>
      <td className={`num px-5 py-2.5 text-right ${signTone(move)}`}>{formatSignedPct(move)}</td>
      <td className="num px-5 py-2.5 text-right text-slate-300">{compact(market.volume24hUsd)}</td>
    </tr>
  );
}

/** Every Hyperliquid spot pair quoted in USDC, with live prices. */
export function SpotScreener() {
  const [markets, setMarkets] = useState<SpotMarket[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("volume");

  useEffect(() => {
    void spotMarkets()
      .then(setMarkets)
      .catch(() => setFailed(true));
  }, []);

  const rows = useMemo(() => {
    const needle = query.trim().toUpperCase();
    return (markets ?? [])
      .filter((market) =>
        needle
          ? market.symbol.toUpperCase().includes(needle) ||
            market.name.toUpperCase().includes(needle)
          : market.volume24hUsd >= ACTIVE_VOLUME_USD,
      )
      .sort((a, b) => {
        if (sort === "name") return a.symbol.localeCompare(b.symbol);
        if (sort === "gainers") return change(b, b.markPx) - change(a, a.markPx);
        if (sort === "losers") return change(a, a.markPx) - change(b, b.markPx);
        return b.volume24hUsd - a.volume24hUsd;
      });
  }, [markets, query, sort]);

  return (
    <section className="border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-bone">Crypto spot markets</h2>
          <p className="mt-1 text-xs text-slate-400">
            {markets ? `${rows.length} active Hyperliquid spot pairs · live prices` : "Loading…"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 border border-line bg-ink px-3">
            <Search size={13} className="text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search asset"
              aria-label="Search crypto markets"
              className="h-9 w-40 bg-transparent text-xs text-bone outline-none placeholder:text-slate-500"
            />
          </label>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            aria-label="Sort crypto markets"
            className="h-9 border border-line bg-ink px-2 text-xs text-slate-200"
          >
            <option value="volume">Volume</option>
            <option value="gainers">Top gainers</option>
            <option value="losers">Top losers</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>
      {failed ? (
        <p className="p-5 text-xs text-amber-200">
          Spot markets are reconnecting. Try again shortly.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-xs">
            <thead className="border-b border-line bg-ink-raised text-[10px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-5 py-3 font-medium">Pair</th>
                <th className="px-5 py-3 text-right font-medium">Price</th>
                <th className="px-5 py-3 text-right font-medium">24h</th>
                <th className="px-5 py-3 text-right font-medium">Volume</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((market) => (
                <Row key={market.coin} market={market} />
              ))}
            </tbody>
          </table>
          {markets && !rows.length && (
            <p className="p-5 text-xs text-slate-400">No spot pairs match “{query}”.</p>
          )}
        </div>
      )}
    </section>
  );
}
