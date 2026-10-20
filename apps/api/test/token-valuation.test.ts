import { describe, expect, it, vi } from "vitest";
import { TokenValuer } from "../src/token-valuation.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const FAKE_USDT = "8htM9Gh25RqXzqratsz3EpEz6nvLyp49JH2fgkHCyVsG";
const MEME = "MemeCoin1111111111111111111111111111111111";
const FAKE_USDC = "FakeUsdc11111111111111111111111111111111111";

function valuer(prices: Record<string, unknown> | null) {
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes("/price/v3")) {
      if (!prices) return new Response("down", { status: 503 });
      return Response.json(prices);
    }
    return Response.json([
      { id: USDC, name: "USD Coin", symbol: "USDC", icon: "usdc.png", isVerified: true },
      // A real-world spam token: look-alike letters, unverified, no liquidity.
      { id: FAKE_USDT, name: "Τеtһеr", symbol: "ՍЅⅮΤ", isVerified: null },
      { id: MEME, name: "Meme", symbol: "MEME", isVerified: false },
      { id: FAKE_USDC, name: "USD Coin", symbol: "USDC", isVerified: false },
    ]);
  });
  return new TokenValuer(undefined, fetcher as unknown as typeof fetch);
}

const holding = (mint: string, raw = "1000000") => ({
  mint,
  symbol: null,
  name: null,
  rawBalance: raw,
  decimals: 6,
});

describe("Solana token valuation", () => {
  it("values stablecoins and liquid tokens, and keeps spam out of the balance", async () => {
    const [usdc, fake, meme, impostor] = await valuer({
      [USDC]: { usdPrice: 0.9999, liquidity: 400_000_000 },
      [FAKE_USDT]: { liquidity: 0.1 },
      [MEME]: { usdPrice: 0.02, liquidity: 50_000 },
      [FAKE_USDC]: { usdPrice: 1, liquidity: 20_000 },
    }).value([
      holding(USDC, "58727131"),
      holding(FAKE_USDT, "2000000000"),
      holding(MEME),
      holding(FAKE_USDC),
    ]);
    expect(usdc).toMatchObject({
      symbol: "USDC",
      verified: true,
      suspicious: false,
      icon: "usdc.png",
    });
    expect(usdc?.valueUsd).toBeCloseTo(58.72, 2);
    expect(fake).toMatchObject({ suspicious: true, valueUsd: null, priceUsd: null });
    // An unverified token with real liquidity and a plain name is shown and valued.
    expect(meme).toMatchObject({ suspicious: false, valueUsd: 0.02 });
    // Claiming a major token's symbol from another mint is an imitation, even with liquidity.
    expect(impostor).toMatchObject({ suspicious: true, valueUsd: null });
  });

  it("still counts USDC at a dollar when the price API is down", async () => {
    const [usdc] = await valuer(null).value([holding(USDC, "25000000")]);
    expect(usdc).toMatchObject({ priceUsd: 1, valueUsd: 25 });
  });
});
