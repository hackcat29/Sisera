"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { PreStock } from "../lib/api";
import { useLivePrices } from "../lib/live-prices";
import { formatSignedPct, signTone } from "../lib/sign";
import { LiveNumber } from "./live-number";

type SortKey = "company" | "premium" | "token" | "valuation";
const dollars = (value: string, compact = false) =>
  Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(Number(value));
const observedAt = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));

export function PrivateMarketScreener({ markets }: { markets: PreStock[] }) {
  const router = useRouter();
  const live = useLivePrices();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("premium");
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return markets
      .map((market) => {
        const token = live[market.instrument.venueSymbol]?.usd ?? Number(market.tokenPrice);
        const mark = Number(market.markPrice);
        const premium = mark > 0 ? (token / mark - 1) * 100 : Number(market.premiumDiscountPct);
        // The issuer's implied valuation, moved in proportion to the live token price.
        const quoted = Number(market.tokenPrice);
        const implied =
          quoted > 0
            ? Number(market.impliedValuation) * (token / quoted)
            : Number(market.impliedValuation);
        return { market, token, premium, implied };
      })
      .filter(({ market }) =>
        `${market.company} ${market.instrument.baseAsset}`.toLowerCase().includes(needle),
      )
      .sort((a, b) => {
        if (sort === "company") return a.market.company.localeCompare(b.market.company);
        if (sort === "premium") return Math.abs(b.premium) - Math.abs(a.premium);
        if (sort === "token") return b.token - a.token;
        return b.implied - a.implied;
      });
  }, [markets, live, query, sort]);
  const observed = markets[0]?.fetchedAt;

  return (
    <section className="border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
        <div>
          <h2 className="text-sm font-semibold text-white">Private company screener</h2>
          <p className="mt-1 text-xs text-slate-400">
            {rows.length} of {markets.length} companies · token prices update every second
            {observed ? ` · issuer marks as of ${observedAt(observed)} UTC` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-2 rounded border border-line bg-ink px-3">
            <Search size={13} className="text-slate-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Company or symbol"
              aria-label="Search private markets"
              className="h-9 w-40 bg-transparent text-xs text-white outline-none placeholder:text-slate-500"
            />
          </label>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            aria-label="Sort private markets"
            className="h-9 rounded border border-line bg-ink px-2 text-xs text-slate-200"
          >
            <option value="premium">Premium / discount</option>
            <option value="valuation">Implied valuation</option>
            <option value="token">Token price</option>
            <option value="company">Company</option>
          </select>
        </div>
      </div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-xs">
            <thead className="border-b border-line bg-ink-raised font-mono text-[10px] uppercase tracking-[.08em] text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 text-right font-medium">Token price</th>
                <th className="px-4 py-3 text-right font-medium">Company mark</th>
                <th className="px-4 py-3 text-right font-medium">Premium / discount</th>
                <th className="px-4 py-3 text-right font-medium">Implied valuation</th>
                <th className="px-4 py-3 text-right font-medium">Mark valuation</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ market, token, premium, implied }) => {
                const href = `/private-markets/${encodeURIComponent(market.instrument.baseAsset)}`;
                return (
                  <tr
                    key={market.instrument.id}
                    onClick={() => router.push(href)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") router.push(href);
                    }}
                    className="cursor-pointer border-b border-line/70 last:border-0 hover:bg-white/[.03]"
                  >
                    <td className="px-4 py-3">
                      <Link
                        prefetch={false}
                        href={href}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <span className="font-semibold text-bone">
                          {market.company.replace(/ PreStocks$/, "")}
                        </span>
                        <span className="ml-2 font-mono text-[11px] text-slate-400">
                          {market.instrument.baseAsset}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right text-bone">
                      <LiveNumber value={token} display={dollars(String(token))} />
                    </td>
                    <td className="num px-4 py-3 text-right text-slate-300">
                      {dollars(market.markPrice)}
                    </td>
                    <td className={`num px-4 py-3 text-right ${signTone(premium)}`}>
                      {formatSignedPct(premium)}
                    </td>
                    <td className="num px-4 py-3 text-right text-slate-300">
                      {dollars(String(implied), true)}
                    </td>
                    <td className="num px-4 py-3 text-right text-slate-300">
                      {dollars(market.markValuation, true)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="p-8 text-center text-sm text-slate-400">
          No private markets match this search.
        </p>
      )}
      <p className="border-t border-line px-4 py-3 text-[11px] text-slate-500">
        Premium compares a token quote with a PreStocks provider mark. The mark is neither a
        verified fair value nor an executable quote.
      </p>
    </section>
  );
}
