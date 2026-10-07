import {
  type AutonomyLevel,
  DEFAULT_GATES,
  type Stage,
  StrategyRules,
  backtestGate,
  barsPerYear,
  canPromote,
  capitalCap,
  checkCircuitBreakers,
  dispositionFor,
  evaluateTick,
  executionMode,
  forwardGate,
  runBacktest,
  runStressTests,
  stressGate,
} from "@sisera/agent-runtime";
import {
  type AgentRuntimeState,
  type AgentStateRow,
  appendAgentState,
  createAgentManifest,
  createAgentOrder,
  expireAgentOrders,
  getAgentRuntimeState,
  getAgentState,
  getLatestAgentManifest,
  insertAgentManifestVersion,
  listAgentDecisions,
  listAgentEvaluations,
  listAgentFills,
  listAgentManifestVersions,
  listAgentManifests,
  listAgentOrders,
  listAgentStateHistory,
  listAgentStates,
  listRunnableAgents,
  recordAgentDecision,
  recordAgentEvaluation,
  recordAgentFill,
  saveAgentRuntimeState,
  transitionAgentOrder,
} from "@sisera/db";
import type { Candle, MarketSnapshot, UserRole } from "@sisera/domain";
import { roleCan } from "@sisera/domain";
import type { BasisArbitrageOpportunity } from "@sisera/policy";
import type { FastifyBaseLogger } from "fastify";
import { AgentDraftInput, StoredAgentPolicy, compileAgentDraft } from "../agent-governance.js";
import type { HeliusClient } from "../helius.js";
import type { SolanaTradingService } from "../solana-trading.js";
import type { AssetCatalog, CatalogAsset } from "./catalog.js";
import type { DelegatedSigner } from "./delegated-signer.js";
import type { HistoryService } from "./history.js";
import type { LiveBasisService } from "./live-basis.js";
import type { MarketStateBuilder } from "./market-state.js";

export class AgentError extends Error {
  constructor(
    message: string,
    readonly statusCode = 422,
  ) {
    super(message);
  }
}

type Principal = { subject: string; tenantId: string; roles: readonly UserRole[] };

export type AgentDependencies = {
  basis?: LiveBasisService;
  databaseUrl: string;
  catalog: AssetCatalog;
  history: HistoryService;
  states: MarketStateBuilder;
  spot: {
    getSnapshot(symbol: string): Promise<MarketSnapshot>;
    getCandles?(symbol: string, interval?: string, limit?: number): Promise<Candle[]>;
  };
  trading: SolanaTradingService;
  helius: HeliusClient;
  signer: DelegatedSigner;
  liveAgentsEnabled: boolean;
  log: FastifyBaseLogger;
};

