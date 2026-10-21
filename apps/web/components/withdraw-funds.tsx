"use client";

import { usePrivy } from "@privy-io/react-auth";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpFromLine, ExternalLink, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { type Address, encodeFunctionData, erc20Abi, isAddress } from "viem";
import type { SolanaWallet } from "../lib/api";
import { announcePerpTrade, useHyperliquidAccount, withdraw } from "../lib/hyperliquid";
import { fromRaw, toRaw } from "../lib/token-amount";
import { useSiseraWallets } from "../lib/use-sisera-wallets";
import { useSolanaSigner } from "../lib/use-solana-signer";

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** The smallest swap the API tries when buying SOL for fees. */
const MIN_TOP_UP_USDC = 2_000_000n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const EXPLORERS: Record<number, string> = {
  1: "https://etherscan.io/tx/",
  8453: "https://basescan.org/tx/",
  42161: "https://arbiscan.io/tx/",
  10: "https://optimistic.etherscan.io/tx/",
  137: "https://polygonscan.com/tx/",
  56: "https://bscscan.com/tx/",
  999: "https://hyperevmscan.io/tx/",
};
/** A prepared Solana transfer uses a recent blockhash, which expires after about a minute. */
const REVIEW_TTL_MS = 50_000;

const inputClass =
  "h-10 w-full rounded border border-line bg-ink-raised px-3 text-sm text-white placeholder:text-slate-600 focus:border-bronze-400/60 focus:outline-none";

type Done = { title: string; detail: string; link: string | null };

function Field({
  label,
  htmlFor,
  children,
  hint,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
  hint?: string | undefined;
}) {
  return (
    <div className="text-xs">
      <label htmlFor={htmlFor} className="text-slate-400">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

function AmountInput({
  value,
  onChange,
  onMax,
  symbol,
}: {
  value: string;
  onChange: (value: string) => void;
  onMax: () => void;
  symbol: string;
}) {
  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <input
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value.trim())}
          id="withdraw-amount"
          placeholder="0.00"
          aria-label={`Amount in ${symbol}`}
          className={`${inputClass} pr-16 text-right font-mono`}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
          {symbol}
        </span>
      </div>
      <button
        type="button"
        onClick={onMax}
        className="h-10 rounded border border-line px-3 text-xs text-slate-200 hover:border-bronze-400/50"
      >
        Max
      </button>
    </div>
  );
}

function Review({
  rows,
  warning,
  busy,
  onConfirm,
  onBack,
}: {
  rows: Array<[string, ReactNode]>;
  warning: string;
  busy: string | null;
  onConfirm: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-3">
      <dl className="divide-y divide-line rounded border border-line text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-3 px-3 py-2.5">
            <dt className="w-24 shrink-0 text-slate-400">{label}</dt>
            <dd className="min-w-0 flex-1 break-all text-right text-slate-100">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="rounded border border-amber-400/30 bg-amber-400/5 p-3 text-[11px] leading-5 text-amber-200">
        {warning} Transfers on a blockchain can't be reversed.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy != null}
          onClick={onConfirm}
          className="h-10 flex-1 rounded bg-bronze-300 text-sm font-semibold text-[#0b1b24] hover:bg-bronze-200 disabled:opacity-50"
        >
          {busy ?? "Confirm withdrawal"}
        </button>
        <button
          type="button"
          disabled={busy != null}
          onClick={onBack}
          className="h-10 rounded border border-line px-4 text-sm text-slate-200 disabled:opacity-50"
        >
          Edit
        </button>
      </div>
    </div>
  );
}

