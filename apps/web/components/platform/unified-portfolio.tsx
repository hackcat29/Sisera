"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { perpLogos, spotLogos } from "../../lib/asset-logo";
import { pct, platform, usd } from "../../lib/platform";
import { useSolanaSigner } from "../../lib/use-solana-signer";
import { type PnlCardInput, PnlShareButton } from "../pnl-share";
import { TokenAvatar } from "../token-avatar";
import { Loading, Note, Panel, Stat } from "./ui";

type Exposure = { key: string; valueUsd: number; weightPct: number };
type Position = {
  key: string;
  book: string;
  symbol: string;
  assetClass: string;
  instrumentKey: string;
  quantity: string;
  averageCostUsd: string;
  markPriceUsd: string | null;
  marketValueUsd: string | null;
  unrealizedPnlUsd: string | null;
  realizedPnlUsd: string;
  markSource: string;
  markStatus: string;
  weightPct: number | null;
  underlying: string;
  sector: string;
  exitLiquidityPct: number | null;
  imageUrl?: string | null;
  /** Prediction positions: the market's question and the outcome held. */
  title?: string | null;
  marketId?: string | null;
  outcome?: "yes" | "no";
  claimable?: boolean;
  status?: string | null;
  phase?: string | null;
  winnerOutcome?: "yes" | "no" | null;
};
/**
 * A shareable PnL card for a prediction position, from its average price and the market's
 * current price. Falls back to entry price if the market has not yet reported a mark price.
 */
function predictionCard(position: Position): PnlCardInput | null {
  if (position.assetClass !== "prediction") return null;
  const entry = Number(position.averageCostUsd);
  if (!(entry > 0)) return null;
  const outcome = position.outcome ?? (position.instrumentKey.endsWith(":no") ? "no" : "yes");
  const mark =
    position.markPriceUsd != null && Number(position.markPriceUsd) >= 0
      ? Number(position.markPriceUsd)
      : entry;
  const pnl =
    position.unrealizedPnlUsd != null
      ? Number(position.unrealizedPnlUsd)
      : (mark - entry) * Number(position.quantity);
  return {
    coin: "Prediction",
    market: "prediction",
    title: position.title ?? position.symbol,
    outcome,
    side: "long",
    leverage: 1,
    roePct: entry > 0 ? (mark / entry - 1) * 100 : 0,
    pnlUsd: pnl,
    entryPx: entry,
    markPx: mark,
  };
}

function positionPnlCard(position: Position): PnlCardInput | null {
  if (position.assetClass === "prediction") {
    return predictionCard(position);
  }
  if (position.assetClass === "perpetual") {
    const entry = Number(position.averageCostUsd);
    const mark = Number(position.markPriceUsd);
    if (!(entry > 0) || !(mark > 0)) return null;
    const long = Number(position.quantity) >= 0;
    return {
      coin: position.symbol.replace(/-PERP$/, ""),
      market: "perp",
      side: long ? "long" : "short",
      leverage: 1,
      roePct: (mark / entry - 1) * 100 * (long ? 1 : -1),
      pnlUsd: Number(position.unrealizedPnlUsd ?? 0),
      entryPx: entry,
      markPx: mark,
    };
  }
  return null;
}

/** A position's logo: the catalog's for Solana assets, Hyperliquid's icon for its markets. */
function positionLogos(position: Position) {
  if (position.instrumentKey.startsWith("hyperliquid-spot:")) {
    const symbol = position.symbol.replace(/\/USDC$/, "");
    return spotLogos({ token: symbol, symbol });
  }
  if (position.instrumentKey.startsWith("hyperliquid:"))
    return perpLogos(position.symbol.replace(/-PERP$/, ""));
  return position.imageUrl;
}

