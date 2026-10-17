import type { Metadata } from "next";
import { TradeCheck } from "../../../components/trade-check";

export const metadata: Metadata = {
  title: "Trade Check",
  description:
    "Check a Solana token's price activity, liquidity, large holders and recent news before trading.",
};

export default async function TradeCheckPage({
  searchParams,
}: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <TradeCheck initialInput={token?.slice(0, 512) ?? ""} />;
}
