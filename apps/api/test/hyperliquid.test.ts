import { signL1Action } from "@nktkas/hyperliquid/signing";
import Decimal from "decimal.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelayBridgeClient } from "../src/bridge.js";
import { HyperliquidTradingService, estimateLiquidationPrice } from "../src/hyperliquid-trading.js";

const db = vi.hoisted(() => ({
  prepareHyperliquidOrder: vi.fn(),
  claimHyperliquidOrder: vi.fn(),
  updateMarketLiveOrder: vi.fn(),
  expireHyperliquidOrders: vi.fn(),
  listUnreconciledHyperliquidOrders: vi.fn(),
}));
vi.mock("@sisera/db", () => db);

const USER = "0x03508bb71268bba25ecacc8f620e01866650532c";
const BUILDER = "0x1111111111111111111111111111111111111111";
const agent = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());

type Venue = {
  withdrawable?: string;
  accountValue?: string;
  positions?: Array<{ coin: string; szi: string; type?: "cross" | "isolated"; leverage?: number }>;
  agents?: string[];
  exchange?: (body: { action: { type: string } }) => unknown;
  exchangeError?: Error;
  spotBalances?: Array<{ coin: string; total: string; hold?: string }>;
  approvedBuilderFee?: number;
  orderStatus?: unknown;
  builder?: boolean;
};

/** A stand-in for Hyperliquid's info and exchange endpoints. */
function venue(state: Venue = {}) {
  const exchangeCalls: Array<{ action: { type: string } }> = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (url.endsWith("/exchange")) {
      exchangeCalls.push(body);
      if (state.exchangeError && body.action.type === "order") throw state.exchangeError;
      return Response.json(
        state.exchange?.(body) ??
          (body.action.type === "order"
            ? {
                status: "ok",
                response: {
                  type: "order",
                  data: { statuses: [{ filled: { totalSz: "0.0062", avgPx: "80655", oid: 42 } }] },
                },
              }
            : { status: "ok", response: { type: "default" } }),
      );
    }
    switch (body.type) {
      case "metaAndAssetCtxs":
        return Response.json([
          {
            universe: [
              { name: "BTC", szDecimals: 5, maxLeverage: 40 },
              { name: "HYPE", szDecimals: 2, maxLeverage: 10 },
              { name: "OLD", szDecimals: 2, maxLeverage: 5, isDelisted: true },
            ],
          },
          [{ markPx: "80000" }, { markPx: "40" }, { markPx: "1" }],
        ]);
      case "clearinghouseState":
        return Response.json({
          marginSummary: { accountValue: state.accountValue ?? "1000", totalNtlPos: "0" },
          withdrawable: state.withdrawable ?? "1000",
          assetPositions: (state.positions ?? []).map((position) => ({
            position: {
              coin: position.coin,
              szi: position.szi,
              entryPx: "79000",
              leverage: { type: position.type ?? "cross", value: position.leverage ?? 5 },
              liquidationPx: null,
            },
          })),
        });
      case "spotMetaAndAssetCtxs":
        return Response.json([
          {
            tokens: [
              { name: "USDC", szDecimals: 8, index: 0, fullName: null },
              { name: "UBTC", szDecimals: 5, index: 197, fullName: "Unit Bitcoin" },
            ],
            universe: [{ name: "@142", index: 142, tokens: [197, 0] }],
          },
          [{ coin: "@142", markPx: "81000", dayNtlVlm: "1000000" }],
        ]);
      case "spotClearinghouseState":
        return Response.json({
          balances: (state.spotBalances ?? [{ coin: "USDC", total: "500" }]).map((balance) => ({
            hold: "0",
            ...balance,
          })),
        });
      case "maxBuilderFee":
        return Response.json(state.approvedBuilderFee ?? 1000);
      case "orderStatus":
        return Response.json(state.orderStatus ?? { status: "unknownOid" });
      case "extraAgents":
        return Response.json(
          (state.agents ?? [agent.address]).map((address) => ({
            address,
            name: "Sisera",
            validUntil: null,
          })),
        );
      case "userFees":
        return Response.json({ userCrossRate: "0.00045" });
      case "userFills":
        return Response.json([{ oid: 42, fee: "0.22", sz: "0.0062", px: "80655" }]);
      default:
        return Response.json(null);
    }
  });
  const service = new HyperliquidTradingService({
    databaseUrl: "postgres://test",
    maxLeverage: 20,
    maxNotionalUsd: 25_000,
    builder: state.builder ? { address: BUILDER, perpBps: 10, spotBps: 100 } : undefined,
    fetcher: fetcher as unknown as typeof fetch,
  });
  return { service, fetcher, exchangeCalls };
}

