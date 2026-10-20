"use client";

import { useId, useState } from "react";
import type { MarketIntelligence } from "../lib/api";
import { PerpPositions } from "./perp-positions";

const tabs = ["Positions & orders", "Signals"] as const;

export function TerminalDetails({
  intelligence,
  coin,
}: { intelligence: MarketIntelligence | null; coin: string }) {
  const [active, setActive] = useState<(typeof tabs)[number]>("Positions & orders");
  const id = useId();

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-5">
        <div className="flex gap-6" role="tablist" aria-label="Terminal details">
          {tabs.map((tab, index) => (
            <button
              key={tab}
              id={`${id}-tab-${index}`}
              type="button"
              role="tab"
              aria-selected={active === tab}
              aria-controls={`${id}-panel`}
              tabIndex={active === tab ? 0 : -1}
              onClick={() => setActive(tab)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const next =
                  (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
                setActive(tabs[next] ?? tabs[0]);
                document.getElementById(`${id}-tab-${next}`)?.focus();
              }}
              className={`relative h-12 whitespace-nowrap text-sm transition-colors ${active === tab ? "font-medium text-slate-100 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-bronze-300" : "text-slate-500 hover:text-slate-200"}`}
            >
              {tab}
            </button>
          ))}
        </div>
        <span className="hidden font-mono text-[10px] uppercase tracking-wide text-slate-500 sm:block">
          {active === "Signals" ? "Derived from verified candles" : "Your Hyperliquid account"}
        </span>
      </div>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${tabs.indexOf(active)}`}
        className="min-h-44 p-5"
      >
        {active === "Signals" ? (
          intelligence ? (
            <div className="grid gap-4 md:grid-cols-[180px_repeat(4,minmax(0,1fr))]">
              <div className="border-r border-line pr-5">
                <p className="data-label">Composite score</p>
                <p className="mt-2 font-mono text-3xl font-medium text-slate-100">
                  {intelligence.score.toFixed(1)}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  {intelligence.regime.replace("_", " ")} ·{" "}
                  {(intelligence.confidence * 100).toFixed(0)}% confidence
                </p>
              </div>
              {intelligence.signals.map((signal) => (
                <div key={signal.id} className="border-r border-line pr-4 last:border-r-0">
                  <p className="data-label">{signal.label}</p>
                  <div className="mt-3 flex items-baseline justify-between gap-2">
                    <span className="font-mono text-lg text-slate-100">
                      {signal.value.toFixed(2)}
                    </span>
                    <span
                      className={
                        signal.direction === "bullish"
                          ? "text-xs text-emerald-300"
                          : signal.direction === "bearish"
                            ? "text-xs text-rose-300"
                            : "text-xs text-slate-400"
                      }
                    >
                      {signal.direction}
                    </span>
                  </div>
                  <div className="mt-4 h-1 rounded-full bg-slate-700/60">
                    <div
                      className={`h-full rounded-full ${signal.score >= 0 ? "bg-[var(--up)]" : "bg-[var(--down)]"}`}
                      style={{ width: `${Math.min(Math.abs(signal.score), 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="grid h-32 place-items-center text-sm text-slate-400">
              Signals appear when verified candle data is available.
            </p>
          )
        ) : (
          <PerpPositions activeCoin={coin} />
        )}
      </div>
    </section>
  );
}
