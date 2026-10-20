"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { pct, platform, usd } from "../../lib/platform";
import { Loading, Note, Panel } from "./ui";

type Row = {
  symbol: string;
  name: string;
  sector: string;
  priceUsd: number | null;
  markPriceUsd: number | null;
  premiumPct: number | null;
  impliedValuationUsd: number | null;
  markValuationUsd: number | null;
  liquidityUsd: number | null;
  change24hPct: number | null;
  riskScore: number;
  newsEvents72h: number;
  portfolioFit: number | null;
  priceSource: string;
};

const SORTS = [
  ["divergence", "Gap to mark"],
  ["discount", "Deepest discount"],
  ["premium", "Highest premium"],
  ["liquidity", "Liquidity"],
  ["momentum", "Momentum"],
  ["risk", "Lowest risk"],
  ["news", "News intensity"],
  ["portfolio_fit", "Portfolio fit"],
] as const;

/** PreStocks ranked by valuation divergence, liquidity, momentum, risk, news or portfolio fit. */
export function PrivateRankings() {
  const [by, setBy] = useState<(typeof SORTS)[number][0]>("divergence");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setRows(null);
    platform<Row[]>(`rankings/private?by=${by}`)
      .then((value) => {
        setRows(value);
        setError(null);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [by]);
  return (
    <Panel
      title="Rank pre-IPO markets"
      actions={
        <div className="hide-scrollbar flex overflow-x-auto border border-line">
          {SORTS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setBy(value)}
              className={`whitespace-nowrap px-2.5 py-1 text-[11px] ${by === value ? "bg-bronze-300 text-ink" : "text-slate-300 hover:text-bone"}`}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      {error && (
        <div className="p-3">
          <Note tone="warning">{error}</Note>
        </div>
      )}
      {!rows && !error && <Loading />}
      {rows && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="border-b border-line text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                {[
                  "#",
                  "Company",
                  "Token",
                  "Mark",
                  "Gap",
                  "Implied valuation",
                  "Liquidity",
                  "24h",
                  "Risk",
                  "Events 72h",
                  ...(by === "portfolio_fit" ? ["Fit"] : []),
                ].map((header) => (
                  <th key={header} className="px-4 py-2.5 font-medium">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="num">
              {rows.map((row, index) => (
                <tr
                  key={row.symbol}
                  className="border-b border-line/50 last:border-0 hover:bg-white/[.02]"
                >
                  <td className="px-4 py-2.5 text-slate-500">{index + 1}</td>
                  <td className="px-4 py-2.5">
                    <Link
                      prefetch={false}
                      href={`/private-markets/${encodeURIComponent(row.symbol)}`}
                      className="font-sans font-semibold text-bone hover:text-bronze-200"
                    >
                      {row.name}
                    </Link>
                    <p className="font-sans text-[10px] text-slate-500">{row.sector}</p>
                  </td>
                  <td className="px-4 py-2.5 text-slate-200" title={row.priceSource}>
                    {usd(row.priceUsd)}
                  </td>
                  <td className="px-4 py-2.5 text-slate-400">{usd(row.markPriceUsd)}</td>
                  <td
                    className={`px-4 py-2.5 ${(row.premiumPct ?? 0) >= 0 ? "text-amber-200" : "text-verdigris-300"}`}
                  >
                    {pct(row.premiumPct)}
                  </td>
                  <td className="px-4 py-2.5 text-slate-300">
                    {usd(row.impliedValuationUsd)}{" "}
                    <span className="text-slate-500">/ {usd(row.markValuationUsd)}</span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-300">{usd(row.liquidityUsd)}</td>
                  <td
                    className={`px-4 py-2.5 ${(row.change24hPct ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                  >
                    {pct(row.change24hPct)}
                  </td>
                  <td className="px-4 py-2.5 text-slate-300">{row.riskScore}</td>
                  <td className="px-4 py-2.5 text-slate-300">{row.newsEvents72h}</td>
                  {by === "portfolio_fit" && (
                    <td className="px-4 py-2.5 text-slate-300">{row.portfolioFit ?? "—"}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-4 py-2 text-[11px] text-slate-500">
            Issuer marks · indicative estimates.
          </p>
        </div>
      )}
    </Panel>
  );
}
