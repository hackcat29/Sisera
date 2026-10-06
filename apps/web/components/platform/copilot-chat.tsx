"use client";

import { SendHorizontal } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  type MarketEvent,
  type TradeImpact,
  type TradingPolicy,
  describeCondition,
  pct,
  platform,
  usd,
} from "../../lib/platform";
import { useSolanaSigner } from "../../lib/use-solana-signer";
import { EventRow } from "./event-feed";
import { PolicyList } from "./policy-list";
import { Note, buttonClass, ghostButtonClass, inputClass } from "./ui";

type Card = { type: string; title?: string; data: unknown };
type Reply = {
  intent: string;
  answer: string;
  cards: Card[];
  asset: { key: string; symbol: string; name: string } | null;
  provenance: { model: string; sources: string[] };
};
type Message = { role: "user" | "assistant"; content: string; reply?: Reply };

const EXAMPLES = [
  "Why is OpenAI trading above its mark?",
  "What changed in the last hour?",
  "Which tokenized stocks are trading furthest from fair value?",
  "Which of my positions are exposed to this news?",
  "What happens if I allocate $5,000 to NVDAx?",
  "Show me the strongest argument for and against buying Anthropic",
  "Which Clawpump agents are outperforming their paired stock?",
  "Buy $2,000 of OpenAI if the premium falls below 3%, liquidity remains above my threshold, and no high-severity negative event appears.",
  "Build me a thematic take on humanoid robotics and automation",
  "Create a thesis basket on the AI compute and power grid squeeze",
  "Thematic take: Private AI labs vs public semiconductor giants",
];

