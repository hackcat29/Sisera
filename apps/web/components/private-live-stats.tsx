"use client";

import { useLivePrice } from "../lib/live-prices";
import { formatSignedPct, signTone } from "../lib/sign";
import { LiveNumber } from "./live-number";
import { TokenAvatar } from "./token-avatar";

const usd = (value: number) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const billions = (value: number) =>
  `$${Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value)}`;

/** Token price against the issuer mark for a pre-IPO token, refreshed every second. */
export function PrivateLiveStats({
  mint,
  company,
  symbol,
  description,
  tokenPrice,
  markPrice,
  impliedValuation,
  markValuation,
  imageUrl,
}: {
  imageUrl?: string | null | undefined;
  mint: string;
  company: string;
  symbol: string;
  description: string | null;
  tokenPrice: number;
  markPrice: number;
  impliedValuation: number;
  markValuation: number;
}) {
  const live = useLivePrice(mint);
  const token = live?.usd ?? tokenPrice;
  const premium = markPrice > 0 ? (token / markPrice - 1) * 100 : null;
  // The issuer's implied valuation, moved in proportion to the live token price.
  const implied = tokenPrice > 0 ? impliedValuation * (token / tokenPrice) : null;
  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-4 py-5 sm:px-6">
        <div className="flex max-w-3xl items-start gap-4">
          <TokenAvatar src={imageUrl} symbol={symbol} size={52} className="rounded-xl" />
          <div>
            <p className="data-label text-bronze-300">{symbol} · Pre-IPO token on Solana</p>
            <h1 className="display mt-2 text-[32px] leading-tight text-bone">
              {company.replace(/ PreStocks$/, "")}
            </h1>
            {description && (
              <p className="mt-2 text-[13px] leading-6 text-slate-400">{description}</p>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="text-3xl text-bone">
            <LiveNumber value={token} display={usd(token)} />
          </p>
          <p className={`num mt-1 text-[13px] ${signTone(premium)}`}>
            {formatSignedPct(premium)} vs issuer mark
          </p>
        </div>
      </header>
      <dl className="grid grid-cols-2 gap-px border-b border-line bg-line xl:grid-cols-4">
        {[
          { label: "Issuer mark", value: usd(markPrice) },
          { label: "Premium / discount", value: formatSignedPct(premium), tone: signTone(premium) },
          { label: "Implied valuation", value: implied ? billions(implied) : "—" },
          { label: "Mark valuation", value: billions(markValuation) },
        ].map((stat) => (
          <div key={stat.label} className="bg-panel px-4 py-3.5 sm:px-6">
            <dt className="data-label">{stat.label}</dt>
            <dd className={`num mt-1.5 text-lg ${stat.tone ?? "text-bone"}`}>{stat.value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
