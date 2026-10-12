import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PantaPredictionProvider } from "../src/index.js";

describe("PantaPredictionProvider", () => {
  it("discovers secondary markets on later pages and excludes ineligible events", async () => {
    const future = Math.floor(Date.now() / 1000) + 86400;
    const row = (marketId: string, fields: Record<string, unknown> = {}) => ({
      marketId,
      title: `Event ${marketId}`,
      phase: "secondary",
      status: "open",
      endTime: String(future),
      ...fields,
    });
    const cursor = "opaque+/=cursor";
    const fetcher = vi.fn().mockImplementation(async (rawUrl: string) => {
      const url = new URL(rawUrl);
      expect(url.searchParams.has("status")).toBe(false);
      expect(url.searchParams.get("limit")).toBe("50");
      if (!url.searchParams.has("cursor"))
        return Response.json({
          items: [row("primary123", { phase: "primary" }), row("resolved123", { resolved: true })],
          nextCursor: cursor,
        });
      expect(url.searchParams.get("cursor")).toBe(cursor);
      return Response.json({
        items: [
          row("secondary123"),
          row("primary123", { phase: "primary" }),
          row("expired123", { endTime: future - 172800 }),
          row("cancelled123", { phase: "cancelled" }),
          row("settled123", { status: "resolved" }),
          row("blank123", { title: "   ", resolved: true }),
        ],
        nextCursor: null,
      });
    });
    const provider = new PantaPredictionProvider(
      "https://live-api.panta.market/api/v1",
      "key",
      fetcher,
    );
    const markets = await provider.listOpenMarkets(100);
    expect(markets.map((market) => market.id)).toEqual(["primary123", "secondary123"]);
    expect(markets[1]?.closesAt).toBe(new Date(future * 1000).toISOString());
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("recovers missing active catalog titles from detail without hydrating the archive", async () => {
    const future = Math.floor(Date.now() / 1000) + 86400;
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/incomplete123/"))
        return Response.json({
          marketId: "incomplete123",
          title: "Will GTA 6 release before the deadline?",
          phase: "secondary",
          endTime: future,
          yesPrice: "0.4",
          noPrice: "0.6",
        });
      return Response.json({
        items: [
          { marketId: "primary123", title: "Complete title", endTime: future },
          { marketId: "incomplete123", title: "", phase: "secondary", endTime: future },
          { marketId: "resolved123", title: "", resolved: true, endTime: future },
          { marketId: "expired123", title: "", endTime: future - 172800 },
        ],
        nextCursor: null,
      });
    });
    const provider = new PantaPredictionProvider(
      "https://live-api.panta.market/api/v1",
      "key",
      fetcher,
    );
    const markets = await provider.listOpenMarkets(100);
    expect(markets.map((market) => market.id)).toEqual(["primary123", "incomplete123"]);
    expect(markets[1]?.title).toBe("Will GTA 6 release before the deadline?");
    expect(markets[1]?.pricingAvailable).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps complete rows when missing-title detail is unavailable", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          items: [
            { marketId: "complete123", title: "Complete event" },
            { marketId: "incomplete123", title: "" },
          ],
        }),
      )
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
    const provider = new PantaPredictionProvider(
      "https://live-api.panta.market/api/v1",
      "key",
      fetcher,
    );
    expect((await provider.listOpenMarkets()).map((market) => market.id)).toEqual(["complete123"]);
  });

  it("retries an incomplete detail response and retains its recovered title on refresh", async () => {
    const catalog = { items: [{ marketId: "incomplete123", title: "", phase: "secondary" }] };
    let detailCalls = 0;
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      if (!url.includes("/incomplete123/")) return Response.json(catalog);
      detailCalls++;
      return Response.json(
        detailCalls === 1
          ? catalog.items[0]
          : {
              marketId: "incomplete123",
              title: "Recovered event title",
              phase: "secondary",
            },
      );
    });
    const provider = new PantaPredictionProvider(
      "https://live-api.panta.market/api/v1",
      "key",
      fetcher,
    );
    expect((await provider.listOpenMarkets())[0]?.title).toBe("Recovered event title");
    expect(detailCalls).toBe(2);
    const refreshed = await (
      provider as unknown as {
        loadMarkets: () => Promise<Array<{ title: string }>>;
      }
    ).loadMarkets();
    expect(refreshed[0]?.title).toBe("Recovered event title");
    expect(detailCalls).toBe(2);
  });

  it("rejects a repeated cursor instead of treating a partial catalog as complete", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(async () => Response.json({ items: [], nextCursor: "same" }));
    const provider = new PantaPredictionProvider(
      "https://live-api.panta.market/api/v1",
      "key",
      fetcher,
    );
    await expect(provider.listOpenMarkets()).rejects.toThrow("pagination did not complete");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects a failed later page rather than silently dropping those markets", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          items: [{ marketId: "first123", title: "First event" }],
          nextCursor: "next",
        }),
      )
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
    const provider = new PantaPredictionProvider(
      "https://live-api.panta.market/api/v1",
      "key",
      fetcher,
    );
    await expect(provider.listOpenMarkets()).rejects.toThrow("Panta API responded with 503");
  });

  it("refreshes detail and uses settlement rules, linked sources, and total volume", async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      const market = {
        marketId: "native123",
        title: "Will BTC reach a new all-time high?",
        description: "Promotional creation description",
        yesPrice: "0.005",
        noPrice: "0.995",
        volumeUsdc: "3.25",
        totalVolumeUsdc: "8.25",
        startTime: "2026-01-01T00:00:00Z",
        endTime: "2027-01-01T00:00:00Z",
      };
      return Response.json(
        url.includes("/native123/")
          ? {
              ...market,
              resolutionRule:
                "YES if the official oracle reports a new high before the deadline. Otherwise NO.",
              sources: ["https://www.coingecko.com/en/coins/bitcoin"],
            }
          : { items: [market] },
      );
    });
    const provider = new PantaPredictionProvider(
      "https://live-api.panta.market/api/v1",
      "key",
      fetcher,
    );
    expect((await provider.listOpenMarkets())[0]?.resolutionRules).toBeNull();
    const detail = await provider.getMarket("native123");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(detail?.resolutionRules).toContain("official oracle");
    expect(detail?.resolutionRules).toContain("https://www.coingecko.com");
    expect(detail?.resolutionRules).not.toContain("Promotional");
    expect(detail?.volumeUsd).toBe(8.25);
    expect(detail?.outcomes[0]?.probability).toBe("0.005");
    expect(detail?.closesAt).toBe("2027-01-01T00:00:00.000Z");
  });
  it("marks catalog rows with null prices as unavailable instead of asserting 50/50", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        items: [
          {
            marketId: "native123",
            title: "ETH above 5k?",
            yesPrice: null,
            noPrice: null,
            volumeUsdc: "1200",
          },
        ],
      }),
    );
    const provider = new PantaPredictionProvider(
      "https://live-api.panta.market/api/v1",
      "test",
      fetcher,
    );
    const markets = await provider.listOpenMarkets();
    expect(markets[0]?.pricingAvailable).toBe(false);
    expect(markets[0]?.venueTokenIds).toEqual([]);
    expect(markets[0]?.eventVolume24hUsd).toBeNull();
  });
  it("parses live Panta REST API markets and calculates outcomes", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "0xPantaMarket1",
              question: "Will Bitcoin exceed $120k in 2026?",
              category: "Crypto",
              marketType: "binary",
              closeTime: Math.floor(Date.now() / 1000) + 86400 * 10,
              resolutionRules: "Settled via Pyth BTC/USD oracle feed.",
              pricing: {
                yes: 0.72,
                no: 0.28,
              },
              volumeUsd: 125000,
            },
          ],
        }),
      ),
    );

    const provider = new PantaPredictionProvider(
      "https://live-api.panta.market/api/v1",
      "panta-api-key",
      fetcher,
    );

    const markets = await provider.listOpenMarkets();
    expect(markets).toHaveLength(1);
    expect(markets[0]?.id).toBe("0xPantaMarket1");
    expect(markets[0]?.provider).toBe("panta");
    expect(markets[0]?.outcomes).toEqual([
      { id: "0xPantaMarket1:yes", label: "YES", probability: "0.72", sellPrice: "0.72" },
      { id: "0xPantaMarket1:no", label: "NO", probability: "0.28", sellPrice: "0.28" },
    ]);
    expect(markets[0]?.resolutionRules).toBe("Settled via Pyth BTC/USD oracle feed.");
  });

  it("decodes on-chain Event accounts and derives bonding curve pricing", async () => {
    const creator = crypto.randomBytes(32);
    const disc = Buffer.from([125, 192, 125, 158, 9, 115, 152, 233]);
    const eventBuf = Buffer.alloc(600);
    disc.copy(eventBuf, 0);
    creator.copy(eventBuf, 8);

    const nowSec = Math.floor(Date.now() / 1000);
    eventBuf.writeBigInt64LE(BigInt(nowSec - 1000), 40); // startTime
    eventBuf.writeBigInt64LE(BigInt(nowSec + 86400), 48); // endTime
    eventBuf.writeBigInt64LE(BigInt(nowSec + 86400), 56); // resolutionTime
    eventBuf.writeBigUInt64LE(500_000_000n, 88); // totalYesShares
    eventBuf.writeBigUInt64LE(500_000_000n, 104); // totalNoShares
    eventBuf.writeBigUInt64LE(750_000_000n, 120); // virtualSolReserves
    eventBuf.writeBigUInt64LE(250_000_000n, 136); // virtualYesShares

    let offset = 328;
    const qBytes = Buffer.from("Will ETH reach $5,000?", "utf8");
    eventBuf.writeUInt32LE(qBytes.length, offset);
    offset += 4;
    qBytes.copy(eventBuf, offset);
    offset += qBytes.length;

    const rBytes = Buffer.from("Resolves via CoinGecko or Pyth.", "utf8");
    eventBuf.writeUInt32LE(rBytes.length, offset);
    offset += 4;
    rBytes.copy(eventBuf, offset);
    offset += rBytes.length;

    // Sources: ["crypto"]
    eventBuf.writeUInt32LE(1, offset);
    offset += 4;
    const sBytes = Buffer.from("crypto", "utf8");
    eventBuf.writeUInt32LE(sBytes.length, offset);
    offset += 4;
    sBytes.copy(eventBuf, offset);
    offset += sBytes.length;

    offset += 16; // activeVolume
    offset += 3; // bumps
    eventBuf.writeUInt8(1, offset++); // isActive
    eventBuf.writeUInt8(0, offset++); // isGraduated
    eventBuf.writeUInt8(0, offset++); // isResolved
    eventBuf.writeUInt8(0, offset++); // isCancelled

    const fakePubkey = "9kpmmXqu626jiMfitg4GFhzCtPK3NcvK3wT5PHcrS45";
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          result: [
            {
              pubkey: fakePubkey,
              account: {
                data: [eventBuf.toString("base64"), "base64"],
              },
            },
          ],
        }),
      ),
    );

    const provider = new PantaPredictionProvider(
      "https://live-api.panta.market/api/v1",
      undefined,
      fetcher,
    );

    // Call on-chain directly
    const onchain = await (
      provider as unknown as {
        fetchOnChain: (t: number) => Promise<
          Array<{
            id: string;
            provider: string;
            title: string;
            outcomes: Array<{ probability: string }>;
            category: string;
          }>
        >;
      }
    ).fetchOnChain(Date.now());
    expect(onchain).toHaveLength(1);
    expect(onchain[0]?.id).toBe(fakePubkey);
    expect(onchain[0]?.provider).toBe("panta");
    expect(onchain[0]?.title).toBe("Will ETH reach $5,000?");
    // 750 / (750 + 250) = 0.75
    expect(onchain[0]?.outcomes[0]?.probability).toBe("0.7500");
    expect(onchain[0]?.outcomes[1]?.probability).toBe("0.2500");
    expect(onchain[0]?.category).toBe("Crypto");
  });
});
