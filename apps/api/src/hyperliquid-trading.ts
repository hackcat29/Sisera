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
/** Spot orders address pairs as 10000 plus the pair's index. */
const SPOT_ASSET_OFFSET = 10_000;
/** An order whose outcome is still unknown after this is treated as never placed. */
const UNKNOWN_ORDER_GRACE_MS = 120_000;

const Address = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const PerpMeta = z.tuple([
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
  z.array(z.object({ markPx: z.string().nullable() })),
]);
const SpotMeta = z.tuple([
  z.object({
    tokens: z.array(
      z.object({
        name: z.string(),
        szDecimals: z.number().int(),
        index: z.number().int(),
        fullName: z.string().nullable().optional(),
      }),
    ),
    universe: z.array(
      z.object({
        name: z.string(),
        index: z.number().int(),
        tokens: z.tuple([z.number(), z.number()]),
      }),
    ),
  }),
  z.array(
    z.object({ coin: z.string(), markPx: z.string().nullable(), dayNtlVlm: z.string().optional() }),
  ),
]);
const Position = z.object({
  position: z.object({
    coin: z.string(),
    szi: z.string(),
    leverage: z.object({ type: z.enum(["cross", "isolated"]), value: z.number() }),
  }),
});
const ClearinghouseState = z.object({
  marginSummary: z.object({ accountValue: z.string(), totalNtlPos: z.string() }),
  withdrawable: z.string(),
  assetPositions: z.array(Position),
});
const SpotState = z.object({
  balances: z.array(z.object({ coin: z.string(), total: z.string(), hold: z.string() })),
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
const RestingStatus = z.object({ resting: z.object({ oid: z.number() }) });
const ErrorStatus = z.object({ error: z.string() });
const Fill = z.object({
  oid: z.number(),
  fee: z.string(),
  builderFee: z.string().optional(),
  sz: z.string(),
  px: z.string(),
});
const OrderStatus = z.union([
  z.object({
    status: z.literal("order"),
    order: z.object({
      status: z.string(),
      statusTimestamp: z.number().optional(),
      order: z.object({ oid: z.number(), origSz: z.string(), sz: z.string() }),
    }),
  }),
  z.object({ status: z.literal("unknownOid") }),
]);

export type PreparedAction = {
  action: Record<string, unknown>;
  nonce: number;
  expiresAfter: number;
};

export type MarketKind = "perp" | "spot";
type Market = {
  kind: MarketKind;
  /** The asset ID used in orders. */
  asset: number;
  /** The coin name used by Hyperliquid's info API: "BTC" for perps, "@142" for spot pairs. */
  coin: string;
  /** What traders call it: "BTC" for perps, "BTC" (from UBTC) for spot. */
  symbol: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated: boolean;
  markPx: Decimal;
  /** Spot only: the token traded against USDC, as named in balances. */
  baseToken?: string;
};

type Common = {
  subject: string;
  tenantId: string;
  user: string;
  coin: string;
  slippageBps?: number | undefined;
};
type Pricing = {
  orderType?: "market" | "limit" | undefined;
  limitPx?: number | undefined;
  /** Post-only: a limit order that is cancelled rather than filling as a taker. */
  postOnly?: boolean | undefined;
};
export type PrepareInput = Common &
  (
    | (Pricing & {
        kind: "open";
        side: "buy" | "sell";
        marginUsd: number;
        leverage: number;
        isCross: boolean;
        takeProfitPx?: number | undefined;
        stopLossPx?: number | undefined;
      })
    | { kind: "close"; fraction: number }
    | (Pricing & {
        kind: "spot";
        side: "buy" | "sell";
        /** Order value in USDC, or `size` in the base token. */
        amountUsd?: number | undefined;
        size?: string | undefined;
      })
  );

/** Hyperliquid's own user-facing messages for common rejections, rewritten for traders. */
function explainVenueError(message: string) {
  if (/does not exist/i.test(message))
    return "Trading isn't enabled for this account yet. Enable trading, then try again.";
  if (/builder fee has not been approved|builder fee/i.test(message))
    return "Approve Sisera's trading fee, then try again.";
  if (/insufficient margin/i.test(message))
    return "Not enough available margin. Deposit USDC or lower the amount.";
  if (/insufficient spot balance|insufficient balance/i.test(message))
    return "Not enough balance in your Hyperliquid spot account.";
  if (/could not immediately match/i.test(message))
    return "The market moved before your order filled. Nothing was traded; try again.";
  if (/post only|would have immediately matched/i.test(message))
    return "A post-only order can't fill immediately. Move your price away from the market.";
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

/** "UBTC" (Unit Bitcoin) trades as BTC; other spot tokens keep their own names. */
function spotSymbol(token: { name: string; fullName?: string | null | undefined }) {
  return /^Unit /i.test(token.fullName ?? "") && /^U[A-Z0-9]{2,}$/.test(token.name)
    ? token.name.slice(1)
    : token.name;
}

const percent = (bps: number) => `${new Decimal(bps).div(100).toFixed()}%`;

/**
 * Live Hyperliquid perpetual and spot orders on the user's own account.
 *
 * Sisera prices, sizes and risk-checks each order, stores the exact actions, and returns them for
 * the user's Hyperliquid trading key (an agent wallet the user approved, which can trade but not
 * withdraw) to sign. On execution Sisera verifies the signer is one of the account's approved
 * agents and submits only the stored actions, so nothing that skipped the checks reaches the venue.
 * When a builder address is configured, orders carry Sisera's builder fee, which the user approves
 * once.
 */
export class HyperliquidTradingService {
  private metaCache: {
    until: number;
    value: Promise<{ perps: Map<string, Market>; spot: Map<string, Market> }>;
  } | null = null;

  constructor(
    private readonly options: {
      databaseUrl: string | undefined;
      maxLeverage: number;
      maxNotionalUsd: number;
      builder?: { address: string; perpBps: number; spotBps: number } | undefined;
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
    const value = Promise.all([
      this.post("info", { type: "metaAndAssetCtxs" }),
      this.post("info", { type: "spotMetaAndAssetCtxs" }),
    ]).then(([perpPayload, spotPayload]) => {
      const [perpMeta, perpContexts] = PerpMeta.parse(perpPayload);
      const perps = new Map<string, Market>();
      perpMeta.universe.forEach((asset, index) => {
        const markPx = perpContexts[index]?.markPx;
        if (asset.isDelisted || !markPx || !(Number(markPx) > 0)) return;
        perps.set(asset.name, {
          kind: "perp",
          asset: index,
          coin: asset.name,
          symbol: asset.name,
          szDecimals: asset.szDecimals,
          maxLeverage: asset.maxLeverage,
          onlyIsolated: Boolean(asset.onlyIsolated),
          markPx: new Decimal(markPx),
        });
      });
      const [spotMeta, spotContexts] = SpotMeta.parse(spotPayload);
      const tokens = new Map(spotMeta.tokens.map((token) => [token.index, token]));
      const contexts = new Map(spotContexts.map((context) => [context.coin, context]));
      const spot = new Map<string, Market>();
      for (const pair of spotMeta.universe) {
        const base = tokens.get(pair.tokens[0]);
        const quote = tokens.get(pair.tokens[1]);
        const markPx = contexts.get(pair.name)?.markPx;
        if (!base || quote?.name !== "USDC" || !markPx || !(Number(markPx) > 0)) continue;
        const market: Market = {
          kind: "spot",
          asset: SPOT_ASSET_OFFSET + pair.index,
          coin: pair.name,
          symbol: spotSymbol(base),
          szDecimals: base.szDecimals,
          maxLeverage: 1,
          onlyIsolated: false,
          markPx: new Decimal(markPx),
          baseToken: base.name,
        };
        spot.set(pair.name, market);
        // The most traded pair keeps the plain symbol when several tokens share a name.
        const existing = spot.get(market.symbol);
        const volume = (coin: string) => Number(contexts.get(coin)?.dayNtlVlm ?? 0);
        if (!existing || volume(pair.name) > volume(existing.coin)) spot.set(market.symbol, market);
      }
      return { perps, spot };
    });
    this.metaCache = { until: this.now() + 3000, value };
    value.catch(() => {
      this.metaCache = null;
    });
    return value;
  }

  private async market(kind: MarketKind, coin: string) {
    const markets = await this.markets();
    const market = (kind === "perp" ? markets.perps : markets.spot).get(coin);
    if (!market)
      throw new TradeRejection(
        `${coin} ${kind === "perp" ? "perpetuals are" : "is"} not available to trade.`,
      );
    return market;
  }

  /** The latest spot price for a token symbol such as "BTC" or "HYPE", for portfolio marks. */
  async spotMark(symbol: string) {
    const market = (await this.markets()).spot.get(symbol);
    return market
      ? { price: market.markPx.toNumber(), observedAt: new Date(this.now()).toISOString() }
      : null;
  }

  async account(user: string) {
    return ClearinghouseState.parse(
      await this.post("info", { type: "clearinghouseState", user: Address.parse(user) }),
    );
  }

  private async spotBalances(user: string) {
    const state = SpotState.parse(
      await this.post("info", { type: "spotClearinghouseState", user }),
    );
    return new Map(
      state.balances.map((balance) => [
        balance.coin,
        Decimal.max(new Decimal(balance.total).minus(balance.hold), 0),
      ]),
    );
  }

  private async takerFeeRate(user: string, kind: MarketKind) {
    const payload = (await this.post("info", { type: "userFees", user }).catch(() => null)) as {
      userCrossRate?: string;
      userSpotCrossRate?: string;
    } | null;
    const rate = Number(kind === "spot" ? payload?.userSpotCrossRate : payload?.userCrossRate);
    return Number.isFinite(rate) && rate >= 0 && rate < 0.01
      ? rate
      : kind === "spot"
        ? 0.0007
        : 0.00045;
  }

  /** Sisera's builder fee for a market, in Hyperliquid's units of tenths of a basis point. */
  private builderFee(kind: MarketKind) {
    const builder = this.options.builder;
    if (!builder) return null;
    const bps = kind === "spot" ? builder.spotBps : builder.perpBps;
    return bps > 0 ? { b: builder.address.toLowerCase(), f: Math.round(bps * 10), bps } : null;
  }

  /**
   * Orders with a builder fee are rejected by Hyperliquid until the user approves at least that
   * fee once. Checking first lets the client ask for the approval instead of failing the order.
   */
  private async requireBuilderApproval(user: string, fee: { b: string; f: number } | null) {
    if (!fee || !this.options.builder) return;
    const approved = Number(
      await this.post("info", { type: "maxBuilderFee", user, builder: fee.b }).catch(() => 0),
    );
    if (approved >= fee.f) return;
    const maxBps = Math.max(this.options.builder.perpBps, this.options.builder.spotBps);
    throw new TradeRejection(
      "Approve Sisera's trading fee once to place orders.",
      428,
      "builder_fee_approval_required",
      { builder: this.options.builder.address, maxFeeRate: percent(maxBps) },
    );
  }

  private orderPrice(
    market: Market,
    isBuy: boolean,
    pricing: Pricing,
    slippage: Decimal,
  ): { price: string; reference: Decimal; tif: "Ioc" | "Gtc" | "Alo" } {
    if (pricing.orderType === "limit") {
      if (!(Number(pricing.limitPx) > 0)) throw new TradeRejection("Enter a limit price.");
      let price: string;
      try {
        price = formatPrice(String(pricing.limitPx), market.szDecimals, market.kind);
      } catch {
        throw new TradeRejection("That limit price is too small for this market.");
      }
      return { price, reference: new Decimal(price), tif: pricing.postOnly ? "Alo" : "Gtc" };
    }
    const reference = market.markPx;
    const price = formatPrice(
      reference.mul(isBuy ? slippage.plus(1) : new Decimal(1).minus(slippage)).toFixed(),
      market.szDecimals,
      market.kind,
    );
    return { price, reference, tif: "Ioc" };
  }

  /**
   * Prices, sizes and risk-checks an order, and stores the exact actions for signing. `open`
   * sizes a new perp position from margin and leverage, `close` reduces an open perp position, and
   * `spot` buys or sells a spot token against USDC.
   */
  async prepare(input: PrepareInput) {
    if (!this.options.databaseUrl)
      throw new TradeRejection("Trading is not available right now.", 503);
    const user = Address.parse(input.user).toLowerCase();
    const kind: MarketKind = input.kind === "spot" ? "spot" : "perp";
    const market = await this.market(kind, input.coin);
    const slippage = new Decimal(input.slippageBps ?? DEFAULT_SLIPPAGE_BPS).div(10_000);
    const fee = this.builderFee(kind);

    let side: "buy" | "sell";
    let size: string;
    let leverage = 1;
    let isCross = true;
    let marginUsd: Decimal | null = null;
    let reduceOnly = false;
    let setLeverage = false;
    let pricing: Pricing = { orderType: "market" };
    let accountValue = new Decimal(0);
    let grossExposure = "0";
    let positionNotional = new Decimal(0);
    const toSize = (amount: Decimal) => {
      try {
        return formatSize(amount.toFixed(), market.szDecimals);
      } catch {
        throw new TradeRejection("This amount is smaller than the minimum order size.");
      }
    };

    if (input.kind === "spot") {
      side = input.side;
      pricing = input;
      const balances = await this.spotBalances(user);
      const { reference } = this.orderPrice(market, side === "buy", pricing, slippage);
      if (input.size != null) size = toSize(new Decimal(input.size));
      else if (Number(input.amountUsd) > 0)
        size = toSize(new Decimal(input.amountUsd ?? 0).div(reference));
      else throw new TradeRejection("Enter an amount.");
      const value = new Decimal(size).mul(reference);
      const usdc = balances.get("USDC") ?? new Decimal(0);
      const held = balances.get(market.baseToken ?? "") ?? new Decimal(0);
      const feeRate = new Decimal(fee?.bps ?? 0).div(10_000).plus(0.0007);
      if (side === "buy" && value.mul(feeRate.plus(1)).gt(usdc))
        throw new TradeRejection(
          `You have $${usdc.toFixed(2)} USDC in your Hyperliquid spot balance. Move USDC to spot or lower the amount.`,
          422,
          "insufficient_spot_balance",
        );
      if (side === "sell" && new Decimal(size).gt(held))
        throw new TradeRejection(`You hold ${held.toFixed()} ${market.symbol} on Hyperliquid.`);
      accountValue = usdc.plus(held.mul(market.markPx));
    } else {
      const account = await this.account(user);
      const position = account.assetPositions.find((item) => item.position.coin === market.coin);
      const positionSize = new Decimal(position?.position.szi ?? "0");
      accountValue = new Decimal(account.marginSummary.accountValue);
      grossExposure = account.marginSummary.totalNtlPos;
      positionNotional = positionSize.mul(market.markPx);
      if (input.kind === "close") {
        if (positionSize.isZero())
          throw new TradeRejection(`You have no open ${market.symbol} position.`);
        if (!(input.fraction > 0 && input.fraction <= 1))
          throw new TradeRejection("Choose how much of the position to close.");
        side = positionSize.isPositive() ? "sell" : "buy";
        reduceOnly = true;
        leverage = position?.position.leverage.value ?? 1;
        isCross = position?.position.leverage.type !== "isolated";
        size = toSize(positionSize.abs().mul(input.fraction));
      } else {
        side = input.side;
        pricing = input;
        if (!Number.isInteger(input.leverage) || input.leverage < 1)
          throw new TradeRejection("Choose a whole-number leverage of 1x or more.");
        const maxLeverage = Math.min(market.maxLeverage, this.options.maxLeverage);
        if (input.leverage > maxLeverage)
          throw new TradeRejection(`${market.symbol} allows up to ${maxLeverage}x leverage.`);
        if (market.onlyIsolated && input.isCross)
          throw new TradeRejection(`${market.symbol} supports isolated margin only.`);
        // Hyperliquid sets leverage per coin. The requested leverage is applied (to any open
        // position too), but an open position cannot switch between cross and isolated margin.
        const positionCross = position ? position.position.leverage.type === "cross" : null;
        if (positionCross != null && positionCross !== input.isCross)
          throw new TradeRejection(
            `Your ${market.symbol} position uses ${positionCross ? "cross" : "isolated"} margin. Close it to switch modes.`,
          );
        leverage = input.leverage;
        isCross = input.isCross;
        setLeverage = !position || position.position.leverage.value !== input.leverage;
        marginUsd = new Decimal(input.marginUsd);
        if (!marginUsd.isFinite() || marginUsd.lte(0))
          throw new TradeRejection("Enter the margin to use.");
        const available = new Decimal(account.withdrawable);
        if (marginUsd.gt(available))
          throw new TradeRejection(
            `You have $${available.toFixed(2)} available. Deposit USDC or lower the amount.`,
          );
        const { reference } = this.orderPrice(market, side === "buy", pricing, slippage);
        const notional = marginUsd.mul(leverage);
        if (notional.lt(MIN_ORDER_USD))
          throw new TradeRejection(
            `Position size must be at least $${MIN_ORDER_USD}. Raise the margin or leverage.`,
          );
        if (notional.gt(this.options.maxNotionalUsd))
          throw new TradeRejection(
            `Positions are limited to $${this.options.maxNotionalUsd.toLocaleString("en-US")} per order.`,
          );
        size = toSize(notional.div(reference));
        const isLong = side === "buy";
        for (const [label, price, wantAbove] of [
          ["Take profit", input.takeProfitPx, isLong],
          ["Stop loss", input.stopLossPx, !isLong],
        ] as const) {
          if (price == null) continue;
          if (
            !(price > 0) ||
            (wantAbove ? price <= reference.toNumber() : price >= reference.toNumber())
          )
            throw new TradeRejection(
              `${label} must be ${wantAbove ? "above" : "below"} the entry price for a ${isLong ? "long" : "short"}.`,
            );
        }
      }
    }

    const isBuy = side === "buy";
    const { price, reference, tif } = this.orderPrice(market, isBuy, pricing, slippage);
    const notional = new Decimal(size).mul(reference);
    if (!reduceOnly && notional.lt(MIN_ORDER_USD))
      throw new TradeRejection(`Orders must be at least $${MIN_ORDER_USD}.`);
    if (kind === "spot" && notional.gt(this.options.maxNotionalUsd))
      throw new TradeRejection(
        `Orders are limited to $${this.options.maxNotionalUsd.toLocaleString("en-US")} each.`,
      );
    await this.requireBuilderApproval(user, fee);

    const instrument: Instrument = {
      id: `hyperliquid:${market.coin}:${kind === "spot" ? "spot" : "perpetual"}`,
      venue: "hyperliquid",
      venueSymbol: market.coin,
      displaySymbol: kind === "spot" ? `${market.symbol}/USDC` : `${market.symbol}-PERP`,
      assetClass: "crypto",
      type: kind === "spot" ? "spot" : "perpetual",
      baseAsset: market.symbol,
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
      type: pricing.orderType === "limit" ? "limit" : "market",
      ...(pricing.orderType === "limit" ? { limitPrice: price } : {}),
      quantity: size,
      timeInForce: pricing.orderType === "limit" ? "gtc" : "ioc",
      reduceOnly,
      mode: "live",
      submittedBy: input.subject,
      correlationId: crypto.randomUUID(),
    });
    const unlimited = String(Number.MAX_SAFE_INTEGER);
    const decision = evaluatePreTradeRisk({
      order: intent,
      instrument,
      quote: MarketSnapshot.parse({
        instrumentId: instrument.id,
        bid: market.markPx.toFixed(),
        ask: market.markPx.toFixed(),
        last: market.markPx.toFixed(),
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
        grossExposure: reduceOnly || kind === "spot" ? "0" : grossExposure,
        netExposure: reduceOnly || kind === "spot" ? "0" : positionNotional.toFixed(),
        dailyPnl: "0",
        existingInstrumentExposure: positionNotional.toFixed(),
      },
      limits: {
        // Closing must always be possible, even for a position larger than today's limits.
        maxOrderNotional: reduceOnly ? unlimited : String(this.options.maxNotionalUsd),
        maxGrossExposure:
          reduceOnly || kind === "spot"
            ? unlimited
            : Decimal.max(accountValue, 0).mul(this.options.maxLeverage).toFixed(),
        maxNetExposure: unlimited,
        maxPositionNotional: unlimited,
        maxDailyLoss: unlimited,
        maxLeverage: reduceOnly || kind === "spot" ? unlimited : String(this.options.maxLeverage),
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
      p: price,
      s: size,
      r: reduceOnly,
      t: { limit: { tif } },
      c: cloid,
    };
    const triggers =
      input.kind === "open"
        ? (
            [
              ["tp", input.takeProfitPx],
              ["sl", input.stopLossPx],
            ] as const
          ).flatMap(([tpsl, trigger]) => {
            if (trigger == null) return [];
            const triggerPx = formatPrice(String(trigger), market.szDecimals);
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
        ...(fee ? { builder: { b: fee.b as `0x${string}`, f: fee.f } } : {}),
      }),
      nonce: base + 1,
      expiresAfter,
    });

    const id = crypto.randomUUID();
    await prepareHyperliquidOrder(this.options.databaseUrl, {
      id,
      tenantId: input.tenantId,
      subject: input.subject,
      symbol: kind === "spot" ? `${market.symbol}/USDC` : `${market.symbol}USDC`,
      side,
      quantity: size,
      clientOrderId: cloid,
      accountAddress: user,
      preparedActions: actions,
      expiresAt: new Date(base + ORDER_TTL_MS),
      leverage: String(leverage),
      marginUsd: marginUsd?.toFixed() ?? null,
      reduceOnly,
      marketType: kind,
      orderType: pricing.orderType === "limit" ? "limit" : "market",
      limitPrice: pricing.orderType === "limit" ? price : null,
    });
    const venueFeeRate = await this.takerFeeRate(user, kind);
    const builderFeeUsd = notional.mul(fee?.bps ?? 0).div(10_000);
    const liquidationPx =
      reduceOnly || kind === "spot"
        ? null
        : estimateLiquidationPrice(reference, leverage, market.maxLeverage, isBuy);
    return {
      orderId: id,
      actions,
      market: kind,
      coin: market.coin,
      symbol: market.symbol,
      side,
      size,
      reduceOnly,
      leverage,
      isCross,
      orderType: pricing.orderType === "limit" ? ("limit" as const) : ("market" as const),
      markPx: market.markPx.toFixed(),
      limitPx: price,
      notionalUsd: notional.toFixed(2),
      marginUsd: marginUsd?.toFixed(2) ?? null,
      // A resting limit order pays the lower maker rate if it fills later; this is the taker bound.
      estimatedFeeUsd: notional.mul(venueFeeRate).plus(builderFeeUsd).toFixed(2),
      builderFeeUsd: builderFeeUsd.toFixed(2),
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
      throw new TradeRejection("Trading is not available right now.", 503);
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
    const reject = async (message: string, status = 422): Promise<never> => {
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
      const resting = RestingStatus.safeParse(first);
      if (resting.success) {
        await updateMarketLiveOrder(
          databaseUrl,
          order.id,
          "open",
          String(resting.data.resting.oid),
        );
        return { orderId: order.id, status: "open" as const, oid: resting.data.resting.oid };
      }
      const error = ErrorStatus.safeParse(first);
      return reject(
        error.success ? explainVenueError(error.data.error) : "The order did not fill.",
      );
    }
    return reject("The order was not placed.");
  }

  private async fills(user: string, oid: number) {
    return z
      .array(Fill)
      .parse(await this.post("info", { type: "userFills", user }))
      .filter((fill) => fill.oid === oid);
  }

  /** Fees paid on an order's fills, including Sisera's builder fee. */
  private async feeFor(user: string, oid: number) {
    try {
      return (await this.fills(user, oid))
        .reduce((sum, fill) => sum.plus(fill.fee).plus(fill.builderFee ?? 0), new Decimal(0))
        .toFixed();
    } catch {
      return "0";
    }
  }

  /**
   * Settles orders whose outcome was unknown at submission, and resting limit orders that have
   * since filled or been cancelled, using their client order IDs.
   */
  async reconcile(subject: string) {
    const databaseUrl = this.options.databaseUrl;
    if (!databaseUrl) return;
    await expireHyperliquidOrders(databaseUrl, subject);
    for (const order of await listUnreconciledHyperliquidOrders(databaseUrl, subject)) {
      const parsed = OrderStatus.safeParse(
        await this.post("info", {
          type: "orderStatus",
          user: order.accountAddress,
          oid: order.clientOrderId,
        }).catch(() => null),
      );
      if (!parsed.success) continue;
      if (parsed.data.status === "unknownOid") {
        // A resting order Hyperliquid no longer knows was never placed or has aged out.
        if (
          order.status === "open" ||
          this.now() - order.updatedAt.getTime() > UNKNOWN_ORDER_GRACE_MS
        )
          await updateMarketLiveOrder(databaseUrl, order.id, "rejected");
        continue;
      }
      const { status, order: venueOrder } = parsed.data.order;
      if (status === "open") {
        if (order.status !== "open")
          await updateMarketLiveOrder(databaseUrl, order.id, "open", String(venueOrder.oid));
        continue;
      }
      const filledSize = new Decimal(venueOrder.origSz).minus(venueOrder.sz);
      if (status === "filled" || filledSize.gt(0)) {
        const fills = await this.fills(order.accountAddress, venueOrder.oid).catch(() => []);
        const size = fills.reduce((sum, fill) => sum.plus(fill.sz), new Decimal(0));
        if (size.lte(0)) continue;
        const average = fills
          .reduce((sum, fill) => sum.plus(new Decimal(fill.px).mul(fill.sz)), new Decimal(0))
          .div(size);
        await updateMarketLiveOrder(databaseUrl, order.id, "filled", String(venueOrder.oid), {
          priceUsd: average.toFixed(),
          feeUsd: fills
            .reduce((sum, fill) => sum.plus(fill.fee).plus(fill.builderFee ?? 0), new Decimal(0))
            .toFixed(),
          quantity: size.toFixed(),
        });
      } else {
        await updateMarketLiveOrder(
          databaseUrl,
          order.id,
          /cancel/i.test(status) ? "cancelled" : "rejected",
          String(venueOrder.oid),
        );
      }
    }
  }
}
