import { z } from "zod";

const Timestamp = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]);
const PythSymbol = z.object({
  pyth_lazer_id: z.number().int().nonnegative(),
  symbol: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  asset_type: z.string(),
  min_channel: z.string().optional(),
});
const PythFeed = z.object({
  priceFeedId: z.number().int(),
  price: z.union([z.string(), z.number()]).optional(),
  confidence: z.union([z.string(), z.number()]).optional(),
  exponent: z.number().int(),
  marketSession: z.string().optional(),
  feedUpdateTimestamp: Timestamp.optional(),
});
const PythResponse = z.object({
  parsed: z.object({
    timestampUs: Timestamp,
    priceFeeds: z.array(PythFeed),
  }),
});

export type PythReference = {
  symbol: string;
  feedId: number;
  price: string;
  confidence: string | null;
  marketSession: string | null;
  feedUpdateTimestamp: string;
  streamTimestamp: string;
  referenceFreshness: "live" | "carried_forward" | "stale";
  ageMs: number;
  source: "pyth-pro";
};

export function decimalFromMantissa(value: string | number, exponent: number): string {
  const integer = BigInt(value);
  const negative = integer < 0n;
  const digits = (negative ? -integer : integer).toString();
  if (exponent >= 0) return `${negative ? "-" : ""}${digits}${"0".repeat(exponent)}`;
  const position = digits.length + exponent;
  const padded =
    position > 0
      ? `${digits.slice(0, position)}.${digits.slice(position)}`
      : `0.${"0".repeat(-position)}${digits}`;
  const normalized = padded.replace(/0+$/, "").replace(/\.$/, "");
  return `${negative ? "-" : ""}${normalized}`;
}

export function parsePythReference(
  payload: unknown,
  symbol: string,
  feedId: number,
  now = Date.now(),
): PythReference {
  const response = PythResponse.parse(payload);
  const feed = response.parsed.priceFeeds.find((item) => item.priceFeedId === feedId);
  if (!feed?.price || !feed.feedUpdateTimestamp)
    throw new Error(`Pyth price unavailable for ${symbol}`);
  const streamUs = BigInt(response.parsed.timestampUs);
  const updateUs = BigInt(feed.feedUpdateTimestamp);
  if (updateUs > streamUs) throw new Error("Pyth feed timestamp exceeds stream timestamp");
  const ageMs = Math.max(0, now - Number(updateUs / 1000n));
  return {
    symbol,
    feedId,
    price: decimalFromMantissa(feed.price, feed.exponent),
    confidence:
      feed.confidence === undefined ? null : decimalFromMantissa(feed.confidence, feed.exponent),
    marketSession: feed.marketSession ?? null,
    feedUpdateTimestamp: new Date(Number(updateUs / 1000n)).toISOString(),
    streamTimestamp: new Date(Number(streamUs / 1000n)).toISOString(),
    referenceFreshness: ageMs > 5000 ? "stale" : updateUs < streamUs ? "carried_forward" : "live",
    ageMs,
    source: "pyth-pro",
  };
}

export function fairValue(
  tokenPrice: string,
  reference: PythReference,
  history?: { meanPct: number; standardDeviationPct: number },
) {
  const premiumDiscountPct = (Number(tokenPrice) / Number(reference.price) - 1) * 100;
  if (!Number.isFinite(premiumDiscountPct)) throw new Error("Invalid fair-value inputs");
  return {
    referencePrice: reference.price,
    tokenPrice,
    premiumDiscountPct: String(premiumDiscountPct),
    premiumDiscountBps: String(premiumDiscountPct * 100),
    confidence: reference.confidence,
    referenceFreshness: reference.referenceFreshness,
    marketSession: reference.marketSession,
    divergenceZScore:
      history && history.standardDeviationPct > 0
        ? String((premiumDiscountPct - history.meanPct) / history.standardDeviationPct)
        : null,
    executable: false,
  };
}

export class PythProProvider {
  private equitySymbols: { until: number; value: z.infer<typeof PythSymbol>[] } | null = null;
  constructor(
    private readonly apiKey: string,
    private readonly historyUrl = "https://pyth.dourolabs.app/v1",
    private readonly restUrl = "https://pyth-lazer.dourolabs.app",
    private readonly fetcher: typeof fetch = globalThis.fetch,
  ) {}

  async searchSymbols(query: string): Promise<z.infer<typeof PythSymbol>[]> {
    const response = await this.fetcher(
      `${this.historyUrl}/symbols?query=${encodeURIComponent(query)}`,
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) throw new Error(`Pyth symbols returned ${response.status}`);
    return z.array(PythSymbol).parse(await response.json());
  }

  async getLatest(symbol: string): Promise<PythReference> {
    if (!this.apiKey) throw new Error("Pyth Pro API key is not configured");
    const candidates = await this.searchSymbols(symbol);
    const normalized = symbol.toUpperCase();
    const feed =
      candidates.find((item) => item.symbol.toUpperCase() === normalized) ??
      candidates.find(
        (item) =>
          item.asset_type.toLowerCase() === "equity" &&
          item.symbol.toUpperCase() === `EQUITY.US.${normalized}/USD`,
      );
    if (!feed) throw new Error(`Pyth feed unavailable for ${symbol}`);
    const response = await this.fetcher(`${this.restUrl}/v1/latest_price`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        priceFeedIds: [feed.pyth_lazer_id],
        properties: ["price", "confidence", "marketSession", "feedUpdateTimestamp"],
        formats: [],
        channel: "fixed_rate@1000ms",
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Pyth latest price returned ${response.status}`);
    return parsePythReference(await response.json(), feed.symbol, feed.pyth_lazer_id);
  }

  async getLatestEquities(tickers: readonly string[]): Promise<PythReference[]> {
    if (!this.apiKey) throw new Error("Pyth Pro API key is not configured");
    const unique = [...new Set(tickers.map((ticker) => ticker.toUpperCase()))]
      .filter((ticker) => /^[A-Z0-9.-]{1,12}$/.test(ticker))
      .slice(0, 40);
    if (!unique.length) return [];
    if (!this.equitySymbols || this.equitySymbols.until <= Date.now()) {
      const response = await this.fetcher(`${this.historyUrl}/symbols?asset_type=equity`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`Pyth symbols returned ${response.status}`);
      this.equitySymbols = {
        until: Date.now() + 60 * 60_000,
        value: z.array(PythSymbol).parse(await response.json()),
      };
    }
    const symbols = this.equitySymbols.value.filter((feed) =>
      unique.some((ticker) => feed.symbol.toUpperCase() === `EQUITY.US.${ticker}/USD`),
    );
    if (!symbols.length) return [];
    const response = await this.fetcher(`${this.restUrl}/v1/latest_price`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        priceFeedIds: symbols.map((feed) => feed.pyth_lazer_id),
        properties: ["price", "confidence", "marketSession", "feedUpdateTimestamp"],
        formats: [],
        channel: "fixed_rate@1000ms",
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Pyth latest prices returned ${response.status}`);
    const payload: unknown = await response.json();
    return symbols.flatMap((feed) => {
      try {
        return [parsePythReference(payload, feed.symbol, feed.pyth_lazer_id)];
      } catch {
        return [];
      }
    });
  }
}
