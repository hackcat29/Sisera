"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ShieldCheck, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  announcePerpTrade,
  enableTrading,
  moveSpotToPerps,
  placeOrder,
  tradingEnabled,
  useHyperliquidAccount,
  usePerpMarketMeta,
} from "../lib/hyperliquid";
import { usePerpMid } from "../lib/market-streams";
import { useSiseraWallets } from "../lib/use-sisera-wallets";
import { PerpDeposit } from "./perp-deposit";
import {
  builderApproval,
  useHyperliquidFee,
  useLiveCapabilityStatus,
  usePerpLimits,
} from "./use-live-capability";

const PRESETS = [0.25, 0.5, 0.75, 1] as const;
const TAKER_FEE = 0.00045;

const usd = (value: number, digits = 2) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const price = (value: number) =>
  value.toLocaleString("en-US", {
    maximumFractionDigits: value >= 1000 ? 1 : value >= 1 ? 3 : 6,
  });

/** Estimated liquidation price for a new isolated position; mirrors the server's estimate. */
function liquidationPrice(entry: number, leverage: number, maxLeverage: number, isLong: boolean) {
  const distance = 1 / leverage - 1 / (2 * maxLeverage);
  if (distance <= 0) return null;
  return isLong ? entry * (1 - distance) : entry * (1 + distance);
}

/**
 * Order entry for Hyperliquid perpetuals, sized the way traders think: margin in USDC times
 * leverage, at market or at a limit price. Live orders are priced and risk-checked by Sisera,
 * signed by this device's trading key, and placed on the user's own Hyperliquid account.
 */
