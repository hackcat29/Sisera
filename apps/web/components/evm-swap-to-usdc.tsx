"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getPrivySolanaAddress } from "../lib/privy-identity";
import { type RelayStep, executeRelaySteps, waitForRelay } from "../lib/relay-execute";
import { useSiseraWallets } from "../lib/use-sisera-wallets";

const SOLANA = 792703809;
const HYPEREVM = 999;
/** Relay's chain ID for the Hyperliquid trading account. */
const HYPERLIQUID = 1337;
type Destination = typeof SOLANA | typeof HYPEREVM | typeof HYPERLIQUID;
const CHAINS = [
  { id: 1, name: "Ethereum" },
  { id: 8453, name: "Base" },
  { id: 42161, name: "Arbitrum" },
  { id: 10, name: "Optimism" },
  { id: 137, name: "Polygon" },
  { id: 56, name: "BNB Chain" },
  { id: 999, name: "HyperEVM" },
];

type Asset = {
  chainId: number;
  chain: string;
  address: string;
  symbol: string;
  decimals: number;
  rawBalance: string;
  spendableRaw: string;
  native: boolean;
  usdc: boolean;
};
type Fee = { amountUsd?: string };
type Quote = {
  requestId: string;
  steps: RelayStep[];
  fees: Record<string, Fee | undefined>;
  outputAmountUsdc: string;
  minimumOutputUsdc: string | null;
  timeEstimateSeconds: number | null;
  originChainId: number;
  originChain: string;
  destinationChainId: number;
  originCurrency: string;
  originAmount: string;
  originDecimals: number;
  recipient: string;
  swapImpactPct: number | null;
};

const keyOf = (asset: Pick<Asset, "chainId" | "address">) =>
  `${asset.chainId}:${asset.address.toLowerCase()}`;

function toRaw(value: string, decimals: number) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error("Enter a valid amount.");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error(`Use at most ${decimals} decimal places.`);
  const raw =
    BigInt(whole ?? "0") * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (raw <= 0n) throw new Error("Enter an amount above zero.");
  return raw;
}