export type PortfolioView = {
  mode: "paper" | "live";
  summary: {
    navUsd: number;
    cashUsd: number;
    investedUsd: number;
    grossExposureUsd: number;
    realizedPnlUsd: number;
    unrealizedPnlUsd: number;
    feesUsd: number;
    pricedPositions: number;
    unpricedPositions: number;
    byAssetClass: Exposure[];
    bySector: Exposure[];
    byUnderlying: Exposure[];
    byBook: Exposure[];
    concentration: {
      largestWeightPct: number;
      largestSymbol: string | null;
      top3WeightPct: number;
      herfindahl: number;
      effectivePositions: number;
    };
    duplicateExposures: Array<{ underlying: string; symbols: string[]; combinedWeightPct: number }>;
    liquidityRisk: Array<{
      symbol: string;
      valueUsd: number;
      liquidityUsd: number;
      exitLiquidityPct: number;
    }>;
  };
  positions: Position[];
  cash: Array<{ account: string; cashUsd: number; source: string }>;
  mandate: Array<{
    id: string;
    label: string;
    used: number;
    limit: number;
    utilizationPct: number;
    status: "ok" | "warning" | "breach";
    detail: string;
  }>;
  dailyPnlUsd: number;
  scenarios: Array<{
    id: string;
    name: string;
    description: string;
    pnlUsd: number;
    pnlPct: number;
    navAfterUsd: number;
    byPosition: Array<{ symbol: string; pnlUsd: number }>;
  }>;
  agentAllocations: Array<{
    agentId: string;
    name: string;
    stage: string;
    autonomy: string;
    capitalCapUsd: number;
    equityUsd: number | null;
    pnlUsd: number | null;
    positionsValueUsd: number;
  }>;
  reconciliation: {
    status: string;
    wallets: Array<{ address: string; status: string; usdc: number | null }>;
    breaks: Array<{
      symbol: string;
      ledgerQuantity: number;
      observedQuantity: number;
      difference: number;
    }>;
    observedOnly: Array<{ symbol: string; quantity: number; valueUsd: number | null }>;
    unnormalizedLiveSwaps: number;
  } | null;
  fillCount: number;
  observedAt: string;
  notes: string[];
};

const LABELS: Record<string, string> = {
  public_equity: "Public equities",
  pre_ipo: "Pre-IPO",
  agent_token: "Agent tokens",
  crypto_spot: "Crypto spot",
  perpetual: "Perpetuals",
  prediction: "Predictions",
};

function Bars({ rows, label }: { rows: Exposure[]; label: (key: string) => string }) {
  return (
    <ul className="space-y-2 p-4">
      {rows.slice(0, 8).map((row) => (
        <li key={row.key} className="text-xs">
          <div className="flex justify-between text-slate-300">
            <span className="truncate">{label(row.key)}</span>
            <span className="num">{row.weightPct.toFixed(1)}%</span>
          </div>
          <div className="mt-1 h-1.5 bg-slate-800">
            <div
              className="h-full bg-bronze-400"
              style={{ width: `${Math.min(100, row.weightPct)}%` }}
            />
          </div>
        </li>
      ))}
      {!rows.length && <li className="text-xs text-slate-500">No exposure.</li>}
    </ul>
  );
}

