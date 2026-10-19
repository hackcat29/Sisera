"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useState } from "react";

type BridgeTransfer = {
  requestId: string;
  originChainId: number;
  destinationChainId: number;
  /** Null for a swap, which records the token it started from instead. */
  originAmountUsdc: string | null;
  quotedOutputUsdc: string;
  originSymbol?: string | null;
  originDecimals?: number | null;
  originAmountRaw?: string | null;
  status: string;
  sourceTxHash: string | null;
  destinationTxHash: string | null;
  quotedAt: string;
};

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  56: "BNB Chain",
  137: "Polygon",
  999: "HyperEVM",
  8453: "Base",
  42161: "Arbitrum",
  792703809: "Solana",
};
const chainName = (id: number) => CHAIN_NAMES[id] ?? String(id);

function originAmount(transfer: BridgeTransfer) {
  if (transfer.originAmountUsdc != null) return `${transfer.originAmountUsdc} USDC`;
  if (!transfer.originAmountRaw || transfer.originDecimals == null) return "Token";
  const raw = BigInt(transfer.originAmountRaw.split(".")[0] ?? "0");
  const scale = 10n ** BigInt(transfer.originDecimals);
  const fraction = (raw % scale)
    .toString()
    .padStart(transfer.originDecimals, "0")
    .replace(/0+$/, "");
  return `${raw / scale}${fraction ? `.${fraction}` : ""} ${transfer.originSymbol ?? "tokens"}`;
}

export function BridgeActivity() {
  const { ready, authenticated } = usePrivy();
  const [transfers, setTransfers] = useState<BridgeTransfer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      setTransfers(null);
      setError("Sign in to view account bridge history.");
      return;
    }
    let active = true;
    const load = () => {
      void fetch("/api/bridge", { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.message ?? "Bridge history is unavailable.");
          return payload.data as BridgeTransfer[];
        })
        .then((rows) => {
          if (active) {
            setTransfers(rows);
            setError(null);
          }
        })
        .catch((cause) => {
          if (active)
            setError(cause instanceof Error ? cause.message : "Bridge history is unavailable.");
        });
    };
    load();
    window.addEventListener("sisera:session-renewed", load);
    return () => {
      active = false;
      window.removeEventListener("sisera:session-renewed", load);
    };
  }, [ready, authenticated]);

  async function refresh(requestId: string) {
    setRefreshing(requestId);
    setError(null);
    try {
      const response = await fetch(`/api/bridge?requestId=${encodeURIComponent(requestId)}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Bridge status is unavailable.");
      setTransfers(
        (current) =>
          current?.map((transfer) =>
            transfer.requestId === requestId
              ? {
                  ...transfer,
                  status: payload.data.status,
                  sourceTxHash: payload.data.inTxHashes?.[0] ?? transfer.sourceTxHash,
                  destinationTxHash: payload.data.txHashes?.[0] ?? transfer.destinationTxHash,
                }
              : transfer,
          ) ?? null,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Bridge status is unavailable.");
    } finally {
      setRefreshing(null);
    }
  }

  return (
    <section className="mt-4 border border-line bg-panel">
      <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-white">
        Bridge and swap history
      </h2>
      {error && <p className="border-b border-line p-4 text-xs text-amber-200">{error}</p>}
      {transfers === null && !error ? (
        <p className="p-5 text-xs text-slate-400">Checking account bridge history…</p>
      ) : transfers?.length === 0 ? (
        <p className="p-5 text-xs text-slate-400">No bridges or swaps have been quoted.</p>
      ) : transfers ? (
        <div className="divide-y divide-line">
          {transfers.map((transfer) => (
            <div key={transfer.requestId} className="p-4 text-xs text-slate-300">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[10px] text-slate-500">
                  {new Date(transfer.quotedAt).toLocaleString()} ·{" "}
                  {chainName(transfer.originChainId)} → {chainName(transfer.destinationChainId)}
                </span>
                <span className="text-bronze-300">{transfer.status.replaceAll("_", " ")}</span>
              </div>
              <p className="mt-2">
                {transfer.originAmountUsdc == null ? "Swap" : "Bridge"} · {originAmount(transfer)}{" "}
                in · quoted {transfer.quotedOutputUsdc} USDC out
              </p>
              <p className="mt-1 break-all font-mono text-[10px] text-slate-500">
                Relay request {transfer.requestId}
              </p>
              {transfer.sourceTxHash && (
                <p className="mt-1 break-all font-mono text-[10px] text-slate-500">
                  Source transaction {transfer.sourceTxHash}
                </p>
              )}
              {transfer.destinationTxHash && (
                <p className="mt-1 break-all font-mono text-[10px] text-slate-500">
                  Destination transaction {transfer.destinationTxHash}
                </p>
              )}
              <button
                type="button"
                disabled={refreshing === transfer.requestId}
                onClick={() => void refresh(transfer.requestId)}
                className="mt-3 rounded border border-line px-3 py-2 text-bronze-300 disabled:opacity-50"
              >
                Refresh status
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
