"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  announcePerpTrade,
  assetFor,
  cancelOrder,
  placeOrder,
  spotMarkets,
  useHyperliquidAccount,
  withdraw,
} from "../lib/hyperliquid";
import { signTone } from "../lib/sign";
import { useSiseraWallets } from "../lib/use-sisera-wallets";
import { PnlShareButton } from "./pnl-share";
import { useLiveCapability } from "./use-live-capability";

const usd = (value: number) =>
  `${value < 0 ? "−" : ""}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const px = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: value >= 1000 ? 1 : value >= 1 ? 4 : 6 });

/** The account's live Hyperliquid positions and open orders, with one-click close and cancel. */
export function PerpPositions({ activeCoin }: { activeCoin?: string }) {
  const liveAvailable = useLiveCapability("hyperliquid");
  const { evm: wallet, evmAddress } = useSiseraWallets();
  const { account, error } = useHyperliquidAccount(liveAvailable ? evmAddress : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  // Spot orders are keyed like "@142"; show them by name.
  const [spotNames, setSpotNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    void spotMarkets()
      .then((markets) =>
        setSpotNames(new Map(markets.map((market) => [market.coin, `${market.symbol}/USDC`]))),
      )
      .catch(() => undefined);
  }, []);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    try {
      await action();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "That didn't go through. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function close(coin: string, fraction: number) {
    if (!evmAddress) return;
    const { result } = await placeOrder(evmAddress, wallet, { kind: "close", coin, fraction });
    if (result.status === "filled")
      toast.success(`Closed ${result.filledSize} ${coin} at $${px(Number(result.averagePx))}`);
    else toast.warning("Close sent. Confirming with Hyperliquid…");
  }

  async function cancel(coin: string, oid: number) {
    if (!evmAddress || !account) return;
    await cancelOrder(evmAddress, await assetFor(coin, account), oid);
    announcePerpTrade();
    toast.success("Order cancelled");
  }

  async function submitWithdraw() {
    if (!wallet || !account) return;
    const amount = Number(withdrawAmount);
    if (!(amount > 1)) throw new Error("Withdrawals must be more than the $1 network fee.");
    if (amount > account.available) throw new Error("That's more than your withdrawable balance.");
    await withdraw(wallet, String(Math.floor(amount * 100) / 100));
    setWithdrawOpen(false);
    setWithdrawAmount("");
    announcePerpTrade();
    toast.success("Withdrawal requested", {
      description: "USDC arrives in your wallet on Arbitrum in a few minutes.",
    });
  }

  if (!liveAvailable)
    return (
      <p className="text-xs text-slate-400">
        Live perpetual positions appear here when trading is on.
      </p>
    );
  if (!evmAddress) return <p className="text-xs text-slate-400">Sign in to see your positions.</p>;
  if (!account)
    return <p className="text-xs text-slate-400">{error ?? "Loading your Hyperliquid account…"}</p>;

  const positions = [...account.positions].sort(
    (a, b) => Number(b.coin === activeCoin) - Number(a.coin === activeCoin),
  );
  const unrealized = account.positions.reduce((sum, item) => sum + item.unrealizedPnl, 0);

  return (
    <div className="space-y-5 text-xs">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-line bg-line md:grid-cols-4">
        {[
          ["Account equity", usd(account.accountValue)],
          ["Available", usd(account.available)],
          ["Margin in use", usd(account.marginUsed)],
          ["Unrealized P&L", usd(unrealized)],
        ].map(([label, value]) => (
          <div key={label} className="bg-panel p-3">
            <p className="data-label">{label}</p>
            <p
              className={`mt-1 font-mono text-sm ${label === "Unrealized P&L" ? signTone(unrealized) : "text-slate-100"}`}
            >
              {value}
            </p>
          </div>
        ))}
      </div>

      <div>
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Positions ({positions.length})
        </h4>
        {positions.length === 0 ? (
          <p className="text-slate-500">No open positions. Your fills will appear here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left">
              <thead className="font-mono text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="py-2">Market</th>
                  <th>Size</th>
                  <th>Entry</th>
                  <th>Value</th>
                  <th>P&amp;L (ROE)</th>
                  <th>Liq. price</th>
                  <th>Margin</th>
                  <th className="text-right">Close</th>
                </tr>
              </thead>
              <tbody className="font-mono text-slate-300">
                {positions.map((position) => {
                  const long = position.size > 0;
                  return (
                    <tr key={position.coin} className="border-t border-line">
                      <td className="py-2.5">
                        <Link
                          prefetch={false}
                          href={`/terminal?venue=hyperliquid&symbol=${position.coin}USDT`}
                          className="font-semibold text-slate-100 hover:text-bronze-200"
                        >
                          {position.coin}
                        </Link>{" "}
                        <span className={long ? "text-emerald-300" : "text-rose-300"}>
                          {long ? "Long" : "Short"} {position.leverage}x
                        </span>
                      </td>
                      <td>{Math.abs(position.size)}</td>
                      <td>{px(position.entryPx)}</td>
                      <td>{usd(position.positionValue)}</td>
                      <td className={signTone(position.unrealizedPnl)}>
                        {usd(position.unrealizedPnl)} ({(position.returnOnEquity * 100).toFixed(1)}
                        %)
                      </td>
                      <td>{position.liquidationPx == null ? "—" : px(position.liquidationPx)}</td>
                      <td>
                        {usd(position.marginUsed)}{" "}
                        <span className="text-slate-500">{position.isCross ? "cross" : "iso"}</span>
                      </td>
                      <td className="text-right">
                        <div className="inline-flex gap-1">
                          <PnlShareButton
                            card={{
                              coin: position.coin,
                              market: "perp",
                              side: long ? "long" : "short",
                              leverage: position.leverage,
                              roePct: position.returnOnEquity * 100,
                              pnlUsd: position.unrealizedPnl,
                              entryPx: position.entryPx,
                              markPx: position.positionValue / Math.abs(position.size),
                            }}
                          />
                          <button
                            type="button"
                            disabled={busy != null}
                            onClick={() =>
                              void run(`half:${position.coin}`, () => close(position.coin, 0.5))
                            }
                            className="rounded border border-line px-2 py-1 text-[10px] text-slate-300 hover:border-slate-500 disabled:opacity-40"
                          >
                            {busy === `half:${position.coin}` ? "…" : "50%"}
                          </button>
                          <button
                            type="button"
                            disabled={busy != null}
                            onClick={() =>
                              void run(`all:${position.coin}`, () => close(position.coin, 1))
                            }
                            className="rounded border border-rose-400/40 px-2 py-1 text-[10px] text-rose-200 hover:bg-rose-400/10 disabled:opacity-40"
                          >
                            {busy === `all:${position.coin}` ? "Closing…" : "Close"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Open orders ({account.openOrders.length})
        </h4>
        {account.openOrders.length === 0 ? (
          <p className="text-slate-500">
            No open orders. Take profit and stop loss orders show here.
          </p>
        ) : (
          <div className="divide-y divide-line">
            {account.openOrders.map((order) => (
              <div
                key={order.oid}
                className="flex flex-wrap items-center justify-between gap-2 py-2 font-mono text-slate-300"
              >
                <span>
                  <span className="text-slate-100">{spotNames.get(order.coin) ?? order.coin}</span>{" "}
                  <span className={order.side === "buy" ? "text-emerald-300" : "text-rose-300"}>
                    {order.side === "buy" ? "Buy" : "Sell"}
                  </span>{" "}
                  {order.size} · {order.orderType}
                  {order.triggerPx != null
                    ? ` at ${px(order.triggerPx)}`
                    : ` @ ${px(order.limitPx)}`}
                  {order.reduceOnly ? " · reduce only" : ""}
                </span>
                <button
                  type="button"
                  disabled={busy != null}
                  onClick={() =>
                    void run(`cancel:${order.oid}`, () => cancel(order.coin, order.oid))
                  }
                  className="rounded border border-line px-2 py-1 text-[10px] text-slate-300 hover:border-slate-500 disabled:opacity-40"
                >
                  {busy === `cancel:${order.oid}` ? "Cancelling…" : "Cancel"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-line pt-3">
        {!withdrawOpen ? (
          <button
            type="button"
            disabled={account.available <= 1}
            onClick={() => setWithdrawOpen(true)}
            className="text-[11px] text-bronze-300 hover:text-bronze-200 disabled:text-slate-600"
          >
            Withdraw USDC
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input
              inputMode="decimal"
              value={withdrawAmount}
              onChange={(event) => setWithdrawAmount(event.target.value.trim())}
              placeholder={`Up to ${account.available.toFixed(2)}`}
              aria-label="Withdrawal amount in USDC"
              className="h-9 w-40 rounded border border-line bg-ink-raised px-2 text-right font-mono text-white"
            />
            <button
              type="button"
              disabled={busy != null || !withdrawAmount}
              onClick={() => void run("withdraw", submitWithdraw)}
              className="h-9 rounded bg-bronze-300 px-3 font-semibold text-[#0b1b24] disabled:opacity-40"
            >
              {busy === "withdraw" ? "Waiting for wallet…" : "Withdraw to Arbitrum"}
            </button>
            <button
              type="button"
              onClick={() => setWithdrawOpen(false)}
              className="h-9 px-2 text-slate-400"
            >
              Cancel
            </button>
            <p className="basis-full text-[11px] text-slate-500">
              Hyperliquid charges a $1 fee. USDC arrives on Arbitrum at your Sisera EVM address;
              bridge it to Solana from Portfolio.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
