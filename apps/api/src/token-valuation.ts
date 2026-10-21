import { z } from "zod";
import { type JupiterFetch, jupiterFetch } from "./jupiter-api.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
/** Canonical mints for symbols that spam tokens most often imitate. */
const CANONICAL: Record<string, string> = {
  USDC,
  USDT,
  SOL: WRAPPED_SOL,
  WSOL: WRAPPED_SOL,
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
};
/** Below this much pool liquidity a quoted price is not a value anyone could sell at. */
const MIN_LIQUIDITY_USD = 1_000;

const Prices = z.record(
  z.object({ usdPrice: z.number().optional(), liquidity: z.number().optional() }).passthrough(),
);
const Tokens = z.array(
  z
    .object({
      id: z.string(),
      name: z.string().optional(),
      symbol: z.string().optional(),
      icon: z.string().nullable().optional(),
      isVerified: z.boolean().nullable().optional(),
    })
    .passthrough(),
);

export type ValuedHolding = {
  mint: string;
  symbol: string | null;
  name: string | null;
  rawBalance: string;
  decimals: number;
  icon: string | null;
  verified: boolean;
  /** Likely spam: unverified and either imitating another token or impossible to sell. */
  suspicious: boolean;
  priceUsd: number | null;
  valueUsd: number | null;
};

/** Letters outside Latin text are a common way to fake a ticker like "USDT". */
const lookalike = (text: string | null | undefined) => /[^\x20-\x7E]/.test(text ?? "");

/**
 * Prices and labels Solana wallet holdings with Jupiter's price and token lists, so stablecoins and
 * other tokens show their value and spam airdrops are flagged instead of counted.
 */
export class TokenValuer {
  private readonly cache = new Map<
    string,
    { until: number; price: number | null; liquidity: number }
  >();
  private readonly metadata = new Map<string, z.infer<typeof Tokens>[number] | null>();

  private readonly jupiter: JupiterFetch;

  constructor(apiKey?: string, fetcher?: typeof fetch) {
    this.jupiter = jupiterFetch(apiKey, fetcher);
  }

  private async get(path: string) {
    const response = await this.jupiter(path, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error(`Jupiter returned ${response.status}`);
    return response.json() as Promise<unknown>;
  }

  private async prices(mints: string[]) {
    const now = Date.now();
    const missing = mints.filter((mint) => (this.cache.get(mint)?.until ?? 0) <= now);
    for (let index = 0; index < missing.length; index += 50) {
      const batch = missing.slice(index, index + 50);
      try {
        const payload = Prices.parse(await this.get(`/price/v3?ids=${batch.join(",")}`));
        for (const mint of batch) {
          const entry = payload[mint];
          this.cache.set(mint, {
            until: now + 30_000,
            price:
              entry?.usdPrice != null && Number.isFinite(entry.usdPrice) ? entry.usdPrice : null,
            liquidity: entry?.liquidity ?? 0,
          });
        }
      } catch {
        // Prices stay unknown this round; the wallet still renders.
      }
    }
    return new Map(mints.map((mint) => [mint, this.cache.get(mint)]));
  }

  private async tokens(mints: string[]) {
    const missing = mints.filter((mint) => !this.metadata.has(mint));
    for (let index = 0; index < missing.length; index += 100) {
      const batch = missing.slice(index, index + 100);
      try {
        const found = Tokens.parse(await this.get(`/tokens/v2/search?query=${batch.join(",")}`));
        const byMint = new Map(found.map((token) => [token.id, token]));
        for (const mint of batch) this.metadata.set(mint, byMint.get(mint) ?? null);
      } catch {
        // Names fall back to what the wallet indexer returned.
      }
    }
    return this.metadata;
  }

  async value(
    holdings: ReadonlyArray<{
      mint: string;
      symbol: string | null;
      name: string | null;
      rawBalance: string;
      decimals: number;
    }>,
  ): Promise<ValuedHolding[]> {
    const mints = [...new Set(holdings.map((holding) => holding.mint))];
    const [prices, tokens] = await Promise.all([this.prices(mints), this.tokens(mints)]);
    return holdings.map((holding) => {
      const token = tokens.get(holding.mint) ?? null;
      const symbol = holding.symbol ?? token?.symbol ?? null;
      const name = holding.name ?? token?.name ?? null;
      const verified = token?.isVerified === true || holding.mint === USDC || holding.mint === USDT;
      const quote = prices.get(holding.mint);
      const canonical = symbol ? CANONICAL[symbol.toUpperCase()] : undefined;
      const imitation = canonical != null && canonical !== holding.mint;
      const liquid = (quote?.liquidity ?? 0) >= MIN_LIQUIDITY_USD;
      const suspicious =
        !verified && (imitation || lookalike(symbol) || lookalike(name) || !liquid);
      // USDC and USDT are worth a dollar even when the price API is briefly unavailable.
      const price = quote?.price ?? (holding.mint === USDC || holding.mint === USDT ? 1 : null);
      const priceUsd = suspicious || !(price && price > 0) ? null : price;
      const amount = Number(holding.rawBalance) / 10 ** holding.decimals;
      return {
        ...holding,
        symbol,
        name,
        icon: token?.icon ?? null,
        verified,
        suspicious,
        priceUsd,
        valueUsd: priceUsd != null && Number.isFinite(amount) ? amount * priceUsd : null,
      };
    });
  }

  async solPrice() {
    return (await this.prices([WRAPPED_SOL])).get(WRAPPED_SOL)?.price ?? null;
  }
}
