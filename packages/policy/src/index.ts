import type { Candle } from "@sisera/domain";
import {
  exponentialMovingAverage,
  relativeStrengthIndex,
  simpleMovingAverage,
} from "@sisera/quant";
import { z } from "zod";

/**
 * A declarative condition language shared by conversational trading policies and agent rules.
 * Conditions are evaluated deterministically against observed market state; a condition whose
 * input data is missing never passes.
 */
const Pct = z.number().finite().min(-100).max(1000);
const Usd = z.number().finite().nonnegative().max(1e12);
const SeverityLevel = z.enum(["low", "medium", "high", "critical"]);

export const Condition = z.discriminatedUnion("type", [
  z.object({ type: z.literal("premium_below"), pct: Pct }),
  z.object({ type: z.literal("premium_above"), pct: Pct }),
  z.object({ type: z.literal("price_below"), usd: Usd }),
  z.object({ type: z.literal("price_above"), usd: Usd }),
  z.object({ type: z.literal("liquidity_above"), usd: Usd }),
  z.object({ type: z.literal("volume_24h_above"), usd: Usd }),
  z.object({ type: z.literal("change_24h_below"), pct: Pct }),
  z.object({ type: z.literal("change_24h_above"), pct: Pct }),
  z.object({
    type: z.literal("no_negative_event"),
    minSeverity: SeverityLevel.default("high"),
    lookbackHours: z.number().int().min(1).max(720).default(24),
    includeRumors: z.boolean().default(true),
  }),
  z.object({
    type: z.literal("sec_filing_detected"),
    lookbackHours: z.number().int().min(1).max(720).default(24),
    itemCode: z.string().optional(),
  }),
  z.object({
    type: z.literal("positive_catalyst"),
    minSeverity: SeverityLevel.default("medium"),
    lookbackHours: z.number().int().min(1).max(720).default(24),
    requireConfirmedOrCorroborated: z.boolean().default(true),
  }),
  z.object({ type: z.literal("reference_fresh") }),
  z.object({
    type: z.literal("ema_trend"),
    fast: z.number().int().min(2).max(200),
    slow: z.number().int().min(3).max(400),
    direction: z.enum(["bullish", "bearish"]),
    requireCross: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("rsi_below"),
    period: z.number().int().min(2).max(100).default(14),
    value: z.number().min(0).max(100),
  }),
  z.object({
    type: z.literal("rsi_above"),
    period: z.number().int().min(2).max(100).default(14),
    value: z.number().min(0).max(100),
  }),
  z.object({ type: z.literal("breakout_high"), lookback: z.number().int().min(2).max(500) }),
  z.object({ type: z.literal("breakdown_low"), lookback: z.number().int().min(2).max(500) }),
  z.object({
    type: z.literal("relative_volume_above"),
    lookback: z.number().int().min(2).max(500).default(20),
    ratio: z.number().positive().max(100),
  }),
  z.object({ type: z.literal("close_above_sma"), period: z.number().int().min(2).max(500) }),
  z.object({ type: z.literal("close_below_sma"), period: z.number().int().min(2).max(500) }),
  z.object({
    type: z.literal("return_above"),
    bars: z.number().int().min(1).max(500),
    pct: Pct,
  }),
  z.object({
    type: z.literal("return_below"),
    bars: z.number().int().min(1).max(500),
    pct: Pct,
  }),
  z.object({
    type: z.literal("funding_rate_above"),
    aprPct: Pct,
  }),
  z.object({
    type: z.literal("basis_spread_above"),
    bps: z.number().finite().min(-10_000).max(10_000),
  }),
]);
export type Condition = z.infer<typeof Condition>;

/** Conditions that can be replayed from candles alone, and so can be backtested. */
export const TECHNICAL_CONDITIONS: ReadonlySet<Condition["type"]> = new Set([
  "ema_trend",
  "rsi_below",
  "rsi_above",
  "breakout_high",
  "breakdown_low",
  "relative_volume_above",
  "close_above_sma",
  "close_below_sma",
  "return_above",
  "return_below",
  "price_below",
  "price_above",
]);

export type EventSignal = {
  severity: z.infer<typeof SeverityLevel>;
  sentiment: "positive" | "negative" | "neutral" | "mixed";
  certainty: string;
  lastSeenAt: string;
  headline: string;
  category?: string;
  sourceTier?: string;
};

export type MarketState = {
  price?: number | null;
  premiumPct?: number | null;
  liquidityUsd?: number | null;
  volume24hUsd?: number | null;
  change24hPct?: number | null;
  referenceFresh?: boolean | null;
  events?: readonly EventSignal[] | null;
  candles?: readonly Candle[] | null;
  fundingRateAprPct?: number | null;
  basisSpreadBps?: number | null;
  observedAt?: string;
};

export type ConditionResult = {
  condition: Condition;
  passed: boolean;
  dataAvailable: boolean;
  actual: string | null;
  detail: string;
};

const SEVERITY_ORDER = ["low", "medium", "high", "critical"] as const;
const fmt = (value: number, digits = 2) =>
  Number.isFinite(value) ? value.toFixed(digits) : String(value);
const usd = (value: number) =>
  `$${Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value)}`;

function missing(condition: Condition, what: string): ConditionResult {
  return {
    condition,
    passed: false,
    dataAvailable: false,
    actual: null,
    detail: `${what} is unavailable, so this condition cannot pass.`,
  };
}

function compare(
  condition: Condition,
  actual: number | null | undefined,
  label: string,
  test: (value: number) => boolean,
  render: (value: number) => string,
  target: string,
): ConditionResult {
  if (actual == null || !Number.isFinite(actual)) return missing(condition, label);
  const passed = test(actual);
  return {
    condition,
    passed,
    dataAvailable: true,
    actual: render(actual),
    detail: `${label} ${render(actual)} ${passed ? "meets" : "does not meet"} ${target}.`,
  };
}

export function describeCondition(condition: Condition): string {
  switch (condition.type) {
    case "premium_below":
      return `premium to reference below ${condition.pct}%`;
    case "premium_above":
      return `premium to reference above ${condition.pct}%`;
    case "price_below":
      return `price below $${condition.usd}`;
    case "price_above":
      return `price above $${condition.usd}`;
    case "liquidity_above":
      return `liquidity above ${usd(condition.usd)}`;
    case "volume_24h_above":
      return `24h volume above ${usd(condition.usd)}`;
    case "change_24h_below":
      return `24h change below ${condition.pct}%`;
    case "change_24h_above":
      return `24h change above ${condition.pct}%`;
    case "no_negative_event":
      return `no ${condition.minSeverity}-severity or worse negative event in ${condition.lookbackHours}h${condition.includeRumors ? "" : " (confirmed reports only)"}`;
    case "sec_filing_detected":
      return `SEC filing detected in past ${condition.lookbackHours}h${condition.itemCode ? ` (Item ${condition.itemCode})` : ""}`;
    case "positive_catalyst":
      return `positive catalyst (${condition.minSeverity}+ severity) in past ${condition.lookbackHours}h${condition.requireConfirmedOrCorroborated ? " (confirmed/corroborated)" : ""}`;
    case "reference_fresh":
      return "reference price is fresh";
    case "ema_trend":
      return `EMA ${condition.fast}/${condition.slow} ${condition.direction}${condition.requireCross ? " cross" : ""}`;
    case "rsi_below":
      return `RSI(${condition.period}) below ${condition.value}`;
    case "rsi_above":
      return `RSI(${condition.period}) above ${condition.value}`;
    case "breakout_high":
      return `close above prior ${condition.lookback}-bar high`;
    case "breakdown_low":
      return `close below prior ${condition.lookback}-bar low`;
    case "relative_volume_above":
      return `volume above ${condition.ratio}× its ${condition.lookback}-bar average`;
    case "close_above_sma":
      return `close above SMA(${condition.period})`;
    case "close_below_sma":
      return `close below SMA(${condition.period})`;
    case "return_above":
      return `${condition.bars}-bar return above ${condition.pct}%`;
    case "return_below":
      return `${condition.bars}-bar return below ${condition.pct}%`;
    case "funding_rate_above":
      return `annualized funding rate above ${condition.aprPct}%`;
    case "basis_spread_above":
      return `basis spread above ${condition.bps} bps`;
  }
}

