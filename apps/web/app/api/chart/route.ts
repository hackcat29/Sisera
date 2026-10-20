import { type NextRequest, NextResponse } from "next/server";
import { serverApiUrl } from "../../../lib/server-api-url";

export type ChartBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const intervals = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);

/** Candles for the trading chart, normalized across Solana tokens and Hyperliquid perps and spot. */
export async function GET(request: NextRequest) {
  const source = request.nextUrl.searchParams.get("source");
  const id = request.nextUrl.searchParams.get("id") ?? "";
  const interval = request.nextUrl.searchParams.get("interval") ?? "1h";
  if (!intervals.has(interval))
    return NextResponse.json({ error: "invalid_interval" }, { status: 400 });

  // Hyperliquid spot pairs ("@142", "PURR/USDC") come straight from Hyperliquid's public API.
  if (source === "hyperliquid-spot" && /^(?:@\d{1,5}|[A-Z0-9]{1,12}\/USDC)$/.test(id)) {
    const minutes =
      { "1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240, "1d": 1440 }[interval] ?? 60;
    const endTime = Date.now();
    const response = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "candleSnapshot",
        req: { coin: id, interval, startTime: endTime - minutes * 60_000 * 500, endTime },
      }),
      next: { revalidate: interval === "1m" ? 5 : 15 },
      signal: AbortSignal.timeout(12_000),
    }).catch(() => null);
    if (!response?.ok) return NextResponse.json({ data: [] }, { status: 503 });
    const candles = (await response.json()) as Array<Record<string, string | number>>;
    const data: ChartBar[] = candles
      .map((candle) => ({
        time: Math.floor(Number(candle.t) / 1000),
        open: Number(candle.o),
        high: Number(candle.h),
        low: Number(candle.l),
        close: Number(candle.c),
        // Hyperliquid reports base volume; the chart shows dollar volume.
        volume: Number(candle.v) * Number(candle.c),
      }))
      .filter((bar) => Number.isFinite(bar.time) && bar.close > 0);
    return NextResponse.json({ data }, { headers: { "cache-control": "public, max-age=5" } });
  }

  let url: string;
  if (source === "solana" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(id))
    url = `/v1/solana/tokens/${id}/history?interval=${interval}`;
  else if ((source === "binance" || source === "hyperliquid") && /^[A-Za-z0-9]{2,20}$/.test(id))
    url = `/v1/markets/${encodeURIComponent(id)}/candles?venue=${source}&interval=${interval}&limit=500`;
  else return NextResponse.json({ error: "invalid_source" }, { status: 400 });

  const response = await fetch(`${serverApiUrl()}${url}`, {
    next: { revalidate: interval === "1m" ? 5 : 15 },
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);
  if (!response?.ok) return NextResponse.json({ data: [] }, { status: 503 });
  const payload = (await response.json()) as {
    data: Array<Record<string, string | number | null>>;
  };
  const data: ChartBar[] = payload.data
    .map((row) => ({
      time:
        typeof row.time === "string" ? Math.floor(Date.parse(row.time) / 1000) : Number(row.time),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume ?? row.volumeUsd ?? 0),
    }))
    .filter((bar) => Number.isFinite(bar.time) && Number.isFinite(bar.close) && bar.close > 0)
    .sort((a, b) => a.time - b.time)
    .filter((bar, index, bars) => index === 0 || bar.time !== bars[index - 1]?.time);
  return NextResponse.json({ data });
}
