import { createHash } from "node:crypto";
import { Condition } from "@sisera/policy";
import { z } from "zod";

export const AgentRulesInput = z
  .object({
    entry: z.array(Condition).min(1).max(10),
    exit: z.array(Condition).max(10).default([]),
    maxHoldingBars: z.coerce.number().int().positive().max(10_000).optional(),
    cooldownBars: z.coerce.number().int().min(0).max(1000).default(0),
    trailingStopPct: z.coerce.number().positive().max(90).optional(),
  })
  .strict();

export const AgentDraftInput = z
  .object({
    name: z.string().trim().min(3).max(80),
    description: z.string().trim().min(20).max(1000),
    universe: z
      .array(z.string().regex(/^[A-Za-z0-9:*\/_.-]{2,64}$/))
      .min(1)
      .max(12),
    timeframe: z.enum(["5m", "15m", "1h", "4h", "1d", "event"]),
    factors: z.array(z.string().trim().min(3).max(120)).min(1).max(8),
    capitalLimitUsd: z.coerce.number().positive().max(1_000_000),
    maxTradeNotionalUsd: z.coerce.number().positive().max(100_000),
    maxDailyDrawdownPct: z.coerce.number().positive().max(10),
    maxOpenPositions: z.coerce.number().int().positive().max(20),
    stopLossPct: z.coerce.number().positive().max(30),
    takeProfitPct: z.coerce.number().positive().max(100),
    maxSlippageBps: z.coerce.number().nonnegative().max(500),
    /** Executable rules; without them an agent stays a research draft. */
    rules: AgentRulesInput.optional(),
    /** The owner's Solana wallet used only if the agent later reaches a live stage. */
    liveWallet: z
      .string()
      .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
      .optional(),
  })
  .strict()
  .refine((value) => value.maxTradeNotionalUsd <= value.capitalLimitUsd, {
    message: "Trade notional cannot exceed capital allocation",
    path: ["maxTradeNotionalUsd"],
  });

export type AgentDraftInput = z.infer<typeof AgentDraftInput>;

export function compileAgentDraft(input: AgentDraftInput) {
  const policy = {
    description: input.description,
    universe: input.universe,
    timeframe: input.timeframe,
    factors: input.factors,
    capitalAllocation: {
      maxCapitalUsd: input.capitalLimitUsd,
      maxTradeNotionalUsd: input.maxTradeNotionalUsd,
      maxLeverage: 1,
    },
    riskGuardrails: {
      maxDailyDrawdownPct: input.maxDailyDrawdownPct,
      maxOpenPositions: input.maxOpenPositions,
      stopLossPct: input.stopLossPct,
      takeProfitPct: input.takeProfitPct,
      killSwitchAction: "CANCEL_ALL_AND_HALT",
    },
    execution: {
      maxSlippageBps: input.maxSlippageBps,
      proposalOnly: true,
      ...(input.liveWallet ? { liveWallet: input.liveWallet } : {}),
    },
    ...(input.rules ? { rules: input.rules } : {}),
    sandboxRequirements: { maxCpuMs: 1_000, maxMemoryMb: 128, networkAccess: false },
    lifecycle: ["draft", "backtest", "stress_test", "paper", "shadow", "limited_live", "live"],
  };
  return {
    policy,
    manifestHash: createHash("sha256").update(JSON.stringify(policy)).digest("hex"),
  };
}

/** The manifest fields the runtime reads, validated whenever a stored manifest is loaded. */
export const StoredAgentPolicy = z
  .object({
    description: z.string().optional(),
    universe: z.array(z.string()),
    timeframe: z.string(),
    factors: z.array(z.string()).default([]),
    capitalAllocation: z.object({
      maxCapitalUsd: z.number(),
      maxTradeNotionalUsd: z.number(),
      maxLeverage: z.number().default(1),
    }),
    riskGuardrails: z.object({
      maxDailyDrawdownPct: z.number(),
      maxOpenPositions: z.number(),
      stopLossPct: z.number(),
      takeProfitPct: z.number(),
      killSwitchAction: z.string().default("CANCEL_ALL_AND_HALT"),
    }),
    execution: z
      .object({
        maxSlippageBps: z.number(),
        proposalOnly: z.boolean().default(true),
        liveWallet: z.string().optional(),
      })
      .passthrough(),
    rules: AgentRulesInput.optional(),
  })
  .passthrough();
export type StoredAgentPolicy = z.infer<typeof StoredAgentPolicy>;
