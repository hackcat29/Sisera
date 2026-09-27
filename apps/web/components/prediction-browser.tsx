"use client";

import type { PredictionMarket } from "@sisera/domain";
import { Radio, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { PredictionTradeTicket } from "./prediction-trade-ticket";

const observedAt = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));

export function PredictionBrowser({ markets }: { markets: PredictionMarket[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [selectedId, setSelectedId] = useState(markets[0]?.id ?? "");
  const categories = useMemo(
    () => [...new Set(markets.map((market) => market.category ?? "Other"))].sort(),
    [markets],
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return markets.filter(
      (market) =>
        (category === "all" || (market.category ?? "Other") === category) &&
        `${market.title} ${market.category ?? ""}`.toLowerCase().includes(needle),
    );
  }, [markets, query, category]);
  const selected = visible.find((market) => market.id === selectedId) ?? visible[0];

  return (
    <section className="mt-4 grid gap-4 lg:grid-cols-[minmax(270px,.8fr)_minmax(0,1.2fr)]">
      <div className="overflow-hidden rounded-lg border border-line bg-panel">
        <div className="space-y-3 border-b border-line p-4">
          <h2 className="text-sm font-semibold text-white">Browse outcome markets</h2>
          <label className="flex items-center gap-2 rounded border border-line bg-ink px-3">
            <Search size={13} className="text-slate-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search markets"
              aria-label="Search prediction markets"
              className="h-9 w-full bg-transparent text-xs text-white outline-none placeholder:text-slate-500"
            />
          </label>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            aria-label="Filter prediction category"
            className="h-9 w-full rounded border border-line bg-ink px-2 text-xs text-slate-200"
          >
            <option value="all">All categories</option>
            {categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <p className="font-mono text-[10px] text-slate-500">
            {visible.length} of {markets.length} snapshots
          </p>
        </div>
        <div className="max-h-[650px] overflow-y-auto">
          {visible.map((market) => (
            <button
              key={market.id}
              type="button"
              onClick={() => setSelectedId(market.id)}
              className={`block w-full border-b border-line px-4 py-3 text-left hover:bg-white/[.04] ${selected?.id === market.id ? "bg-cyan-400/[.07]" : ""}`}
            >
              <p className="line-clamp-2 text-xs font-medium text-slate-100">{market.title}</p>
              <p className="mt-1 font-mono text-[10px] text-slate-500">
                {market.category ?? "Event"} · {observedAt(market.quality.receivedAt)} UTC
              </p>
            </button>
          ))}
          {!visible.length && (
            <p className="p-5 text-xs text-slate-400">No markets match this search.</p>
          )}
        </div>
      </div>
      {selected && (
        <article className="self-start rounded-lg border border-line bg-panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">
            <span className="flex items-center gap-2">
              <Radio size={12} className="text-emerald-300" />
              {selected.provider} snapshot
            </span>
            <span>
              {selected.underlyingProvider
                ? `${selected.underlyingProvider} liquidity`
                : "Liquidity source unavailable"}
            </span>
          </div>
          <h2 className="mt-4 text-xl font-semibold leading-7 text-white">{selected.title}</h2>
          <p className="mt-2 text-xs text-slate-400">
            Closes {selected.closesAt ? `${observedAt(selected.closesAt)} UTC` : "when resolved"}
          </p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {selected.outcomes.map((outcome) => (
              <div
                key={outcome.id}
                className="flex items-center justify-between rounded border border-line bg-ink p-3 text-xs"
              >
                <span className="text-slate-300">{outcome.label}</span>
                <span className="font-mono text-cyan-300">
                  {Number(outcome.probability).toFixed(4)} USDC
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-400">
            These observed prices are not independent outcome probabilities or firm execution
            quotes. Review spread, depth, and resolution terms before a paper order.
          </p>
          {selected.resolutionRules ? (
            <details className="mt-4 rounded border border-line p-3 text-xs text-slate-400">
              <summary className="cursor-pointer text-cyan-300">Resolution rules</summary>
              <p className="mt-2 max-h-52 overflow-y-auto whitespace-pre-line leading-5">
                {selected.resolutionRules}
              </p>
            </details>
          ) : (
            <p className="mt-4 text-xs text-amber-300">Resolution rules unavailable.</p>
          )}
          <p className="mt-4 font-mono text-[10px] text-slate-500">
            Fetched {observedAt(selected.quality.receivedAt)} UTC
          </p>
          {selected.resolutionRules &&
            selected.closesAt &&
            Date.parse(selected.closesAt) > Date.now() && (
              <div className="mt-4">
                <PredictionTradeTicket marketId={selected.id} />
              </div>
            )}
        </article>
      )}
    </section>
  );
}
