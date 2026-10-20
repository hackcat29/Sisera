import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "../../../components/page-header";
import { SpotScreener } from "../../../components/spot-screener";

export const metadata: Metadata = {
  title: "Crypto spot",
  description: "Hyperliquid spot markets with live prices, 24h change and volume.",
};

export default async function MarketsPage({
  searchParams,
}: { searchParams: Promise<{ venue?: string }> }) {
  if ((await searchParams).venue === "hyperliquid") redirect("/terminal?venue=hyperliquid");
  return (
    <div className="min-h-full">
      <PageHeader
        eyebrow="Markets / Crypto spot"
        title="Crypto spot markets"
        description="Buy and sell crypto on Hyperliquid spot from your own account, with live prices."
      />
      <div className="p-4 md:p-6">
        <div className="mb-4 flex gap-2 text-xs">
          <Link
            href="/terminal?venue=hyperliquid"
            className="border border-line px-3 py-2 text-slate-300 hover:text-bone"
          >
            Perpetuals
          </Link>
          <span className="border border-line bg-bronze-400/10 px-3 py-2 text-bronze-200">
            Spot
          </span>
        </div>
        <SpotScreener />
      </div>
    </div>
  );
}