function fromRaw(raw: bigint | string, decimals: number) {
  const value = BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${value / scale}.${fraction}` : String(value / scale);
}

const money = (value: string | number) =>
  Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Swaps any token in the account's EVM wallet into USDC on Solana or HyperEVM, routed by Relay.
 * The wallet signs an approval (for ERC-20s) and the swap; Relay delivers USDC to the account.
 */
export function EvmSwapToUsdc() {
  const { authenticated, user } = usePrivy();
  const { evm: wallet, solanaAddress } = useSiseraWallets();
  const solana = solanaAddress ?? getPrivySolanaAddress(user);
  const owner = wallet?.address ?? null;
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [unavailable, setUnavailable] = useState<number[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [destination, setDestination] = useState<Destination>(SOLANA);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quotedAt, setQuotedAt] = useState(0);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<{ requestId: string; delivered: boolean } | null>(null);
  const [customChain, setCustomChain] = useState(8453);
  const [customToken, setCustomToken] = useState("");
  const recipient = destination === SOLANA ? solana : owner;

  const loadAssets = useCallback(async () => {
    if (!owner) return;
    try {
      const response = await fetch(`/api/evm-assets?address=${owner}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "EVM wallet balances are unavailable.");
      setAssets((current) => {
        const loaded: Asset[] = payload.data.assets;
        const custom = (current ?? []).filter(
          (asset) => !loaded.some((item) => keyOf(item) === keyOf(asset)),
        );
        return [...loaded, ...custom];
      });
      setUnavailable(payload.data.unavailableChainIds ?? []);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "EVM wallet balances are unavailable.");
    }
  }, [owner]);

  useEffect(() => {
    const load = () => void loadAssets();
    load();
    window.addEventListener("sisera:session-renewed", load);
    return () => window.removeEventListener("sisera:session-renewed", load);
  }, [loadAssets]);

  const choices = useMemo(
    () =>
      (assets ?? []).filter(
        (asset) =>
          BigInt(asset.spendableRaw) > 0n &&
          !(asset.usdc && asset.chainId === HYPEREVM && destination === HYPEREVM),
      ),
    [assets, destination],
  );
  const asset = choices.find((item) => keyOf(item) === selected) ?? choices[0] ?? null;

  function reset() {
    setQuote(null);
    setMessage(null);
    setDone(null);
  }

  async function run(action: () => Promise<void>) {
    setWorking(true);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The swap could not be completed.");
    } finally {
      setWorking(false);
    }
  }

  async function addToken() {
    if (!owner) throw new Error("Your EVM wallet is still being set up.");
    if (!/^0x[a-fA-F0-9]{40}$/.test(customToken.trim()))
      throw new Error("Paste the token's 0x contract address.");
    const response = await fetch(
      `/api/evm-assets?${new URLSearchParams({ address: owner, chainId: String(customChain), token: customToken.trim() })}`,
      { cache: "no-store" },
    );
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? "This token could not be found.");
    const token: Asset = payload.data;
    if (BigInt(token.rawBalance) === 0n)
      throw new Error(`Your wallet holds no ${token.symbol} on ${token.chain}.`);
    setAssets((current) => [
      ...(current ?? []).filter((item) => keyOf(item) !== keyOf(token)),
      token,
    ]);
    setSelected(keyOf(token));
    setCustomToken("");
    setAmount("");
    reset();
  }

  async function getQuote() {
    if (!owner || !asset) throw new Error("Choose a token to swap.");
    if (!recipient)
      throw new Error(
        destination === SOLANA ? "Your Solana wallet is still being set up." : "No EVM wallet.",
      );
    const raw = toRaw(amount, asset.decimals);
    if (raw > BigInt(asset.spendableRaw))
      throw new Error(
        asset.native
          ? `Not enough ${asset.symbol}. Some is kept back for network fees.`
          : `Not enough ${asset.symbol} in this wallet.`,
      );
    const response = await fetch("/api/bridge/swap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        originChainId: asset.chainId,
        destinationChainId: destination,
        originCurrency: asset.address,
        amount: raw.toString(),
        user: owner,
        recipient,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? "No swap route is available.");
    setQuote(payload.data);
    setQuotedAt(Date.now());
  }

  async function confirm() {
    if (!wallet || !quote) throw new Error("Request a quote first.");
    if (Date.now() - quotedAt > 60_000) {
      setQuote(null);
      throw new Error("This quote expired. Get a new quote for a fresh price.");
    }
    if (quote.recipient !== recipient || quote.destinationChainId !== destination)
      throw new Error("Swap details changed. Get a new quote.");
    const { requestId } = quote;
    await executeRelaySteps({
      wallet,
      originChainId: quote.originChainId,
      requestId,
      steps: quote.steps,
      onProgress: setMessage,
      onSubmitted: () => setQuote(null),
    });
    setAmount("");
    setDone({ requestId, delivered: false });
    setMessage("Swap submitted. Relay is delivering your USDC…");
    // Delivery is tracked in the background so the panel is free for the next swap.
    const chainName =
      destination === SOLANA ? "Solana" : destination === HYPERLIQUID ? "Hyperliquid" : "HyperEVM";
    void waitForRelay(requestId, (status) =>
      setMessage(`Delivery status: ${status.status.replaceAll("_", " ")}`),
    ).then((final) => {
      const delivered = final?.status.toLowerCase() === "success";
      setDone({ requestId, delivered });
      setMessage(
        delivered
          ? `USDC delivered to your ${chainName} wallet.`
          : final
            ? `Relay reported ${final.status}. If the swap could not complete, Relay refunds your wallet.`
            : "Still delivering. Track it in Activity; most swaps settle within a few minutes.",
      );
      void loadAssets();
    });
  }

  if (!authenticated)
    return (
      <p className="mt-4 text-xs text-slate-400">Sign in to swap tokens in your EVM wallet.</p>
    );

  const steps = quote?.steps.length ?? 0;
  const approval = quote?.steps.some((step) => step.id === "approve" || step.id === "approval");

  return (
    <div className="mt-4">
      {!owner && <p className="text-xs text-slate-400">Setting up your EVM wallet…</p>}
      {loadError && <p className="text-xs text-amber-300">{loadError}</p>}
      {owner && assets && !choices.length && (
        <p className="text-xs text-slate-500">
          No tokens to convert yet. Send tokens on any supported chain to{" "}
          <span className="break-all font-mono">{owner}</span>, or add a token by address below.
        </p>
      )}
      {unavailable.length > 0 && (
        <p className="mb-2 text-[11px] text-slate-500">
          Balances on{" "}
          {unavailable.map((id) => CHAINS.find((chain) => chain.id === id)?.name ?? id).join(", ")}{" "}
          are temporarily unavailable.
        </p>
      )}

      {asset && (
        <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr_1fr]">
          <label className="text-xs text-slate-400">
            From
            <select
              value={keyOf(asset)}
              onChange={(event) => {
                setSelected(event.target.value);
                setAmount("");
                reset();
              }}
              className="mt-1 w-full rounded border border-line bg-ink-raised p-2 text-slate-100"
            >
              {choices.map((item) => (
                <option key={keyOf(item)} value={keyOf(item)}>
                  {item.symbol} · {item.chain} ·{" "}
                  {Number(fromRaw(item.spendableRaw, item.decimals)).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-400">
            Amount
            <div className="mt-1 flex gap-2">
              <input
                inputMode="decimal"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value.trim());
                  reset();
                }}
                placeholder="0.0"
                className="min-w-0 flex-1 rounded border border-line bg-ink-raised p-2 font-mono text-slate-100"
              />
              <button
                type="button"
                onClick={() => {
                  setAmount(fromRaw(asset.spendableRaw, asset.decimals));
                  reset();
                }}
                className="rounded border border-line px-3 text-[11px] text-slate-300"
              >
                Max
              </button>
            </div>
          </label>
          <label className="text-xs text-slate-400">
            Receive USDC on
            <select
              value={destination}
              onChange={(event) => {
                setDestination(Number(event.target.value) as Destination);
                reset();
              }}
              className="mt-1 w-full rounded border border-line bg-ink-raised p-2 text-slate-100"
            >
              <option value={SOLANA}>Solana · stocks & predictions</option>
              <option value={HYPERLIQUID}>Hyperliquid · perps account</option>
              <option value={HYPEREVM}>HyperEVM</option>
            </select>
          </label>
        </div>
      )}
      {asset?.native && (
        <p className="mt-2 text-[11px] text-slate-500">
          A little {asset.symbol} stays in your wallet for network fees.
        </p>
      )}

      {asset && !quote && (
        <button
          type="button"
          disabled={working || !amount || !wallet}
          onClick={() => run(getQuote)}
          className="mt-4 rounded border border-bronze-400/30 bg-bronze-400/10 px-4 py-2 text-xs font-semibold text-bronze-300 disabled:opacity-50"
        >
          {working ? "Finding best route…" : "Get swap quote"}
        </button>
      )}

      {quote && asset && (
        <div className="mt-4 rounded border border-line bg-ink-raised p-4 text-xs text-slate-300">
          <p>
            Swap{" "}
            <strong>
              {fromRaw(quote.originAmount, quote.originDecimals)} {asset.symbol}
            </strong>{" "}
            on {quote.originChain} for about <strong>${money(quote.outputAmountUsdc)} USDC</strong>{" "}
            on{" "}
            {quote.destinationChainId === SOLANA
              ? "Solana"
              : quote.destinationChainId === HYPERLIQUID
                ? "Hyperliquid"
                : "HyperEVM"}
          </p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 font-mono text-[11px]">
            {quote.minimumOutputUsdc && (
              <>
                <dt className="text-slate-500">Minimum received</dt>
                <dd>${money(quote.minimumOutputUsdc)} USDC</dd>
              </>
            )}
            {quote.swapImpactPct != null && (
              <>
                <dt className="text-slate-500">Price impact</dt>
                <dd>{Math.abs(quote.swapImpactPct).toFixed(2)}%</dd>
              </>
            )}
            {quote.fees.gas?.amountUsd && (
              <>
                <dt className="text-slate-500">Network fee</dt>
                <dd>${money(quote.fees.gas.amountUsd)}</dd>
              </>
            )}
            {quote.fees.app?.amountUsd && Number(quote.fees.app.amountUsd) > 0 && (
              <>
                <dt className="text-slate-500">Sisera fee</dt>
                <dd>${money(quote.fees.app.amountUsd)}</dd>
              </>
            )}
            {quote.fees.relayer?.amountUsd && Number(quote.fees.relayer.amountUsd) > 0 && (
              <>
                <dt className="text-slate-500">Relay fee</dt>
                <dd>${money(quote.fees.relayer.amountUsd)}</dd>
              </>
            )}
            {quote.timeEstimateSeconds != null && (
              <>
                <dt className="text-slate-500">Estimated time</dt>
                <dd>
                  {quote.timeEstimateSeconds < 60
                    ? `${quote.timeEstimateSeconds}s`
                    : `${Math.ceil(quote.timeEstimateSeconds / 60)} min`}
                </dd>
              </>
            )}
            <dt className="text-slate-500">Route</dt>
            <dd>Relay</dd>
          </dl>
          <p className="mt-3 text-[11px] text-slate-500">
            {approval
              ? `Your wallet will ask you to approve ${asset.symbol}, then confirm the swap (${steps} steps).`
              : "Your wallet will ask you to confirm one transaction."}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={working}
              onClick={() => run(confirm)}
              className="rounded border border-bronze-400/30 bg-bronze-400/10 px-4 py-2 font-semibold text-bronze-300 disabled:opacity-50"
            >
              {working ? "Waiting for wallet…" : "Confirm swap in wallet"}
            </button>
            <button
              type="button"
              disabled={working}
              onClick={reset}
              className="rounded border border-line px-3 py-2 text-slate-400"
            >
              Cancel
            </button>
          </div>
          <p className="mt-2 text-[10px] text-slate-500">
            This quote is held for 60 seconds. Get a new quote if it expires.
          </p>
        </div>
      )}

      {message && (
        <output
          className={`mt-3 block text-xs ${done?.delivered ? "text-emerald-300" : "text-amber-200"}`}
        >
          {message}
        </output>
      )}
      {done && (
        <p className="mt-1 break-all font-mono text-[10px] text-slate-500">
          Relay request {done.requestId}
        </p>
      )}

      {owner && (
        <details className="mt-5 border-t border-line pt-3">
          <summary className="cursor-pointer text-[11px] text-slate-400">
            Don&apos;t see your token? Add it by contract address
          </summary>
          <div className="mt-3 flex flex-wrap gap-2">
            <select
              value={customChain}
              onChange={(event) => setCustomChain(Number(event.target.value))}
              aria-label="Token chain"
              className="rounded border border-line bg-ink-raised p-2 text-xs text-slate-100"
            >
              {CHAINS.map((chain) => (
                <option key={chain.id} value={chain.id}>
                  {chain.name}
                </option>
              ))}
            </select>
            <input
              value={customToken}
              onChange={(event) => setCustomToken(event.target.value)}
              placeholder="0x… token contract"
              aria-label="Token contract address"
              className="min-w-64 flex-1 rounded border border-line bg-ink-raised p-2 font-mono text-xs text-slate-100"
            />
            <button
              type="button"
              disabled={working || !customToken}
              onClick={() => run(addToken)}
              className="rounded border border-line px-3 py-2 text-xs text-slate-300 disabled:opacity-50"
            >
              Add token
            </button>
          </div>
        </details>
      )}
    </div>
  );
}
