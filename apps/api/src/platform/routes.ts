import { getRiskPreferences, saveRiskPreferences } from "@sisera/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requirePermission } from "../auth.js";
import type { ApiConfig } from "../config.js";
import type { WalletChain } from "../wallet-ownership.js";
import type { AgentMarketService } from "./agent-market.js";
import { AgentError } from "./agent-service.js";
import type { AgentService } from "./agent-service.js";
import { AssetCatalog } from "./catalog.js";
import type { CopilotService } from "./copilot-service.js";
import { DBC_PRESETS } from "./dbc.js";
import type { IntelligenceService } from "./intelligence-service.js";
import type { LaunchService } from "./launch-service.js";
import type { LiveBasisService } from "./live-basis.js";
import type { MarketplaceService } from "./marketplace-service.js";
import type { PolicyService } from "./policy-service.js";
import type { PortfolioService } from "./portfolio-service.js";
import type { RankingService } from "./rankings.js";
import type { ThematicResearchService } from "./thematic-research.js";
import type { WalletLeaderboardService } from "./wallet-leaderboard.js";

export type PlatformServices = {
  research: ThematicResearchService;
  basis: LiveBasisService;
  catalog: AssetCatalog;
  intelligence: IntelligenceService;
  rankings: RankingService;
  agentMarket: AgentMarketService;
  copilot: CopilotService;
  portfolio: PortfolioService | null;
  policies: PolicyService | null;
  agents: AgentService | null;
  launches: LaunchService | null;
  marketplace: MarketplaceService | null;
  walletLeaderboard: WalletLeaderboardService | null;
  requireOwnedWallet: (
    reply: FastifyReply,
    subject: string,
    address: string,
    chain: WalletChain,
  ) => Promise<boolean>;
};

const Mint = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const AssetKey = z.string().regex(/^[A-Za-z0-9.$:_-]{1,64}$/);
const AgentId = z.object({ id: z.string().regex(/^custom:[0-9a-f-]{36}$/) });
const Uuid = z.object({ id: z.string().uuid() });
const Stage = z.enum([
  "draft",
  "backtest",
  "stress_test",
  "paper",
  "shadow",
  "limited_live",
  "live",
  "paused",
]);
const Autonomy = z.enum([
  "research",
  "suggest",
  "confirm",
  "policy_auto",
  "autonomous",
  "risk_only",
]);

