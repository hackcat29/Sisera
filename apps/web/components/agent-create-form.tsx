"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AgentTemplate } from "../lib/api";
import { type RuleCondition, RuleList } from "./platform/rule-builder";

/** Builds a custom agent policy, optionally starting from a template the user then edits. */
export function AgentCreateForm({
  enabled,
  template,
}: {
  enabled: boolean;
  template?: AgentTemplate | null;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [entry, setEntry] = useState<RuleCondition[]>(
    (template?.rules?.entry as RuleCondition[] | undefined) ?? [],
  );
  const [exit, setExit] = useState<RuleCondition[]>(
    (template?.rules?.exit as RuleCondition[] | undefined) ?? [],
  );
  async function submit(formData: FormData) {
    setWorking(true);
    setMessage(null);
    const body = {
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
      universe: String(formData.get("universe") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      timeframe: String(formData.get("timeframe") ?? "1h"),
      factors: String(formData.get("factors") ?? "")
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean),
      capitalLimitUsd: Number(formData.get("capitalLimitUsd")),
      maxTradeNotionalUsd: Number(formData.get("maxTradeNotionalUsd")),
      maxDailyDrawdownPct: Number(formData.get("maxDailyDrawdownPct")),
      maxOpenPositions: Number(formData.get("maxOpenPositions")),
      stopLossPct: Number(formData.get("stopLossPct")),
      takeProfitPct: Number(formData.get("takeProfitPct")),
      maxSlippageBps: Number(formData.get("maxSlippageBps")),
      ...(entry.length ? { rules: { entry, exit } } : {}),
      ...(String(formData.get("liveWallet") ?? "").trim()
        ? { liveWallet: String(formData.get("liveWallet")).trim() }
        : {}),
    };
    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Could not save the agent.");
      setMessage(
        "Strategy saved. Open it to run the backtest and move it through the evaluation stages.",
      );
      if (payload.data?.id) router.push(`/agents/${encodeURIComponent(payload.data.id)}`);
      else router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the agent.");
    } finally {
      setWorking(false);
    }
  }
  return (
    <form
      id="builder"
      action={submit}
      className="scroll-mt-20 space-y-3 border border-line bg-panel p-5"
    >
      <h2 className="text-sm font-semibold text-bone">
        {template ? `Customize ${template.name}` : "Build your strategy"}
      </h2>

      <input
        name="name"
        required
        minLength={3}
        maxLength={80}
        defaultValue={template ? `${template.name} (my copy)` : undefined}
        placeholder="Strategy name"
        className="w-full rounded border border-line bg-ink p-2 text-xs"
      />
      <textarea
        name="description"
        required
        minLength={20}
        maxLength={1000}
        defaultValue={template?.description}
        placeholder="Entry, exit and abstain rules"
        className="min-h-24 w-full rounded border border-line bg-ink p-2 text-xs"
      />
      <input
        name="universe"
        required
        defaultValue={template?.universe.join(", ")}
        placeholder="AAPLx, NVDAx or BTCUSDT, ETHUSDT"
        className="w-full rounded border border-line bg-ink p-2 text-xs"
      />
      <textarea
        name="factors"
        required
        defaultValue={
          template ? template.factors.join("\n") : "EMA 12/26 crossover\nRelative volume above 1.2"
        }
        placeholder="One measurable factor per line"
        className="min-h-20 w-full rounded border border-line bg-ink p-2 text-xs"
      />
      <div className="space-y-3 border border-line p-3">
        <RuleList title="Entry — all must pass" conditions={entry} onChange={setEntry} />
        <RuleList title="Exit — any closes" conditions={exit} onChange={setExit} />
      </div>
      <input
        name="liveWallet"
        placeholder="Solana wallet for live stages (optional)"
        pattern="[1-9A-HJ-NP-Za-km-z]{32,44}"
        className="w-full rounded border border-line bg-ink p-2 text-xs"
      />
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-slate-400">
          Timeframe
          <select
            name="timeframe"
            defaultValue={template?.timeframe ?? "1h"}
            className="mt-1 w-full rounded border border-line bg-ink p-2 text-slate-100"
          >
            <option>1h</option>
            <option>5m</option>
            <option>15m</option>
            <option>4h</option>
            <option>1d</option>
            <option>event</option>
          </select>
        </label>
        <label className="text-xs text-slate-400">
          Capital cap · USD
          <input
            name="capitalLimitUsd"
            type="number"
            min="1"
            max="1000000"
            defaultValue="10000"
            required
            className="mt-1 w-full rounded border border-line bg-ink p-2 text-slate-100"
          />
        </label>
        <label className="text-xs text-slate-400">
          Trade cap · USD
          <input
            name="maxTradeNotionalUsd"
            type="number"
            min="1"
            max="100000"
            defaultValue="1000"
            required
            className="mt-1 w-full rounded border border-line bg-ink p-2 text-slate-100"
          />
        </label>
        <label className="text-xs text-slate-400">
          Daily drawdown · %
          <input
            name="maxDailyDrawdownPct"
            type="number"
            min="0.1"
            max="10"
            step="0.1"
            defaultValue="3"
            required
            className="mt-1 w-full rounded border border-line bg-ink p-2 text-slate-100"
          />
        </label>
        {[
          ["maxOpenPositions", "Maximum open positions", "2", "1", "20", "1"],
          ["stopLossPct", "Stop loss · %", "1.5", "0.1", "30", "0.1"],
          ["takeProfitPct", "Take profit · %", "4", "0.1", "100", "0.1"],
          ["maxSlippageBps", "Maximum slippage · bps", "25", "0", "500", "0.1"],
        ].map(([name, label, defaultValue, min, max, step]) => (
          <label key={name} className="text-xs text-slate-400">
            {label}
            <input
              name={name}
              type="number"
              min={min}
              max={max}
              step={step}
              defaultValue={defaultValue}
              required
              className="mt-1 w-full rounded border border-line bg-ink p-2 text-slate-100"
            />
          </label>
        ))}
      </div>
      <button
        type="submit"
        disabled={!enabled || working}
        className="rounded bg-bronze-300 px-4 py-2 text-xs font-semibold text-ink disabled:opacity-40"
      >
        {working ? "Saving…" : template ? "Save my copy" : "Save strategy"}
      </button>
      {!enabled && (
        <p className="text-xs text-amber-300">
          Sign in and connect the agent database to save custom agents.
        </p>
      )}
      {message && <output className="text-xs text-slate-300">{message}</output>}
    </form>
  );
}
