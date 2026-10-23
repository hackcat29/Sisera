"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useState } from "react";
import { getPrivySolanaAddress } from "../lib/privy-identity";
import { type RelayStep, executeRelaySteps } from "../lib/relay-execute";
import { useSiseraWallets } from "../lib/use-sisera-wallets";

const chains = [
  { id: 8453, label: "Base" },
  { id: 42161, label: "Arbitrum" },
  { id: 1, label: "Ethereum" },
];
type Quote = {
  requestId: string | null;
  steps: RelayStep[];
  fees: Record<string, { amountUsd?: string }>;
  outputAmountUsdc: string;
  timeEstimateSeconds: number | null;
  originChainId: number;
  destinationChainId: number;
  recipient: string;
};

export function BridgeUsdc() {
  const { authenticated, user } = usePrivy();
  const { evm: wallet, solanaAddress } = useSiseraWallets();
  const solana = solanaAddress ?? getPrivySolanaAddress(user);
  const [origin, setOrigin] = useState(8453);
  // Hyperliquid (1337) delivers straight to the trading account for perps; Solana (792703809) for spot.
  const [destination, setDestination] = useState<1337 | 792703809>(1337);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quotedAt, setQuotedAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const recipient = destination === 792703809 ? solana : wallet?.address;

  useEffect(() => {
    if (!authenticated) {
      setRequestId(null);
      setQuote(null);
      return;
    }
    let active = true;
    const load = () => {
      void fetch("/api/bridge", { cache: "no-store" })
        .then(async (response) => (response.ok ? response.json() : null))
        .then((payload) => {
          const latest = payload?.data?.[0]?.requestId;
          if (active)
            setRequestId(
              typeof latest === "string" && /^0x[a-fA-F0-9]{64}$/.test(latest) ? latest : null,
            );
        })
        .catch(() => undefined);
    };
    load();
    window.addEventListener("sisera:session-renewed", load);
    return () => {
      active = false;
      window.removeEventListener("sisera:session-renewed", load);
    };
  }, [authenticated]);

  async function getQuote() {
    if (!wallet) throw new Error("Connect an EVM source wallet first.");
    if (!recipient)
      throw new Error(
        destination === 792703809
          ? "Sign in to create your Solana wallet first."
          : "An EVM destination wallet is required.",
      );
    const response = await fetch("/api/bridge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        originChainId: origin,
        destinationChainId: destination,
        user: wallet.address,
        recipient,
        amountUsdc: amount,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? "No bridge route is available.");
    setQuote(payload.data);
    setQuotedAt(Date.now());
    setMessage("Review the expected USDC output and fees, then confirm in your wallet.");
  }

  async function submit() {
    if (!wallet || !quote || !recipient) throw new Error("Request a quote first.");
    if (Date.now() - quotedAt > 60_000) throw new Error("Quote expired. Request a fresh quote.");
    if (
      quote.originChainId !== origin ||
      quote.destinationChainId !== destination ||
      quote.recipient !== recipient
    )
      throw new Error("Bridge details changed. Request a fresh quote.");
    const { trackingDelayed: accountTrackingDelayed } = await executeRelaySteps({
      wallet,
      originChainId: origin,
      requestId: quote.requestId,
      steps: quote.steps,
      onProgress: setMessage,
      onSubmitted: () => {
        if (quote.requestId) setRequestId(quote.requestId);
        setQuote(null);
      },
    });
    setMessage(
      accountTrackingDelayed
        ? "Source transaction confirmed. Relay is delivering USDC. Account history may take time to update; refresh the bridge status before retrying."
        : "Source transaction confirmed. Relay is delivering USDC to your destination wallet.",
    );
  }

  async function checkStatus() {
    if (!requestId) return;
    const response = await fetch(`/api/bridge?requestId=${encodeURIComponent(requestId)}`, {
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? "Status unavailable.");
    setMessage(
      `Bridge status: ${payload.data.status}${payload.data.txHashes?.length ? ` · destination transaction ${payload.data.txHashes[0]}` : ""}`,
    );
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Bridge request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="m-4 border border-line bg-panel p-5 md:m-6">
      <p className="eyebrow">Cross-chain funding</p>
      <h2 className="mt-2 text-base font-semibold text-slate-100">Bridge USDC in Sisera</h2>
      <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-400">
        Bridge USDC · wallet signature required.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-slate-400">
          From{" "}
          <select
            value={origin}
            onChange={(event) => {
              setOrigin(Number(event.target.value));
              setQuote(null);
            }}
            className="mt-1 w-full rounded border border-line bg-ink-raised p-2 text-slate-100"
          >
            {chains.map((chain) => (
              <option key={chain.id} value={chain.id}>
                {chain.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400">
          To{" "}
          <select
            value={destination}
            onChange={(event) => {
              setDestination(Number(event.target.value) as 1337 | 792703809);
              setQuote(null);
            }}
            className="mt-1 w-full rounded border border-line bg-ink-raised p-2 text-slate-100"
          >
            <option value={1337}>Hyperliquid · trading account (perps)</option>
            <option value={792703809}>Solana · stocks &amp; predictions</option>
          </select>
        </label>
        <label className="text-xs text-slate-400">
          Amount in USDC{" "}
          <input
            type="number"
            min="5"
            max="10000"
            step="0.000001"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setQuote(null);
            }}
            className="mt-1 w-full rounded border border-line bg-ink-raised p-2 text-slate-100"
            placeholder="100"
          />
        </label>
      </div>
      <p className="mt-3 break-all font-mono text-[10px] text-slate-500">
        Destination: {recipient ?? "Choose a destination wallet"}
      </p>
      {!wallet && authenticated && (
        <p className="mt-4 text-xs text-slate-400">Setting up your EVM wallet…</p>
      )}
      {wallet && (
        <button
          type="button"
          disabled={busy || !amount || !recipient}
          onClick={() => run(getQuote)}
          className="mt-4 rounded border border-bronze-400/30 bg-bronze-400/10 px-3 py-2 text-xs text-bronze-300 disabled:opacity-50"
        >
          Get bridge quote
        </button>
      )}
      {quote && (
        <div className="mt-4 rounded border border-line bg-ink-raised p-4 text-xs text-slate-300">
          <p>
            Expected destination amount: <strong>{quote.outputAmountUsdc} USDC</strong>
          </p>
          {quote.timeEstimateSeconds && (
            <p className="mt-1">Estimated time: {Math.ceil(quote.timeEstimateSeconds / 60)} min</p>
          )}
          {Object.entries(quote.fees)
            .filter(([, fee]) => Number(fee?.amountUsd) > 0)
            .map(([name, fee]) => (
              <p key={name} className="mt-1">
                {name}: ${fee.amountUsd}
              </p>
            ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => run(submit)}
            className="mt-3 rounded border border-bronze-400/30 bg-bronze-400/10 px-3 py-2 font-semibold text-bronze-300 disabled:opacity-50"
          >
            Confirm bridge in wallet
          </button>
        </div>
      )}
      {requestId && (
        <button
          type="button"
          disabled={busy}
          onClick={() => run(checkStatus)}
          className="mt-4 rounded border border-line px-3 py-2 text-xs text-slate-300"
        >
          Refresh bridge status
        </button>
      )}
      {message && <output className="mt-3 block text-xs text-amber-200">{message}</output>}
      <p className="mt-3 text-[11px] text-slate-500">
        Hyperliquid deliveries land in your perps balance, ready to trade. Hyperliquid needs at
        least 5 USDC to arrive after fees.
      </p>
    </section>
  );
}