export function evaluateCondition(
  condition: Condition,
  state: MarketState,
  now = Date.now(),
): ConditionResult {
  const candles = state.candles ?? null;
  const closes = candles?.map((candle) => Number(candle.close)) ?? [];
  const lastClose = closes.at(-1);
  const price = state.price ?? lastClose ?? null;
  switch (condition.type) {
    case "premium_below":
      return compare(
        condition,
        state.premiumPct,
        "Premium",
        (v) => v < condition.pct,
        (v) => `${fmt(v)}%`,
        `< ${condition.pct}%`,
      );
    case "premium_above":
      return compare(
        condition,
        state.premiumPct,
        "Premium",
        (v) => v > condition.pct,
        (v) => `${fmt(v)}%`,
        `> ${condition.pct}%`,
      );
    case "price_below":
      return compare(
        condition,
        price,
        "Price",
        (v) => v < condition.usd,
        (v) => `$${fmt(v, 6)}`,
        `< $${condition.usd}`,
      );
    case "price_above":
      return compare(
        condition,
        price,
        "Price",
        (v) => v > condition.usd,
        (v) => `$${fmt(v, 6)}`,
        `> $${condition.usd}`,
      );
    case "liquidity_above":
      return compare(
        condition,
        state.liquidityUsd,
        "Liquidity",
        (v) => v > condition.usd,
        usd,
        `> ${usd(condition.usd)}`,
      );
    case "volume_24h_above":
      return compare(
        condition,
        state.volume24hUsd,
        "24h volume",
        (v) => v > condition.usd,
        usd,
        `> ${usd(condition.usd)}`,
      );
    case "change_24h_below":
      return compare(
        condition,
        state.change24hPct,
        "24h change",
        (v) => v < condition.pct,
        (v) => `${fmt(v)}%`,
        `< ${condition.pct}%`,
      );
    case "change_24h_above":
      return compare(
        condition,
        state.change24hPct,
        "24h change",
        (v) => v > condition.pct,
        (v) => `${fmt(v)}%`,
        `> ${condition.pct}%`,
      );
    case "reference_fresh":
      if (state.referenceFresh == null) return missing(condition, "Reference freshness");
      return {
        condition,
        passed: state.referenceFresh,
        dataAvailable: true,
        actual: state.referenceFresh ? "fresh" : "stale",
        detail: state.referenceFresh ? "Reference price is fresh." : "Reference price is stale.",
      };
    case "no_negative_event": {
      if (state.events == null) return missing(condition, "Event feed");
      const since = now - condition.lookbackHours * 3_600_000;
      const minimum = SEVERITY_ORDER.indexOf(condition.minSeverity);
      const hits = state.events.filter(
        (event) =>
          Date.parse(event.lastSeenAt) >= since &&
          (event.sentiment === "negative" || event.sentiment === "mixed") &&
          SEVERITY_ORDER.indexOf(event.severity) >= minimum &&
          (condition.includeRumors || !["rumor", "unverified_social"].includes(event.certainty)),
      );
      return {
        condition,
        passed: hits.length === 0,
        dataAvailable: true,
        actual: String(hits.length),
        detail: hits.length
          ? `${hits.length} qualifying negative event(s), e.g. "${hits[0]?.headline}".`
          : `No ${condition.minSeverity}-severity negative events in ${condition.lookbackHours}h.`,
      };
    }
    case "sec_filing_detected": {
      if (state.events == null) return missing(condition, "Event feed");
      const since = now - condition.lookbackHours * 3_600_000;
      const hits = state.events.filter(
        (event) =>
          Date.parse(event.lastSeenAt) >= since &&
          (event.certainty === "confirmed" ||
            event.sourceTier === "regulatory_filing" ||
            /\b(?:8-k|10-q|10-k|sec|filing)\b/i.test(event.headline)) &&
          (!condition.itemCode ||
            event.headline.toLowerCase().includes(condition.itemCode.toLowerCase())),
      );
      return {
        condition,
        passed: hits.length > 0,
        dataAvailable: true,
        actual: String(hits.length),
        detail: hits.length
          ? `SEC filing confirmed: "${hits[0]?.headline}".`
          : `No SEC filing detected within ${condition.lookbackHours}h.`,
      };
    }
    case "positive_catalyst": {
      if (state.events == null) return missing(condition, "Event feed");
      const since = now - condition.lookbackHours * 3_600_000;
      const minimum = SEVERITY_ORDER.indexOf(condition.minSeverity);
      const hits = state.events.filter(
        (event) =>
          Date.parse(event.lastSeenAt) >= since &&
          event.sentiment === "positive" &&
          SEVERITY_ORDER.indexOf(event.severity) >= minimum &&
          (!condition.requireConfirmedOrCorroborated ||
            ["confirmed", "corroborated"].includes(event.certainty)),
      );
      return {
        condition,
        passed: hits.length > 0,
        dataAvailable: true,
        actual: String(hits.length),
        detail: hits.length
          ? `Positive catalyst confirmed: "${hits[0]?.headline}".`
          : `No qualifying positive catalyst within ${condition.lookbackHours}h.`,
      };
    }
    case "funding_rate_above":
      return compare(
        condition,
        state.fundingRateAprPct,
        "Funding APR",
        (value) => value >= condition.aprPct,
        (value) => `${fmt(value)}%`,
        `at least ${condition.aprPct}%`,
      );
    case "basis_spread_above":
      return compare(
        condition,
        state.basisSpreadBps,
        "Basis spread",
        (value) => value >= condition.bps,
        (value) => `${fmt(value)} bps`,
        `at least ${condition.bps} bps`,
      );
    default:
      return evaluateTechnical(condition, candles);
  }
}

