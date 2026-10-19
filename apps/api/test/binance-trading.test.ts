import { describe, expect, it, vi } from "vitest";
import { BinanceTradingClient } from "../src/binance-trading.js";

describe("BinanceTradingClient", () => {
  it("checks signed account balance and lot rules before submitting a market order", async () => {
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes("/api/v3/account"))
        return new Response(
          JSON.stringify({ canTrade: true, balances: [{ asset: "USDT", free: "10000" }] }),
        );
      if (url.includes("/api/v3/exchangeInfo"))
        return new Response(
          JSON.stringify({
            symbols: [
              {
                symbol: "BTCUSDT",
                status: "TRADING",
                baseAsset: "BTC",
                quoteAsset: "USDT",
                filters: [
                  { filterType: "LOT_SIZE", minQty: "0.00001", maxQty: "100", stepSize: "0.00001" },
                ],
              },
            ],
          }),
        );
      expect(options?.method).toBe("POST");
      expect(options?.headers).toEqual({ "X-MBX-APIKEY": "a".repeat(24) });
      expect(url).toContain("signature=");
      return new Response(
        JSON.stringify({
          symbol: "BTCUSDT",
          orderId: 42,
          clientOrderId: "sis_test",
          status: "FILLED",
          executedQty: "0.01",
          cummulativeQuoteQty: "500",
        }),
      );
    });
    const client = new BinanceTradingClient("https://example.test", fetcher as typeof fetch);
    const result = await client.placeMarketOrder({
      apiKey: "a".repeat(24),
      apiSecret: "b".repeat(32),
      symbol: "BTCUSDT",
      side: "buy",
      quantity: "0.01",
      indicativePrice: "50000",
      clientOrderId: "sis_test",
    });
    expect(result.status).toBe("FILLED");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("rejects an order larger than the free balance before submitting it", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes("/api/v3/account"))
        return new Response(
          JSON.stringify({ canTrade: true, balances: [{ asset: "USDT", free: "400" }] }),
        );
      return new Response(
        JSON.stringify({
          symbols: [
            {
              symbol: "BTCUSDT",
              status: "TRADING",
              baseAsset: "BTC",
              quoteAsset: "USDT",
              filters: [],
            },
          ],
        }),
      );
    });
    const client = new BinanceTradingClient("https://example.test", fetcher as typeof fetch);
    await expect(
      client.placeMarketOrder({
        apiKey: "a".repeat(24),
        apiSecret: "b".repeat(32),
        symbol: "BTCUSDT",
        side: "buy",
        quantity: "0.01",
        indicativePrice: "50000",
        clientOrderId: "sis_test",
      }),
    ).rejects.toThrow("Not enough USDT on Binance");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("spends an exact USDT amount and reports the average fill price and fee", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes("/api/v3/account"))
        return new Response(
          JSON.stringify({ canTrade: true, balances: [{ asset: "USDT", free: "100" }] }),
        );
      if (url.includes("/api/v3/order"))
        return new Response(
          JSON.stringify({
            symbol: "BTCUSDT",
            orderId: 7,
            clientOrderId: "sis_test",
            status: "FILLED",
            executedQty: "0.0012",
            cummulativeQuoteQty: "60",
            fills: [{ commission: "0.06", commissionAsset: "USDT" }],
          }),
        );
      return new Response(
        JSON.stringify({
          symbols: [
            {
              symbol: "BTCUSDT",
              status: "TRADING",
              baseAsset: "BTC",
              quoteAsset: "USDT",
              filters: [
                { filterType: "LOT_SIZE", minQty: "0.001", maxQty: "9", stepSize: "0.001" },
              ],
            },
          ],
        }),
      );
    });
    const client = new BinanceTradingClient("https://example.test", fetcher as typeof fetch);
    // $60 of a $100 balance: allowed now that orders are not capped at 20% of the balance.
    const result = await client.placeMarketOrder({
      apiKey: "a".repeat(24),
      apiSecret: "b".repeat(32),
      symbol: "BTCUSDT",
      side: "buy",
      quoteAmount: "60",
      indicativePrice: "50000",
      clientOrderId: "sis_test",
    });
    const order = new URL(String(fetcher.mock.calls.at(-1)?.[0]));
    expect(order.searchParams.get("quoteOrderQty")).toBe("60.00");
    expect(order.searchParams.has("quantity")).toBe(false);
    expect(result).toMatchObject({ averagePrice: "50000", feeUsd: "0.06", executedQty: "0.0012" });
  });
});