function Success({ done, onAgain }: { done: Done; onAgain: () => void }) {
  return (
    <div className="space-y-3 text-xs">
      <div className="rounded border border-emerald-400/30 bg-emerald-400/5 p-4">
        <p className="font-semibold text-emerald-200">{done.title}</p>
        <p className="mt-1 leading-5 text-slate-300">{done.detail}</p>
        {done.link && (
          <a
            href={done.link}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-bronze-300 hover:text-bronze-200"
          >
            View transaction <ExternalLink size={12} />
          </a>
        )}
      </div>
      <button type="button" onClick={onAgain} className="text-bronze-300 hover:text-bronze-200">
        Make another withdrawal
      </button>
    </div>
  );
}

function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="text-xs leading-5 text-rose-300">{message}</p>;
}

const shortAddress = (value: string) => `${value.slice(0, 6)}…${value.slice(-6)}`;

// ------------------------------------------------------------------------------------- Solana

type SolanaAsset = {
  id: string;
  symbol: string;
  decimals: number;
  balance: bigint;
  valueUsd: number | null;
};
type PreparedSolana = {
  transaction: string;
  asset: string;
  amount: string;
  decimals: number;
  networkFeeLamports: string;
  accountRentLamports: string;
  createsRecipientAccount: boolean;
  preparedAt: number;
};
type TopUp = { requestId: string; transaction: string; usdcAmount: string; solLamports: string };