function evaluateTechnical(
  condition: Condition,
  candles: readonly Candle[] | null,
): ConditionResult {
  if (!candles || candles.length < 3) return missing(condition, "Price history");
  const closes = candles.map((candle) => Number(candle.close));
  const last = closes.at(-1) ?? Number.NaN;
  const result = (passed: boolean, actual: string, detail: string): ConditionResult => ({
    condition,
    passed,
    dataAvailable: true,
    actual,
    detail,
  });
  switch (condition.type) {
    case "ema_trend": {
      const fast = exponentialMovingAverage(closes, condition.fast);
      const slow = exponentialMovingAverage(closes, condition.slow);
      if (fast == null || slow == null)
        return missing(condition, `${condition.slow} bars of history`);
      const bullish = fast > slow;
      let passed = condition.direction === "bullish" ? bullish : !bullish;
      if (passed && condition.requireCross) {
        const previous = closes.slice(0, -1);
        const previousFast = exponentialMovingAverage(previous, condition.fast);
        const previousSlow = exponentialMovingAverage(previous, condition.slow);
        passed =
          previousFast != null &&
          previousSlow != null &&
          (condition.direction === "bullish"
            ? previousFast <= previousSlow
            : previousFast >= previousSlow);
      }
      return result(
        passed,
        `${fmt(fast, 6)} / ${fmt(slow, 6)}`,
        `EMA ${condition.fast} is ${bullish ? "above" : "below"} EMA ${condition.slow}.`,
      );
    }
    case "rsi_below":
    case "rsi_above": {
      const rsi = relativeStrengthIndex(closes, condition.period);
      if (rsi == null) return missing(condition, `${condition.period + 1} bars of history`);
      const passed = condition.type === "rsi_below" ? rsi < condition.value : rsi > condition.value;
      return result(passed, fmt(rsi), `RSI(${condition.period}) is ${fmt(rsi)}.`);
    }
    case "breakout_high":
    case "breakdown_low": {
      const prior = candles.slice(-condition.lookback - 1, -1);
      if (prior.length < condition.lookback)
        return missing(condition, `${condition.lookback + 1} bars of history`);
      if (condition.type === "breakout_high") {
        const high = Math.max(...prior.map((candle) => Number(candle.high)));
        return result(
          last > high,
          fmt(last, 6),
          `Close ${fmt(last, 6)} vs prior high ${fmt(high, 6)}.`,
        );
      }
      const low = Math.min(...prior.map((candle) => Number(candle.low)));
      return result(last < low, fmt(last, 6), `Close ${fmt(last, 6)} vs prior low ${fmt(low, 6)}.`);
    }
    case "relative_volume_above": {
      const volumes = candles.map((candle) => Number(candle.volume));
      const average = simpleMovingAverage(volumes.slice(0, -1), condition.lookback);
      if (average == null) return missing(condition, `${condition.lookback + 1} bars of volume`);
      const ratio = average === 0 ? 0 : (volumes.at(-1) ?? 0) / average;
      return result(
        ratio > condition.ratio,
        `${fmt(ratio)}×`,
        `Latest volume is ${fmt(ratio)}× average.`,
      );
    }
    case "close_above_sma":
    case "close_below_sma": {
      const sma = simpleMovingAverage(closes, condition.period);
      if (sma == null) return missing(condition, `${condition.period} bars of history`);
      const passed = condition.type === "close_above_sma" ? last > sma : last < sma;
      return result(passed, fmt(sma, 6), `Close ${fmt(last, 6)} vs SMA ${fmt(sma, 6)}.`);
    }
    case "return_above":
    case "return_below": {
      const base = closes.at(-condition.bars - 1);
      if (base == null || base === 0)
        return missing(condition, `${condition.bars + 1} bars of history`);
      const change = (last / base - 1) * 100;
      const passed =
        condition.type === "return_above" ? change > condition.pct : change < condition.pct;
      return result(passed, `${fmt(change)}%`, `${condition.bars}-bar return is ${fmt(change)}%.`);
    }
    case "price_below":
      return result(last < condition.usd, fmt(last, 6), `Close ${fmt(last, 6)}.`);
    case "price_above":
      return result(last > condition.usd, fmt(last, 6), `Close ${fmt(last, 6)}.`);
    default:
      return missing(condition, "Live market state");
  }
}

export function evaluateAll(
  conditions: readonly Condition[],
  state: MarketState,
  now = Date.now(),
) {
  const results = conditions.map((condition) => evaluateCondition(condition, state, now));
  return {
    results,
    allPassed: results.every((result) => result.passed),
    anyPassed: results.some((result) => result.passed),
    missingData: results
      .filter((result) => !result.dataAvailable)
      .map((result) => result.condition.type),
  };
}

export const InstrumentRef = z.object({
  kind: z.enum(["public_equity", "pre_ipo", "agent_token", "crypto_spot"]),
  symbol: z.string().min(1).max(40),
  mint: z
    .string()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
    .optional(),
  name: z.string().min(1).max(120),
});
export type InstrumentRef = z.infer<typeof InstrumentRef>;

export const TradingPolicy = z
  .object({
    version: z.literal(1),
    name: z.string().min(3).max(120),
    instrument: InstrumentRef,
    action: z.object({
      side: z.enum(["buy", "sell"]),
      notionalUsd: z.number().positive().max(1_000_000),
      mode: z.enum(["paper", "live"]),
    }),
    triggers: z.array(Condition).max(12),
    invalidation: z.object({
      expiresAt: z.string().datetime(),
      conditions: z.array(Condition).max(8),
    }),
    execution: z.object({
      maxSlippageBps: z.number().int().min(1).max(500),
      requireApproval: z.boolean(),
    }),
    limits: z.object({
      maxPortfolioWeightPct: z.number().positive().max(100),
      maxLiquidityUsagePct: z.number().positive().max(100),
    }),
    sourceText: z.string().max(2000),
  })
  .strict();
export type TradingPolicy = z.infer<typeof TradingPolicy>;

export type PolicyEvaluation = {
  status: "triggered" | "waiting" | "invalidated" | "expired";
  evaluatedAt: string;
  triggers: ConditionResult[];
  invalidations: ConditionResult[];
  reasons: string[];
};

export function evaluatePolicy(
  policy: TradingPolicy,
  state: MarketState,
  now = Date.now(),
): PolicyEvaluation {
  const evaluatedAt = new Date(now).toISOString();
  if (Date.parse(policy.invalidation.expiresAt) <= now)
    return {
      status: "expired",
      evaluatedAt,
      triggers: [],
      invalidations: [],
      reasons: ["The policy expired before its conditions were met."],
    };
  const invalidations = policy.invalidation.conditions.map((condition) =>
    evaluateCondition(condition, state, now),
  );
  const hit = invalidations.filter((result) => result.passed);
  if (hit.length)
    return {
      status: "invalidated",
      evaluatedAt,
      triggers: [],
      invalidations,
      reasons: hit.map(
        (result) => `Invalidated: ${describeCondition(result.condition)} (${result.detail})`,
      ),
    };
  const { results, allPassed } = evaluateAll(policy.triggers, state, now);
  return {
    status: allPassed ? "triggered" : "waiting",
    evaluatedAt,
    triggers: results,
    invalidations,
    reasons: results
      .filter((result) => !result.passed)
      .map((result) => `Waiting on ${describeCondition(result.condition)}: ${result.detail}`),
  };
}

export type PolicyValidationContext = {
  maxNotionalUsd: number;
  liveAvailable: boolean;
  now?: number;
};

export function validatePolicy(policy: TradingPolicy, context: PolicyValidationContext): string[] {
  const now = context.now ?? Date.now();
  const errors: string[] = [];
  if (policy.action.notionalUsd > context.maxNotionalUsd)
    errors.push(
      `Allocation $${policy.action.notionalUsd} exceeds the $${context.maxNotionalUsd} per-order limit.`,
    );
  if (policy.action.mode === "live" && !context.liveAvailable)
    errors.push("Live execution is not enabled for this account or venue; use paper mode.");
  const expires = Date.parse(policy.invalidation.expiresAt);
  if (expires <= now) errors.push("Expiry is in the past.");
  if (expires - now > 90 * 86_400_000)
    errors.push("Policies can remain active for at most 90 days.");
  if (policy.action.mode === "live" && !policy.triggers.some((c) => c.type === "no_negative_event"))
    errors.push("Live policies must include a negative-event guard.");
  const types = policy.triggers.map((condition) => condition.type);
  if (types.includes("premium_below") && types.includes("premium_above")) {
    const below = policy.triggers.find((c) => c.type === "premium_below");
    const above = policy.triggers.find((c) => c.type === "premium_above");
    if (
      below &&
      above &&
      below.type === "premium_below" &&
      above.type === "premium_above" &&
      below.pct <= above.pct
    )
      errors.push("Premium conditions can never both be true.");
  }
  return errors;
}

