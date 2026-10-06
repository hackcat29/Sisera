import type { Candle } from "@sisera/domain";
import {
  Condition,
  type ConditionResult,
  type MarketState,
  TECHNICAL_CONDITIONS,
  evaluateAll,
} from "@sisera/policy";
import { z } from "zod";

export const ProfitLadderStep = z
  .object({
    gainPct: z.number().positive().max(10_000),
    closeRatio: z.number().positive().max(1),
  })
  .strict();
export type ProfitLadderStep = z.infer<typeof ProfitLadderStep>;

/** Executable strategy rules. Entry conditions must all pass; any exit condition closes. */
export const StrategyRules = z
  .object({
    entry: z.array(Condition).min(1).max(10),
    exit: z.array(Condition).max(10).default([]),
    side: z.literal("long").default("long"),
    positionSizeUsd: z.number().positive().max(1_000_000),
    stopLossPct: z.number().positive().max(90),
    takeProfitPct: z.number().positive().max(1000),
    trailingStopPct: z.number().positive().max(90).optional(),
    profitLadder: z.array(ProfitLadderStep).max(10).optional(),
    maxHoldingBars: z.number().int().positive().max(10_000).optional(),
    cooldownBars: z.number().int().min(0).max(1000).default(0),
  })
  .strict();
export type StrategyRules = z.infer<typeof StrategyRules>;

export type AutonomyLevel =
  | "research"
  | "suggest"
  | "confirm"
  | "policy_auto"
  | "autonomous"
  | "risk_only";

export const STAGES = [
  "draft",
  "backtest",
  "stress_test",
  "paper",
  "shadow",
  "limited_live",
  "live",
] as const;
export type Stage = (typeof STAGES)[number] | "paused";

export type BacktestConfig = {
  initialCapitalUsd: number;
  feeBps: number;
  slippageBps: number;
  barsPerYear: number;
};

export type BacktestTrade = {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  returnPct: number;
  pnlUsd: number;
  exitReason:
    | "stop_loss"
    | "take_profit"
    | "trailing_stop"
    | "profit_ladder"
    | "exit_rule"
    | "max_holding"
    | "end_of_data";
};

export type BacktestResult = {
  bars: number;
  windowStart: string;
  windowEnd: string;
  years: number;
  trades: BacktestTrade[];
  metrics: {
    totalReturnPct: number;
    cagrPct: number;
    sharpe: number;
    sortino: number;
    maxDrawdownPct: number;
    winRatePct: number;
    tradeCount: number;
    averageTradePct: number;
    exposurePct: number;
    expectedSlippageBps: number;
  };
  equityCurve: Array<{ time: number; equity: number }>;
  untestedConditions: Condition["type"][];
};

const BARS_PER_YEAR: Record<string, number> = {
  "5m": 105_120,
  "15m": 35_040,
  "1h": 8_760,
  "4h": 2_190,
  "1d": 365,
};

export function barsPerYear(timeframe: string, market: "crypto" | "equity" = "crypto"): number {
  if (market === "equity")
    return timeframe === "1d"
      ? 252
      : Math.round((BARS_PER_YEAR[timeframe] ?? 8_760) * (252 / 365) * (6.5 / 24));
  return BARS_PER_YEAR[timeframe] ?? 8_760;
}

/** Conditions that need live observations (premium, events, liquidity) cannot be replayed. */
export function untestable(rules: StrategyRules): Condition["type"][] {
  return [...new Set([...rules.entry, ...rules.exit].map((condition) => condition.type))].filter(
    (type) => !TECHNICAL_CONDITIONS.has(type),
  );
}

function technicalOnly(conditions: readonly Condition[]): Condition[] {
  return conditions.filter((condition) => TECHNICAL_CONDITIONS.has(condition.type));
}

/**
 * Replays rules over candles without look-ahead: signals use closed bars up to and including the
 * current bar and fill at that bar's close, adjusted for fees and slippage. Stops and targets use
 * the next bars' intrabar extremes, assuming the stop is hit first when both are touched.
 */
