import type {
  Instrument,
  MarketSnapshot,
  OrderIntent,
  PortfolioRiskState,
  RiskDecision,
  RiskLimits,
} from "@sisera/domain";
import Decimal from "decimal.js";

type PreTradeInput = {
  order: OrderIntent;
  instrument: Instrument;
  quote: MarketSnapshot;
  portfolio: PortfolioRiskState;
  limits: RiskLimits;
  now?: Date;
};

export function evaluatePreTradeRisk(input: PreTradeInput): RiskDecision {
  const now = input.now ?? new Date();
  const reasons: RiskDecision["reasons"] = [];
  const price = new Decimal(
    input.order.type === "market"
      ? input.order.side === "buy"
        ? input.quote.ask
        : input.quote.bid
      : (input.order.limitPrice ?? "0"),
  );
  const orderNotional = price.mul(input.order.quantity).mul(input.instrument.contractMultiplier);
  const signedNotional = input.order.side === "buy" ? orderNotional : orderNotional.negated();
  const projectedGross = new Decimal(input.portfolio.grossExposure).add(orderNotional.abs());
  const projectedNet = new Decimal(input.portfolio.netExposure).add(signedNotional);
  const projectedPosition = new Decimal(input.portfolio.existingInstrumentExposure).add(
    signedNotional,
  );
  const quoteAgeMs = now.getTime() - Date.parse(input.quote.quality.observedAt);

  if (input.order.mode === "live" && input.quote.quality.status !== "live") {
    reasons.push({ code: "QUOTE_NOT_LIVE", message: "Execution requires a live market quote." });
  }
  if (quoteAgeMs < 0 || quoteAgeMs > input.limits.maxQuoteAgeMs) {
    reasons.push({
      code: "QUOTE_STALE",
      message: "Quote age exceeds the configured execution threshold.",
      actual: String(Math.max(quoteAgeMs, 0)),
      limit: String(input.limits.maxQuoteAgeMs),
    });
  }
  if (!input.limits.allowedAssetClasses.includes(input.instrument.assetClass)) {
    reasons.push({ code: "ASSET_CLASS_BLOCKED", message: "Asset class is outside this mandate." });
  }
  checkLimit(reasons, "ORDER_NOTIONAL", orderNotional.abs(), input.limits.maxOrderNotional);
  checkLimit(reasons, "GROSS_EXPOSURE", projectedGross, input.limits.maxGrossExposure);
  checkLimit(reasons, "NET_EXPOSURE", projectedNet.abs(), input.limits.maxNetExposure);
  checkLimit(
    reasons,
    "POSITION_NOTIONAL",
    projectedPosition.abs(),
    input.limits.maxPositionNotional,
  );

  const dailyLoss = Decimal.min(new Decimal(input.portfolio.dailyPnl), 0).abs();
  checkLimit(reasons, "DAILY_LOSS", dailyLoss, input.limits.maxDailyLoss);

  const leverage = new Decimal(input.portfolio.nav).isZero()
    ? new Decimal(Number.POSITIVE_INFINITY)
    : projectedGross.div(input.portfolio.nav);
  checkLimit(reasons, "LEVERAGE", leverage, input.limits.maxLeverage);

  return {
    outcome: reasons.length === 0 ? "approved" : "rejected",
    checkedAt: now.toISOString(),
    orderNotional: orderNotional.toFixed(),
    projectedGrossExposure: projectedGross.toFixed(),
    projectedNetExposure: projectedNet.toFixed(),
    reasons,
  };
}

function checkLimit(
  reasons: RiskDecision["reasons"],
  code: string,
  actual: Decimal,
  limit: string,
): void {
  if (actual.greaterThan(new Decimal(limit))) {
    reasons.push({
      code: `${code}_LIMIT`,
      message: `${code.toLowerCase().replaceAll("_", " ")} exceeds its configured limit.`,
      actual: actual.toFixed(),
      limit,
    });
  }
}

export type MandateLimits = {
  maxGrossExposureUsd: number;
  maxPositionWeightPct: number;
  maxUnderlyingWeightPct: number;
  maxDailyLossUsd: number;
  maxAgentTokenWeightPct: number;
  maxIlliquidExitPct: number;
};

export const DEFAULT_MANDATE: MandateLimits = {
  maxGrossExposureUsd: 250_000,
  maxPositionWeightPct: 25,
  maxUnderlyingWeightPct: 35,
  maxDailyLossUsd: 2_500,
  maxAgentTokenWeightPct: 15,
  maxIlliquidExitPct: 5,
};

export type MandateInput = {
  grossExposureUsd: number;
  largestWeightPct: number;
  largestSymbol: string | null;
  largestUnderlyingWeightPct: number;
  largestUnderlying: string | null;
  dailyPnlUsd: number;
  agentTokenWeightPct: number;
  worstExitLiquidityPct: number | null;
  worstExitSymbol: string | null;
};

export type MandateUtilization = {
  id: string;
  label: string;
  used: number;
  limit: number;
  utilizationPct: number;
  status: "ok" | "warning" | "breach";
  detail: string;
};

/** Measures how much of each mandate limit the current book consumes. */
export function evaluateMandate(
  input: MandateInput,
  limits: MandateLimits = DEFAULT_MANDATE,
): MandateUtilization[] {
  const row = (
    id: string,
    label: string,
    used: number,
    limit: number,
    detail: string,
  ): MandateUtilization => {
    const utilizationPct = limit > 0 ? (used / limit) * 100 : 0;
    return {
      id,
      label,
      used,
      limit,
      utilizationPct,
      status: utilizationPct > 100 ? "breach" : utilizationPct >= 80 ? "warning" : "ok",
      detail,
    };
  };
  return [
    row(
      "gross",
      "Gross exposure",
      input.grossExposureUsd,
      limits.maxGrossExposureUsd,
      `$${Math.round(input.grossExposureUsd).toLocaleString("en-US")} of $${Math.round(limits.maxGrossExposureUsd).toLocaleString("en-US")}`,
    ),
    row(
      "position",
      "Largest position",
      input.largestWeightPct,
      limits.maxPositionWeightPct,
      `${input.largestSymbol ?? "—"} at ${input.largestWeightPct.toFixed(1)}% of NAV`,
    ),
    row(
      "underlying",
      "Largest economic exposure",
      input.largestUnderlyingWeightPct,
      limits.maxUnderlyingWeightPct,
      `${input.largestUnderlying ?? "—"} across all instruments`,
    ),
    row(
      "daily_loss",
      "Daily loss",
      Math.max(0, -input.dailyPnlUsd),
      limits.maxDailyLossUsd,
      `P&L today ${input.dailyPnlUsd < 0 ? "−" : ""}$${Math.abs(input.dailyPnlUsd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    ),
    row(
      "agent_tokens",
      "Agent-token allocation",
      input.agentTokenWeightPct,
      limits.maxAgentTokenWeightPct,
      `${input.agentTokenWeightPct.toFixed(1)}% of NAV in agent tokens`,
    ),
    row(
      "liquidity",
      "Exit liquidity",
      input.worstExitLiquidityPct ?? 0,
      limits.maxIlliquidExitPct,
      input.worstExitSymbol
        ? `${input.worstExitSymbol} is ${input.worstExitLiquidityPct?.toFixed(2)}% of its pool`
        : "No position has measured liquidity",
    ),
  ];
}

export function mandateBreaches(rows: readonly MandateUtilization[]): string[] {
  return rows.filter((row) => row.status === "breach").map((row) => `${row.label}: ${row.detail}`);
}