const SYSTEM_BACKTESTER = "system:sisera-backtester";
const SYSTEM_RUNTIME = "system:sisera-runtime";
const FEE_BPS = 10;
const TIMEFRAME_MS: Record<string, number> = {
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

const stageOf = (state: AgentStateRow | null): Stage =>
  (state?.stage as Stage | undefined) ?? "draft";
const autonomyOf = (state: AgentStateRow | null): AutonomyLevel =>
  (state?.autonomy as AutonomyLevel | undefined) ?? "research";

function bumpVersion(version: string): string {
  const [major = 1, minor = 0] = version.split(".").map(Number);
  return `${major}.${minor + 1}.0`;
}

/**
 * The agent lifecycle: immutable manifests, evidence-producing evaluations, gated promotion and a
 * runtime that evaluates rules, applies autonomy and circuit breakers, and routes every order
 * through Sisera's pre-trade checks. Agents never hold keys and never call venues directly.
 */
export class AgentService {
  private readonly lastHoldRecorded = new Map<string, number>();

  constructor(private readonly deps: AgentDependencies) {}

  private async loadOwned(principal: Principal, id: string, write = false) {
    const manifest = await getLatestAgentManifest(this.deps.databaseUrl, id);
    if (!manifest || manifest.tenantId !== principal.tenantId)
      throw new AgentError("Agent not found.", 404);
    const owner = manifest.ownerSubject === principal.subject;
    const reviewer = principal.roles.some((role) => roleCan(role, "risk:manage"));
    if (!owner && !reviewer) throw new AgentError("Agent not found.", 404);
    if (write && !owner && !reviewer)
      throw new AgentError("Only the owner or a risk manager can change this agent.", 403);
    const state = await getAgentState(this.deps.databaseUrl, id);
    return { manifest, state, owner, reviewer, policy: StoredAgentPolicy.parse(manifest.policy) };
  }

  private rulesFor(policy: StoredAgentPolicy) {
    if (!policy.rules) return null;
    return StrategyRules.parse({
      entry: policy.rules.entry,
      exit: policy.rules.exit,
      side: "long",
      positionSizeUsd: policy.capitalAllocation.maxTradeNotionalUsd,
      stopLossPct: policy.riskGuardrails.stopLossPct,
      takeProfitPct: policy.riskGuardrails.takeProfitPct,
      ...(policy.rules.maxHoldingBars ? { maxHoldingBars: policy.rules.maxHoldingBars } : {}),
      cooldownBars: policy.rules.cooldownBars,
    });
  }

  async create(principal: Principal, body: unknown) {
    const input = AgentDraftInput.parse(body);
    const { policy, manifestHash } = compileAgentDraft(input);
    const manifest = await createAgentManifest(this.deps.databaseUrl, {
      id: `custom:${crypto.randomUUID()}`,
      version: "1.0.0",
      tenantId: principal.tenantId,
      name: input.name,
      stage: "draft",
      autonomy: "research",
      ownerSubject: principal.subject,
      manifestHash,
      policy,
    });
    if (manifest)
      await appendAgentState(this.deps.databaseUrl, {
        agentId: manifest.id,
        manifestVersion: manifest.version,
        stage: "draft",
        autonomy: "research",
        reason: "Created as a research draft.",
        actorSubject: principal.subject,
      });
    return manifest;
  }

  /** A change to a manifest is a new version that restarts the pipeline at draft. */
  async newVersion(principal: Principal, id: string, body: unknown) {
    const { manifest, owner } = await this.loadOwned(principal, id, true);
    if (!owner) throw new AgentError("Only the owner can publish a new version.", 403);
    const input = AgentDraftInput.parse(body);
    const { policy, manifestHash } = compileAgentDraft(input);
    const next = await insertAgentManifestVersion(this.deps.databaseUrl, {
      id,
      version: bumpVersion(manifest.version),
      tenantId: principal.tenantId,
      name: input.name,
      ownerSubject: principal.subject,
      manifestHash,
      policy,
    });
    await appendAgentState(this.deps.databaseUrl, {
      agentId: id,
      manifestVersion: next.version,
      stage: "draft",
      autonomy: "research",
      reason: `Version ${next.version} published; evaluation restarts.`,
      actorSubject: principal.subject,
    });
    return next;
  }

  async list(principal: Principal) {
    const manifests = await listAgentManifests(
      this.deps.databaseUrl,
      principal.tenantId,
      principal.subject,
    );
    const latest = new Map<string, (typeof manifests)[number]>();
    for (const manifest of manifests) {
      const current = latest.get(manifest.id);
      if (!current || current.createdAt < manifest.createdAt) latest.set(manifest.id, manifest);
    }
    const states = await listAgentStates(this.deps.databaseUrl, [...latest.keys()]);
    return [...latest.values()].map((manifest) => {
      const state = states.get(manifest.id) ?? null;
      return {
        ...manifest,
        stage: stageOf(state),
        autonomy: autonomyOf(state),
        stateUpdatedAt: state?.createdAt ?? null,
        hasRules: Boolean((manifest.policy as { rules?: unknown }).rules),
      };
    });
  }

  async detail(principal: Principal, id: string) {
    const { manifest, state, policy, owner, reviewer } = await this.loadOwned(principal, id);
    const [versions, history, evaluations, runtime, decisions, orders, fills] = await Promise.all([
      listAgentManifestVersions(this.deps.databaseUrl, id),
      listAgentStateHistory(this.deps.databaseUrl, id),
      listAgentEvaluations(this.deps.databaseUrl, id),
      getAgentRuntimeState(this.deps.databaseUrl, id, state?.manifestVersion ?? manifest.version),
      listAgentDecisions(this.deps.databaseUrl, id, 80),
      listAgentOrders(this.deps.databaseUrl, { agentId: id }),
      listAgentFills(this.deps.databaseUrl, id),
    ]);
    const stage = stageOf(state);
    const passed = new Set(
      evaluations
        .filter(
          (evaluation) =>
            evaluation.outcome === "passed" && evaluation.manifestVersion === manifest.version,
        )
        .map((evaluation) => evaluation.stage),
    );
    const next =
      stage === "paused"
        ? null
        : ((
            {
              draft: "backtest",
              backtest: "stress_test",
              stress_test: "paper",
              paper: "shadow",
              shadow: "limited_live",
              limited_live: "live",
            } as Partial<Record<Stage, Stage>>
          )[stage] ?? null);
    return {
      manifest,
      policy,
      stage,
      autonomy: autonomyOf(state),
      runningVersion: state?.manifestVersion ?? manifest.version,
      canEdit: owner,
      canReview: reviewer && !owner,
      versions: versions.map((version) => ({
        version: version.version,
        manifestHash: version.manifestHash,
        createdAt: version.createdAt,
      })),
      history,
      evaluations,
      runtime,
      decisions,
      orders,
      fills,
      promotion: next
        ? {
            next,
            ...canPromote(stage, next, passed, {
              hasRules: Boolean(policy.rules),
              independentApproval: reviewer && !owner,
            }),
          }
        : null,
      gates: DEFAULT_GATES,
      liveExecution: this.deps.liveAgentsEnabled
        ? this.deps.signer.available
          ? "confirm_or_delegated"
          : "confirm_only"
        : "disabled",
    };
  }

  private backtestTimeframe(timeframe: string) {
    return timeframe === "event"
      ? "1d"
      : timeframe === "5m" || timeframe === "15m"
        ? "1h"
        : timeframe;
  }

  private async series(entries: readonly string[], timeframe: string, years: number) {
    return Promise.all(
      entries.slice(0, 4).map(async (entry) => {
        try {
          const series = await this.deps.history.forUniverseEntry(entry, timeframe, years, (key) =>
            this.deps.catalog.byKey(key),
          );
          return { entry, series, error: null as string | null };
        } catch (error) {
          return {
            entry,
            series: null,
            error: error instanceof Error ? error.message : "History unavailable",
          };
        }
      }),
    );
  }

  async backtest(principal: Principal, id: string) {
    const { manifest, state, policy } = await this.loadOwned(principal, id, true);
    if (stageOf(state) !== "backtest" || state?.manifestVersion !== manifest.version)
      throw new AgentError("Move the latest version into the backtest stage first.", 409);
    const rules = this.rulesFor(policy);
    if (!rules) throw new AgentError("This agent has no executable rules to backtest.");
    const timeframe = this.backtestTimeframe(policy.timeframe);
    const histories = await this.series(
      policy.universe,
      timeframe,
      DEFAULT_GATES.minBacktestYears + 0.2,
    );
    const perSymbol = histories.map(({ entry, series, error }) => {
      if (!series || series.candles.length < 60)
        return { entry, error: error ?? "Not enough history", outcome: "inconclusive" as const };
      const equity = series.source === "public-equity-history";
      const result = runBacktest(series.candles, rules, {
        initialCapitalUsd: policy.capitalAllocation.maxCapitalUsd,
        feeBps: FEE_BPS,
        slippageBps: Math.max(5, policy.execution.maxSlippageBps / 2),
        barsPerYear: barsPerYear(series.timeframe, equity ? "equity" : "crypto"),
      });
      const gate = backtestGate(result);
      return {
        entry,
        source: series.source,
        basis: series.basis,
        timeframe: series.timeframe,
        windowStart: result.windowStart,
        windowEnd: result.windowEnd,
        years: result.years,
        metrics: result.metrics,
        untestedConditions: result.untestedConditions,
        trades: result.trades.slice(-50),
        equityCurve: result.equityCurve,
        gate,
        outcome: gate.outcome,
      };
    });
    const outcome = perSymbol.every((row) => row.outcome === "passed")
      ? "passed"
      : perSymbol.some((row) => row.outcome === "failed")
        ? "failed"
        : "inconclusive";
    const windows = perSymbol.flatMap((row) =>
      "windowStart" in row && row.windowStart ? [row.windowStart, row.windowEnd] : [],
    );
    const now = new Date().toISOString();
    return recordAgentEvaluation(this.deps.databaseUrl, {
      agentId: id,
      manifestVersion: manifest.version,
      manifestHash: manifest.manifestHash,
      stage: "backtest",
      outcome,
      evidence: {
        engine: "sisera-backtest-v1",
        thresholds: DEFAULT_GATES,
        perSymbol,
        feeBps: FEE_BPS,
      },
      dataWindowStart: windows.length
        ? (windows.sort()[0] ?? now)
        : new Date(Date.now() - 86_400_000).toISOString(),
      dataWindowEnd: windows.length ? (windows.sort().at(-1) ?? now) : now,
      reviewerSubject: SYSTEM_BACKTESTER,
    });
  }

  async stress(principal: Principal, id: string) {
    const { manifest, state, policy } = await this.loadOwned(principal, id, true);
    if (stageOf(state) !== "stress_test" || state?.manifestVersion !== manifest.version)
      throw new AgentError("The agent must be in the stress-test stage.", 409);
    const rules = this.rulesFor(policy);
    if (!rules) throw new AgentError("This agent has no executable rules.");
    const timeframe = this.backtestTimeframe(policy.timeframe);
    const histories = await this.series(policy.universe, timeframe, 2);
    const perSymbol = histories.map(({ entry, series, error }) => {
      if (!series || series.candles.length < 120)
        return { entry, error: error ?? "Not enough history", outcome: "failed" as const };
      const results = runStressTests(series.candles, rules, {
        initialCapitalUsd: policy.capitalAllocation.maxCapitalUsd,
        feeBps: FEE_BPS,
        slippageBps: Math.max(5, policy.execution.maxSlippageBps / 2),
        barsPerYear: barsPerYear(
          series.timeframe,
          series.source === "public-equity-history" ? "equity" : "crypto",
        ),
      });
      const gate = stressGate(results);
      return { entry, source: series.source, results, gate, outcome: gate.outcome };
    });
    const outcome = perSymbol.every((row) => row.outcome === "passed") ? "passed" : "failed";
    const now = new Date();
    return recordAgentEvaluation(this.deps.databaseUrl, {
      agentId: id,
      manifestVersion: manifest.version,
      manifestHash: manifest.manifestHash,
      stage: "stress_test",
      outcome,
      evidence: {
        engine: "sisera-stress-v1",
        scenarios: ["flash_crash", "gap_down", "liquidity_freeze", "quote_depeg"],
        perSymbol,
      },
      dataWindowStart: new Date(now.getTime() - 2 * 365 * 86_400_000).toISOString(),
      dataWindowEnd: now.toISOString(),
      reviewerSubject: SYSTEM_BACKTESTER,
    });
  }

  /** Records forward evidence for paper, shadow or limited-live. Live-stage evidence needs a reviewer. */
  async evaluateForward(principal: Principal, id: string) {
    const { manifest, state, policy, owner } = await this.loadOwned(principal, id, true);
    const stage = stageOf(state);
    if (stage !== "paper" && stage !== "shadow" && stage !== "limited_live")
      throw new AgentError(
        "Forward evaluation applies to paper, shadow and limited-live stages.",
        409,
      );
    const runtime = await getAgentRuntimeState(this.deps.databaseUrl, id, manifest.version);
    if (!runtime || runtime.stage !== stage)
      throw new AgentError("The runtime has not produced results for this stage yet.", 409);
    const fills = await listAgentFills(this.deps.databaseUrl, id, runtime.stageStartedAt);
    const slippages = fills
      .map((fill) => fill.slippageBps)
      .filter((value): value is number => value != null);
    const equity = await this.equity(runtime);
    const stats = {
      days: (Date.now() - Date.parse(runtime.stageStartedAt)) / 86_400_000,
      trades: fills.length,
      returnPct: runtime.startingEquityUsd > 0 ? (equity / runtime.startingEquityUsd - 1) * 100 : 0,
      maxDrawdownPct: runtime.maxDrawdownPct,
      realizedSlippageBps: slippages.length
        ? slippages.reduce((sum, value) => sum + value, 0) / slippages.length
        : null,
    };
    const gate = forwardGate(
      stage,
      stats,
      Math.max(5, policy.execution.maxSlippageBps / 2),
      policy.riskGuardrails.maxDailyDrawdownPct,
    );
    const reviewer = stage === "limited_live" ? principal.subject : SYSTEM_RUNTIME;
    if (stage === "limited_live" && owner && gate.outcome === "passed")
      throw new AgentError(
        "Limited-live results must be signed off by an independent risk manager.",
        403,
      );
    return recordAgentEvaluation(this.deps.databaseUrl, {
      agentId: id,
      manifestVersion: manifest.version,
      manifestHash: manifest.manifestHash,
      stage,
      outcome: gate.outcome,
      evidence: { engine: "sisera-forward-v1", stats, gate, equityUsd: equity },
      dataWindowStart: runtime.stageStartedAt,
      dataWindowEnd: new Date().toISOString(),
      reviewerSubject: reviewer,
    });
  }

  async promote(principal: Principal, id: string, to: Stage, autonomy?: AutonomyLevel) {
    const { manifest, state, policy, owner, reviewer } = await this.loadOwned(principal, id, true);
    const from = stageOf(state);
    if (state && state.manifestVersion !== manifest.version && to !== "draft")
      throw new AgentError(
        "Promote the latest manifest version; older versions keep their own history.",
        409,
      );
    const evaluations = await listAgentEvaluations(this.deps.databaseUrl, id);
    const passed = new Set(
      evaluations
        .filter(
          (evaluation) =>
            evaluation.manifestVersion === manifest.version && evaluation.outcome === "passed",
        )
        .map((evaluation) => evaluation.stage),
    );
    const decision = canPromote(from, to, passed, {
      hasRules: Boolean(policy.rules),
      independentApproval: reviewer && !owner,
    });
    if (!decision.allowed) throw new AgentError(decision.reason, 409);
    const nextAutonomy: AutonomyLevel =
      autonomy ?? (to === "paper" ? "policy_auto" : autonomyOf(state));
    if ((to === "limited_live" || to === "live") && !this.deps.liveAgentsEnabled)
      throw new AgentError("Live agent execution is disabled on this deployment.", 503);
    if ((to === "limited_live" || to === "live") && !policy.execution.liveWallet)
      throw new AgentError(
        "Publish a version with a live wallet before promoting to a live stage.",
      );
    const required = evaluations.find(
      (evaluation) =>
        evaluation.manifestVersion === manifest.version &&
        evaluation.outcome === "passed" &&
        evaluation.stage ===
          (
            {
              stress_test: "backtest",
              paper: "stress_test",
              shadow: "paper",
              limited_live: "shadow",
              live: "limited_live",
            } as Record<string, string>
          )[to],
    );
    return appendAgentState(this.deps.databaseUrl, {
      agentId: id,
      manifestVersion: manifest.version,
      stage: to,
      autonomy: nextAutonomy,
      reason: `${decision.reason}${to === "paper" && !autonomy ? " Paper stage executes simulated orders automatically." : ""}`,
      actorSubject: principal.subject,
      evaluationId: required?.id ?? null,
    });
  }

  async setAutonomy(principal: Principal, id: string, autonomy: AutonomyLevel) {
    const { manifest, state } = await this.loadOwned(principal, id, true);
    const stage = stageOf(state);
    if (
      autonomy === "autonomous" &&
      (stage === "limited_live" || stage === "live") &&
      !this.deps.signer.available
    )
      throw new AgentError(
        "Autonomous live execution needs delegated signing, which is not enabled.",
        409,
      );
    return appendAgentState(this.deps.databaseUrl, {
      agentId: id,
      manifestVersion: state?.manifestVersion ?? manifest.version,
      stage,
      autonomy,
      reason: `Autonomy set to ${autonomy}.`,
      actorSubject: principal.subject,
    });
  }

  /** Kill switch: cancel pending proposals and halt. */
  async pause(
    principal: Principal | null,
    id: string,
    reason: string,
    actor = principal?.subject ?? SYSTEM_RUNTIME,
  ) {
    if (principal) await this.loadOwned(principal, id, true);
    const state = await getAgentState(this.deps.databaseUrl, id);
    if (!state || state.stage === "paused") return state;
    const pending = await listAgentOrders(this.deps.databaseUrl, { agentId: id });
    await Promise.all(
      pending
        .filter(
          (order) =>
            order.status === "awaiting_approval" ||
            order.status === "recommended" ||
            order.status === "approved",
        )
        .map((order) =>
          transitionAgentOrder(
            this.deps.databaseUrl,
            order.id,
            ["awaiting_approval", "recommended", "approved"],
            "rejected",
            { detail: { killSwitch: reason } },
          ),
        ),
    );
    return appendAgentState(this.deps.databaseUrl, {
      agentId: id,
      manifestVersion: state.manifestVersion,
      stage: "paused",
      autonomy: state.autonomy,
      reason,
      actorSubject: actor,
    });
  }

  /** Global Emergency Panic: halts all runnable agents and cancels all open agent orders across the fleet. */
  async emergencyHaltAll(
    principal: Principal,
    reason = "Global emergency fleet halt triggered by operator.",
  ): Promise<{ haltedAgentsCount: number; canceledOrdersCount: number; haltedAgentIds: string[] }> {
    const allRunnable = await listRunnableAgents(this.deps.databaseUrl);
    const runnable = allRunnable.filter((a) => a.manifest.tenantId === principal.tenantId);
    const haltedAgentIds: string[] = [];
    for (const agent of runnable) {
      await this.pause(principal, agent.manifest.id, reason);
      haltedAgentIds.push(agent.manifest.id);
    }
    const orders = await listAgentOrders(this.deps.databaseUrl, { subject: principal.subject });
    const pending = orders.filter(
      (order) =>
        order.status === "awaiting_approval" ||
        order.status === "recommended" ||
        order.status === "approved",
    );
    await Promise.all(
      pending.map((order) =>
        transitionAgentOrder(
          this.deps.databaseUrl,
          order.id,
          ["awaiting_approval", "recommended", "approved"],
          "rejected",
          { detail: { killSwitch: reason } },
        ),
      ),
    );
    return {
      haltedAgentsCount: haltedAgentIds.length,
      canceledOrdersCount: pending.length,
      haltedAgentIds,
    };
  }

  async getAgentVault(principal: Principal, agentId: string) {
    await this.loadOwned(principal, agentId);
    throw new AgentError("Vault custody is not configured.", 503);
  }
  async depositToVault(principal: Principal, agentId: string, _amountUsd: number) {
    await this.loadOwned(principal, agentId);
    throw new AgentError("Vault custody is not configured.", 503);
  }
  async listVaultLeaderboard() {
    return [];
  }

  async listBasisArbitrageOpportunities(): Promise<BasisArbitrageOpportunity[]> {
    return (await this.deps.basis?.list()) ?? [];
  }

  async armBasisHarvester(
    principal: Principal,
    input: {
      asset: string;
      notionalUsd: number;
      maxLeverage?: number;
    },
  ) {
    if (input.notionalUsd <= 0 || input.notionalUsd > 1_000_000) {
      throw new AgentError("Notional must be between $1 and $1,000,000", 400);
    }
    const opportunities = (await this.deps.basis?.list(input.notionalUsd, 30, true)) ?? [];
    const opp = opportunities.find((o) => o.asset.toLowerCase() === input.asset.toLowerCase());
    if (!opp || opp.status === "unfavorable") {
      throw new AgentError(
        `No active basis arbitrage opportunity found for asset ${input.asset}`,
        404,
      );
    }
    const agentDraft = {
      name: `Basis research (${opp.asset})`,
      description: `Current funding carry estimate: ${opp.netYieldAprPct.toFixed(1)}% annualized. Paired execution requires an evaluated strategy.`,
      universe: [`hyperliquid:${opp.asset}-USD:perpetual`, `binance:${opp.asset}/USDC:spot`],
      timeframe: "1h" as const,
      factors: ["funding_rate_disparity", "basis_spread_convergence"],
      capitalLimitUsd: input.notionalUsd,
      maxTradeNotionalUsd: input.notionalUsd,
      maxDailyDrawdownPct: 3.5,
      maxOpenPositions: 2,
      stopLossPct: 4.0,
      takeProfitPct: 35.0,
      maxSlippageBps: 20,
      rules: {
        entry: [
          { type: "funding_rate_above" as const, aprPct: 10 },
          { type: "basis_spread_above" as const, bps: 10 },
        ],
        exit: [{ type: "funding_rate_above" as const, aprPct: 3 }],
      },
    };
    const created = await this.create(principal, agentDraft);
    const estimatedDailyYieldUsd = (input.notionalUsd * (opp.netYieldAprPct / 100)) / 365;
    return {
      agentId: created?.id ?? `harvester-${Date.now()}`,
      name: agentDraft.name,
      stage: "draft" as Stage,
      autonomy: "research" as AutonomyLevel,
      asset: opp.asset,
      netYieldAprPct: opp.netYieldAprPct,
      notionalUsd: input.notionalUsd,
      estimatedDailyYieldUsd,
      spotVenue: opp.spotVenue,
      perpVenue: opp.perpVenue,
      liquidationBufferPct: opp.liquidationBufferPct,
      status: "draft",
      createdAt: new Date().toISOString(),
    };
  }

  listOrders(principal: Principal) {
    return listAgentOrders(this.deps.databaseUrl, { subject: principal.subject });
  }

  async rejectOrder(principal: Principal, orderId: string) {
    const order = await transitionAgentOrder(
      this.deps.databaseUrl,
      orderId,
      ["awaiting_approval", "recommended"],
      "rejected",
      { subject: principal.subject, approvedBy: principal.subject },
    );
    if (!order) throw new AgentError("This proposal can no longer be rejected.", 409);
    return order;
  }

  /** Approves a proposal: paper proposals fill immediately; live ones return a transaction to sign. */
  async approveOrder(principal: Principal, orderId: string) {
    const orders = await listAgentOrders(this.deps.databaseUrl, {
      subject: principal.subject,
      status: "awaiting_approval",
    });
    const order = orders.find((candidate) => candidate.id === orderId);
    if (!order) throw new AgentError("Proposal not found or no longer awaiting approval.", 404);
    if (order.expiresAt && Date.parse(order.expiresAt) < Date.now())
      throw new AgentError("This proposal expired.", 409);
    const manifest = await getLatestAgentManifest(this.deps.databaseUrl, order.agentId);
    const state = await getAgentState(this.deps.databaseUrl, order.agentId);
    if (!manifest || !state || state.stage === "paused")
      throw new AgentError("The agent is paused; the proposal cannot execute.", 409);
    const policy = StoredAgentPolicy.parse(manifest.policy);
    if (order.mode !== "live") {
      const approved = await transitionAgentOrder(
        this.deps.databaseUrl,
        orderId,
        ["awaiting_approval"],
        "approved",
        { approvedBy: principal.subject, subject: principal.subject },
      );
      if (!approved) throw new AgentError("This proposal is already being handled.", 409);
      const runtime = await getAgentRuntimeState(
        this.deps.databaseUrl,
        order.agentId,
        order.manifestVersion,
      );
      if (!runtime) throw new AgentError("Agent runtime state is unavailable.", 503);
      const quote = await this.quote(
        order.instrumentKey.startsWith("binance:")
          ? order.instrumentKey.slice(8)
          : order.instrumentKey,
        order.side,
      );
      if (!quote) throw new AgentError("A fresh price is unavailable.", 503);
      await this.fillSimulated(
        runtime,
        policy,
        order.symbol,
        order.instrumentKey,
        order.side,
        order.notionalUsd,
        quote.price,
        order.decisionId,
        order.id,
      );
      await saveAgentRuntimeState(this.deps.databaseUrl, runtime);
      return { status: "executed", mode: order.mode };
    }
    const wallet = policy.execution.liveWallet;
    if (!wallet) throw new AgentError("The agent has no live wallet.");
    const prepared = await this.prepareLive(
      principal.subject,
      principal.tenantId,
      order.agentId,
      wallet,
      order.instrumentKey,
      order.side,
      order.notionalUsd,
      policy.execution.maxSlippageBps,
    );
    await transitionAgentOrder(this.deps.databaseUrl, orderId, ["awaiting_approval"], "approved", {
      approvedBy: principal.subject,
      subject: principal.subject,
      detail: { swapOrderId: prepared.orderId },
    });
    return { status: "awaiting_signature", prepared };
  }

  async executeSignedOrder(
    principal: Principal,
    orderId: string,
    swapOrderId: string,
    signedTransaction: string,
  ) {
    const orders = await listAgentOrders(this.deps.databaseUrl, {
      subject: principal.subject,
      status: "approved",
    });
    const order = orders.find(
      (candidate) => candidate.id === orderId && candidate.detail.swapOrderId === swapOrderId,
    );
    if (!order) throw new AgentError("Approved proposal not found.", 404);
    const result = await this.deps.trading.execute(
      swapOrderId,
      principal.subject,
      signedTransaction,
    );
    await this.completeLive(
      order.id,
      order.subject,
      order.tenantId,
      order.agentId,
      order.manifestVersion,
      order.symbol,
      order.instrumentKey,
      order.side,
      order.notionalUsd,
      order.arrivalPriceUsd,
      order.decisionId,
      result,
    );
    return result;
  }

  private async prepareLive(
    subject: string,
    tenantId: string,
    agentId: string,
    wallet: string,
    mint: string,
    side: "buy" | "sell",
    notionalUsd: number,
    slippageBps: number,
  ) {
    const asset = await this.deps.catalog.byMint(mint);
    if (!asset?.priceUsd) throw new AgentError("A live price is unavailable.", 503);
    const balance = await this.deps.helius.getTokenBalance(wallet, mint);
    const amount =
      side === "buy"
        ? String(Math.round(notionalUsd * 1_000_000))
        : String(Math.floor((notionalUsd / asset.priceUsd) * 10 ** balance.decimals));
    return this.deps.trading.prepare({
      subject,
      tenantId,
      wallet,
      mint,
      side,
      amount,
      book: `agent:${agentId}`,
      slippageBps,
      arrivalPriceUsd: asset.priceUsd,
    });
  }

  private async completeLive(
    orderId: string,
    subject: string,
    tenantId: string,
    agentId: string,
    manifestVersion: string,
    symbol: string,
    instrumentKey: string,
    side: "buy" | "sell",
    notionalUsd: number,
    arrival: number | null,
    decisionId: string,
    result: { status: string; signature: string | null },
  ) {
    if (result.status !== "confirmed") {
      await transitionAgentOrder(
        this.deps.databaseUrl,
        orderId,
        ["approved", "awaiting_approval"],
        "failed",
        { detail: result },
      );
      return;
    }
    const asset = await this.deps.catalog.byMint(instrumentKey);
    const price = asset?.priceUsd ?? arrival ?? 0;
    const quantity = price > 0 ? notionalUsd / price : 0;
    await transitionAgentOrder(
      this.deps.databaseUrl,
      orderId,
      ["approved", "awaiting_approval"],
      "executed",
      {
        fillPriceUsd: price,
        quantity,
        ...(result.signature ? { signature: result.signature } : {}),
      },
    );
    if (quantity > 0)
      await recordAgentFill(this.deps.databaseUrl, {
        tenantId,
        subject,
        agentId,
        manifestVersion,
        mode: "live",
        venue: "solana",
        assetClass: asset?.kind ?? "agent_token",
        instrumentKey,
        symbol,
        side,
        quantity,
        priceUsd: price,
        feeUsd: 0,
        arrivalPriceUsd: arrival,
        slippageBps: arrival
          ? ((price - arrival) / arrival) * 10_000 * (side === "buy" ? 1 : -1)
          : null,
        decisionId,
        signature: result.signature,
      });
    const runtime = await getAgentRuntimeState(this.deps.databaseUrl, agentId, manifestVersion);
    if (runtime) {
      const key = instrumentKey;
      const held = runtime.positions[key];
      if (side === "buy")
        runtime.positions[key] = held
          ? {
              ...held,
              quantity: held.quantity + quantity,
              entryPrice:
                (held.entryPrice * held.quantity + price * quantity) / (held.quantity + quantity),
            }
          : {
              quantity,
              entryPrice: price,
              openedAt: new Date().toISOString(),
              barsHeld: 0,
              instrumentKey: key,
              symbol,
            };
      else if (held) {
        const remaining = held.quantity - quantity;
        if (remaining <= held.quantity * 1e-6) delete runtime.positions[key];
        else runtime.positions[key] = { ...held, quantity: remaining };
      }
      runtime.cashUsd += side === "buy" ? -notionalUsd : notionalUsd;
      await saveAgentRuntimeState(this.deps.databaseUrl, runtime);
    }
  }

  // --------------------------------------------------------------------------- runtime

  private isCrypto(entry: string) {
    return /^[A-Z0-9]{2,20}(USDT|USDC)$/.test(entry.toUpperCase());
  }

  private async resolve(
    entry: string,
  ): Promise<{ key: string; symbol: string; asset: CatalogAsset | null; binance: string | null }> {
    if (this.isCrypto(entry)) {
      const symbol = entry.toUpperCase();
      return {
        key: `binance:${symbol}`,
        symbol: symbol.replace(/USDT$|USDC$/, ""),
        asset: null,
        binance: symbol,
      };
    }
    const asset = await this.deps.catalog.byKey(
      entry.replace(/^(clawpump|prestocks|xstocks):/i, ""),
    );
    return { key: asset?.mint ?? entry, symbol: asset?.symbol ?? entry, asset, binance: null };
  }

  private async quote(
    entry: string,
    side: "buy" | "sell",
  ): Promise<{ price: number; observedAt: string } | null> {
    if (this.isCrypto(entry)) {
      const snapshot = await this.deps.spot.getSnapshot(entry.toUpperCase()).catch(() => null);
      if (!snapshot || snapshot.quality.status !== "live") return null;
      return {
        price: Number(side === "buy" ? snapshot.ask : snapshot.bid),
        observedAt: snapshot.quality.observedAt,
      };
    }
    const asset = await this.deps.catalog.byMint(entry).catch(() => null);
    return asset?.priceUsd ? { price: asset.priceUsd, observedAt: new Date().toISOString() } : null;
  }

  private async candles(
    entry: string,
    asset: CatalogAsset | null,
    timeframe: string,
  ): Promise<Candle[] | null> {
    const interval = timeframe === "event" ? "1h" : timeframe;
    const step = TIMEFRAME_MS[interval] ?? 3_600_000;
    let candles: Candle[] | null = null;
    if (this.isCrypto(entry))
      candles =
        (await this.deps.spot.getCandles?.(entry.toUpperCase(), interval, 500).catch(() => null)) ??
        null;
    else if (asset)
      candles =
        (await this.deps.history.solanaToken(asset.mint, interval).catch(() => null))?.candles ??
        null;
    // Drop the forming bar so live signals match the closed-bar backtest.
    return candles ? candles.filter((candle) => candle.time * 1000 + step <= Date.now()) : null;
  }

  private async equity(runtime: AgentRuntimeState): Promise<number> {
    let value = runtime.cashUsd;
    for (const [key, position] of Object.entries(runtime.positions)) {
      const quote = await this.quote(key.startsWith("binance:") ? key.slice(8) : key, "sell");
      value += position.quantity * (quote?.price ?? position.entryPrice);
    }
    return value;
  }

  private async fillSimulated(
    runtime: AgentRuntimeState,
    policy: StoredAgentPolicy,
    symbol: string,
    instrumentKey: string,
    side: "buy" | "sell",
    notionalUsd: number,
    arrival: number,
    decisionId: string,
    orderId: string | null,
  ) {
    const slippageBps = Math.max(2, policy.execution.maxSlippageBps / 2);
    const price = arrival * (1 + ((side === "buy" ? 1 : -1) * slippageBps) / 10_000);
    const held = runtime.positions[instrumentKey];
    const quantity = side === "buy" ? notionalUsd / price : (held?.quantity ?? 0);
    if (quantity <= 0) return;
    const gross = quantity * price;
    const fee = (gross * FEE_BPS) / 10_000;
    if (side === "buy") {
      runtime.cashUsd -= gross + fee;
      runtime.positions[instrumentKey] = held
        ? {
            ...held,
            quantity: held.quantity + quantity,
            entryPrice:
              (held.entryPrice * held.quantity + price * quantity) / (held.quantity + quantity),
          }
        : {
            quantity,
            entryPrice: price,
            openedAt: new Date().toISOString(),
            barsHeld: 0,
            instrumentKey,
            symbol,
          };
    } else {
      runtime.cashUsd += gross - fee;
      delete runtime.positions[instrumentKey];
    }
    await recordAgentFill(this.deps.databaseUrl, {
      tenantId: runtime.tenantId,
      subject: runtime.subject,
      agentId: runtime.agentId,
      manifestVersion: runtime.manifestVersion,
      mode: "paper",
      venue: instrumentKey.startsWith("binance:") ? "binance" : "solana",
      assetClass: instrumentKey.startsWith("binance:") ? "crypto_spot" : "agent_token",
      instrumentKey,
      symbol,
      side,
      quantity,
      priceUsd: price,
      feeUsd: fee,
      arrivalPriceUsd: arrival,
      slippageBps,
      decisionId,
    });
    if (orderId)
      await transitionAgentOrder(
        this.deps.databaseUrl,
        orderId,
        ["approved", "awaiting_approval"],
        "executed",
        { fillPriceUsd: price, quantity },
      );
  }

  private initialRuntime(
    agent: {
      manifest: { id: string; version: string; ownerSubject: string; tenantId: string };
      state: AgentStateRow;
    },
    policy: StoredAgentPolicy,
  ): AgentRuntimeState {
    const cap = capitalCap(agent.state.stage as Stage, policy.capitalAllocation.maxCapitalUsd);
    const now = new Date().toISOString();
    return {
      agentId: agent.manifest.id,
      manifestVersion: agent.manifest.version,
      subject: agent.manifest.ownerSubject,
      tenantId: agent.manifest.tenantId,
      stage: agent.state.stage,
      stageStartedAt: agent.state.createdAt,
      startingEquityUsd: cap,
      maxDrawdownPct: 0,
      cashUsd: cap,
      positions: {},
      day: now.slice(0, 10),
      dayStartEquityUsd: cap,
      peakEquityUsd: cap,
      lastTickAt: null,
      lastDataAt: null,
      lastError: null,
    };
  }

  /** One scheduler pass: evaluate every running agent once. */
  async tick(): Promise<{ agents: number; decisions: number }> {
    await expireAgentOrders(this.deps.databaseUrl).catch(() => 0);
    const agents = await listRunnableAgents(this.deps.databaseUrl);
    let decisions = 0;
    for (const agent of agents) {
      try {
        decisions += await this.tickAgent(agent);
      } catch (error) {
        this.deps.log.warn(
          { agentId: agent.manifest.id, error: error instanceof Error ? error.message : "unknown" },
          "agent tick failed",
        );
      }
    }
    return { agents: agents.length, decisions };
  }

  private async tickAgent(
    agent: Awaited<ReturnType<typeof listRunnableAgents>>[number],
  ): Promise<number> {
    const policy = StoredAgentPolicy.parse(agent.manifest.policy);
    const rules = this.rulesFor(policy);
    if (!rules) return 0;
    const stage = agent.state.stage as Stage;
    const autonomy = agent.state.autonomy as AutonomyLevel;
    const mode = executionMode(stage);
    let runtime = await getAgentRuntimeState(
      this.deps.databaseUrl,
      agent.manifest.id,
      agent.manifest.version,
    );
    // Each stage starts a fresh book so its evidence reflects only that stage.
    if (!runtime || runtime.stage !== stage) runtime = this.initialRuntime(agent, policy);
    const tf = policy.timeframe === "event" ? "1h" : policy.timeframe;
    const step = TIMEFRAME_MS[tf] ?? 3_600_000;
    const lastTick = runtime.lastTickAt ? Date.parse(runtime.lastTickAt) : 0;
    const newBar = Math.floor(Date.now() / step) !== Math.floor(lastTick / step);
    let recorded = 0;
    let freshestDataAge: number | null = null;

    // Daily roll and circuit breakers run before any new decision.
    const today = new Date().toISOString().slice(0, 10);
    const equity = await this.equity(runtime);
    if (runtime.day !== today) {
      runtime.day = today;
      runtime.dayStartEquityUsd = equity;
    }
    runtime.peakEquityUsd = Math.max(runtime.peakEquityUsd, equity);
    runtime.maxDrawdownPct = Math.max(
      runtime.maxDrawdownPct,
      runtime.peakEquityUsd > 0
        ? ((runtime.peakEquityUsd - equity) / runtime.peakEquityUsd) * 100
        : 0,
    );
    const recentFills = await listAgentFills(
      this.deps.databaseUrl,
      agent.manifest.id,
      new Date(Date.now() - 86_400_000).toISOString(),
    );
    const slippages = recentFills
      .map((fill) => fill.slippageBps)
      .filter((value): value is number => value != null);

    for (const entry of policy.universe.slice(0, 12)) {
      const target = await this.resolve(entry);
      // Degradation counts only once it lasts: retry across roughly five seconds before tripping.
      let quote = await this.quote(target.binance ?? target.key, "buy");
      for (const delay of [1_000, 2_000, 3_000]) {
        if (quote) break;
        await new Promise((resolve) => setTimeout(resolve, delay));
        quote = await this.quote(target.binance ?? target.key, "buy");
      }
      const dataAge = quote ? Math.max(0, Date.now() - Date.parse(quote.observedAt)) : null;
      freshestDataAge =
        dataAge == null ? freshestDataAge : Math.min(freshestDataAge ?? dataAge, dataAge);
      const breaker = checkCircuitBreakers({
        dailyPnlPct:
          runtime.dayStartEquityUsd > 0 ? (equity / runtime.dayStartEquityUsd - 1) * 100 : 0,
        maxDailyDrawdownPct: policy.riskGuardrails.maxDailyDrawdownPct,
        realizedSlippageBps:
          mode === "live" && slippages.length
            ? slippages.reduce((sum, value) => sum + value, 0) / slippages.length
            : null,
        expectedSlippageBps: Math.max(5, policy.execution.maxSlippageBps / 2),
        dataAgeMs: quote ? dataAge : 6_000,
      });
      if (breaker.action !== "none") {
        await recordAgentDecision(this.deps.databaseUrl, {
          agentId: agent.manifest.id,
          manifestVersion: agent.manifest.version,
          subject: agent.manifest.ownerSubject,
          stage,
          autonomy,
          symbol: target.symbol,
          action: "breaker",
          disposition: "blocked",
          marketState: { quote, equityUsd: equity },
          ruleResults: [],
          reasons: breaker.reasons,
        });
        recorded++;
        if (breaker.action === "pause" || stage === "paper")
          await this.pause(
            null,
            agent.manifest.id,
            `Circuit breaker: ${breaker.reasons.join(" ")}`,
            "system:circuit-breaker",
          );
        else
          await appendAgentState(this.deps.databaseUrl, {
            agentId: agent.manifest.id,
            manifestVersion: agent.manifest.version,
            stage: "paper",
            autonomy,
            reason: `Demoted: ${breaker.reasons.join(" ")}`,
            actorSubject: "system:circuit-breaker",
          });
        runtime.lastError = breaker.reasons.join(" ");
        break;
      }
      if (!newBar && !runtime.positions[target.key]) continue;
      const candles = newBar ? await this.candles(entry, target.asset, tf) : null;
      const conditions = [...rules.entry, ...rules.exit];
      const built = target.asset
        ? await this.deps.states.build(target.asset, conditions, candles ? { candles } : {})
        : {
            state: {
              price: quote?.price ?? null,
              candles,
              events: [],
              observedAt: quote?.observedAt ?? new Date().toISOString(),
            },
            snapshot: {
              symbol: target.symbol,
              priceUsd: quote?.price ?? null,
              candles: candles?.length ?? 0,
            },
          };
      const position = runtime.positions[target.key];
      if (position && newBar) position.barsHeld++;
      const decision = evaluateTick(
        rules,
        built.state,
        position
          ? {
              quantity: position.quantity,
              entryPrice: position.entryPrice,
              openedAt: position.openedAt,
              barsHeld: position.barsHeld,
            }
          : null,
      );
      const openCount = Object.keys(runtime.positions).length;
      let disposition: ReturnType<typeof dispositionFor> | "blocked" = dispositionFor(
        autonomy,
        decision.action,
      );
      const reasons = [...decision.reasons];
      if (decision.action === "enter" && openCount >= policy.riskGuardrails.maxOpenPositions) {
        disposition = "record";
        reasons.push(`Maximum open positions (${policy.riskGuardrails.maxOpenPositions}) reached.`);
      }
      const notional = Math.min(policy.capitalAllocation.maxTradeNotionalUsd, runtime.cashUsd);
      if (decision.action === "enter" && notional < 1) {
        disposition = "record";
        reasons.push("No capital left in the agent's allocation.");
      }
      if (mode === "live" && target.binance && disposition === "execute") {
        disposition = "blocked";
        reasons.push("Live agent execution supports Solana tokens only.");
      }
      const holdKey = `${agent.manifest.id}:${target.key}`;
      const quiet =
        decision.action === "hold" &&
        Date.now() - (this.lastHoldRecorded.get(holdKey) ?? 0) < 15 * 60_000;
      if (quiet) continue;
      if (decision.action === "hold") this.lastHoldRecorded.set(holdKey, Date.now());
      const decisionId = await recordAgentDecision(this.deps.databaseUrl, {
        agentId: agent.manifest.id,
        manifestVersion: agent.manifest.version,
        subject: agent.manifest.ownerSubject,
        stage,
        autonomy,
        symbol: target.symbol,
        action: decision.action,
        disposition,
        marketState: { ...built.snapshot, quote, equityUsd: equity },
        ruleResults: [...decision.entryResults, ...decision.exitResults],
        reasons,
      });
      recorded++;
      if (
        (decision.action !== "enter" && decision.action !== "exit") ||
        !quote ||
        disposition === "record" ||
        disposition === "blocked"
      )
        continue;
      const side = decision.action === "enter" ? "buy" : "sell";
      const sizeUsd = side === "buy" ? notional : (position?.quantity ?? 0) * quote.price;
      if (sizeUsd <= 0) continue;
      const orderBase = {
        tenantId: agent.manifest.tenantId,
        subject: agent.manifest.ownerSubject,
        agentId: agent.manifest.id,
        manifestVersion: agent.manifest.version,
        decisionId,
        side: side as "buy" | "sell",
        symbol: target.symbol,
        instrumentKey: target.key,
        notionalUsd: sizeUsd,
        quantity: side === "sell" ? (position?.quantity ?? null) : null,
        arrivalPriceUsd: quote.price,
      };
      if (disposition === "recommend") {
        await createAgentOrder(this.deps.databaseUrl, {
          ...orderBase,
          mode: mode === "live" ? "live" : mode === "shadow" ? "shadow" : "paper",
          status: "recommended",
          detail: { reasons },
          expiresAt: new Date(Date.now() + step).toISOString(),
        });
        continue;
      }
      if (
        disposition === "await_approval" ||
        (mode === "live" && !(this.deps.liveAgentsEnabled && this.deps.signer.available))
      ) {
        await createAgentOrder(this.deps.databaseUrl, {
          ...orderBase,
          mode: mode === "live" ? "live" : mode === "shadow" ? "shadow" : "paper",
          status: "awaiting_approval",
          detail: { reasons },
          expiresAt: new Date(Date.now() + Math.min(step, 30 * 60_000)).toISOString(),
        });
        continue;
      }
      if (mode === "paper" || mode === "shadow") {
        const order = await createAgentOrder(this.deps.databaseUrl, {
          ...orderBase,
          mode,
          status: "approved",
          detail: { reasons, automatic: true },
          expiresAt: null,
        });
        await this.fillSimulated(
          runtime,
          policy,
          target.symbol,
          target.key,
          side,
          sizeUsd,
          quote.price,
          decisionId,
          order.id,
        );
        if (mode === "shadow")
          await transitionAgentOrder(this.deps.databaseUrl, order.id, ["executed"], "shadowed", {
            detail: { note: "Shadow fill at the live executable quote; no order was sent." },
          });
        continue;
      }
      // Live, automatic: delegated signer only, under the stage capital cap.
      const wallet = policy.execution.liveWallet;
      if (!wallet || !(await this.deps.signer.isDelegated(agent.manifest.ownerSubject, wallet))) {
        await createAgentOrder(this.deps.databaseUrl, {
          ...orderBase,
          mode: "live",
          status: "awaiting_approval",
          detail: { reasons, note: "Wallet is not delegated; approval required." },
          expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        });
        continue;
      }
      const order = await createAgentOrder(this.deps.databaseUrl, {
        ...orderBase,
        mode: "live",
        status: "approved",
        detail: { reasons, automatic: true },
        expiresAt: null,
      });
      try {
        const prepared = await this.prepareLive(
          agent.manifest.ownerSubject,
          agent.manifest.tenantId,
          agent.manifest.id,
          wallet,
          target.key,
          side,
          sizeUsd,
          policy.execution.maxSlippageBps,
        );
        const result = await this.deps.trading.executeWithSigner(
          prepared.orderId,
          agent.manifest.ownerSubject,
          (unsigned, signerWallet) =>
            this.deps.signer.sign(agent.manifest.ownerSubject, unsigned, signerWallet),
        );
        await this.completeLive(
          order.id,
          orderBase.subject,
          orderBase.tenantId,
          orderBase.agentId,
          orderBase.manifestVersion,
          orderBase.symbol,
          orderBase.instrumentKey,
          side,
          sizeUsd,
          quote.price,
          decisionId,
          result,
        );
      } catch (error) {
        await transitionAgentOrder(this.deps.databaseUrl, order.id, ["approved"], "failed", {
          detail: { error: error instanceof Error ? error.message : "execution failed" },
        });
      }
    }
    runtime.lastTickAt = new Date().toISOString();
    if (freshestDataAge != null)
      runtime.lastDataAt = new Date(Date.now() - freshestDataAge).toISOString();
    await saveAgentRuntimeState(this.deps.databaseUrl, runtime);
    return recorded;
  }
}