const open = {
  kind: "open" as const,
  subject: "privy:user",
  tenantId: "personal:user",
  user: USER,
  coin: "BTC",
  side: "buy" as const,
  marginUsd: 100,
  leverage: 5,
  isCross: true,
};

/** Signs what Sisera prepared, the way the browser does with its trading key. */
async function sign(
  actions: Array<{ action: Record<string, unknown>; nonce: number; expiresAfter: number }>,
  wallet = agent,
) {
  return Promise.all(actions.map((item) => signL1Action({ wallet, ...item })));
}

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("Hyperliquid order preparation", () => {
  it("sizes a market order from margin times leverage and stores the exact actions", async () => {
    const { service } = venue();
    const prepared = await service.prepare(open);
    expect(prepared).toMatchObject({
      side: "buy",
      size: "0.00625",
      leverage: 5,
      notionalUsd: "500.00",
    });
    // Market buys are IOC limits above the mark, rounded to Hyperliquid's price rules.
    expect(prepared.limitPx).toBe("80640");
    expect(prepared.actions.map((item) => item.action.type)).toEqual(["updateLeverage", "order"]);
    const order = prepared.actions[1]?.action as { orders: Array<Record<string, unknown>> };
    expect(order.orders[0]).toMatchObject({ a: 0, b: true, s: "0.00625", r: false });
    expect(db.prepareHyperliquidOrder).toHaveBeenCalledWith(
      "postgres://test",
      expect.objectContaining({
        preparedActions: prepared.actions,
        marginUsd: "100",
        leverage: "5",
      }),
    );
  });

  it("adds take profit and stop loss as reduce-only triggers on the opposite side", async () => {
    const { service } = venue();
    const prepared = await service.prepare({ ...open, takeProfitPx: 90000, stopLossPx: 76000 });
    const order = prepared.actions.at(-1)?.action as {
      grouping: string;
      orders: Array<{ b: boolean; r: boolean; t: { trigger?: { tpsl: string } } }>;
    };
    expect(order.grouping).toBe("normalTpsl");
    expect(order.orders.slice(1).map((item) => [item.b, item.r, item.t.trigger?.tpsl])).toEqual([
      [false, true, "tp"],
      [false, true, "sl"],
    ]);
  });

  it("explains every rejection before anything is stored", async () => {
    const reject = async (
      state: Venue,
      input: Partial<typeof open> & Record<string, unknown>,
      text: RegExp,
    ) => {
      const { service } = venue(state);
      await expect(service.prepare({ ...open, ...input } as typeof open)).rejects.toThrow(text);
    };
    await reject({ withdrawable: "50" }, {}, /You have \$50.00 available/);
    await reject({}, { marginUsd: 1, leverage: 2 }, /at least \$10/);
    await reject({}, { coin: "HYPE", leverage: 15 }, /HYPE allows up to 10x/);
    await reject({}, { leverage: 25 }, /BTC allows up to 20x/);
    await reject({}, { coin: "OLD" }, /not available to trade/);
    // $2,000 at 20x is a $40,000 position, over the $25,000 per-order limit.
    await reject(
      { withdrawable: "5000", accountValue: "5000" },
      { marginUsd: 2000, leverage: 20 },
      /limited to \$25,000/,
    );
    await reject({}, { stopLossPx: 85000 }, /Stop loss must be below/);
    await reject(
      { positions: [{ coin: "BTC", szi: "0.1", type: "isolated" }] },
      {},
      /uses isolated margin\. Close it to switch modes/,
    );
    expect(db.prepareHyperliquidOrder).not.toHaveBeenCalled();
  });

  it("applies the requested leverage to an open position instead of silently keeping the old one", async () => {
    const { service } = venue({ positions: [{ coin: "BTC", szi: "0.1", leverage: 20 }] });
    const prepared = await service.prepare(open);
    expect(prepared.leverage).toBe(5);
    expect(prepared.actions[0]?.action).toMatchObject({ type: "updateLeverage", leverage: 5 });
  });

  it("closes a position reduce-only even when it is larger than the per-order limit", async () => {
    const { service } = venue({ positions: [{ coin: "BTC", szi: "-2" }] });
    const prepared = await service.prepare({
      kind: "close",
      subject: "privy:user",
      tenantId: "personal:user",
      user: USER,
      coin: "BTC",
      fraction: 1,
    });
    expect(prepared).toMatchObject({ side: "buy", size: "2", reduceOnly: true });
    expect(Number(prepared.notionalUsd)).toBeGreaterThan(25_000);
    expect(prepared.actions.map((item) => item.action.type)).toEqual(["order"]);
  });

  it("estimates liquidation inside the margin with the maintenance buffer", () => {
    const long = estimateLiquidationPrice(new Decimal(100), 10, 50, true);
    expect(long?.toNumber()).toBeCloseTo(91, 6);
    expect(estimateLiquidationPrice(new Decimal(100), 10, 50, false)?.toNumber()).toBeCloseTo(
      109,
      6,
    );
  });
});

