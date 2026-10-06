export type AssetKind = "public_equity" | "pre_ipo" | "agent_token";

export interface Asset {
  key: string;
  symbol: string;
  name: string;
  kind: AssetKind;
  priceUsd: number;
  change24hPct: number;
  volume24hUsd: number;
  marketCapUsd?: number;
  // Valuation & Reference details
  referencePriceUsd?: number;
  referenceSource?: "Pyth Hermes" | "SEC Filing" | "Cap Table Valuation" | "DEX";
  premiumDiscountPct?: number; // Spot vs Reference/Mark
  impliedValuationUsd?: number;
  lastRoundValuationUsd?: number;
  liquidityUsd?: number;
  mint?: string;
  // Agent token specifics
  pairedStockSymbol?: string;
  holderConcentrationTop10Pct?: number;
  riskScore?: number;
}

export interface MarketEvent {
  id: string;
  headline: string;
  summary: string;
  tier: "REGULATORY" | "ISSUER" | "TIER_1_PRESS" | "CORROBORATED" | "RUMOR";
  severity: "HIGH" | "MEDIUM" | "LOW";
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  timestamp: string;
  assetKey?: string;
  symbol?: string;
  sourceUrl?: string;
  corroboratedByCount?: number;
}

export type AutonomyLevel =
  | "RESEARCH"
  | "SUGGEST"
  | "CONFIRM"
  | "POLICY_AUTO"
  | "AUTONOMOUS"
  | "EMERGENCY_RISK_ONLY";

export type PromotionStage =
  | "DRAFT"
  | "BACKTEST"
  | "STRESS_TEST"
  | "PAPER"
  | "SHADOW"
  | "LIMITED_LIVE"
  | "LIVE"
  | "PAUSED";

export interface AgentManifest {
  id: string;
  name: string;
  description: string;
  autonomyLevel: AutonomyLevel;
  lifecycleStage: PromotionStage;
  maxCapitalUsd: number;
  currentAllocatedUsd: number;
  maxTradeNotionalUsd: number;
  maxDailyDrawdownPct: number;
  currentDailyDrawdownPct: number;
  openPositionsCount: number;
  maxOpenPositions: number;
  sharpeRatio: number;
  universe: string[];
  lastDecision?: {
    action: "BUY" | "SELL" | "HOLD" | "REDUCE";
    reason: string;
    timestamp: string;
  };
  circuitBreakerTripped: boolean;
}

export interface Position {
  assetKey: string;
  symbol: string;
  name: string;
  kind: AssetKind;
  quantity: number;
  avgEntryPriceUsd: number;
  currentPriceUsd: number;
  marketValueUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  weightPct: number;
}

export interface PortfolioSummary {
  navUsd: number;
  cashUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  realizedPnlUsd: number;
  dailyPnlUsd: number;
  dailyPnlPct: number;
  positions: Position[];
  riskMandate: {
    maxDailyDrawdownPct: number;
    currentDailyDrawdownPct: number;
    maxSingleAssetConcentrationPct: number;
    maxLeverage: number;
    currentLeverage: number;
  };
}

export interface CopilotCard {
  type: "explanation" | "arguments" | "exposure" | "ranking" | "policy_draft" | "impact";
  title?: string;
  data: any;
}

export interface CopilotMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  cards?: CopilotCard[];
  provenance?: {
    model: string;
    sources: string[];
  };
}

export interface PredictionMarket {
  id: string;
  title: string;
  category: string;
  yesProbabilityPct: number;
  noProbabilityPct: number;
  volumeUsd: number;
  liquidityUsd: number;
  closesAt: string;
  resolved: boolean;
  outcome?: "YES" | "NO";
}

export interface SocialPost {
  id: string;
  platform: "X" | "TELEGRAM" | "DISCORD" | "REDDIT";
  author: string;
  content: string;
  timestamp: string;
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  symbol?: string;
  url?: string;
}

export interface AuditLogEntry {
  id: string;
  eventType: "TRADE_EXECUTION" | "POLICY_TRIGGER" | "AGENT_PROMOTION" | "CIRCUIT_BREAKER" | "MANDATE_CHECK";
  title: string;
  detail: string;
  timestamp: string;
  status: "CONFIRMED" | "BLOCKED" | "EVALUATED";
  txHash?: string;
}

export interface OrderBookLevel {
  priceUsd: number;
  size: number;
  total: number;
}

