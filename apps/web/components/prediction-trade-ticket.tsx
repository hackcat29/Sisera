"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useSolanaStandardWallets } from "@privy-io/react-auth/solana";
import Link from "next/link";
import { useRef, useState } from "react";
import { getPrivySolanaAddress } from "../lib/privy-identity";
import { PnlShareButton } from "./pnl-share";
import { useLiveCapability } from "./use-live-capability";

type Prepared = {
  orderId: string;
  transaction: string;
  wallet: string;
  orderPubkey: string;
  priceUsd: number;
  expiresAt: string;
  /** Sisera's fee, added to the deposit as a separate USDC transfer. */
  feeUsd?: string;
};

type ExecutedTrade = {
  mode: "live" | "paper";
  outcome: "yes" | "no";
  contracts: number;
  entryPx: number;
  amountUsd: number;
  signature?: string | null;
};

export function PredictionTradeTicket({
  marketId,
  marketTitle,
  marketStatus,
  marketPhase,
  isGraduated,
  resolvedWinner,
}: {
  marketId: string;
  marketTitle?: string | undefined;
  marketStatus?: "open" | "closed" | "resolved" | undefined;
  marketPhase?: "primary" | "secondary" | undefined;
  isGraduated?: boolean | undefined;
  resolvedWinner?: "yes" | "no" | null | undefined;
}) {
  const liveAvailable = useLiveCapability("predictions");
  const { authenticated, user } = usePrivy();
  const { wallets } = useSolanaStandardWallets();
  const linkedAddress = getPrivySolanaAddress(user);
  const wallet =
    wallets.find((item) => item.accounts.some((account) => account.address === linkedAddress)) ??
    wallets.find((item) => item.accounts.length > 0);
  const account =
    wallet?.accounts.find((item) => item.address === linkedAddress) ?? wallet?.accounts[0];
  const [outcome, setOutcome] = useState<"yes" | "no">("yes");
  const [mode, setMode] = useState<"paper" | "live">("live");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [executedTrade, setExecutedTrade] = useState<ExecutedTrade | null>(null);
  const paperRequestId = useRef<string | null>(null);

  const [claimStatus, setClaimStatus] = useState<
    "idle" | "preparing" | "signing" | "confirming" | "success" | "error"
  >("idle");
  const [claimMessage, setClaimMessage] = useState<string | null>(null);
  const [claimSignature, setClaimSignature] = useState<string | null>(null);

  async function claimWinnings() {
    if (!wallet || !account) {
      setClaimMessage("Connect your Solana wallet to claim payouts.");
      return;
    }
    const signer = wallet.features["solana:signTransaction"];
    if (!signer) {
      setClaimMessage("Your connected wallet cannot sign Solana transactions.");
      return;
    }
    setClaimStatus("preparing");
    setClaimMessage(null);
    setClaimSignature(null);

    try {
      const prepRes = await fetch("/api/prediction-claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "prepare", wallet: account.address, marketId }),
      });
      const prepData = await prepRes.json();
      if (!prepRes.ok) {
        throw new Error(prepData.message ?? "Could not build claim transaction.");
      }

      setClaimStatus("signing");
      const bytes = Uint8Array.from(atob(prepData.data.transaction), (c) => c.charCodeAt(0));
      const [signed] = await signer.signTransaction({
        account,
        transaction: bytes,
        chain: "solana:mainnet",
      });
      if (!signed) throw new Error("Wallet declined the claim transaction signature.");

      setClaimStatus("confirming");
      const signedTransaction = btoa(
        Array.from(signed.signedTransaction, (byte) => String.fromCharCode(byte)).join(""),
      );

      const execRes = await fetch("/api/prediction-claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "execute",
          wallet: account.address,
          marketId,
          signedTransaction,
        }),
      });
      const execData = await execRes.json();
      if (!execRes.ok) {
        throw new Error(execData.message ?? "Claim execution failed on Solana.");
      }

      setClaimStatus("success");
      setClaimSignature(execData.data?.signature ?? null);
      setClaimMessage("Winnings successfully claimed and deposited to your wallet!");
      window.dispatchEvent(new Event("sisera:prediction-claimed"));
    } catch (err) {
      setClaimStatus("error");
      setClaimMessage(err instanceof Error ? err.message : "Claim failed.");
    }
  }

  async function submit() {
    setWorking(true);
    setMessage(null);
    setTxSignature(null);
    setExecutedTrade(null);
    try {
      if (!authenticated) throw new Error("Sign in to trade prediction markets.");
      if (mode === "live" && !liveAvailable) throw new Error("Prediction live trading is paused.");
      if (mode === "paper") {
        if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(amount))
          throw new Error("Enter a valid USDC amount.");
        paperRequestId.current ??= crypto.randomUUID();
        const response = await fetch("/api/prediction-trade", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "paper",
            id: paperRequestId.current,
            marketId,
            outcome,
            depositUsd: amount,
            side,
          }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message ?? "Paper order could not be confirmed.");
        const fillPriceUsd = Number(payload.data.fillPriceUsd);
        const contracts = Number(payload.data.contracts);
        const depositUsd = Number(amount);
        setExecutedTrade({
          mode: "paper",
          outcome,
          contracts,
          entryPx: fillPriceUsd,
          amountUsd: depositUsd,
          signature: null,
        });
        setMessage(
          `Paper ${side.toUpperCase()} ${outcome.toUpperCase()} filled at $${payload.data.fillPriceUsd} · ${contracts.toFixed(2)} contracts · $${payload.data.feeUsd} fee.`,
        );
        paperRequestId.current = null;
        setAmount("");
        window.dispatchEvent(new Event("sisera:prediction-paper-filled"));
        return;
      }
      if (!wallet || !account) throw new Error("Connect a Solana wallet to your Sisera account.");
      if (prepared) {
        if (prepared.wallet !== account.address || Date.now() > Date.parse(prepared.expiresAt)) {
          setPrepared(null);
          throw new Error("The order expired or the wallet changed. Prepare it again.");
        }
        const signer = wallet.features["solana:signTransaction"];
        if (!signer) throw new Error("This wallet cannot sign Solana transactions.");
        const bytes = Uint8Array.from(atob(prepared.transaction), (character) =>
          character.charCodeAt(0),
        );
        const [signed] = await signer.signTransaction({
          account,
          transaction: bytes,
          chain: "solana:mainnet",
        });
        if (!signed) throw new Error("The wallet did not sign this order.");
        const signedTransaction = btoa(
          Array.from(signed.signedTransaction, (byte) => String.fromCharCode(byte)).join(""),
        );
        const response = await fetch("/api/prediction-trade", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "execute", orderId: prepared.orderId, signedTransaction }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message ?? "Prediction order submission failed.");
        const sig = payload.data?.signature;
        if (sig) setTxSignature(sig);
        if (payload.data?.status === "submitted" || payload.data?.status === "confirmed" || sig) {
          const entryPx = prepared.priceUsd;
          const depositUsd = Number(amount) || (entryPx > 0 ? entryPx : 0);
          const contracts = entryPx > 0 ? depositUsd / entryPx : 0;
          setExecutedTrade({
            mode: "live",
            outcome,
            contracts,
            entryPx,
            amountUsd: depositUsd,
            signature: sig ?? null,
          });
          setMessage(
            sig
              ? "Order submitted on Solana. Confirmation is in progress."
              : "Order submitted on Solana. Check Activity for confirmation.",
          );
        } else if (payload.data?.status === "failed") {
          setMessage(
            `Order failed: ${payload.data.error ?? payload.message ?? "Transaction was rejected on-chain."}`,
          );
        } else {
          setMessage(
            `Order status: ${payload.data?.status ?? "unknown"}. ${sig ? `Transaction: ${sig}` : "Check Activity before trying again."}`,
          );
        }
        setPrepared(null);
        setAmount("");
        return;
      }
      if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(amount))
        throw new Error("Enter a valid USDC amount.");
      const [whole, fraction = ""] = amount.split(".");
      const raw = BigInt(whole ?? "0") * 1_000_000n + BigInt(fraction.padEnd(6, "0") || "0");
      if (raw < 5_000_000n || raw > 500_000_000n) throw new Error("Enter between $5 and $500.");
      const response = await fetch("/api/prediction-trade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "prepare",
          wallet: account.address,
          marketId,
          outcome,
          depositAmount: raw.toString(),
        }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.message ?? "Prediction order could not be prepared.");
      setPrepared(payload.data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Prediction order failed.");
    } finally {
      setWorking(false);
    }
  }

  const isResolved = marketStatus === "resolved";

  return (
    <section className="border border-line bg-panel p-5 text-xs">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-semibold text-bone">
          {isResolved ? "Market Settlement" : "Trade this event"}
        </h2>
        {marketPhase === "secondary" && (
          <span className="rounded border border-purple-500/40 bg-purple-500/15 px-2 py-0.5 text-[10px] font-semibold text-purple-300 uppercase">
            Secondary CLOB
          </span>
        )}
      </div>
      <p className="mb-3 text-[11px] text-slate-500">
        Institutional prediction markets · Solana · USDC
      </p>

      {isResolved ? (
        <div className="space-y-3">
          <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-slate-200">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-semibold text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Event Concluded &amp; Resolved
              </span>
              {resolvedWinner && (
                <span className="rounded border border-emerald-500/40 bg-emerald-500/20 px-2 py-0.5 font-mono text-[10px] text-emerald-200 uppercase font-semibold">
                  Outcome: {resolvedWinner}
                </span>
              )}
            </div>
            <p className="mt-2 text-slate-300 text-[11px] leading-relaxed">
              This prediction event has ended. If you hold winning shares, you can claim your 1.00
              USDC payout directly to your connected wallet.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void claimWinnings()}
            disabled={
              claimStatus === "preparing" ||
              claimStatus === "signing" ||
              claimStatus === "confirming" ||
              !authenticated ||
              !account
            }
            className="h-10 w-full rounded border border-emerald-400/50 bg-emerald-500/20 text-emerald-200 font-semibold hover:bg-emerald-500/30 transition-all disabled:opacity-40"
          >
            {claimStatus === "preparing"
              ? "Building claim transaction…"
              : claimStatus === "signing"
                ? "Approve in wallet…"
                : claimStatus === "confirming"
                  ? "Confirming on Solana…"
                  : claimStatus === "success"
                    ? "Payout Claimed ✓"
                    : "Claim Winnings to Wallet"}
          </button>

          {claimMessage && (
            <div
              className={`rounded border p-2.5 text-xs ${
                claimStatus === "success"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-rose-500/40 bg-rose-500/10 text-rose-300"
              }`}
            >
              <p>{claimMessage}</p>
              {claimSignature && (
                <p className="mt-1 font-mono text-[11px]">
                  <a
                    href={`https://solscan.io/tx/${claimSignature}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-300 underline hover:text-emerald-200"
                  >
                    View on Solscan ({claimSignature.slice(0, 8)}…{claimSignature.slice(-6)}) ↗
                  </a>
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-2 gap-1">
            {(["live", "paper"] as const).map((option) => (
              <button
                key={option}
                type="button"
                disabled={option === "live" && !liveAvailable}
                onClick={() => {
                  setMode(option);
                  setPrepared(null);
                  setMessage(null);
                }}
                className={`rounded border px-2 py-2 uppercase disabled:opacity-40 ${mode === option ? "border-bronze-400/40 bg-bronze-400/10 text-bronze-300" : "border-line text-slate-500"}`}
              >
                {option}
              </button>
            ))}
          </div>

          {(marketPhase === "secondary" || mode === "paper") && (
            <div className="mt-2 grid grid-cols-2 gap-1">
              {(["buy", "sell"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setSide(s);
                    setPrepared(null);
                    paperRequestId.current = null;
                  }}
                  className={`rounded border px-2 py-1.5 uppercase font-medium text-[11px] ${
                    side === s
                      ? s === "buy"
                        ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                        : "border-rose-500/50 bg-rose-500/15 text-rose-300"
                      : "border-line text-slate-500"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {!liveAvailable && mode === "live" && (
            <p className="mt-2 text-amber-300">
              Live orders are currently unavailable. You can still practice a trade.
            </p>
          )}
          <div className="mt-2 grid grid-cols-2 gap-1">
            {(["yes", "no"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setOutcome(s);
                  setPrepared(null);
                  paperRequestId.current = null;
                }}
                className={`rounded border px-2 py-2 uppercase ${outcome === s ? "border-bronze-400/40 bg-bronze-400/10 text-bronze-300" : "border-line text-slate-500"}`}
              >
                {s}
              </button>
            ))}
          </div>
          <label className="mt-2 block text-slate-400">
            Deposit · USDC
            <input
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setPrepared(null);
                paperRequestId.current = null;
              }}
              inputMode="decimal"
              placeholder="5.00"
              className="mt-1 h-9 w-full rounded border border-line bg-ink-raised px-2 font-mono text-white"
            />
          </label>
          {prepared && (
            <p className="mt-2 text-amber-200">
              Review {outcome.toUpperCase()} at about ${prepared.priceUsd.toFixed(3)} per contract.
              {Number(prepared.feeUsd) > 0
                ? ` Sisera fee $${prepared.feeUsd}, paid with the order.`
                : ""}{" "}
              Wallet signature opens an order; a fill is not guaranteed.
            </p>
          )}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={
              working ||
              !authenticated ||
              !amount ||
              (mode === "live" && (!account || !liveAvailable))
            }
            className="mt-2 h-9 w-full rounded border border-bronze-400/40 bg-bronze-400/10 text-bronze-200 disabled:opacity-40"
          >
            {working
              ? "Working…"
              : mode === "paper"
                ? `${side === "buy" ? "Place paper order" : "Sell paper contracts"}`
                : prepared
                  ? "Sign and submit"
                  : "Review live order"}
          </button>
        </>
      )}
      {mode === "live" && !account && (
        <p className="mt-2 text-slate-500">
          {linkedAddress
            ? "Your linked wallet needs to be ready to approve this order."
            : "Add a Solana wallet to trade live."}
        </p>
      )}
      {executedTrade ? (
        <div className="mt-3 rounded border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-slate-200">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-semibold text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              {executedTrade.mode === "live" ? "Trade Confirmed" : "Paper Order Filled"}
            </span>
            <span className="rounded border border-line bg-ink-raised px-2 py-0.5 font-mono text-[10px] text-slate-200 uppercase font-semibold">
              {executedTrade.outcome}
            </span>
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-line/40 pt-2 text-[11px]">
            <div>
              <span className="text-slate-400">Contracts:</span>{" "}
              <span className="font-mono text-bone font-medium">
                {executedTrade.contracts.toFixed(2)}
              </span>
            </div>
            <div>
              <span className="text-slate-400">Price:</span>{" "}
              <span className="font-mono text-bone font-medium">
                ${executedTrade.entryPx.toFixed(3)}
              </span>
            </div>
            <div className="col-span-2">
              <span className="text-slate-400">Deposit:</span>{" "}
              <span className="font-mono text-bone font-medium">
                ${executedTrade.amountUsd.toFixed(2)} USDC
              </span>
            </div>
            {executedTrade.signature && (
              <div className="col-span-2 pt-0.5">
                <a
                  href={`https://solscan.io/tx/${executedTrade.signature}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[11px] text-bronze-300 underline hover:text-bronze-200"
                >
                  View on Solscan ({executedTrade.signature.slice(0, 8)}…
                  {executedTrade.signature.slice(-6)}) ↗
                </a>
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-col gap-2 border-t border-line/40 pt-2.5">
            <PnlShareButton
              card={{
                coin: "Prediction",
                market: "prediction",
                title: marketTitle ?? "Prediction market",
                outcome: executedTrade.outcome,
                side: "long",
                leverage: 1,
                roePct: 0,
                pnlUsd: 0,
                entryPx: executedTrade.entryPx,
                markPx: executedTrade.entryPx,
              }}
              className="w-full justify-center py-2 text-xs font-medium border-bronze-400/50 bg-bronze-400/20 text-bronze-200 hover:bg-bronze-400/30"
            />
            <Link
              href="/portfolio"
              className="w-full inline-flex items-center justify-center gap-1 rounded border border-line bg-ink-raised py-2 text-center text-xs font-medium text-slate-300 hover:border-slate-400 hover:text-white"
            >
              View in Portfolio →
            </Link>
          </div>
        </div>
      ) : message ? (
        <div className="mt-3 rounded border border-line bg-ink-raised p-2.5 text-xs text-slate-300">
          <p>{message}</p>
          {txSignature && (
            <p className="mt-1.5 font-mono text-[11px]">
              <a
                href={`https://solscan.io/tx/${txSignature}`}
                target="_blank"
                rel="noreferrer"
                className="text-bronze-300 underline hover:text-bronze-200"
              >
                View on Solscan ({txSignature.slice(0, 8)}…{txSignature.slice(-6)}) ↗
              </a>
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