describe("Hyperliquid order execution", () => {
  async function prepared(state: Venue = {}) {
    const harness = venue(state);
    const order = await harness.service.prepare(open);
    db.claimHyperliquidOrder.mockResolvedValue({
      id: order.orderId,
      accountAddress: USER,
      preparedActions: order.actions,
    });
    return { ...harness, order };
  }

  it("submits the stored actions signed by an approved trading key and records the fill", async () => {
    const { service, order, exchangeCalls } = await prepared();
    const result = await service.execute({
      subject: "privy:user",
      orderId: order.orderId,
      signatures: await sign(order.actions),
    });
    expect(result).toMatchObject({
      status: "filled",
      filledSize: "0.0062",
      averagePx: "80655",
      feeUsd: "0.22",
    });
    expect(exchangeCalls.map((call) => call.action)).toEqual(
      order.actions.map((item) => item.action),
    );
    expect(db.updateMarketLiveOrder).toHaveBeenCalledWith(
      "postgres://test",
      order.orderId,
      "filled",
      "42",
      {
        priceUsd: "80655",
        feeUsd: "0.22",
        quantity: "0.0062",
      },
    );
  });

  it("refuses signatures from a key that is not approved for the account", async () => {
    const { service, order, exchangeCalls } = await prepared();
    await expect(
      service.execute({
        subject: "privy:user",
        orderId: order.orderId,
        signatures: await sign(order.actions, stranger),
      }),
    ).rejects.toThrow(/Enable trading/);
    expect(exchangeCalls).toHaveLength(0);
    expect(db.updateMarketLiveOrder).toHaveBeenCalledWith(
      "postgres://test",
      order.orderId,
      "rejected",
    );
  });

  it("refuses a signature over anything other than the stored action", async () => {
    const { service, order, exchangeCalls } = await prepared();
    const tampered = order.actions.map((item) => ({ ...item, nonce: item.nonce + 99 }));
    await expect(
      service.execute({
        subject: "privy:user",
        orderId: order.orderId,
        signatures: await sign(tampered),
      }),
    ).rejects.toThrow(/Enable trading/);
    expect(exchangeCalls).toHaveLength(0);
  });

  it("turns venue rejections into plain explanations", async () => {
    const { service, order } = await prepared({
      exchange: (body) =>
        body.action.type === "order"
          ? {
              status: "ok",
              response: {
                type: "order",
                data: {
                  statuses: [
                    { error: "Order could not immediately match against any resting orders." },
                  ],
                },
              },
            }
          : undefined,
    });
    await expect(
      service.execute({
        subject: "privy:user",
        orderId: order.orderId,
        signatures: await sign(order.actions),
      }),
    ).rejects.toThrow(/market moved before your order filled\. Nothing was traded/);
  });

  it("marks the order unknown when the submission times out, for reconciliation to settle", async () => {
    const { service, order } = await prepared({ exchangeError: new Error("socket hang up") });
    await expect(
      service.execute({
        subject: "privy:user",
        orderId: order.orderId,
        signatures: await sign(order.actions),
      }),
    ).resolves.toMatchObject({ status: "unknown" });
    expect(db.updateMarketLiveOrder).toHaveBeenCalledWith(
      "postgres://test",
      order.orderId,
      "unknown",
    );
  });

  it("refuses an expired or already-submitted order", async () => {
    const { service } = venue();
    db.claimHyperliquidOrder.mockResolvedValue(null);
    await expect(
      service.execute({ subject: "privy:user", orderId: crypto.randomUUID(), signatures: [] }),
    ).rejects.toThrow(/expired/);
  });
});

