import { Keypair, PublicKey } from "@solana/web3.js";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { createAuthenticator, publicMarketRoutes } from "../src/auth.js";
import { readConfig } from "../src/config.js";
import { registerTradeCheckRoutes } from "../src/platform/trade-check-routes.js";
import { TradeCheckService, tradeCheckMint } from "../src/platform/trade-check.js";

const MINT = "4eTknJyuvzcFNS9swypDsfYnhBFJ4d7VqZTqK21RYUh5";
const owner = Keypair.generate().publicKey.toBase58();
const program = PublicKey.findProgramAddressSync(
  [Buffer.from("vault")],
  Keypair.generate().publicKey,
)[0].toBase58();
const pair = {
  chainId: "solana",
  pairAddress: "pool",
  dexId: "pumpswap",
  baseToken: { address: MINT, name: "Sisera", symbol: "SISERA" },
  priceUsd: "0.002",
  liquidity: { usd: 30_000 },
  volume: { h24: 20_000 },
  priceChange: { h1: 4, h24: 32 },
  txns: { h24: { buys: 25, sells: 10 } },
  fdv: 200_000,
};
const mintInfo = {
  type: "mint",
  info: { mintAuthority: null, freezeAuthority: null, supply: "1000", decimals: 0 },
};

function setup(
  options: {
    marketDown?: boolean;
    chainDown?: boolean;
    holdersDown?: boolean;
    pairs?: unknown[];
    chat?: ConstructorParameters<typeof TradeCheckService>[0]["chat"];
  } = {},
) {
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).includes("dexscreener"))
      return options.marketDown
        ? new Response("", { status: 503 })
        : Response.json(options.pairs ?? [pair, pair]);
    if (options.chainDown) return new Response("", { status: 503 });
    const { method } = JSON.parse(String(init?.body));
    if (method === "getAccountInfo")
      return Response.json({ result: { value: { data: { parsed: mintInfo } } } });
    if (options.holdersDown) return Response.json({ error: { message: "RPC limited" } });
    if (method === "getTokenLargestAccounts")
      return Response.json({
        result: {
          value: [
            { address: "a", amount: "200" },
            { address: "b", amount: "150" },
            { address: "c", amount: "500" },
          ],
        },
      });
    return Response.json({
      result: {
        value: [owner, owner, program].map((owner) => ({ data: { parsed: { info: { owner } } } })),
      },
    });
  });
  const news = {
    search: vi.fn(async () => ({ data: [], providers: ["google-news"], available: false })),
  };
  return {
    service: new TradeCheckService({
      rpcUrl: "https://rpc.test",
      fetcher,
      news,
      chat: options.chat ?? null,
    }),
    fetcher,
    news,
  };
}

describe("Trade Check", () => {
  it("accepts canonical mints and supported links without fetching arbitrary URLs", () => {
    expect(tradeCheckMint(` https://pump.fun/coin/${MINT}?x=1 `)).toBe(MINT);
    expect(tradeCheckMint(`https://solscan.io/token/${MINT}`)).toBe(MINT);
    expect(() => tradeCheckMint(`https://evil.example/${MINT}`)).toThrow("Use a token address");
    expect(() => tradeCheckMint("11111111111111111111111111111111111111111111")).toThrow(
      "valid Solana",
    );
  });
  it("deduplicates pools, separates FDV from market cap, and groups accounts by wallet owner", async () => {
    const { service, fetcher } = setup();
    const [report, same] = await Promise.all([service.check(MINT), service.check(MINT)]);
    expect(report).toBe(same);
    expect(report.market).toMatchObject({
      pools: 1,
      volume24hUsd: 20_000,
      liquidityUsd: 30_000,
      marketCapUsd: null,
      fdvUsd: 200_000,
    });
    expect(report.chain).toMatchObject({
      top10SampledWalletPct: 35,
      largestSampledWalletPct: 35,
      programAddressPct: 50,
      sampledAccounts: 3,
      sampledWallets: 1,
    });
    expect(report.checks.find((c) => c.id === "movement")?.status).toBe("attention");
    expect(report.newsStatus).toBe("unavailable");
    const count = fetcher.mock.calls.length;
    await service.check(MINT);
    expect(fetcher).toHaveBeenCalledTimes(count);
  });
  it("does not turn missing liquidity or holder data into zero risk", async () => {
    const { service } = setup({
      holdersDown: true,
      pairs: [{ ...pair, liquidity: undefined, volume: undefined, txns: undefined }],
    });
    const report = await service.check(MINT);
    expect(report.market?.liquidityUsd).toBeNull();
    expect(report.market?.volume24hUsd).toBeNull();
    expect(report.chain?.top10SampledWalletPct).toBeNull();
    expect(
      report.checks
        .filter((c) => ["liquidity", "holders", "news"].includes(c.id))
        .every((c) => c.status === "unknown"),
    ).toBe(true);
    expect(report.summary).toContain("missing evidence");
  });
  it("provides an honest partial report and fails when both sources are down", async () => {
    expect((await setup({ chainDown: true }).service.check(MINT)).chain).toBeNull();
    const report = await setup({ marketDown: true }).service.check(MINT);
    expect(report.market).toBeNull();
    expect(report.symbol).toBe(MINT.slice(0, 6));
    await expect(
      setup({ marketDown: true, chainDown: true }).service.check(MINT),
    ).rejects.toMatchObject({ status: 503 });
  });
  it("falls back to observed evidence when AI fails or invents a citation", async () => {
    for (const complete of [
      vi.fn().mockRejectedValue(new Error("402")),
      vi.fn().mockResolvedValue(JSON.stringify({ answer: "Trust me", sources: ["invented"] })),
    ]) {
      const answer = await setup({ chat: { complete } }).service.answer(
        MINT,
        "How easy is it to sell?",
      );
      expect(answer.mode).toBe("data");
      expect(answer.answer).toContain("not a promise");
      expect(answer.sources.map((source) => source.id)).toEqual(["market"]);
    }
  });
  it("keeps the public report read-only and follow-ups authenticated", async () => {
    const app = Fastify();
    app.addHook(
      "onRequest",
      createAuthenticator(readConfig({ NODE_ENV: "test", SISERA_ALLOW_DEV_AUTH: "true" })),
    );
    registerTradeCheckRoutes(app, setup().service);
    try {
      expect(publicMarketRoutes.has("/v1/trade-check")).toBe(true);
      expect((await app.inject({ url: `/v1/trade-check?input=${MINT}` })).statusCode).toBe(200);
      expect((await app.inject({ url: "/v1/trade-check?input=invalid" })).statusCode).toBe(400);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/trade-check/chat",
            payload: { input: MINT, question: "Holders?" },
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/trade-check/chat",
            headers: { "x-sisera-dev-role": "viewer" },
            payload: { input: MINT, question: "Holders?" },
          })
        ).statusCode,
      ).toBe(200);
    } finally {
      await app.close();
    }
  });
});
