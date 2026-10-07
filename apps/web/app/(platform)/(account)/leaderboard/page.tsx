import type { Metadata } from "next";
import { PageHeader } from "../../../../components/page-header";
import { WalletLeaderboard } from "../../../../components/platform/wallet-leaderboard";

export const metadata: Metadata = {
  title: "Leaderboard",
  description: "Live trading performance across Sisera and tracked wallets.",
};
export const dynamic = "force-dynamic";
export default function LeaderboardPage() {
  return (
    <div>
      <PageHeader eyebrow="Live trading" title="Leaderboard" description="" />
      <div className="p-4">
        <WalletLeaderboard />
      </div>
    </div>
  );
}
