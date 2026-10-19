import { BadgeCheck, Boxes, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "../../../auth";
import { EmptyState } from "../../../components/empty-state";
import { LiveTokenPrice } from "../../../components/live-price";
import { PageHeader } from "../../../components/page-header";
import { AgentMarketPanels } from "../../../components/platform/agent-market-panels";
import { TokenAvatar } from "../../../components/token-avatar";
import { getAgentTokens } from "../../../lib/api";

export const metadata: Metadata = {
  title: "Agent markets",
  description: "Every token launched by AI agents on Clawpump, with price, volume, and market cap.",
};

export const dynamic = "force-dynamic";

const PAGE = 60;
const sorts = [
  { id: "volume", label: "24h volume" },
  { id: "mcap", label: "Market cap" },
  { id: "new", label: "Newest" },
] as const;
const compact = (value: number | null) =>
  value == null
    ? "—"
    : `$${Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)}`;

export default async function AgentMarkets({
  searchParams,
}: { searchParams: Promise<{ q?: string; sort?: string; page?: string }> }) {
  const parameters = await searchParams;
  const query = (parameters.q ?? "").trim().slice(0, 80);
  const sort = sorts.find((option) => option.id === parameters.sort)?.id ?? "volume";
  const page = Math.max(0, Math.min(300, Number(parameters.page ?? 0) || 0));
  const session = await auth();
  const identity = {
    accessToken: session?.accessToken,
    localOperator: process.env.SISERA_LOCAL_OPERATOR_MODE === "true",
  };
  const result = await getAgentTokens(
    { sort, q: query || undefined, limit: PAGE, offset: page * PAGE },
    identity,
  ).catch(() => null);
  const tokens = result?.data ?? [];
  const link = (next: { q?: string; sort?: string; page?: number }) => {
    const params = new URLSearchParams();
    const q = next.q ?? query;
    if (q) params.set("q", q);
    params.set("sort", next.sort ?? sort);
    if (next.page) params.set("page", String(next.page));
    return `/clawpump?${params.toString()}`;
  };

  return (
    <div className="min-h-full bg-ink">
      <PageHeader
        eyebrow="Markets / Agent tokens"
        title="Agent markets"
        description="Tokens launched by AI agents on Clawpump: tradable in Sisera with liquidity, holder concentration, risk scores and performance against their paired stock."
        actions={
          <Link
            href="/launch"
            className="border border-bronze-300 bg-bronze-300 px-3 py-2 text-xs font-semibold text-ink hover:bg-bronze-200"
          >
            Launch an agent token
          </Link>
        }
      />
      <div className="p-4 md:p-6">
        <div className="mb-4">
          <AgentMarketPanels />
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <form
            action="/clawpump"
            className="flex items-center gap-2 border border-line bg-panel px-3"
          >
            <Search size={13} className="text-slate-400" />
            <input
              name="q"
              defaultValue={query}
              placeholder="Search agents or tokens"
              aria-label="Search agent tokens"
              className="h-9 w-56 bg-transparent text-xs text-bone outline-none placeholder:text-slate-500"
            />
            <input type="hidden" name="sort" value={sort} />
          </form>
          <div className="flex border border-line">
            {sorts.map((option) => (
              <Link
                prefetch={false}
                key={option.id}
                href={link({ sort: option.id, page: 0 })}
                className={`px-3 py-2 text-xs ${sort === option.id ? "bg-bronze-300 text-ink" : "text-slate-300 hover:text-bone"}`}
              >
                {option.label}
              </Link>
            ))}
          </div>
          {result && (
            <span className="text-[12px] text-slate-400">
              {result.total.toLocaleString()} agent tokens{query ? ` matching "${query}"` : ""}
            </span>
          )}
        </div>
        {tokens.length ? (
          <section className="border border-line bg-panel">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-left text-xs">
                <thead className="border-b border-line bg-ink-raised text-[10px] uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-5 py-3 font-medium">Agent token</th>
                    <th className="px-5 py-3 text-right font-medium">Price</th>
                    <th className="px-5 py-3 text-right font-medium">Market cap</th>
                    <th className="px-5 py-3 text-right font-medium">24h volume</th>
                    <th className="px-5 py-3 text-right font-medium">Liquidity</th>
                    <th className="px-5 py-3 font-medium">Links</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((token) => (
                    <tr
                      key={token.mint}
                      className="border-b border-line/60 last:border-0 hover:bg-white/[.03]"
                    >
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-3">
                          <TokenAvatar src={token.imageUrl} symbol={token.symbol} />
                          <div className="min-w-0">
                            <Link
                              prefetch={false}
                              href={`/clawpump/${token.mint}`}
                              className="flex items-center gap-1.5 font-semibold text-bone hover:text-bronze-200"
                            >
                              {token.symbol}
                              {token.verified && (
                                <BadgeCheck size={13} className="text-bronze-300" />
                              )}
                              {token.graduated && (
                                <span className="border border-line px-1 text-[9px] font-normal uppercase text-slate-400">
                                  Graduated
                                </span>
                              )}
                            </Link>
                            <p className="max-w-xs truncate text-[11px] text-slate-400">
                              {token.agentName ?? token.name}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-2.5 text-right text-bone">
                        <LiveTokenPrice mint={token.mint} fallback={token.priceUsd} />
                      </td>
                      <td className="num px-5 py-2.5 text-right text-slate-300">
                        {compact(token.marketCapUsd)}
                      </td>
                      <td className="num px-5 py-2.5 text-right text-slate-300">
                        {compact(token.volume24hUsd)}
                      </td>
                      <td className="num px-5 py-2.5 text-right text-slate-300">
                        {compact(token.liquidityUsd)}
                      </td>
                      <td className="px-5 py-2.5">
                        <div className="flex gap-3 text-[11px]">
                          <a
                            href={`https://dexscreener.com/solana/${token.mint}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-bronze-300 hover:text-bone"
                          >
                            Chart
                          </a>
                          {token.twitter && (
                            <a
                              href={token.twitter}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-slate-300 hover:text-bone"
                            >
                              X
                            </a>
                          )}
                          {token.website && (
                            <a
                              href={token.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-slate-300 hover:text-bone"
                            >
                              Site
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[11px] text-slate-400">
              <span>
                Page {page + 1}
                {result
                  ? ` of ${Math.max(1, Math.ceil(result.total / PAGE)).toLocaleString()}`
                  : ""}
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
                {result?.hasMore && (
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
            icon={Boxes}
            title={query ? "No agent tokens match this search" : "Agent listings are reconnecting"}
            copy={
              query ? "Try another agent or token name." : "Clawpump listings will appear shortly."
            }
          />
        )}
      </div>
    </div>
  );
}
