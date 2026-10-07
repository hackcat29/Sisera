import { withAdvisoryLock } from "@sisera/db";
import type { FastifyBaseLogger } from "fastify";
import type { AgentService } from "./agent-service.js";
import type { AssetCatalog } from "./catalog.js";
import type { IntelligenceService } from "./intelligence-service.js";
import type { PolicyService } from "./policy-service.js";
import type { WalletLeaderboardService } from "./wallet-leaderboard.js";

const LOCKS = {
  policies: 7_310_001,
  agents: 7_310_002,
  events: 7_310_003,
  wallets: 7_310_004,
} as const;

/**
 * Background loops for conversational policies, agents and event collection. Each loop takes a
 * Postgres advisory lock, so with several API instances only one evaluates at a time, and a loop
 * never overlaps with its own previous run.
 */
export class PlatformScheduler {
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly running = new Set<string>();

  constructor(
    private readonly databaseUrl: string,
    private readonly services: {
      policies: PolicyService | null;
      agents: AgentService | null;
      intelligence: IntelligenceService;
      catalog: AssetCatalog;
      walletLeaderboard?: WalletLeaderboardService | null;
    },
    private readonly log: FastifyBaseLogger,
  ) {}

  private every(name: keyof typeof LOCKS, intervalMs: number, task: () => Promise<unknown>) {
    const run = async () => {
      if (this.running.has(name)) return;
      this.running.add(name);
      const started = Date.now();
      try {
        const outcome = await withAdvisoryLock(this.databaseUrl, LOCKS[name], task);
        if (outcome.ran)
          this.log.debug(
            { loop: name, ms: Date.now() - started, result: outcome.value },
            "scheduler loop completed",
          );
      } catch (error) {
        this.log.warn(
          { loop: name, error: error instanceof Error ? error.message : "unknown" },
          "scheduler loop failed",
        );
      } finally {
        this.running.delete(name);
      }
    };
    this.timers.push(setInterval(run, intervalMs));
    setTimeout(run, 5_000 + Math.random() * 5_000).unref();
  }

  start() {
    const { policies, agents, intelligence, catalog, walletLeaderboard } = this.services;
    if (walletLeaderboard) this.every("wallets", 30_000, () => walletLeaderboard.refreshTracked());
    if (policies) this.every("policies", 30_000, () => policies.evaluateActive());
    if (agents) this.every("agents", 60_000, () => agents.tick());
    this.every("events", 15 * 60_000, async () => {
      const assets = await catalog.list({ includeAgents: true });
      const watchlist = [
        ...assets.filter((asset) => asset.kind === "pre_ipo"),
        ...assets
          .filter((asset) => asset.kind === "public_equity")
          .sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0))
          .slice(0, 25),
        ...assets
          .filter((asset) => asset.kind === "agent_token")
          .sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0))
          .slice(0, 10),
      ];
      return { refreshed: await intelligence.refreshWatchlist(watchlist) };
    });
    for (const timer of this.timers) timer.unref();
  }

  stop() {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
  }
}
