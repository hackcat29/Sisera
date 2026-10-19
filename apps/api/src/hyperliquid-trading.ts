import { OrderRequest, UpdateLeverageRequest } from "@nktkas/hyperliquid/api/exchange";
import { canonicalize, createL1ActionHash } from "@nktkas/hyperliquid/signing";
import { formatPrice, formatSize } from "@nktkas/hyperliquid/utils";
import {
  claimHyperliquidOrder,
  expireHyperliquidOrders,
  listUnreconciledHyperliquidOrders,
  prepareHyperliquidOrder,
  updateMarketLiveOrder,
} from "@sisera/db";
import { type Instrument, MarketSnapshot, OrderIntent } from "@sisera/domain";
import { evaluatePreTradeRisk } from "@sisera/risk";
import Decimal from "decimal.js";
import { type Hex, recoverTypedDataAddress, serializeSignature } from "viem";
import { z } from "zod";
import { TradeRejection } from "./solana-trading.js";

const API = "https://api.hyperliquid.xyz";
const MIN_ORDER_USD = 10;
const ORDER_TTL_MS = 30_000;
/** Signed actions are rejected by Hyperliquid after this, so a stale signature cannot be replayed. */
const ACTION_TTL_MS = 60_000;
const DEFAULT_SLIPPAGE_BPS = 80;

const Address = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const Meta = z.tuple([
  z.object({
    universe: z.array(
      z.object({
        name: z.string(),
        szDecimals: z.number().int(),
        maxLeverage: z.number().int(),
        onlyIsolated: z.boolean().optional(),
        isDelisted: z.boolean().optional(),
      }),
    ),
  }),
  z.array(z.object({ markPx: z.string().nullable(), midPx: z.string().nullable().optional() })),
]);
const Position = z.object({
  position: z.object({
    coin: z.string(),
    szi: z.string(),
    entryPx: z.string().nullable().optional(),
    leverage: z.object({ type: z.enum(["cross", "isolated"]), value: z.number() }),
    liquidationPx: z.string().nullable().optional(),
  }),
});
const ClearinghouseState = z.object({
  marginSummary: z.object({ accountValue: z.string(), totalNtlPos: z.string() }),
  withdrawable: z.string(),
  assetPositions: z.array(Position),
});
const Agents = z.array(
  z.object({ address: Address, name: z.string(), validUntil: z.number().nullable().optional() }),
);
const Signature = z.object({
  r: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  s: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  v: z.union([z.literal(27), z.literal(28)]),
});
export type HyperliquidSignature = z.infer<typeof Signature>;
const ExchangeResponse = z.union([
  z.object({ status: z.literal("ok"), response: z.unknown() }),
  z.object({ status: z.literal("err"), response: z.string() }),
]);
const OrderStatuses = z.object({
  type: z.literal("order"),
  data: z.object({ statuses: z.array(z.unknown()) }),
});
const FilledStatus = z.object({
  filled: z.object({ totalSz: z.string(), avgPx: z.string(), oid: z.number() }),
});
const ErrorStatus = z.object({ error: z.string() });
const Fill = z.object({ oid: z.number(), fee: z.string(), sz: z.string(), px: z.string() });

export type PreparedAction = {
  action: Record<string, unknown>;
  nonce: number;
  expiresAfter: number;
};

type Market = {
  asset: number;
  coin: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated: boolean;
  markPx: Decimal;
};

/** Hyperliquid's own user-facing messages for common rejections, rewritten for traders. */
function explainVenueError(message: string) {
  if (/does not exist/i.test(message))
    return "Trading isn't enabled for this account yet. Enable trading, then try again.";
  if (/insufficient margin/i.test(message))
    return "Not enough available margin. Deposit USDC or lower the amount.";
  if (/could not immediately match/i.test(message))
    return "The market moved before your order filled. Nothing was traded; try again.";
  if (/minimum value/i.test(message)) return "Orders must be at least $10 in size.";
  if (/reduce only/i.test(message)) return "This position has already been closed.";
  return `Hyperliquid rejected the order: ${message}`;
}

