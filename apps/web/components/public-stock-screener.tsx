"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { PublicStock } from "../lib/api";
import { useLivePrices } from "../lib/live-prices";
import { formatSignedPct, signTone } from "../lib/sign";
import { LiveNumber } from "./live-number";
import { usSession } from "./market-session";
import { TokenAvatar } from "./token-avatar";

type SortKey = "name" | "price" | "change" | "volume" | "liquidity" | "premium";
const PAGE = 100;
const money = (value: number | null) =>
  value == null
    ? "—"
    : `$${Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)}`;
const price = (value: number | null) =>
  value == null
    ? "—"
    : `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PublicStockScreener({ stocks }: { stocks: PublicStock[] }) {
  const router = useRouter();
  const live = useLivePrices();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("volume");
  const [availableOnly, setAvailableOnly] = useState(true);
  const [visible, setVisible] = useState(PAGE);
  const [session, setSession] = useState<ReturnType<typeof usSession> | null>(null);
  useEffect(() => setSession(usSession(new Date())), []);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return stocks
      .map((stock) => {
        const quote = live[stock.mint];
        const tokenPrice = quote?.usd ?? (stock.dexPriceUsd ? Number(stock.dexPriceUsd) : null);
        const sharePrice = quote?.underlyingUsd ?? null;
        return {
          stock,
          tokenPrice,
          sharePrice,
          change: quote?.change24hPct ?? stock.change24hPct,
          premium: tokenPrice && sharePrice ? (tokenPrice / sharePrice - 1) * 100 : null,
        };
      })
      .filter((row) => !availableOnly || row.tokenPrice != null)
      .filter(({ stock }) =>
        `${stock.name} ${stock.symbol} ${stock.underlyingSymbol}`.toLowerCase().includes(needle),
      )
      .sort((a, b) => {
        if (sort === "name") return a.stock.name.localeCompare(b.stock.name);
        const value = (row: typeof a) =>
          sort === "premium"
            ? row.premium == null
              ? null
              : Math.abs(row.premium)
            : sort === "price"
              ? row.tokenPrice
              : sort === "change"
                ? row.change
                : sort === "liquidity"
                  ? row.stock.liquidityUsd
                  : row.stock.volume24hUsd;
        const left = value(a);
        const right = value(b);
        if (left == null && right == null) return a.stock.name.localeCompare(b.stock.name);
        if (left == null) return 1;
        if (right == null) return -1;
        return right - left;
      });
  }, [stocks, live, query, sort, availableOnly]);

  const priced = stocks.filter((stock) => stock.dexPriceUsd != null).length;
  const shown = rows.slice(0, visible);

  return (
    <section className="m-4 border border-line bg-panel md:m-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-bone">Tokenized stock screener</h2>
          <p className="mt-1 text-xs text-slate-400">
            {stocks.length.toLocaleString()} listed · {priced.toLocaleString()} trading on Solana ·
            prices update every second
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
              placeholder="Company or symbol"
              aria-label="Search tokenized stocks"
              className="h-9 w-44 bg-transparent text-xs text-bone outline-none placeholder:text-slate-500"
            />
          </label>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            aria-label="Sort tokenized stocks"
            className="h-9 border border-line bg-ink px-2 text-xs text-slate-200"
          >
            <option value="volume">Volume</option>
            <option value="liquidity">Liquidity</option>
            <option value="premium">Largest price gap</option>
            <option value="change">24h change</option>
            <option value="price">Price</option>
            <option value="name">Company</option>
          </select>
          <label className="flex h-9 items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={availableOnly}
              onChange={(event) => setAvailableOnly(event.target.checked)}
            />
            Trading only
          </label>
        </div>
      </div>
      {session && (
        <p className="flex items-center gap-2 border-b border-line bg-ink-raised px-5 py-2 text-[11px] text-slate-300">
          <span
            className={`size-1.5 rounded-full ${session.tone === "open" ? "bg-[var(--up)]" : "bg-bronze-300"}`}
          />
          {session.tone === "open"
            ? "US market open: share prices are live."
            : `${session.label}: share prices are the latest available and may lag the token.`}
        </p>
      )}
      {shown.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-xs">
            <thead className="border-b border-line bg-ink-raised text-[10px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-5 py-3 font-medium">Company</th>
                <th className="px-5 py-3 text-right font-medium">Token price</th>
                <th className="px-5 py-3 text-right font-medium">Share price</th>
                <th className="px-5 py-3 text-right font-medium">Price gap</th>
                <th className="px-5 py-3 text-right font-medium">24h</th>
                <th className="px-5 py-3 text-right font-medium">Volume</th>
                <th className="px-5 py-3 text-right font-medium">Liquidity</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ stock, tokenPrice, sharePrice, change, premium }) => {
                const href = `/stocks/${encodeURIComponent(stock.symbol)}`;
                return (
                  <tr
                    key={stock.mint}
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
                        <TokenAvatar
                          src={stock.logoUrl}
                          symbol={stock.underlyingSymbol}
                          size={26}
                        />
                        <span>
                          <span className="font-semibold text-bone">
                            {stock.name.replace(/ xStock$/, "")}
                          </span>
                          <span className="ml-2 font-mono text-[11px] text-slate-400">
                            {stock.symbol}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-5 py-2.5 text-right text-bone">
                      <LiveNumber value={tokenPrice} display={price(tokenPrice)} />
                    </td>
                    <td className="num px-5 py-2.5 text-right text-slate-300">
                      {price(sharePrice)}
                    </td>
                    <td className={`num px-5 py-2.5 text-right ${signTone(premium)}`}>
                      {formatSignedPct(premium)}
                    </td>
                    <td className={`num px-5 py-2.5 text-right ${signTone(change)}`}>
                      {formatSignedPct(change)}
                    </td>
                    <td className="num px-5 py-2.5 text-right text-slate-300">
                      {money(stock.volume24hUsd)}
                    </td>
                    <td className="num px-5 py-2.5 text-right text-slate-300">
                      {money(stock.liquidityUsd)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-8 text-center text-sm text-slate-400">
          <p>
            {stocks.length ? "No stocks match these filters." : "Stock quotes are reconnecting."}
          </p>
          {stocks.length > 0 && (
            <p className="mt-2 text-xs">Try another company or turn off Trading only.</p>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-[11px] text-slate-400">
        <span>
          Showing {shown.length.toLocaleString()} of {rows.length.toLocaleString()}. Price gap
          compares the token with its share price and may differ from the price available to trade.
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
