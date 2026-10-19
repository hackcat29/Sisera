"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { announcePerpTrade } from "../lib/hyperliquid";
import { useSolanaSigner } from "../lib/use-solana-signer";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MIN_DEPOSIT = 5;

type Prepared = {
  requestId: string;
  transaction: string;
  wallet: string;
  amountUsdc: string;
  outputAmountUsdc: string;
  feeUsd: string;
  timeEstimateSeconds: number | null;
  expiresAt: string;
};

const money = (value: number | string) =>
  Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Moves USDC from the account's Solana wallet into its Hyperliquid perps balance, where it can be
 * used as margin. Relay delivers it in about a second.
 */
export function PerpDeposit({
  evmAddress,
  onDeposited,
}: {
  evmAddress: string;
  onDeposited?: () => void;
}) {
  const signer = useSolanaSigner();
  const [usdc, setUsdc] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!signer.address) return;
    let active = true;
    void fetch(`/api/wallet?address=${encodeURIComponent(signer.address)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        const holding = payload?.data?.holdings?.find(
          (item: { mint: string }) => item.mint === USDC,
        );
        if (active) setUsdc(holding ? Number(holding.rawBalance) / 10 ** holding.decimals : 0);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [signer.address]);

  async function run(action: () => Promise<void>) {
    setWorking(true);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The deposit could not be completed.");
    } finally {
      setWorking(false);
    }
  }

  async function review() {
    if (!signer.address) throw new Error("Your Solana wallet is still being set up.");
    const value = Number(amount);
    if (!Number.isFinite(value) || value < MIN_DEPOSIT)
      throw new Error(`Deposit at least ${MIN_DEPOSIT} USDC.`);
    if (usdc != null && value > usdc)
      throw new Error("Your Solana wallet doesn't have that much USDC.");
    const response = await fetch("/api/perps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "deposit-prepare",
        wallet: signer.address,
        recipient: evmAddress,
        amountUsdc: String(Math.floor(value * 1e6) / 1e6),
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? "The deposit could not be prepared.");
    setPrepared(payload.data);
  }

  async function confirm() {
    if (!prepared) return;
    if (Date.now() > Date.parse(prepared.expiresAt)) {
      setPrepared(null);
      throw new Error("This quote expired. Review the deposit again.");
    }
    if (prepared.wallet !== signer.address) throw new Error("Your wallet changed. Review again.");
    const [signedTransaction] = await signer.signAll([prepared.transaction]);
    const response = await fetch("/api/perps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "deposit-execute",
        requestId: prepared.requestId,
        signedTransaction,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? "The deposit could not be completed.");
    if (payload.data.status === "failed")
      throw new Error("The deposit failed on Solana. Nothing was moved; try again.");
    toast.success(`Depositing ${money(prepared.outputAmountUsdc)} USDC to Hyperliquid`, {
      description: "It usually arrives within a few seconds.",
    });
    setPrepared(null);
    setAmount("");
    setUsdc((current) => (current == null ? current : current - Number(prepared.amountUsdc)));
    // Relay credits the account within seconds; refresh until it shows up.
    for (const delay of [2000, 4000, 8000, 15000]) window.setTimeout(announcePerpTrade, delay);
    onDeposited?.();
  }

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-baseline justify-between text-slate-400">
        <span>From your Solana wallet</span>
        <span className="font-mono text-slate-200">
          {usdc == null ? "—" : `${money(usdc)} USDC`}
        </span>
      </div>
      {!prepared ? (
        <>
          <div className="flex gap-2">
            <input
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value.trim())}
              placeholder={`Min ${MIN_DEPOSIT}`}
              aria-label="Deposit amount in USDC"
              className="h-10 min-w-0 flex-1 rounded border border-line bg-ink-raised px-3 text-right font-mono text-sm text-white"
            />
            <button
              type="button"
              disabled={!usdc}
              onClick={() => setAmount(String(Math.floor((usdc ?? 0) * 100) / 100))}
              className="rounded border border-line px-3 text-[11px] text-slate-300 disabled:opacity-40"
            >
              Max
            </button>
          </div>
          <button
            type="button"
            disabled={working || !amount}
            onClick={() => void run(review)}
            className="h-10 w-full rounded bg-bronze-300 font-semibold text-[#0b1b24] hover:bg-bronze-200 disabled:opacity-40"
          >
            {working ? "Getting quote…" : "Review deposit"}
          </button>
        </>
      ) : (
        <div className="space-y-2 rounded border border-line bg-ink-raised p-3">
          <p className="text-slate-200">
            Deposit <strong>{money(prepared.amountUsdc)} USDC</strong>, receive{" "}
            <strong>≈ {money(prepared.outputAmountUsdc)} USDC</strong> as margin
          </p>
          <p className="text-[11px] text-slate-500">
            Fee ${prepared.feeUsd} ·{" "}
            {prepared.timeEstimateSeconds != null && prepared.timeEstimateSeconds <= 60
              ? "arrives in seconds"
              : "arrives in a few minutes"}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={working}
              onClick={() => void run(confirm)}
              className="h-9 flex-1 rounded bg-bronze-300 font-semibold text-[#0b1b24] disabled:opacity-40"
            >
              {working ? "Waiting for wallet…" : "Confirm deposit"}
            </button>
            <button
              type="button"
              disabled={working}
              onClick={() => setPrepared(null)}
              className="h-9 rounded border border-line px-3 text-slate-400"
            >
              Back
            </button>
          </div>
        </div>
      )}
      {message && <p className="text-amber-200">{message}</p>}
      <p className="text-[11px] leading-5 text-slate-500">
        Holding other tokens?{" "}
        <Link href="/portfolio#swap" className="text-bronze-300 hover:text-bronze-200">
          Swap them to USDC
        </Link>{" "}
        first, or send USDC to Hyperliquid from an EVM chain there.
      </p>
    </div>
  );
}
