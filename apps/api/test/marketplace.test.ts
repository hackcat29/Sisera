import { createHash } from "node:crypto";
import { closePools, getStrategyListing, pool } from "@sisera/db";
import { Connection, Keypair } from "@solana/web3.js";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { AgentDraftInput, compileAgentDraft } from "../src/agent-governance.js";
import { buildApi } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { USDC_MINT } from "../src/platform/catalog.js";
import {
  paymentTransaction,
  portableDraft,
  validateSignedPayment,
} from "../src/platform/marketplace-service.js";
import {
  type LiveFill,
  type WalletTransaction,
  liveFillPerformance,
  walletPerformance,
} from "../src/platform/wallet-leaderboard.js";

const creator = Keypair.generate();
const buyer = Keypair.generate();
const input = AgentDraftInput.parse({
  name: "Momentum rules",
  description: "A trend strategy with an EMA entry and disciplined exits.",
  universe: ["BTCUSDT"],
  timeframe: "1d",
  factors: ["EMA trend"],
  capitalLimitUsd: 5000,
  maxTradeNotionalUsd: 1000,
  maxDailyDrawdownPct: 3,
  maxOpenPositions: 1,
  stopLossPct: 5,
  takeProfitPct: 10,
  maxSlippageBps: 20,
  liveWallet: creator.publicKey.toBase58(),
  rules: { entry: [{ type: "ema_trend", fast: 12, slow: 26, direction: "bullish" }], exit: [] },
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await closePools();
});

describe("strategy payment and portable rules", () => {
  it("strips live settings while preserving rules and risk caps", () => {
    const draft = portableDraft(input.name, {
      ...compileAgentDraft(input).policy,
      secret: "private",
      execution: { maxSlippageBps: 20, liveWallet: creator.publicKey.toBase58(), delegated: true },
    });
    expect(draft.liveWallet).toBeUndefined();
    expect(draft.rules).toEqual(input.rules);
    expect(draft.capitalLimitUsd).toBe(5000);
    expect(draft).not.toHaveProperty("secret");
  });
  it("binds recipient, price and checkout memo to the wallet signature", () => {
    const tx = paymentTransaction(
      buyer.publicKey.toBase58(),
      creator.publicKey.toBase58(),
      12.34,
      crypto.randomUUID(),
    );
    tx.recentBlockhash = Keypair.generate().publicKey.toBase58();
    expect(tx.instructions[1]?.data.readBigUInt64LE(1)).toBe(12340000n);
    const prepared = tx.serialize({ requireAllSignatures: false }).toString("base64");
    tx.sign(buyer);
    const signed = tx.serialize().toString("base64");
    expect(validateSignedPayment(prepared, signed).verifySignatures()).toBe(true);
    tx.instructions[1]?.data.writeBigUInt64LE(1n, 1);
    tx.sign(buyer);
    expect(() => validateSignedPayment(prepared, tx.serialize().toString("base64"))).toThrow(
      "differs",
    );
    expect(() => validateSignedPayment(prepared, prepared)).toThrow();
  });
});

