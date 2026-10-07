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
  "Buy $2,000 of OpenAI if the premium falls below 3%.",
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
        <Note tone="positive">Policy saved.</Note>
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
          <details className="border border-emerald-500/30 bg-ink p-3 text-xs text-slate-300">
            <summary className="cursor-pointer text-emerald-300">For · {data.bull.length}</summary>
            <ul className="list-inside list-disc space-y-1">
              {data.bull.slice(0, 5).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
          <details className="border border-rose-500/30 bg-ink p-3 text-xs text-slate-300">
            <summary className="cursor-pointer text-rose-300">Against · {data.bear.length}</summary>
            <ul className="list-inside list-disc space-y-1">
              {data.bear.slice(0, 5).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
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

type ResearchTake = {
  id: string;
  title: string;
  thesis: string;
  targetTotalNotionalUsd: number;
  cashWeightPct?: number;
  cashNotionalUsd?: number;
  constituents: Array<{
    symbol: string;
    name: string;
    weightPct: number;
    targetNotionalUsd: number;
    rationale: string;
    counterpoints?: string[];
    evidenceIds?: string[];
  }>;
  metrics: { estimatedSharpe: number | null; estimatedVol30dPct: number | null };
  stressScenarios: Record<string, number>;
  research?: {
    asOf: string;
    expiresAt: string;
    method: string;
    historyBasis: string;
    historyObservations: number;
    sources: Array<{
      id: string;
      url: string;
      title: string;
      publisher: string;
      certainty: string;
    }>;
    excluded: Array<{ key: string; reason: string }>;
  };
};
function TakeCard({ data, onArmed }: { data: unknown; onArmed: () => void }) {
  const initial = data as ResearchTake;
  const [take, setTake] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [armed, setArmed] = useState(false);
  const signer = useSolanaSigner();
  if (!take?.constituents) return null;
  async function action(kind: "arm" | "fork" | "tokenize" | "compile") {
    setBusy(true);
    setFeedback("");
    try {
      if (kind === "arm") {
        const result = await platform<{ armedCount: number }>("takes/arm", {
          body: { takeId: take.id, mode: "paper", wallet: signer.address ?? null },
        });
        setArmed(true);
        setFeedback(`${result.armedCount} paper policies active.`);
        onArmed();
      } else if (kind === "fork") {
        const result = await platform<ResearchTake>("takes/fork", {
          body: {
            takeId: take.id,
            constituentTweaks: take.constituents.map((c) => ({
              symbol: c.symbol,
              weightPct: Number(weights[c.symbol] ?? c.weightPct),
            })),
          },
        });
        setTake(result);
        setWeights({});
        setArmed(false);
        setFeedback("Allocation saved.");
      } else if (kind === "compile") {
        const result = await platform<ResearchTake>("takes/compile", {
          body: { text: take.thesis, totalNotionalUsd: take.targetTotalNotionalUsd },
        });
        setTake(result);
        setArmed(false);
        setFeedback("Research refreshed.");
      } else {
        const result = await platform<{ tokenSymbol: string; pairedStock: string }>(
          "takes/tokenize",
          { body: { takeId: take.id } },
        );
        window.location.assign(
          `/launch?symbol=${encodeURIComponent(result.tokenSymbol)}&pair=${encodeURIComponent(result.pairedStock)}`,
        );
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  const expired = take.research && Date.parse(take.research.expiresAt) < Date.now();
  return (
    <div className="space-y-3 border border-bronze-500/40 bg-ink p-4 text-xs">
      <div className="flex flex-wrap justify-between gap-2">
        <h3 className="font-semibold text-bone">{take.title}</h3>
        <span className="text-bronze-300">
          {armed ? "Paper active" : expired ? "Expired" : "Research draft"}
        </span>
      </div>
      <div className="flex flex-wrap gap-4 text-slate-400">
        <span>${take.targetTotalNotionalUsd.toLocaleString()}</span>
        <span>Historical basket Sharpe: {take.metrics.estimatedSharpe?.toFixed(2) ?? "—"}</span>
        <span>30d volatility: {take.metrics.estimatedVol30dPct?.toFixed(1) ?? "—"}%</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="text-slate-500">
            <tr>
              <th>Asset</th>
              <th>Weight</th>
              <th>Capital</th>
              <th>Sources</th>
            </tr>
          </thead>
          <tbody>
            {take.constituents.map((c) => (
              <tr key={c.symbol} className="border-t border-line">
                <td className="py-2 text-bone">{c.symbol}</td>
                <td>{c.weightPct}%</td>
                <td>${c.targetNotionalUsd.toLocaleString()}</td>
                <td>{c.evidenceIds?.length ?? 0}</td>
              </tr>
            ))}
            {(take.cashWeightPct ?? 0) > 0 && (
              <tr className="border-t border-line text-slate-400">
                <td className="py-2">Unallocated cash</td>
                <td>{take.cashWeightPct}%</td>
                <td>${take.cashNotionalUsd?.toLocaleString()}</td>
                <td>—</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <details className="border-t border-line pt-2">
        <summary className="cursor-pointer text-bronze-200">Evidence & risks</summary>
        <div className="mt-3 space-y-3 text-slate-400">
          <p>{take.thesis}</p>
          {take.constituents.map((c) => (
            <div key={c.symbol}>
              <strong className="text-bone">{c.symbol}</strong>
              <p>{c.rationale}</p>
              {c.counterpoints?.map((point) => (
                <p key={point} className="text-amber-200">
                  {point}
                </p>
              ))}
            </div>
          ))}
          <p>
            {take.research?.method} ·{" "}
            {take.research?.asOf && new Date(take.research.asOf).toLocaleString()}
          </p>
          <p>
            {take.research?.historyObservations ?? 0} common daily observations ·{" "}
            {take.research?.historyBasis}
          </p>
          <div className="space-y-2">
            {take.research?.sources.map((source, i) => (
              <a
                key={`${source.id}-${i}`}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="block text-bronze-200"
              >
                {source.title}{" "}
                <span className="text-slate-500">
                  · {source.publisher} · {source.certainty}
                </span>
              </a>
            ))}
          </div>
          <details>
            <summary className="cursor-pointer">Scenario assumptions</summary>
            {Object.entries(take.stressScenarios).map(([name, value]) => (
              <p key={name}>
                {name.replace(/Pct$/, " ").replace(/([A-Z])/g, " $1")}: {value}%
              </p>
            ))}
          </details>
          {take.research?.excluded.length ? (
            <details>
              <summary className="cursor-pointer">Excluded assets</summary>
              {take.research.excluded.map((c) => (
                <p key={c.key}>
                  {c.key} · {c.reason}
                </p>
              ))}
            </details>
          ) : null}
        </div>
      </details>
      <details>
        <summary className="cursor-pointer text-bronze-200">Edit allocation</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {take.constituents.map((c) => (
            <label key={c.symbol} className="text-slate-400">
              {c.symbol}
              <input
                aria-label={`${c.symbol} weight`}
                type="number"
                min="1"
                max="50"
                value={weights[c.symbol] ?? c.weightPct}
                onChange={(e) => setWeights({ ...weights, [c.symbol]: e.target.value })}
                className="ml-2 w-16 border border-line bg-ink p-1"
              />
            </label>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => void action("fork")}
            className={buttonClass}
          >
            Save fork
          </button>
        </div>
      </details>
      {feedback && <Note>{feedback}</Note>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={busy || armed || Boolean(expired)}
          onClick={() => void action("arm")}
        >
          Create paper policies
        </button>
        <button
          type="button"
          className={ghostButtonClass}
          disabled={busy}
          onClick={() => void action("compile")}
        >
          Refresh research
        </button>
        <button
          type="button"
          className={ghostButtonClass}
          disabled={busy || Boolean(expired)}
          onClick={() => void action("tokenize")}
        >
          Prepare launch
        </button>
      </div>
    </div>
  );
}

type BasisQuote = {
  id: string;
  asset: string;
  spotVenue: string;
  perpVenue: string;
  fundingRateAprPct: number;
  netYieldAprPct: number;
  observedAt: string;
  expectedNetUsd: number;
  quoteNotionalUsd: number;
  availableNotionalUsd: number;
  roundTripFeeBps: number;
  estimatedEntrySpreadCostBps: number;
  holdingDays: number;
  status: string;
  settlementBasis: string;
  spotPriceUsd: number;
  perpPriceUsd: number;
  requiredCapitalUsd: number;
  netReturnOnCapitalAprPct: number;
};
function BasisArbitrageCard({ data }: { data: unknown }) {
  const payload = data as { opportunities: BasisQuote[]; suggestedNotionalUsd: number };
  const [quotes, setQuotes] = useState(payload?.opportunities ?? []);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  async function refresh() {
    setBusy(true);
    try {
      setQuotes(
        await platform<BasisQuote[]>(`arbitrage/basis?notionalUsd=${payload.suggestedNotionalUsd}`),
      );
      setFeedback("");
    } catch (error) {
      setQuotes([]);
      setFeedback(error instanceof Error ? error.message : "Quotes unavailable.");
    } finally {
      setBusy(false);
    }
  }
  async function draft(asset: string) {
    setBusy(true);
    try {
      await platform("arbitrage/arm", {
        body: { asset, notionalUsd: payload.suggestedNotionalUsd, maxLeverage: 1 },
      });
      setFeedback("Research draft created.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 border border-line bg-ink p-4 text-xs">
      <div className="flex justify-between">
        <h3 className="text-bone">
          Funding carry · ${payload.suggestedNotionalUsd?.toLocaleString()} per leg
        </h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => void refresh()}
          className={ghostButtonClass}
        >
          Refresh quotes
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="text-slate-500">
            <tr>
              <th>Asset</th>
              <th>Funding APR</th>
              <th>Capital APR</th>
              <th>30d carry</th>
              <th>Age</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => {
              const age = Math.max(0, (now - Date.parse(q.observedAt)) / 1000);
              return (
                <tr key={q.id} className="border-t border-line">
                  <td className="py-2 text-bone">{q.asset}</td>
                  <td>{q.fundingRateAprPct.toFixed(1)}%</td>
                  <td>{q.netReturnOnCapitalAprPct.toFixed(1)}%</td>
                  <td>${q.expectedNetUsd.toFixed(2)}</td>
                  <td className={age > 10 ? "text-amber-200" : "text-slate-400"}>
                    {age > 10 ? "Stale" : `${age.toFixed(0)}s`}
                  </td>
                  <td>
                    <button
                      type="button"
                      disabled={busy || age > 10 || q.status === "unfavorable"}
                      onClick={() => void draft(q.asset)}
                      className={buttonClass}
                    >
                      Create draft
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!quotes.length && <p className="text-slate-400">No fresh quotes with sufficient depth.</p>}
      <details>
        <summary className="cursor-pointer text-bronze-200">Quote details</summary>
        <div className="mt-2 space-y-2 text-slate-400">
          <p>Variable funding · 1× margin · modeled fees · basis risk.</p>
          {quotes.map((q) => (
            <p key={q.id}>
              {q.asset}: {q.spotVenue} ${q.spotPriceUsd.toFixed(2)} / {q.perpVenue} $
              {q.perpPriceUsd.toFixed(2)} · depth ${q.availableNotionalUsd.toFixed(0)} · fees{" "}
              {q.roundTripFeeBps} bps · spread {q.estimatedEntrySpreadCostBps.toFixed(1)} bps ·{" "}
              {q.settlementBasis}
            </p>
          ))}
        </div>
      </details>
      {feedback && <Note>{feedback}</Note>}
    </div>
  );
}

/** Sisera AI: evidence-backed answers and conversational policies that never trade on their own. */
export function CopilotChat({ initialAsset }: { initialAsset?: string | null }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [savedResearch, setSavedResearch] = useState<Array<{ id: string; report: ResearchTake }>>(
    [],
  );
  useEffect(() => {
    void platform<Array<{ id: string; report: ResearchTake }>>("takes")
      .then(setSavedResearch)
      .catch(() => {});
  }, []);
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
      if (reply.cards.some((c) => c.type === "take_card"))
        void platform<Array<{ id: string; report: ResearchTake }>>("takes")
          .then(setSavedResearch)
          .catch(() => {});
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
          {savedResearch.length > 0 && (
            <details className="border border-line p-3 text-xs">
              <summary className="cursor-pointer text-bronze-200">
                Saved research · {savedResearch.length}
              </summary>
              <div className="mt-3 space-y-2">
                {savedResearch.map((r) => (
                  <details key={r.id}>
                    <summary className="cursor-pointer text-slate-300">{r.report.title}</summary>
                    <div className="mt-2">
                      <TakeCard data={r.report} onArmed={() => setPolicyRefresh((v) => v + 1)} />
                    </div>
                  </details>
                ))}
              </div>
            </details>
          )}
          {messages.length === 0 && (
            <div>
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
                {message.role === "assistant" && message.content.length > 280 ? (
                  <>
                    <span>{message.content.slice(0, 280)}…</span>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-bronze-200">Read analysis</summary>
                      <p>{message.content}</p>
                    </details>
                  </>
                ) : (
                  message.content
                )}
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
      </div>
    </div>
  );
}