describe("Solana USDC deposits into Hyperliquid", () => {
  const user = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  const quote = (instruction: Record<string, unknown>) => ({
    steps: [
      {
        id: "deposit",
        kind: "transaction",
        requestId: `0x${"c".repeat(64)}`,
        items: [{ data: { instructions: [instruction], addressLookupTableAddresses: [] } }],
      },
    ],
    fees: { gas: { amountUsd: "0.0002" }, relayer: { amountUsd: "0.03" } },
    details: {
      timeEstimate: 1,
      currencyOut: {
        amount: "2497437200",
        minimumAmount: "2447488400",
        currency: { address: "0x00000000000000000000000000000000", decimals: 8 },
      },
    },
  });
  const relayIx = {
    programId: "99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2",
    data: "0b9c60da",
    keys: [{ pubkey: user, isSigner: true, isWritable: true }],
  };

  it("accepts only Relay's deposit program with the user as the sole signer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(quote(relayIx))));
    const deposit = await new RelayBridgeClient().solanaDepositQuote({
      user,
      recipient: USER,
      amountUsdc: "25",
    });
    // Hyperliquid's USDC has 8 decimals; amounts are reported with 6.
    expect(deposit).toMatchObject({
      outputAmountUsdc: "24.974372",
      minimumOutputUsdc: "24.474884",
    });

    for (const instruction of [
      { ...relayIx, programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
      {
        ...relayIx,
        keys: [
          ...relayIx.keys,
          {
            pubkey: "So11111111111111111111111111111111111111112",
            isSigner: true,
            isWritable: false,
          },
        ],
      },
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(quote(instruction))));
      await expect(
        new RelayBridgeClient().solanaDepositQuote({ user, recipient: USER, amountUsdc: "25" }),
      ).rejects.toThrow(/cannot verify/);
    }
  });
});

