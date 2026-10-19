"use client";

import { usePrivy } from "@privy-io/react-auth";
import { KeyRound, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useSpotTick } from "../lib/market-streams";
import { useLiveCapability } from "./use-live-capability";

const usd = (value: number) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const priceText = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: value >= 1000 ? 2 : value >= 1 ? 4 : 8 });

/**
 * Order entry for Binance USDT spot pairs, sized in USDT by default. Live orders use the trader's
 * own Binance API key, which stays in this page's memory and is sent only with the order.
 */
export function MarketOrderTicket({
  bid,
  ask,
  symbol,
}: {
  bid: string | undefined;
  ask: string | undefined;
  symbol: string;
}) {
  const { authenticated } = usePrivy();
  const liveAvailable = useLiveCapability("binance");
  const tick = useSpotTick(symbol);
  const base = symbol.replace(/USDT$/, "");
  const [modeChoice, setModeChoice] = useState<"live" | "paper" | null>(null);
  const mode = modeChoice ?? (liveAvailable ? "live" : "paper");
  const live = mode === "live";
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [unit, setUnit] = useState<"usdt" | "base">("usdt");
  const [amount, setAmount] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // The streamed last trade keeps the estimate current between server quotes.
  const quoted = side === "buy" ? ask : bid;
  const price = tick?.last ?? (quoted ? Number(quoted) : null);
  const value = Number(amount);
  const preview = useMemo(() => {
    if (!price || !(value > 0)) return null;
    return unit === "usdt"
      ? { usdt: value, base: value / price }
      : { usdt: value * price, base: value };
  }, [price, value, unit]);
  const outOfRange = live && preview != null && (preview.usdt < 10 || preview.usdt > 2500);

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      if (!preview || !price) throw new Error("Enter an amount.");
      const body: Record<string, unknown> = {
        mode,
        venue: "binance",
        symbol,
        side,
        ...(unit === "usdt" && live
          ? { quoteAmount: preview.usdt.toFixed(2) }
          : { quantity: preview.base.toFixed(8).replace(/\.?0+$/, "") }),
        ...(live ? { apiKey, apiSecret } : {}),
      };
      const response = await fetch("/api/market-trade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          payload.message ?? "The order could not be placed. Check it and try again.",
        );
      const data = payload.data;
      if (live)
        toast.success(
          `${side === "buy" ? "Bought" : "Sold"} ${data.executedQty} ${base}${data.averagePrice ? ` at $${priceText(Number(data.averagePrice))}` : ""}`,
          { description: `Binance order ${data.orderId}` },
        );
      else
        toast.success(`Practice ${side} filled: ${data.quantity} ${base}`, {
          description: `at $${priceText(Number(data.fillPrice))} · practice account`,
        });
      setAmount("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Order failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-12 items-center justify-between border-b border-line px-4">
        <span className="text-sm font-semibold text-slate-100">Trade {base}</span>
        <div className="grid grid-cols-2 gap-0.5 rounded border border-line p-0.5 text-[11px]">
          {(["live", "paper"] as const).map((option) => (
            <button
              key={option}
              type="button"
              disabled={option === "live" && !liveAvailable}
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
        <div className="grid grid-cols-2 gap-1 rounded border border-line p-1">
          {(["buy", "sell"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSide(option)}
              className={`rounded py-2 font-semibold ${side === option ? (option === "buy" ? "bg-emerald-400/15 text-emerald-300" : "bg-rose-400/15 text-rose-300") : "text-slate-500"}`}
            >
              {option === "buy" ? "Buy" : "Sell"}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="flex items-center justify-between">
            <span className="data-label">Amount</span>
            <span className="grid grid-cols-2 gap-0.5 rounded border border-line p-0.5 text-[10px]">
              {(["usdt", "base"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setUnit(option);
                    setAmount("");
                  }}
                  className={`rounded px-1.5 py-0.5 ${unit === option ? "bg-slate-700/60 text-slate-100" : "text-slate-500"}`}
                >
                  {option === "usdt" ? "USDT" : base}
                </button>
              ))}
            </span>
          </span>
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value.trim())}
            inputMode="decimal"
            placeholder="0.00"
            className="mt-2 h-11 w-full rounded border border-line bg-ink-raised px-3 text-right font-mono text-sm text-white"
          />
        </label>

        <dl className="divide-y divide-line border-y border-line">
          {[
            ["Market price", price ? `$${priceText(price)}` : "—"],
            [
              unit === "usdt" ? `You ${side === "buy" ? "receive" : "sell"} ≈` : "Order value ≈",
              preview
                ? unit === "usdt"
                  ? `${preview.base.toLocaleString("en-US", { maximumFractionDigits: 8 })} ${base}`
                  : usd(preview.usdt)
                : "—",
            ],
            ["Est. fee", preview ? usd(preview.usdt * 0.001) : "—"],
          ].map(([label, text]) => (
            <div key={label} className="flex justify-between gap-3 py-2">
              <dt className="text-slate-400">{label}</dt>
              <dd className="font-mono text-slate-200">{text}</dd>
            </div>
          ))}
        </dl>

        {live && (
          <div className="space-y-2 rounded border border-line bg-ink-raised/60 p-3">
            <p className="flex items-center gap-2 font-semibold text-slate-200">
              <KeyRound size={13} className="text-bronze-300" /> Connect Binance
            </p>
            <p className="leading-5 text-slate-400">
              Live spot orders use your own Binance account. Create a trading-only API key with
              withdrawals off. It stays in this page and is never stored.
            </p>
            <input
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value.trim())}
              type="password"
              autoComplete="off"
              placeholder="API key"
              aria-label="Binance API key"
              className="h-9 w-full rounded border border-line bg-ink-raised px-2 text-white"
            />
            <input
              value={apiSecret}
              onChange={(event) => setApiSecret(event.target.value.trim())}
              type="password"
              autoComplete="off"
              placeholder="API secret"
              aria-label="Binance API secret"
              className="h-9 w-full rounded border border-line bg-ink-raised px-2 text-white"
            />
          </div>
        )}

        {outOfRange && (
          <p className="text-amber-200">Live orders must be between $10 and $2,500.</p>
        )}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={
            busy ||
            !preview ||
            outOfRange ||
            (live && (!liveAvailable || !authenticated || !apiKey || !apiSecret))
          }
          className={`h-11 w-full rounded font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${side === "buy" ? "bg-emerald-400 text-[#06231a] hover:bg-emerald-300" : "bg-rose-400 text-[#2a0a10] hover:bg-rose-300"}`}
        >
          {busy
            ? "Placing order…"
            : `${live ? "" : "Practice "}${side === "buy" ? "Buy" : "Sell"} ${base}${preview ? ` · ${usd(preview.usdt)}` : ""}`}
        </button>
        {message && <output className="block leading-5 text-amber-200">{message}</output>}
        <p className="flex items-start gap-1.5 text-[10px] leading-4 text-slate-500">
          <ShieldCheck size={12} className="mt-0.5 shrink-0" />
          {live
            ? "Market order on your Binance account at the best available price."
            : "Practice orders fill at the live price in your practice account. No funds are used."}
        </p>
      </div>
    </div>
  );
}
