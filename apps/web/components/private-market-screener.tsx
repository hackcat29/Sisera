"use client";

import { ArrowUpRight, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { PreStock } from "../lib/api";

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
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("premium");
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return markets
      .filter((market) =>
        `${market.company} ${market.instrument.baseAsset}`.toLowerCase().includes(needle),
      )
      .sort((a, b) => {
        if (sort === "company") return a.company.localeCompare(b.company);
        const field =
          sort === "premium"
            ? "premiumDiscountPct"
            : sort === "token"
              ? "tokenPrice"
              : "impliedValuation";
        return Number(b[field]) - Number(a[field]);
      });
  }, [markets, query, sort]);

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
        <div>
          <h2 className="text-sm font-semibold text-white">Private company screener</h2>
          <p className="mt-1 text-xs text-slate-400">
            {rows.length} of {markets.length} assets · provider marks are indicative
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
            <thead className="border-b border-line bg-[#111d26] font-mono text-[10px] uppercase tracking-[.08em] text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 text-right font-medium">Token price</th>
                <th className="px-4 py-3 text-right font-medium">Provider mark</th>
                <th className="px-4 py-3 text-right font-medium">Premium / discount</th>
                <th className="px-4 py-3 text-right font-medium">Implied valuation</th>
                <th className="px-4 py-3 text-right font-medium">Mark valuation</th>
                <th className="px-4 py-3 font-medium">Mark observed</th>
                <th className="px-4 py-3 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((market) => {
                const premium = Number(market.premiumDiscountPct);
                return (
                  <tr
                    key={market.instrument.id}
                    className="border-b border-line/70 last:border-0 hover:bg-white/[.025]"
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-100">{market.company}</div>
                      <div className="mt-1 font-mono text-[10px] text-slate-500">
                        {market.instrument.baseAsset}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-100">
                      {dollars(market.tokenPrice)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-300">
                      {dollars(market.markPrice)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono ${premium >= 0 ? "text-amber-300" : "text-emerald-300"}`}
                    >
                      {premium >= 0 ? "+" : ""}
                      {premium.toFixed(2)}%
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-300">
                      {dollars(market.impliedValuation, true)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-300">
                      {dollars(market.markValuation, true)}
                    </td>
                    <td className="px-4 py-3 font-mono text-[10px] text-slate-400">
                      {observedAt(market.fetchedAt)} UTC
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/private-markets/${encodeURIComponent(market.instrument.baseAsset)}`}
                        className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-100"
                      >
                        Inspect <ArrowUpRight size={12} />
                      </Link>
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
