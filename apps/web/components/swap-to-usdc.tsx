"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SolanaWallet } from "../lib/api";
import { useSolanaSigner } from "../lib/use-solana-signer";
import { EvmSwapToUsdc } from "./evm-swap-to-usdc";
import { useLiveCapability } from "./use-live-capability";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "So11111111111111111111111111111111111111112";
/** Matches the API: converting SOL always leaves 0.01 SOL for network fees. */
const SOL_RESERVE = 10_000_000n;

type Asset = { mint: string; symbol: string; decimals: number; spendable: bigint };
type Preview = { outAmount: string; priceImpactFraction: number | null };
type Prepared = {
  orderId: string;
  transaction: string;
  wallet: string;
  inputMint: string;
  inputDecimals: number;
  inAmount: string;
  outAmount: string;
  minOutAmount: string | null;
  priceImpactPct: number | null;
  feeBps: number | null;
  gasless: boolean;
  router: string;
  expiresAt: string;
};
type Result = { status: "confirmed" | "failed" | "unknown"; signature: string | null };

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

const usd = (raw: string) =>
  (Number(raw) / 1e6).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/**
 * Converts what users deposit into USDC, the currency every Sisera market settles in: Solana
 * tokens through Jupiter, and EVM tokens on any supported chain through Relay.
 */
