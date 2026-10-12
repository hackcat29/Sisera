"use client";

import { useEffect, useState } from "react";
import { platform, usd } from "../../lib/platform";
import { Loading, Note, Panel, buttonClass, inputClass } from "./ui";
import { usePortfolio } from "./unified-portfolio";

const FIELDS = [
  ["maxGrossExposureUsd", "Max gross exposure ($)", "gross"],
  ["maxPositionWeightPct", "Max single position (% NAV)", "position"],
  ["maxUnderlyingWeightPct", "Max economic exposure (% NAV)", "underlying"],
  ["maxDailyLossUsd", "Max daily loss ($)", "daily_loss"],
  ["maxAgentTokenWeightPct", "Max agent tokens (% NAV)", "agent_tokens"],
  ["maxIlliquidExitPct", "Max exit size (% of pool)", "liquidity"],
] as const;

type Preferences = { liquidityThresholdUsd: number; mandate: Record<string, number> };

/** Mandate utilization from the reconciled book, plus the limits every order is checked against. */
export function MandatePanel() {
  const [mode, setMode] = useState<"paper" | "live">("live");
  const { view, error, reload } = usePortfolio(mode);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    platform<Preferences>("risk/preferences")
      .then((value) => {
        setPreferences(value);
        setDraft({
          liquidityThresholdUsd: String(value.liquidityThresholdUsd),
          ...Object.fromEntries(
            Object.entries(value.mandate).map(([key, amount]) => [key, String(amount)]),
          ),
        });
      })
      .catch(() => setPreferences({ liquidityThresholdUsd: 250_000, mandate: {} }));
  }, []);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const mandate = Object.fromEntries(
        FIELDS.map(([key]) => [key, Number(draft[key])]).filter(
          ([, value]) => Number.isFinite(value as number) && (value as number) > 0,
        ),
      );
      const saved = await platform<Preferences>("risk/preferences", {
        method: "PUT",
        body: { liquidityThresholdUsd: Number(draft.liquidityThresholdUsd ?? 250_000), mandate },
      });
      setPreferences(saved);
      setMessage("Limits saved. They apply to policies, agents and impact checks immediately.");
      reload();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Limits could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4 p-4 md:px-6 xl:grid-cols-[1.2fr_.8fr]">
      <Panel
        title="Mandate utilization"
        actions={
          <div className="flex border border-line">
            {(["live", "paper"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={`px-3 py-1 text-xs capitalize ${mode === value ? "bg-bronze-300 text-ink" : "text-slate-300"}`}
              >
                {value}
              </button>
            ))}
          </div>
        }
      >
        {error && (
          <div className="p-3">
            <Note tone="warning">{error}</Note>
          </div>
        )}
        {!view && !error && <Loading />}
        {view && (
          <ul className="space-y-3 p-4">
            {view.mandate.map((row) => (
              <li key={row.id} className="text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-200">{row.label}</span>
                  <span
                    className={`num ${row.status === "breach" ? "text-rose-300" : row.status === "warning" ? "text-amber-200" : "text-slate-400"}`}
                  >
                    {row.utilizationPct.toFixed(0)}% used
                  </span>
                </div>
                <div className="mt-1 h-1.5 bg-slate-800">
                  <div
                    className={`h-full ${row.status === "breach" ? "bg-rose-400" : row.status === "warning" ? "bg-amber-300" : "bg-verdigris-400"}`}
                    style={{ width: `${Math.min(100, row.utilizationPct)}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-500">{row.detail}</p>
              </li>
            ))}
          </ul>
        )}
        {view && (
          <div className="border-t border-line p-4">
            <p className="data-label mb-2 text-slate-500">Stress results on the current book</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {view.scenarios.map((scenario) => (
                <div key={scenario.id} className="border border-line bg-ink p-2.5 text-xs">
                  <p className="text-slate-300">{scenario.name}</p>
                  <p
                    className={`num mt-1 ${scenario.pnlUsd < 0 ? "text-rose-300" : "text-slate-400"}`}
                  >
                    {usd(scenario.pnlUsd)} · NAV {usd(scenario.navAfterUsd)}
                  </p>
                  {scenario.byPosition[0] && (
                    <p className="mt-1 text-[10px] text-slate-500">
                      Worst: {scenario.byPosition[0].symbol} {usd(scenario.byPosition[0].pnlUsd)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>
      <Panel title="Your limits">
        {!preferences ? (
          <Loading />
        ) : (
          <form
            className="space-y-3 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label className="block text-xs text-slate-300">
              Liquidity threshold ($) — used when a policy says “above my threshold”
              <input
                className={`${inputClass} mt-1`}
                inputMode="decimal"
                value={draft.liquidityThresholdUsd ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, liquidityThresholdUsd: event.target.value })
                }
              />
            </label>
            {FIELDS.map(([key, label, row]) => (
              <label key={key} className="block text-xs text-slate-300">
                {label}
                <input
                  className={`${inputClass} mt-1`}
                  inputMode="decimal"
                  placeholder={String(view?.mandate.find((item) => item.id === row)?.limit ?? "")}
                  value={draft[key] ?? ""}
                  onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                />
              </label>
            ))}
            <button type="submit" className={buttonClass} disabled={saving}>
              {saving ? "Saving…" : "Save limits"}
            </button>
            {message && <Note>{message}</Note>}
          </form>
        )}
      </Panel>
    </div>
  );
}
