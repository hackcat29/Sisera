import type { Candle } from "@sisera/domain";
import { describe, expect, it } from "vitest";
import {
  StrategyRules,
  backtestGate,
  canPromote,
  checkCircuitBreakers,
  dispositionFor,
  evaluateTick,
  runBacktest,
  runStressTests,
} from "../src/index.js";

function series(length: number): Candle[] {
  return Array.from({ length }, (_, index) => {
    const close = 100 + Math.sin(index / 9) * 12 + index * 0.05;
    return {
      time: 1_600_000_000 + index * 86_400,
      open: String(close - 0.5),
      high: String(close + 1.5),
      low: String(close - 1.5),
      close: String(close),
      volume: String(1000 + (index % 7) * 100),
    };
  });
}

const rules = StrategyRules.parse({
  entry: [{ type: "ema_trend", fast: 5, slow: 20, direction: "bullish", requireCross: true }],
  exit: [{ type: "ema_trend", fast: 5, slow: 20, direction: "bearish" }],
  positionSizeUsd: 1000,
  stopLossPct: 8,
  takeProfitPct: 20,
});
const config = { initialCapitalUsd: 10_000, feeBps: 10, slippageBps: 10, barsPerYear: 365 };

describe("backtest", () => {
  it("replays rules without look-ahead and reports metrics", () => {
    const result = runBacktest(series(2000), rules, config);
    expect(result.metrics.tradeCount).toBeGreaterThan(10);
    expect(result.years).toBeGreaterThan(5);
    expect(Number.isFinite(result.metrics.sharpe)).toBe(true);
    const gate = backtestGate(result);
    expect(["passed", "failed", "inconclusive"]).toContain(gate.outcome);
    expect(gate.checks[0]?.passed).toBe(true);
  });

  it("marks short histories inconclusive and flags live-only conditions", () => {
    const withEvents = StrategyRules.parse({
      ...rules,
      entry: [...rules.entry, { type: "premium_below", pct: 2 }],
    });
    const result = runBacktest(series(200), withEvents, config);
    expect(result.untestedConditions).toEqual(["premium_below"]);
    expect(backtestGate(result).outcome).toBe("inconclusive");
  });

  it("runs stress scenarios", () => {
    const results = runStressTests(series(600), rules, config);
    expect(results.map((result) => result.id)).toEqual([
      "flash_crash",
      "gap_down",
      "liquidity_freeze",
      "quote_depeg",
    ]);
  });
});

describe("governance", () => {
  it("enforces sequential promotion with evidence and independent approval", () => {
    expect(
      canPromote("draft", "paper", new Set(), { hasRules: true, independentApproval: true })
        .allowed,
    ).toBe(false);
    expect(
      canPromote("backtest", "stress_test", new Set(), {
        hasRules: true,
        independentApproval: false,
      }).allowed,
    ).toBe(false);
    expect(
      canPromote("backtest", "stress_test", new Set(["backtest"]), {
        hasRules: true,
        independentApproval: false,
      }).allowed,
    ).toBe(true);
    expect(
      canPromote("shadow", "limited_live", new Set(["shadow"]), {
        hasRules: true,
        independentApproval: false,
      }).allowed,
    ).toBe(false);
    expect(
      canPromote("live", "paused", new Set(), { hasRules: true, independentApproval: false })
        .allowed,
    ).toBe(true);
  });

  it("trips circuit breakers", () => {
    expect(
      checkCircuitBreakers({
        dailyPnlPct: -4,
        maxDailyDrawdownPct: 3.5,
        realizedSlippageBps: 2,
        expectedSlippageBps: 5,
        dataAgeMs: 100,
      }).action,
    ).toBe("pause");
    expect(
      checkCircuitBreakers({
        dailyPnlPct: 0,
        maxDailyDrawdownPct: 3.5,
        realizedSlippageBps: 40,
        expectedSlippageBps: 10,
        dataAgeMs: 100,
      }).action,
    ).toBe("demote_to_paper");
    expect(
      checkCircuitBreakers({
        dailyPnlPct: 0,
        maxDailyDrawdownPct: 3.5,
        realizedSlippageBps: null,
        expectedSlippageBps: 10,
        dataAgeMs: 6000,
      }).action,
    ).toBe("pause");
  });

  it("evaluates ticks and maps autonomy", () => {
    const decision = evaluateTick(
      rules,
      { candles: series(80), price: 50 },
      { quantity: 1, entryPrice: 100, openedAt: "", barsHeld: 1 },
    );
    expect(decision).toMatchObject({ action: "exit", exitReason: "stop_loss" });
    expect(dispositionFor("confirm", "enter")).toBe("await_approval");
    expect(dispositionFor("risk_only", "enter")).toBe("record");
    expect(dispositionFor("risk_only", "exit")).toBe("execute");
  });

  it("triggers trailing stop when price pulls back from peak", () => {
    const trailingRules = StrategyRules.parse({
      ...rules,
      stopLossPct: 15,
      trailingStopPct: 5,
    });
    // Entry price 100, peak was 120, current price 113 (more than 5% pullback from 120)
    const decision = evaluateTick(
      trailingRules,
      { candles: series(80), price: 113 },
      { quantity: 1, entryPrice: 100, openedAt: "", barsHeld: 5, highestPrice: 120 },
    );
    expect(decision).toMatchObject({ action: "exit", exitReason: "trailing_stop" });
  });
});
