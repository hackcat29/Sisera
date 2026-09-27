import { NextResponse } from "next/server";
import { auth } from "../../../auth";
import { getPrivateMarkets, getPublicStocks } from "../../../lib/api";

export async function GET() {
  const session = await auth();
  const localOperator =
    process.env.NODE_ENV !== "production" && process.env.SISERA_LOCAL_OPERATOR_MODE === "true";
  if (!session && !localOperator)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const identity = { accessToken: session?.accessToken, localOperator };
  const [stocks, privateMarkets] = await Promise.allSettled([
    getPublicStocks(identity),
    getPrivateMarkets(identity),
  ]);
  if (stocks.status === "rejected" && privateMarkets.status === "rejected")
    return NextResponse.json({ error: "market_index_unavailable" }, { status: 503 });
  const results = [
    ...(stocks.status === "fulfilled"
      ? stocks.value.map((stock) => ({
          href: `/stocks/${encodeURIComponent(stock.symbol)}`,
          name: stock.name,
          symbol: stock.symbol,
          category: "Public stock" as const,
        }))
      : []),
    ...(privateMarkets.status === "fulfilled"
      ? privateMarkets.value.map((asset) => ({
          href: `/private-markets/${encodeURIComponent(asset.instrument.baseAsset)}`,
          name: asset.company,
          symbol: asset.instrument.baseAsset,
          category: "Private market" as const,
        }))
      : []),
  ];
  return NextResponse.json(
    { data: results },
    { headers: { "cache-control": "private, max-age=60" } },
  );
}