function SolanaWithdraw({ onDone }: { onDone: (done: Done) => void }) {
  const signer = useSolanaSigner();
  const address = signer.address;
  const [wallet, setWallet] = useState<SolanaWallet | null>(null);
  const [assetId, setAssetId] = useState("SOL");
  const [amount, setAmount] = useState("");
  const [max, setMax] = useState(false);
  const [destination, setDestination] = useState("");
  const [prepared, setPrepared] = useState<PreparedSolana | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** Lamports the wallet is short for fees, when Sisera can buy them with USDC. */
  const [needsSol, setNeedsSol] = useState<string | null>(null);
  const [topUp, setTopUp] = useState<TopUp | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!address) return;
    try {
      const response = await fetch(`/api/wallet?address=${encodeURIComponent(address)}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Wallet balances are unavailable.");
      setWallet(payload.data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Wallet balances are unavailable.");
    }
  }, [address]);
  useEffect(() => void load(), [load]);

  const assets = useMemo<SolanaAsset[]>(() => {
    if (!wallet) return [];
    const tokens = wallet.holdings
      .filter((holding) => !holding.suspicious && BigInt(holding.rawBalance) > 0n)
      .map((holding) => ({
        id: holding.mint,
        symbol: holding.symbol ?? `${holding.mint.slice(0, 4)}…`,
        decimals: holding.decimals,
        balance: BigInt(holding.rawBalance),
        valueUsd: holding.valueUsd ?? null,
      }))
      .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
    return [
      {
        id: "SOL",
        symbol: "SOL",
        decimals: 9,
        balance: BigInt(wallet.solLamports),
        valueUsd: wallet.solValueUsd ?? null,
      },
      ...tokens,
    ];
  }, [wallet]);
  const asset = assets.find((item) => item.id === assetId) ?? assets[0] ?? null;
  const usdcBalance = assets.find((item) => item.id === SOLANA_USDC)?.balance ?? 0n;

  async function review() {
    setNotice(null);
    if (!address || !asset) throw new Error("Your Solana wallet is still loading.");
    const to = destination.trim();
    if (!SOLANA_ADDRESS.test(to)) throw new Error("Enter a valid Solana wallet address.");
    if (to === address) throw new Error("That is this wallet's own address.");
    const native = asset.id === "SOL";
    const raw = max && native ? null : max ? asset.balance : toRaw(amount, asset.decimals);
    if (raw != null && raw > asset.balance)
      throw new Error(`You have ${fromRaw(asset.balance, asset.decimals)} ${asset.symbol}.`);
    const response = await fetch("/api/withdraw", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "prepare",
        wallet: address,
        destination: to,
        asset: asset.id,
        ...(raw == null ? { max: true } : { amount: raw.toString() }),
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      // Short only of SOL for fees: offer to buy some with USDC instead of sending them away.
      if (payload.error === "needs_sol" && usdcBalance >= MIN_TOP_UP_USDC) {
        setNeedsSol(String(payload.needsLamports));
        return;
      }
      throw new Error(payload.message ?? "This withdrawal could not be prepared.");
    }
    setNeedsSol(null);
    setPrepared({ ...payload.data, preparedAt: Date.now() });
  }

  async function quoteTopUp() {
    if (!address || !needsSol) return;
    const response = await fetch("/api/withdraw", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "topup-prepare", wallet: address, needsLamports: needsSol }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? "SOL for fees can't be bought right now.");
    setTopUp(payload.data);
  }

  async function confirmTopUp() {
    if (!address || !topUp || !asset) return;
    setBusy("Approve in your wallet…");
    const [signedTransaction] = await signer.signAll([topUp.transaction]);
    setBusy("Buying SOL…");
    const response = await fetch("/api/withdraw", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "topup-execute",
        wallet: address,
        requestId: topUp.requestId,
        transaction: topUp.transaction,
        signedTransaction,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? "The swap to SOL failed.");
    const spent = BigInt(topUp.usdcAmount);
    const left = usdcBalance - spent;
    let lowered = false;
    // Withdrawing USDC: the swap used some, so cap the amount at what is left.
    if (asset.id === SOLANA_USDC) {
      try {
        if (toRaw(amount, asset.decimals) > left) {
          setAmount(fromRaw(left, asset.decimals));
          lowered = true;
        }
      } catch {
        // The amount was not a number; leave it for the user to fix.
      }
    }
    setNotice(
      `Bought ${(Number(payload.data.solLamports ?? topUp.solLamports) / 1e9).toFixed(4)} SOL for $${fromRaw(spent, 6)} USDC. It stays in your wallet for fees.${lowered ? ` Your amount is now ${fromRaw(left, 6)} USDC, what's left after the swap.` : ""} Review your withdrawal again.`,
    );
    setTopUp(null);
    setNeedsSol(null);
    void load();
  }

  async function confirm() {
    if (!prepared || !address) return;
    if (Date.now() - prepared.preparedAt > REVIEW_TTL_MS) {
      setPrepared(null);
      throw new Error("This review expired. Review the withdrawal again.");
    }
    setBusy("Approve in your wallet…");
    const [signedTransaction] = await signer.signAll([prepared.transaction]);
    setBusy("Sending…");
    const response = await fetch("/api/withdraw", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "execute",
        wallet: address,
        transaction: prepared.transaction,
        signedTransaction,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? "The withdrawal could not be sent.");
    const { signature, status } = payload.data as { signature: string; status: string };
    if (status === "failed")
      throw new Error("The withdrawal failed on Solana. Nothing was sent; check your balance.");
    onDone({
      title: status === "confirmed" ? "Withdrawal sent" : "Withdrawal submitted",
      detail: `${fromRaw(prepared.amount, prepared.decimals)} ${asset?.symbol ?? ""} to ${shortAddress(destination.trim())} on Solana.${status === "confirmed" ? "" : " It should confirm within a minute."}`,
      link: `https://solscan.io/tx/${signature}`,
    });
    setPrepared(null);
    setAmount("");
    setMax(false);
    void load();
  }

  async function run(action: () => Promise<void>) {
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The withdrawal could not be completed.");
    } finally {
      setBusy(null);
    }
  }

  if (!signer.ready || !address)
    return <p className="text-xs text-slate-400">Your Solana wallet is still being set up…</p>;
  if (!wallet)
    return (
      <div className="space-y-2">
        <p className="text-xs text-slate-400">{message ? "" : "Loading balances…"}</p>
        <ErrorText message={message} />
      </div>
    );

  if (prepared && asset) {
    const fee = Number(prepared.networkFeeLamports) / 1e9;
    const rent = Number(prepared.accountRentLamports) / 1e9;
    return (
      <>
        <Review
          rows={[
            ["You send", `${fromRaw(prepared.amount, prepared.decimals)} ${asset.symbol}`],
            [
              "To",
              <span key="to" className="font-mono">
                {destination.trim()}
              </span>,
            ],
            ["Network", "Solana"],
            [
              "Network fee",
              `≈ ${fee.toFixed(6)} SOL${prepared.createsRecipientAccount ? ` + ${rent.toFixed(6)} SOL to open the recipient's ${asset.symbol} account` : ""}`,
            ],
          ]}
          warning={`Only send to a Solana address. If it's an exchange, check that it accepts ${asset.symbol} on the Solana network.`}
          busy={busy}
          onConfirm={() => void run(confirm)}
          onBack={() => setPrepared(null)}
        />
        <div className="mt-3">
          <ErrorText message={message} />
        </div>
      </>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy("Checking…");
        void run(review);
      }}
    >
      <Field label="Asset" htmlFor="withdraw-asset">
        <select
          id="withdraw-asset"
          value={asset?.id ?? ""}
          onChange={(event) => {
            setAssetId(event.target.value);
            setAmount("");
            setMax(false);
            setNeedsSol(null);
            setTopUp(null);
          }}
          className={inputClass}
        >
          {assets.map((item) => (
            <option key={item.id} value={item.id}>
              {item.symbol} · {fromRaw(item.balance, item.decimals)}
              {item.valueUsd != null ? ` ($${item.valueUsd.toFixed(2)})` : ""}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Amount"
        htmlFor="withdraw-amount"
        hint={
          asset?.id === "SOL"
            ? "Max sends all your SOL after the network fee. Keep some if you hold other tokens: moving them needs SOL for fees."
            : undefined
        }
      >
        <AmountInput
          value={max ? "Max" : amount}
          symbol={asset?.symbol ?? ""}
          onChange={(value) => {
            setMax(false);
            setAmount(value.replace(/^Max/, ""));
          }}
          onMax={() => {
            if (!asset) return;
            if (asset.id === "SOL") setMax(true);
            else setAmount(fromRaw(asset.balance, asset.decimals));
          }}
        />
      </Field>
      <Field label="Recipient Solana address" htmlFor="withdraw-destination">
        <input
          id="withdraw-destination"
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
          placeholder="Paste a Solana wallet address"
          spellCheck={false}
          autoComplete="off"
          className={`${inputClass} font-mono text-xs`}
        />
      </Field>
      {needsSol && (
        <div className="rounded border border-bronze-400/30 bg-bronze-400/[0.05] p-3 text-xs leading-5">
          <p className="font-semibold text-slate-100">Your wallet needs SOL for network fees</p>
          {topUp ? (
            <>
              <p className="mt-1 text-slate-300">
                Swap{" "}
                <span className="font-mono text-slate-100">
                  ${fromRaw(topUp.usdcAmount, 6)} USDC
                </span>{" "}
                for about{" "}
                <span className="font-mono text-slate-100">
                  {(Number(topUp.solLamports) / 1e9).toFixed(4)} SOL
                </span>
                . Jupiter pays this swap's network fee. The SOL stays in your wallet for future
                fees.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={busy != null}
                  onClick={() => void run(confirmTopUp)}
                  className="h-9 rounded bg-bronze-300 px-3 font-semibold text-[#0b1b24] disabled:opacity-50"
                >
                  {busy ?? "Confirm swap"}
                </button>
                <button
                  type="button"
                  disabled={busy != null}
                  onClick={() => setTopUp(null)}
                  className="h-9 rounded border border-line px-3 text-slate-200"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-1 text-slate-300">
                You need about {(Number(needsSol) / 1e9 + 0.0001).toFixed(4)} SOL more. Sisera can
                buy it with a little of your USDC (from $2) in one step.
              </p>
              <button
                type="button"
                disabled={busy != null}
                onClick={() => {
                  setBusy("Getting a quote…");
                  void run(quoteTopUp);
                }}
                className="mt-2 h-9 rounded bg-bronze-300 px-3 font-semibold text-[#0b1b24] disabled:opacity-50"
              >
                {busy ?? "Get SOL with USDC"}
              </button>
            </>
          )}
        </div>
      )}
      {notice && <p className="text-xs leading-5 text-emerald-300">{notice}</p>}
      <ErrorText message={message} />
      <button
        type="submit"
        disabled={busy != null || !asset || !destination.trim() || (!amount && !max)}
        className="h-10 w-full rounded bg-bronze-300 text-sm font-semibold text-[#0b1b24] hover:bg-bronze-200 disabled:opacity-40"
      >
        {busy ?? "Review withdrawal"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------------------- EVM

type EvmAsset = {
  chainId: number;
  chain: string;
  address: string;
  symbol: string;
  decimals: number;
  rawBalance: string;
  spendableRaw: string;
  native: boolean;
};
const keyOf = (asset: Pick<EvmAsset, "chainId" | "address">) =>
  `${asset.chainId}:${asset.address.toLowerCase()}`;

function EvmWithdraw({ onDone }: { onDone: (done: Done) => void }) {
  const { evm: wallet } = useSiseraWallets();
  const owner = wallet?.address ?? null;
  const [assets, setAssets] = useState<EvmAsset[] | null>(null);
  const [selected, setSelected] = useState("");
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [reviewing, setReviewing] = useState<{ raw: bigint; to: Address } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!owner) return;
    try {
      const response = await fetch(`/api/evm-assets?address=${owner}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "EVM wallet balances are unavailable.");
      setAssets(payload.data.assets);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "EVM wallet balances are unavailable.");
    }
  }, [owner]);
  useEffect(() => void load(), [load]);

  const choices = useMemo(
    () => (assets ?? []).filter((item) => BigInt(item.spendableRaw) > 0n),
    [assets],
  );
  const asset = choices.find((item) => keyOf(item) === selected) ?? choices[0] ?? null;

  function review() {
    if (!owner || !asset) throw new Error("Choose an asset to withdraw.");
    const to = destination.trim();
    if (!isAddress(to)) throw new Error("Enter a valid 0x address. Check the capital letters too.");
    if (to.toLowerCase() === ZERO_ADDRESS) throw new Error("That address can't receive funds.");
    if (to.toLowerCase() === owner.toLowerCase())
      throw new Error("That is this wallet's own address.");
    const raw = toRaw(amount, asset.decimals);
    if (raw > BigInt(asset.spendableRaw))
      throw new Error(
        asset.native
          ? `You can send up to ${fromRaw(asset.spendableRaw, asset.decimals)} ${asset.symbol}; the rest pays network fees.`
          : `You have ${fromRaw(asset.spendableRaw, asset.decimals)} ${asset.symbol} on ${asset.chain}.`,
      );
    if (!asset.native) {
      const gas = (assets ?? []).find(
        (item) => item.chainId === asset.chainId && item.native && BigInt(item.rawBalance) > 0n,
      );
      if (!gas) throw new Error(`Add a little of ${asset.chain}'s native token for network fees.`);
    }
    setReviewing({ raw, to: to as Address });
  }

  async function confirm() {
    if (!wallet || !asset || !reviewing) return;
    setBusy("Switching network…");
    await wallet.switchChain(asset.chainId);
    const provider = await wallet.getEthereumProvider();
    setBusy("Approve in your wallet…");
    const transaction = asset.native
      ? { from: wallet.address, to: reviewing.to, value: `0x${reviewing.raw.toString(16)}` }
      : {
          from: wallet.address,
          to: asset.address,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [reviewing.to, reviewing.raw],
          }),
        };
    const hash = (await provider.request({
      method: "eth_sendTransaction",
      params: [transaction],
    })) as string;
    setBusy("Waiting for confirmation…");
    let status: "confirmed" | "pending" = "pending";
    for (let attempt = 0; attempt < 45; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const receipt = (await provider
        .request({ method: "eth_getTransactionReceipt", params: [hash] })
        .catch(() => null)) as { status?: string } | null;
      if (!receipt) continue;
      if (receipt.status !== "0x1")
        throw new Error(`The withdrawal failed on ${asset.chain}. Your funds did not move.`);
      status = "confirmed";
      break;
    }
    onDone({
      title: status === "confirmed" ? "Withdrawal sent" : "Withdrawal submitted",
      detail: `${fromRaw(reviewing.raw, asset.decimals)} ${asset.symbol} to ${shortAddress(reviewing.to)} on ${asset.chain}.${status === "confirmed" ? "" : " It's still confirming; check the transaction for its status."}`,
      link: EXPLORERS[asset.chainId] ? `${EXPLORERS[asset.chainId]}${hash}` : null,
    });
    setReviewing(null);
    setAmount("");
    void load();
  }

  async function run(action: () => Promise<void> | void) {
    setMessage(null);
    try {
      await action();
    } catch (error) {
      const text = error instanceof Error ? error.message : "";
      setMessage(
        /reject|denied|cancel/i.test(text)
          ? "You cancelled the withdrawal in your wallet."
          : text || "The withdrawal could not be completed.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (!owner)
    return <p className="text-xs text-slate-400">Your EVM wallet is still being set up…</p>;
  if (!assets) return <p className="text-xs text-slate-400">Loading balances…</p>;
  if (!choices.length)
    return (
      <p className="text-xs leading-5 text-slate-400">
        Your EVM wallet has nothing to withdraw on Ethereum, Base, Arbitrum, Optimism, Polygon, BNB
        Chain or HyperEVM. For USDC in your Hyperliquid account, use the Hyperliquid tab.
      </p>
    );

  if (reviewing && asset)
    return (
      <>
        <Review
          rows={[
            ["You send", `${fromRaw(reviewing.raw, asset.decimals)} ${asset.symbol}`],
            [
              "To",
              <span key="to" className="font-mono">
                {reviewing.to}
              </span>,
            ],
            ["Network", asset.chain],
            ["Network fee", `Paid in ${asset.chain}'s native token; your wallet shows it.`],
          ]}
          warning={`Only send to an address on ${asset.chain}. If it's an exchange, check that it accepts ${asset.symbol} on ${asset.chain}.`}
          busy={busy}
          onConfirm={() => void run(confirm)}
          onBack={() => setReviewing(null)}
        />
        <div className="mt-3">
          <ErrorText message={message} />
        </div>
      </>
    );

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void run(review);
      }}
    >
      <Field label="Asset" htmlFor="withdraw-asset">
        <select
          id="withdraw-asset"
          value={asset ? keyOf(asset) : ""}
          onChange={(event) => {
            setSelected(event.target.value);
            setAmount("");
          }}
          className={inputClass}
        >
          {choices.map((item) => (
            <option key={keyOf(item)} value={keyOf(item)}>
              {item.symbol} on {item.chain} · {fromRaw(item.spendableRaw, item.decimals)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Amount" htmlFor="withdraw-amount">
        <AmountInput
          value={amount}
          symbol={asset?.symbol ?? ""}
          onChange={setAmount}
          onMax={() => asset && setAmount(fromRaw(asset.spendableRaw, asset.decimals))}
        />
      </Field>
      <Field
        label={`Recipient address on ${asset?.chain ?? "this network"}`}
        htmlFor="withdraw-destination"
      >
        <input
          id="withdraw-destination"
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
          placeholder="0x…"
          spellCheck={false}
          autoComplete="off"
          className={`${inputClass} font-mono text-xs`}
        />
      </Field>
      <ErrorText message={message} />
      <button
        type="submit"
        disabled={busy != null || !asset || !amount || !destination.trim()}
        className="h-10 w-full rounded bg-bronze-300 text-sm font-semibold text-[#0b1b24] hover:bg-bronze-200 disabled:opacity-40"
      >
        Review withdrawal
      </button>
    </form>
  );
}

// -------------------------------------------------------------------------------- Hyperliquid

/** Hyperliquid's flat withdrawal fee, deducted from the amount. */
const HYPERLIQUID_FEE_USD = 1;

function HyperliquidWithdraw({ onDone }: { onDone: (done: Done) => void }) {
  const { evm: wallet, evmAddress } = useSiseraWallets();
  const { account, error } = useHyperliquidAccount(evmAddress);
  const [amount, setAmount] = useState("");
  // Starts as the user's own Sisera wallet until they type another address.
  const [typedDestination, setDestination] = useState<string | null>(null);
  const destination = typedDestination ?? evmAddress ?? "";
  const [reviewing, setReviewing] = useState<{ amount: string; to: Address } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function review() {
    if (!account || !wallet) throw new Error("Your Hyperliquid account is still loading.");
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= HYPERLIQUID_FEE_USD)
      throw new Error(`Withdraw more than the $${HYPERLIQUID_FEE_USD} Hyperliquid fee.`);
    if (value > account.available)
      throw new Error(`You can withdraw up to $${account.available.toFixed(2)}.`);
    const to = destination.trim();
    if (!isAddress(to) || to.toLowerCase() === ZERO_ADDRESS)
      throw new Error("Enter a valid 0x address on Arbitrum.");
    setReviewing({ amount: String(Math.floor(value * 100) / 100), to: to as Address });
  }

  async function confirm() {
    if (!wallet || !reviewing) return;
    setBusy("Approve in your wallet…");
    await withdraw(wallet, reviewing.amount, reviewing.to);
    announcePerpTrade();
    onDone({
      title: "Withdrawal requested",
      detail: `$${(Number(reviewing.amount) - HYPERLIQUID_FEE_USD).toFixed(2)} USDC arrives at ${shortAddress(reviewing.to)} on Arbitrum in about 5 minutes.`,
      link: null,
    });
    setReviewing(null);
    setAmount("");
  }

  async function run(action: () => Promise<void> | void) {
    setMessage(null);
    try {
      await action();
    } catch (error) {
      const text = error instanceof Error ? error.message : "";
      setMessage(
        /reject|denied|cancel/i.test(text)
          ? "You cancelled the withdrawal in your wallet."
          : text || "The withdrawal could not be completed.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (!evmAddress)
    return <p className="text-xs text-slate-400">Your EVM wallet is still being set up…</p>;
  if (!account)
    return <p className="text-xs text-slate-400">{error ?? "Loading your Hyperliquid account…"}</p>;

  const own = reviewing?.to.toLowerCase() === evmAddress.toLowerCase();
  if (reviewing)
    return (
      <>
        <Review
          rows={[
            ["You withdraw", `$${Number(reviewing.amount).toFixed(2)} USDC`],
            ["You receive", `$${(Number(reviewing.amount) - HYPERLIQUID_FEE_USD).toFixed(2)} USDC`],
            [
              "To",
              <span key="to" className="font-mono">
                {reviewing.to}
                {own ? " (your Sisera wallet)" : ""}
              </span>,
            ],
            ["Network", "Arbitrum"],
          ]}
          warning={
            own
              ? "USDC arrives in your Sisera EVM wallet on Arbitrum. From there you can send it anywhere, or bridge it to Solana from Portfolio."
              : "Hyperliquid pays out USDC on Arbitrum. If this is an exchange address, check that it accepts USDC on Arbitrum."
          }
          busy={busy}
          onConfirm={() => void run(confirm)}
          onBack={() => setReviewing(null)}
        />
        <div className="mt-3">
          <ErrorText message={message} />
        </div>
      </>
    );

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void run(review);
      }}
    >
      <p className="text-xs text-slate-400">
        Withdrawable now:{" "}
        <span className="font-mono text-slate-100">${account.available.toFixed(2)}</span>
        {account.positions.length > 0 && " (margin for open positions stays in the account)"}
      </p>
      {account.spotUsdc >= 0.01 && (
        <p className="text-[11px] leading-5 text-slate-500">
          ${account.spotUsdc.toFixed(2)} more is in your Hyperliquid spot balance. Move it to perps
          from the Perpetuals page to withdraw it.
        </p>
      )}
      <Field
        label="Amount (USDC)"
        htmlFor="withdraw-amount"
        hint={`Hyperliquid charges a $${HYPERLIQUID_FEE_USD} fee.`}
      >
        <AmountInput
          value={amount}
          symbol="USDC"
          onChange={setAmount}
          onMax={() => setAmount(String(Math.floor(account.available * 100) / 100))}
        />
      </Field>
      <Field
        label="Recipient address on Arbitrum"
        htmlFor="withdraw-destination"
        hint="Your Sisera EVM wallet by default. Change it to send straight to an exchange."
      >
        <input
          id="withdraw-destination"
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
          spellCheck={false}
          autoComplete="off"
          className={`${inputClass} font-mono text-xs`}
        />
      </Field>
      <ErrorText message={message} />
      <button
        type="submit"
        disabled={busy != null || !amount || account.available <= HYPERLIQUID_FEE_USD}
        className="h-10 w-full rounded bg-bronze-300 text-sm font-semibold text-[#0b1b24] hover:bg-bronze-200 disabled:opacity-40"
      >
        Review withdrawal
      </button>
    </form>
  );
}

// ------------------------------------------------------------------------------------- Dialog

const SOURCES = [
  ["solana", "Solana wallet"],
  ["evm", "EVM wallet"],
  ["hyperliquid", "Hyperliquid"],
] as const;
type Source = (typeof SOURCES)[number][0];

/** Sends funds out of Sisera: from the Solana wallet, the EVM wallet, or the Hyperliquid account. */
export function WithdrawButton({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
  const { authenticated } = usePrivy();
  const [source, setSource] = useState<Source>("solana");
  const [done, setDone] = useState<Done | null>(null);
  if (!authenticated) return null;

  return (
    <Dialog.Root onOpenChange={(open) => !open && setDone(null)}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className={`inline-flex h-9 items-center gap-2 rounded-md border border-line px-3 text-[12px] font-semibold text-slate-100 hover:border-bronze-400/60 ${className}`}
        >
          <ArrowUpFromLine size={14} />
          {compact ? "Withdraw" : "Withdraw funds"}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[min(94vw,520px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto border border-line bg-panel p-5 shadow-2xl">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold text-slate-100">
              Withdraw funds
            </Dialog.Title>
            <Dialog.Close className="text-slate-400 hover:text-slate-100" aria-label="Close">
              <X size={16} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-xs leading-5 text-slate-400">
            Send crypto from your Sisera wallets to any address, such as an exchange or another
            wallet. You review every detail and approve it in your wallet before anything moves.
          </Dialog.Description>
          <div
            role="tablist"
            aria-label="Withdraw from"
            className="mt-4 flex gap-1 border-b border-line"
          >
            {SOURCES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={source === value}
                onClick={() => {
                  setSource(value);
                  setDone(null);
                }}
                className={`-mb-px border-b-2 px-3 py-2 text-xs ${source === value ? "border-bronze-400 text-bronze-300" : "border-transparent text-slate-400 hover:text-slate-200"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-4">
            {done ? (
              <Success done={done} onAgain={() => setDone(null)} />
            ) : source === "solana" ? (
              <SolanaWithdraw onDone={setDone} />
            ) : source === "evm" ? (
              <EvmWithdraw onDone={setDone} />
            ) : (
              <HyperliquidWithdraw onDone={setDone} />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