export function usePortfolio(mode: "paper" | "live") {
  const signer = useSolanaSigner();
  const [view, setView] = useState<PortfolioView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    const wallets = mode === "live" && signer.address ? `&wallets=${signer.address}` : "";
    platform<PortfolioView>(`portfolio?mode=${mode}${wallets}`)
      .then((data) => {
        setView(data);
        setError(null);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [mode, signer.address]);
  useEffect(() => {
    setView(null);
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);
  return { view, error, reload: load };
}

/** One portfolio across tokenized stocks, pre-IPO, agent tokens, crypto and agent books. */
export function UnifiedPortfolio() {
  const [mode, setMode] = useState<"paper" | "live">("live");
  const { view, error, reload } = usePortfolio(mode);
  const signer = useSolanaSigner();
  const [claimingKey, setClaimingKey] = useState<string | null>(null);
  const [claimToast, setClaimToast] = useState<{
    type: "success" | "error";
    message: string;
    signature?: string | null;
  } | null>(null);

  useEffect(() => {
    const handler = () => reload();
    window.addEventListener("sisera:prediction-claimed", handler);
    window.addEventListener("sisera:prediction-paper-filled", handler);
    return () => {
      window.removeEventListener("sisera:prediction-claimed", handler);
      window.removeEventListener("sisera:prediction-paper-filled", handler);
    };
  }, [reload]);

  async function claimPayout(position: Position) {
    if (!position.marketId) return;
    const walletAddress = signer.address;
    if (!walletAddress || !signer.ready) {
      setClaimToast({
        type: "error",
        message: "Please connect your Solana wallet to claim winnings.",
      });
      return;
    }
    setClaimingKey(position.key);
    setClaimToast(null);
    try {
      const prepRes = await fetch("/api/prediction-claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "prepare",
          wallet: walletAddress,
          marketId: position.marketId,
        }),
      });
      const prepData = await prepRes.json();
      if (!prepRes.ok) {
        throw new Error(prepData.message ?? "Could not build claim transaction.");
      }

      const [signedTransaction] = await signer.signAll([prepData.data.transaction]);
      if (!signedTransaction) throw new Error("Wallet declined the claim transaction signature.");

      const execRes = await fetch("/api/prediction-claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "execute",
          wallet: walletAddress,
          marketId: position.marketId,
          signedTransaction,
        }),
      });
      const execData = await execRes.json();
      if (!execRes.ok) {
        throw new Error(execData.message ?? "Claim execution failed on Solana.");
      }

      setClaimToast({
        type: "success",
        message: `Winnings claimed successfully! Payout deposited to ${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}.`,
        signature: execData.data?.signature ?? null,
      });
      reload();
      window.dispatchEvent(new Event("sisera:prediction-claimed"));
    } catch (err) {
      setClaimToast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to claim prediction winnings.",
      });
    } finally {
      setClaimingKey(null);
    }
  }

  return (
    <div className="space-y-4 p-4 md:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold text-bone">Unified book</h2>
        <div className="flex border border-line">
          {(["live", "paper"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`px-3 py-1.5 text-xs capitalize ${mode === value ? "bg-bronze-300 text-ink" : "text-slate-300"}`}
            >
              {value}
            </button>
          ))}
        </div>
        {view && (
          <span className="font-mono text-[10px] text-slate-500">
            {view.fillCount} fills · marked {new Date(view.observedAt).toLocaleTimeString()}
          </span>
        )}
      </div>
      {error && <Note tone="warning">{error}</Note>}
      {!view && !error && <Loading label="Rebuilding positions from the ledger…" />}
      {view && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Stat label="Net asset value" value={usd(view.summary.navUsd)} />
            <Stat
              label="Cash"
              value={usd(view.summary.cashUsd)}
              hint={
                view.cash.map((row) => `${row.account} ${usd(row.cashUsd)}`).join(" · ") ||
                "No cash accounts"
              }
            />
            <Stat
              label="Unrealized P&L"
              value={usd(view.summary.unrealizedPnlUsd)}
              tone={view.summary.unrealizedPnlUsd >= 0 ? "positive" : "negative"}
            />
            <Stat
              label="Realized P&L"
              value={usd(view.summary.realizedPnlUsd)}
              tone={view.summary.realizedPnlUsd >= 0 ? "positive" : "negative"}
              hint={`Fees ${usd(view.summary.feesUsd)}`}
            />
            <Stat
              label="Est. P&L today"
              value={usd(view.dailyPnlUsd)}
              tone={view.dailyPnlUsd >= 0 ? "positive" : "negative"}
            />
            <Stat
              label="Concentration"
              value={`${view.summary.concentration.largestWeightPct.toFixed(1)}%`}
              hint={`${view.summary.concentration.largestSymbol ?? "—"} largest · ${view.summary.concentration.effectivePositions.toFixed(1)} effective positions`}
              {...(view.summary.concentration.largestWeightPct > 25
                ? { tone: "warning" as const }
                : {})}
            />
          </div>
          {view.reconciliation && (
            <Note
              tone={
                view.reconciliation.status === "reconciled"
                  ? "positive"
                  : view.reconciliation.status === "unavailable"
                    ? "neutral"
                    : "warning"
              }
            >
              Reconciliation: {view.reconciliation.status.replace("_", " ")}.{" "}
              {view.reconciliation.wallets.length
                ? `${view.reconciliation.wallets.length} wallet(s) observed onchain.`
                : "Link a Solana wallet to reconcile live balances."}
              {view.reconciliation.breaks
                .map(
                  (row) =>
                    ` ${row.symbol}: ledger ${row.ledgerQuantity.toFixed(6)} vs onchain ${row.observedQuantity.toFixed(6)}.`,
                )
                .join("")}
              {view.reconciliation.observedOnly.length > 0 &&
                ` Held outside Sisera: ${view.reconciliation.observedOnly.map((row) => `${row.symbol} ${usd(row.valueUsd)}`).join(", ")}.`}
              {view.reconciliation.unnormalizedLiveSwaps > 0 &&
                ` ${view.reconciliation.unnormalizedLiveSwaps} earlier live swap(s) predate ledger normalization and are excluded.`}
            </Note>
          )}

          {claimToast && (
            <div
              className={`flex items-center justify-between rounded border p-3 text-xs ${
                claimToast.type === "success"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                  : "border-rose-500/40 bg-rose-500/10 text-rose-200"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span>{claimToast.message}</span>
                {claimToast.signature && (
                  <a
                    href={`https://solscan.io/tx/${claimToast.signature}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-emerald-300 underline hover:text-emerald-100"
                  >
                    View on Solscan ({claimToast.signature.slice(0, 6)}…
                    {claimToast.signature.slice(-4)}) ↗
                  </a>
                )}
              </div>
              <button
                type="button"
                onClick={() => setClaimToast(null)}
                className="text-xs text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
          )}

          <Panel title="Positions">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] text-left text-xs">
                <thead className="border-b border-line text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    {[
                      "Asset",
                      "Book",
                      "Quantity",
                      "Avg cost",
                      "Mark",
                      "Value",
                      "Weight",
                      "Unrealized",
                      "Realized",
                      "Exit liquidity",
                      "Action",
                    ].map((header) => (
                      <th key={header} className="px-4 py-2.5 font-medium">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="num">
                  {view.positions.map((position) => {
                    const card = positionPnlCard(position);
                    return (
                      <tr key={position.key} className="border-b border-line/50 last:border-0">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <TokenAvatar
                              src={positionLogos(position)}
                              symbol={position.symbol}
                              size={24}
                            />
                            <div className="min-w-0">
                              {position.title && position.marketId ? (
                                <Link
                                  prefetch={false}
                                  href={`/predictions/${encodeURIComponent(position.marketId)}`}
                                  className="line-clamp-2 max-w-72 font-sans font-semibold text-bone hover:text-bronze-200"
                                >
                                  {position.title}
                                </Link>
                              ) : (
                                <p className="font-sans font-semibold text-bone">
                                  {position.symbol}
                                </p>
                              )}
                              <p className="flex items-center gap-2 font-sans text-[10px] text-slate-500">
                                <span>
                                  {LABELS[position.assetClass] ?? position.assetClass} ·{" "}
                                  {position.outcome
                                    ? position.outcome.toUpperCase()
                                    : position.sector}
                                </span>
                                {card ? <PnlShareButton card={card} /> : null}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-[11px] text-slate-400">
                          {position.book.startsWith("agent:") ? (
                            <Link
                              prefetch={false}
                              href={`/agents/${encodeURIComponent(position.book.slice(6))}`}
                              className="text-bronze-200 hover:underline"
                            >
                              Agent
                            </Link>
                          ) : position.book.startsWith("policy:") ? (
                            "Policy"
                          ) : (
                            "Manual"
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-slate-300">
                          {Number(position.quantity).toFixed(6)}
                        </td>
                        <td className="px-4 py-2.5 text-slate-300">
                          {usd(Number(position.averageCostUsd))}
                        </td>
                        <td className="px-4 py-2.5 text-slate-300" title={position.markSource}>
                          {position.markStatus === "priced" ? (
                            usd(Number(position.markPriceUsd))
                          ) : (
                            <span className="text-amber-200">unpriced</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-slate-200">
                          {usd(Number(position.marketValueUsd))}
                        </td>
                        <td className="px-4 py-2.5 text-slate-300">
                          {position.weightPct == null ? "—" : `${position.weightPct.toFixed(1)}%`}
                        </td>
                        <td
                          className={`px-4 py-2.5 ${Number(position.unrealizedPnlUsd) >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span>{usd(Number(position.unrealizedPnlUsd))}</span>
                            {card ? (
                              <PnlShareButton
                                card={card}
                                className="bg-ink-raised hover:bg-bronze-400/20"
                              />
                            ) : null}
                          </div>
                        </td>
                        <td
                          className={`px-4 py-2.5 ${Number(position.realizedPnlUsd) >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                        >
                          {usd(Number(position.realizedPnlUsd))}
                        </td>
                        <td
                          className={`px-4 py-2.5 ${(position.exitLiquidityPct ?? 0) > 5 ? "text-amber-200" : "text-slate-400"}`}
                        >
                          {position.exitLiquidityPct == null
                            ? "—"
                            : `${position.exitLiquidityPct.toFixed(2)}% of pool`}
                        </td>
                        <td className="px-4 py-2.5">
                          {position.assetClass === "prediction" ? (
                            position.claimable ? (
                              <button
                                type="button"
                                onClick={() => void claimPayout(position)}
                                disabled={claimingKey === position.key}
                                className="inline-flex items-center gap-1.5 rounded border border-emerald-500/50 bg-emerald-500/20 px-2.5 py-1 font-sans text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
                              >
                                {claimingKey === position.key ? (
                                  <>
                                    <span className="inline-block h-2 w-2 animate-spin rounded-full border-2 border-emerald-300 border-t-transparent" />
                                    Claiming…
                                  </>
                                ) : (
                                  "Claim Payout"
                                )}
                              </button>
                            ) : position.marketId ? (
                              <Link
                                prefetch={false}
                                href={`/predictions/${encodeURIComponent(position.marketId)}`}
                                className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800/80 px-2.5 py-1 font-sans text-[11px] font-medium text-slate-300 hover:border-slate-600 hover:bg-slate-700/80 hover:text-bone transition-colors"
                              >
                                Trade / Exit →
                              </Link>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )
                          ) : position.assetClass === "perpetual" ? (
                            <Link
                              prefetch={false}
                              href="/perps"
                              className="inline-flex items-center gap-1 font-sans text-[11px] text-bronze-200 hover:text-bone hover:underline"
                            >
                              Trade →
                            </Link>
                          ) : position.assetClass === "crypto_spot" ? (
                            <Link
                              prefetch={false}
                              href="/spot"
                              className="inline-flex items-center gap-1 font-sans text-[11px] text-bronze-200 hover:text-bone hover:underline"
                            >
                              Trade →
                            </Link>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!view.positions.length && (
                <p className="p-4 text-xs text-slate-400">
                  No {view.mode} positions. Trades, policy executions and agent fills appear here
                  from the ledger.
                </p>
              )}
            </div>
          </Panel>
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="By asset class">
              <Bars rows={view.summary.byAssetClass} label={(key) => LABELS[key] ?? key} />
            </Panel>
            <Panel title="By sector">
              <Bars rows={view.summary.bySector} label={(key) => key} />
            </Panel>
            <Panel title="Economic exposure">
              <Bars
                rows={view.summary.byUnderlying}
                label={(key) => (key.length > 30 ? `${key.slice(0, 6)}…` : key)}
              />
              {view.summary.duplicateExposures.length > 0 && (
                <p className="border-t border-line px-4 py-2 text-[11px] text-amber-200">
                  Duplicated:{" "}
                  {view.summary.duplicateExposures
                    .map((row) => `${row.underlying} via ${row.symbols.join(" + ")}`)
                    .join("; ")}
                </p>
              )}
            </Panel>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Scenario risk">
              <ul>
                {view.scenarios.map((scenario) => (
                  <li
                    key={scenario.id}
                    className="border-b border-line/60 px-4 py-2.5 text-xs last:border-0"
                  >
                    <div className="flex justify-between">
                      <span className="text-slate-200">{scenario.name}</span>
                      <span
                        className={`num ${scenario.pnlUsd < 0 ? "text-rose-300" : "text-slate-400"}`}
                      >
                        {usd(scenario.pnlUsd)} ({pct(scenario.pnlPct)})
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">{scenario.description}</p>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Agent allocations">
              {view.agentAllocations.length ? (
                <ul>
                  {view.agentAllocations.map((agent) => (
                    <li
                      key={agent.agentId}
                      className="flex items-center justify-between border-b border-line/60 px-4 py-2.5 text-xs last:border-0"
                    >
                      <Link
                        prefetch={false}
                        href={`/agents/${encodeURIComponent(agent.agentId)}`}
                        className="text-bone hover:text-bronze-200"
                      >
                        {agent.name}
                        <span className="ml-2 font-mono text-[10px] uppercase text-slate-500">
                          {agent.stage.replace("_", " ")} · {agent.autonomy.replace("_", " ")}
                        </span>
                      </Link>
                      <span className="num text-slate-300">
                        {usd(agent.equityUsd)} / cap {usd(agent.capitalCapUsd)}{" "}
                        <span
                          className={
                            (agent.pnlUsd ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"
                          }
                        >
                          {usd(agent.pnlUsd)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-4 text-xs text-slate-400">No agents are running in this book.</p>
              )}
            </Panel>
          </div>
          {view.summary.unpricedPositions > 0 && (
            <Note tone="warning">
              {view.summary.unpricedPositions} position(s) have no acceptable mark and are excluded
              from NAV until priced.
            </Note>
          )}
          <p className="text-[11px] leading-5 text-slate-500">{view.notes.join(" ")}</p>
        </>
      )}
    </div>
  );
}