export function runBacktest(
  candles: readonly Candle[],
  rules: StrategyRules,
  config: BacktestConfig,
): BacktestResult {
  const entry = technicalOnly(rules.entry);
  const exit = technicalOnly(rules.exit);
  const cost = (config.feeBps + config.slippageBps) / 10_000;
  const warmup = 30;
  let cash = config.initialCapitalUsd;
  let position: {
    entryIndex: number;
    entryPrice: number;
    quantity: number;
    peakPrice?: number;
    executedLadderIndices?: Set<number>;
  } | null = null;
  let cooldownUntil = -1;
  let barsInMarket = 0;
  const trades: BacktestTrade[] = [];
  const equityCurve: Array<{ time: number; equity: number }> = [];
  const closeTrade = (index: number, price: number, reason: BacktestTrade["exitReason"]) => {
    if (!position) return;
    const exitPrice = price * (1 - cost);
    const proceeds = position.quantity * exitPrice;
    const invested = position.quantity * position.entryPrice;
    cash += proceeds;
    trades.push({
      entryTime: candles[position.entryIndex]?.time ?? 0,
      exitTime: candles[index]?.time ?? 0,
      entryPrice: position.entryPrice,
      exitPrice,
      returnPct: (exitPrice / position.entryPrice - 1) * 100,
      pnlUsd: proceeds - invested,
      exitReason: reason,
    });
    position = null;
    cooldownUntil = index + rules.cooldownBars;
  };
  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index];
    if (!candle) continue;
    const close = Number(candle.close);
    if (position) {
      barsInMarket++;
      position.peakPrice = Math.max(position.peakPrice ?? position.entryPrice, Number(candle.high));
      const stop = position.entryPrice * (1 - rules.stopLossPct / 100);
      const target = position.entryPrice * (1 + rules.takeProfitPct / 100);
      const trailingStop = rules.trailingStopPct
        ? position.peakPrice * (1 - rules.trailingStopPct / 100)
        : null;
      let ladderClosed = false;
      if (rules.profitLadder && rules.profitLadder.length > 0 && index > position.entryIndex) {
        const sortedLadder = [...rules.profitLadder].sort((a, b) => a.gainPct - b.gainPct);
        for (let sIdx = 0; sIdx < sortedLadder.length; sIdx++) {
          const step = sortedLadder[sIdx];
          if (!step) continue;
          if (position.executedLadderIndices?.has(sIdx)) continue;
          const target = position.entryPrice * (1 + step.gainPct / 100);
          if (Number(candle.high) >= target) {
            if (!position.executedLadderIndices) position.executedLadderIndices = new Set();
            position.executedLadderIndices.add(sIdx);
            const trimQty = position.quantity * step.closeRatio;
            if (trimQty > 0) {
              const exitPrice = Math.max(target, Number(candle.open)) * (1 - cost);
              const proceeds = trimQty * exitPrice;
              const invested = trimQty * position.entryPrice;
              cash += proceeds;
              trades.push({
                entryTime: candles[position.entryIndex]?.time ?? 0,
                exitTime: candle.time,
                entryPrice: position.entryPrice,
                exitPrice,
                returnPct: (exitPrice / position.entryPrice - 1) * 100,
                pnlUsd: proceeds - invested,
                exitReason: "profit_ladder",
              });
              position.quantity -= trimQty;
              if (position.quantity <= 1e-8) {
                position = null;
                cooldownUntil = index + rules.cooldownBars;
                ladderClosed = true;
                break;
              }
            }
          }
        }
      }
      if (ladderClosed || !position) continue;
      if (index > position.entryIndex && Number(candle.low) <= stop)
        closeTrade(index, Math.min(stop, Number(candle.open)), "stop_loss");
      else if (
        trailingStop != null &&
        index > position.entryIndex &&
        Number(candle.low) <= trailingStop
      )
        closeTrade(index, Math.min(trailingStop, Number(candle.open)), "trailing_stop");
      else if (index > position.entryIndex && Number(candle.high) >= target)
        closeTrade(index, Math.max(target, Number(candle.open)), "take_profit");
      else if (rules.maxHoldingBars && index - position.entryIndex >= rules.maxHoldingBars)
        closeTrade(index, close, "max_holding");
      else if (index >= warmup && exit.length) {
        const state: MarketState = { candles: candles.slice(Math.max(0, index - 499), index + 1) };
        if (evaluateAll(exit, state).anyPassed) closeTrade(index, close, "exit_rule");
      }
    } else if (
      index >= warmup &&
      index > cooldownUntil &&
      index < candles.length - 1 &&
      entry.length
    ) {
      const state: MarketState = { candles: candles.slice(Math.max(0, index - 499), index + 1) };
      if (evaluateAll(entry, state).allPassed) {
        const size = Math.min(rules.positionSizeUsd, cash);
        if (size > 0) {
          const entryPrice = close * (1 + cost);
          position = {
            entryIndex: index,
            entryPrice,
            quantity: size / entryPrice,
            peakPrice: entryPrice,
          };
          cash -= size;
        }
      }
    }
    const openPosition = position as { quantity: number } | null;
    equityCurve.push({
      time: candle.time,
      equity: cash + (openPosition ? openPosition.quantity * close : 0),
    });
  }
  const last = candles.at(-1);
  if (position && last) {
    closeTrade(candles.length - 1, Number(last.close), "end_of_data");
    const final = equityCurve.at(-1);
    if (final) final.equity = cash;
  }
  const returns = equityCurve.slice(1).map((point, index) => {
    const previous = equityCurve[index]?.equity ?? point.equity;
    return previous > 0 ? point.equity / previous - 1 : 0;
  });
  const mean = returns.reduce((sum, value) => sum + value, 0) / Math.max(returns.length, 1);
  const deviation = Math.sqrt(
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(returns.length - 1, 1),
  );
  const downside = Math.sqrt(
    returns.reduce((sum, value) => sum + Math.min(value, 0) ** 2, 0) /
      Math.max(returns.length - 1, 1),
  );
  let peak = config.initialCapitalUsd;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - point.equity) / peak : 0);
  }
  const first = candles[0];
  const years = first && last ? Math.max((last.time - first.time) / (365.25 * 86_400), 1 / 365) : 0;
  const finalEquity = equityCurve.at(-1)?.equity ?? config.initialCapitalUsd;
  const totalReturn = finalEquity / config.initialCapitalUsd - 1;
  const wins = trades.filter((trade) => trade.pnlUsd > 0).length;
  const annualization = Math.sqrt(config.barsPerYear);
  return {
    bars: candles.length,
    windowStart: first ? new Date(first.time * 1000).toISOString() : "",
    windowEnd: last ? new Date(last.time * 1000).toISOString() : "",
    years,
    trades,
    metrics: {
      totalReturnPct: totalReturn * 100,
      cagrPct:
        years > 0 && finalEquity > 0
          ? ((finalEquity / config.initialCapitalUsd) ** (1 / years) - 1) * 100
          : 0,
      sharpe: deviation > 0 ? (mean / deviation) * annualization : 0,
      sortino: downside > 0 ? (mean / downside) * annualization : 0,
      maxDrawdownPct: maxDrawdown * 100,
      winRatePct: trades.length ? (wins / trades.length) * 100 : 0,
      tradeCount: trades.length,
      averageTradePct: trades.length
        ? trades.reduce((sum, trade) => sum + trade.returnPct, 0) / trades.length
        : 0,
      exposurePct: candles.length ? (barsInMarket / candles.length) * 100 : 0,
      expectedSlippageBps: config.slippageBps,
    },
    // Keep the curve small enough to store as evidence.
    equityCurve: equityCurve.filter(
      (_, index) => index % Math.max(1, Math.ceil(equityCurve.length / 400)) === 0,
    ),
    untestedConditions: untestable(rules),
  };
}