export function registerPlatformRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  services: PlatformServices,
) {
  /** Write routes need a real account; local development accepts the dev operator identity. */
  const account = async (request: FastifyRequest, reply: FastifyReply) => {
    const principal = request.principal;
    const devIdentity =
      config.SISERA_ALLOW_DEV_AUTH &&
      config.NODE_ENV !== "production" &&
      principal &&
      principal.subject !== "public";
    if (!principal || (!principal.subject.startsWith("privy:") && !devIdentity)) {
      await reply
        .code(403)
        .send({ error: "account_required", message: "Sign in with your account to continue." });
      return null;
    }
    return principal;
  };
  const unavailable = (reply: FastifyReply, what: string) =>
    reply.code(503).send({
      error: "persistence_unavailable",
      message: `${what} needs the account database, which is not configured.`,
    });

  app.get(
    "/v1/marketplace",
    { preHandler: requirePermission("market:read") },
    async (request, reply) => {
      if (!services.marketplace) return unavailable(reply, "Marketplace");
      return { data: await services.marketplace.browse(request.principal?.subject ?? "public") };
    },
  );
  app.get(
    "/v1/marketplace/:id",
    { preHandler: requirePermission("market:read") },
    async (request, reply) => {
      if (!services.marketplace) return unavailable(reply, "Marketplace");
      return {
        data: await services.marketplace.detail(
          request.principal?.subject ?? "public",
          Uuid.parse(request.params).id,
        ),
      };
    },
  );
  app.post(
    "/v1/marketplace/:id/reviews",
    { preHandler: requirePermission("agent:read") },
    async (request, reply) => {
      const principal = await account(request, reply);
      if (!principal) return reply;
      if (!services.marketplace) return unavailable(reply, "Marketplace");
      return {
        data: await services.marketplace.review(
          principal.subject,
          Uuid.parse(request.params).id,
          request.body,
        ),
      };
    },
  );
  app.post(
    "/v1/marketplace",
    { preHandler: requirePermission("agent:read") },
    async (request, reply) => {
      const principal = await account(request, reply);
      if (!principal) return reply;
      if (!services.marketplace) return unavailable(reply, "Marketplace");
      const wallet = Mint.parse((request.body as { payoutWallet?: unknown })?.payoutWallet);
      if (!(await services.requireOwnedWallet(reply, principal.subject, wallet, "solana")))
        return reply;
      return reply
        .code(201)
        .send({ data: await services.marketplace.publish(principal, request.body) });
    },
  );
  app.put(
    "/v1/marketplace/:id/unlist",
    { preHandler: requirePermission("agent:read") },
    async (request, reply) => {
      const principal = await account(request, reply);
      if (!principal) return reply;
      if (!services.marketplace) return unavailable(reply, "Marketplace");
      return {
        data: await services.marketplace.unlist(principal.subject, Uuid.parse(request.params).id),
      };
    },
  );
  app.post(
    "/v1/marketplace/:id/checkout",
    {
      preHandler: requirePermission("agent:read"),
      config: { rateLimit: { max: 8, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const principal = await account(request, reply);
      if (!principal) return reply;
      if (!services.marketplace) return unavailable(reply, "Marketplace");
      const { wallet } = z.object({ wallet: Mint.optional() }).strict().parse(request.body);
      if (
        wallet &&
        !(await services.requireOwnedWallet(reply, principal.subject, wallet, "solana"))
      )
        return reply;
      return {
        data: await services.marketplace.checkout(
          principal.subject,
          Uuid.parse(request.params).id,
          wallet,
        ),
      };
    },
  );
  app.get(
    "/v1/marketplace/checkouts",
    { preHandler: requirePermission("agent:read") },
    async (request, reply) => {
      const principal = await account(request, reply);
      if (!principal) return reply;
      if (!services.marketplace) return unavailable(reply, "Marketplace");
      return { data: await services.marketplace.pending(principal.subject) };
    },
  );
  app.post(
    "/v1/marketplace/checkouts/:id/settle",
    {
      preHandler: requirePermission("agent:read"),
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const principal = await account(request, reply);
      if (!principal) return reply;
      if (!services.marketplace) return unavailable(reply, "Marketplace");
      const { signedTransaction } = z
        .object({ signedTransaction: z.string().min(40).max(5000).optional() })
        .strict()
        .parse(request.body);
      return {
        data: await services.marketplace.settle(
          principal.subject,
          Uuid.parse(request.params).id,
          signedTransaction,
        ),
      };
    },
  );
  app.post(
    "/v1/marketplace/:id/import",
    { preHandler: requirePermission("agent:read") },
    async (request, reply) => {
      const principal = await account(request, reply);
      if (!principal) return reply;
      if (!services.marketplace) return unavailable(reply, "Marketplace");
      return reply.code(201).send({
        data: await services.marketplace.import(principal, Uuid.parse(request.params).id),
      });
    },
  );
  for (const endpoint of ["/v1/leaderboard", "/v1/leaderboard/wallets"])
    app.get(endpoint, { preHandler: requirePermission("market:read") }, async (request, reply) => {
      if (!services.walletLeaderboard) return unavailable(reply, "Wallet leaderboard");
      const { window, search } = z
        .object({
          window: z.enum(["24h", "7d", "30d"]).default("7d"),
          search: z.string().max(100).default(""),
        })
        .parse(request.query);
      return { data: await services.walletLeaderboard.board(window, search) };
    });
  app.post(
    "/v1/leaderboard/wallets",
    {
      preHandler: requirePermission("market:read"),
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const principal = await account(request, reply);
      if (!principal) return reply;
      if (!services.walletLeaderboard) return unavailable(reply, "Wallet leaderboard");
      const { address } = z
        .object({ address: z.union([Mint, z.string().regex(/^0x[a-fA-F0-9]{40}$/)]) })
        .strict()
        .parse(request.body);
      await services.walletLeaderboard.track(address);
      return reply.code(201).send({ data: { address } });
    },
  );

  // ------------------------------------------------------------------ catalog and intelligence
  app.get(
    "/v1/catalog/assets",
    { preHandler: requirePermission("market:read") },
    async (request) => {
      const { kind, agents } = z
        .object({
          kind: z.enum(["public_equity", "pre_ipo", "agent_token"]).optional(),
          agents: z.coerce.boolean().default(false),
        })
        .parse(request.query);
      const assets = await services.catalog.list({
        includeAgents: agents || kind === "agent_token",
        withReferences: kind === "public_equity",
      });
      return { data: kind ? assets.filter((asset) => asset.kind === kind) : assets };
    },
  );
  app.get(
    "/v1/catalog/assets/:key",
    { preHandler: requirePermission("market:read") },
    async (request, reply) => {
      const { key } = z.object({ key: AssetKey }).parse(request.params);
      const asset = await services.catalog.byKey(key);
      return asset
        ? { data: asset }
        : reply.code(404).send({ error: "not_found", message: "Unknown asset." });
    },
  );
  app.get(
    "/v1/intelligence/assets/:key/events",
    { preHandler: requirePermission("market:read") },
    async (request, reply) => {
      const { key } = z.object({ key: AssetKey }).parse(request.params);
      const asset = await services.catalog.byKey(key);
      if (!asset) return reply.code(404).send({ error: "not_found", message: "Unknown asset." });
      return { data: await services.intelligence.forAsset(asset) };
    },
  );
  app.get(
    "/v1/intelligence/assets/:key/explain",
    {
      preHandler: requirePermission("market:read"),
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { key } = z.object({ key: AssetKey }).parse(request.params);
      const { window } = z
        .object({ window: z.coerce.number().int().min(1).max(168).default(24) })
        .parse(request.query);
      const asset = await services.catalog.byKey(key);
      if (!asset) return reply.code(404).send({ error: "not_found", message: "Unknown asset." });
      return { data: await services.intelligence.explain(asset, window) };
    },
  );
  app.get(
    "/v1/intelligence/changes",
    { preHandler: requirePermission("market:read") },
    async (request) => {
      const { minutes, assets } = z
        .object({
          minutes: z.coerce.number().int().min(5).max(10_080).default(60),
          assets: z.string().max(2000).optional(),
        })
        .parse(request.query);
      return {
        data: await services.intelligence.whatChanged(minutes, assets?.split(",").filter(Boolean)),
      };
    },
  );
  app.get("/v1/intelligence/macro", { preHandler: requirePermission("market:read") }, async () => ({
    data: await services.intelligence.macro(),
  }));
  app.get(
    "/v1/intelligence/events",
    { preHandler: requirePermission("market:read") },
    async (request) => {
      const query = z
        .object({
          since: z.string().datetime().optional(),
          asset: AssetKey.optional(),
          limit: z.coerce.number().int().min(1).max(500).default(100),
        })
        .parse(request.query);
      return {
        data: await services.intelligence.stored({
          ...(query.since ? { since: query.since } : {}),
          ...(query.asset ? { assetKey: query.asset } : {}),
          limit: query.limit,
        }),
      };
    },
  );

  // ------------------------------------------------------------------ rankings and agent market
  app.get(
    "/v1/rankings/fair-value",
    { preHandler: requirePermission("market:read") },
    async (request) => {
      const query = z
        .object({
          minLiquidityUsd: z.coerce.number().min(0).default(10_000),
          freshOnly: z.coerce.boolean().default(false),
        })
        .parse(request.query);
      return { data: await services.rankings.fairValueGaps({ ...query, limit: 40 }) };
    },
  );
  app.get(
    "/v1/rankings/private",
    { preHandler: requirePermission("market:read") },
    async (request) => {
      const { by } = z
        .object({
          by: z
            .enum([
              "divergence",
              "discount",
              "premium",
              "liquidity",
              "momentum",
              "risk",
              "news",
              "portfolio_fit",
            ])
            .default("divergence"),
        })
        .parse(request.query);
      const subject = request.principal?.subject;
      return {
        data: await services.rankings.privateMarkets(
          by,
          subject && subject !== "public" ? subject : undefined,
        ),
        by,
      };
    },
  );
  app.get(
    "/v1/agent-market/stock-paired",
    { preHandler: requirePermission("market:read") },
    async () => ({ data: await services.agentMarket.stockPaired() }),
  );
  app.get(
    "/v1/agent-market/rank",
    {
      preHandler: requirePermission("market:read"),
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { by } = z
        .object({
          by: z.enum(["liquidity", "momentum", "volume", "quality", "risk"]).default("liquidity"),
        })
        .parse(request.query);
      return { data: await services.agentMarket.rank(by), by };
    },
  );
  app.get("/v1/agent-market/today", { preHandler: requirePermission("market:read") }, async () => ({
    data: await services.agentMarket.today(),
  }));
  app.get(
    "/v1/agent-market/tokens/:mint",
    { preHandler: requirePermission("market:read") },
    async (request, reply) => {
      const { mint } = z.object({ mint: Mint }).parse(request.params);
      const detail = await services.agentMarket.detail(mint);
      return detail
        ? { data: detail }
        : reply.code(404).send({ error: "not_found", message: "Unknown agent token." });
    },
  );

  // ------------------------------------------------------------------ copilot and policies
  app.post(
    "/v1/copilot/chat",
    {
      preHandler: requirePermission("market:read"),
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal || principal.subject === "public")
        return reply
          .code(401)
          .send({ error: "unauthorized", message: "Sign in to use Sisera AI." });
      const input = z
        .object({
          message: z.string().trim().min(1).max(2000),
          history: z
            .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
            .max(20)
            .default([]),
          contextAssetKey: AssetKey.nullable().optional(),
          threadId: z.string().uuid().nullable().optional(),
          mode: z.enum(["paper", "live"]).default("paper"),
        })
        .parse(request.body);
      return {
        data: await services.copilot.reply(principal, {
          message: input.message,
          history: input.history,
          contextAssetKey: input.contextAssetKey ?? null,
          threadId: input.threadId ?? null,
          mode: input.mode,
        }),
      };
    },
  );
  app.post(
    "/v1/policies/compile",
    {
      preHandler: requirePermission("order:paper:create"),
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const principal = await account(request, reply);
      if (!principal) return reply;
      if (!services.policies) return unavailable(reply, "Trading policies");
      const input = z
        .object({
          text: z.string().trim().min(3).max(2000),
          assetKey: AssetKey.nullable().optional(),
          mode: z.enum(["paper", "live"]).default("paper"),
        })
        .parse(request.body);
      return {
        data: await services.policies.compile(principal.subject, input.text, {
          assetKey: input.assetKey ?? null,
          mode: input.mode,
        }),
      };
    },
  );
  app.post(
    "/v1/policies",
    {
      preHandler: requirePermission("order:paper:create"),
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const principal = await account(request, reply);
      if (!principal) return reply;
      if (!services.policies) return unavailable(reply, "Trading policies");
      const input = z
        .object({
          policy: z.record(z.unknown()),
          activate: z.boolean().default(true),
          wallet: Mint.nullable().optional(),
        })
        .parse(request.body);
      const live = (input.policy as { action?: { mode?: string } } | null)?.action?.mode === "live";
      if (live && !principal.roles.some((role) => role === "trader" || role === "admin"))
        return reply
          .code(403)
          .send({ error: "forbidden", message: "Live policies require trading permission." });
      if (
        live &&
        input.wallet &&
        !(await services.requireOwnedWallet(reply, principal.subject, input.wallet, "solana"))
      )
        return reply;
      return reply.code(201).send({
        data: await services.policies.create(principal, {
          policy: input.policy,
          activate: input.activate,
          wallet: input.wallet ?? null,
        }),
      });
    },
  );
  app.get(
    "/v1/policies",
    { preHandler: requirePermission("portfolio:read") },
    async (request, reply) => {
      const principal = await account(request, reply);
      if (!principal) return reply;
      if (!services.policies) return unavailable(reply, "Trading policies");
      return { data: await services.policies.list(principal.subject) };
    },
  );
  for (const action of ["activate", "cancel"] as const)
    app.post(
      `/v1/policies/:id/${action}`,
      { preHandler: requirePermission("order:paper:create") },
      async (request, reply) => {
        const principal = await account(request, reply);
        if (!principal) return reply;
        if (!services.policies) return unavailable(reply, "Trading policies");
        const { id } = Uuid.parse(request.params);
        return { data: await services.policies[action](principal.subject, id) };
      },
    );
  app.post(
    "/v1/policies/:id/approve",
    {
      preHandler: requirePermission("order:paper:create"),
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const principal = await account(request, reply);
      if (!principal) return reply;
      if (!services.policies) return unavailable(reply, "Trading policies");
      const { id } = Uuid.parse(request.params);
      return { data: await services.policies.approve(principal, id) };
    },
  );
  app.post(
    "/v1/policies/:id/execute",
    {
      preHandler: requirePermission("order:live:create"),
      config: { rateLimit: { max: 8, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const principal = await account(request, reply);
      if (!principal) return reply;
      if (!services.policies) return unavailable(reply, "Trading policies");
      const { id } = Uuid.parse(request.params);
      const input = z
        .object({
          orderId: z.string().uuid(),
          signedTransaction: z.string().min(40).max(5000),
        })
        .parse(request.body);
      return {
        data: await services.policies.executeSigned(
          principal,
          id,
          input.orderId,
          input.signedTransaction,
        ),
      };
    },
  );

  // Immutable, account-scoped research. Clients supply IDs, never executable evidence.
  const TakeId = z
    .object({
      takeId: z.string().max(100).optional(),
      take: z.object({ id: z.string().max(100) }).optional(),
    })
    .refine((i) => Boolean(i.takeId ?? i.take?.id), "Research ID required");
  app.get("/v1/takes", { preHandler: requirePermission("market:read") }, async (request, reply) => {
    const principal = await account(request, reply);
    if (!principal) return reply;
    return { data: await services.research.list(principal.subject) };
  });
  app.get(
    "/v1/takes/:id",
    { preHandler: requirePermission("market:read") },
    async (request, reply) => {
      const principal = await account(request, reply);
      if (!principal) return reply;
      return {
        data: await services.research.saved(
          principal.subject,
          z.object({ id: z.string().max(100) }).parse(request.params).id,
          false,
        ),
      };
    },
  );
  app.post(
    "/v1/takes/compile",
    {
      preHandler: requirePermission("market:read"),
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const principal = await account(request, reply);
      if (!principal) return reply;
      const input = z
        .object({
          text: z.string().trim().min(3).max(2000),
          totalNotionalUsd: z.number().positive().max(1_000_000).default(5000),
          maxWeightPct: z.number().min(15).max(50).multipleOf(0.01).optional(),
          minLiquidityUsd: z.number().min(25000).max(1e9).optional(),
        })
        .parse(request.body);
      return {
        data: await services.research.compile(
          principal.subject,
          input.text,
          input.totalNotionalUsd,
          input,
        ),
      };
    },
  );
  app.post(
    "/v1/takes/fork",
    { preHandler: requirePermission("order:paper:create") },
    async (request, reply) => {
      const principal = await account(request, reply);
      if (!principal) return reply;
      const input = TakeId.and(
        z.object({
          totalNotionalUsd: z.number().positive().max(1_000_000).optional(),
          constituentTweaks: z
            .array(z.object({ symbol: z.string(), weightPct: z.number().min(1).max(50) }))
            .max(8)
            .optional(),
        }),
      ).parse(request.body);
      return {
        data: await services.research.fork(
          principal.subject,
          input.takeId ?? input.take?.id ?? "",
          input.totalNotionalUsd,
          input.constituentTweaks,
        ),
      };
    },
  );
  app.post(
    "/v1/takes/arm",
    {
      preHandler: requirePermission("order:paper:create"),
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const principal = await account(request, reply);
      if (!principal) return reply;
      if (!services.policies) return unavailable(reply, "Trading policies");
      const input = TakeId.and(
        z.object({
          mode: z.enum(["paper", "live"]).default("paper"),
          wallet: Mint.nullable().optional(),
        }),
      ).parse(request.body);
      // Research has not passed the mandatory agent promotion pipeline.
      if (input.mode !== "paper")
        throw new AgentError("Promote an evaluated strategy before enabling live capital.", 409);
      const take = await services.research.saved(
        principal.subject,
        input.takeId ?? input.take?.id ?? "",
      );
      const current = await services.catalog.list({ withReferences: true });
      const assets = take.constituents.map((c) =>
        current.find((a) => a.key === c.assetKey && a.mint === c.mint),
      );
      if (
        assets.some(
          (a) =>
            !a ||
            a.tradingHalted ||
            !a.priceUsd ||
            Date.now() - Date.parse(a.observedAt) > 300000 ||
            (a.liquidityUsd ?? 0) < (take.research?.minLiquidityUsd ?? 25000),
        )
      )
        throw new AgentError("Market conditions changed. Refresh this research.", 409);
      const createdPolicies: Awaited<ReturnType<PolicyService["create"]>>[] = [];
      try {
        for (const [i, c] of take.constituents.entries()) {
          const asset = assets[i];
          if (!asset) throw new AgentError("Asset unavailable.", 409);
          const row = await services.policies.create(principal, {
            activate: false,
            wallet: input.wallet ?? null,
            source: "thematic_take",
            policy: {
              version: 1,
              name: `${take.title.slice(0, 80)} · ${c.symbol}`,
              instrument: AssetCatalog.toInstrumentRef(asset),
              action: { side: "buy", notionalUsd: c.targetNotionalUsd, mode: "paper" },
              triggers: c.entryTriggers,
              invalidation: {
                expiresAt: take.research?.expiresAt ?? take.createdAt,
                conditions: c.invalidationRules,
              },
              execution: { maxSlippageBps: 100, requireApproval: false },
              limits: { maxPortfolioWeightPct: c.weightPct, maxLiquidityUsagePct: 2 },
              sourceText: `Research ${take.id}: ${c.symbol}`,
            },
          });
          createdPolicies.push(row);
        }
        for (const row of createdPolicies)
          await services.policies.activate(principal.subject, row.id);
      } catch (error) {
        await Promise.allSettled(
          createdPolicies.map((row) => services.policies?.cancel(principal.subject, row.id)),
        );
        throw error;
      }
      return reply.code(201).send({
        data: {
          takeId: take.id,
          armedCount: createdPolicies.length,
          policies: createdPolicies,
          status: "armed",
          autopilot: true,
          mode: "paper",
        },
      });
    },
  );
  app.post(
    "/v1/takes/tokenize",
    { preHandler: requirePermission("market:read") },
    async (request, reply) => {
      const principal = await account(request, reply);
      if (!principal) return reply;
      const input = TakeId.parse(request.body);
      const take = await services.research.saved(
        principal.subject,
        input.takeId ?? input.take?.id ?? "",
      );
      const equity = take.constituents.find((c) => c.category === "tokenized_equity");
      if (!equity) throw new AgentError("A public equity reference is required for this launch.");
      return {
        data: {
          takeId: take.id,
          tokenSymbol: `TKE${take.title
            .replace(/[^A-Za-z0-9]/g, "")
            .slice(0, 5)
            .toUpperCase()}`,
          tokenName: `${take.title.slice(0, 24)} Take`,
          thesis: take.thesis,
          pairedStock: equity.symbol,
          curvePreset: "reference_anchored",
          suggestedQuoteAsset: "USDC",
          creatorFeeBps: 50,
          antiSniperFeeBps: 250,
          targetCapUsd: 100000,
          graduatesTo: "Meteora DAMM v2",
          agentIdentity: {
            name: take.title,
            autonomy: "research",
            strategyUniverse: take.constituents.map((c) => c.symbol),
          },
        },
      };
    },
  );
  app.get(
    "/v1/arbitrage/basis",
    { preHandler: requirePermission("market:read") },
    async (request, reply) => {
      const input = z
        .object({
          notionalUsd: z.coerce.number().positive().max(1_000_000).default(5000),
          holdingDays: z.coerce.number().min(1).max(365).default(30),
        })
        .parse(request.query);
      try {
        return { data: await services.basis.list(input.notionalUsd, input.holdingDays) };
      } catch {
        return reply
          .code(503)
          .send({ error: "quotes_unavailable", message: "Live venue quotes unavailable." });
      }
    },
  );
  app.post(
    "/v1/arbitrage/arm",
    { preHandler: requirePermission("agent:manage") },
    async (request, reply) => {
      const principal = await account(request, reply);
      if (!principal) return reply;
      if (!services.agents) return unavailable(reply, "Strategy drafts");
      const input = z
        .object({
          asset: z.string().trim().min(2).max(16),
          notionalUsd: z.number().positive().max(1_000_000).default(5000),
          maxLeverage: z.literal(1).optional(),
        })
        .parse(request.body);
      return reply.code(201).send({
        data: await services.agents.armBasisHarvester(principal, {
          asset: input.asset,
          notionalUsd: input.notionalUsd,
          maxLeverage: 1,
        }),
      });
    },
  );

  // ------------------------------------------------------------------ portfolio and risk
  app.get(
    "/v1/portfolio",
    {
      preHandler: requirePermission("portfolio:read"),
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const principal = await account(request, reply);
      if (!principal) return reply;
      if (!services.portfolio) return unavailable(reply, "The unified portfolio");
      const { mode, wallets } = z
        .object({
          mode: z.enum(["paper", "live"]).default("paper"),
          wallets: z.string().max(400).optional(),
        })
        .parse(request.query);
      const requested = (wallets?.split(",") ?? [])
        .filter((wallet) => Mint.safeParse(wallet).success)
        .slice(0, 4);
      for (const wallet of requested)
        if (!(await services.requireOwnedWallet(reply, principal.subject, wallet, "solana")))
          return reply;
      return { data: await services.portfolio.view(principal.subject, mode, requested) };
    },
  );
  app.post(
    "/v1/portfolio/impact",
    {
      preHandler: requirePermission("portfolio:read"),
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const principal = await account(request, reply);
      if (!principal) return reply;
      if (!services.portfolio) return unavailable(reply, "Portfolio impact");
      const input = z
        .object({
          assetKey: AssetKey,
          side: z.enum(["buy", "sell"]),
          notionalUsd: z.number().positive().max(1_000_000),
          mode: z.enum(["paper", "live"]).default("paper"),
        })
        .parse(request.body);
      const asset = await services.catalog.byKey(input.assetKey);
      if (!asset) return reply.code(404).send({ error: "not_found", message: "Unknown asset." });
      return {
        data: await services.portfolio.impact(principal.subject, input.mode, {
          asset,
          side: input.side,
          notionalUsd: input.notionalUsd,
        }),
      };
    },
  );
  app.get(
    "/v1/risk/preferences",
    { preHandler: requirePermission("risk:read") },
    async (request, reply) => {
      const principal = await account(request, reply);
      if (!principal) return reply;
      if (!config.DATABASE_URL) return unavailable(reply, "Risk preferences");
      return { data: await getRiskPreferences(config.DATABASE_URL, principal.subject) };
    },
  );
  app.put(
    "/v1/risk/preferences",
    { preHandler: requirePermission("portfolio:read") },
    async (request, reply) => {
      const principal = await account(request, reply);
      if (!principal) return reply;
      if (!config.DATABASE_URL) return unavailable(reply, "Risk preferences");
      const input = z
        .object({
          liquidityThresholdUsd: z.number().min(0).max(1e9),
          mandate: z
            .object({
              maxGrossExposureUsd: z.number().positive().max(1e9),
              maxPositionWeightPct: z.number().positive().max(100),
              maxUnderlyingWeightPct: z.number().positive().max(100),
              maxDailyLossUsd: z.number().positive().max(1e9),
              maxAgentTokenWeightPct: z.number().min(0).max(100),
              maxIlliquidExitPct: z.number().positive().max(100),
            })
            .partial()
            .strict(),
        })
        .parse(request.body);
      return {
        data: await saveRiskPreferences(
          config.DATABASE_URL,
          principal.subject,
          input as { liquidityThresholdUsd: number; mandate: Record<string, number> },
        ),
      };
    },
  );

  // ------------------------------------------------------------------ agents
  const agents = (reply: FastifyReply) => {
    if (services.agents) return services.agents;
    void unavailable(reply, "Agents");
    return null;
  };
  app.get(
    "/v1/agents/:id",
    { preHandler: requirePermission("agent:read") },
    async (request, reply) => {
      const principal = await account(request, reply);
      const service = principal && agents(reply);
      if (!principal || !service) return reply;
      return { data: await service.detail(principal, AgentId.parse(request.params).id) };
    },
  );
  app.post(
    "/v1/agents/:id/versions",
    { preHandler: requirePermission("agent:manage") },
    async (request, reply) => {
      const principal = await account(request, reply);
      const service = principal && agents(reply);
      if (!principal || !service) return reply;
      return reply.code(201).send({
        data: await service.newVersion(principal, AgentId.parse(request.params).id, request.body),
      });
    },
  );
  app.post(
    "/v1/agents/:id/promote",
    { preHandler: requirePermission("agent:read") },
    async (request, reply) => {
      const principal = await account(request, reply);
      const service = principal && agents(reply);
      if (!principal || !service) return reply;
      const input = z.object({ to: Stage, autonomy: Autonomy.optional() }).parse(request.body);
      const reviewer = principal.roles.some((role) => role === "risk_manager" || role === "admin");
      if (!reviewer && !principal.roles.includes("trader"))
        return reply.code(403).send({
          error: "forbidden",
          message: "Promotion requires agent management or risk permissions.",
        });
      return {
        data: await service.promote(
          principal,
          AgentId.parse(request.params).id,
          input.to,
          input.autonomy,
        ),
      };
    },
  );
  app.post(
    "/v1/agents/:id/autonomy",
    { preHandler: requirePermission("agent:manage") },
    async (request, reply) => {
      const principal = await account(request, reply);
      const service = principal && agents(reply);
      if (!principal || !service) return reply;
      const { autonomy } = z.object({ autonomy: Autonomy }).parse(request.body);
      return {
        data: await service.setAutonomy(principal, AgentId.parse(request.params).id, autonomy),
      };
    },
  );
  for (const action of ["backtest", "stress", "evaluate"] as const)
    app.post(
      `/v1/agents/:id/${action}`,
      {
        preHandler: requirePermission("agent:read"),
        config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
      },
      async (request, reply) => {
        const principal = await account(request, reply);
        const service = principal && agents(reply);
        if (!principal || !service) return reply;
        const id = AgentId.parse(request.params).id;
        const result =
          action === "backtest"
            ? await service.backtest(principal, id)
            : action === "stress"
              ? await service.stress(principal, id)
              : await service.evaluateForward(principal, id);
        return reply.code(201).send({ data: result });
      },
    );
  app.post(
    "/v1/agents/:id/pause",
    { preHandler: requirePermission("agent:read") },
    async (request, reply) => {
      const principal = await account(request, reply);
      const service = principal && agents(reply);
      if (!principal || !service) return reply;
      const { reason } = z
        .object({ reason: z.string().trim().min(3).max(300).default("Paused by operator.") })
        .parse(request.body ?? {});
      return { data: await service.pause(principal, AgentId.parse(request.params).id, reason) };
    },
  );
  app.post(
    "/v1/agents/emergency-halt",
    { preHandler: requirePermission("agent:manage") },
    async (request, reply) => {
      const principal = await account(request, reply);
      const service = principal && agents(reply);
      if (!principal || !service) return reply;
      const { reason } = z
        .object({
          reason: z.string().trim().min(3).max(300).default("Global fleet emergency halt."),
        })
        .parse(request.body ?? {});
      return { data: await service.emergencyHaltAll(principal, reason) };
    },
  );
  app.get(
    "/v1/agents/:id/vault",
    { preHandler: requirePermission("agent:read") },
    async (request, reply) => {
      const principal = await account(request, reply);
      const service = principal && agents(reply);
      if (!principal || !service) return reply;
      return { data: await service.getAgentVault(principal, AgentId.parse(request.params).id) };
    },
  );
  app.post(
    "/v1/agents/:id/vault/deposit",
    { preHandler: requirePermission("order:paper:create") },
    async (request, reply) => {
      const principal = await account(request, reply);
      const service = principal && agents(reply);
      if (!principal || !service) return reply;
      const { amountUsd } = z
        .object({ amountUsd: z.number().positive().max(1_000_000) })
        .parse(request.body);
      return {
        data: await service.depositToVault(principal, AgentId.parse(request.params).id, amountUsd),
      };
    },
  );
  app.get(
    "/v1/agent-vaults/leaderboard",
    { preHandler: requirePermission("agent:read") },
    async (request, reply) => {
      const principal = await account(request, reply);
      const service = principal && agents(reply);
      if (!principal || !service) return reply;
      return { data: await service.listVaultLeaderboard() };
    },
  );
  app.get(
    "/v1/agent-orders",
    { preHandler: requirePermission("portfolio:read") },
    async (request, reply) => {
      const principal = await account(request, reply);
      const service = principal && agents(reply);
      if (!principal || !service) return reply;
      return { data: await service.listOrders(principal) };
    },
  );
  app.post(
    "/v1/agent-orders/:id/approve",
    {
      preHandler: requirePermission("order:paper:create"),
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const principal = await account(request, reply);
      const service = principal && agents(reply);
      if (!principal || !service) return reply;
      return { data: await service.approveOrder(principal, Uuid.parse(request.params).id) };
    },
  );
  app.post(
    "/v1/agent-orders/:id/reject",
    { preHandler: requirePermission("order:paper:create") },
    async (request, reply) => {
      const principal = await account(request, reply);
      const service = principal && agents(reply);
      if (!principal || !service) return reply;
      return { data: await service.rejectOrder(principal, Uuid.parse(request.params).id) };
    },
  );
  app.post(
    "/v1/agent-orders/:id/execute",
    {
      preHandler: requirePermission("order:live:create"),
      config: { rateLimit: { max: 8, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const principal = await account(request, reply);
      const service = principal && agents(reply);
      if (!principal || !service) return reply;
      const input = z
        .object({
          swapOrderId: z.string().uuid(),
          signedTransaction: z.string().min(40).max(5000),
        })
        .parse(request.body);
      return {
        data: await service.executeSignedOrder(
          principal,
          Uuid.parse(request.params).id,
          input.swapOrderId,
          input.signedTransaction,
        ),
      };
    },
  );

  // ------------------------------------------------------------------ launches
  const launches = (reply: FastifyReply) => {
    if (services.launches) return services.launches;
    void unavailable(reply, "Launches");
    return null;
  };
  const launchGate = async (request: FastifyRequest, reply: FastifyReply, wallet: unknown) => {
    if (!config.SISERA_LIVE_LAUNCHES_ENABLED) {
      await reply.code(503).send({
        error: "launches_disabled",
        message: "Token launches are not enabled on this deployment.",
      });
      return null;
    }
    const principal = await account(request, reply);
    if (!principal) return null;
    const address = Mint.safeParse(wallet);
    if (!address.success) {
      await reply.code(400).send({
        error: "validation_error",
        message: "Choose the Solana wallet that pays for the launch.",
      });
      return null;
    }
    return (await services.requireOwnedWallet(reply, principal.subject, address.data, "solana"))
      ? principal
      : null;
  };
  app.get(
    "/v1/launches/dbc/presets",
    { preHandler: requirePermission("market:read") },
    async () => ({
      data: Object.entries(DBC_PRESETS).map(([id, preset]) => ({ id, ...preset })),
      enabled: config.SISERA_LIVE_LAUNCHES_ENABLED,
    }),
  );
  app.post(
    "/v1/launches/dbc/preview",
    {
      preHandler: requirePermission("market:read"),
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const service = launches(reply);
      if (!service) return reply;
      return { data: await service.previewDbc(request.body) };
    },
  );
  app.post(
    "/v1/launches/dbc/prepare",
    {
      preHandler: requirePermission("order:live:create"),
      config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const principal = await launchGate(
        request,
        reply,
        (request.body as { wallet?: unknown } | null)?.wallet,
      );
      const service = principal && launches(reply);
      if (!principal || !service) return reply;
      return reply.code(201).send({ data: await service.prepareDbc(principal, request.body) });
    },
  );
  app.post(
    "/v1/launches/clawpump/quote",
    {
      preHandler: requirePermission("order:live:create"),
      config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const principal = await launchGate(
        request,
        reply,
        (request.body as { wallet?: unknown } | null)?.wallet,
      );
      const service = principal && launches(reply);
      if (!principal || !service) return reply;
      return reply.code(201).send({ data: await service.quoteClawpump(principal, request.body) });
    },
  );
  app.post(
    "/v1/launches/:id/submit",
    {
      preHandler: requirePermission("order:live:create"),
      config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const principal = await account(request, reply);
      const service = principal && launches(reply);
      if (!principal || !service) return reply;
      const { signedTransactions } = z
        .object({ signedTransactions: z.array(z.string().min(40).max(8000)).min(1).max(3) })
        .parse(request.body);
      return {
        data: await service.submit(
          principal.subject,
          Uuid.parse(request.params).id,
          signedTransactions,
        ),
      };
    },
  );
  app.get(
    "/v1/launches",
    { preHandler: requirePermission("portfolio:read") },
    async (request, reply) => {
      const principal = await account(request, reply);
      const service = principal && launches(reply);
      if (!principal || !service) return reply;
      return { data: await service.list(principal.subject) };
    },
  );
  app.get(
    "/v1/launches/:id",
    { preHandler: requirePermission("portfolio:read") },
    async (request, reply) => {
      const principal = await account(request, reply);
      const service = principal && launches(reply);
      if (!principal || !service) return reply;
      return { data: await service.get(principal.subject, Uuid.parse(request.params).id) };
    },
  );
  app.get(
    "/v1/launches/:id/monitor",
    {
      preHandler: requirePermission("portfolio:read"),
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const principal = await account(request, reply);
      const service = principal && launches(reply);
      if (!principal || !service) return reply;
      return { data: await service.monitor(principal.subject, Uuid.parse(request.params).id) };
    },
  );
  app.get("/v1/launches/:id/metadata", async (request, reply) => {
    const service = launches(reply);
    if (!service) return reply;
    const metadata = await service.metadata(Uuid.parse(request.params).id);
    return metadata
      ? reply.header("cache-control", "public, max-age=300").send(metadata)
      : reply.code(404).send({ error: "not_found" });
  });
}
