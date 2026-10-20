"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useSolanaStandardWallets } from "@privy-io/react-auth/solana";
import { useRef, useState } from "react";
import { getPrivySolanaAddress } from "../lib/privy-identity";
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

export function PredictionTradeTicket({ marketId }: { marketId: string }) {
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
  const [amount, setAmount] = useState("");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const paperRequestId = useRef<string | null>(null);

  async function submit() {
    setWorking(true);
    setMessage(null);
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
          }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message ?? "Paper order could not be confirmed.");
        setMessage(
          `Paper ${outcome.toUpperCase()} filled at $${payload.data.fillPriceUsd} · ${Number(payload.data.contracts).toFixed(2)} contracts · $${payload.data.feeUsd} fee.`,
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
        setMessage(
          payload.data.status === "submitted"
            ? `Order submitted on Solana. Match status may take time. Transaction: ${payload.data.signature}`
            : `Order status ${payload.data.status}. Check Activity before trying again.`,
        );
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

  return (
    <section className="border border-line bg-panel p-5 text-xs">
      <h2 className="mb-4 text-base font-semibold text-bone">Trade this event</h2>
      <p className="mb-3 text-[11px] text-slate-500">Powered by Panta · Solana · USDC</p>
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
      {!liveAvailable && mode === "live" && (
        <p className="mt-2 text-amber-300">
          Live orders are currently unavailable. You can still practice a trade.
        </p>
      )}
      <div className="mt-2 grid grid-cols-2 gap-1">
        {(["yes", "no"] as const).map((side) => (
          <button
            key={side}
            type="button"
            onClick={() => {
              setOutcome(side);
              setPrepared(null);
              paperRequestId.current = null;
            }}
            className={`rounded border px-2 py-2 uppercase ${outcome === side ? "border-bronze-400/40 bg-bronze-400/10 text-bronze-300" : "border-line text-slate-500"}`}
          >
            {side}
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
          working || !authenticated || !amount || (mode === "live" && (!account || !liveAvailable))
        }
        className="mt-2 h-9 w-full rounded border border-bronze-400/40 bg-bronze-400/10 text-bronze-200 disabled:opacity-40"
      >
        {working
          ? "Working…"
          : mode === "paper"
            ? "Place paper order"
            : prepared
              ? "Sign and submit"
              : "Review live order"}
      </button>
      {mode === "live" && !account && (
        <p className="mt-2 text-slate-500">
          {linkedAddress
            ? "Your linked wallet needs to be ready to approve this order."
            : "Add a Solana wallet to trade live."}
        </p>
      )}
      {message && <output className="mt-2 block text-slate-300">{message}</output>}
    </section>
  );
}