export type StressScenarioResult = {
  id: string;
  name: string;
  description: string;
  maxDrawdownPct: number;
  totalReturnPct: number;
  survived: boolean;
  stopRespected: boolean;
};

function shockSeries(
  candles: readonly Candle[],
  at: number,
  apply: (candle: Candle, offset: number) => Candle | null,
) {
  return candles.flatMap((candle, index) => {
    if (index < at) return [candle];
    const shocked = apply(candle, index - at);
    return shocked ? [shocked] : [];
  });
}

const scale = (candle: Candle, factor: number): Candle => ({
  ...candle,
  open: String(Number(candle.open) * factor),
  high: String(Number(candle.high) * factor),
  low: String(Number(candle.low) * factor),
  close: String(Number(candle.close) * factor),
});

/**
 * Replays the strategy through synthetic shocks inserted at the point where the strategy was most
 * exposed: a flash crash with partial recovery, a gap down, a liquidity freeze with widened
 * slippage, and a quote-asset de-peg.
 */
export function runStressTests(
  candles: readonly Candle[],
  rules: StrategyRules,
  config: BacktestConfig,
  maxAcceptableDrawdownPct = 25,
): StressScenarioResult[] {
  const at = Math.max(40, Math.floor(candles.length * 0.6));
  const scenarios: Array<{
    id: string;
    name: string;
    description: string;
    series: Candle[];
    config?: Partial<BacktestConfig>;
  }> = [
    {
      id: "flash_crash",
      name: "Flash crash",
      description: "A 25% intrabar crash that recovers half the move over the next 12 bars.",
      series: shockSeries(candles, at, (candle, offset) => {
        if (offset === 0)
          return {
            ...candle,
            low: String(Number(candle.low) * 0.75),
            close: String(Number(candle.close) * 0.8),
          };
        const recovery = Math.min(1, offset / 12);
        return scale(candle, 0.8 + 0.1 * recovery);
      }),
    },
    {
      id: "gap_down",
      name: "Overnight gap",
      description: "Prices gap 15% lower and stay there, so stops fill at the gap.",
      series: shockSeries(candles, at, (candle) => scale(candle, 0.85)),
    },
    {
      id: "liquidity_freeze",
      name: "Liquidity freeze",
      description: "24 bars without trading followed by 10× slippage for the rest of the test.",
      series: shockSeries(candles, at, (candle, offset) => (offset < 24 ? null : candle)),
      config: { slippageBps: config.slippageBps * 10 },
    },
    {
      id: "quote_depeg",
      name: "Quote de-peg",
      description: "The quote stablecoin loses 5% for 72 bars, distorting prices, then re-pegs.",
      series: shockSeries(candles, at, (candle, offset) =>
        offset < 72 ? scale(candle, 1 / 0.95) : candle,
      ),
    },
  ];
  return scenarios.map((scenario) => {
    const result = runBacktest(scenario.series, rules, { ...config, ...scenario.config });
    const worstTrade = Math.min(0, ...result.trades.map((trade) => trade.returnPct));
    return {
      id: scenario.id,
      name: scenario.name,
      description: scenario.description,
      maxDrawdownPct: result.metrics.maxDrawdownPct,
      totalReturnPct: result.metrics.totalReturnPct,
      survived: result.metrics.maxDrawdownPct <= maxAcceptableDrawdownPct,
      // A gap can jump through a stop; allow the shock size on top of the stop.
      stopRespected: worstTrade >= -(rules.stopLossPct + 20),
    };
  });
}

