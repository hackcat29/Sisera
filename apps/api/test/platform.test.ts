import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentDraftInput, compileAgentDraft } from "../src/agent-governance.js";
import { buildApi } from "../src/app.js";
import { ClawpumpClient } from "../src/clawpump.js";
import { readConfig } from "../src/config.js";
import { classifyIntent } from "../src/platform/copilot-service.js";
import { DBC_PRESETS, DbcLaunchInput, DbcService } from "../src/platform/dbc.js";

afterEach(() => vi.unstubAllGlobals());

describe("Sisera AI routing", () => {
  it("routes the questions from the product brief to their evidence builders", () => {
    expect(classifyIntent("Why is OpenAI trading 8% above its mark?")).toBe("why_moving");
    expect(classifyIntent("What changed in the last hour?")).toBe("what_changed");
    expect(classifyIntent("Which of my positions are exposed to this event?")).toBe("exposure");
    expect(classifyIntent("Which tokenized stocks are trading furthest from fair value?")).toBe(
      "fair_value",
    );
    expect(classifyIntent("What would adding this position do to my portfolio risk?")).toBe(
      "portfolio_impact",
    );
    expect(classifyIntent("Show me the strongest argument for and against buying it.")).toBe(
      "bull_bear",
    );
    expect(classifyIntent("Which Clawpump agents are outperforming their paired stock?")).toBe(
      "agent_market",
    );
    expect(classifyIntent("Buy $2,000 if the premium falls below 3%")).toBe("policy");
    expect(classifyIntent("Rank pre-IPO companies by liquidity")).toBe("private_ranking");
    expect(classifyIntent("Backtest an RSI strategy on NVDAx")).toBe("backtest");
    expect(classifyIntent("Simulate agent performance over the last 2 years")).toBe("backtest");
    expect(classifyIntent("Build me a thematic take on humanoid robotics and automation")).toBe(
      "thematic_take",
    );
    expect(classifyIntent("Create a thesis basket on AI compute power squeeze")).toBe(
      "thematic_take",
    );
  });
});

describe("agent manifests", () => {
  it("stores executable rules and the live wallet in the hashed manifest", () => {
    const input = AgentDraftInput.parse({
      name: "Rules agent",
      description: "Trend following with executable entry and exit rules.",
      universe: ["BTCUSDT", "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw"],
      timeframe: "1d",
      factors: ["EMA trend"],
      capitalLimitUsd: 5000,
      maxTradeNotionalUsd: 1000,
      maxDailyDrawdownPct: 3,
      maxOpenPositions: 1,
      stopLossPct: 5,
      takeProfitPct: 10,
      maxSlippageBps: 20,
      rules: {
        entry: [{ type: "ema_trend", fast: 20, slow: 50, direction: "bullish" }],
        exit: [],
        trailingStopPct: 3.5,
      },
    });
    const { policy, manifestHash } = compileAgentDraft(input);
    expect(policy.rules?.entry[0]).toMatchObject({ type: "ema_trend", requireCross: false });
    expect(policy.rules?.trailingStopPct).toBe(3.5);
    expect(policy.execution.proposalOnly).toBe(true);
    expect(manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(
      AgentDraftInput.safeParse({ ...input, rules: { entry: [{ type: "moon" }] } }).success,
    ).toBe(false);
  });
});

describe("Meteora DBC presets", () => {
  it("builds valid curves for every preset and quote asset", () => {
    const service = new DbcService("https://rpc.example.test", undefined);
    for (const preset of Object.keys(DBC_PRESETS)) {
      for (const [decimals, cap] of [
        [9, 30],
        [6, 5000],
        [8, 40],
      ] as const) {
        const input = DbcLaunchInput.parse({
          preset,
          name: "Agent",
          symbol: "AGT",
          description: "A stock-paired agent token launched through Sisera.",
          imageUrl: "https://sisera.xyz/icon.png",
          wallet: "49CfXAr58cCTGJnYsbm16fEsE5JRpdR8QQP8E1ZinGCq",
          quoteMint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
          initialMarketCap: cap,
        });
        const config = service.buildConfig(input, {
          mint: input.quoteMint,
          decimals,
          tokenProgram: "token2022",
          badge: true,
        });
        expect(config.curve.length).toBeGreaterThan(0);
        expect(Number(config.migrationQuoteThreshold.toString())).toBeGreaterThan(0);
      }
    }
  });

  it("rejects unsafe or malformed launch requests", () => {
    const base = {
      preset: "reference_anchored",
      name: "Agent",
      symbol: "AGT",
      description: "A stock-paired agent token launched through Sisera.",
      imageUrl: "https://sisera.xyz/icon.png",
      wallet: "49CfXAr58cCTGJnYsbm16fEsE5JRpdR8QQP8E1ZinGCq",
      quoteMint: "So11111111111111111111111111111111111111112",
      initialMarketCap: 30,
    };
    expect(DbcLaunchInput.safeParse(base).success).toBe(true);
    expect(DbcLaunchInput.safeParse({ ...base, symbol: "BAD SYMBOL" }).success).toBe(false);
    expect(DbcLaunchInput.safeParse({ ...base, feeStartingBps: 20_000 }).success).toBe(false);
    expect(DbcLaunchInput.safeParse({ ...base, unexpected: true }).success).toBe(false);
  });
});

describe("Clawpump launches", () => {
  const key = `cpk_${"b".repeat(43)}`;
  const launch = {
    agentId: "agent-1",
    agentName: "Agent",
    name: "Agent",
    symbol: "AGT",
    description: "A stock-paired agent token launched through Sisera.",
    imageUrl: "https://sisera.xyz/icon.png",
    walletAddress: "49CfXAr58cCTGJnYsbm16fEsE5JRpdR8QQP8E1ZinGCq",
    pumpQuoteMint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    pumpCreatorFeeBps: 250,
  };

  it("requests a SOL preflight quote with the stock pair and creator fee", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        payment: {
          method: "sol",
          amountLamports: 7_510_000,
          payTo: "49CfXAr58cCTGJnYsbm16fEsE5JRpdR8QQP8E1ZinGCq",
        },
        retryWith: { preflightToken: "token" },
      }),
    });
    const quote = await new ClawpumpClient(key, fetcher).selfFundedQuote(launch);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://clawpump.tech/api/v1/launch/self-funded");
    expect(JSON.parse(init.body)).toMatchObject({
      preflight: true,
      pumpQuoteMint: launch.pumpQuoteMint,
      pumpCreatorFeeBps: 250,
      devBuySol: 0,
    });
    expect(quote.payment.amountLamports).toBe(7_510_000);
  });

  it("treats 202 as still confirming and returns the minted token otherwise", async () => {
    const pending = vi.fn().mockResolvedValue({ ok: false, status: 202, json: async () => ({}) });
    expect(
      await new ClawpumpClient(key, pending).completeSelfFundedLaunch({
        ...launch,
        txSignature: "sig",
        preflightToken: "t",
      }),
    ).toEqual({
      pending: true,
      result: null,
    });
    const done = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        mintAddress: "Mint1111111111111111111111111111111111111",
      }),
    });
    const result = await new ClawpumpClient(key, done).completeSelfFundedLaunch({
      ...launch,
      txSignature: "sig",
      preflightToken: "t",
    });
    expect(result.result?.mintAddress).toBe("Mint1111111111111111111111111111111111111");
    expect(JSON.parse(done.mock.calls[0]?.[1].body)).toMatchObject({
      txSignature: "sig",
      preflightToken: "t",
    });
  });
});