function RankingCard({ title, data }: { title: string; data: unknown }) {
  const rows = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : null;
  if (!rows) {
    const today = data as {
      gainers?: Array<Record<string, unknown>>;
      newLaunches?: Array<Record<string, unknown>>;
    };
    return (
      <div className="border border-line bg-ink p-3 text-xs text-slate-400">
        <p className="data-label mb-1 text-bronze-300">{title}</p>
        {today.gainers && (
          <p>
            Gainers:{" "}
            {today.gainers
              .slice(0, 6)
              .map((row) => `${row.symbol} ${pct(row.change24hPct as number)}`)
              .join(", ")}
          </p>
        )}
        {today.newLaunches && (
          <p className="mt-1">
            New launches:{" "}
            {today.newLaunches
              .slice(0, 6)
              .map((row) => row.symbol)
              .join(", ") || "none"}
          </p>
        )}
      </div>
    );
  }
  const columns = [
    "symbol",
    "premiumPct",
    "relativePerformancePct",
    "change24hPct",
    "liquidityUsd",
    "top10WalletPct",
    "riskScore",
  ].filter((column) => rows.some((row) => row[column] != null));
  return (
    <div className="overflow-x-auto border border-line bg-ink">
      <p className="data-label border-b border-line px-3 py-2 text-bronze-300">{title}</p>
      <table className="w-full min-w-[420px] text-left text-[11px]">
        <thead className="text-[10px] uppercase text-slate-500">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-3 py-1.5 font-medium">
                {column
                  .replace(/Pct$/, " %")
                  .replace(/Usd$/, " $")
                  .replace(/([A-Z])/g, " $1")
                  .toLowerCase()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="num text-slate-300">
          {rows.slice(0, 10).map((row) => (
            <tr key={String(row.mint ?? row.symbol)} className="border-t border-line/50">
              {columns.map((column) => (
                <td key={column} className="px-3 py-1.5">
                  {column === "symbol" ? (
                    row.mint &&
                    ("relativePerformancePct" in row ||
                      "top10WalletPct" in row ||
                      "risk" in row) ? (
                      <Link
                        className="text-bronze-200 hover:underline"
                        href={`/clawpump/${String(row.mint)}`}
                      >
                        {String(row.symbol)}
                      </Link>
                    ) : (
                      String(row.symbol)
                    )
                  ) : column.endsWith("Usd") ? (
                    usd(row[column] as number)
                  ) : column.endsWith("Pct") ? (
                    pct(row[column] as number)
                  ) : (
                    String(row[column] ?? "—")
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PolicyDraftCard({ data, onCreated }: { data: unknown; onCreated: () => void }) {
  const compiled = data as {
    policy: TradingPolicy | null;
    description?: string;
    validation?: string[];
    errors?: string[];
    evaluation?: {
      status: string;
      triggers: Array<{
        condition: { type: string } & Record<string, unknown>;
        passed: boolean;
        actual: string | null;
        detail: string;
      }>;
    } | null;
    impact?: TradeImpact | null;
    rewritten?: string | null;
  };
  const signer = useSolanaSigner();
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  if (!compiled.policy)
    return (
      <Note tone="warning">
        {(compiled.errors ?? ["The request could not be compiled."]).join(" ")}
      </Note>
    );
  const policy = compiled.policy;
  const save = async (activate: boolean) => {
    setState("saving");
    setError(null);
    try {
      await platform("policies", {
        body: { policy, activate, wallet: policy.action.mode === "live" ? signer.address : null },
      });
      setState("saved");
      onCreated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The policy could not be saved.");
      setState("idle");
    }
  };
  return (
    <div className="space-y-2 border border-bronze-500/40 bg-ink p-3 text-xs">
      <p className="data-label text-bronze-300">Compiled policy · deterministic</p>
      <p className="text-slate-200">{compiled.description}</p>
      {compiled.rewritten && (
        <p className="text-[11px] text-slate-500">Interpreted as: “{compiled.rewritten}”</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {(
          compiled.evaluation?.triggers ??
          policy.triggers.map((condition) => ({
            condition,
            passed: false,
            actual: null,
            detail: "",
          }))
        ).map((result) => (
          <span
            key={JSON.stringify(result.condition)}
            title={result.detail}
            className={`border px-1.5 py-0.5 font-mono text-[10px] ${result.passed ? "border-emerald-500/40 text-emerald-300" : "border-line text-slate-400"}`}
          >
            {describeCondition(result.condition)} {result.actual ? `(${result.actual})` : ""}
          </span>
        ))}
      </div>
      {compiled.validation?.map((item) => (
        <Note key={item} tone="warning">
          {item}
        </Note>
      ))}
      {compiled.impact?.impact.warnings.map((item) => (
        <Note key={item} tone={compiled.impact?.impact.blocked ? "error" : "warning"}>
          {item}
        </Note>
      ))}
      {error && <Note tone="error">{error}</Note>}
      {state === "saved" ? (
        <Note tone="positive">
          Saved. Sisera evaluates it every 30 seconds; nothing executes outside its conditions and
          your risk limits.
        </Note>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            className={buttonClass}
            disabled={
              state === "saving" ||
              Boolean(compiled.validation?.length) ||
              (policy.action.mode === "live" && !signer.address)
            }
            onClick={() => save(true)}
          >
            Activate policy
          </button>
          <button
            type="button"
            className={ghostButtonClass}
            disabled={state === "saving"}
            onClick={() => save(false)}
          >
            Save as draft
          </button>
        </div>
      )}
    </div>
  );
}

function CardView({ card, onPolicy }: { card: Card; onPolicy: () => void }) {
  switch (card.type) {
    case "policy_draft":
      return <PolicyDraftCard data={card.data} onCreated={onPolicy} />;
    case "ranking":
      return <RankingCard title={card.title ?? "Ranking"} data={card.data} />;
    case "changes": {
      const data = card.data as { events: MarketEvent[] };
      return (
        <ul className="border border-line bg-ink">
          {data.events.slice(0, 6).map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </ul>
      );
    }
    case "explanation": {
      const data = card.data as { candidates: MarketEvent[] };
      return data.candidates.length ? (
        <ul className="border border-line bg-ink">
          {data.candidates.slice(0, 4).map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </ul>
      ) : null;
    }
    case "arguments": {
      const data = card.data as { bull: string[]; bear: string[] };
      return (
        <div className="grid gap-2 md:grid-cols-2">
          <div className="border border-emerald-500/30 bg-ink p-3 text-xs text-slate-300">
            <p className="data-label mb-1 text-emerald-300">For</p>
            <ul className="list-inside list-disc space-y-1">
              {data.bull.slice(0, 5).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div className="border border-rose-500/30 bg-ink p-3 text-xs text-slate-300">
            <p className="data-label mb-1 text-rose-300">Against</p>
            <ul className="list-inside list-disc space-y-1">
              {data.bear.slice(0, 5).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      );
    }
    case "impact": {
      const data = card.data as TradeImpact;
      return (
        <div className="border border-line bg-ink p-3 text-xs text-slate-300">
          <p className="num">
            {data.asset.symbol}: {data.impact.before.weightPct.toFixed(1)}% →{" "}
            {data.impact.after.weightPct.toFixed(1)}% · {data.sector.name}:{" "}
            {data.sector.beforePct.toFixed(1)}% → {data.sector.afterPct.toFixed(1)}% · NAV{" "}
            {usd(data.navUsd)}
          </p>
        </div>
      );
    }
    case "backtest_result":
      return <BacktestResultCard data={card.data} />;
    case "take_card":
      return <TakeCard data={card.data} onArmed={onPolicy} />;
    case "basis_arbitrage":
      return <BasisArbitrageCard data={card.data} />;
    default:
      return null;
  }
}

function BacktestResultCard({ data }: { data: unknown }) {
  const result = data as {
    asset: { symbol: string; name: string };
    metrics: {
      sharpe: number;
      sortino: number;
      totalReturnPct: number;
      cagrPct: number;
      maxDrawdownPct: number;
      winRatePct: number;
    };
    gate: { outcome: string; summary: string };
    years: number;
    tradeCount: number;
  };
  if (!result || !result.metrics) return null;
  const isPassed = result.gate?.outcome === "passed";
  return (
    <div className="border border-line bg-ink p-4 space-y-3 text-xs">
      <div className="flex items-center justify-between border-b border-line pb-2">
        <div>
          <span className="font-mono font-bold text-slate-100 text-sm">{result.asset?.symbol}</span>
          <span className="text-slate-400 ml-2">
            Backtest Analysis ({result.years?.toFixed(1)}y)
          </span>
        </div>
        <span
          className={`font-mono text-[10px] font-bold px-2 py-0.5 border ${
            isPassed
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-amber-500/40 bg-amber-500/10 text-amber-300"
          }`}
        >
          GATE: {result.gate?.outcome?.toUpperCase()}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono">
        <div className="bg-surface p-2 border border-line/60">
          <p className="text-[10px] text-slate-400 uppercase">Sharpe</p>
          <p className="text-sm font-bold text-emerald-400">{result.metrics.sharpe.toFixed(2)}</p>
        </div>
        <div className="bg-surface p-2 border border-line/60">
          <p className="text-[10px] text-slate-400 uppercase">Return (CAGR)</p>
          <p className="text-sm font-bold text-slate-100">
            +{result.metrics.totalReturnPct.toFixed(1)}% ({result.metrics.cagrPct.toFixed(1)}%)
          </p>
        </div>
        <div className="bg-surface p-2 border border-line/60">
          <p className="text-[10px] text-slate-400 uppercase">Max Drawdown</p>
          <p className="text-sm font-bold text-rose-400">
            -{result.metrics.maxDrawdownPct.toFixed(1)}%
          </p>
        </div>
        <div className="bg-surface p-2 border border-line/60">
          <p className="text-[10px] text-slate-400 uppercase">Win Rate</p>
          <p className="text-sm font-bold text-slate-100">
            {result.metrics.winRatePct.toFixed(1)}% ({result.tradeCount} trades)
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between pt-1">
        <span className="text-slate-400 text-[11px]">{result.gate?.summary}</span>
        <a
          href="/agents"
          className="px-3 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 font-mono text-[10px] font-bold"
        >
          DEPLOY TO PAPER →
        </a>
      </div>
    </div>
  );
}

function TakeCard({ data, onArmed }: { data: unknown; onArmed: () => void }) {
  const take = data as {
    id: string;
    title: string;
    slug: string;
    thesis: string;
    macroTheme: string;
    targetTotalNotionalUsd: number;
    constituents: Array<{
      symbol: string;
      name: string;
      category: string;
      weightPct: number;
      targetNotionalUsd: number;
      entryTriggers: Array<{ type: string } & Record<string, unknown>>;
      invalidationRules: Array<{ type: string } & Record<string, unknown>>;
      rationale: string;
    }>;
    riskGuardrails: {
      maxDailyDrawdownPct: number;
      requireNoCriticalEvent: boolean;
      secFilingAware: boolean;
    };
    autopilot: boolean;
    stressScenarios: {
      equitySelloffPct: number;
      privateMarkResetPct: number;
      cryptoCrashPct: number;
      liquidityFreezePct: number;
      weekendGapPct: number;
    };
    metrics: {
      estimatedSharpe: number;
      estimatedVol30dPct: number;
      effectivePositions: number;
      diversificationScore: number;
    };
  };

  const signer = useSolanaSigner();
  const [state, setState] = useState<"idle" | "arming" | "armed" | "tokenizing" | "tokenized">(
    "idle",
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [tokenizedSpec, setTokenizedSpec] = useState<{
    tokenSymbol: string;
    tokenName: string;
    pairedStock: string;
  } | null>(null);

  if (!take || !take.constituents) return null;

  const armTake = async () => {
    setState("arming");
    setFeedback(null);
    try {
      const res = await platform<{ armedCount: number }>("takes/arm", {
        body: {
          take,
          mode: "paper",
          wallet: signer.address ?? null,
        },
      });
      setState("armed");
      setFeedback(
        `Armed ${res.armedCount} constituent policies under 24/7 Autopilot. SEC EDGAR and news guards active.`,
      );
      onArmed();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Failed to arm take policies.");
      setState("idle");
    }
  };

  const tokenizeTake = async () => {
    setState("tokenizing");
    setFeedback(null);
    try {
      const res = await platform<{ tokenSymbol: string; tokenName: string; pairedStock: string }>(
        "takes/tokenize",
        {
          body: { take },
        },
      );
      setTokenizedSpec(res);
      setState("tokenized");
      setFeedback(
        `Take tokenized spec created! Symbol ${res.tokenSymbol} anchored against ${res.pairedStock}.`,
      );
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Failed to tokenize take.");
      setState("idle");
    }
  };

  return (
    <div className="border border-bronze-500/40 bg-ink p-4 space-y-3.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-base font-bold text-slate-100">{take.title}</span>
            <span className="border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-300">
              ⚡ AUTOPILOT ACTIVE
            </span>
            <span className="border border-bronze-500/40 bg-bronze-500/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-bronze-300">
              DBC READY
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {take.macroTheme} · Target Capital: ${take.targetTotalNotionalUsd.toLocaleString()} ·
            SEC EDGAR 8-K Verified
          </p>
        </div>
        <div className="text-right font-mono">
          <span className="text-[10px] text-slate-400 uppercase">Est. Sharpe</span>
          <p className="text-sm font-bold text-emerald-400">
            {take.metrics.estimatedSharpe.toFixed(2)}
          </p>
        </div>
      </div>

      <div className="bg-surface/60 border border-line/60 p-2.5 text-slate-300 leading-relaxed italic text-[11px]">
        "{take.thesis}"
      </div>

      <div className="space-y-1.5">
        <p className="data-label text-bronze-300">Multi-Asset Allocation & Conditions</p>
        <div className="overflow-x-auto border border-line">
          <table className="w-full text-left text-[11px]">
            <thead className="border-b border-line bg-surface/40 text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-2.5 py-1.5 font-medium">Asset</th>
                <th className="px-2.5 py-1.5 font-medium">Category</th>
                <th className="px-2.5 py-1.5 font-medium">Weight</th>
                <th className="px-2.5 py-1.5 font-medium">Target $</th>
                <th className="px-2.5 py-1.5 font-medium">Autopilot Rules</th>
                <th className="px-2.5 py-1.5 font-medium">Thesis Rationale</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/40 font-mono text-slate-300">
              {take.constituents.map((c) => (
                <tr key={c.symbol} className="hover:bg-surface/30">
                  <td className="px-2.5 py-1.5 font-bold text-slate-100">{c.symbol}</td>
                  <td className="px-2.5 py-1.5 text-[10px]">
                    <span className="border border-line px-1 py-0.5 text-slate-400">
                      {c.category.replace(/_/g, " ").toUpperCase()}
                    </span>
                  </td>
                  <td className="px-2.5 py-1.5 font-bold text-bronze-300">{c.weightPct}%</td>
                  <td className="px-2.5 py-1.5">${c.targetNotionalUsd.toLocaleString()}</td>
                  <td className="px-2.5 py-1.5 text-[10px] font-sans text-slate-400">
                    {c.entryTriggers.length
                      ? c.entryTriggers.map((t) => describeCondition(t)).join(", ")
                      : "Sourced Entry"}
                  </td>
                  <td
                    className="px-2.5 py-1.5 text-[10px] font-sans text-slate-400 max-w-[200px] truncate"
                    title={c.rationale}
                  >
                    {c.rationale}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="data-label text-slate-400">
          Scenario Stress Test Matrix & Quantitative Bounds
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-center">
          <div className="bg-surface p-2 border border-line/60">
            <p className="text-[9px] text-slate-500 uppercase">Equity Selloff (-15%)</p>
            <p className="text-xs font-bold text-rose-400">
              {take.stressScenarios.equitySelloffPct}%
            </p>
          </div>
          <div className="bg-surface p-2 border border-line/60">
            <p className="text-[9px] text-slate-500 uppercase">Private Reset (-25%)</p>
            <p className="text-xs font-bold text-rose-400">
              {take.stressScenarios.privateMarkResetPct}%
            </p>
          </div>
          <div className="bg-surface p-2 border border-line/60">
            <p className="text-[9px] text-slate-500 uppercase">Crypto Crash (-20%)</p>
            <p className="text-xs font-bold text-rose-400">
              {take.stressScenarios.cryptoCrashPct}%
            </p>
          </div>
          <div className="bg-surface p-2 border border-line/60">
            <p className="text-[9px] text-slate-500 uppercase">Diversification</p>
            <p className="text-xs font-bold text-emerald-400">
              {take.metrics.diversificationScore}/100 ({take.metrics.effectivePositions} eff)
            </p>
          </div>
        </div>
      </div>

      {feedback && (
        <Note tone={state === "armed" || state === "tokenized" ? "positive" : "warning"}>
          {feedback}
        </Note>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-line/60">
        <div className="flex gap-2">
          {state !== "armed" && (
            <button
              type="button"
              className={buttonClass}
              disabled={state === "arming"}
              onClick={armTake}
            >
              {state === "arming" ? "Arming Autopilot..." : "⚡ Arm Take (Autopilot)"}
            </button>
          )}
          {state !== "tokenized" && (
            <button
              type="button"
              className={ghostButtonClass}
              disabled={state === "tokenizing"}
              onClick={tokenizeTake}
            >
              {state === "tokenizing" ? "Tokenizing..." : "🚀 Tokenize on Meteora DBC"}
            </button>
          )}
        </div>
        {tokenizedSpec && (
          <Link
            href={`/launch?symbol=${tokenizedSpec.tokenSymbol}&pair=${tokenizedSpec.pairedStock}`}
            className="text-[10px] text-bronze-300 underline font-mono hover:text-bronze-200"
          >
            Open in Launch Studio ({tokenizedSpec.tokenSymbol}) →
          </Link>
        )}
      </div>
    </div>
  );
}

function BasisArbitrageCard({ data }: { data: unknown }) {
  const payload = data as {
    opportunities: Array<{
      id: string;
      asset: string;
      spotVenue: string;
      perpVenue: string;
      spotPriceUsd: number;
      perpPriceUsd: number;
      basisSpreadBps: number;
      fundingRateAprPct: number;
      borrowCostAprPct: number;
      netYieldAprPct: number;
      liquidationBufferPct: number;
      recommendedLeverage: number;
      status: string;
    }>;
    recommended?: {
      asset: string;
      netYieldAprPct: number;
      spotVenue: string;
      perpVenue: string;
    };
    suggestedNotionalUsd: number;
  };

  const [armingAsset, setArmingAsset] = useState<string | null>(null);
  const [armedStatus, setArmedStatus] = useState<Record<string, string>>({});

  if (!payload || !payload.opportunities) return null;

  const handleArm = async (asset: string, notional: number) => {
    setArmingAsset(asset);
    try {
      const res = await fetch("/api/platform/arbitrage/arm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ asset, notionalUsd: notional, maxLeverage: 2 }),
      });
      if (res.ok) {
        setArmedStatus((prev) => ({ ...prev, [asset]: "Armed (POLICY_AUTO Level 3)" }));
      } else {
        setArmedStatus((prev) => ({ ...prev, [asset]: "Arming failed" }));
      }
    } catch {
      setArmedStatus((prev) => ({ ...prev, [asset]: "Arming error" }));
    } finally {
      setArmingAsset(null);
    }
  };

  return (
    <div className="space-y-3 border border-emerald-500/40 bg-surface/90 p-4 font-mono text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
        <div className="flex items-center gap-2">
          <span className="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 text-[10px] uppercase font-bold border border-emerald-500/30">
            Delta-Neutral Cash & Carry
          </span>
          <span className="text-slate-400 text-[11px]">Zero Directional Beta</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500">Suggested Capital:</span>
          <span className="text-emerald-300 font-bold">
            ${payload.suggestedNotionalUsd?.toLocaleString() ?? "10,000"}
          </span>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="data-label text-emerald-300">Live Cross-Venue Funding Rate Opportunities</p>
        <div className="overflow-x-auto border border-line">
          <table className="w-full text-left text-[11px]">
            <thead className="border-b border-line bg-surface/40 text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-2.5 py-1.5 font-medium">Asset</th>
                <th className="px-2.5 py-1.5 font-medium">Legs</th>
                <th className="px-2.5 py-1.5 font-medium">Perp Funding</th>
                <th className="px-2.5 py-1.5 font-medium">Borrow Cost</th>
                <th className="px-2.5 py-1.5 font-medium">Net APR</th>
                <th className="px-2.5 py-1.5 font-medium">Liq. Buffer</th>
                <th className="px-2.5 py-1.5 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/40 text-slate-300">
              {payload.opportunities.map((opp) => (
                <tr key={opp.id} className="hover:bg-surface/30">
                  <td className="px-2.5 py-1.5 font-bold text-slate-100">{opp.asset}</td>
                  <td className="px-2.5 py-1.5 text-[10px] text-slate-400">
                    +{opp.spotVenue} / -{opp.perpVenue}
                  </td>
                  <td className="px-2.5 py-1.5 text-emerald-400">
                    +{opp.fundingRateAprPct.toFixed(1)}%
                  </td>
                  <td className="px-2.5 py-1.5 text-rose-400">
                    -{opp.borrowCostAprPct.toFixed(1)}%
                  </td>
                  <td className="px-2.5 py-1.5 font-bold text-emerald-300">
                    +{opp.netYieldAprPct.toFixed(1)}%
                  </td>
                  <td className="px-2.5 py-1.5 text-slate-400">{opp.liquidationBufferPct}%</td>
                  <td className="px-2.5 py-1.5">
                    {armedStatus[opp.asset] ? (
                      <span className="text-[10px] text-emerald-400 font-bold">
                        {armedStatus[opp.asset]}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 text-[10px] font-bold"
                        disabled={armingAsset === opp.asset}
                        onClick={() => handleArm(opp.asset, payload.suggestedNotionalUsd || 10_000)}
                      >
                        {armingAsset === opp.asset ? "Deploying..." : "⚡ Deploy Harvester"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[10px] text-slate-500">
        Pre-trade risk engine continuously guards margin ratios across Hyperliquid and Solana
        liquidity pools.
      </p>
    </div>
  );
}

/** Sisera AI: evidence-backed answers and conversational policies that never trade on their own. */
export function CopilotChat({ initialAsset }: { initialAsset?: string | null }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextAsset, setContextAsset] = useState<string | null>(initialAsset ?? null);
  const [mode, setMode] = useState<"paper" | "live">("paper");
  const [threadId] = useState(() => crypto.randomUUID());
  const [policyRefresh, setPolicyRefresh] = useState(0);
  const end = useRef<HTMLDivElement>(null);
  const messageCount = messages.length;

  useEffect(() => {
    if (messageCount) end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messageCount]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || working) return;
    setWorking(true);
    setError(null);
    setInput("");
    const history = messages.map((item) => ({ role: item.role, content: item.content }));
    setMessages((current) => [...current, { role: "user", content: message }]);
    try {
      const reply = await platform<Reply>("copilot/chat", {
        body: { message, history, contextAssetKey: contextAsset, threadId, mode },
      });
      if (reply.asset) setContextAsset(reply.asset.key);
      setMessages((current) => [...current, { role: "assistant", content: reply.answer, reply }]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sisera AI is unavailable.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[1.35fr_.65fr]">
      <section className="flex min-h-[640px] flex-col border border-line bg-panel">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-xs text-slate-400">
          <span>
            Context:{" "}
            {contextAsset ? <span className="text-bronze-200">{contextAsset}</span> : "none"}
          </span>
          {contextAsset && (
            <button
              type="button"
              className="text-slate-500 hover:text-bone"
              onClick={() => setContextAsset(null)}
            >
              clear
            </button>
          )}
          <label className="ml-auto flex items-center gap-2">
            Orders
            <select
              className="h-7 border border-line bg-ink px-2 text-xs"
              value={mode}
              onChange={(event) => setMode(event.target.value as "paper" | "live")}
            >
              <option value="paper">Paper</option>
              <option value="live">Live</option>
            </select>
          </label>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div>
              <p className="text-sm text-slate-300">
                Ask about any stock, private company, agent token or your portfolio. Conditional
                trades become policies you review before anything is armed.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => send(example)}
                    className="border border-line px-2.5 py-1.5 text-left text-[11px] text-slate-300 hover:border-bronze-400 hover:text-bone"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={message.role === "user" ? "ml-auto max-w-[85%]" : "max-w-full"}
            >
              <div
                className={`whitespace-pre-line border p-3 text-[13px] leading-6 ${message.role === "user" ? "border-bronze-500/40 bg-bronze-500/10 text-bone" : "border-line bg-ink text-slate-200"}`}
              >
                {message.content}
              </div>
              {message.reply && (
                <div className="mt-2 space-y-2">
                  {message.reply.cards.map((card, cardIndex) => (
                    <CardView
                      key={`${card.type}-${cardIndex}`}
                      card={card}
                      onPolicy={() => setPolicyRefresh((value) => value + 1)}
                    />
                  ))}
                  <p className="font-mono text-[10px] text-slate-600">
                    {message.reply.intent.replace("_", " ")} · {message.reply.provenance.model} ·{" "}
                    {message.reply.provenance.sources.join(", ")}
                  </p>
                </div>
              )}
            </div>
          ))}
          {working && <p className="animate-pulse text-xs text-slate-500">Gathering evidence…</p>}
          {error && <Note tone="error">{error}</Note>}
          <div ref={end} />
        </div>
        <form
          className="flex gap-2 border-t border-line p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send(input);
          }}
        >
          <input
            className={inputClass}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask Sisera AI…"
            aria-label="Message Sisera AI"
            maxLength={2000}
          />
          <button
            type="submit"
            className={buttonClass}
            disabled={working || !input.trim()}
            aria-label="Send"
          >
            <SendHorizontal size={14} />
          </button>
        </form>
      </section>
      <div className="space-y-4">
        <PolicyList refreshKey={policyRefresh} />
        <Note>
          Sisera AI reads market data, events, and your portfolio. It cannot sign or place orders.
          Policies are compiled deterministically, validated against your limits, and executed only
          through Sisera’s risk checks — live orders still need your wallet signature unless you
          delegated signing.
        </Note>
      </div>
    </div>
  );
}
