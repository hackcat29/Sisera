"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { perpLogos } from "../lib/asset-logo";
import { usePerpMid } from "../lib/market-streams";
import { formatSignedPct, signTone } from "../lib/sign";
import { TokenAvatar } from "./token-avatar";

type Perp = { coin: string; prevDay: number; mark: number; volumeUsd: number; funding: number };

function PerpChip({ perp, active, interval }: { perp: Perp; active: boolean; interval: string }) {
  const mid = usePerpMid(perp.coin) ?? perp.mark;
  const change = perp.prevDay > 0 ? (mid / perp.prevDay - 1) * 100 : null;
  return (
    <Link
      href={`/terminal?symbol=${perp.coin}USDT&interval=${interval}&venue=hyperliquid`}
      className={`flex min-w-40 shrink-0 items-center justify-between gap-4 border px-3 py-2.5 hover:border-slate-500 ${active ? "border-bronze-400/60 bg-bronze-400/[0.08]" : "border-line bg-panel"}`}
    >
      <div className="flex items-center gap-2.5">
        <TokenAvatar src={perpLogos(perp.coin)} symbol={perp.coin} size={22} />
        <div>
          <p className="text-xs font-semibold text-bone">{perp.coin}</p>
          <p className="num mt-0.5 text-[11px] text-slate-400">
            {mid.toLocaleString("en-US", { maximumFractionDigits: mid >= 1 ? 2 : 6 })}
          </p>
        </div>
      </div>
      <span className={`num text-xs ${signTone(change)}`}>{formatSignedPct(change)}</span>
    </Link>
  );
}

/** Every Hyperliquid perpetual, by 24h volume, with mids streamed live. */
export function PerpMarketStrip({ active, interval }: { active: string; interval: string }) {
  const [perps, setPerps] = useState<Perp[]>([]);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    })
      .then((response) => response.json())
      .then(
        ([meta, contexts]: [
          { universe: Array<{ name: string; isDelisted?: boolean }> },
          Array<{ prevDayPx: string; markPx: string; dayNtlVlm: string; funding: string }>,
        ]) => {
          if (cancelled) return;
          setPerps(
            meta.universe
              .map((asset, index) => ({ asset, context: contexts[index] }))
              .filter(({ asset, context }) => !asset.isDelisted && context)
              .map(({ asset, context }) => ({
                coin: asset.name,
                prevDay: Number(context?.prevDayPx),
                mark: Number(context?.markPx),
                volumeUsd: Number(context?.dayNtlVlm),
                funding: Number(context?.funding),
              }))
              .sort((a, b) => b.volumeUsd - a.volumeUsd),
          );
        },
      )
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const shown = useMemo(() => {
    const needle = query.trim().toUpperCase();
    return perps.filter((perp) => perp.coin.includes(needle)).slice(0, needle ? 60 : 40);
  }, [perps, query]);
  const activeCoin = active.replace(/USDT$/, "");

  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-3">
        <label className="flex items-center gap-2 border border-line bg-ink px-3">
          <Search size={13} className="text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${perps.length || ""} perpetuals`}
            aria-label="Search perpetuals"
            className="h-8 w-48 bg-transparent text-xs text-bone outline-none placeholder:text-slate-500"
          />
        </label>
        <span className="text-[11px] text-slate-400">
          {perps.length
            ? `${perps.length} Hyperliquid perpetuals by 24h volume`
            : "Loading markets…"}
        </span>
      </div>
      <div className="hide-scrollbar flex gap-2 overflow-x-auto pb-1">
        {shown.map((perp) => (
          <PerpChip
            key={perp.coin}
            perp={perp}
            active={perp.coin === activeCoin}
            interval={interval}
          />
        ))}
      </div>
    </div>
  );
}
