import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PantaPredictionProvider } from "../src/index.js";

describe("PantaPredictionProvider", () => {
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
