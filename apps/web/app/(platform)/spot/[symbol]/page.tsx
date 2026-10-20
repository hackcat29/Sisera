import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "../../../../auth";
import { SpotMarketView } from "../../../../components/spot-market";

type Params = { params: Promise<{ symbol: string }> };

/** "BTCUSDT" (the old Binance URLs) and "btc" both mean the BTC/USDC spot pair. */
function normalize(raw: string) {
  const symbol = decodeURIComponent(raw).toUpperCase();
  return /^[A-Z0-9]{2,}(USDT|USDC)$/.test(symbol) ? symbol.replace(/(USDT|USDC)$/, "") : symbol;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const symbol = normalize((await params).symbol);
  return { title: `${symbol} / USDC spot`, description: `Trade ${symbol} spot on Hyperliquid.` };
}

export default async function SpotPage({ params }: Params) {
  const raw = (await params).symbol;
  const symbol = normalize(raw);
  if (!/^[A-Z0-9]{1,12}$/.test(symbol)) redirect("/markets");
  if (symbol !== raw) redirect(`/spot/${symbol}`);
  const session = await auth();
  const signedIn = Boolean(session) || process.env.SISERA_LOCAL_OPERATOR_MODE === "true";
  return <SpotMarketView symbol={symbol} signedIn={signedIn} />;
}
