"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ago, describeCondition, pct, platform, usd } from "../../lib/platform";
import { useSolanaSigner } from "../../lib/use-solana-signer";
import {
  Loading,
  Note,
  Panel,
  StageTrack,
  Stat,
  buttonClass,
  dangerButtonClass,
  ghostButtonClass,
} from "./ui";

type Evaluation = {
  id: string;
  manifestVersion: string;
  stage: string;
  outcome: "passed" | "failed" | "inconclusive";
  evidence: Record<string, unknown>;
  dataWindowStart: string;
  dataWindowEnd: string;
  reviewerSubject: string;
  recordedAt: string;
};
type Order = {
  id: string;
  mode: string;
  side: string;
  symbol: string;
  notionalUsd: number;
  status: string;
  arrivalPriceUsd: number | null;
  fillPriceUsd: number | null;
  createdAt: string;
  expiresAt: string | null;
  detail: Record<string, unknown>;
};
type Detail = {
  manifest: { id: string; version: string; name: string; manifestHash: string; createdAt: string };
  policy: {
    description?: string;
    universe: string[];
    timeframe: string;
    capitalAllocation: { maxCapitalUsd: number; maxTradeNotionalUsd: number };
    riskGuardrails: {
      maxDailyDrawdownPct: number;
      maxOpenPositions: number;
      stopLossPct: number;
      takeProfitPct: number;
    };
    execution: { maxSlippageBps: number; liveWallet?: string };
    rules?: {
      entry: Array<{ type: string } & Record<string, unknown>>;
      exit: Array<{ type: string } & Record<string, unknown>>;
    };
  };
  stage: string;
  autonomy: string;
  runningVersion: string;
  canEdit: boolean;
  canReview: boolean;
  versions: Array<{ version: string; manifestHash: string; createdAt: string }>;
  history: Array<{
    stage: string;
    autonomy: string;
    reason: string;
    actorSubject: string;
    createdAt: string;
    manifestVersion: string;
  }>;
  evaluations: Evaluation[];
  runtime: {
    stage: string;
    cashUsd: number;
    startingEquityUsd: number;
    maxDrawdownPct: number;
    positions: Record<
      string,
      { symbol: string; quantity: number; entryPrice: number; openedAt: string }
    >;
    lastTickAt: string | null;
    lastError: string | null;
  } | null;
  decisions: Array<{
    id: string;
    stage: string;
    symbol: string;
    action: string;
    disposition: string;
    reasons: string[];
    createdAt: string;
    marketState: { equityUsd?: number };
  }>;
  orders: Order[];
  fills: Array<{
    id: string;
    side: string;
    symbol: string;
    quantity: number;
    priceUsd: number;
    slippageBps: number | null;
    occurredAt: string;
    mode: string;
  }>;
  promotion: { next: string; allowed: boolean; reason: string } | null;
  liveExecution: string;
};

const AUTONOMY = [
  ["research", "Research — observe only"],
  ["suggest", "Suggest — recommendations"],
  ["confirm", "Confirm — you approve each order"],
  ["policy_auto", "Policy auto — executes within rules"],
  ["autonomous", "Autonomous — within risk limits"],
  ["risk_only", "Risk only — may only reduce exposure"],
] as const;

