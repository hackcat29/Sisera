"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ShieldCheck, Zap } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  type SpotMarket,
  enableTrading,
  hyperliquidInfo,
  moveUsdc,
  placeOrder,
  spotMarkets,
  tradingEnabled,
  useHyperliquidAccount,
} from "../lib/hyperliquid";
import { usePerpMid } from "../lib/market-streams";
import { formatSignedPct, signTone } from "../lib/sign";
import { useSiseraWallets } from "../lib/use-sisera-wallets";
import { LiveNumber } from "./live-number";
import { PerpDeposit } from "./perp-deposit";
import { SignInToTrade } from "./sign-in-to-trade";
import { TradingChart } from "./trading-chart";
import { builderApproval, useHyperliquidFee, useLiveCapabilityStatus } from "./use-live-capability";

const VENUE_SPOT_FEE = 0.0007;
const PRESETS = [0.25, 0.5, 0.75, 1] as const;
const usd = (value: number) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const price = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: value >= 1000 ? 2 : value >= 1 ? 4 : 8 });

/** A Hyperliquid spot market: live price, chart, order book and order entry. */
export function SpotMarketView({ symbol, signedIn }: { symbol: string; signedIn: boolean }) {
  const [market, setMarket] = useState<SpotMarket | null | undefined>(undefined);
  useEffect(() => {
    void spotMarkets()
      .then((markets) => setMarket(markets.find((item) => item.symbol === symbol) ?? null))
      .catch(() => setMarket(null));
  }, [symbol]);
  const last = usePerpMid(market?.coin) ?? market?.markPx ?? null;

  if (market === undefined) return <p className="p-6 text-xs text-slate-400">Loading {symbol}…</p>;
  if (market === null)
    return (
      <div className="p-6 text-sm text-slate-300">
        {symbol} isn't listed on Hyperliquid spot.{" "}
        <Link href="/markets" className="text-bronze-300">
          Browse spot markets
        </Link>
      </div>
    );
  const move =
    last != null && market.prevDayPx > 0 ? ((last - market.prevDayPx) / market.prevDayPx) * 100 : 0;

  return (
    <div className="min-h-full px-4 pb-8 pt-6 md:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">
            <Link href="/markets" className="hover:text-bronze-200">
              Crypto spot
            </Link>{" "}
            / Hyperliquid
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.035em] text-slate-50">
            {market.symbol} / USDC
            {market.name !== market.symbol && (
              <span className="ml-3 text-sm font-normal text-slate-400">{market.name}</span>
            )}
          </h1>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl text-slate-50">
            {last == null ? "—" : <LiveNumber value={last} display={`$${price(last)}`} />}
          </p>
          <p className={`font-mono text-xs ${signTone(move)}`}>
            {formatSignedPct(move)} 24h · $
            {Intl.NumberFormat("en-US", { notation: "compact" }).format(market.volume24hUsd)} volume
          </p>
        </div>
      </div>
      {/* On small screens the ticket follows the chart, ahead of the order book. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_270px_300px]">
        <div className="order-1 min-w-0 xl:order-none">
          <TradingChart
            source={{ kind: "hyperliquid-spot", id: market.coin }}
            title={`${market.symbol} / USDC`}
            initialBars={[]}
            defaultInterval="1h"
            height={510}
          />
        </div>
        <section className="order-3 overflow-hidden rounded-lg border border-line bg-panel xl:order-none">
          <SpotOrderBook coin={market.coin} />
        </section>
        <aside className="order-2 overflow-hidden rounded-lg border border-line bg-panel xl:order-none">
          {signedIn ? (
            <SpotTicket market={market} last={last} />
          ) : (
            <SignInToTrade label={market.symbol} returnTo={`/spot/${encodeURIComponent(symbol)}`} />
          )}
        </aside>
      </div>
    </div>
  );
}

type Level = { px: string; sz: string };

/** Ten levels each side from Hyperliquid's order book, refreshed every two seconds. */
function SpotOrderBook({ coin }: { coin: string }) {
  const [book, setBook] = useState<{ bids: Level[]; asks: Level[]; time: number } | null>(null);
  useEffect(() => {
    let active = true;
    const load = () =>
      void hyperliquidInfo
        .l2Book({ coin })
        .then((snapshot) => {
          if (active && snapshot)
            setBook({ bids: snapshot.levels[0], asks: snapshot.levels[1], time: snapshot.time });
        })
        .catch(() => undefined);
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [coin]);
  if (!book) return <p className="p-4 text-xs text-slate-400">Loading order book…</p>;
  const asks = book.asks.slice(0, 10).reverse();
  const bids = book.bids.slice(0, 10);
  const largest = Math.max(1e-12, ...[...asks, ...bids].map((level) => Number(level.sz)));
  const spread = Number(book.asks[0]?.px) - Number(book.bids[0]?.px);
  const row = (level: Level, side: "bid" | "ask") => (
    <div key={`${side}-${level.px}`} className="relative grid h-7 grid-cols-2 items-center px-4">
      <span className={`relative z-10 ${side === "bid" ? "text-emerald-300" : "text-rose-300"}`}>
        {price(Number(level.px))}
      </span>
      <span className="relative z-10 text-right text-slate-300">
        {Number(level.sz).toLocaleString("en-US", { maximumFractionDigits: 4 })}
      </span>
      <span
        className={`absolute inset-y-0 right-0 ${side === "bid" ? "bg-emerald-400/[0.08]" : "bg-rose-400/[0.08]"}`}
        style={{ width: `${(Number(level.sz) / largest) * 100}%` }}
      />
    </div>
  );
  return (
    <div className="font-mono text-[11px]">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="font-sans text-sm font-semibold text-slate-100">Order book</span>
        <span className="text-[10px] text-slate-500">Hyperliquid spot</span>
      </div>
      {asks.map((level) => row(level, "ask"))}
      <div className="flex justify-between border-y border-line bg-[#1b2b34] px-4 py-2 text-xs">
        <span className="text-slate-500">Spread</span>
        <span className="text-slate-200">{Number.isFinite(spread) ? price(spread) : "—"}</span>
      </div>
      {bids.map((level) => row(level, "bid"))}
    </div>
  );
}

function SpotTicket({ market, last }: { market: SpotMarket; last: number | null }) {
  const { authenticated } = usePrivy();
  const { evm: wallet, evmAddress } = useSiseraWallets();
  const liveAvailable = useLiveCapabilityStatus("hyperliquid");
  const fee = useHyperliquidFee();
  const { account, error } = useHyperliquidAccount(evmAddress);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [limitPx, setLimitPx] = useState("");
  const [postOnly, setPostOnly] = useState(false);
  const [amount, setAmount] = useState("");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [funding, setFunding] = useState(false);
  const [moveAmount, setMoveAmount] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const limit = orderType === "limit";
  const reference = limit ? Number(limitPx) : last;
  const usdc = account?.spotUsdc ?? 0;
  const holding =
    account?.spotBalances.find((balance) => balance.token === market.token)?.available ?? 0;
  const buying = side === "buy";
  const value = Number(amount);
  const siseraRate = fee ? fee.spotBps / 10_000 : 0;
  const preview = useMemo(() => {
    if (!reference || !(reference > 0) || !(value > 0)) return null;
    const notional = buying ? value : value * reference;
    return {
      notional,
      size: buying ? value / reference : value,
      fee: notional * (VENUE_SPOT_FEE + siseraRate),
    };
  }, [reference, value, buying, siseraRate]);
  const tooSmall = preview != null && preview.notional < 10;
  const overBalance = buying ? value > usdc + 1e-9 : value > holding + 1e-12;

  useEffect(() => {
    if (limit && !limitPx && last) setLimitPx(String(Number(last.toPrecision(6))));
  }, [limit, limitPx, last]);
  useEffect(() => {
    if (!evmAddress || !account) return;
    let active = true;
    void tradingEnabled(evmAddress)
      .then((value) => {
        if (active) setEnabled(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [evmAddress, account]);

  async function run(action: () => Promise<void>) {
    setWorking(true);
    setMessage(null);
    try {
      await action();
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : "The order could not be placed.";
      if (/enable trading/i.test(text)) setEnabled(false);
      setMessage(text);
    } finally {
      setWorking(false);
    }
  }

  async function submit() {
    if (!evmAddress) throw new Error("Your trading wallet is still being set up.");
    const { prepared, result } = await placeOrder(evmAddress, wallet, {
      kind: "spot",
      coin: market.coin,
      side,
      orderType,
      ...(buying ? { amountUsd: value } : { size: String(value) }),
      ...(limit ? { limitPx: Number(limitPx), postOnly } : {}),
    });
    const label = `${buying ? "Bought" : "Sold"} ${result.status === "filled" ? result.filledSize : prepared.size} ${market.symbol}`;
    if (result.status === "filled")
      toast.success(`${label} at $${price(Number(result.averagePx))}`);
    else if (result.status === "open")
      toast.success(`Limit order placed at $${price(Number(prepared.limitPx))}`, {
        description: "It fills when the market reaches your price.",
      });
    else toast.warning("Order sent. Confirming with Hyperliquid…");
    if (result.status !== "unknown") setAmount("");
  }

  async function moveToSpot() {
    if (!wallet) throw new Error("Your trading wallet is still being set up.");
    const amountUsd = Number(moveAmount);
    if (!(amountUsd > 0)) throw new Error("Enter an amount to move.");
    if (account && amountUsd > account.available)
      throw new Error(`You have ${usd(account.available)} available in perps.`);
    await moveUsdc(wallet, String(Math.floor(amountUsd * 100) / 100), false);
    toast.success(`${usd(amountUsd)} moved to your spot balance`);
    setMoveAmount("");
    setFunding(false);
  }

  if (liveAvailable === undefined) return <p className="p-4 text-xs text-slate-400">Loading…</p>;
  if (!liveAvailable)
    return <p className="p-4 text-xs text-slate-400">Spot trading is paused right now.</p>;
  if (!evmAddress)
    return (
      <p className="p-4 text-xs text-slate-400">
        {authenticated ? "Setting up your trading wallet…" : "Sign in to trade."}
      </p>
    );
  if (!account)
    return <p className="p-4 text-xs text-slate-400">{error ?? "Loading your account…"}</p>;

  return (
    <div className="space-y-4 p-4 text-xs">
      <div className="flex h-8 items-center justify-between">
        <span className="text-sm font-semibold text-slate-100">Trade {market.symbol}</span>
        <button
          type="button"
          onClick={() => setFunding((open) => !open)}
          className="text-[11px] text-bronze-300 hover:text-bronze-200"
        >
          {funding ? "Close" : "Add USDC"}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-line bg-line">
        <div className="bg-panel p-2">
          <p className="data-label">Spot USDC</p>
          <p className="mt-1 font-mono text-slate-100">{usd(usdc)}</p>
        </div>
        <div className="bg-panel p-2">
          <p className="data-label">{market.symbol}</p>
          <p className="mt-1 font-mono text-slate-100">
            {holding.toLocaleString("en-US", { maximumFractionDigits: 6 })}
          </p>
        </div>
      </div>

      {(funding || (usdc < 1 && holding <= 0)) && (
        <div className="space-y-3 rounded border border-line bg-ink-raised/60 p-3">
          <p className="text-slate-300">
            Spot buys use USDC in your Hyperliquid spot balance. Move it from your perps balance:
          </p>
          <div className="flex gap-2">
            <input
              value={moveAmount}
              onChange={(event) => setMoveAmount(event.target.value.trim())}
              inputMode="decimal"
              placeholder={`Up to ${account.available.toFixed(2)}`}
              aria-label="USDC to move to spot"
              className="h-9 min-w-0 flex-1 rounded border border-line bg-ink-raised px-2 text-right font-mono text-white"
            />
            <button
              type="button"
              disabled={working || !moveAmount}
              onClick={() => void run(moveToSpot)}
              className="h-9 rounded bg-bronze-300 px-3 font-semibold text-[#0b1b24] disabled:opacity-40"
            >
              Move to spot
            </button>
          </div>
          {account.available < 1 && (
            <>
              <p className="text-slate-400">No USDC in perps yet? Deposit from Solana first:</p>
              <PerpDeposit evmAddress={evmAddress} />
            </>
          )}
        </div>
      )}

      {enabled === false ? (
        <div className="space-y-3 rounded border border-bronze-400/25 bg-bronze-400/[0.05] p-3">
          <p className="flex items-center gap-2 font-semibold text-slate-100">
            <Zap size={14} className="text-bronze-300" /> Enable one-click trading
          </p>
          <p className="leading-5 text-slate-400">
            Approve a trading key for this device. It can place orders but never withdraw.
            {fee ? " You'll also approve Sisera's trading fee, shown on every order." : ""}
          </p>
          <button
            type="button"
            disabled={working || !wallet}
            onClick={() =>
              void run(async () => {
                if (!wallet) return;
                await enableTrading(wallet, builderApproval(fee));
                setEnabled(true);
                toast.success("One-click trading enabled on this device");
              })
            }
            className="h-10 w-full rounded bg-bronze-300 font-semibold text-[#0b1b24] disabled:opacity-40"
          >
            {working ? "Waiting for wallet…" : "Enable trading"}
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1 rounded border border-line p-1">
            {(["buy", "sell"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setSide(option);
                  setAmount("");
                }}
                className={`rounded py-2 font-semibold ${side === option ? (option === "buy" ? "bg-emerald-400/15 text-emerald-300" : "bg-rose-400/15 text-rose-300") : "text-slate-500"}`}
              >
                {option === "buy" ? "Buy" : "Sell"}
              </button>
            ))}
          </div>
          <div className="flex gap-4 border-b border-line text-[11px]" role="tablist">
            {(["market", "limit"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={orderType === option}
                onClick={() => setOrderType(option)}
                className={`-mb-px border-b-2 pb-1.5 font-semibold capitalize ${orderType === option ? "border-bronze-300 text-slate-100" : "border-transparent text-slate-500"}`}
              >
                {option}
              </button>
            ))}
          </div>
          {limit && (
            <div>
              <label className="block">
                <span className="data-label">Limit price · USDC</span>
                <input
                  value={limitPx}
                  onChange={(event) => setLimitPx(event.target.value.trim())}
                  inputMode="decimal"
                  className="mt-2 h-10 w-full rounded border border-line bg-ink-raised px-3 text-right font-mono text-sm text-white"
                />
              </label>
              <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
                <input
                  type="checkbox"
                  checked={postOnly}
                  onChange={(event) => setPostOnly(event.target.checked)}
                  className="accent-[#e9bd8c]"
                />
                Post only
              </label>
            </div>
          )}
          <label className="block">
            <span className="data-label">
              {buying ? "Spend · USDC" : `Sell · ${market.symbol}`}
            </span>
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value.trim())}
              inputMode="decimal"
              placeholder="0.00"
              className="mt-2 h-11 w-full rounded border border-line bg-ink-raised px-3 text-right font-mono text-sm text-white"
            />
          </label>
          <div className="grid grid-cols-4 gap-1">
            {PRESETS.map((share) => (
              <button
                key={share}
                type="button"
                disabled={(buying ? usdc : holding) <= 0}
                onClick={() => {
                  const base = buying ? usdc / (1 + VENUE_SPOT_FEE + siseraRate) : holding;
                  const decimals = buying ? 2 : market.szDecimals;
                  setAmount(String(Math.floor(base * share * 10 ** decimals) / 10 ** decimals));
                }}
                className="rounded border border-line py-1 font-mono text-[10px] text-slate-400 hover:border-bronze-400/40 hover:text-slate-200 disabled:opacity-40"
              >
                {share === 1 ? "Max" : `${share * 100}%`}
              </button>
            ))}
          </div>
          <dl className="divide-y divide-line border-y border-line">
            {[
              [
                buying ? "You receive ≈" : "You receive ≈",
                preview
                  ? buying
                    ? `${preview.size.toLocaleString("en-US", { maximumFractionDigits: market.szDecimals })} ${market.symbol}`
                    : usd(preview.notional - preview.fee)
                  : "—",
              ],
              [limit ? "Limit price" : "Price", reference ? `$${price(reference)}` : "—"],
              [
                fee ? `Est. fees (incl. Sisera ${fee.spotBps / 100}%)` : "Est. fees",
                preview ? usd(preview.fee) : "—",
              ],
            ].map(([label, text]) => (
              <div key={label} className="flex justify-between gap-3 py-2">
                <dt className="text-slate-400">{label}</dt>
                <dd className="font-mono text-slate-200">{text}</dd>
              </div>
            ))}
          </dl>
          {tooSmall && <p className="text-amber-200">Orders must be at least $10.</p>}
          {overBalance && (
            <p className="text-amber-200">
              {buying
                ? "That's more than your spot USDC."
                : `You hold ${holding} ${market.symbol}.`}
            </p>
          )}
          <button
            type="button"
            disabled={
              working || !preview || tooSmall || overBalance || (limit && !(Number(limitPx) > 0))
            }
            onClick={() => void run(submit)}
            className={`h-11 w-full rounded font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${buying ? "bg-emerald-400 text-[#06231a] hover:bg-emerald-300" : "bg-rose-400 text-[#2a0a10] hover:bg-rose-300"}`}
          >
            {working
              ? "Placing order…"
              : `${limit ? "Limit " : ""}${buying ? "Buy" : "Sell"} ${market.symbol}${preview ? ` · ${usd(preview.notional)}` : ""}`}
          </button>
        </>
      )}
      {message && <output className="block leading-5 text-amber-200">{message}</output>}
      <p className="flex items-start gap-1.5 text-[10px] leading-4 text-slate-500">
        <ShieldCheck size={12} className="mt-0.5 shrink-0" />
        Spot order on your own Hyperliquid account. Sisera checks every order before it is placed.
      </p>
    </div>
  );
}
