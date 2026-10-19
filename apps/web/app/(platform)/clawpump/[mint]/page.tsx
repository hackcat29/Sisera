import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "../../../../auth";
import { AssetEventFeed } from "../../../../components/platform/event-feed";
import { ImpactWidget } from "../../../../components/platform/impact-widget";
import { SignInToTrade } from "../../../../components/sign-in-to-trade";
import { StockTradeTicket } from "../../../../components/stock-trade-ticket";
import { TokenAvatar } from "../../../../components/token-avatar";
import { TradingChart } from "../../../../components/trading-chart";
import { getAgentTokenDetail, getSolanaTokenHistory } from "../../../../lib/api";
import { pct, usd } from "../../../../lib/platform";

export const metadata: Metadata = {
  title: "Agent token",
  description:
    "Clawpump agent token with liquidity, holder concentration, risk score and paired-stock performance.",
};

export const dynamic = "force-dynamic";

export default async function AgentTokenPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) notFound();
  const session = await auth();
  const signedIn = Boolean(session) || process.env.SISERA_LOCAL_OPERATOR_MODE === "true";
  const identity = {
    accessToken: session?.accessToken,
    localOperator: process.env.SISERA_LOCAL_OPERATOR_MODE === "true",
  };
  const detail = await getAgentTokenDetail(mint, identity).catch(() => null);
  if (!detail) notFound();
  const history = await getSolanaTokenHistory(mint, "1h", identity).catch(() => []);
  const { asset, token, concentration, risk, pairedStock } = detail;
  const initialBars = history.map((point) => ({
    time: Math.floor(Date.parse(point.time) / 1000),
    open: point.open,
    high: point.high,
    low: point.low,
    close: point.close,
    volume: point.volumeUsd ?? 0,
  }));
  const stats: Array<[string, string, string?]> = [
    ["Price", usd(asset.priceUsd), pct(asset.change24hPct)],
    ["Liquidity", usd(asset.liquidityUsd)],
    ["24h volume", usd(asset.volume24hUsd)],
    ["Market cap", usd(asset.marketCapUsd)],
    ["Risk score", `${risk.score}/100`, risk.level],
  ];
  return (
    <div className="min-h-full bg-ink">
      <div className="border-b border-line px-4 py-5 md:px-6">
        <p className="data-label text-bronze-300">
          <Link prefetch={false} href="/clawpump" className="hover:underline">
            Agent markets
          </Link>{" "}
          / {asset.symbol}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <TokenAvatar
            src={asset.imageUrl}
            symbol={asset.symbol}
            size={36}
            className="border border-line"
          />
          <h1 className="display text-[26px] text-bone">
            {asset.name} <span className="font-mono text-base text-slate-400">{asset.symbol}</span>
          </h1>
          {token?.verified && (
            <span className="border border-verdigris-400/40 px-1.5 font-mono text-[10px] uppercase text-verdigris-300">
              verified
            </span>
          )}
          {token?.graduated && (
            <span className="border border-line px-1.5 font-mono text-[10px] uppercase text-slate-400">
              graduated
            </span>
          )}
          {asset.pairedStock && (
            <span className="border border-bronze-500/40 px-1.5 font-mono text-[10px] uppercase text-bronze-200">
              paired with {asset.pairedStock.symbol}
            </span>
          )}
        </div>
        {token?.description && (
          <p className="mt-2 max-w-3xl text-[13px] leading-6 text-slate-400">
            {token.description.slice(0, 400)}
          </p>
        )}
        <div className="mt-4 grid gap-px border border-line bg-line sm:grid-cols-5">
          {stats.map(([label, value, hint]) => (
            <div key={label} className="bg-panel p-3">
              <p className="data-label text-slate-500">{label}</p>
              <p className="num mt-1 text-lg text-bone">{value}</p>
              {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-4 p-4 md:p-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <TradingChart
            source={{ kind: "solana", id: mint }}
            title={`${asset.symbol} · Solana`}
            initialBars={initialBars}
            defaultInterval="1h"
          />
          <div className="grid gap-4 md:grid-cols-2">
            <section className="border border-line bg-panel">
              <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-bone">
                Risk breakdown
              </h2>
              <ul className="p-4 text-xs">
                {risk.components.map((component) => (
                  <li
                    key={component.name}
                    className="flex justify-between gap-3 border-b border-line/50 py-1.5 last:border-0"
                  >
                    <span className="text-slate-300">
                      {component.name}
                      <span className="block text-[11px] text-slate-500">{component.detail}</span>
                    </span>
                    <span className="num text-slate-400">+{component.points}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="border border-line bg-panel">
              <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-bone">
                Holders & paired stock
              </h2>
              <div className="space-y-2 p-4 text-xs text-slate-300">
                {concentration ? (
                  <>
                    <p>
                      Top 10 wallets hold{" "}
                      <span className="num text-bone">
                        {concentration.top10WalletPct.toFixed(1)}%
                      </span>
                      ; the largest wallet {concentration.top1WalletPct.toFixed(1)}%.
                    </p>
                    <p>
                      Pools, curves and lockers hold {concentration.programHeldPct.toFixed(1)}%.
                    </p>
                    <p className="text-[11px] text-slate-500">{concentration.method}</p>
                  </>
                ) : (
                  <p className="text-slate-500">Holder data is unavailable.</p>
                )}
                {pairedStock ? (
                  <p className="border-t border-line pt-2">
                    24h: {asset.symbol} {pct(asset.change24hPct)} vs {pairedStock.symbol}{" "}
                    {pct(pairedStock.change24hPct)} —{" "}
                    <span
                      className={
                        (pairedStock.relativePerformancePct ?? 0) >= 0
                          ? "text-emerald-300"
                          : "text-rose-300"
                      }
                    >
                      {pairedStock.relativePerformancePct == null
                        ? "no comparison"
                        : `${pct(pairedStock.relativePerformancePct)} relative`}
                    </span>
                  </p>
                ) : (
                  <p className="border-t border-line pt-2 text-slate-500">
                    Not paired with a stock token ({token?.quoteSymbol ?? "SOL"} pair).
                  </p>
                )}
                {token?.creatorAllocationBps != null && (
                  <p>
                    Creator allocation {(token.creatorAllocationBps / 100).toFixed(1)}%
                    {token.vesting?.durationDays
                      ? `, vesting ${token.vesting.durationDays} days after a ${token.vesting.cliffDays ?? 0}-day cliff`
                      : ""}
                    .
                  </p>
                )}
                <div className="flex gap-3 pt-1">
                  {token?.website && (
                    <a
                      href={token.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-bronze-200"
                    >
                      Website <ArrowUpRight size={11} />
                    </a>
                  )}
                  {token?.twitter && (
                    <a
                      href={token.twitter}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-bronze-200"
                    >
                      X <ArrowUpRight size={11} />
                    </a>
                  )}
                  <a
                    href={`https://clawpump.tech/tokens/${mint}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-bronze-200"
                  >
                    Clawpump <ArrowUpRight size={11} />
                  </a>
                </div>
              </div>
            </section>
          </div>
          <AssetEventFeed assetKey={mint} symbol={asset.symbol} />
        </div>
        <div className="space-y-4 self-start lg:sticky lg:top-4">
          {signedIn ? (
            <>
              <StockTradeTicket
                mint={mint}
                symbol={asset.symbol}
                price={asset.priceUsd == null ? null : String(asset.priceUsd)}
              />
              <ImpactWidget assetKey={mint} symbol={asset.symbol} />
            </>
          ) : (
            <SignInToTrade label={asset.symbol} returnTo={`/clawpump/${mint}`} />
          )}
        </div>
      </div>
    </div>
  );
}