function Sparkline({ points }: { points: Array<{ time: number; equity: number }> }) {
  if (points.length < 2) return null;
  const values = points.map((point) => point.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const path = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${((index / (points.length - 1)) * 300).toFixed(1)},${(60 - ((point.equity - min) / Math.max(max - min, 1e-9)) * 56 - 2).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg viewBox="0 0 300 60" className="h-16 w-full" role="img" aria-label="Backtest equity curve">
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-bronze-300"
      />
    </svg>
  );
}

function EvidenceView({ evaluation }: { evaluation: Evaluation }) {
  const evidence = evaluation.evidence as {
    perSymbol?: Array<{
      entry: string;
      basis?: string;
      years?: number;
      metrics?: Record<string, number>;
      gate?: { checks: Array<{ name: string; passed: boolean; detail: string }> };
      results?: Array<{
        id: string;
        name: string;
        maxDrawdownPct: number;
        survived: boolean;
        stopRespected: boolean;
      }>;
      equityCurve?: Array<{ time: number; equity: number }>;
      error?: string;
      untestedConditions?: string[];
    }>;
    stats?: Record<string, number | null>;
    gate?: { checks: Array<{ name: string; passed: boolean; detail: string }> };
  };
  return (
    <div className="space-y-3">
      {evidence.perSymbol?.map((row) => (
        <div key={row.entry} className="border border-line bg-ink p-3 text-xs">
          <p className="font-semibold text-bone">
            {row.entry}{" "}
            {row.basis && <span className="font-normal text-slate-500">· {row.basis}</span>}
          </p>
          {row.error && <p className="mt-1 text-amber-200">{row.error}</p>}
          {row.metrics && (
            <p className="num mt-1 text-slate-300">
              {row.years?.toFixed(1)}y · Sharpe {row.metrics.sharpe?.toFixed(2)} · max DD{" "}
              {row.metrics.maxDrawdownPct?.toFixed(1)}% · return {pct(row.metrics.totalReturnPct)} ·{" "}
              {row.metrics.tradeCount} trades · win {row.metrics.winRatePct?.toFixed(0)}%
            </p>
          )}
          {row.equityCurve && <Sparkline points={row.equityCurve} />}
          {row.results && (
            <ul className="mt-1 space-y-0.5">
              {row.results.map((result) => (
                <li
                  key={result.id}
                  className={
                    result.survived && result.stopRespected ? "text-slate-300" : "text-rose-300"
                  }
                >
                  {result.name}: max DD {result.maxDrawdownPct.toFixed(1)}%{" "}
                  {result.survived ? "survived" : "breached"}
                </li>
              ))}
            </ul>
          )}
          {row.gate && (
            <ul className="mt-2 space-y-0.5">
              {row.gate.checks.map((check) => (
                <li
                  key={check.name}
                  className={check.passed ? "text-emerald-300" : "text-rose-300"}
                >
                  {check.passed ? "✓" : "✗"} {check.name}:{" "}
                  <span className="text-slate-400">{check.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {evidence.gate && (
        <ul className="space-y-0.5 text-xs">
          {evidence.gate.checks.map((check) => (
            <li key={check.name} className={check.passed ? "text-emerald-300" : "text-rose-300"}>
              {check.passed ? "✓" : "✗"} {check.name}:{" "}
              <span className="text-slate-400">{check.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AgentProposals({ orders, onChange }: { orders: Order[]; onChange: () => void }) {
  const signer = useSolanaSigner();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = async (order: Order, action: "approve" | "reject") => {
    setBusy(order.id);
    setError(null);
    try {
      const result = await platform<{
        status: string;
        prepared?: { orderId: string; transaction: string };
      }>(`agent-orders/${order.id}/${action}`, { body: {} });
      if (action === "approve" && result.prepared) {
        const [signedTransaction] = await signer.signAll([result.prepared.transaction]);
        await platform(`agent-orders/${order.id}/execute`, {
          body: { swapOrderId: result.prepared.orderId, signedTransaction },
        });
      }
      onChange();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The action failed.");
    } finally {
      setBusy(null);
    }
  };
  const pending = orders.filter(
    (order) => order.status === "awaiting_approval" || order.status === "recommended",
  );
  return (
    <div>
      {error && (
        <div className="p-3">
          <Note tone="warning">{error}</Note>
        </div>
      )}
      {!pending.length && <p className="p-4 text-xs text-slate-400">No proposals are waiting.</p>}
      {pending.map((order) => (
        <div
          key={order.id}
          className="flex flex-wrap items-center gap-2 border-b border-line/60 px-4 py-2.5 text-xs last:border-0"
        >
          <span className="font-semibold text-bone">
            {order.side.toUpperCase()} {usd(order.notionalUsd)} {order.symbol}
          </span>
          <span className="font-mono text-[10px] uppercase text-slate-500">
            {order.mode} · {order.status.replace("_", " ")} · at {usd(order.arrivalPriceUsd)}
          </span>
          <span className="text-[10px] text-slate-500">
            expires {order.expiresAt ? new Date(order.expiresAt).toLocaleTimeString() : "—"}
          </span>
          {order.status === "awaiting_approval" && (
            <span className="ml-auto flex gap-2">
              <button
                type="button"
                className={buttonClass}
                disabled={busy === order.id || (order.mode === "live" && !signer.ready)}
                onClick={() => act(order, "approve")}
              >
                {order.mode === "live" ? "Approve & sign" : "Approve"}
              </button>
              <button
                type="button"
                className={ghostButtonClass}
                disabled={busy === order.id}
                onClick={() => act(order, "reject")}
              >
                Reject
              </button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function AgentDetail({ id }: { id: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(() => {
    platform<Detail>(`agents/${encodeURIComponent(id)}`)
      .then((value) => {
        setDetail(value);
        setError(null);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [id]);
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const run = async (label: string, path: string, body: unknown = {}) => {
    setBusy(label);
    setMessage(null);
    try {
      const result = await platform<{ outcome?: string; stage?: string }>(
        `agents/${encodeURIComponent(id)}/${path}`,
        { body },
      );
      setMessage(
        result?.outcome
          ? `Evaluation recorded: ${result.outcome}.`
          : result?.stage
            ? `Now in ${result.stage.replace("_", " ")}.`
            : "Done.",
      );
      load();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "The action failed.");
    } finally {
      setBusy(null);
    }
  };

  if (error)
    return (
      <div className="p-4">
        <Note tone="warning">{error}</Note>
      </div>
    );
  if (!detail) return <Loading label="Loading Superbot…" />;
  const current = detail.evaluations.filter(
    (evaluation) => evaluation.manifestVersion === detail.manifest.version,
  );
  const latestFor = (stage: string) => current.find((evaluation) => evaluation.stage === stage);
  const equity =
    detail.runtime &&
    detail.runtime.cashUsd +
      Object.values(detail.runtime.positions).reduce(
        (sum, position) => sum + position.quantity * position.entryPrice,
        0,
      );
  const evaluationAction: Record<string, [string, string] | undefined> = {
    backtest: ["Run 5-year backtest", "backtest"],
    stress_test: ["Run stress tests", "stress"],
    paper: ["Record paper evaluation", "evaluate"],
    shadow: ["Record shadow evaluation", "evaluate"],
    limited_live: ["Sign off limited-live results", "evaluate"],
  };
  const action = evaluationAction[detail.stage];
  return (
    <div className="space-y-4 p-4 md:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <StageTrack stage={detail.stage} />
        <span className="font-mono text-[11px] uppercase text-bronze-200">
          {detail.stage.replace("_", " ")}
        </span>
        <span className="font-mono text-[11px] uppercase text-slate-400">
          autonomy {detail.autonomy.replace("_", " ")}
        </span>
        <span className="font-mono text-[10px] text-slate-500">
          v{detail.manifest.version} · {detail.manifest.manifestHash.slice(0, 12)}
          {detail.runningVersion !== detail.manifest.version
            ? ` · running v${detail.runningVersion}`
            : ""}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {action && (
            <button
              type="button"
              className={buttonClass}
              disabled={busy !== null}
              onClick={() => run(action[0], action[1])}
            >
              {busy === action[0] ? "Working…" : action[0]}
            </button>
          )}
          {detail.promotion && (
            <button
              type="button"
              className={detail.promotion.allowed ? buttonClass : ghostButtonClass}
              disabled={busy !== null || !detail.promotion.allowed}
              title={detail.promotion.reason}
              onClick={() => run("promote", "promote", { to: detail.promotion?.next })}
            >
              Promote to {detail.promotion.next.replace("_", " ")}
            </button>
          )}
          {detail.stage === "paused" && (
            <button
              type="button"
              className={ghostButtonClass}
              disabled={busy !== null}
              onClick={() => run("resume", "promote", { to: "paper" })}
            >
              Resume at paper
            </button>
          )}
          {detail.stage !== "paused" && detail.stage !== "draft" && (
            <button
              type="button"
              className={dangerButtonClass}
              disabled={busy !== null}
              onClick={() => run("pause", "pause", { reason: "Kill switch pressed by operator." })}
            >
              Kill switch
            </button>
          )}
          <Link
            href={`/launch?agent=${encodeURIComponent(detail.manifest.id)}`}
            className={ghostButtonClass}
          >
            Launch as token
          </Link>
        </div>
      </div>
      {detail.promotion && !detail.promotion.allowed && <Note>{detail.promotion.reason}</Note>}
      {message && (
        <Note tone={/passed|Now in/.test(message) ? "positive" : "warning"}>{message}</Note>
      )}
      <div className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
        <div className="space-y-4">
          <Panel title="Evaluation evidence (this version)">
            <div className="grid gap-px bg-line sm:grid-cols-5">
              {["backtest", "stress_test", "paper", "shadow", "limited_live"].map((stage) => {
                const evaluation = latestFor(stage);
                return (
                  <div key={stage} className="bg-panel p-3 text-xs">
                    <p className="data-label text-slate-500">{stage.replace("_", " ")}</p>
                    <p
                      className={`mt-1 font-mono ${evaluation?.outcome === "passed" ? "text-emerald-300" : evaluation?.outcome === "failed" ? "text-rose-300" : evaluation ? "text-amber-200" : "text-slate-600"}`}
                    >
                      {evaluation ? evaluation.outcome : "—"}
                    </p>
                    {evaluation && (
                      <p className="text-[10px] text-slate-500">
                        {ago(evaluation.recordedAt)} ·{" "}
                        {evaluation.reviewerSubject.startsWith("system:") ? "system" : "reviewer"}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            {current[0] ? (
              <div className="p-4">
                <p className="data-label mb-2 text-bronze-300">
                  Latest: {current[0].stage.replace("_", " ")} · {current[0].outcome} · window{" "}
                  {new Date(current[0].dataWindowStart).toLocaleDateString()} –{" "}
                  {new Date(current[0].dataWindowEnd).toLocaleDateString()}
                </p>
                <EvidenceView evaluation={current[0]} />
              </div>
            ) : (
              <p className="p-4 text-xs text-slate-400">
                No evaluations for this version yet. Backtests require 5+ years of history, Sharpe
                above 1.8 and drawdown below 10%.
              </p>
            )}
          </Panel>
          <Panel title="Proposals">
            <AgentProposals orders={detail.orders} onChange={load} />
          </Panel>
          <Panel title="Decision trail">
            <div className="max-h-[420px] overflow-y-auto">
              <table className="w-full text-left text-xs">
                <tbody>
                  {detail.decisions.map((decision) => (
                    <tr key={decision.id} className="border-b border-line/50 align-top">
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-[10px] text-slate-500">
                        {new Date(decision.createdAt).toLocaleString()}
                      </td>
                      <td className="px-2 py-2 text-slate-300">{decision.symbol}</td>
                      <td
                        className={`px-2 py-2 font-mono text-[10px] uppercase ${decision.action === "enter" ? "text-emerald-300" : decision.action === "exit" ? "text-bronze-200" : decision.action === "breaker" ? "text-rose-300" : "text-slate-500"}`}
                      >
                        {decision.action}
                      </td>
                      <td className="px-2 py-2 font-mono text-[10px] text-slate-500">
                        {decision.disposition}
                      </td>
                      <td className="px-2 py-2 text-[11px] text-slate-400">
                        {decision.reasons.slice(0, 2).join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!detail.decisions.length && (
                <p className="p-4 text-xs text-slate-400">
                  The runtime records what the agent observed and why it acted once it reaches
                  paper.
                </p>
              )}
            </div>
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel title="Manifest">
            <div className="space-y-2 p-4 text-xs text-slate-300">
              <p>{detail.policy.description}</p>
              <p className="font-mono text-[10px] text-bronze-200">
                {detail.policy.universe.join(" · ")} · {detail.policy.timeframe}
              </p>
              <p>
                Capital {usd(detail.policy.capitalAllocation.maxCapitalUsd)} · trade{" "}
                {usd(detail.policy.capitalAllocation.maxTradeNotionalUsd)} · daily DD{" "}
                {detail.policy.riskGuardrails.maxDailyDrawdownPct}% · stop{" "}
                {detail.policy.riskGuardrails.stopLossPct}% · target{" "}
                {detail.policy.riskGuardrails.takeProfitPct}% · slippage{" "}
                {detail.policy.execution.maxSlippageBps} bps
              </p>
              {detail.policy.rules ? (
                <>
                  <p className="text-slate-400">
                    Entry: {detail.policy.rules.entry.map(describeCondition).join(" AND ")}
                  </p>
                  <p className="text-slate-400">
                    Exit:{" "}
                    {detail.policy.rules.exit.map(describeCondition).join(" OR ") ||
                      "stops and targets only"}
                  </p>
                </>
              ) : (
                <Note tone="warning">
                  No executable rules — publish a new version with rules to backtest.
                </Note>
              )}
              {detail.policy.execution.liveWallet && (
                <p className="font-mono text-[10px] text-slate-500">
                  Live wallet {detail.policy.execution.liveWallet}
                </p>
              )}
              <p className="text-[11px] text-slate-500">
                Live execution on this deployment: {detail.liveExecution.replaceAll("_", " ")}.
              </p>
            </div>
          </Panel>
          {detail.canEdit && (
            <Panel title="Autonomy">
              <div className="flex flex-wrap gap-2 p-4">
                {AUTONOMY.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={detail.autonomy === value ? buttonClass : ghostButtonClass}
                    disabled={busy !== null || detail.autonomy === value}
                    onClick={() => run("autonomy", "autonomy", { autonomy: value })}
                    title={label}
                  >
                    {value.replace("_", " ")}
                  </button>
                ))}
              </div>
            </Panel>
          )}
          <Panel title="Runtime book">
            {detail.runtime ? (
              <div className="space-y-3 p-4">
                <div className="grid grid-cols-2 gap-2">
                  <Stat
                    label="Equity (at cost)"
                    value={usd(equity)}
                    hint={`Started ${usd(detail.runtime.startingEquityUsd)} in ${detail.runtime.stage.replace("_", " ")}`}
                  />
                  <Stat
                    label="Max drawdown"
                    value={`${detail.runtime.maxDrawdownPct.toFixed(2)}%`}
                  />
                </div>
                {Object.values(detail.runtime.positions).map((position) => (
                  <p key={position.symbol} className="num text-xs text-slate-300">
                    {position.symbol}: {position.quantity.toFixed(6)} @ {usd(position.entryPrice)}
                  </p>
                ))}
                <p className="text-[11px] text-slate-500">
                  Last tick {ago(detail.runtime.lastTickAt)}
                  {detail.runtime.lastError ? ` · ${detail.runtime.lastError}` : ""}
                </p>
              </div>
            ) : (
              <p className="p-4 text-xs text-slate-400">The runtime starts at the paper stage.</p>
            )}
          </Panel>
          <Panel title="Fills">
            <ul>
              {detail.fills.slice(0, 20).map((fill) => (
                <li
                  key={fill.id}
                  className="num flex justify-between border-b border-line/50 px-4 py-2 text-[11px] text-slate-300 last:border-0"
                >
                  <span>
                    {fill.side.toUpperCase()} {fill.quantity.toFixed(6)} {fill.symbol} @{" "}
                    {usd(fill.priceUsd)}
                  </span>
                  <span className="text-slate-500">
                    {fill.mode} · {fill.slippageBps?.toFixed(1) ?? "—"} bps · {ago(fill.occurredAt)}
                  </span>
                </li>
              ))}
              {!detail.fills.length && (
                <li className="p-4 text-xs text-slate-400">No fills yet.</li>
              )}
            </ul>
          </Panel>
          <Panel title="Lifecycle">
            <ul>
              {detail.history.map((event) => (
                <li
                  key={`${event.createdAt}-${event.stage}`}
                  className="border-b border-line/50 px-4 py-2 text-[11px] last:border-0"
                >
                  <span className="font-mono uppercase text-bronze-200">
                    {event.stage.replace("_", " ")}
                  </span>{" "}
                  <span className="text-slate-500">
                    v{event.manifestVersion} ·{" "}
                    {event.actorSubject.startsWith("system:")
                      ? event.actorSubject.slice(7)
                      : "operator"}{" "}
                    · {ago(event.createdAt)}
                  </span>
                  <p className="text-slate-400">{event.reason}</p>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
