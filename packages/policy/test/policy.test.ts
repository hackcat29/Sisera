import type { Candle } from "@sisera/domain";
import { describe, expect, it } from "vitest";
import {
  type InstrumentRef,
  calculateBasisArbitrageOpportunities,
  compilePolicyText,
  evaluateCondition,
  evaluatePolicy,
  parseClause,
  synthesizeThematicTake,
  validatePolicy,
} from "../src/index.js";

const now = Date.parse("2026-09-29T12:00:00Z");
const openai: InstrumentRef = { kind: "pre_ipo", symbol: "OPENAI", name: "OpenAI" };
const resolveInstrument = (text: string) => (/openai/i.test(text) ? openai : null);

describe("policy compiler", () => {
  it("compiles the canonical conversational request", () => {
    const result = compilePolicyText(
      "Buy $2,000 if the premium falls below 3%, liquidity remains above my threshold, and no high-severity negative event appears.",
      { resolveInstrument, contextInstrument: openai, defaultLiquidityThresholdUsd: 400_000, now },
    );
    expect(result.errors).toEqual([]);
    expect(result.policy?.action).toEqual({ side: "buy", notionalUsd: 2000, mode: "paper" });
    expect(result.policy?.triggers).toEqual([
      { type: "premium_below", pct: 3 },
      { type: "liquidity_above", usd: 400_000 },
      { type: "no_negative_event", minSeverity: "high", lookbackHours: 24, includeRumors: true },
    ]);
    expect(result.policy?.execution.requireApproval).toBe(true);
  });

  it("parses invalidations, expiry and execution options", () => {
    const result = compilePolicyText(
      "Buy $1.5k of OpenAI within 3 days when the discount widens beyond 5% and volume above $250k, automatically, slippage under 50 bps. Cancel if price below $100",
      { resolveInstrument, now },
    );
    expect(result.errors).toEqual([]);
    expect(result.policy?.action.notionalUsd).toBe(1500);
    expect(result.policy?.triggers).toContainEqual({ type: "premium_below", pct: -5 });
    expect(result.policy?.triggers).toContainEqual({ type: "volume_24h_above", usd: 250_000 });
    expect(result.policy?.invalidation.conditions).toEqual([{ type: "price_below", usd: 100 }]);
    expect(result.policy?.execution).toEqual({ maxSlippageBps: 50, requireApproval: false });
    expect(Date.parse(result.policy?.invalidation.expiresAt ?? "")).toBe(now + 3 * 86_400_000);
  });

  it("refuses to guess unknown conditions or missing amounts", () => {
    const unknown = compilePolicyText("Buy $500 of OpenAI if the vibes are good", {
      resolveInstrument,
      now,
    });
    expect(unknown.policy).toBeNull();
    expect(unknown.unparsed).toEqual(["the vibes are good"]);
    const noAmount = compilePolicyText("Buy OpenAI if premium below 2%", {
      resolveInstrument,
      now,
    });
    expect(noAmount.policy).toBeNull();
  });

  it("adds an event guard to live policies", () => {
    const result = compilePolicyText("Buy $100 of OpenAI live if premium below 1%", {
      resolveInstrument,
      now,
    });
    expect(result.policy?.action.mode).toBe("live");
    expect(result.policy?.triggers.some((c) => c.type === "no_negative_event")).toBe(true);
    expect(
      validatePolicy(result.policy as NonNullable<typeof result.policy>, {
        maxNotionalUsd: 500,
        liveAvailable: false,
        now,
      }),
    ).toContain("Live execution is not enabled for this account or venue; use paper mode.");
  });

  it("parses common clause forms", () => {
    expect(parseClause("RSI(14) drops below 30", {})).toEqual({
      type: "rsi_below",
      period: 14,
      value: 30,
    });
    expect(parseClause("it trades 4% below its mark", {})).toEqual({
      type: "premium_below",
      pct: -4,
    });
    expect(parseClause("down more than 5% today", {})).toEqual({
      type: "change_24h_below",
      pct: -5,
    });
    expect(parseClause("no critical negative news in the last 2 days", {})).toEqual({
      type: "no_negative_event",
      minSeverity: "critical",
      lookbackHours: 48,
      includeRumors: true,
    });
  });
});

