import type { Candle, Instrument, MarketSnapshot, OrderBook } from "@sisera/domain";
import { describe, expect, it } from "vitest";
import { buildApi } from "../src/app.js";
import { readConfig } from "../src/config.js";

const instrument: Instrument = {
  id: "binance:BTCUSDT:spot",
  venue: "binance",
  venueSymbol: "BTCUSDT",
  displaySymbol: "BTC / USDT",
  assetClass: "crypto",
  type: "spot",
  baseAsset: "BTC",
  quoteAsset: "USDT",
  priceIncrement: "0.01",
  quantityIncrement: "0.00001",
  contractMultiplier: "1",
  status: "active",
};

describe("control plane API", () => {
  it("keeps liveness separate from database readiness and publishes a request ID", async () => {
    const app = await buildApi(
      readConfig({
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        DATABASE_URL: "postgres://example.test/sisera",
        PRIVY_APP_ID: "test",
        PRIVY_APP_SECRET: "test",
        SISERA_LIVE_SOLANA_ENABLED: "false",
        SISERA_LIVE_PREDICTIONS_ENABLED: "false",
        SISERA_LIVE_HYPERLIQUID_ENABLED: "false",
      }),
      { readinessProbe: async () => false },
    );
    const live = await app.inject({ method: "GET", url: "/health/live" });
    const ready = await app.inject({ method: "GET", url: "/health/ready" });
    const capabilities = await app.inject({ method: "GET", url: "/v1/capabilities" });
    expect(live.statusCode).toBe(200);
    expect(ready.statusCode).toBe(503);
    expect(ready.json().dependencies.database).toBe("unavailable");
    expect(ready.headers["x-request-id"]).toBeTruthy();
    expect(capabilities.json().live).toMatchObject({
      solana: false,
      predictions: false,
      hyperliquid: false,
    });
    await app.close();
  });
  it("serves public market data anonymously but keeps accounts and orders behind a session", async () => {
    const now = new Date().toISOString();
    const snapshot: MarketSnapshot = {
      instrumentId: instrument.id,
      bid: "60000",
      ask: "60001",
      last: "60000.5",
      quality: { status: "live", source: "test", observedAt: now, receivedAt: now, latencyMs: 1 },
    };
    const app = await buildApi(readConfig({ NODE_ENV: "test", LOG_LEVEL: "silent" }), {
      marketData: { getInstrument: async () => instrument, getSnapshot: async () => snapshot },
    });
    const market = await app.inject({ method: "GET", url: "/v1/markets/BTCUSDT" });
    expect(market.statusCode).toBe(200);
    expect(market.json().snapshot.quality.source).toBe("test");
    // Account, order, agent, and paid-feed routes still require a session.
    for (const url of [
      "/v1/preferences",
      "/v1/alerts",
      "/v1/activity/events",
      "/v1/market-orders/paper",
      "/v1/solana/orders",
      "/v1/agents",
      "/v1/social-feed",
      "/v1/solana/wallet/So11111111111111111111111111111111111111112",
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(401);
    }
    // Writes are never anonymous, even on a public path.
    const write = await app.inject({ method: "POST", url: "/v1/market-orders/paper", payload: {} });
    expect(write.statusCode).toBe(401);
    await app.close();
  });

  it("serves provider data without synthetic fallback", async () => {
    const now = new Date().toISOString();
    const snapshot: MarketSnapshot = {
      instrumentId: instrument.id,
      bid: "60000",
      ask: "60001",
      last: "60000.5",
      quality: {
        status: "live",
        source: "test-provider",
        observedAt: now,
        receivedAt: now,
        latencyMs: 1,
      },
    };
    const app = await buildApi(
      readConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", SISERA_ALLOW_DEV_AUTH: "true" }),
      { marketData: { getInstrument: async () => instrument, getSnapshot: async () => snapshot } },
    );
    const response = await app.inject({
      method: "GET",
      url: "/v1/markets/BTCUSDT",
      headers: { "x-sisera-dev-role": "viewer" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().snapshot.quality.source).toBe("test-provider");
    await app.close();
  });

  it("serves live candles, depth, and deterministic intelligence", async () => {
    const now = new Date().toISOString();
    const snapshot: MarketSnapshot = {
      instrumentId: instrument.id,
      bid: "100",
      ask: "101",
      last: "100.5",
      quality: { status: "live", source: "test", observedAt: now, receivedAt: now, latencyMs: 1 },
    };
    const candles: Candle[] = Array.from({ length: 60 }, (_, index) => ({
      time: 1_700_000_000 + index * 60,
      open: String(100 + index),
      high: String(102 + index),
      low: String(99 + index),
      close: String(101 + index),
      volume: String(1000 + index),
    }));
    const depth: OrderBook = {
      instrumentId: instrument.id,
      sequence: "1",
      bids: [{ price: "100", quantity: "2" }],
      asks: [{ price: "101", quantity: "3" }],
      quality: { status: "live", source: "test", observedAt: now, receivedAt: now, latencyMs: 1 },
    };
    const app = await buildApi(
      readConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", SISERA_ALLOW_DEV_AUTH: "true" }),
      {
        marketData: {
          getInstrument: async () => instrument,
          getSnapshot: async () => snapshot,
          getCandles: async () => candles,
          getOrderBook: async () => depth,
        },
      },
    );
    const headers = { "x-sisera-dev-role": "viewer" };
    const candleResponse = await app.inject({
      method: "GET",
      url: "/v1/markets/BTCUSDT/candles",
      headers,
    });
    const depthResponse = await app.inject({
      method: "GET",
      url: "/v1/markets/BTCUSDT/depth",
      headers,
    });
    const intelligenceResponse = await app.inject({
      method: "GET",
      url: "/v1/markets/BTCUSDT/intelligence",
      headers,
    });
    expect(candleResponse.statusCode).toBe(200);
    expect(depthResponse.json().data.sequence).toBe("1");
    expect(intelligenceResponse.json().data.direction).toBe("long");
    const agentResponse = await app.inject({
      method: "GET",
      url: "/v1/agents/templates/trend-confirmation-v1/research",
      headers,
    });
    expect(agentResponse.statusCode).toBe(200);
    expect(agentResponse.json().data.source).toBe("binance-spot-candles");
    expect(agentResponse.json().data.stance).toBe("abstain");
    await app.close();
  });
});
