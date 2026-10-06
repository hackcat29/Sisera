import crypto from "node:crypto";
import { Keypair, type PublicKey } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { PANTA_PROGRAM_ID, PantaPredictionTradingClient } from "../src/panta-prediction.js";

describe("PantaPredictionTradingClient", () => {
  it("quotes and prepares prediction orders via Panta REST API", async () => {
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes("/markets/")) {
        return new Response(
          JSON.stringify({
            id: "PANTA-123",
            status: "active",
            closeTime: Math.floor(Date.now() / 1000) + 86400,
            resolutionRules: "Official outcome via oracle",
            pricing: { yes: 0.65, no: 0.35 },
          }),
        );
      }
      if (url.endsWith("/trading-status")) {
        return new Response(JSON.stringify({ active: true }));
      }
      expect(options?.method).toBe("POST");
      expect(options?.headers).toMatchObject({
        "x-api-key": "secret-panta-key",
      });
      return new Response(
        JSON.stringify({
          transaction: "A".repeat(80),
          orderPubkey: "B".repeat(32),
        }),
      );
    });

    const client = new PantaPredictionTradingClient(
      "https://live-api.panta.market/api/v1",
      "secret-panta-key",
      fetcher as typeof fetch,
    );

    const quote = await client.quote("PANTA-123", true);
    expect(quote.marketId).toBe("PANTA-123");
    expect(quote.priceUsd).toBe("0.650000");

    const prepared = await client.prepare({
      marketId: "PANTA-123",
      wallet: "C".repeat(32),
      isYes: true,
      depositAmount: "10000000",
    });
    expect(prepared.transaction).toBe("A".repeat(80));
    expect(prepared.order.orderPubkey).toBe("B".repeat(32));
    expect(prepared.priceUsd).toBe(0.65);
  });

  it("falls back to on-chain RPC decoding and order building when REST API is unavailable", async () => {
    // Generate valid Solana keypairs for on-chain test
    const creator = Keypair.generate().publicKey;
    const treasury = Keypair.generate().publicKey;
    const user = Keypair.generate().publicKey;
    const eventKey = Keypair.generate().publicKey;

    const question = "Will Solana break $300 before 2027?";
    const rule = "Resolves YES if SOL touches $300 on Pyth.";

    // Construct mock event account data
    const disc = Buffer.from([125, 192, 125, 158, 9, 115, 152, 233]);
    const eventBuf = Buffer.alloc(800);
    disc.copy(eventBuf, 0);
    creator.toBuffer().copy(eventBuf, 8);

    const nowSec = Math.floor(Date.now() / 1000);
    eventBuf.writeBigInt64LE(BigInt(nowSec - 3600), 40); // startTime
    eventBuf.writeBigInt64LE(BigInt(nowSec + 86400 * 30), 48); // endTime
    eventBuf.writeBigInt64LE(BigInt(nowSec + 86400 * 30), 56); // resolutionTime
    eventBuf.writeBigInt64LE(BigInt(nowSec - 3600), 64); // createdAt
    eventBuf.writeBigInt64LE(0n, 72); // resolvedAt
    eventBuf.writeBigInt64LE(0n, 80); // cancelledAt

    eventBuf.writeBigUInt64LE(1_000_000_000n, 88); // totalYesShares
    eventBuf.writeBigUInt64LE(1_000_000_000n, 104); // totalNoShares
    eventBuf.writeBigUInt64LE(600_000_000n, 120); // virtualSolReserves
    eventBuf.writeBigUInt64LE(400_000_000n, 136); // virtualYesShares

    // Question at offset 328
    let offset = 328;
    const qBytes = Buffer.from(question, "utf8");
    eventBuf.writeUInt32LE(qBytes.length, offset);
    offset += 4;
    qBytes.copy(eventBuf, offset);
    offset += qBytes.length;

    const rBytes = Buffer.from(rule, "utf8");
    eventBuf.writeUInt32LE(rBytes.length, offset);
    offset += 4;
    rBytes.copy(eventBuf, offset);
    offset += rBytes.length;

    // Sources
    eventBuf.writeUInt32LE(0, offset);
    offset += 4;
    offset += 16; // activeVolume
    offset += 3; // bumps
    eventBuf.writeUInt8(1, offset++); // isActive = true
    eventBuf.writeUInt8(0, offset++); // isGraduated = false
    eventBuf.writeUInt8(0, offset++); // isResolved = false
    eventBuf.writeUInt8(0, offset++); // isCancelled = false

    // Config account data with treasury at 136..168
    const configBuf = Buffer.alloc(200);
    treasury.toBuffer().copy(configBuf, 136);

    const client = new PantaPredictionTradingClient(
      "https://unavailable.panta.test",
      undefined,
      globalThis.fetch,
      "https://mock-rpc.solana.test",
    );

    // Mock RPC connection calls
    const mockConnection = {
      getAccountInfo: vi.fn(async (key: PublicKey) => {
        if (key.equals(eventKey)) {
          return { data: eventBuf, lamports: 100_000_000 };
        }
        return { data: configBuf, lamports: 100_000_000 };
      }),
      getLatestBlockhash: vi.fn(async () => ({
        blockhash: "EkSnNWBD2GMT9AwFGmpmpNxTF5gkpmVDYqNRJ2s55555",
        lastValidBlockHeight: 12345,
      })),
    };

    (client as unknown as { connection: unknown }).connection = mockConnection;

    const quote = await client.quote(eventKey.toBase58(), true);
    expect(quote.marketId).toBe(eventKey.toBase58());
    // 600 / (600 + 400) = 0.60
    expect(quote.priceUsd).toBe("0.600000");

    const prepared = await client.prepare({
      marketId: eventKey.toBase58(),
      wallet: user.toBase58(),
      isYes: true,
      depositAmount: "50000000",
    });

    expect(prepared.transaction).toBeDefined();
    expect(prepared.order.orderPubkey).toBeDefined();
    expect(prepared.priceUsd).toBe(0.6);
  });
});
