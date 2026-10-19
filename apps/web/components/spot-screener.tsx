"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { SpotMarket } from "../lib/api";
import { useSpotTicks } from "../lib/market-streams";
import { formatSignedPct, signTone } from "../lib/sign";
import { LiveNumber } from "./live-number";

type SortKey = "volume" | "change" | "gainers" | "losers" | "price" | "name";
const PAGE = 100;
const price = (value: number) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: value >= 1 ? 2 : 4,
    maximumFractionDigits: value >= 1 ? 2 : 8,
  });
const compact = (value: number) =>
  `$${Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)}`;

/** Every Binance USDT pair with 24h activity, streamed live over Binance's public WebSocket. */
export function SpotScreener({ markets }: { markets: SpotMarket[] }) {
  const router = useRouter();
  const ticks = useSpotTicks();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("volume");
  const [visible, setVisible] = useState(PAGE);

  const rows = useMemo(() => {
    const needle = query.trim().toUpperCase();
    return markets
      .map((market) => {
        const tick = ticks.get(market.symbol);
        return {
          market,
          last: tick?.last ?? market.last,
          change: tick?.change24hPct ?? market.change24hPct,
          high: tick?.high ?? market.high24h,
          low: tick?.low ?? market.low24h,
          volume: tick?.volumeUsd ?? market.volume24hUsd,
        };
      })
      .filter((row) => row.market.base.includes(needle))
      .sort((a, b) => {
        if (sort === "name") return a.market.base.localeCompare(b.market.base);
        if (sort === "gainers") return b.change - a.change;
        if (sort === "losers") return a.change - b.change;
        if (sort === "change") return Math.abs(b.change) - Math.abs(a.change);
        if (sort === "price") return b.last - a.last;
        return b.volume - a.volume;
      });
  }, [markets, ticks, query, sort]);
  const shown = rows.slice(0, visible);

  return (
    <section className="border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-bone">Crypto spot markets</h2>
          <p className="mt-1 text-xs text-slate-400">
            {markets.length} Binance USDT pairs · streamed live every second
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 border border-line bg-ink px-3">
            <Search size={13} className="text-slate-400" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setVisible(PAGE);
              }}
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
            <option value="change">Biggest movers</option>
            <option value="price">Price</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-xs">
          <thead className="border-b border-line bg-ink-raised text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-5 py-3 font-medium">Pair</th>
              <th className="px-5 py-3 text-right font-medium">Price</th>
              <th className="px-5 py-3 text-right font-medium">24h</th>
              <th className="px-5 py-3 text-right font-medium">24h high</th>
              <th className="px-5 py-3 text-right font-medium">24h low</th>
              <th className="px-5 py-3 text-right font-medium">Volume</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ market, last, change, high, low, volume }) => {
              const href = `/spot/${market.symbol}`;
              return (
                <tr
                  key={market.symbol}
                  onClick={() => router.push(href)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") router.push(href);
                  }}
                  className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-white/[.03]"
                >
                  <td className="px-5 py-2.5">
                    <Link prefetch={false} href={href} onClick={(event) => event.stopPropagation()}>
                      <span className="font-semibold text-bone">{market.base}</span>
                      <span className="text-slate-400"> / USDT</span>
                    </Link>
                  </td>
                  <td className="px-5 py-2.5 text-right text-bone">
                    <LiveNumber value={last} display={price(last)} />
                  </td>
                  <td className={`num px-5 py-2.5 text-right ${signTone(change)}`}>
                    {formatSignedPct(change)}
                  </td>
                  <td className="num px-5 py-2.5 text-right text-slate-300">{price(high)}</td>
                  <td className="num px-5 py-2.5 text-right text-slate-300">{price(low)}</td>
                  <td className="num px-5 py-2.5 text-right text-slate-300">{compact(volume)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[11px] text-slate-400">
        <span>
          Showing {shown.length} of {rows.length}
        </span>
        {rows.length > visible && (
          <button
            type="button"
            onClick={() => setVisible((count) => count + PAGE)}
            className="border border-line px-3 py-1.5 text-slate-200 hover:border-bone"
          >
            Show {Math.min(PAGE, rows.length - visible)} more
          </button>
        )}
      </div>
    </section>
  );
}