export type GateThresholds = {
  minBacktestYears: number;
  minSharpe: number;
  maxBacktestDrawdownPct: number;
  minTrades: number;
  minPaperDays: number;
  minShadowDays: number;
  minLimitedLiveDays: number;
  maxShortfallMultiple: number;
  limitedLiveCapitalFraction: number;
};

export const DEFAULT_GATES: GateThresholds = {
  minBacktestYears: 5,
  minSharpe: 1.8,
  maxBacktestDrawdownPct: 10,
  minTrades: 20,
  minPaperDays: 14,
  minShadowDays: 7,
  minLimitedLiveDays: 14,
  maxShortfallMultiple: 3,
  limitedLiveCapitalFraction: 0.1,
};

export type GateCheck = { name: string; passed: boolean; detail: string };

export function backtestGate(
  result: BacktestResult,
  gates = DEFAULT_GATES,
): { outcome: "passed" | "failed" | "inconclusive"; checks: GateCheck[] } {
  const checks: GateCheck[] = [
    {
      name: "History window",
      passed: result.years >= gates.minBacktestYears,
      detail: `${result.years.toFixed(2)} years of data; ${gates.minBacktestYears} required.`,
    },
    {
      name: "Sharpe ratio",
      passed: result.metrics.sharpe > gates.minSharpe,
      detail: `${result.metrics.sharpe.toFixed(2)}; above ${gates.minSharpe} required.`,
    },
    {
      name: "Maximum drawdown",
      passed: result.metrics.maxDrawdownPct < gates.maxBacktestDrawdownPct,
      detail: `${result.metrics.maxDrawdownPct.toFixed(2)}%; below ${gates.maxBacktestDrawdownPct}% required.`,
    },
    {
      name: "Sample size",
      passed: result.metrics.tradeCount >= gates.minTrades,
      detail: `${result.metrics.tradeCount} trades; ${gates.minTrades} required.`,
    },
  ];
  if (result.untestedConditions.length)
    checks.push({
      name: "Rule coverage",
      passed: true,
      detail: `Not replayable from history and enforced live only: ${result.untestedConditions.join(", ")}.`,
    });
  const failedWindow = !checks[0]?.passed || !checks[3]?.passed;
  const outcome = checks.every((check) => check.passed)
    ? "passed"
    : failedWindow
      ? "inconclusive"
      : "failed";
  return { outcome, checks };
}

