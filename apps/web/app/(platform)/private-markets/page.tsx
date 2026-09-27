import { CircleAlert, Landmark, RadioTower } from "lucide-react";
import { auth } from "../../../auth";
import { LiveRefresh } from "../../../components/live-refresh";
import { PageHeader } from "../../../components/page-header";
import { PrivateMarketScreener } from "../../../components/private-market-screener";
import { getPrivateMarkets } from "../../../lib/api";

export const dynamic = "force-dynamic";

export default async function PrivateMarketsPage() {
  const session = await auth();
  const identity = {
    accessToken: session?.accessToken,
    localOperator: process.env.SISERA_LOCAL_OPERATOR_MODE === "true",
  };
  const markets = await getPrivateMarkets(identity).catch(() => []);
  const fetchedAt = markets[0]?.fetchedAt;

  return (
    <div className="min-h-full bg-ink">
      <PageHeader
        eyebrow="Solana / PreStocks Layer"
        title="PreStocks private markets"
        description="Compare onchain private-market token quotes with PreStocks provider marks and inspect valuation context before trading."
        actions={<LiveRefresh />}
      />
      <div className="space-y-5 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
          <div className="flex items-center gap-3">
            <Landmark size={17} className="text-cyan-300" />
            <span className="text-sm font-semibold text-white">Private companies</span>
            <span className="rounded border border-line px-2 py-1 font-mono text-[10px] text-slate-400">
              {markets.length} assets
            </span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px] text-slate-500">
            <RadioTower size={12} /> Updated{" "}
            {fetchedAt ? new Date(fetchedAt).toLocaleTimeString() : "unavailable"}
          </div>
        </div>
        {markets.length ? (
          <PrivateMarketScreener markets={markets} />
        ) : (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/[.06] p-5 text-sm text-amber-100">
            <CircleAlert size={16} className="mt-0.5" /> Private-market prices are temporarily
            unavailable.
          </div>
        )}
      </div>
    </div>
  );
}
