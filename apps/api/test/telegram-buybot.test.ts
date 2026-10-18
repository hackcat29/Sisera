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
      if (url.includes("jup.ag")) {
        return new Response(JSON.stringify({ [WSOL_MINT]: { usdPrice: 100 } }), { status: 200 });
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
      minSendIntervalMs: 0,
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
    await bot.flushAlerts();
    expect(firstCount).toBe(1);
    expect(calls).toHaveLength(1);

    // Duplicate signature must not re-alert
    const secondCount = await bot.processTransactions([tx]);
    await bot.flushAlerts();
    expect(secondCount).toBe(0);
    expect(calls).toHaveLength(1);
  });

  describe("delivery and polling", () => {
    const dexScreenerPairs = {
      pairs: [
        {
          pairAddress: SISERA_PRIMARY_POOL,
          priceUsd: "0.0001",
          priceNative: "0.000001",
          quoteToken: { address: WSOL_MINT },
          liquidity: { usd: 25000 },
        },
      ],
    };

    function buyTx(index: number, solSpent = 0.5) {
      return {
        signature: `${signature.slice(0, 80)}${String(index).padStart(8, "0")}`,
        timestamp: 1792234793 + index,
        type: "SWAP",
        source: "PUMP_AMM",
        feePayer: buyer,
        tokenTransfers: [
          {
            fromUserAccount: buyer,
            toUserAccount: SISERA_PRIMARY_POOL,
            tokenAmount: solSpent,
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
    }

    function makeBot(
      telegram: (url: string, body: Record<string, unknown>) => Response,
      helius: (url: URL) => unknown = () => [],
    ) {
      const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
      const sleeps: number[] = [];
      const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("dexscreener.com"))
          return new Response(JSON.stringify(dexScreenerPairs), { status: 200 });
        if (url.includes("jup.ag"))
          return new Response(JSON.stringify({ [WSOL_MINT]: { usdPrice: 100 } }), { status: 200 });
        if (url.includes("api.helius.xyz"))
          return new Response(JSON.stringify(helius(new URL(url))), { status: 200 });
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        sent.push({ url, body });
        return telegram(url, body);
      });
      const bot = new SiseraTelegramBuyBot({
        botToken: "test-token",
        chatId: "-100123456",
        heliusApiKey: "test-helius",
        minUsd: 2,
        mediaDir: "/nonexistent",
        minSendIntervalMs: 0,
        fetcher: fetcher as unknown as typeof fetch,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      });
      return { bot, sent, sleeps };
    }

    const ok = () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });

    it("waits out Telegram 429s instead of dropping the alert", async () => {
      let attempts = 0;
      const { bot, sent, sleeps } = makeBot(() => {
        attempts++;
        return attempts === 1
          ? new Response(JSON.stringify({ ok: false, parameters: { retry_after: 7 } }), {
              status: 429,
            })
          : ok();
      });

      expect(await bot.processTransactions([buyTx(1)])).toBe(1);
      await bot.flushAlerts();

      expect(sent).toHaveLength(2);
      expect(sleeps).toContain(7_000);
    });

    it("keeps delivering the rest of the queue after one message fails", async () => {
      let attempts = 0;
      const { bot, sent } = makeBot(() => {
        attempts++;
        return attempts === 1 ? new Response("bad request", { status: 400 }) : ok();
      });

      expect(await bot.processTransactions([buyTx(2), buyTx(1)])).toBe(2);
      await bot.flushAlerts();

      expect(sent).toHaveLength(2);
    });

    it("combines a backlog of buys into one message", async () => {
      const { bot, sent } = makeBot(() => ok());

      const txs = Array.from({ length: 8 }, (_, index) => buyTx(8 - index, 0.1 * (8 - index)));
      expect(await bot.processTransactions(txs)).toBe(8);
      await bot.flushAlerts();

      expect(sent).toHaveLength(1);
      expect(String(sent[0]?.body.text)).toContain("+8 $SISERA BUYS");
    });

    it("pages back through Helius until it reaches the last seen transaction", async () => {
      const page = (from: number) =>
        Array.from({ length: 100 }, (_, index) => ({ ...buyTx(from - index), tokenTransfers: [] }));
      const requested: Array<string | null> = [];
      let seeded = false;
      const { bot } = makeBot(
        () => ok(),
        (url) => {
          const before = url.searchParams.get("before-signature");
          requested.push(before);
          if (!seeded) {
            seeded = true;
            return page(100);
          }
          // Each page holds 100 signatures; pass the oldest one back to get the next page.
          if (!before) return page(400);
          return page(Number(before.slice(-8)) - 1);
        },
      );

      await bot.pollOnce(); // seeds signatures 1-100
      requested.length = 0;
      await bot.pollOnce();

      // 400-301, 300-201, 200-101, then 100-1 contains seen signatures and paging stops.
      expect(requested).toHaveLength(4);
      expect(requested[0]).toBeNull();
      expect(requested[1]).toMatch(/00000301$/);
      expect(requested[3]).toMatch(/00000101$/);
    });

    it("answers commands only in the configured chat, with a cooldown", async () => {
      const updates = [
        { update_id: 1, message: { chat: { id: -100999 }, text: "/price" } },
        { update_id: 2, message: { chat: { id: -100123456 }, text: "/ca" } },
        { update_id: 3, message: { chat: { id: -100123456 }, text: "/price@sisera_bot" } },
        { update_id: 4, message: { chat: { id: -100123456 }, text: "/price" } },
      ];
      const { bot, sent } = makeBot((url) =>
        url.includes("getUpdates")
          ? new Response(JSON.stringify({ ok: true, result: updates }), { status: 200 })
          : ok(),
      );

      await bot.pollTelegramCommands();
      await bot.flushAlerts();

      const replies = sent.filter((call) => !call.url.includes("getUpdates"));
      // /ca is left to the group's Rose bot; the second /price falls inside the cooldown.
      expect(replies).toHaveLength(1);
      expect(replies[0]?.body).toMatchObject({ chat_id: "-100123456" });
      expect(String(replies[0]?.body.text)).toContain("LIVE MARKET SNAPSHOT");
    });
  });
});