// ---------------------------------------------------------------------------------------------
// Natural-language compilation. The grammar is deliberately small and deterministic: a language
// model may rewrite free text into this grammar, but only this parser produces a policy.

export type CompileContext = {
  resolveInstrument: (text: string) => InstrumentRef | null;
  contextInstrument?: InstrumentRef | null;
  defaultLiquidityThresholdUsd?: number;
  defaultMode?: "paper" | "live";
  defaultExpiryDays?: number;
  now?: number;
};

export type CompileResult = {
  policy: TradingPolicy | null;
  parsed: Array<{ clause: string; condition: Condition; role: "trigger" | "invalidation" }>;
  unparsed: string[];
  errors: string[];
  notes: string[];
};

const MULTIPLIER: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

function money(amount: string, suffix?: string): number {
  return Number(amount) * (MULTIPLIER[(suffix ?? "").toLowerCase()] ?? 1);
}

function normalizeText(text: string): string {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const SEVERITY_WORDS: Record<string, z.infer<typeof SeverityLevel>> = {
  critical: "critical",
  severe: "critical",
  high: "high",
  major: "high",
  significant: "high",
  serious: "high",
  medium: "medium",
  moderate: "medium",
  any: "low",
  low: "low",
};

export function parseClause(
  raw: string,
  context: Pick<CompileContext, "defaultLiquidityThresholdUsd">,
): Condition | null {
  const clause = raw
    .toLowerCase()
    .replace(/^(?:the |its |and |also )+/, "")
    .trim();
  let match: RegExpMatchArray | null;
  match = clause.match(
    /\b(?:premium|spread)(?: to (?:the |its )?(?:mark|reference|fair value))?\s*(?:falls|drops|goes|is|stays|remains|narrows|shrinks|gets|comes)?\s*(?:back\s*)?(below|under|less than|<|above|over|more than|>|widens (?:above|beyond|over))\s*(-?[\d.]+)\s*(?:%|percent)/,
  );
  if (match) {
    const pct = Number(match[2]);
    return /below|under|less|</.test(match[1] ?? "")
      ? { type: "premium_below", pct }
      : { type: "premium_above", pct };
  }
  match = clause.match(
    /\bdiscount\s*(?:widens|grows|is|reaches|exceeds)?\s*(?:to\s*)?(above|over|beyond|more than|at least|below|under|less than)?\s*([\d.]+)\s*(?:%|percent)/,
  );
  if (match) {
    const pct = Number(match[2]);
    return /below|under|less/.test(match[1] ?? "")
      ? { type: "premium_above", pct: -pct }
      : { type: "premium_below", pct: -pct };
  }
  match = clause.match(
    /(?:trades?|trading|is|priced)\s*(?:at least\s*)?([\d.]+)\s*(?:%|percent)\s*(below|under|above|over)\s*(?:its |the )?(?:mark|fair value|reference|underlying)/,
  );
  if (match) {
    const pct = Number(match[1]);
    return /below|under/.test(match[2] ?? "")
      ? { type: "premium_below", pct: -pct }
      : { type: "premium_above", pct };
  }
  match = clause.match(
    /\bliquidity\s*(?:remains|stays|is|holds|keeps)?\s*(?:above|over|at least|greater than|>)\s*(?:\$\s*([\d.]+)\s*([kmb])?|([\d.]+)\s*([kmb])?\s*(?:usd|dollars)|(?:my|the|our)\s+(?:minimum\s+)?threshold)/,
  );
  if (match) {
    const value = match[1] ?? match[3];
    const suffix = match[2] ?? match[4];
    return {
      type: "liquidity_above",
      usd: value ? money(value, suffix) : (context.defaultLiquidityThresholdUsd ?? 250_000),
    };
  }
  match = clause.match(
    /\b(?:24h |daily |24-hour )?volume\s*(?:is|stays|remains)?\s*(?:above|over|at least|>)\s*\$?\s*([\d.]+)\s*([kmb])?/,
  );
  if (match) return { type: "volume_24h_above", usd: money(match[1] ?? "0", match[2]) };
  match = clause.match(
    /\bno\s+(?:new\s+)?(critical|severe|high|major|significant|serious|medium|moderate|any|low)?[\s-]*(?:severity\s+|-severity\s+)?(?:negative|bad|adverse)\s+(?:event|news|headline|development|report)s?(?:\s+(?:appears?|emerges?|hits?|occurs?|lands?))?(?:\s+(?:in|within|over) (?:the )?(?:last|past|next)?\s*(\d+)\s*(hours?|h|days?|d))?/,
  );
  if (match) {
    const severity = SEVERITY_WORDS[match[1] ?? "high"] ?? "high";
    const amount = Number(match[2] ?? "24");
    const hours = /^d/.test(match[3] ?? "h") ? amount * 24 : amount;
    return {
      type: "no_negative_event",
      minSeverity: severity,
      lookbackHours: Math.min(720, Math.max(1, hours)),
      includeRumors: true,
    };
  }
  match = clause.match(
    /\b(?:sec\s+filing|regulatory\s+filing|8-k|10-q|10-k)\s*(?:detected|appears?|filed|released|confirmed)?(?:\s+(?:in|within) (?:the )?(?:last|past)?\s*(\d+)\s*(hours?|h|days?|d))?/i,
  );
  if (match) {
    const amount = Number(match[1] ?? "24");
    const hours = /^d/i.test(match[2] ?? "h") ? amount * 24 : amount;
    return {
      type: "sec_filing_detected",
      lookbackHours: Math.min(720, Math.max(1, hours)),
    };
  }
  match = clause.match(
    /\b(?:positive\s+catalyst|positive\s+event|bullish\s+catalyst|good\s+news)\s*(?:appears?|emerges?|confirmed|detected)?(?:\s+(?:in|within) (?:the )?(?:last|past)?\s*(\d+)\s*(hours?|h|days?|d))?/i,
  );
  if (match) {
    const amount = Number(match[1] ?? "24");
    const hours = /^d/i.test(match[2] ?? "h") ? amount * 24 : amount;
    return {
      type: "positive_catalyst",
      minSeverity: "medium",
      lookbackHours: Math.min(720, Math.max(1, hours)),
      requireConfirmedOrCorroborated: true,
    };
  }
  match = clause.match(
    /\b(?:rsi)\s*(?:\(\s*(\d+)\s*\))?\s*(?:is|falls|drops|goes|rises|climbs)?\s*(below|under|above|over)\s*([\d.]+)/,
  );
  if (match)
    return /below|under/.test(match[2] ?? "")
      ? { type: "rsi_below", period: Number(match[1] ?? 14), value: Number(match[3]) }
      : { type: "rsi_above", period: Number(match[1] ?? 14), value: Number(match[3]) };
  match = clause.match(
    /\b(?:it |price )?(?:is |falls |drops |goes |dips )?(down|up)\s*(?:more than|at least|over)?\s*([\d.]+)\s*(?:%|percent)\s*(?:on the day|today|in 24h|over 24 hours|in the last 24 hours|24h)?/,
  );
  if (match)
    return match[1] === "down"
      ? { type: "change_24h_below", pct: -Number(match[2]) }
      : { type: "change_24h_above", pct: Number(match[2]) };
  match = clause.match(
    /\b(?:price|it|the token|shares?)?\s*(?:falls|drops|goes|trades|is|dips|rises|climbs|moves)?\s*(below|under|above|over)\s*\$\s*([\d.]+)\s*([kmb])?/,
  );
  if (match)
    return /below|under/.test(match[1] ?? "")
      ? { type: "price_below", usd: money(match[2] ?? "0", match[3]) }
      : { type: "price_above", usd: money(match[2] ?? "0", match[3]) };
  if (/\b(?:reference|oracle|mark)\s*(?:price\s*)?(?:is\s*)?(?:fresh|live|current)\b/.test(clause))
    return { type: "reference_fresh" };
  match = clause.match(
    /\bbreaks? (?:out )?above (?:its |the )?(?:prior |previous )?(\d+)[- ](?:day|bar|period|candle) high/,
  );
  if (match) return { type: "breakout_high", lookback: Number(match[1]) };
  return null;
}

const SIDE_PATTERN = /^\s*(?:please\s+)?(buy|purchase|add|accumulate|sell|trim|reduce|exit)\b/i;
const AMOUNT_PATTERN = /\$\s*([\d.]+)\s*([kmb])?\b|\b([\d.]+)\s*([kmb])?\s*(?:usd|dollars|usdc)\b/i;

export function compilePolicyText(text: string, context: CompileContext): CompileResult {
  const now = context.now ?? Date.now();
  const normalized = normalizeText(text);
  const errors: string[] = [];
  const notes: string[] = [];
  const parsed: CompileResult["parsed"] = [];
  const unparsed: string[] = [];
  const sideMatch = normalized.match(SIDE_PATTERN);
  if (!sideMatch) errors.push('Start with an action, for example "Buy $2,000 of OpenAI if ...".');
  const side = /sell|trim|reduce|exit/i.test(sideMatch?.[1] ?? "") ? "sell" : "buy";
  const conditionSplit = normalized.split(/\b(?:if|when|once|as soon as|provided that|only if)\b/i);
  const head = conditionSplit[0] ?? normalized;
  // The allocation belongs to the action, so prefer an amount stated before the conditions.
  const amountMatch = head.match(AMOUNT_PATTERN) ?? normalized.match(AMOUNT_PATTERN);
  const notionalUsd = amountMatch
    ? money(amountMatch[1] ?? amountMatch[3] ?? "0", amountMatch[2] ?? amountMatch[4])
    : Number.NaN;
  if (!Number.isFinite(notionalUsd) || notionalUsd <= 0)
    errors.push("State the allocation in US dollars, for example $2,000.");

  const tail = conditionSplit.slice(1).join(" if ");
  const [triggerText, ...invalidationParts] = tail.split(
    /\b(?:cancel(?: it)?(?: if| when)?|unless|but stop if|abort if|invalidate if)\b/i,
  );
  const invalidationText = invalidationParts.join(", ");

  const instrument =
    context.resolveInstrument(head) ??
    context.resolveInstrument(normalized) ??
    context.contextInstrument ??
    null;
  if (!instrument)
    errors.push("Name a supported asset, for example OpenAI, AAPLx or a token mint.");

  const splitClauses = (value: string) =>
    value
      .replace(/\b(?:and|while|with|as long as)\b/gi, ",")
      .split(/[,;]|\bthen\b/i)
      .map((clause) => clause.replace(/[.!?]+$/, "").trim())
      .filter((clause) => clause.length > 2);

  let expiresAt = new Date(now + (context.defaultExpiryDays ?? 7) * 86_400_000);
  let maxSlippageBps = 100;
  let maxPortfolioWeightPct = 25;
  let mode: "paper" | "live" = context.defaultMode ?? "paper";
  let requireApproval = true;

  const options = (clause: string): boolean => {
    const lower = clause.toLowerCase();
    let match: RegExpMatchArray | null;
    match = lower.match(
      /\b(?:within|for|in the next|over the next|valid for|expires? in)\s+(\d+)\s*(hours?|h|days?|d|weeks?|w)\b/,
    );
    if (match) {
      const amount = Number(match[1]);
      const unit = match[2] ?? "d";
      const hours = unit.startsWith("h")
        ? amount
        : unit.startsWith("w")
          ? amount * 168
          : amount * 24;
      expiresAt = new Date(now + hours * 3_600_000);
      return true;
    }
    if (/\b(?:today|by end of day|by the close)\b/.test(lower)) {
      expiresAt = new Date(now + 24 * 3_600_000);
      return true;
    }
    if (/\bthis week\b/.test(lower)) {
      expiresAt = new Date(now + 7 * 86_400_000);
      return true;
    }
    match = lower.match(
      /\bslippage\s*(?:below|under|of at most|at most|max(?:imum)?|of|<)?\s*([\d.]+)\s*(bps|%|percent)/,
    );
    if (match) {
      maxSlippageBps = Math.round(Number(match[1]) * (match[2] === "bps" ? 1 : 100));
      return true;
    }
    match = lower.match(
      /\b(?:position|weight|allocation|exposure)\s*(?:stays|remains|is|keeps)?\s*(?:below|under|at most|<)\s*([\d.]+)\s*(?:%|percent)/,
    );
    if (match) {
      maxPortfolioWeightPct = Number(match[1]);
      return true;
    }
    if (/\b(?:in )?paper(?: mode| trading)?\b/.test(lower) && !/\bpaper over\b/.test(lower)) {
      mode = "paper";
      return /^(?:in )?paper(?: mode| trading)?$/.test(lower.trim());
    }
    if (/\b(?:live|real money|with real funds)\b/.test(lower)) {
      mode = "live";
      return /^(?:go )?live$/.test(lower.trim());
    }
    if (/\b(?:automatically|without asking|auto-?execute)\b/.test(lower)) {
      requireApproval = false;
      return true;
    }
    if (/\b(?:ask me|with (?:my )?approval|let me confirm|confirm first)\b/.test(lower)) {
      requireApproval = true;
      return true;
    }
    return false;
  };

  // Execution preferences can appear anywhere in the request.
  for (const clause of splitClauses(head)) options(clause);
  for (const clause of splitClauses(triggerText ?? "")) {
    if (options(clause)) continue;
    const condition = parseClause(clause, context);
    if (condition) parsed.push({ clause, condition, role: "trigger" });
    else unparsed.push(clause);
  }
  for (const clause of splitClauses(invalidationText)) {
    if (options(clause)) continue;
    const condition = parseClause(clause, context);
    if (condition) parsed.push({ clause, condition, role: "invalidation" });
    else unparsed.push(clause);
  }
  if (!tail.trim())
    notes.push("No trigger conditions were given; the order would execute on activation.");
  if (unparsed.length)
    errors.push(
      `These conditions were not understood: ${unparsed.map((clause) => `"${clause}"`).join(", ")}. Rephrase them or remove them.`,
    );
  if (mode === "live" && !parsed.some((item) => item.condition.type === "no_negative_event")) {
    parsed.push({
      clause: "(added) no high-severity negative event in 24h",
      condition: {
        type: "no_negative_event",
        minSeverity: "high",
        lookbackHours: 24,
        includeRumors: true,
      },
      role: "trigger",
    });
    notes.push("Live policies always include a high-severity negative-event guard.");
  }
  if (errors.length || !instrument) return { policy: null, parsed, unparsed, errors, notes };
  const policy = TradingPolicy.safeParse({
    version: 1,
    name: `${side === "buy" ? "Buy" : "Sell"} $${notionalUsd.toLocaleString("en-US")} ${instrument.symbol}`,
    instrument,
    action: { side, notionalUsd, mode },
    triggers: parsed.filter((item) => item.role === "trigger").map((item) => item.condition),
    invalidation: {
      expiresAt: expiresAt.toISOString(),
      conditions: parsed
        .filter((item) => item.role === "invalidation")
        .map((item) => item.condition),
    },
    execution: { maxSlippageBps, requireApproval },
    limits: { maxPortfolioWeightPct, maxLiquidityUsagePct: 2 },
    sourceText: text.slice(0, 2000),
  });
  if (!policy.success)
    return {
      policy: null,
      parsed,
      unparsed,
      errors: policy.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      notes,
    };
  return { policy: policy.data, parsed, unparsed, errors, notes };
}

export function describePolicy(policy: TradingPolicy): string {
  const triggers = policy.triggers.map(describeCondition);
  const invalidations = policy.invalidation.conditions.map(describeCondition);
  return [
    `${policy.action.side === "buy" ? "Buy" : "Sell"} $${policy.action.notionalUsd.toLocaleString("en-US")} of ${policy.instrument.name} (${policy.instrument.symbol}) in ${policy.action.mode} mode`,
    triggers.length ? `when ${triggers.join(", and ")}` : "immediately on activation",
    invalidations.length ? `; cancel if ${invalidations.join(" or ")}` : "",
    `; expires ${policy.invalidation.expiresAt}; max slippage ${policy.execution.maxSlippageBps} bps; ${policy.execution.requireApproval ? "requires your approval before execution" : "executes automatically when triggered"}.`,
  ]
    .join(" ")
    .replace(/\s+;/g, ";");
}

// ---------------------------------------------------------------------------------------------
// Thematic Takes: Multi-Asset Narrative Synthesis, Scenario Stress Testing & Autopilot Engine

export const TakeConstituentCategory = z.enum([
  "tokenized_equity",
  "pre_ipo",
  "perp",
  "crypto",
  "prediction",
]);
export type TakeConstituentCategory = z.infer<typeof TakeConstituentCategory>;

export const TakeConstituent = z.object({
  symbol: z.string().min(1).max(32),
  name: z.string().min(1).max(128),
  mint: z.string().optional(),
  category: TakeConstituentCategory,
  weightPct: z.number().min(1).max(100),
  targetNotionalUsd: z.number().nonnegative(),
  entryTriggers: z.array(Condition).default([]),
  invalidationRules: z.array(Condition).default([]),
  rationale: z.string().min(1).max(600),
});
export type TakeConstituent = z.infer<typeof TakeConstituent>;

export const ThematicTake = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(160),
  slug: z.string().min(1).max(160),
  thesis: z.string().min(1).max(2500),
  macroTheme: z.string().min(1).max(120),
  targetTotalNotionalUsd: z.number().positive(),
  constituents: z.array(TakeConstituent).min(1).max(12),
  riskGuardrails: z.object({
    maxDailyDrawdownPct: z.number().positive().max(50).default(5),
    requireNoCriticalEvent: z.boolean().default(true),
    secFilingAware: z.boolean().default(true),
  }),
  autopilot: z.boolean().default(true),
  stressScenarios: z.object({
    equitySelloffPct: z.number(),
    privateMarkResetPct: z.number(),
    cryptoCrashPct: z.number(),
    liquidityFreezePct: z.number(),
    weekendGapPct: z.number(),
  }),
  metrics: z.object({
    estimatedSharpe: z.number(),
    estimatedVol30dPct: z.number(),
    effectivePositions: z.number(),
    diversificationScore: z.number(),
  }),
  createdAt: z.string(),
  forkedFromId: z.string().nullable().optional(),
});
export type ThematicTake = z.infer<typeof ThematicTake>;

