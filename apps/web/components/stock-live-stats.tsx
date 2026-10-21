"use client";

import { useLivePrice } from "../lib/live-prices";
import { formatSignedPct, signTone } from "../lib/sign";
import { LiveNumber } from "./live-number";
import { TokenAvatar } from "./token-avatar";

const usd = (value: number | null | undefined) =>
  value == null
    ? "—"
    : `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const compact = (value: number | null | undefined) =>
  value == null
    ? "—"
    : `$${Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value)}`;

/** Price, change, share price, and premium for a stock token, refreshed every second. */
export function StockLiveStats({
  mint,
  name,
  symbol,
  underlyingSymbol,
  price,
  change24hPct,
  volume24hUsd,
  liquidityUsd,
  referencePrice,
  referenceLive,
  logoUrl,
}: {
  logoUrl?: string | null | undefined;
  mint: string;
  name: string;
  symbol: string;
  underlyingSymbol: string;
  price: number | null;
  change24hPct: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  referencePrice: number | null;
  referenceLive: boolean;
}) {
  const live = useLivePrice(mint);
  const tokenPrice = live?.usd ?? price;
  const change = live?.change24hPct ?? change24hPct;
  const share = live?.underlyingUsd ?? referencePrice;
  const premium = tokenPrice && share ? (tokenPrice / share - 1) * 100 : null;
  const stats: Array<{ label: string; value: string; tone?: string }> = [
    { label: "24h change", value: formatSignedPct(change), tone: signTone(change) },
    { label: "24h volume", value: compact(volume24hUsd) },
    { label: "Liquidity", value: compact(liquidityUsd) },
    { label: `${underlyingSymbol} share`, value: usd(share) },
    { label: "Premium / discount", value: formatSignedPct(premium), tone: signTone(premium) },
    {
      label: "Share price",
      value: live?.underlyingUsd != null || referenceLive ? "Live" : "Last close",
    },
  ];
  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-4 py-5 sm:px-6">
        <div className="flex items-center gap-4">
          <TokenAvatar src={logoUrl} symbol={underlyingSymbol} size={52} className="rounded-xl" />
          <div>
            <p className="data-label text-bronze-300">
              {underlyingSymbol} · {symbol} · Tokenized stock on Solana
            </p>
            <h1 className="display mt-2 text-[32px] leading-tight text-bone">{name}</h1>
          </div>
        </div>
        <div className="text-right">
          <p className="text-3xl text-bone">
            <LiveNumber value={tokenPrice} display={usd(tokenPrice)} />
          </p>
          <p className={`num mt-1 text-[13px] ${signTone(change)}`}>
            {formatSignedPct(change)} 24h
          </p>
        </div>
      </header>
      <dl className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-3 xl:grid-cols-6">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-panel px-4 py-3.5 sm:px-6">
            <dt className="data-label">{stat.label}</dt>
            <dd className={`num mt-1.5 text-lg ${stat.tone ?? "text-bone"}`}>{stat.value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
