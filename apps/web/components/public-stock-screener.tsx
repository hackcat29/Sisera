"use client";

import { ArrowUpRight, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { PublicStock, PythReference } from "../lib/api";

type SortKey = "name" | "price" | "change" | "volume" | "liquidity";
const money = (value: number | null) =>
  value == null
    ? "—"
    : `$${Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)}`;

export function PublicStockScreener({ stocks }: { stocks: PublicStock[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("volume");
  const [availableOnly, setAvailableOnly] = useState(true);
  const [references, setReferences] = useState<PythReference[]>([]);
  const [referenceState, setReferenceState] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );
  useEffect(() => {
    const symbols = stocks
      .filter((stock) => stock.dexPriceUsd != null)
      .slice(0, 20)
      .map((stock) => stock.underlyingSymbol);
    if (!symbols.length) {
      setReferenceState("unavailable");
      return;
    }
    let cancelled = false;
    fetch(`/api/stock-references?symbols=${encodeURIComponent(symbols.join(","))}`)
      .then((response) => {
        if (!response.ok) throw new Error("Reference feed unavailable");
        return response.json() as Promise<{ data: PythReference[] }>;
      })
      .then((payload) => {
        if (!cancelled) {
          setReferences(payload.data);
          setReferenceState("ready");
        }
      })
      .catch(() => {
        if (!cancelled) setReferenceState("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [stocks]);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return stocks
      .filter((stock) => !availableOnly || stock.dexPriceUsd != null)
      .filter((stock) =>
        `${stock.name} ${stock.symbol} ${stock.underlyingSymbol}`.toLowerCase().includes(needle),
      )
      .sort((a, b) => {
        if (sort === "name") return a.name.localeCompare(b.name);
        const value = (stock: PublicStock) => {
          if (sort === "price") return Number(stock.dexPriceUsd ?? stock.priceUsd);
          if (sort === "change") return stock.change24hPct;
          if (sort === "liquidity") return stock.liquidityUsd;
          return stock.volume24hUsd;
        };
        const left = value(a);
        const right = value(b);
        if ((left == null || !Number.isFinite(left)) && (right == null || !Number.isFinite(right)))
          return a.name.localeCompare(b.name);
        if (left == null || !Number.isFinite(left)) return 1;
        if (right == null || !Number.isFinite(right)) return -1;
        return right - left;
      });
  }, [stocks, query, sort, availableOnly]);

  return (
    <section className="m-4 overflow-hidden rounded-lg border border-line bg-panel md:m-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-white">Public stock screener</h2>
          <p className="mt-1 text-xs text-slate-400">
            {rows.length} shown · {stocks.length} listed · prices are observed Solana market quotes
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded border border-line bg-ink px-3">
            <Search size={13} className="text-slate-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Company or symbol"
              aria-label="Search public stocks"
              className="h-9 w-40 bg-transparent text-xs text-white outline-none placeholder:text-slate-500"
            />
          </label>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            aria-label="Sort public stocks"
            className="h-9 rounded border border-line bg-ink px-2 text-xs text-slate-200"
          >
            <option value="volume">Volume</option>
            <option value="liquidity">Liquidity</option>
            <option value="change">24h change</option>
            <option value="price">Price</option>
            <option value="name">Company</option>
          </select>
          <label className="flex h-9 items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={availableOnly}
              onChange={(event) => setAvailableOnly(event.target.checked)}
            />
            Priced only
          </label>
        </div>
      </div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-left text-xs">
            <thead className="border-b border-line bg-[#111d26] text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Company</th>
                <th className="px-5 py-3 font-medium">Token</th>
                <th className="px-5 py-3 text-right font-medium">Solana price</th>
                <th className="px-5 py-3 text-right font-medium">Pyth reference</th>
                <th className="px-5 py-3 text-right font-medium">Premium</th>
                <th className="px-5 py-3 text-right font-medium">24h</th>
                <th className="px-5 py-3 text-right font-medium">Volume</th>
                <th className="px-5 py-3 text-right font-medium">Liquidity</th>
                <th className="px-5 py-3 text-right font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((stock) => {
                const reference = references.find(
                  (item) =>
                    item.symbol.toUpperCase() ===
                    `EQUITY.US.${stock.underlyingSymbol.toUpperCase()}/USD`,
                );
                const referencePrice = reference ? Number(reference.price) : null;
                const premium =
                  referencePrice && referencePrice > 0 && stock.dexPriceUsd
                    ? (Number(stock.dexPriceUsd) / referencePrice - 1) * 100
                    : null;
                return (
                  <tr
                    key={stock.mint}
                    className="border-b border-line/60 last:border-0 hover:bg-white/[.025]"
                  >
                    <td className="px-5 py-3 font-semibold text-slate-100">{stock.name}</td>
                    <td className="px-5 py-3 font-mono text-slate-400">{stock.symbol}</td>
                    <td className="px-5 py-3 text-right font-mono text-slate-100">
                      {stock.dexPriceUsd ? `$${Number(stock.dexPriceUsd).toFixed(2)}` : "—"}
                    </td>
                    <td
                      className="px-5 py-3 text-right font-mono text-slate-300"
                      title={
                        reference
                          ? `${reference.referenceFreshness.replace("_", " ")} · generated ${new Date(reference.feedUpdateTimestamp).toLocaleString()}`
                          : undefined
                      }
                    >
                      {referencePrice ? `$${referencePrice.toFixed(2)}` : "—"}
                    </td>
                    <td
                      className={`px-5 py-3 text-right font-mono ${premium == null ? "text-slate-500" : premium >= 0 ? "text-amber-300" : "text-emerald-300"}`}
                    >
                      {premium == null
                        ? "—"
                        : `${premium > 0 ? "+" : ""}${premium.toFixed(2)}%${reference?.referenceFreshness === "live" ? "" : "*"}`}
                    </td>
                    <td
                      className={`px-5 py-3 text-right font-mono ${stock.change24hPct == null ? "text-slate-500" : stock.change24hPct >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                    >
                      {stock.change24hPct == null
                        ? "—"
                        : `${stock.change24hPct > 0 ? "+" : ""}${stock.change24hPct.toFixed(2)}%`}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-slate-300">
                      {money(stock.volume24hUsd)}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-slate-300">
                      {money(stock.liquidityUsd)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/stocks/${encodeURIComponent(stock.symbol)}`}
                        className="text-cyan-300 hover:text-white"
                      >
                        Inspect <ArrowUpRight size={12} className="inline" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="p-8 text-center text-sm text-slate-400">No stocks match these filters.</p>
      )}
      <p className="border-t border-line px-5 py-3 text-[11px] text-slate-500">
        {referenceState === "loading"
          ? "Loading Pyth references. "
          : referenceState === "unavailable"
            ? "Pyth references unavailable. "
            : "* Reference was carried forward or is stale. "}
        Unpriced tokens remain listed when “Priced only” is off. Reference differences are
        indicative and are not firm execution spreads.
      </p>
    </section>
  );
}