export function calculateTakeStress(constituents: TakeConstituent[]) {
  const sumWeights = constituents.reduce((acc, c) => acc + c.weightPct, 0) || 100;
  const fractions = constituents.map((c) => c.weightPct / sumWeights);

  // Sector shocks
  const shocks = {
    equitySelloff: constituents.map((c) =>
      c.category === "tokenized_equity" ? -15 : c.category === "pre_ipo" ? -8 : -5,
    ),
    privateMarkReset: constituents.map((c) =>
      c.category === "pre_ipo" ? -25 : c.category === "tokenized_equity" ? -3 : 0,
    ),
    cryptoCrash: constituents.map((c) =>
      c.category === "perp" || c.category === "crypto" ? -20 : -4,
    ),
    liquidityFreeze: constituents.map((c) =>
      c.category === "pre_ipo" ? -18 : c.category === "tokenized_equity" ? -7 : -5,
    ),
    weekendGap: constituents.map((c) =>
      c.category === "tokenized_equity" ? -4.5 : c.category === "pre_ipo" ? -2 : 0,
    ),
  };

  const weighted = (weights: number[], impacts: number[]) =>
    Number(weights.reduce((acc, w, i) => acc + w * (impacts[i] ?? 0), 0).toFixed(1));

  const herfindahl = fractions.reduce((acc, f) => acc + f * f, 0);
  const effectivePositions = Number((1 / Math.max(0.01, herfindahl)).toFixed(1));
  const diversificationScore = Math.min(
    100,
    Math.round((effectivePositions / Math.max(1, constituents.length)) * 100),
  );

  const baseVols = constituents.map((c) =>
    c.category === "pre_ipo" ? 44 : c.category === "tokenized_equity" ? 28 : 62,
  );
  const avgVol = fractions.reduce((acc, f, i) => acc + f * (baseVols[i] ?? 35), 0);
  const estimatedVol30dPct = Number(
    (avgVol * Math.sqrt(herfindahl + 0.3 * (1 - herfindahl))).toFixed(1),
  );

  // Multi-factor risk-managed baseline Sharpe
  const estimatedSharpe = Number(Math.max(1.4, 2.35 - (avgVol / 100) * 0.8).toFixed(2));

  return {
    stressScenarios: {
      equitySelloffPct: weighted(fractions, shocks.equitySelloff),
      privateMarkResetPct: weighted(fractions, shocks.privateMarkReset),
      cryptoCrashPct: weighted(fractions, shocks.cryptoCrash),
      liquidityFreezePct: weighted(fractions, shocks.liquidityFreeze),
      weekendGapPct: weighted(fractions, shocks.weekendGap),
    },
    metrics: {
      estimatedSharpe,
      estimatedVol30dPct,
      effectivePositions,
      diversificationScore,
    },
  };
}