/** Estimated liquidation price for a new position, assuming its margin is isolated. */
export function estimateLiquidationPrice(
  entry: Decimal,
  leverage: number,
  maxLeverage: number,
  isLong: boolean,
) {
  const maintenance = new Decimal(1).div(2 * maxLeverage);
  const distance = new Decimal(1).div(leverage).minus(maintenance);
  if (distance.lte(0)) return null;
  return isLong ? entry.mul(new Decimal(1).minus(distance)) : entry.mul(distance.plus(1));
}

/**
 * Live Hyperliquid perpetual orders on the user's own account.
 *
 * Sisera prices, sizes and risk-checks each order, stores the exact actions, and returns them for
 * the user's Hyperliquid trading key (an agent wallet the user approved, which can trade but not
 * withdraw) to sign. On execution Sisera verifies the signer is one of the account's approved
 * agents and submits only the stored actions, so nothing that skipped the checks reaches the venue.
 */
export class HyperliquidTradingService {
  private metaCache: { until: number; value: Promise<Map<string, Market>> } | null = null;

  constructor(
    private readonly options: {
      databaseUrl: string | undefined;
      maxLeverage: number;
      maxNotionalUsd: number;
      fetcher?: typeof fetch;
      now?: () => number;
    },
  ) {}

  private get fetcher() {
    return this.options.fetcher ?? globalThis.fetch;
  }

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  private async post(path: "info" | "exchange", body: unknown, timeoutMs = 8000) {
    const response = await this.fetcher(`${API}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new TradeRejection(
        path === "exchange" && text ? explainVenueError(text) : "Hyperliquid is unavailable.",
        path === "exchange" && response.status < 500 ? 422 : 503,
      );
    }
    return response.json() as Promise<unknown>;
  }

  private markets() {
    if (this.metaCache && this.metaCache.until > this.now()) return this.metaCache.value;
    const value = this.post("info", { type: "metaAndAssetCtxs" }).then((payload) => {
      const [meta, contexts] = Meta.parse(payload);
      const markets = new Map<string, Market>();
      meta.universe.forEach((asset, index) => {
        const markPx = contexts[index]?.markPx;
        if (asset.isDelisted || !markPx || !(Number(markPx) > 0)) return;
        markets.set(asset.name, {
          asset: index,
          coin: asset.name,
          szDecimals: asset.szDecimals,
          maxLeverage: asset.maxLeverage,
          onlyIsolated: Boolean(asset.onlyIsolated),
          markPx: new Decimal(markPx),
        });
      });
      return markets;
    });
    this.metaCache = { until: this.now() + 3000, value };
    value.catch(() => {
      this.metaCache = null;
    });
    return value;
  }

  private async market(coin: string) {
    const market = (await this.markets()).get(coin);
    if (!market) throw new TradeRejection(`${coin} perpetuals are not available to trade.`);
    return market;
  }

  async account(user: string) {
    return ClearinghouseState.parse(
      await this.post("info", { type: "clearinghouseState", user: Address.parse(user) }),
    );
  }

  private async takerFeeRate(user: string) {
    const payload = await this.post("info", { type: "userFees", user }).catch(() => null);
    const rate = Number((payload as { userCrossRate?: string } | null)?.userCrossRate);
    return Number.isFinite(rate) && rate >= 0 && rate < 0.01 ? rate : 0.00045;
  }

  /**
   * Prices, sizes and risk-checks an order, and stores the exact actions for signing. `open`
   * sizes a new position from margin and leverage; `close` reduces an existing position.
   */
  async prepare(
    input: {
      subject: string;
      tenantId: string;
      user: string;
      coin: string;
      slippageBps?: number | undefined;
    } & (
      | {
          kind: "open";
          side: "buy" | "sell";
          marginUsd: number;
          leverage: number;
          isCross: boolean;
          takeProfitPx?: number | undefined;
          stopLossPx?: number | undefined;
        }
      | { kind: "close"; fraction: number }
    ),
  ) {
    if (!this.options.databaseUrl)
      throw new TradeRejection("Perpetual trading is not available right now.", 503);
    const user = Address.parse(input.user).toLowerCase();
    const [market, account] = await Promise.all([this.market(input.coin), this.account(user)]);
    const position = account.assetPositions.find((item) => item.position.coin === market.coin);
    const positionSize = new Decimal(position?.position.szi ?? "0");
    const slippage = new Decimal(input.slippageBps ?? DEFAULT_SLIPPAGE_BPS).div(10_000);
    const mark = market.markPx;
    const accountValue = new Decimal(account.marginSummary.accountValue);
    const available = new Decimal(account.withdrawable);

    let side: "buy" | "sell";
    let size: string;
    let leverage: number;
    let isCross: boolean;
    let marginUsd: Decimal | null = null;
    let reduceOnly = false;
    let setLeverage = false;
    if (input.kind === "close") {
      if (positionSize.isZero())
        throw new TradeRejection(`You have no open ${market.coin} position.`);
      if (!(input.fraction > 0 && input.fraction <= 1))
        throw new TradeRejection("Choose how much of the position to close.");
      side = positionSize.isPositive() ? "sell" : "buy";
      reduceOnly = true;
      leverage = position?.position.leverage.value ?? 1;
      isCross = position?.position.leverage.type !== "isolated";
      try {
        size = formatSize(positionSize.abs().mul(input.fraction).toFixed(), market.szDecimals);
      } catch {
        throw new TradeRejection("This amount is smaller than the minimum position size.");
      }
    } else {
      side = input.side;
      if (!Number.isInteger(input.leverage) || input.leverage < 1)
        throw new TradeRejection("Choose a whole-number leverage of 1x or more.");
      const maxLeverage = Math.min(market.maxLeverage, this.options.maxLeverage);
      if (input.leverage > maxLeverage)
        throw new TradeRejection(`${market.coin} allows up to ${maxLeverage}x leverage.`);
      if (market.onlyIsolated && input.isCross)
        throw new TradeRejection(`${market.coin} supports isolated margin only.`);
      // Hyperliquid sets leverage per coin. The requested leverage is applied (to any open
      // position too), but an open position cannot switch between cross and isolated margin.
      const positionCross = position ? position.position.leverage.type === "cross" : null;
      if (positionCross != null && positionCross !== input.isCross)
        throw new TradeRejection(
          `Your ${market.coin} position uses ${positionCross ? "cross" : "isolated"} margin. Close it to switch modes.`,
        );
      leverage = input.leverage;
      isCross = input.isCross;
      setLeverage = !position || position.position.leverage.value !== input.leverage;
      marginUsd = new Decimal(input.marginUsd);
      if (!marginUsd.isFinite() || marginUsd.lte(0))
        throw new TradeRejection("Enter the margin to use.");
      if (marginUsd.gt(available))
        throw new TradeRejection(
          `You have $${available.toFixed(2)} available. Deposit USDC or lower the amount.`,
        );
      const notional = marginUsd.mul(leverage);
      if (notional.lt(MIN_ORDER_USD))
        throw new TradeRejection(
          `Position size must be at least $${MIN_ORDER_USD}. Raise the margin or leverage.`,
        );
      if (notional.gt(this.options.maxNotionalUsd))
        throw new TradeRejection(
          `Positions are limited to $${this.options.maxNotionalUsd.toLocaleString("en-US")} per order.`,
        );
      try {
        size = formatSize(notional.div(mark).toFixed(), market.szDecimals);
      } catch {
        throw new TradeRejection("This amount is smaller than the minimum position size.");
      }
      const isLong = side === "buy";
      for (const [label, price, wantAbove] of [
        ["Take profit", input.takeProfitPx, isLong],
        ["Stop loss", input.stopLossPx, !isLong],
      ] as const) {
        if (price == null) continue;
        if (!(price > 0) || (wantAbove ? price <= mark.toNumber() : price >= mark.toNumber()))
          throw new TradeRejection(
            `${label} must be ${wantAbove ? "above" : "below"} the current price for a ${isLong ? "long" : "short"}.`,
          );
      }
    }

    const isBuy = side === "buy";
    const notional = new Decimal(size).mul(mark);
    if (!reduceOnly && notional.lt(MIN_ORDER_USD))
      throw new TradeRejection(`Position size must be at least $${MIN_ORDER_USD}.`);
    const limitPx = formatPrice(
      mark.mul(isBuy ? slippage.plus(1) : new Decimal(1).minus(slippage)).toFixed(),
      market.szDecimals,
    );

    const instrument: Instrument = {
      id: `hyperliquid:${market.coin}:perpetual`,
      venue: "hyperliquid",
      venueSymbol: market.coin,
      displaySymbol: `${market.coin}-PERP`,
      assetClass: "crypto",
      type: "perpetual",
      baseAsset: market.coin,
      quoteAsset: "USDC",
      priceIncrement: "0.000001",
      quantityIncrement: new Decimal(10).pow(-market.szDecimals).toFixed(),
      contractMultiplier: "1",
      status: "active",
    };
    const observedAt = new Date(this.now()).toISOString();
    const intent = OrderIntent.parse({
      clientOrderId: crypto.randomUUID(),
      portfolioId: `hyperliquid:${user}`,
      accountId: user,
      instrumentId: instrument.id,
      side,
      type: "market",
      quantity: size,
      timeInForce: "ioc",
      reduceOnly,
      mode: "live",
      submittedBy: input.subject,
      correlationId: crypto.randomUUID(),
    });
    const positionNotional = positionSize.mul(mark);
    const decision = evaluatePreTradeRisk({
      order: intent,
      instrument,
      quote: MarketSnapshot.parse({
        instrumentId: instrument.id,
        bid: mark.toFixed(),
        ask: mark.toFixed(),
        last: mark.toFixed(),
        quality: {
          status: "live",
          source: "hyperliquid-mark",
          observedAt,
          receivedAt: observedAt,
          latencyMs: 0,
        },
      }),
      portfolio: {
        // Leverage is measured against account equity, as Hyperliquid margins it.
        nav: Decimal.max(accountValue, 0).toFixed(),
        grossExposure: reduceOnly ? "0" : account.marginSummary.totalNtlPos,
        netExposure: reduceOnly ? "0" : positionNotional.toFixed(),
        dailyPnl: "0",
        existingInstrumentExposure: positionNotional.toFixed(),
      },
      limits: {
        // Closing must always be possible, even for a position larger than today's limits.
        maxOrderNotional: reduceOnly
          ? String(Number.MAX_SAFE_INTEGER)
          : String(this.options.maxNotionalUsd),
        maxGrossExposure: reduceOnly
          ? String(Number.MAX_SAFE_INTEGER)
          : Decimal.max(accountValue, 0).mul(this.options.maxLeverage).toFixed(),
        maxNetExposure: String(Number.MAX_SAFE_INTEGER),
        maxPositionNotional: String(Number.MAX_SAFE_INTEGER),
        maxDailyLoss: String(Number.MAX_SAFE_INTEGER),
        maxLeverage: reduceOnly
          ? String(Number.MAX_SAFE_INTEGER)
          : String(this.options.maxLeverage),
        maxQuoteAgeMs: 15_000,
        allowedAssetClasses: ["crypto"],
      },
      now: new Date(this.now()),
    });
    if (decision.outcome !== "approved")
      throw new TradeRejection(
        decision.reasons.some((reason) => reason.code === "LEVERAGE_LIMIT")
          ? `Your account would exceed ${this.options.maxLeverage}x total leverage. Lower the size or add margin.`
          : "This order exceeds your account's risk limits.",
      );

    const cloid =
      `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex")}` as const;
    const base = this.now();
    const expiresAfter = base + ACTION_TTL_MS;
    const actions: PreparedAction[] = [];
    if (setLeverage)
      actions.push({
        action: canonicalize(UpdateLeverageRequest.entries.action, {
          type: "updateLeverage",
          asset: market.asset,
          isCross,
          leverage,
        }),
        nonce: base,
        expiresAfter,
      });
    const entry = {
      a: market.asset,
      b: isBuy,
      p: limitPx,
      s: size,
      r: reduceOnly,
      t: { limit: { tif: "Ioc" as const } },
      c: cloid,
    };
    const triggers =
      input.kind === "open"
        ? (
            [
              ["tp", input.takeProfitPx],
              ["sl", input.stopLossPx],
            ] as const
          ).flatMap(([tpsl, price]) => {
            if (price == null) return [];
            const triggerPx = formatPrice(String(price), market.szDecimals);
            // A triggered market exit may fill up to 10% away from its trigger.
            const worst = new Decimal(triggerPx).mul(isBuy ? 0.9 : 1.1);
            return [
              {
                a: market.asset,
                b: !isBuy,
                p: formatPrice(worst.toFixed(), market.szDecimals),
                s: size,
                r: true,
                t: { trigger: { isMarket: true, triggerPx, tpsl } },
              },
            ];
          })
        : [];
    actions.push({
      action: canonicalize(OrderRequest.entries.action, {
        type: "order",
        orders: [entry, ...triggers],
        grouping: triggers.length ? "normalTpsl" : "na",
      }),
      nonce: base + 1,
      expiresAfter,
    });

    const id = crypto.randomUUID();
    await prepareHyperliquidOrder(this.options.databaseUrl, {
      id,
      tenantId: input.tenantId,
      subject: input.subject,
      symbol: `${market.coin}USDC`,
      side,
      quantity: size,
      clientOrderId: cloid,
      accountAddress: user,
      preparedActions: actions,
      expiresAt: new Date(base + ORDER_TTL_MS),
      leverage: String(leverage),
      marginUsd: marginUsd?.toFixed() ?? null,
      reduceOnly,
    });
    const feeRate = await this.takerFeeRate(user);
    const liquidationPx = reduceOnly
      ? null
      : estimateLiquidationPrice(mark, leverage, market.maxLeverage, isBuy);
    return {
      orderId: id,
      actions,
      coin: market.coin,
      side,
      size,
      reduceOnly,
      leverage,
      isCross,
      markPx: mark.toFixed(),
      limitPx,
      notionalUsd: notional.toFixed(2),
      marginUsd: marginUsd?.toFixed(2) ?? null,
      estimatedFeeUsd: notional.mul(feeRate).toFixed(2),
      liquidationPx: liquidationPx ? formatPrice(liquidationPx.toFixed(), market.szDecimals) : null,
      expiresAt: new Date(base + ORDER_TTL_MS).toISOString(),
    };
  }

  /** The addresses allowed to trade for `user`: the account itself and its unexpired agents. */
  private async approvedSigners(user: string) {
    const agents = Agents.parse(await this.post("info", { type: "extraAgents", user }));
    const now = this.now();
    return new Set([
      user.toLowerCase(),
      ...agents
        .filter((agent) => agent.validUntil == null || agent.validUntil > now)
        .map((agent) => agent.address.toLowerCase()),
    ]);
  }

  /** Verifies each signature is over the stored action, then submits the actions in order. */
  async execute(input: { subject: string; orderId: string; signatures: unknown[] }) {
    if (!this.options.databaseUrl)
      throw new TradeRejection("Perpetual trading is not available right now.", 503);
    const databaseUrl = this.options.databaseUrl;
    const order = await claimHyperliquidOrder(databaseUrl, input.orderId, input.subject);
    if (!order) throw new TradeRejection("This order expired. Review it again for a fresh price.");
    const actions = z
      .array(
        z.object({
          action: z.record(z.unknown()),
          nonce: z.number().int(),
          expiresAfter: z.number().int(),
        }),
      )
      .parse(order.preparedActions);
    const reject = async (message: string, status = 422) => {
      await updateMarketLiveOrder(databaseUrl, order.id, "rejected");
      throw new TradeRejection(message, status);
    };
    const signatures = z.array(Signature).safeParse(input.signatures);
    if (!signatures.success || signatures.data.length !== actions.length)
      return reject("The order was not signed. Review it again.");
    let allowed: Set<string>;
    try {
      allowed = await this.approvedSigners(order.accountAddress);
    } catch {
      return reject("Hyperliquid is unavailable. Nothing was traded; try again shortly.", 503);
    }
    for (const [index, prepared] of actions.entries()) {
      const signature = signatures.data[index] as HyperliquidSignature;
      const signer = await recoverTypedDataAddress({
        domain: {
          name: "Exchange",
          version: "1",
          chainId: 1337,
          verifyingContract: "0x0000000000000000000000000000000000000000",
        },
        types: {
          Agent: [
            { name: "source", type: "string" },
            { name: "connectionId", type: "bytes32" },
          ],
        },
        primaryType: "Agent",
        message: {
          source: "a",
          connectionId: createL1ActionHash({
            action: prepared.action,
            nonce: prepared.nonce,
            expiresAfter: prepared.expiresAfter,
          }),
        },
        signature: serializeSignature({
          r: signature.r as Hex,
          s: signature.s as Hex,
          v: BigInt(signature.v),
        }),
      }).catch(() => null);
      if (!signer || !allowed.has(signer.toLowerCase()))
        return reject("Trading isn't enabled on this device. Enable trading, then try again.", 403);
    }

    for (const [index, prepared] of actions.entries()) {
      const isOrder = prepared.action.type === "order";
      let payload: unknown;
      try {
        payload = await this.post(
          "exchange",
          { ...prepared, signature: signatures.data[index] },
          isOrder ? 15_000 : 8000,
        );
      } catch (error) {
        if (!isOrder && error instanceof TradeRejection)
          return reject(error.message, error.statusCode);
        if (error instanceof TradeRejection && error.statusCode === 422)
          return reject(error.message);
        // The order may have reached the venue; reconciliation settles it by client order ID.
        await updateMarketLiveOrder(databaseUrl, order.id, "unknown");
        return { orderId: order.id, status: "unknown" as const };
      }
      const response = ExchangeResponse.safeParse(payload);
      if (!response.success) {
        if (!isOrder) return reject("Hyperliquid returned an unexpected response.", 503);
        await updateMarketLiveOrder(databaseUrl, order.id, "unknown");
        return { orderId: order.id, status: "unknown" as const };
      }
      if (response.data.status === "err") return reject(explainVenueError(response.data.response));
      if (!isOrder) continue;
      const statuses = OrderStatuses.safeParse(response.data.response);
      const first = statuses.success ? statuses.data.data.statuses[0] : undefined;
      const filled = FilledStatus.safeParse(first);
      if (filled.success) {
        const fee = await this.feeFor(order.accountAddress, filled.data.filled.oid);
        await updateMarketLiveOrder(
          databaseUrl,
          order.id,
          "filled",
          String(filled.data.filled.oid),
          {
            priceUsd: filled.data.filled.avgPx,
            feeUsd: fee,
            quantity: filled.data.filled.totalSz,
          },
        );
        return {
          orderId: order.id,
          status: "filled" as const,
          filledSize: filled.data.filled.totalSz,
          averagePx: filled.data.filled.avgPx,
          feeUsd: fee,
        };
      }
      const error = ErrorStatus.safeParse(first);
      return reject(
        error.success ? explainVenueError(error.data.error) : "The order did not fill.",
      );
    }
    return reject("The order was not placed.");
  }

  private async feeFor(user: string, oid: number) {
    try {
      const fills = z
        .array(Fill)
        .parse(await this.post("info", { type: "userFills", user }))
        .filter((fill) => fill.oid === oid);
      return fills.reduce((sum, fill) => sum.plus(fill.fee), new Decimal(0)).toFixed();
    } catch {
      return "0";
    }
  }

  /** Settles orders whose outcome was unknown at submission, using their client order IDs. */
  async reconcile(subject: string) {
    const databaseUrl = this.options.databaseUrl;
    if (!databaseUrl) return;
    await expireHyperliquidOrders(databaseUrl, subject);
    for (const order of await listUnreconciledHyperliquidOrders(databaseUrl, subject)) {
      const payload = (await this.post("info", {
        type: "orderStatus",
        user: order.accountAddress,
        oid: order.clientOrderId,
      }).catch(() => null)) as {
        status?: string;
        order?: { status?: string; order?: { oid?: number } };
      } | null;
      if (!payload) continue;
      const oid = payload.order?.order?.oid;
      if (payload.status === "order" && payload.order?.status === "filled" && oid != null) {
        const fills = z
          .array(Fill)
          .parse(await this.post("info", { type: "userFills", user: order.accountAddress }))
          .filter((fill) => fill.oid === oid);
        const size = fills.reduce((sum, fill) => sum.plus(fill.sz), new Decimal(0));
        if (size.lte(0)) continue;
        const average = fills
          .reduce((sum, fill) => sum.plus(new Decimal(fill.px).mul(fill.sz)), new Decimal(0))
          .div(size);
        await updateMarketLiveOrder(databaseUrl, order.id, "filled", String(oid), {
          priceUsd: average.toFixed(),
          feeUsd: fills.reduce((sum, fill) => sum.plus(fill.fee), new Decimal(0)).toFixed(),
          quantity: size.toFixed(),
        });
      } else if (
        payload.status === "unknownOid" ||
        (payload.status === "order" &&
          payload.order?.status != null &&
          payload.order.status !== "open" &&
          payload.order.status !== "filled")
      ) {
        await updateMarketLiveOrder(databaseUrl, order.id, "rejected");
      }
    }
  }
}