describe("policy evaluation", () => {
  const policy = compilePolicyText(
    "Buy $2000 of OpenAI if premium below 3%, liquidity above $100k, no high severity negative event. Cancel if premium above 20%",
    { resolveInstrument, now },
  ).policy as NonNullable<ReturnType<typeof compilePolicyText>["policy"]>;

  it("fails closed on missing data", () => {
    const evaluation = evaluatePolicy(policy, { premiumPct: 1 }, now);
    expect(evaluation.status).toBe("waiting");
    expect(
      evaluation.triggers.find((r) => r.condition.type === "liquidity_above")?.dataAvailable,
    ).toBe(false);
  });

  it("triggers, invalidates and expires", () => {
    expect(
      evaluatePolicy(policy, { premiumPct: 1, liquidityUsd: 200_000, events: [] }, now).status,
    ).toBe("triggered");
    expect(
      evaluatePolicy(
        policy,
        {
          premiumPct: 1,
          liquidityUsd: 200_000,
          events: [
            {
              severity: "high",
              sentiment: "negative",
              certainty: "corroborated",
              lastSeenAt: new Date(now - 3_600_000).toISOString(),
              headline: "Probe",
            },
          ],
        },
        now,
      ).status,
    ).toBe("waiting");
    expect(
      evaluatePolicy(policy, { premiumPct: 25, liquidityUsd: 200_000, events: [] }, now).status,
    ).toBe("invalidated");
    expect(evaluatePolicy(policy, { premiumPct: 1 }, now + 30 * 86_400_000).status).toBe("expired");
  });

  it("evaluates technical conditions from candles", () => {
    const candles: Candle[] = Array.from({ length: 60 }, (_, index) => ({
      time: 1_700_000_000 + index * 3600,
      open: String(100 + index),
      high: String(101 + index),
      low: String(99 + index),
      close: String(100 + index),
      volume: String(index === 59 ? 500 : 100),
    }));
    expect(
      evaluateCondition(
        { type: "ema_trend", fast: 12, slow: 26, direction: "bullish", requireCross: false },
        { candles },
      ).passed,
    ).toBe(true);
    expect(evaluateCondition({ type: "breakout_high", lookback: 20 }, { candles }).passed).toBe(
      false,
    );
    expect(
      evaluateCondition({ type: "relative_volume_above", lookback: 20, ratio: 3 }, { candles })
        .passed,
    ).toBe(true);
    expect(
      evaluateCondition({ type: "rsi_above", period: 14, value: 70 }, { candles }).passed,
    ).toBe(true);
  });

  it("evaluates SEC filing and positive catalyst conditions", () => {
    const now = 1_700_000_000_000;
    const events = [
      {
        severity: "high" as const,
        sentiment: "positive" as const,
        certainty: "confirmed",
        lastSeenAt: new Date(now - 1_800_000).toISOString(),
        headline: "Item 2.02: Operating Results Exceed Expectations (SEC 8-K Filing)",
        sourceTier: "regulatory_filing",
      },
    ];

    expect(
      evaluateCondition({ type: "sec_filing_detected", lookbackHours: 24 }, { events }, now).passed,
    ).toBe(true);
    expect(
      evaluateCondition(
        { type: "sec_filing_detected", lookbackHours: 24, itemCode: "Item 2.02" },
        { events },
        now,
      ).passed,
    ).toBe(true);
    expect(
      evaluateCondition(
        {
          type: "positive_catalyst",
          minSeverity: "medium",
          lookbackHours: 24,
          requireConfirmedOrCorroborated: true,
        },
        { events },
        now,
      ).passed,
    ).toBe(true);
  });

  it("synthesizes thematic takes and computes stress scenarios", () => {
    const take = synthesizeThematicTake({
      themeText: "Humanoid robots will transform domestic and industrial labor",
      totalNotionalUsd: 10_000,
    });
    expect(take.title).toContain("Humanoid Robotics");
    expect(take.constituents.length).toBeGreaterThanOrEqual(3);
    expect(take.targetTotalNotionalUsd).toBe(10_000);
    expect(take.stressScenarios.equitySelloffPct).toBeLessThan(0);
    expect(take.stressScenarios.privateMarkResetPct).toBeLessThan(0);
    expect(take.metrics.estimatedSharpe).toBeGreaterThan(1.0);
    expect(take.metrics.effectivePositions).toBeGreaterThan(1.5);
    expect(take.autopilot).toBe(true);
    expect(take.riskGuardrails.secFilingAware).toBe(true);
  });

  it("evaluates funding rate and basis spread conditions", () => {
    const fundingCondition = { type: "funding_rate_above" as const, aprPct: 20 };
    expect(evaluateCondition(fundingCondition, { fundingRateAprPct: 25.5 }).passed).toBe(true);
    expect(evaluateCondition(fundingCondition, { fundingRateAprPct: 15.0 }).passed).toBe(false);
    expect(evaluateCondition(fundingCondition, {}).passed).toBe(false);

    const spreadCondition = { type: "basis_spread_above" as const, bps: 25 };
    expect(evaluateCondition(spreadCondition, { basisSpreadBps: 27.5 }).passed).toBe(true);
    expect(evaluateCondition(spreadCondition, { basisSpreadBps: 15.0 }).passed).toBe(false);
    expect(evaluateCondition(spreadCondition, {}).passed).toBe(false);
  });

  it("calculates active cross-venue basis arbitrage opportunities", () => {
    const opportunities = calculateBasisArbitrageOpportunities();
    expect(opportunities.length).toBeGreaterThanOrEqual(3);
    const sol = opportunities.find((o) => o.asset === "SOL");
    expect(sol).toBeDefined();
    expect(sol?.netYieldAprPct).toBeGreaterThan(15);
    expect(sol?.spotVenue).toBe("solana_jupiter");
    expect(sol?.perpVenue).toBe("hyperliquid");
    expect(sol?.status).toBe("optimal");
  });
});