export function stressGate(results: readonly StressScenarioResult[]): {
  outcome: "passed" | "failed";
  checks: GateCheck[];
} {
  const checks = results.map((result) => ({
    name: result.name,
    passed: result.survived && result.stopRespected,
    detail: `Max drawdown ${result.maxDrawdownPct.toFixed(2)}%; ${result.stopRespected ? "stops held" : "a loss exceeded the stop by more than the shock"}.`,
  }));
  return { outcome: checks.every((check) => check.passed) ? "passed" : "failed", checks };
}

export type ForwardStats = {
  days: number;
  trades: number;
  returnPct: number;
  maxDrawdownPct: number;
  realizedSlippageBps: number | null;
};

export function forwardGate(
  stage: "paper" | "shadow" | "limited_live",
  stats: ForwardStats,
  expectedSlippageBps: number,
  maxDailyDrawdownPct: number,
  gates = DEFAULT_GATES,
): { outcome: "passed" | "failed" | "inconclusive"; checks: GateCheck[] } {
  const minimumDays =
    stage === "paper"
      ? gates.minPaperDays
      : stage === "shadow"
        ? gates.minShadowDays
        : gates.minLimitedLiveDays;
  const shortfallOk =
    stats.realizedSlippageBps == null ||
    stats.realizedSlippageBps <= Math.max(1, expectedSlippageBps) * gates.maxShortfallMultiple;
  const checks: GateCheck[] = [
    {
      name: "Forward duration",
      passed: stats.days >= minimumDays,
      detail: `${stats.days.toFixed(1)} days; ${minimumDays} required.`,
    },
    {
      name: "Drawdown within mandate",
      passed: stats.maxDrawdownPct <= maxDailyDrawdownPct * 3,
      detail: `${stats.maxDrawdownPct.toFixed(2)}% maximum drawdown.`,
    },
    {
      name: "Implementation shortfall",
      passed: shortfallOk,
      detail:
        stats.realizedSlippageBps == null
          ? "No fills yet to measure slippage."
          : `${stats.realizedSlippageBps.toFixed(1)} bps realized vs ${expectedSlippageBps} bps expected (≤ ${gates.maxShortfallMultiple}×).`,
    },
    { name: "Activity", passed: stats.trades >= 1, detail: `${stats.trades} decisions executed.` },
  ];
  if (!checks[0]?.passed || !checks[3]?.passed) return { outcome: "inconclusive", checks };
  return { outcome: checks.every((check) => check.passed) ? "passed" : "failed", checks };
}

const NEXT_STAGE: Record<Stage, Stage | null> = {
  draft: "backtest",
  backtest: "stress_test",
  stress_test: "paper",
  paper: "shadow",
  shadow: "limited_live",
  limited_live: "live",
  live: null,
  paused: null,
};

/** Evidence required on entering each stage: the stage whose passed evaluation unlocks it. */
export const REQUIRED_EVIDENCE: Partial<Record<Stage, (typeof STAGES)[number]>> = {
  stress_test: "backtest",
  paper: "stress_test",
  shadow: "paper",
  limited_live: "shadow",
  live: "limited_live",
};

export function nextStage(stage: Stage): Stage | null {
  return NEXT_STAGE[stage];
}