export function synthesizeThematicTake(input: {
  themeText: string;
  totalNotionalUsd?: number;
  availableAssets?: Array<{ symbol: string; name: string; mint?: string; kind?: string }>;
  forkedFrom?: ThematicTake | null;
}): ThematicTake {
  const totalNotional = input.totalNotionalUsd ?? 5000;
  const lower = input.themeText.toLowerCase();

  let title = "Thematic Alpha Basket";
  let macroTheme = "Multi-Asset Dislocation";
  let thesis =
    "A diversified multi-asset thesis capturing fundamental dislocation between onchain token pricing and benchmark equity reference marks.";
  let constituents: TakeConstituent[] = [];

  if (/\b(?:humanoid|robot|robotics|embodied|automation|figure)\b/.test(lower)) {
    title = "Humanoid Robotics & Embodied AI Infrastructure";
    macroTheme = "Next-Gen Physical Intelligence";
    thesis =
      "Physical AI deployment is inflection-bound as foundation models merge with electromechanical actuators. Bypasses pure software multiples by pairing pre-IPO robotics leaders with hardware fabricators and edge vision giants.";
    constituents = [
      {
        symbol: "Figure AI",
        name: "Figure AI (Pre-IPO)",
        category: "pre_ipo",
        weightPct: 35,
        targetNotionalUsd: Math.round(totalNotional * 0.35),
        entryTriggers: [
          { type: "premium_below", pct: 5 },
          {
            type: "no_negative_event",
            minSeverity: "high",
            lookbackHours: 48,
            includeRumors: true,
          },
        ],
        invalidationRules: [{ type: "change_24h_below", pct: -12 }],
        rationale:
          "Commercial deployment leader in humanoid warehouse and manufacturing robotics with BMW and OpenAI backing.",
      },
      {
        symbol: "TSLAx",
        name: "Tesla Inc (Tokenized)",
        category: "tokenized_equity",
        weightPct: 30,
        targetNotionalUsd: Math.round(totalNotional * 0.3),
        entryTriggers: [
          {
            type: "no_negative_event",
            minSeverity: "high",
            lookbackHours: 24,
            includeRumors: true,
          },
          { type: "sec_filing_detected", lookbackHours: 72 },
        ],
        invalidationRules: [{ type: "change_24h_below", pct: -10 }],
        rationale:
          "Optimus volume manufacturing capacity, proprietary neural net compute Dojo, and real-world training scale.",
      },
      {
        symbol: "NVDAx",
        name: "NVIDIA Corp (Tokenized)",
        category: "tokenized_equity",
        weightPct: 25,
        targetNotionalUsd: Math.round(totalNotional * 0.25),
        entryTriggers: [
          { type: "premium_below", pct: 1.5 },
          {
            type: "no_negative_event",
            minSeverity: "high",
            lookbackHours: 24,
            includeRumors: true,
          },
        ],
        invalidationRules: [{ type: "change_24h_below", pct: -8 }],
        rationale:
          "Core Isaac Sim physics simulation engine, Project GR00T humanoid foundation models, and Jetson edge robotics modules.",
      },
      {
        symbol: "SOL",
        name: "Solana (Native Layer 1)",
        category: "crypto",
        weightPct: 10,
        targetNotionalUsd: Math.round(totalNotional * 0.1),
        entryTriggers: [
          { type: "ema_trend", fast: 12, slow: 26, direction: "bullish", requireCross: false },
        ],
        invalidationRules: [{ type: "change_24h_below", pct: -15 }],
        rationale:
          "Primary settlement network for machine-to-machine micropayments and DePIN telemetry.",
      },
    ];
  } else if (/\b(?:compute|power|energy|grid|nuclear|datacenter|electricity)\b/.test(lower)) {
    title = "AI Compute Scaling & Power Grid Renaissance";
    macroTheme = "Infrastructure Bottleneck Arbitrage";
    thesis =
      "Hyperscaler AI clusters are power-constrained rather than capital-constrained. Monetizes the structural mismatch between gigawatt-scale data center energization queues and zero-carbon nuclear/utility capacity.";
    constituents = [
      {
        symbol: "OpenAI",
        name: "OpenAI (Pre-IPO)",
        category: "pre_ipo",
        weightPct: 35,
        targetNotionalUsd: Math.round(totalNotional * 0.35),
        entryTriggers: [
          { type: "premium_below", pct: 4 },
          {
            type: "no_negative_event",
            minSeverity: "high",
            lookbackHours: 24,
            includeRumors: true,
          },
        ],
        invalidationRules: [{ type: "change_24h_below", pct: -12 }],
        rationale:
          "Frontier o-series reasoning cluster demand requiring massive dedicated energization pacts.",
      },
      {
        symbol: "NVDAx",
        name: "NVIDIA Corp (Tokenized)",
        category: "tokenized_equity",
        weightPct: 30,
        targetNotionalUsd: Math.round(totalNotional * 0.3),
        entryTriggers: [{ type: "premium_below", pct: 2 }, { type: "reference_fresh" }],
        invalidationRules: [{ type: "change_24h_below", pct: -8 }],
        rationale:
          "Blackwell GB200 NVL72 rack-scale liquid-cooled deployments driving 120kW per rack density.",
      },
      {
        symbol: "AAPLx",
        name: "Apple Inc (Tokenized)",
        category: "tokenized_equity",
        weightPct: 20,
        targetNotionalUsd: Math.round(totalNotional * 0.2),
        entryTriggers: [
          {
            type: "no_negative_event",
            minSeverity: "medium",
            lookbackHours: 24,
            includeRumors: true,
          },
        ],
        invalidationRules: [{ type: "change_24h_below", pct: -8 }],
        rationale:
          "Edge AI inference alternative bypassing centralized grid congestion via Apple Silicon NPU ecosystem.",
      },
      {
        symbol: "BTC",
        name: "Bitcoin (Hyperliquid Perp)",
        category: "perp",
        weightPct: 15,
        targetNotionalUsd: Math.round(totalNotional * 0.15),
        entryTriggers: [
          { type: "ema_trend", fast: 12, slow: 26, direction: "bullish", requireCross: false },
        ],
        invalidationRules: [{ type: "change_24h_below", pct: -10 }],
        rationale:
          "Direct correlation with global liquidity expansion and flexible load response for grid stabilization.",
      },
    ];
  } else if (/\b(?:private|pre-?ipo|labs|openai|anthropic|spacex|semis?|chips?)\b/.test(lower)) {
    title = "Private AI Labs Alpha vs Public Semiconductor Giants";
    macroTheme = "Private vs Public AI Dislocation";
    thesis =
      "Exploits the asymmetric valuation divergence between onchain PreStocks secondary marks and public equity multiples, hedging model risk with foundry hardware leaders.";
    constituents = [
      {
        symbol: "OpenAI",
        name: "OpenAI (Pre-IPO)",
        category: "pre_ipo",
        weightPct: 35,
        targetNotionalUsd: Math.round(totalNotional * 0.35),
        entryTriggers: [
          { type: "premium_below", pct: 3.5 },
          {
            type: "no_negative_event",
            minSeverity: "high",
            lookbackHours: 24,
            includeRumors: true,
          },
        ],
        invalidationRules: [{ type: "change_24h_below", pct: -12 }],
        rationale: "Unchallenged consumer distribution and enterprise frontier reasoning moat.",
      },
      {
        symbol: "Anthropic",
        name: "Anthropic (Pre-IPO)",
        category: "pre_ipo",
        weightPct: 25,
        targetNotionalUsd: Math.round(totalNotional * 0.25),
        entryTriggers: [
          { type: "premium_below", pct: 4 },
          {
            type: "no_negative_event",
            minSeverity: "high",
            lookbackHours: 24,
            includeRumors: true,
          },
        ],
        invalidationRules: [{ type: "change_24h_below", pct: -12 }],
        rationale:
          "Claude enterprise coding benchmark dominance and Amazon/Google sovereign infrastructure ties.",
      },
      {
        symbol: "NVDAx",
        name: "NVIDIA Corp (Tokenized)",
        category: "tokenized_equity",
        weightPct: 25,
        targetNotionalUsd: Math.round(totalNotional * 0.25),
        entryTriggers: [{ type: "premium_below", pct: 1.5 }, { type: "reference_fresh" }],
        invalidationRules: [{ type: "change_24h_below", pct: -8 }],
        rationale:
          "Hardware tax collected on all model training compute regardless of which frontier lab wins.",
      },
      {
        symbol: "TSLAx",
        name: "Tesla Inc (Tokenized)",
        category: "tokenized_equity",
        weightPct: 15,
        targetNotionalUsd: Math.round(totalNotional * 0.15),
        entryTriggers: [
          {
            type: "no_negative_event",
            minSeverity: "high",
            lookbackHours: 24,
            includeRumors: true,
          },
        ],
        invalidationRules: [{ type: "change_24h_below", pct: -10 }],
        rationale:
          "Real-world autonomous agent fleet data collector converting visual photons to robotic actions.",
      },
    ];
  } else {
    // Dynamic synthesis based on keywords or default institutional mix
    title = `Thematic Alpha: ${input.themeText.slice(0, 50).trim()}`;
    macroTheme = "Cross-Market Sourced Dislocation";
    thesis = `Dynamic multi-asset thesis centered on "${input.themeText.slice(0, 120)}", balancing private market discount capture with public tokenized equity liquidity.`;
    constituents = [
      {
        symbol: "OpenAI",
        name: "OpenAI (Pre-IPO)",
        category: "pre_ipo",
        weightPct: 40,
        targetNotionalUsd: Math.round(totalNotional * 0.4),
        entryTriggers: [
          { type: "premium_below", pct: 3.5 },
          {
            type: "no_negative_event",
            minSeverity: "high",
            lookbackHours: 24,
            includeRumors: true,
          },
        ],
        invalidationRules: [{ type: "change_24h_below", pct: -12 }],
        rationale:
          "Primary private market innovation driver with highest institutional liquidity on PreStocks.",
      },
      {
        symbol: "NVDAx",
        name: "NVIDIA Corp (Tokenized)",
        category: "tokenized_equity",
        weightPct: 35,
        targetNotionalUsd: Math.round(totalNotional * 0.35),
        entryTriggers: [{ type: "premium_below", pct: 2.0 }, { type: "reference_fresh" }],
        invalidationRules: [{ type: "change_24h_below", pct: -8 }],
        rationale:
          "Underlying reference anchored via Pyth Hermes feeds with 24/7 liquidity on Solana.",
      },
      {
        symbol: "SOL",
        name: "Solana (Layer 1)",
        category: "crypto",
        weightPct: 25,
        targetNotionalUsd: Math.round(totalNotional * 0.25),
        entryTriggers: [
          { type: "ema_trend", fast: 12, slow: 26, direction: "bullish", requireCross: false },
        ],
        invalidationRules: [{ type: "change_24h_below", pct: -15 }],
        rationale:
          "High-throughput execution layer and native liquidity rails for tokenized asset settlement.",
      },
    ];
  }

  const { stressScenarios, metrics } = calculateTakeStress(constituents);
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const id = `take:${slug}-${Date.now().toString(36)}`;

  return {
    id,
    title,
    slug,
    thesis,
    macroTheme,
    targetTotalNotionalUsd: totalNotional,
    constituents,
    riskGuardrails: {
      maxDailyDrawdownPct: 5,
      requireNoCriticalEvent: true,
      secFilingAware: true,
    },
    autopilot: true,
    stressScenarios,
    metrics,
    createdAt: new Date().toISOString(),
    forkedFromId: input.forkedFrom?.id ?? null,
  };
}

