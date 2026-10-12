import { z } from "zod";

export const DecimalString = z
  .string()
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/, "Expected a base-10 decimal string");

export const AssetClass = z.enum([
  "crypto",
  "equity",
  "fx",
  "commodity",
  "index",
  "rwa",
  "prediction",
]);

export const InstrumentType = z.enum([
  "spot",
  "perpetual",
  "future",
  "option",
  "tokenized_equity",
  "pre_ipo_equity",
  "agent_token",
  "tokenized_fund",
  "prediction_outcome",
]);

export const Instrument = z.object({
  id: z.string().min(3),
  venue: z.string().min(2),
  venueSymbol: z.string().min(1),
  displaySymbol: z.string().min(1),
  assetClass: AssetClass,
  type: InstrumentType,
  baseAsset: z.string().min(1),
  quoteAsset: z.string().min(1),
  priceIncrement: DecimalString,
  quantityIncrement: DecimalString,
  contractMultiplier: DecimalString.default("1"),
  status: z.enum(["active", "halted", "delisted"]),
  chain: z.string().optional(),
  mint: z.string().optional(),
  issuer: z.string().optional(),
  provider: z.string().optional(),
  underlyingSymbol: z.string().optional(),
  underlyingPythFeed: z.string().optional(),
  tokenPythFeed: z.string().optional(),
  markPrice: DecimalString.optional(),
  impliedValuation: DecimalString.optional(),
  referenceValuation: DecimalString.optional(),
  pairedStockMint: z.string().optional(),
  agentId: z.string().optional(),
});
export type Instrument = z.infer<typeof Instrument>;

export const DataQuality = z.object({
  status: z.enum(["live", "delayed", "stale", "degraded", "unavailable"]),
  source: z.string(),
  observedAt: z.string().datetime(),
  receivedAt: z.string().datetime(),
  latencyMs: z.number().nonnegative(),
  sequence: z.string().optional(),
});
export type DataQuality = z.infer<typeof DataQuality>;

export const MarketSnapshot = z.object({
  instrumentId: z.string(),
  bid: DecimalString,
  ask: DecimalString,
  last: DecimalString,
  change24hPct: DecimalString.optional(),
  volume24h: DecimalString.optional(),
  quality: DataQuality,
});
export type MarketSnapshot = z.infer<typeof MarketSnapshot>;

export const Candle = z.object({
  time: z.number().int().positive(),
  open: DecimalString,
  high: DecimalString,
  low: DecimalString,
  close: DecimalString,
  volume: DecimalString,
});
export type Candle = z.infer<typeof Candle>;

export const OrderBookLevel = z.object({
  price: DecimalString,
  quantity: DecimalString,
});
export type OrderBookLevel = z.infer<typeof OrderBookLevel>;

export const OrderBook = z.object({
  instrumentId: z.string(),
  sequence: z.string(),
  bids: z.array(OrderBookLevel),
  asks: z.array(OrderBookLevel),
  quality: DataQuality,
});
export type OrderBook = z.infer<typeof OrderBook>;

export const OrderSide = z.enum(["buy", "sell"]);
export const OrderType = z.enum(["market", "limit", "stop_market", "stop_limit"]);
export const TimeInForce = z.enum(["day", "gtc", "ioc", "fok"]);

export const PortfolioPosition = z.object({
  instrumentId: z.string(),
  side: OrderSide,
  quantity: DecimalString,
  entryPrice: DecimalString,
  markPrice: DecimalString,
  contractMultiplier: DecimalString.default("1"),
  marginUsed: DecimalString.default("0"),
  betaMap: z.record(DecimalString).default({}),
});
export type PortfolioPosition = z.infer<typeof PortfolioPosition>;

export const PortfolioSnapshot = z.object({
  portfolioId: z.string(),
  baseCurrency: z.string(),
  cash: z.record(DecimalString),
  positions: z.array(PortfolioPosition),
  reconciledAt: z.string().datetime(),
  source: z.string(),
});
export type PortfolioSnapshot = z.infer<typeof PortfolioSnapshot>;

