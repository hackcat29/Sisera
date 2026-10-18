import { describe, expect, it, vi } from "vitest";
import {
  SISERA_MINT,
  SISERA_PRIMARY_POOL,
  SiseraTelegramBuyBot,
  USDC_MINT,
  WSOL_MINT,
  extractSiseraBuy,
  formatSiseraBuyMessage,
  formatSiseraStatsMessage,
} from "../src/telegram-buybot.js";

describe("Sisera Telegram BuyBot", () => {
  const buyer = "2tgUbS9UMoQD6GkDZBiqKYCURnGrSb6ocYwRABrSJUvY";
  const relayer = "AgmLJBMDCqWynYnQiPCuj9ewsNNsBJXyzoUhD9LJzN51";
  const signature =
    "35jrUQxTXiU915dYDGf1s6Tj3J78QjEwYoFnma5Hiu4xmMrMLsFGrkiQQ1Xdf4i6f4i78YhtzqqJgYQKMzgmz46w";

  it("extracts a direct PumpSwap WSOL buy accurately", () => {
    const buy = extractSiseraBuy({
      signature,
      timestamp: 1792234793,
      type: "SWAP",
      source: "PUMP_AMM",
      feePayer: buyer,
      tokenTransfers: [
        {
          fromUserAccount: buyer,
          toUserAccount: SISERA_PRIMARY_POOL,
          tokenAmount: 0.255789052,
          mint: WSOL_MINT,
        },
        {
          fromUserAccount: buyer,
          toUserAccount: "7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ",
          tokenAmount: 0.003145577,
          mint: WSOL_MINT,
        },
        {
          fromUserAccount: SISERA_PRIMARY_POOL,
          toUserAccount: buyer,
          tokenAmount: 907361.256162,
          mint: SISERA_MINT,
        },
      ],
      nativeTransfers: [],
    });

    expect(buy).not.toBeNull();
    expect(buy?.buyer).toBe(buyer);
    expect(buy?.tokenAmount).toBeCloseTo(907361.256162, 5);
    expect(buy?.solSpent).toBeCloseTo(0.258934629, 6);
    expect(buy?.source).toBe("PUMP_AMM");
  });

  it("extracts a gasless relayed multi-hop USDC -> WSOL -> SISERA buy", () => {
    const buy = extractSiseraBuy({
      signature,
      timestamp: 1792234749,
      type: "SWAP",
      source: "JUPITER",
      feePayer: relayer,
      tokenTransfers: [
        {
          fromUserAccount: buyer,
          toUserAccount: "DJNtGuBGEQiUCWE8F981M2C3ZghZt2XLD8f2sQdZ6rsZ",
          tokenAmount: 228.765693,
          mint: USDC_MINT,
        },
        {
          fromUserAccount: buyer,
          toUserAccount: SISERA_PRIMARY_POOL,
          tokenAmount: 2.163248605,
          mint: WSOL_MINT,
        },
        {
          fromUserAccount: "DJNtGuBGEQiUCWE8F981M2C3ZghZt2XLD8f2sQdZ6rsZ",
          toUserAccount: buyer,
          tokenAmount: 2.163248605,
          mint: WSOL_MINT,
        },
        {
          fromUserAccount: SISERA_PRIMARY_POOL,
          toUserAccount: buyer,
          tokenAmount: 8319328.083522,
          mint: SISERA_MINT,
        },
      ],
      nativeTransfers: [],
    });

    expect(buy).not.toBeNull();
    expect(buy?.buyer).toBe(buyer);
    expect(buy?.tokenAmount).toBeCloseTo(8319328.083522, 4);
    expect(buy?.usdcSpent).toBeCloseTo(228.765693, 4);
    expect(buy?.solSpent).toBeCloseTo(2.163248605, 5);
  });

  it("ignores sell transactions and non-swap transfers", () => {
    const directSell = extractSiseraBuy({
      signature,
      timestamp: 1792235439,
      type: "SWAP",
      source: "JUPITER",
      feePayer: buyer,
      tokenTransfers: [
        {
          fromUserAccount: buyer,
          toUserAccount: SISERA_PRIMARY_POOL,
          tokenAmount: 789481.536163,
          mint: SISERA_MINT,
        },
        {
          fromUserAccount: SISERA_PRIMARY_POOL,
          toUserAccount: buyer,
          tokenAmount: 0.203457446,
          mint: WSOL_MINT,
        },
      ],
      nativeTransfers: [],
    });
    expect(directSell).toBeNull();

    const relayedSell = extractSiseraBuy({
      signature,
      timestamp: 1792235056,
      type: "SWAP",
      source: "OKX_DEX_ROUTER",
      feePayer: relayer,
      tokenTransfers: [
        {
          fromUserAccount: buyer,
          toUserAccount: SISERA_PRIMARY_POOL,
          tokenAmount: 8319328.083522,
          mint: SISERA_MINT,
        },
        {
          fromUserAccount: SISERA_PRIMARY_POOL,
          toUserAccount: buyer,
          tokenAmount: 2.277074064,
          mint: WSOL_MINT,
        },
      ],
      nativeTransfers: [],
    });
    expect(relayedSell).toBeNull();

    const plainTransfer = extractSiseraBuy({
      signature,
      timestamp: 1792235056,
      type: "TRANSFER",
      source: "SYSTEM_PROGRAM",
      feePayer: buyer,
      tokenTransfers: [
        {
          fromUserAccount: "3XZefEdBXzPmENBTVjoBJaYWVaXMvUF4THKdN5ox5kz8",
          toUserAccount: buyer,
          tokenAmount: 500000,
          mint: SISERA_MINT,
        },
      ],
      nativeTransfers: [],
    });
    expect(plainTransfer).toBeNull();
  });

  it("formats buy and stats messages with Sisera metrics and holder badges", () => {
    const snapshot = {
      priceUsd: 0.00025,
      priceNativeSol: 0.0000016,
      solPriceUsd: 156.25,
      marketCapUsd: 236_265,
      liquidityUsd: 45_200,
      volume24hUsd: 89_400,
      priceChange24hPct: 14.5,
      pairAddresses: [SISERA_PRIMARY_POOL],
    };

    const html = formatSiseraBuyMessage(
      {
        signature,
        timestamp: 1792234793,
        buyer,
        tokenAmount: 4_000_000,
        solSpent: 6.4,
        usdcSpent: 0,
        source: "JUPITER",
      },
      snapshot,
      {
        totalBalance: 4_000_000,
        isNewHolder: true,
        positionIncreasePct: null,
        supplyPct: 0.42,
      },
    );

    expect(html).toContain("🚀 <b>MEGA $SISERA BUY!</b>");
    expect(html).toContain("6.4000 SOL");
    expect(html).toContain("4,000,000 SISERA");
    expect(html).toContain("54,939,544 SISERA (5.49%)");
    expect(html).toContain("🌱 <b>New Holder!</b>");
    expect(html).toContain("(0.42% Supply)");

    const stats = formatSiseraStatsMessage(snapshot);
    expect(stats).toContain("SISERA ($SISERA) — LIVE MARKET SNAPSHOT");
    expect(stats).toContain(SISERA_MINT);
  });

  it("deduplicates processed transactions and respects minUsd threshold", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("dexscreener.com")) {
        return new Response(
          JSON.stringify({
            pairs: [
              {
                pairAddress: SISERA_PRIMARY_POOL,
                priceUsd: "0.0001",
                priceNative: "0.000001",
                marketCap: 94506,
                liquidity: { usd: 25000 },
                volume: { h24: 50000 },
              },
            ],
          }),
          { status: 200 },
        );
      }
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    });

    const bot = new SiseraTelegramBuyBot({
      botToken: "test-token",
      chatId: "-100123456",
      heliusApiKey: "test-helius",
      minUsd: 10,
      mediaDir: "/nonexistent",
      fetcher: mockFetch as unknown as typeof fetch,
    });

    const tx = {
      signature,
      timestamp: 1792234793,
      type: "SWAP",
      source: "PUMP_AMM",
      feePayer: buyer,
      tokenTransfers: [
        {
          fromUserAccount: buyer,
          toUserAccount: SISERA_PRIMARY_POOL,
          tokenAmount: 0.5, // $50 at $100/SOL
          mint: WSOL_MINT,
        },
        {
          fromUserAccount: SISERA_PRIMARY_POOL,
          toUserAccount: buyer,
          tokenAmount: 500_000,
          mint: SISERA_MINT,
        },
      ],
      nativeTransfers: [],
    };

    const firstCount = await bot.processTransactions([tx]);
    expect(firstCount).toBe(1);
    expect(calls).toHaveLength(1);

    // Duplicate signature must not re-alert
    const secondCount = await bot.processTransactions([tx]);
    expect(secondCount).toBe(0);
    expect(calls).toHaveLength(1);
  });
});