describe("Hyperliquid limit orders, spot and builder fees", () => {
  it("places a limit order at the trader's price and records it as open while it rests", async () => {
    const { service } = venue({
      exchange: (body) =>
        body.action.type === "order"
          ? {
              status: "ok",
              response: { type: "order", data: { statuses: [{ resting: { oid: 77 } }] } },
            }
          : undefined,
    });
    const order = await service.prepare({
      ...open,
      orderType: "limit",
      limitPx: 76000,
      postOnly: true,
    });
    const entry = (order.actions.at(-1)?.action as { orders: Array<Record<string, unknown>> })
      .orders[0];
    // Post-only limits use Hyperliquid's add-liquidity-only time in force.
    expect(entry).toMatchObject({ p: "76000", t: { limit: { tif: "Alo" } } });
    // Size comes from margin times leverage at the limit price, not the current mark.
    expect(order.size).toBe(
      new Decimal(500).div(76000).toDecimalPlaces(5, Decimal.ROUND_DOWN).toFixed(),
    );
    db.claimHyperliquidOrder.mockResolvedValue({
      id: order.orderId,
      accountAddress: USER,
      preparedActions: order.actions,
    });
    const result = await service.execute({
      subject: "privy:user",
      orderId: order.orderId,
      signatures: await sign(order.actions),
    });
    expect(result).toMatchObject({ status: "open", oid: 77 });
    expect(db.updateMarketLiveOrder).toHaveBeenCalledWith(
      "postgres://test",
      order.orderId,
      "open",
      "77",
    );
  });

  it("sizes spot buys in USDC against the spot balance, under the spot asset ID", async () => {
    const { service } = venue();
    const order = await service.prepare({
      kind: "spot",
      subject: "privy:user",
      tenantId: "personal:user",
      user: USER,
      coin: "BTC",
      side: "buy",
      amountUsd: 100,
    });
    const entry = (order.actions[0]?.action as { orders: Array<Record<string, unknown>> })
      .orders[0];
    expect(order).toMatchObject({ market: "spot", symbol: "BTC", coin: "@142" });
    expect(entry).toMatchObject({ a: 10_142, b: true, r: false });
    expect(order.actions.map((item) => item.action.type)).toEqual(["order"]);
    expect(db.prepareHyperliquidOrder).toHaveBeenCalledWith(
      "postgres://test",
      expect.objectContaining({ marketType: "spot", symbol: "BTC/USDC" }),
    );
    await expect(
      venue({ spotBalances: [{ coin: "USDC", total: "20" }] }).service.prepare({
        kind: "spot",
        subject: "privy:user",
        tenantId: "personal:user",
        user: USER,
        coin: "BTC",
        side: "buy",
        amountUsd: 100,
      }),
    ).rejects.toThrow(/\$20.00 USDC in your Hyperliquid spot balance/);
  });

  it("adds Sisera's builder fee to orders: 0.1% on perps and 1% on spot", async () => {
    const perp = await venue({ builder: true }).service.prepare(open);
    expect(perp.actions.at(-1)?.action).toMatchObject({ builder: { b: BUILDER, f: 100 } });
    expect(perp.builderFeeUsd).toBe("0.50");
    const spot = await venue({ builder: true }).service.prepare({
      kind: "spot",
      subject: "privy:user",
      tenantId: "personal:user",
      user: USER,
      coin: "BTC",
      side: "buy",
      amountUsd: 100,
    });
    expect(spot.actions[0]?.action).toMatchObject({ builder: { b: BUILDER, f: 1000 } });
  });

  it("asks for the builder fee approval instead of sending an order Hyperliquid would reject", async () => {
    const error = await venue({ builder: true, approvedBuilderFee: 0 })
      .service.prepare(open)
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      statusCode: 428,
      code: "builder_fee_approval_required",
      details: { builder: BUILDER, maxFeeRate: "1%" },
    });
    expect(db.prepareHyperliquidOrder).not.toHaveBeenCalled();
  });

  it("settles a resting order that filled or was cancelled after it was placed", async () => {
    const resting = {
      id: crypto.randomUUID(),
      clientOrderId: "0xabc",
      accountAddress: USER,
      symbol: "BTCUSDC",
      quantity: "0.0062",
      status: "open",
      updatedAt: new Date(),
    };
    db.listUnreconciledHyperliquidOrders.mockResolvedValue([resting]);
    await venue({
      orderStatus: {
        status: "order",
        order: { status: "filled", order: { oid: 42, origSz: "0.0062", sz: "0" } },
      },
    }).service.reconcile("privy:user");
    expect(db.updateMarketLiveOrder).toHaveBeenCalledWith(
      "postgres://test",
      resting.id,
      "filled",
      "42",
      {
        priceUsd: "80655",
        feeUsd: "0.22",
        quantity: "0.0062",
      },
    );
    db.updateMarketLiveOrder.mockReset();
    await venue({
      orderStatus: {
        status: "order",
        order: { status: "canceled", order: { oid: 43, origSz: "0.0062", sz: "0.0062" } },
      },
    }).service.reconcile("privy:user");
    expect(db.updateMarketLiveOrder).toHaveBeenCalledWith(
      "postgres://test",
      resting.id,
      "cancelled",
      "43",
    );
  });
});