export const OrderIntent = z.object({
  clientOrderId: z.string().min(8),
  portfolioId: z.string().min(1),
  accountId: z.string().min(1),
  instrumentId: z.string().min(3),
  side: OrderSide,
  type: OrderType,
  quantity: DecimalString.refine((value) => Number(value) > 0, "Quantity must be positive"),
  limitPrice: DecimalString.optional(),
  stopPrice: DecimalString.optional(),
  timeInForce: TimeInForce.default("gtc"),
  reduceOnly: z.boolean().default(false),
  mode: z.enum(["paper", "live"]),
  submittedBy: z.string().min(1),
  correlationId: z.string().min(8),
});
export type OrderIntent = z.infer<typeof OrderIntent>;

export const RiskLimits = z.object({
  maxOrderNotional: DecimalString,
  maxGrossExposure: DecimalString,
  maxNetExposure: DecimalString,
  maxPositionNotional: DecimalString,
  maxDailyLoss: DecimalString,
  maxLeverage: DecimalString,
  maxQuoteAgeMs: z.number().int().positive(),
  allowedAssetClasses: z.array(AssetClass).min(1),
});
export type RiskLimits = z.infer<typeof RiskLimits>;

export const PortfolioRiskState = z.object({
  nav: DecimalString,
  grossExposure: DecimalString,
  netExposure: DecimalString,
  dailyPnl: DecimalString,
  existingInstrumentExposure: DecimalString,
});
export type PortfolioRiskState = z.infer<typeof PortfolioRiskState>;

export const RiskDecision = z.object({
  outcome: z.enum(["approved", "rejected"]),
  checkedAt: z.string().datetime(),
  orderNotional: DecimalString,
  projectedGrossExposure: DecimalString,
  projectedNetExposure: DecimalString,
  reasons: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
      actual: DecimalString.optional(),
      limit: DecimalString.optional(),
    }),
  ),
});
export type RiskDecision = z.infer<typeof RiskDecision>;

export const UserRole = z.enum(["viewer", "trader", "risk_manager", "admin"]);
export type UserRole = z.infer<typeof UserRole>;

export const Permission = z.enum([
  "market:read",
  "portfolio:read",
  "order:paper:create",
  "order:live:create",
  "risk:read",
  "risk:manage",
  "agent:read",
  "agent:manage",
  "admin:manage",
]);
export type Permission = z.infer<typeof Permission>;

export const AgentManifest = z.object({
  id: z.string().min(3),
  name: z.string().min(3),
  version: z.string().min(1),
  autonomy: z.enum(["research", "suggest", "confirm", "policy_auto", "autonomous", "risk_only"]),
  stage: z.enum([
    "draft",
    "backtest",
    "stress",
    "paper",
    "shadow",
    "limited_live",
    "live",
    "paused",
  ]),
  capitalLimit: DecimalString,
  maxOrderNotional: DecimalString,
  maxDailyDrawdownPct: DecimalString,
  allowedInstruments: z.array(z.string()).min(1),
  killSwitch: z.enum(["halt", "cancel_and_halt", "flatten_and_halt"]),
});
export type AgentManifest = z.infer<typeof AgentManifest>;

export const PredictionMarket = z.object({
  /** False for catalog rows without observed prices. */
  pricingAvailable: z.boolean().optional(),
  id: z.string(),
  provider: z.string(),
  underlyingProvider: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  subcategory: z.string().nullable().optional(),
  eventId: z.string().nullable().optional(),
  eventTitle: z.string().nullable().optional(),
  marketTitle: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  openedAt: z.string().datetime().nullable().optional(),
  volumeUsd: z.number().nullable().optional(),
  eventVolume24hUsd: z.number().nullable().optional(),
  /** Underlying venue token ids, YES first, used for price history and order books. */
  venueTokenIds: z.array(z.string()).optional(),
  resolutionRules: z.string().nullable().optional(),
  title: z.string(),
  closesAt: z.string().datetime().nullable(),
  status: z.enum(["open", "closed", "resolved"]),
  outcomes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      probability: DecimalString,
      sellPrice: DecimalString.optional(),
      tokenId: z.string().optional(),
    }),
  ),
  quality: DataQuality,
});
export type PredictionMarket = z.infer<typeof PredictionMarket>;

export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> = {
  viewer: ["market:read", "portfolio:read", "risk:read", "agent:read"],
  trader: [
    "market:read",
    "portfolio:read",
    "order:paper:create",
    "order:live:create",
    "risk:read",
    "agent:read",
    "agent:manage",
  ],
  risk_manager: [
    "market:read",
    "portfolio:read",
    "order:paper:create",
    "risk:read",
    "risk:manage",
    "agent:read",
  ],
  admin: Permission.options,
};

export function roleCan(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
