"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { pct, platform, usd } from "../../lib/platform";
import { Loading, Note, Panel } from "./ui";

type Paired = {
  mint: string;
  symbol: string;
  name: string;
  change24hPct: number | null;
  liquidityUsd: number | null;
  pairedStock: { symbol: string; change24hPct: number | null };
  relativePerformancePct: number | null;
};
type Ranked = {
  mint: string;
  symbol: string;
  name: string;
  liquidityUsd: number | null;
  change24hPct: number | null;
  top10WalletPct: number | null;
  risk: { score: number; level: string };
  pairedStock: { symbol: string } | null;
};
type Today = {
  gainers: Array<{ mint: string; symbol: string; change24hPct: number | null }>;
  losers: Array<{ mint: string; symbol: string; change24hPct: number | null }>;
  newLaunches: Array<{
    mint: string;
    symbol: string;
    name: string;
    quoteSymbol: string | null;
    createdAt: string | null;
  }>;
  stockPairedCount: number;
};

function useData<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    platform<T>(path)
      .then(setData)
      .catch((reason: Error) => setError(reason.message));
  }, [path]);
  return { data, error };
}

export function AgentMarketPanels() {
  const paired = useData<Paired[]>("agent-market/stock-paired");
  const quality = useData<Ranked[]>("agent-market/rank?by=quality");
  const today = useData<Today>("agent-market/today");
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Panel title="Stock-paired agents vs their stock (24h)">
        {paired.error && (
          <div className="p-3">
            <Note tone="warning">{paired.error}</Note>
          </div>
        )}
        {!paired.data && !paired.error && <Loading />}
        <ul>
          {paired.data?.slice(0, 8).map((row) => (
            <li
              key={row.mint}
              className="flex items-center justify-between border-b border-line/50 px-4 py-2 text-xs last:border-0"
            >
              <Link
                prefetch={false}
                href={`/clawpump/${row.mint}`}
                className="text-bone hover:text-bronze-200"
              >
                {row.symbol} <span className="text-slate-500">/ {row.pairedStock.symbol}</span>
              </Link>
              <span className="num">
                <span className="text-slate-400">
                  {pct(row.change24hPct)} vs {pct(row.pairedStock.change24hPct)}
                </span>{" "}
                <span
                  className={
                    (row.relativePerformancePct ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"
                  }
                >
                  {pct(row.relativePerformancePct)}
                </span>
              </span>
            </li>
          ))}
          {paired.data?.length === 0 && (
            <li className="p-4 text-xs text-slate-400">
              No active agent token is paired with a stock right now.
            </li>
          )}
        </ul>
      </Panel>
      <Panel title="Deep liquidity, low concentration">
        {quality.error && (
          <div className="p-3">
            <Note tone="warning">{quality.error}</Note>
          </div>
        )}
        {!quality.data && !quality.error && <Loading label="Reading top holders onchain…" />}
        <ul>
          {quality.data?.slice(0, 8).map((row) => (
            <li
              key={row.mint}
              className="flex items-center justify-between border-b border-line/50 px-4 py-2 text-xs last:border-0"
            >
              <Link
                prefetch={false}
                href={`/clawpump/${row.mint}`}
                className="text-bone hover:text-bronze-200"
              >
                {row.symbol}
              </Link>
              <span className="num text-slate-400">
                {usd(row.liquidityUsd)} · top-10{" "}
                {row.top10WalletPct == null ? "—" : `${row.top10WalletPct.toFixed(0)}%`} ·{" "}
                <span
                  className={
                    row.risk.level === "low"
                      ? "text-emerald-300"
                      : row.risk.level === "moderate"
                        ? "text-amber-200"
                        : "text-rose-300"
                  }
                >
                  risk {row.risk.score}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Today in agent markets">
        {today.error && (
          <div className="p-3">
            <Note tone="warning">{today.error}</Note>
          </div>
        )}
        {!today.data && !today.error && <Loading />}
        {today.data && (
          <div className="space-y-2 p-4 text-xs text-slate-300">
            <p>
              <span className="text-slate-500">Gainers </span>
              {today.data.gainers.slice(0, 5).map((row) => (
                <Link
                  prefetch={false}
                  key={row.mint}
                  href={`/clawpump/${row.mint}`}
                  className="mr-2 hover:text-bronze-200"
                >
                  {row.symbol} <span className="text-emerald-300">{pct(row.change24hPct, 1)}</span>
                </Link>
              ))}
            </p>
            <p>
              <span className="text-slate-500">Decliners </span>
              {today.data.losers.slice(0, 5).map((row) => (
                <Link
                  prefetch={false}
                  key={row.mint}
                  href={`/clawpump/${row.mint}`}
                  className="mr-2 hover:text-bronze-200"
                >
                  {row.symbol} <span className="text-rose-300">{pct(row.change24hPct, 1)}</span>
                </Link>
              ))}
            </p>
            <p>
              <span className="text-slate-500">New in 24h </span>
              {today.data.newLaunches.slice(0, 8).map((row) => (
                <Link
                  prefetch={false}
                  key={row.mint}
                  href={`/clawpump/${row.mint}`}
                  className="mr-2 hover:text-bronze-200"
                >
                  {row.symbol}
                  {row.quoteSymbol && row.quoteSymbol !== "SOL" ? `/${row.quoteSymbol}` : ""}
                </Link>
              ))}
              {!today.data.newLaunches.length && "none"}
            </p>
            <p className="text-slate-500">
              {today.data.stockPairedCount} of the most active tokens are paired with a stock.
            </p>
          </div>
        )}
      </Panel>
    </div>
  );
}