export function PerpTradeTicket({
  coin,
  symbol,
  fallbackPrice,
}: {
  coin: string;
  symbol: string;
  fallbackPrice: number | null;
}) {
  const { authenticated } = usePrivy();
  const { evm: wallet, evmAddress } = useSiseraWallets();
  const liveStatus = useLiveCapabilityStatus("hyperliquid");
  const liveAvailable = liveStatus === true;
  const limits = usePerpLimits();
  const fee = useHyperliquidFee();
  const meta = usePerpMarketMeta(coin);
  const mid = usePerpMid(coin);
  const mark = mid ?? fallbackPrice ?? null;
  const [modeChoice, setModeChoice] = useState<"live" | "paper" | null>(null);
  // Live is the default; Practice is only chosen automatically once live is known to be off.
  const mode = modeChoice ?? (liveStatus === false ? "paper" : "live");
  const live = mode === "live";
  const { account, error: accountError } = useHyperliquidAccount(live ? evmAddress : null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [limitPx, setLimitPx] = useState("");
  const [postOnly, setPostOnly] = useState(false);
  const [margin, setMargin] = useState("");
  const [leverage, setLeverage] = useState(5);
  const [isCross, setIsCross] = useState(true);
  const [showTpsl, setShowTpsl] = useState(false);
  const [takeProfit, setTakeProfit] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const maxLeverage = Math.max(
    1,
    Math.min(meta?.maxLeverage ?? limits.maxLeverage, limits.maxLeverage),
  );
  const position = account?.positions.find((item) => item.coin === coin) ?? null;
  const isLong = side === "buy";
  const limit = orderType === "limit";
  const entryPrice = limit ? Number(limitPx) : mark;

  // Hyperliquid sets leverage per coin, so the ticket starts from the open position's settings.
  useEffect(() => {
    if (!position) return;
    setLeverage(position.leverage);
    setIsCross(position.isCross);
  }, [position?.leverage, position?.isCross, position]);
  useEffect(() => {
    setLeverage((current) => Math.min(current, maxLeverage));
  }, [maxLeverage]);
  useEffect(() => {
    if (meta?.onlyIsolated) setIsCross(false);
  }, [meta?.onlyIsolated]);
  // A new limit order starts at the current price, which the trader then adjusts.
  useEffect(() => {
    if (limit && !limitPx && mark) setLimitPx(String(Number(mark.toPrecision(6))));
  }, [limit, limitPx, mark]);

  useEffect(() => {
    if (!live || !evmAddress || !account || account.accountValue <= 0) return;
    let active = true;
    void tradingEnabled(evmAddress)
      .then((value) => {
        if (active) setEnabled(value);
      })
      .catch(() => {
        if (active) setEnabled(null);
      });
    return () => {
      active = false;
    };
  }, [live, evmAddress, account]);

  const marginValue = Number(margin);
  const available = live ? (account?.available ?? 0) : null;
  const siseraRate = live && fee ? fee.perpBps / 10_000 : 0;
  const preview = useMemo(() => {
    if (!entryPrice || !(entryPrice > 0) || !(marginValue > 0)) return null;
    const notional = marginValue * leverage;
    return {
      notional,
      size: notional / entryPrice,
      fee: notional * (TAKER_FEE + siseraRate),
      liquidation: liquidationPrice(entryPrice, leverage, meta?.maxLeverage ?? maxLeverage, isLong),
    };
  }, [entryPrice, marginValue, leverage, meta?.maxLeverage, maxLeverage, isLong, siseraRate]);
  const tooSmall = preview != null && preview.notional < 10;
  const overAvailable = live && available != null && marginValue > available + 1e-9;
  const overLimit = preview != null && preview.notional > limits.maxNotionalUsd;
  const badLimit = limit && !(Number(limitPx) > 0);

  async function run(action: () => Promise<void>) {
    setWorking(true);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      const text = error instanceof Error ? error.message : "The order could not be placed.";
      if (/enable trading/i.test(text)) setEnabled(false);
      setMessage(text);
    } finally {
      setWorking(false);
    }
  }

  async function enable() {
    if (!wallet) throw new Error("Your trading wallet is still being set up.");
    await enableTrading(wallet, builderApproval(fee));
    setEnabled(true);
    toast.success("One-click trading enabled on this device");
  }

  async function moveSpot() {
    if (!wallet || !account) return;
    await moveSpotToPerps(wallet, String(Math.floor(account.spotUsdc * 100) / 100));
    toast.success("USDC moved to your perps balance");
    announcePerpTrade();
  }

  async function submitLive() {
    if (!evmAddress) throw new Error("Your trading wallet is still being set up.");
    const { prepared, result } = await placeOrder(evmAddress, wallet, {
      kind: "open",
      coin,
      side,
      marginUsd: marginValue,
      leverage,
      isCross,
      orderType,
      ...(limit ? { limitPx: Number(limitPx), postOnly } : {}),
      ...(showTpsl && Number(takeProfit) > 0 ? { takeProfitPx: Number(takeProfit) } : {}),
      ...(showTpsl && Number(stopLoss) > 0 ? { stopLossPx: Number(stopLoss) } : {}),
    });
    const label = `${isLong ? "Long" : "Short"} ${prepared.size} ${coin}`;
    const detail = `${prepared.leverage}x ${prepared.isCross ? "cross" : "isolated"}`;
    if (result.status === "filled")
      toast.success(`${label} filled at $${price(Number(result.averagePx))}`, {
        description: detail,
      });
    else if (result.status === "open")
      toast.success(`Limit order placed: ${label} at $${price(Number(prepared.limitPx))}`, {
        description: `${detail} · it fills when the market reaches your price`,
      });
    else
      toast.warning("Order sent. Confirming with Hyperliquid…", {
        description: "Check Positions in a moment before placing it again.",
      });
    if (result.status !== "unknown") {
      setMargin("");
      setTakeProfit("");
      setStopLoss("");
    }
  }

  async function submitPaper() {
    if (!preview) throw new Error("Enter the margin to use.");
    if (limit) throw new Error("Practice orders fill at market. Switch to Market or go Live.");
    const decimals = Math.min(6, meta?.szDecimals ?? 6);
    const quantity = (Math.floor(preview.size * 10 ** decimals) / 10 ** decimals).toFixed(decimals);
    if (!(Number(quantity) > 0)) throw new Error("This amount is below the minimum size.");
    const response = await fetch("/api/market-trade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "paper", venue: "hyperliquid", symbol, side, quantity }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? "Practice order rejected.");
    toast.success(`Practice ${isLong ? "long" : "short"} filled: ${quantity} ${coin}`, {
      description: `at $${price(Number(payload.data.fillPrice))} · practice account`,
    });
    setMargin("");
  }

  const setupStep = !live
    ? null
    : !evmAddress
      ? "wallet"
      : !account
        ? accountError
          ? "error"
          : "loading"
        : account.accountValue <= 0 && account.positions.length === 0
          ? "fund"
          : enabled === false
            ? "enable"
            : null;

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-12 items-center justify-between border-b border-line px-4">
        <span className="text-sm font-semibold text-slate-100">Trade {coin}-PERP</span>
        <div className="grid grid-cols-2 gap-0.5 rounded border border-line p-0.5 text-[11px]">
          {(["live", "paper"] as const).map((option) => (
            <button
              key={option}
              type="button"
              disabled={option === "live" && !liveAvailable}
              title={option === "live" && !liveAvailable ? "Live perps are paused" : undefined}
              onClick={() => {
                setModeChoice(option);
                setMessage(null);
              }}
              className={`rounded px-2 py-1 font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${mode === option ? "bg-bronze-400/15 text-bronze-300" : "text-slate-500"}`}
            >
              {option === "live" ? "Live" : "Practice"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-4 p-4 text-xs">
        {live && account && (
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-slate-400">
              Available <span className="font-mono text-slate-100">{usd(account.available)}</span>
            </span>
            <button
              type="button"
              onClick={() => setDepositOpen((open) => !open)}
              className="text-bronze-300 hover:text-bronze-200"
            >
              {depositOpen ? "Close" : "Deposit"}
            </button>
          </div>
        )}
        {live && evmAddress && (depositOpen || setupStep === "fund") && (
          <div className="rounded border border-line bg-ink-raised/60 p-3">
            {setupStep === "fund" && (
              <p className="mb-3 text-slate-300">
                Fund your Hyperliquid account with USDC to start trading. Funds stay in your own
                account.
              </p>
            )}
            {account && account.spotUsdc >= 1 && (
              <button
                type="button"
                disabled={working}
                onClick={() => void run(moveSpot)}
                className="mb-3 h-9 w-full rounded border border-bronze-400/40 text-bronze-200"
              >
                Use {usd(account.spotUsdc)} from your Hyperliquid spot balance
              </button>
            )}
            <PerpDeposit evmAddress={evmAddress} onDeposited={() => setDepositOpen(false)} />
          </div>
        )}

        {setupStep === "wallet" && (
          <p className="text-slate-400">
            {authenticated ? "Setting up your trading wallet…" : "Sign in to trade perpetuals."}
          </p>
        )}
        {setupStep === "loading" && <p className="text-slate-400">Loading your account…</p>}
        {setupStep === "error" && <p className="text-amber-200">{accountError}</p>}
        {setupStep === "enable" && (
          <div className="space-y-3 rounded border border-bronze-400/25 bg-bronze-400/[0.05] p-3">
            <p className="flex items-center gap-2 font-semibold text-slate-100">
              <Zap size={14} className="text-bronze-300" /> Enable one-click trading
            </p>
            <p className="leading-5 text-slate-400">
              Approve a trading key for this device. It can open and close positions, but it can
              never withdraw your funds.
              {fee ? " You'll also approve Sisera's trading fee, shown on every order." : ""}
            </p>
            <button
              type="button"
              disabled={working || !wallet}
              onClick={() => void run(enable)}
              className="h-10 w-full rounded bg-bronze-300 font-semibold text-[#0b1b24] hover:bg-bronze-200 disabled:opacity-40"
            >
              {working ? "Waiting for wallet…" : "Enable trading"}
            </button>
          </div>
        )}

        {setupStep === null && (
          <>
            <div className="grid grid-cols-2 gap-1 rounded border border-line p-1">
              {(["buy", "sell"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSide(option)}
                  className={`rounded py-2 font-semibold ${side === option ? (option === "buy" ? "bg-emerald-400/15 text-emerald-300" : "bg-rose-400/15 text-rose-300") : "text-slate-500"}`}
                >
                  {option === "buy" ? "Long" : "Short"}
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
                  <span className="flex justify-between">
                    <span className="data-label">Limit price · USDC</span>
                    {mark && (
                      <button
                        type="button"
                        onClick={() => setLimitPx(String(Number(mark.toPrecision(6))))}
                        className="font-mono text-[10px] text-slate-500 hover:text-slate-300"
                      >
                        Mark {price(mark)}
                      </button>
                    )}
                  </span>
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
                  Post only (rests on the book; never fills as a taker)
                </label>
              </div>
            )}

            <label className="block">
              <span className="flex justify-between">
                <span className="data-label">Margin · USDC</span>
                {available != null && (
                  <span className="font-mono text-[10px] text-slate-500">max {usd(available)}</span>
                )}
              </span>
              <input
                value={margin}
                onChange={(event) => setMargin(event.target.value.trim())}
                inputMode="decimal"
                placeholder="0.00"
                className="mt-2 h-11 w-full rounded border border-line bg-ink-raised px-3 text-right font-mono text-sm text-white"
              />
            </label>
            {available != null && available > 0 && (
              <div className="grid grid-cols-4 gap-1">
                {PRESETS.map((share) => (
                  <button
                    key={share}
                    type="button"
                    onClick={() => setMargin(String(Math.floor(available * share * 100) / 100))}
                    className="rounded border border-line py-1 font-mono text-[10px] text-slate-400 hover:border-bronze-400/40 hover:text-slate-200"
                  >
                    {share === 1 ? "Max" : `${share * 100}%`}
                  </button>
                ))}
              </div>
            )}

            <div>
              <div className="flex items-center justify-between">
                <span className="data-label">Leverage</span>
                <span className="font-mono text-sm text-slate-100">{leverage}x</span>
              </div>
              <input
                type="range"
                min={1}
                max={maxLeverage}
                step={1}
                value={leverage}
                onChange={(event) => setLeverage(Number(event.target.value))}
                aria-label="Leverage"
                className="mt-2 w-full accent-[#e9bd8c]"
              />
              <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-500">
                <span>1x</span>
                <span>{maxLeverage}x max</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1 rounded border border-line p-1 text-[11px]">
              {([true, false] as const).map((cross) => (
                <button
                  key={String(cross)}
                  type="button"
                  disabled={
                    (cross && meta?.onlyIsolated) ||
                    (position != null && position.isCross !== cross)
                  }
                  onClick={() => setIsCross(cross)}
                  className={`rounded py-1.5 disabled:cursor-not-allowed disabled:opacity-40 ${isCross === cross ? "bg-slate-700/60 text-slate-100" : "text-slate-500"}`}
                >
                  {cross ? "Cross" : "Isolated"}
                </button>
              ))}
            </div>
            {position && (
              <p className="text-[11px] text-slate-500">
                Leverage applies to your open {coin} position too.
              </p>
            )}

            <button
              type="button"
              onClick={() => setShowTpsl((open) => !open)}
              className="text-[11px] text-slate-400 hover:text-slate-200"
            >
              {showTpsl ? "− Remove take profit / stop loss" : "+ Add take profit / stop loss"}
            </button>
            {showTpsl && (
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["Take profit", takeProfit, setTakeProfit],
                    ["Stop loss", stopLoss, setStopLoss],
                  ] as const
                ).map(([label, value, setValue]) => {
                  const target = Number(value);
                  const move =
                    entryPrice && target > 0 && preview
                      ? ((target - entryPrice) / entryPrice) * (isLong ? 1 : -1) * preview.notional
                      : null;
                  return (
                    <label key={label} className="block">
                      <span className="data-label">{label}</span>
                      <input
                        value={value}
                        onChange={(event) => setValue(event.target.value.trim())}
                        inputMode="decimal"
                        placeholder="Price"
                        className="mt-1 h-9 w-full rounded border border-line bg-ink-raised px-2 text-right font-mono text-white"
                      />
                      {move != null && (
                        <span
                          className={`mt-1 block text-right font-mono text-[10px] ${move >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                        >
                          {move >= 0 ? "+" : "−"}
                          {usd(Math.abs(move))}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}

            <dl className="divide-y divide-line border-y border-line">
              {[
                [
                  "Position size",
                  preview
                    ? `${preview.size.toLocaleString("en-US", { maximumFractionDigits: meta?.szDecimals ?? 4 })} ${coin} · ${usd(preview.notional)}`
                    : "—",
                ],
                [limit ? "Limit price" : "Mark price", entryPrice ? `$${price(entryPrice)}` : "—"],
                ["Est. liquidation", preview?.liquidation ? `$${price(preview.liquidation)}` : "—"],
                [
                  live && fee ? `Est. fees (incl. Sisera ${fee.perpBps / 100}%)` : "Est. fees",
                  preview ? usd(preview.fee) : "—",
                ],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 py-2">
                  <dt className="text-slate-400">{label}</dt>
                  <dd className="text-right font-mono text-slate-200">{value}</dd>
                </div>
              ))}
            </dl>

            {tooSmall && <p className="text-amber-200">Position size must be at least $10.</p>}
            {overAvailable && (
              <p className="text-amber-200">
                That's more than your available margin.{" "}
                <button type="button" className="underline" onClick={() => setDepositOpen(true)}>
                  Deposit
                </button>
              </p>
            )}
            {overLimit && (
              <p className="text-amber-200">
                Orders are limited to {usd(limits.maxNotionalUsd, 0)} position size.
              </p>
            )}

            <button
              type="button"
              disabled={
                working ||
                !preview ||
                tooSmall ||
                overAvailable ||
                overLimit ||
                badLimit ||
                (live && !liveAvailable)
              }
              onClick={() => void run(live ? submitLive : submitPaper)}
              className={`h-11 w-full rounded font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${isLong ? "bg-emerald-400 text-[#06231a] hover:bg-emerald-300" : "bg-rose-400 text-[#2a0a10] hover:bg-rose-300"}`}
            >
              {working
                ? "Placing order…"
                : `${live ? "" : "Practice "}${limit ? "Limit " : ""}${isLong ? "Long" : "Short"} ${coin}${preview ? ` · ${usd(preview.notional, 0)}` : ""}`}
            </button>
          </>
        )}

        {message && <output className="block leading-5 text-amber-200">{message}</output>}
        <p className="flex items-start gap-1.5 text-[10px] leading-4 text-slate-500">
          <ShieldCheck size={12} className="mt-0.5 shrink-0" />
          {live
            ? `${limit ? "Limit" : "Market"} order on your own Hyperliquid account. Sisera checks every order against your risk limits before it is placed.`
            : "Practice orders fill at the live price in your practice account. No funds are used."}
        </p>
      </div>
    </div>
  );
}