describe("platform routes", () => {
  it("publishes launch presets, gates launches and keeps Sisera AI behind a session", async () => {
    const app = await buildApi(
      readConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", SISERA_LIVE_LAUNCHES_ENABLED: "false" }),
    );
    const presets = await app.inject({ method: "GET", url: "/v1/launches/dbc/presets" });
    expect(presets.statusCode).toBe(200);
    expect(presets.json().enabled).toBe(false);
    expect(presets.json().data.map((preset: { id: string }) => preset.id)).toEqual(
      Object.keys(DBC_PRESETS),
    );
    const chat = await app.inject({
      method: "POST",
      url: "/v1/copilot/chat",
      payload: { message: "hi" },
    });
    expect(chat.statusCode).toBe(401);
    const portfolio = await app.inject({ method: "GET", url: "/v1/portfolio" });
    expect(portfolio.statusCode).toBe(401);
    await app.close();
  });

  it("refuses launches when they are disabled, even for a signed-in trader", async () => {
    const app = await buildApi(
      readConfig({
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        SISERA_ALLOW_DEV_AUTH: "true",
        SISERA_LIVE_LAUNCHES_ENABLED: "false",
      }),
    );
    const response = await app.inject({
      method: "POST",
      url: "/v1/launches/dbc/prepare",
      headers: { "x-sisera-dev-role": "trader", "x-sisera-dev-subject": "privy:test" },
      payload: {},
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe("launches_disabled");
    await app.close();
  });

  it("compiles and tokenizes thematic takes", async () => {
    const app = await buildApi(
      readConfig({
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        SISERA_ALLOW_DEV_AUTH: "true",
      }),
    );
    const compileRes = await app.inject({
      method: "POST",
      url: "/v1/takes/compile",
      headers: { "x-sisera-dev-role": "trader", "x-sisera-dev-subject": "privy:test" },
      payload: {
        text: "Thematic take on humanoid robotics and automation",
        totalNotionalUsd: 10_000,
      },
    });
    expect(compileRes.statusCode).toBe(200);
    const take = compileRes.json().data;
    expect(take.title).toContain("Humanoid Robotics");
    expect(take.constituents.length).toBeGreaterThanOrEqual(3);

    const tokenizeRes = await app.inject({
      method: "POST",
      url: "/v1/takes/tokenize",
      headers: { "x-sisera-dev-role": "trader", "x-sisera-dev-subject": "privy:test" },
      payload: { take },
    });
    expect(tokenizeRes.statusCode).toBe(200);
    const tokenization = tokenizeRes.json().data;
    expect(tokenization.curvePreset).toBe("reference_anchored");
    expect(tokenization.tokenSymbol).toMatch(/^TKE/);
    await app.close();
  });
});