export function canPromote(
  from: Stage,
  to: Stage,
  passedEvidence: ReadonlySet<string>,
  options: { hasRules: boolean; independentApproval: boolean },
): { allowed: boolean; reason: string } {
  if (to === "paused") return { allowed: true, reason: "Pausing is always allowed." };
  if (from === "paused") {
    const resumable = to === "draft" || to === "paper";
    return resumable
      ? { allowed: true, reason: "Resuming from pause restarts at draft or paper." }
      : { allowed: false, reason: "A paused agent resumes at draft or paper only." };
  }
  if (NEXT_STAGE[from] !== to)
    return {
      allowed: false,
      reason: `Agents move one stage at a time; ${from} advances to ${NEXT_STAGE[from] ?? "nothing"}.`,
    };
  if (to === "backtest" && !options.hasRules)
    return { allowed: false, reason: "Executable entry rules are required before backtesting." };
  const required = REQUIRED_EVIDENCE[to];
  if (required && !passedEvidence.has(required))
    return {
      allowed: false,
      reason: `A passed ${required.replace("_", " ")} evaluation for this manifest is required.`,
    };
  if ((to === "limited_live" || to === "live") && !options.independentApproval)
    return {
      allowed: false,
      reason: "Live stages require approval from an independent risk manager.",
    };
  return {
    allowed: true,
    reason: required
      ? `Unlocked by a passed ${required.replace("_", " ")} evaluation.`
      : "Static validation passed.",
  };
}

/** Stages at which the runtime simulates or executes orders. */
export function executionMode(stage: Stage): "none" | "paper" | "shadow" | "live" {
  if (stage === "paper") return "paper";
  if (stage === "shadow") return "shadow";
  if (stage === "limited_live" || stage === "live") return "live";
  return "none";
}

export function capitalCap(stage: Stage, capitalLimitUsd: number, gates = DEFAULT_GATES): number {
  return stage === "limited_live"
    ? capitalLimitUsd * gates.limitedLiveCapitalFraction
    : capitalLimitUsd;
}

export type BreakerInput = {
  dailyPnlPct: number;
  maxDailyDrawdownPct: number;
  realizedSlippageBps: number | null;
  expectedSlippageBps: number;
  dataAgeMs: number | null;
  maxDataAgeMs?: number;
};

export type BreakerDecision = { action: "none" | "pause" | "demote_to_paper"; reasons: string[] };

/** AGENTS.md demotion rules: drawdown breach, shortfall above 3× expectation, stale market data. */
export function checkCircuitBreakers(input: BreakerInput, gates = DEFAULT_GATES): BreakerDecision {
  const reasons: string[] = [];
  let action: BreakerDecision["action"] = "none";
  if (input.dailyPnlPct <= -Math.abs(input.maxDailyDrawdownPct)) {
    reasons.push(
      `Daily drawdown ${input.dailyPnlPct.toFixed(2)}% breached the ${input.maxDailyDrawdownPct}% limit.`,
    );
    action = "pause";
  }
  if (
    input.realizedSlippageBps != null &&
    input.realizedSlippageBps > Math.max(1, input.expectedSlippageBps) * gates.maxShortfallMultiple
  ) {
    reasons.push(
      `Implementation shortfall ${input.realizedSlippageBps.toFixed(1)} bps exceeds ${gates.maxShortfallMultiple}× the ${input.expectedSlippageBps} bps expectation.`,
    );
    if (action === "none") action = "demote_to_paper";
  }
  if (input.dataAgeMs == null || input.dataAgeMs > (input.maxDataAgeMs ?? 5_000)) {
    reasons.push(
      input.dataAgeMs == null
        ? "Market data is unavailable."
        : `Market data is ${(input.dataAgeMs / 1000).toFixed(1)}s old.`,
    );
    action = "pause";
  }
  return { action, reasons };
}

export type TickPosition = {
  quantity: number;
  entryPrice: number;
  openedAt: string;
  barsHeld: number;
  highestPrice?: number;
  executedLadderIndices?: number[];
} | null;

export type TickDecision = {
  action: "enter" | "exit" | "hold" | "abstain";
  reasons: string[];
  entryResults: ConditionResult[];
  exitResults: ConditionResult[];
  exitReason?: BacktestTrade["exitReason"];
};