const wallet = buyer.publicKey.toBase58();
const token = creator.publicKey.toBase58();
const now = Date.now();
function swap(
  signature: string,
  quantity: number,
  cash: number,
  timestamp = now / 1000 - 30,
): WalletTransaction {
  return {
    signature,
    type: "SWAP",
    timestamp,
    transactionError: null,
    tokenTransfers: [
      {
        mint: token,
        tokenAmount: Math.abs(quantity),
        fromUserAccount: quantity < 0 ? wallet : "pool",
        toUserAccount: quantity > 0 ? wallet : "pool",
      },
      {
        mint: USDC_MINT,
        tokenAmount: Math.abs(cash),
        fromUserAccount: cash < 0 ? wallet : "pool",
        toUserAccount: cash > 0 ? wallet : "pool",
      },
    ],
  };
}
describe("wallet ranking evidence", () => {
  it("counts live short closes once and excludes unknown spot basis", () => {
    const opening: LiveFill = {
      id: "open",
      venue: "hyperliquid",
      instrumentKey: "hyperliquid:BTC",
      side: "sell",
      quantity: 2,
      priceUsd: 100,
      signature: "open",
      occurredAt: new Date(now - 2000).toISOString(),
    };
    const closing = {
      ...opening,
      id: "close",
      side: "buy",
      priceUsd: 80,
      signature: "close",
      occurredAt: new Date(now - 1000).toISOString(),
    };
    expect(
      liveFillPerformance([closing, opening, { ...closing, id: "duplicate" }], now)["7d"],
    ).toMatchObject({ pnlUsd: 40, volumeUsd: 360, trades: 2 });
    expect(liveFillPerformance([{ ...opening, venue: "binance" }], now)["7d"]?.pnlUsd).toBeNull();
  });
  it("uses earlier purchases for FIFO basis and filters realized P&L by the sale window", () => {
    const purchase = swap("buy", 10, -100, now / 1000 - 2 * 86400);
    const sale = swap("sale", -5, 75);
    const result = walletPerformance(wallet, [sale, purchase, sale], now);
    expect(result["24h"]).toMatchObject({ pnlUsd: 25, trades: 1, volumeUsd: 75, coveragePct: 100 });
    expect(result["7d"]).toMatchObject({ pnlUsd: 25, trades: 2, volumeUsd: 175 });
  });
  it("keeps unknown cost basis unranked rather than reporting a deposit or sale as profit", () => {
    expect(walletPerformance(wallet, [swap("sale", -5, 100)], now)["7d"]).toMatchObject({
      pnlUsd: null,
      coveragePct: 0,
    });
    const transfer = { ...swap("deposit", 100, 0), type: "TRANSFER" };
    expect(
      walletPerformance(wallet, [transfer, swap("sale", -100, 100)], now)["7d"]?.pnlUsd,
    ).toBeNull();
  });
  it("retains partial matched proceeds and ignores failed transactions", () => {
    expect(
      walletPerformance(
        wallet,
        [
          swap("buy", 2, -20),
          swap("sale", -4, 60),
          { ...swap("failed", -2, 100), transactionError: { error: true } },
        ],
        now,
      )["7d"],
    ).toMatchObject({ pnlUsd: 10, coveragePct: 0, trades: 2 });
  });
});