export function SwapToUsdc({ excludedMints = [] }: { excludedMints?: readonly string[] }) {
  const [source, setSource] = useState<"solana" | "evm">("solana");
  return (
    <section id="swap" className="m-4 scroll-mt-20 border border-line bg-panel p-5 md:m-6">
      <p className="eyebrow">Trading funds</p>
      <h2 className="mt-2 text-base font-semibold text-slate-100">Swap to USDC</h2>
      <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-400">
        Sisera markets settle in USDC. Convert any token you deposited at the best available price:
        Solana tokens are routed by Jupiter, and tokens on Ethereum, Base, Arbitrum and other EVM
        chains by Relay. Your wallet signs every swap.
      </p>
      <div role="tablist" aria-label="Swap from" className="mt-4 flex gap-1 border-b border-line">
        {(
          [
            ["solana", "Solana wallet"],
            ["evm", "EVM wallet"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={source === value}
            onClick={() => setSource(value)}
            className={`-mb-px border-b-2 px-3 py-2 text-xs ${source === value ? "border-bronze-400 text-bronze-300" : "border-transparent text-slate-400"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {source === "solana" ? <SolanaSwap excludedMints={excludedMints} /> : <EvmSwapToUsdc />}
    </section>
  );
}

function SolanaSwap({ excludedMints }: { excludedMints: readonly string[] }) {
  const router = useRouter();
  const signer = useSolanaSigner();
  const liveAvailable = useLiveCapability("solana");
  const [wallet, setWallet] = useState<SolanaWallet | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [mint, setMint] = useState("");
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const address = signer.address;

  const loadWallet = useCallback(async () => {
    if (!address) return;
    try {
      const response = await fetch(`/api/wallet?address=${encodeURIComponent(address)}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Wallet balances are unavailable.");
      setWallet(payload.data);
      setWalletError(null);
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Wallet balances are unavailable.");
    }
  }, [address]);

  useEffect(() => {
    const load = () => void loadWallet();
    load();
    window.addEventListener("sisera:session-renewed", load);
    return () => window.removeEventListener("sisera:session-renewed", load);
  }, [loadWallet]);

  const assets = useMemo<Asset[]>(() => {
    if (!wallet) return [];
    const excluded = new Set([USDC, SOL, ...excludedMints]);
    const sol = BigInt(wallet.solLamports) - SOL_RESERVE;
    return [
      ...(sol > 0n ? [{ mint: SOL, symbol: "SOL", decimals: 9, spendable: sol }] : []),
      ...wallet.holdings
        .filter((holding) => !excluded.has(holding.mint) && BigInt(holding.rawBalance) > 0n)
        .map((holding) => ({
          mint: holding.mint,
          symbol: holding.symbol ?? holding.name ?? `${holding.mint.slice(0, 4)}…`,
          decimals: holding.decimals,
          spendable: BigInt(holding.rawBalance),
        })),
    ];
  }, [wallet, excludedMints]);
  const asset = assets.find((item) => item.mint === mint) ?? assets[0] ?? null;
  const usdcBalance = wallet?.holdings.find((holding) => holding.mint === USDC)?.rawBalance ?? "0";

  const raw = useMemo(() => {
    if (!asset || !amount) return null;
    try {
      return toRaw(amount, asset.decimals);
    } catch {
      return null;
    }
  }, [amount, asset]);

  useEffect(() => {
    setPreview(null);
    if (!asset || raw == null || raw > asset.spendable) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void fetch(
        `/api/swap?${new URLSearchParams({ inputMint: asset.mint, amount: raw.toString() })}`,
        { cache: "no-store" },
      )
        .then(async (response) => {
          const payload = await response.json();
          if (!active) return;
          if (!response.ok) setMessage(payload.message ?? "No swap route is available.");
          else {
            setPreview(payload.data);
            setMessage(null);
          }
        })
        .catch(() => undefined);
    }, 400);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [asset, raw]);

  function reset() {
    setPrepared(null);
    setResult(null);
    setMessage(null);
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

  async function review() {
    if (!liveAvailable) throw new Error("Swaps are paused right now. Try again shortly.");
    if (!signer.address || !asset) throw new Error("Connect your Solana wallet first.");
    const value = toRaw(amount, asset.decimals);
    if (value > asset.spendable)
      throw new Error(
        asset.mint === SOL
          ? "Not enough SOL. Sisera keeps 0.01 SOL in your wallet for network fees."
          : `Not enough ${asset.symbol} in this wallet.`,
      );
    const response = await fetch("/api/swap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "prepare",
        wallet: signer.address,
        inputMint: asset.mint,
        amount: value.toString(),
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? "This swap could not be prepared.");
    setPrepared(payload.data);
  }

  async function confirm() {
    if (!prepared) return;
    if (Date.now() > Date.parse(prepared.expiresAt)) {
      setPrepared(null);
      throw new Error("This quote expired. Review the swap again for a fresh price.");
    }
    if (prepared.wallet !== signer.address)
      throw new Error("The selected wallet changed. Review the swap again.");
    const [signedTransaction] = await signer.signAll([prepared.transaction]);
    const response = await fetch("/api/swap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "execute", orderId: prepared.orderId, signedTransaction }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? "The swap could not be completed.");
    setResult(payload.data);
    setPrepared(null);
    if (payload.data.status === "confirmed") setAmount("");
    await loadWallet();
    router.refresh();
  }

  return (
    <div>
      {wallet && (
        <p className="mt-4 text-xs text-slate-400">
          USDC available on Solana:{" "}
          <span className="font-mono text-slate-100">${usd(usdcBalance)}</span>
        </p>
      )}

      {!signer.address && (
        <p className="mt-4 text-xs text-slate-400">Sign in to swap tokens in your Solana wallet.</p>
      )}
      {walletError && <p className="mt-4 text-xs text-amber-300">{walletError}</p>}
      {wallet && !assets.length && (
        <p className="mt-4 text-xs text-slate-500">
          There is nothing to convert in this wallet. Tokens you send to{" "}
          <span className="break-all font-mono">{wallet.address}</span> will appear here.
        </p>
      )}

      {asset && (
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1.2fr]">
          <label className="text-xs text-slate-400">
            From
            <select
              value={asset.mint}
              onChange={(event) => {
                setMint(event.target.value);
                setAmount("");
                reset();
              }}
              className="mt-1 w-full rounded border border-line bg-ink-raised p-2 text-slate-100"
            >
              {assets.map((item) => (
                <option key={item.mint} value={item.mint}>
                  {item.symbol} · {Number(fromRaw(item.spendable, item.decimals)).toLocaleString()}
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
                  setAmount(fromRaw(asset.spendable, asset.decimals));
                  reset();
                }}
                className="rounded border border-line px-3 text-[11px] text-slate-300"
              >
                Max
              </button>
            </div>
          </label>
        </div>
      )}
      {asset?.mint === SOL && (
        <p className="mt-2 text-[11px] text-slate-500">
          0.01 SOL stays in your wallet for network fees.
        </p>
      )}

      {asset && preview && !prepared && (
        <p className="mt-3 font-mono text-xs text-slate-300">
          ≈ ${usd(preview.outAmount)} USDC
          {preview.priceImpactFraction != null && (
            <span className="ml-3 text-slate-500">
              Price impact {(preview.priceImpactFraction * 100).toFixed(2)}%
            </span>
          )}
        </p>
      )}

      {asset && !prepared && (
        <button
          type="button"
          disabled={working || raw == null || !signer.ready}
          onClick={() => run(review)}
          className="mt-4 rounded border border-bronze-400/30 bg-bronze-400/10 px-4 py-2 text-xs font-semibold text-bronze-300 disabled:opacity-50"
        >
          {working ? "Getting best route…" : "Review swap"}
        </button>
      )}

      {prepared && (
        <div className="mt-4 rounded border border-line bg-ink-raised p-4 text-xs text-slate-300">
          <p>
            Swap{" "}
            <strong>
              {fromRaw(prepared.inAmount, prepared.inputDecimals)} {asset?.symbol}
            </strong>{" "}
            for about <strong>${usd(prepared.outAmount)} USDC</strong>
          </p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 font-mono text-[11px]">
            {prepared.minOutAmount && (
              <>
                <dt className="text-slate-500">Minimum received</dt>
                <dd>${usd(prepared.minOutAmount)} USDC</dd>
              </>
            )}
            {prepared.priceImpactPct != null && (
              <>
                <dt className="text-slate-500">Price impact</dt>
                <dd>{prepared.priceImpactPct.toFixed(2)}%</dd>
              </>
            )}
            {prepared.feeBps != null && (
              <>
                <dt className="text-slate-500">Routing fee</dt>
                <dd>{(prepared.feeBps / 100).toFixed(2)}%</dd>
              </>
            )}
            <dt className="text-slate-500">Network fee</dt>
            <dd>{prepared.gasless ? "Covered by Jupiter" : "Paid in SOL from your wallet"}</dd>
            <dt className="text-slate-500">Route</dt>
            <dd>Jupiter · {prepared.router}</dd>
          </dl>
          <div className="mt-4 flex gap-2">
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
            This quote is held for 45 seconds. Review again if it expires.
          </p>
        </div>
      )}

      {result && (
        <p
          className={`mt-4 text-xs ${result.status === "confirmed" ? "text-emerald-300" : "text-amber-200"}`}
        >
          {result.status === "confirmed"
            ? "Swap complete. Your USDC is ready to trade."
            : result.status === "failed"
              ? "The swap failed and no tokens were exchanged. Review it again for a fresh quote."
              : "The swap was submitted but is not confirmed yet. Check your wallet before retrying."}
          {result.signature && (
            <a
              href={`https://solscan.io/tx/${result.signature}`}
              target="_blank"
              rel="noreferrer"
              className="ml-2 text-bronze-300 underline"
            >
              View transaction ↗
            </a>
          )}
        </p>
      )}
      {message && <output className="mt-3 block text-xs text-amber-200">{message}</output>}
    </div>
  );
}