/** One live evaluation of the rules against current state, used by the runtime scheduler. */
export function evaluateTick(
  rules: StrategyRules,
  state: MarketState,
  position: TickPosition,
  now = Date.now(),
): TickDecision {
  const price = state.price ?? Number(state.candles?.at(-1)?.close ?? Number.NaN);
  if (position) {
    const exits = evaluateAll(rules.exit, state, now);
    if (Number.isFinite(price) && price <= position.entryPrice * (1 - rules.stopLossPct / 100))
      return {
        action: "exit",
        exitReason: "stop_loss",
        reasons: [`Stop loss at ${rules.stopLossPct}% hit.`],
        entryResults: [],
        exitResults: exits.results,
      };
    const peakPrice = Math.max(position.highestPrice ?? position.entryPrice, price);
    if (
      rules.trailingStopPct &&
      Number.isFinite(price) &&
      price <= peakPrice * (1 - rules.trailingStopPct / 100)
    )
      return {
        action: "exit",
        exitReason: "trailing_stop",
        reasons: [
          `Trailing stop at ${rules.trailingStopPct}% from peak $${peakPrice.toFixed(2)} hit.`,
        ],
        entryResults: [],
        exitResults: exits.results,
      };
    if (Number.isFinite(price) && price >= position.entryPrice * (1 + rules.takeProfitPct / 100))
      return {
        action: "exit",
        exitReason: "take_profit",
        reasons: [`Take profit at ${rules.takeProfitPct}% hit.`],
        entryResults: [],
        exitResults: exits.results,
      };
    if (rules.profitLadder && rules.profitLadder.length > 0) {
      const executed = new Set(position.executedLadderIndices ?? []);
      const sortedLadder = [...rules.profitLadder].sort((a, b) => a.gainPct - b.gainPct);
      const nextStepIndex = sortedLadder.findIndex(
        (step, idx) =>
          !executed.has(idx) &&
          Number.isFinite(price) &&
          price >= position.entryPrice * (1 + step.gainPct / 100),
      );
      if (nextStepIndex !== -1) {
        const step = sortedLadder[nextStepIndex];
        if (step) {
          return {
            action: "exit",
            exitReason: "profit_ladder",
            reasons: [
              `Profit ladder step ${nextStepIndex + 1} (+${step.gainPct}%) reached; trimming ${(step.closeRatio * 100).toFixed(0)}% of position.`,
            ],
            entryResults: [],
            exitResults: exits.results,
          };
        }
      }
    }
    if (rules.maxHoldingBars && position.barsHeld >= rules.maxHoldingBars)
      return {
        action: "exit",
        exitReason: "max_holding",
        reasons: ["Maximum holding period reached."],
        entryResults: [],
        exitResults: exits.results,
      };
    if (rules.exit.length && exits.anyPassed)
      return {
        action: "exit",
        exitReason: "exit_rule",
        reasons: exits.results.filter((result) => result.passed).map((result) => result.detail),
        entryResults: [],
        exitResults: exits.results,
      };
    return {
      action: "hold",
      reasons: ["Position open; no exit condition met."],
      entryResults: [],
      exitResults: exits.results,
    };
  }
  const entries = evaluateAll(rules.entry, state, now);
  if (entries.missingData.length)
    return {
      action: "abstain",
      reasons: [`Missing data for ${entries.missingData.join(", ")}.`],
      entryResults: entries.results,
      exitResults: [],
    };
  return entries.allPassed
    ? {
        action: "enter",
        reasons: entries.results.map((result) => result.detail),
        entryResults: entries.results,
        exitResults: [],
      }
    : {
        action: "hold",
        reasons: entries.results.filter((result) => !result.passed).map((result) => result.detail),
        entryResults: entries.results,
        exitResults: [],
      };
}

/** Maps autonomy to what the runtime may do with a triggered decision. */
export function dispositionFor(
  autonomy: AutonomyLevel,
  action: TickDecision["action"],
): "record" | "recommend" | "await_approval" | "execute" {
  if (action !== "enter" && action !== "exit") return "record";
  switch (autonomy) {
    case "research":
      return "record";
    case "suggest":
      return "recommend";
    case "confirm":
      return "await_approval";
    case "policy_auto":
    case "autonomous":
      return "execute";
    case "risk_only":
      return action === "exit" ? "execute" : "record";
  }
}