const db = process.env.MARKETPLACE_TEST_DATABASE_URL;
describe.skipIf(!db)("marketplace persistence and access", () => {
  it("sells an immutable version, confirms once, imports as research and preserves licenses when unlisted", async () => {
    if (!db) return;
    const app = await buildApi(
      readConfig({
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        DATABASE_URL: db,
        SISERA_ALLOW_DEV_AUTH: "true",
        SISERA_LIVE_SOLANA_ENABLED: "false",
      }),
      { ownsWallet: async () => true },
    );
    const subject = `privy:market-creator-${crypto.randomUUID()}`;
    const buyerSubject = `privy:market-buyer-${crypto.randomUUID()}`;
    const headers = { "x-sisera-dev-role": "trader", "x-sisera-dev-subject": subject };
    const buyerHeaders = { ...headers, "x-sisera-dev-subject": buyerSubject };
    try {
      const created = await app.inject({
        method: "POST",
        url: "/v1/agents",
        headers,
        payload: input,
      });
      expect(created.statusCode).toBe(201);
      const agentId = created.json().data.id;
      const listed = await app.inject({
        method: "POST",
        url: "/v1/marketplace",
        headers,
        payload: {
          agentId,
          title: "Licensed trend strategy",
          description: input.description,
          creatorName: "Test creator",
          category: "trend",
          payoutWallet: creator.publicKey.toBase58(),
          priceUsdc: 25,
        },
      });
      expect(listed.statusCode).toBe(201);
      const id = listed.json().data.id;
      expect((await getStrategyListing(db, id))?.draft).not.toHaveProperty("liveWallet");
      const browse = await app.inject({ url: "/v1/marketplace", headers: buyerHeaders });
      expect(browse.statusCode, browse.body).toBe(200);
      expect(browse.json().data.find((l: { id: string }) => l.id === id)).not.toHaveProperty(
        "draft",
      );
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/marketplace/${id}/import`,
            headers: buyerHeaders,
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: "PUT",
            url: `/v1/marketplace/${id}/unlist`,
            headers: buyerHeaders,
            payload: {},
          })
        ).statusCode,
      ).toBe(404);
      vi.spyOn(Connection.prototype, "getLatestBlockhash").mockResolvedValue({
        blockhash: Keypair.generate().publicKey.toBase58(),
        lastValidBlockHeight: 1000,
      });
      const quote = await app.inject({
        method: "POST",
        url: `/v1/marketplace/${id}/checkout`,
        headers: buyerHeaders,
        payload: { wallet: buyer.publicKey.toBase58() },
      });
      expect(quote.statusCode).toBe(200);
      const c = quote.json().data;
      const duplicate = await app.inject({
        method: "POST",
        url: `/v1/marketplace/${id}/checkout`,
        headers: buyerHeaders,
        payload: { wallet: buyer.publicKey.toBase58() },
      });
      expect(duplicate.statusCode).toBe(409);
      const { Transaction } = await import("@solana/web3.js");
      const tx = Transaction.from(Buffer.from(c.transaction, "base64"));
      tx.sign(buyer);
      const status = vi.spyOn(Connection.prototype, "getSignatureStatuses").mockResolvedValue({
        context: { slot: 1 },
        value: [{ slot: 1, confirmations: 1, err: null, confirmationStatus: "confirmed" }],
      });
      const send = vi
        .spyOn(Connection.prototype, "sendRawTransaction")
        .mockResolvedValue("not-called");
      const settle = () =>
        app.inject({
          method: "POST",
          url: `/v1/marketplace/checkouts/${c.id}/settle`,
          headers: buyerHeaders,
          payload: { signedTransaction: tx.serialize().toString("base64") },
        });
      expect((await settle()).json().data.licensed).toBe(false);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/marketplace/${id}/import`,
            headers: buyerHeaders,
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
      const pending = await app.inject({ url: "/v1/marketplace/checkouts", headers: buyerHeaders });
      expect(pending.json().data).toEqual([{ id: c.id, listingId: id }]);
      status.mockResolvedValue({
        context: { slot: 1 },
        value: [{ slot: 1, confirmations: null, err: null, confirmationStatus: "finalized" }],
      });
      // Recover confirmation in another browser without needing the signed bytes again.
      const recovered = await app.inject({
        method: "POST",
        url: `/v1/marketplace/checkouts/${c.id}/settle`,
        headers: buyerHeaders,
        payload: {},
      });
      expect(recovered.json().data.licensed).toBe(true);
      expect(
        (await app.inject({ url: "/v1/marketplace/checkouts", headers: buyerHeaders })).json().data,
      ).toEqual([]);
      expect((await settle()).json().data.licensed).toBe(true);
      expect((await settle()).json().data.licensed).toBe(true);
      expect(send).not.toHaveBeenCalled();
      const [sales] = await pool(
        db,
      )`SELECT count(*)::int AS count FROM strategy_licenses WHERE listing_id = ${id}`;
      expect(sales?.count).toBe(1);
      const imported = await app.inject({
        method: "POST",
        url: `/v1/marketplace/${id}/import`,
        headers: buyerHeaders,
        payload: {},
      });
      expect(imported.statusCode).toBe(201);
      expect(imported.json().data).toMatchObject({
        stage: "draft",
        autonomy: "research",
        ownerSubject: buyerSubject,
      });
      expect(imported.json().data.policy.execution.liveWallet).toBeUndefined();
      expect(
        (
          await app.inject({
            method: "PUT",
            url: `/v1/marketplace/${id}/unlist`,
            headers,
            payload: {},
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/marketplace/${id}/import`,
            headers: buyerHeaders,
            payload: {},
          })
        ).statusCode,
      ).toBe(201);
      const freeAgent = await app.inject({
        method: "POST",
        url: "/v1/agents",
        headers,
        payload: input,
      });
      const freeListing = await app.inject({
        method: "POST",
        url: "/v1/marketplace",
        headers,
        payload: {
          agentId: freeAgent.json().data.id,
          title: "Free trend strategy",
          description: input.description,
          creatorName: "Test creator",
          category: "trend",
          payoutWallet: creator.publicKey.toBase58(),
          priceUsdc: 0,
        },
      });
      const freeId = freeListing.json().data.id;
      const freeLicense = await app.inject({
        method: "POST",
        url: `/v1/marketplace/${freeId}/checkout`,
        headers: buyerHeaders,
        payload: {},
      });
      expect(freeLicense.statusCode, freeLicense.body).toBe(200);
      expect(freeLicense.json().data.licensed).toBe(true);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/marketplace/${freeId}/import`,
            headers: buyerHeaders,
            payload: {},
          })
        ).statusCode,
      ).toBe(201);
    } finally {
      await app.close();
    }
  });
  it("combines external wallets and live Sisera trades while excluding paper traders", async () => {
    if (!db) return;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([])),
    );
    const app = await buildApi(
      readConfig({
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        DATABASE_URL: db,
        SISERA_ALLOW_DEV_AUTH: "true",
      }),
    );
    const headers = { "x-sisera-dev-role": "viewer", "x-sisera-dev-subject": "privy:tracker" };
    try {
      const liveSubject = `live-${crypto.randomUUID()}`;
      const paperSubject = `paper-${crypto.randomUUID()}`;
      const sql = pool(db);
      for (const [side, price] of [
        ["buy", 100],
        ["sell", 120],
      ] as const) {
        await sql`INSERT INTO market_live_orders
          (id, tenant_id, subject, venue, symbol, side, quantity, client_order_id, venue_order_id, status, fill_price, fee_usd, updated_at)
          VALUES (${crypto.randomUUID()}, 'test', ${liveSubject}, 'binance', 'BTCUSDT', ${side}, 1,
            ${crypto.randomUUID()}, ${crypto.randomUUID()}, 'filled', ${price}, 0,
            ${new Date(Date.now() - (side === "buy" ? 2000 : 1000)).toISOString()})`;
      }
      await sql`INSERT INTO market_paper_orders
        (id, tenant_id, subject, venue, symbol, side, quantity, fill_price, fee_usd)
        VALUES (${crypto.randomUUID()}, 'test', ${paperSubject}, 'binance', 'BTCUSDT', 'buy', 1, 100, 0)`;
      for (const address of [wallet, "0xAbCd000000000000000000000000000000000001"]) {
        expect(
          (
            await app.inject({
              method: "POST",
              url: "/v1/leaderboard/wallets",
              headers,
              payload: { address },
            })
          ).statusCode,
        ).toBe(201);
      }
      const response = await app.inject({ url: "/v1/leaderboard/wallets?window=7d", headers });
      expect(response.statusCode).toBe(200);
      const rows = response.json().data.rows;
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ address: wallet, chain: "solana", rank: null }),
          expect.objectContaining({
            address: "0xabcd000000000000000000000000000000000001",
            chain: "evm",
            rank: null,
          }),
        ]),
      );
      expect(rows.every((r: Record<string, unknown>) => !("subject" in r))).toBe(true);
      const key = (subject: string) =>
        `sisera:${createHash("sha256").update(`test:${subject}`).digest("hex").slice(0, 12)}:binance`;
      expect(rows).toContainEqual(
        expect.objectContaining({
          address: key(liveSubject),
          pnlUsd: 20,
          trades: 2,
          volumeUsd: 220,
        }),
      );
      expect(rows.some((r: { address: string }) => r.address === key(paperSubject))).toBe(false);
      const canonical = await app.inject({ url: "/v1/leaderboard?window=7d", headers });
      expect(canonical.statusCode).toBe(200);
      expect(canonical.json().data.rows).toContainEqual(
        expect.objectContaining({ address: key(liveSubject), pnlUsd: 20 }),
      );
      expect(
        (await app.inject({ url: "/v1/leaderboard/wallets?window=forever", headers })).statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });
});
