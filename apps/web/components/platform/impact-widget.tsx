"use client";

import { useState } from "react";
import { type TradeImpact, platform, usd } from "../../lib/platform";
import { Note, Panel, buttonClass, inputClass } from "./ui";

/** "What would adding this position do to my portfolio?" before any order is placed. */
export function ImpactWidget({ assetKey, symbol }: { assetKey: string; symbol: string }) {
  const [amount, setAmount] = useState("1000");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [mode, setMode] = useState<"paper" | "live">("live");
  const [result, setResult] = useState<TradeImpact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const run = async () => {
    setWorking(true);
    setError(null);
    try {
      setResult(
        await platform<TradeImpact>("portfolio/impact", {
          body: { assetKey, side, notionalUsd: Number(amount), mode },
        }),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impact is unavailable.");
    } finally {
      setWorking(false);
    }
  };
  const impact = result?.impact;
  return (
    <Panel title="Portfolio impact">
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-[1fr_auto_auto] gap-2">
          <input
            aria-label="Amount in US dollars"
            className={inputClass}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
          />
          <select
            aria-label="Side"
            className={inputClass}
            value={side}
            onChange={(event) => setSide(event.target.value as "buy" | "sell")}
          >
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
          <select
            aria-label="Book"
            className={inputClass}
            value={mode}
            onChange={(event) => setMode(event.target.value as "paper" | "live")}
          >
            <option value="live">Live</option>
            <option value="paper">Paper</option>
          </select>
        </div>
        <button
          type="button"
          className={buttonClass}
          disabled={working || !(Number(amount) > 0)}
          onClick={run}
        >
          {working ? "Measuring…" : `Measure $${Number(amount || 0).toLocaleString()} of ${symbol}`}
        </button>
        {error && <Note tone="warning">{error}</Note>}
        {impact && result && (
          <div className="space-y-2 text-xs">
            <table className="w-full text-left">
              <thead className="text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="py-1 font-medium">Measure</th>
                  <th className="py-1 text-right font-medium">Now</th>
                  <th className="py-1 text-right font-medium">After</th>
                </tr>
              </thead>
              <tbody className="num text-slate-300">
                <tr>
                  <td>{symbol} weight</td>
                  <td className="text-right">{impact.before.weightPct.toFixed(1)}%</td>
                  <td className="text-right">{impact.after.weightPct.toFixed(1)}%</td>
                </tr>
                <tr>
                  <td>{result.asset.underlying} exposure</td>
                  <td className="text-right">{impact.before.underlyingWeightPct.toFixed(1)}%</td>
                  <td className="text-right">{impact.after.underlyingWeightPct.toFixed(1)}%</td>
                </tr>
                <tr>
                  <td>{result.sector.name}</td>
                  <td className="text-right">{result.sector.beforePct.toFixed(1)}%</td>
                  <td className="text-right">{result.sector.afterPct.toFixed(1)}%</td>
                </tr>
                <tr>
                  <td>Largest position</td>
                  <td className="text-right">{impact.before.largestWeightPct.toFixed(1)}%</td>
                  <td className="text-right">{impact.after.largestWeightPct.toFixed(1)}%</td>
                </tr>
                <tr>
                  <td>Cash</td>
                  <td className="text-right">{usd(impact.before.cashUsd)}</td>
                  <td className="text-right">{usd(impact.after.cashUsd)}</td>
                </tr>
              </tbody>
            </table>
            {impact.liquidityUsagePct != null && (
              <p className="text-slate-400">
                Uses {impact.liquidityUsagePct.toFixed(2)}% of pooled liquidity.
              </p>
            )}
            {impact.warnings.map((warning) => (
              <Note key={warning} tone={impact.blocked ? "error" : "warning"}>
                {warning}
              </Note>
            ))}
            {!impact.warnings.length && (
              <Note tone="positive">Within concentration, liquidity and cash limits.</Note>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
