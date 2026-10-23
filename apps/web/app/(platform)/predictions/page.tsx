import type { PredictionMarket } from "@sisera/domain";
import { Search, Target } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "../../../auth";
import { EmptyState } from "../../../components/empty-state";
import { PageHeader } from "../../../components/page-header";
import { PredictionPaperAccount } from "../../../components/prediction-paper-account";
import { TokenAvatar } from "../../../components/token-avatar";
import { accountErrorMessage, getPredictionMarkets } from "../../../lib/api";
import { predictionLogos } from "../../../lib/asset-logo";

export const metadata: Metadata = {
  title: "Predictions",
  description:
    "Panta prediction markets with cited event research, resolution checks, and measured market structure.",
};

export const dynamic = "force-dynamic";

const PAGE = 50;
const sorts = [
  { id: "volume", label: "Most traded" },
  { id: "closing", label: "Closing soon" },
  { id: "contested", label: "Closest to 50/50" },
] as const;

const phases = [
  { id: "all", label: "All phases" },
  { id: "primary", label: "Primary (Bonding Curve)" },
  { id: "secondary", label: "Secondary (Orderbook)" },
] as const;

const compact = (value: number | null | undefined) =>
  value == null
    ? "—"
    : `$${Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)}`;

function closesIn(closesAt: string | null) {
  if (!closesAt) return "—";
  const hours = (Date.parse(closesAt) - Date.now()) / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

export default async function PredictionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    category?: string;
    phase?: string;
    sort?: string;
    page?: string;
  }>;
}) {
  const parameters = await searchParams;
  const session = await auth();
  const signedIn = Boolean(session) || process.env.SISERA_LOCAL_OPERATOR_MODE === "true";
  const query = (parameters.q ?? "").trim().toLowerCase().slice(0, 80);
  const category = parameters.category ?? "all";
  const phase = (parameters.phase ?? "all").toLowerCase() as "all" | "primary" | "secondary";
  const sort = sorts.find((option) => option.id === parameters.sort)?.id ?? "volume";
  const page = Math.max(0, Number(parameters.page ?? 0) || 0);
  const result = await getPredictionMarkets(
    {
      accessToken: session?.accessToken,
      localOperator: process.env.SISERA_LOCAL_OPERATOR_MODE === "true",
    },
    { limit: PAGE, offset: page * PAGE, category, phase, q: query || undefined, sort },
  ).then(
    (value) => ({ value, error: null as unknown }),
    (error: unknown) => ({ value: null, error }),
  );
  const shown: PredictionMarket[] = result.value?.data ?? [];
  const total = result.value?.total ?? 0;
  const allCount = result.value?.all ?? 0;
  const categories = (result.value?.categories ?? []).map(
    (item) => [item.name, item.count] as const,
  );
  const yes = (market: PredictionMarket) => Number(market.outcomes[0]?.probability ?? 0);
  const link = (next: {
    category?: string;
    phase?: string;
    sort?: string;
    page?: number;
  }) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    const nextCategory = next.category ?? category;
    if (nextCategory !== "all") params.set("category", nextCategory);
    const nextPhase = next.phase ?? phase;
    if (nextPhase !== "all") params.set("phase", nextPhase);
    params.set("sort", next.sort ?? sort);
    if (next.page) params.set("page", String(next.page));
    return `/predictions?${params.toString()}`;
  };

  return (
    <div className="min-h-full bg-ink">
      <PageHeader
        eyebrow="Markets / Predictions"
        title="Prediction markets"
        description="Find an event. Examine its evidence. Compare the case for YES and NO with market structure and resolution criteria."
      />
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-y border-line py-3 text-[11px] text-slate-400">
          <span>
            Powered by{" "}
            <a
              href="https://panta.market"
              target="_blank"
              rel="noreferrer"
              className="text-bronze-300 hover:text-bone"
            >
              Panta
            </a>{" "}
            · Solana prediction markets
          </span>
          <span>Live wallet trading · Cited event research · Explicit resolution checks</span>
        </div>
        {signedIn && (
          <details className="border border-line bg-panel">
            <summary className="cursor-pointer px-4 py-3 text-xs text-slate-400">
              Practice account
            </summary>
            <div className="px-4 pb-4">
              <PredictionPaperAccount />
            </div>
          </details>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <form
              action="/predictions"
              className="flex items-center gap-2 border border-line bg-panel px-3"
            >
              <Search size={13} className="text-slate-400" />
              <input
                name="q"
                defaultValue={parameters.q ?? ""}
                placeholder={`Search ${allCount.toLocaleString()} markets`}
                aria-label="Search prediction markets"
                className="h-9 w-64 bg-transparent text-xs text-bone outline-none placeholder:text-slate-500"
              />
              {category !== "all" && <input type="hidden" name="category" value={category} />}
              {phase !== "all" && <input type="hidden" name="phase" value={phase} />}
              <input type="hidden" name="sort" value={sort} />
            </form>
            <div className="flex border border-line bg-panel">
              {phases.map((option) => {
                const count =
                  option.id === "all"
                    ? (result.value?.phases?.all ?? allCount)
                    : option.id === "primary"
                      ? result.value?.phases?.primary
                      : result.value?.phases?.secondary;
                const active = phase === option.id;
                return (
                  <Link
                    prefetch={false}
                    key={option.id}
                    href={link({ phase: option.id, page: 0 })}
                    className={`flex items-center gap-1.5 px-3 py-2 text-xs transition-colors ${
                      active
                        ? "bg-bronze-300 text-ink font-medium"
                        : "text-slate-300 hover:text-bone hover:bg-white/[.04]"
                    }`}
                  >
                    <span>{option.label}</span>
                    {count != null && (
                      <span
                        className={`font-mono text-[10px] ${
                          active ? "text-ink/80" : "text-slate-500"
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="flex border border-line">
            {sorts.map((option) => (
              <Link
                prefetch={false}
                key={option.id}
                href={link({ sort: option.id, page: 0 })}
                className={`px-3 py-2 text-xs ${sort === option.id ? "bg-bronze-300 text-ink font-medium" : "text-slate-300 hover:text-bone"}`}
              >
                {option.label}
              </Link>
            ))}
          </div>
        </div>
        <nav
          aria-label="Categories"
          className="hide-scrollbar flex gap-1 overflow-x-auto border-b border-line"
        >
          {[["all", allCount] as const, ...categories].map(([name, count]) => (
            <Link
              prefetch={false}
              key={name}
              href={link({ category: name, page: 0 })}
              className={`shrink-0 border-b-2 px-3 py-2 text-[12px] capitalize ${category === name ? "border-bronze-300 text-bone" : "border-transparent text-slate-400 hover:text-slate-200"}`}
            >
              {name} <span className="font-mono text-[11px] text-slate-500">{count}</span>
            </Link>
          ))}
        </nav>
        {shown.length ? (
          <section className="border border-line bg-panel">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-xs">
                <thead className="border-b border-line bg-ink-raised text-[10px] uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-5 py-3 font-medium">Market</th>
                    <th className="px-5 py-3 text-right font-medium">Yes</th>
                    <th className="px-5 py-3 text-right font-medium">No</th>
                    <th className="px-5 py-3 text-right font-medium">Volume</th>
                    <th className="px-5 py-3 text-right font-medium">Closes in</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((market) => {
                    const probability = yes(market);
                    return (
                      <tr
                        key={market.id}
                        className="border-b border-line/60 last:border-0 hover:bg-white/[.03]"
                      >
                        <td className="px-5 py-2.5">
                          <Link
                            prefetch={false}
                            href={`/predictions/${encodeURIComponent(market.id)}`}
                            className="flex items-center gap-3"
                          >
                            {predictionLogos(market) ? (
                              <TokenAvatar
                                src={predictionLogos(market)}
                                symbol={market.category ?? market.title}
                                size={30}
                                className="rounded-md"
                              />
                            ) : (
                              <span className="grid size-[30px] shrink-0 place-items-center rounded-md bg-ink text-slate-500">
                                <Target size={14} />
                              </span>
                            )}
                            <span className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="line-clamp-1 font-medium text-bone">
                                  {market.title}
                                </span>
                                <span
                                  className={`inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded border ${
                                    market.phase === "secondary"
                                      ? "border-purple-500/40 bg-purple-500/10 text-purple-300"
                                      : "border-sky-500/40 bg-sky-500/10 text-sky-300"
                                  }`}
                                  title={
                                    market.phase === "secondary"
                                      ? "Secondary phase: Graduated to open on-chain CLOB orderbook"
                                      : "Primary phase: Virtual bonding curve AMM"
                                  }
                                >
                                  <span
                                    className={`size-1 rounded-full ${
                                      market.phase === "secondary"
                                        ? "bg-purple-400"
                                        : "bg-sky-400 animate-pulse"
                                    }`}
                                  />
                                  {market.phase === "secondary" ? "Secondary" : "Primary"}
                                </span>
                              </div>
                              <span className="text-[11px] text-slate-400">
                                <span className="capitalize">
                                  {[market.category, market.subcategory]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                                {market.quality.source === "panta-onchain"
                                  ? market.quality.status === "stale"
                                    ? " · Prices may be delayed"
                                    : " · Indicative prices"
                                  : market.pricingAvailable === false
                                    ? " · New market, priced when you open it"
                                    : " · View evidence"}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td className="px-5 py-2.5 text-right">
                          {market.pricingAvailable === false ? (
                            <Link
                              href={`/predictions/${encodeURIComponent(market.id)}`}
                              className="whitespace-nowrap text-[11px] text-bronze-300 hover:text-bronze-200"
                            >
                              Live quote →
                            </Link>
                          ) : (
                            <span className="num text-[var(--up)]">
                              {(probability * 100).toFixed(1)}%
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-2.5 text-right">
                          {market.pricingAvailable === false ? null : (
                            <span className="num text-[var(--down)]">
                              {(
                                Number(market.outcomes[1]?.probability ?? 1 - probability) * 100
                              ).toFixed(1)}
                              %
                            </span>
                          )}
                        </td>
                        <td className="num px-5 py-2.5 text-right text-slate-300">
                          {compact(market.volumeUsd)}
                        </td>
                        <td className="num px-5 py-2.5 text-right text-slate-300">
                          {closesIn(market.closesAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[11px] text-slate-400">
              <span>
                {(page * PAGE + 1).toLocaleString()}–{(page * PAGE + shown.length).toLocaleString()}{" "}
                of {total.toLocaleString()}
              </span>
              <div className="flex gap-2">
                {page > 0 && (
                  <Link
                    href={link({ page: page - 1 })}
                    className="border border-line px-3 py-1.5 text-slate-200 hover:border-bone"
                  >
                    Previous
                  </Link>
                )}
                {(page + 1) * PAGE < total && (
                  <Link
                    href={link({ page: page + 1 })}
                    className="border border-line px-3 py-1.5 text-slate-200 hover:border-bone"
                  >
                    Next
                  </Link>
                )}
              </div>
            </div>
          </section>
        ) : (
          <EmptyState
            icon={Target}
            title={allCount ? "No markets match" : "Prediction markets are refreshing"}
            copy={
              result.error
                ? accountErrorMessage(result.error)
                : allCount
                  ? "Try another search or category."
                  : "Markets will appear shortly."
            }
          />
        )}
      </div>
    </div>
  );
}