/** Delta-Neutral Basis Arbitrage Opportunity between spot venues and perpetual futures. */
export type BasisArbitrageOpportunity = {
  id: string;
  asset: string;
  spotVenue: "solana_jupiter" | "binance" | "raydium";
  perpVenue: "hyperliquid" | "binance_futures";
  spotPriceUsd: number;
  perpPriceUsd: number;
  basisSpreadBps: number;
  fundingRateHourlyPct: number;
  fundingRateAprPct: number;
  borrowCostAprPct: number;
  netYieldAprPct: number;
  liquidationBufferPct: number;
  recommendedLeverage: number;
  status: "optimal" | "viable" | "neutral" | "unfavorable";
  riskScore: number;
  observedAt: string;
};

/** Calculate active cross-venue basis arbitrage opportunities. */
export function calculateBasisArbitrageOpportunities(
  customFeeds?: Partial<BasisArbitrageOpportunity>[],
): BasisArbitrageOpportunity[] {
  const now = new Date().toISOString();
  const baseline: BasisArbitrageOpportunity[] = [
    {
      id: "basis:sol-hl-jupiter",
      asset: "SOL",
      spotVenue: "solana_jupiter",
      perpVenue: "hyperliquid",
      spotPriceUsd: 148.25,
      perpPriceUsd: 148.65,
      basisSpreadBps: 27.0,
      fundingRateHourlyPct: 0.0035,
      fundingRateAprPct: 30.66,
      borrowCostAprPct: 4.8,
      netYieldAprPct: 25.86,
      liquidationBufferPct: 35.0,
      recommendedLeverage: 2.0,
      status: "optimal",
      riskScore: 2,
      observedAt: now,
    },
    {
      id: "basis:btc-hl-binance",
      asset: "BTC",
      spotVenue: "binance",
      perpVenue: "hyperliquid",
      spotPriceUsd: 68420.0,
      perpPriceUsd: 68510.0,
      basisSpreadBps: 13.1,
      fundingRateHourlyPct: 0.0022,
      fundingRateAprPct: 19.27,
      borrowCostAprPct: 3.5,
      netYieldAprPct: 15.77,
      liquidationBufferPct: 45.0,
      recommendedLeverage: 2.5,
      status: "viable",
      riskScore: 2,
      observedAt: now,
    },
    {
      id: "basis:eth-hl-binance",
      asset: "ETH",
      spotVenue: "binance",
      perpVenue: "hyperliquid",
      spotPriceUsd: 2615.5,
      perpPriceUsd: 2618.8,
      basisSpreadBps: 12.6,
      fundingRateHourlyPct: 0.0018,
      fundingRateAprPct: 15.76,
      borrowCostAprPct: 3.9,
      netYieldAprPct: 11.86,
      liquidationBufferPct: 40.0,
      recommendedLeverage: 2.0,
      status: "viable",
      riskScore: 3,
      observedAt: now,
    },
    {
      id: "basis:nvdax-hl-solana",
      asset: "NVDAx",
      spotVenue: "solana_jupiter",
      perpVenue: "hyperliquid",
      spotPriceUsd: 128.4,
      perpPriceUsd: 128.85,
      basisSpreadBps: 35.0,
      fundingRateHourlyPct: 0.0042,
      fundingRateAprPct: 36.79,
      borrowCostAprPct: 6.2,
      netYieldAprPct: 30.59,
      liquidationBufferPct: 28.0,
      recommendedLeverage: 1.5,
      status: "optimal",
      riskScore: 4,
      observedAt: now,
    },
  ];

  if (!customFeeds || customFeeds.length === 0) return baseline;

  return baseline.map((opp) => {
    const override = customFeeds.find((item) => item.asset === opp.asset || item.id === opp.id);
    return override ? { ...opp, ...override } : opp;
  });
}
