import type { Metadata } from "next";
import { auth } from "../../../../auth";
import { PageHeader } from "../../../../components/page-header";
import { StrategyMarketplace } from "../../../../components/platform/strategy-marketplace";
import { getAgents } from "../../../../lib/api";

export const metadata: Metadata = {
  title: "Marketplace",
  description: "Discover, license and sell trading strategies on Sisera.",
};
export const dynamic = "force-dynamic";
export default async function MarketplacePage() {
  const session = await auth();
  const agents = await getAgents({
    accessToken: session?.accessToken,
    localOperator: process.env.SISERA_LOCAL_OPERATOR_MODE === "true",
  }).catch(() => null);
  return (
    <div>
      <PageHeader
        eyebrow="Strategies by the community"
        title="Marketplace"
        description="Turn your trading ideas into income. Discover strategies, buy a license, and make them your own."
      />
      <StrategyMarketplace
        agents={(agents?.custom ?? [])
          .filter((a) => a.hasRules)
          .map((a) => ({ id: a.id, name: a.name, version: a.version }))}
      />
    </div>
  );
}
