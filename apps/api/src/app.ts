import { createHash } from "node:crypto";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { OpenRouterResearchClient, compileIntent } from "@sisera/copilot";
import {
  acknowledgeAccountAlert,
  applyMarketPaperOrder,
  applyPredictionPaperOrder,
  checkDatabaseReadiness,
  createAgentManifest,
  createBridgeTransfer,
  createMarketLiveOrder,
  getAccountPreferences,
  getBridgeTransfer,
  getPredictionPaperAccount,
  listAccountAlerts,
  listAccountEvents,
  listAgentManifests,
  listBridgeTransfers,
  listLeaderboardParticipants,
  listMarketLiveOrders,
  listMarketPaperAccounts,
  listMarketPaperOrders,
  listPaperAccounts,
  listPredictionOrders,
  listPredictionPaperOrders,
  listSolanaSwapOrders,
  markBridgeSourceSubmitted,
  recordSolanaWebhookEvents,
  saveAccountPreferences,
  updateBridgeTransferStatus,
  updateMarketLiveOrder,
} from "@sisera/db";
import {
  OrderIntent,
  type PortfolioRiskState,
  PredictionMarket,
  type RiskLimits,
} from "@sisera/domain";
import type { Candle, Instrument, MarketSnapshot, OrderBook } from "@sisera/domain";
import {
  BinanceSpotProvider,
  CoinGeckoReferenceProvider,
  DeFiLlamaChainProvider,
  FredMacroProvider,
  HyperliquidPerpProvider,
  JupiterPredictionProvider,
  MarketDataUnavailableError,
  PreStocksProvider,
  PythProProvider,
} from "@sisera/market-data";
import { applyOrderEvent, createOrderRecord } from "@sisera/oms";
import { analyzeCandles } from "@sisera/quant";
import { evaluatePreTradeRisk } from "@sisera/risk";
import Fastify, { type FastifyReply } from "fastify";
import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";
import { z } from "zod";
import { AgentDraftInput, compileAgentDraft } from "./agent-governance.js";
import { agentTemplates } from "./agent-templates.js";
import { createAuthenticator, requirePermission } from "./auth.js";
import { BinanceTradingClient } from "./binance-trading.js";
import { BridgeQuoteInput, BridgeUnavailable, RelayBridgeClient } from "./bridge.js";
import { ClawpumpClient, ClawpumpError } from "./clawpump.js";
import type { ApiConfig } from "./config.js";
import { parseHeliusWebhook, validWebhookSecret } from "./helius-webhook.js";
import { HeliusClient } from "./helius.js";
import { HyperEvmWalletClient } from "./hyperevm.js";
import { JupiterPredictionTradingClient } from "./jupiter-prediction.js";
import { JupiterQuoteClient } from "./jupiter.js";
import { PaperOrderRejection, settleMarketPaperOrder } from "./market-paper.js";
import { PredictionPaperRejection, settlePredictionPaperOrder } from "./prediction-paper.js";
import { PredictionTradingService } from "./prediction-trading.js";
import { SocialFeedClient } from "./social-feed.js";
import { SolanaTradingService, TradeRejection } from "./solana-trading.js";
import { StockNewsClient } from "./stock-news.js";
import { type WalletChain, createWalletOwnershipChecker } from "./wallet-ownership.js";
import { XStocksClient } from "./xstocks.js";

export type RiskContext = {
  portfolio: z.infer<typeof PortfolioRiskState>;
  limits: z.infer<typeof RiskLimits>;
};

export type ApiDependencies = {
  marketData?: {
    getInstrument(symbol: string): Promise<Instrument>;
    getSnapshot(symbol: string): Promise<MarketSnapshot>;
    listMarkets?(
      symbols: readonly string[],
    ): Promise<Array<{ instrument: Instrument; snapshot: MarketSnapshot }>>;
    getCandles?(symbol: string, interval?: string, limit?: number): Promise<Candle[]>;
    getOrderBook?(symbol: string, limit?: number): Promise<OrderBook>;
  };
  predictions?: { listOpenMarkets(limit?: number): Promise<unknown[]> };
  loadRiskContext?: (portfolioId: string) => Promise<RiskContext | null>;
  readinessProbe?: (connectionString: string) => Promise<boolean>;
  ownsWallet?: (subject: string, address: string, chain: WalletChain) => Promise<boolean>;
  predictionPaperQuote?: (
    marketId: string,
    outcome: "yes" | "no",
  ) => Promise<{ priceUsd: string; closesAt: string }>;
};

export async function buildApi(config: ApiConfig, dependencies: ApiDependencies = {}) {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    trustProxy: true,
    genReqId: (request) => {
      const supplied = request.headers["x-request-id"];
      return typeof supplied === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(supplied)
        ? supplied
        : crypto.randomUUID();
    },
  });
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: "sisera_" });
  const requestCount = new Counter({
    name: "sisera_http_requests_total",
    help: "HTTP requests processed",
    labelNames: ["method", "route", "status"],
    registers: [registry],
  });
  const requestDuration = new Histogram({
    name: "sisera_http_request_duration_seconds",
    help: "HTTP request duration",
    labelNames: ["method", "route"],
    registers: [registry],
  });
  const marketData =
    dependencies.marketData ?? new BinanceSpotProvider(config.BINANCE_SPOT_BASE_URL);
  const hyperliquid = new HyperliquidPerpProvider(config.HYPERLIQUID_BASE_URL);
  const chains = new DeFiLlamaChainProvider();
  const macro = new FredMacroProvider();
  const prestocks = new PreStocksProvider(config.PRESTOCKS_BASE_URL);
  const xstocks = new XStocksClient();
  const pyth = new PythProProvider(config.PYTH_PRO_API_KEY ?? "");
  const solanaRpcUrl =
    config.SOLANA_RPC_URL ??
    (config.HELIUS_API_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${config.HELIUS_API_KEY}`
      : "https://api.mainnet-beta.solana.com");
  const helius = new HeliusClient(solanaRpcUrl);
  const hyperEvmWallet = new HyperEvmWalletClient();
  const clawpump = config.CLAWPUMP_API_KEY ? new ClawpumpClient(config.CLAWPUMP_API_KEY) : null;
  const jupiter = config.JUPITER_API_KEY ? new JupiterQuoteClient(config.JUPITER_API_KEY) : null;
  const solanaTrading = new SolanaTradingService(config, xstocks, prestocks, helius, jupiter);
  const binanceTrading = new BinanceTradingClient();
  const bridge = new RelayBridgeClient(config.RELAY_API_KEY);
  const social = new SocialFeedClient({
    xBearer: config.SISERA_X_BEARER_TOKEN,
    xAccounts: config.SISERA_X_TRACKED_ACCOUNTS,
    xDailyBudget: config.SISERA_X_MAX_DAILY_SPEND_USD,
    telegramChannels: config.SISERA_TELEGRAM_NEWS_CHANNELS,
    discordBotToken: config.SISERA_DISCORD_BOT_TOKEN,
    discordChannelIds: config.SISERA_DISCORD_CHANNEL_IDS,
  });
  const predictionTrading = new PredictionTradingService(config, helius, solanaRpcUrl);
  const predictionPaperClient = new JupiterPredictionTradingClient(
    config.JUPITER_PREDICTION_BASE_URL,
    config.JUPITER_API_KEY,
  );
  const predictionPaperQuote =
    dependencies.predictionPaperQuote ??
    ((marketId: string, outcome: "yes" | "no") =>
      predictionPaperClient.quote(marketId, outcome === "yes"));
  const stockNews = new StockNewsClient(
    config.GNEWS_API_KEY,
    config.FINNHUB_API_KEY,
    config.MARKETAUX_API_KEY,
  );
  const ownsWallet = dependencies.ownsWallet ?? createWalletOwnershipChecker(config);
  async function requireOwnedWallet(
    reply: FastifyReply,
    subject: string,
    address: string,
    chain: WalletChain,
  ): Promise<boolean> {
    try {
      if (await ownsWallet(subject, address, chain)) return true;
      await reply.code(403).send({
        error: "wallet_not_linked",
        message: "Link this wallet to your Sisera account before using it.",
      });
    } catch {
      await reply.code(503).send({
        error: "wallet_verification_unavailable",
        message: "Wallet ownership could not be verified. Try again shortly.",
      });
    }
    return false;
  }
  const research =
    config.OPENROUTER_API_KEY && config.SISERA_INTELLIGENCE_MODEL
      ? new OpenRouterResearchClient(config.OPENROUTER_API_KEY, config.SISERA_INTELLIGENCE_MODEL)
      : null;
  const marketProvider = (venue: string) => (venue === "hyperliquid" ? hyperliquid : marketData);
  const predictions =
    dependencies.predictions ??
    new JupiterPredictionProvider(config.JUPITER_PREDICTION_BASE_URL, config.JUPITER_API_KEY);
  const referenceMarkets = new CoinGeckoReferenceProvider();
  const requestStarts = new WeakMap<object, number>();

  await app.register(helmet);
  await app.register(cors, { origin: false });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  app.decorateRequest("principal", null);
  app.addHook("onRequest", createAuthenticator(config));
  app.addHook("onRequest", async (request) => {
    requestStarts.set(request, performance.now());
  });
  app.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions.url ?? "unknown";
    requestCount.inc({ method: request.method, route, status: reply.statusCode });
    const startedAt = requestStarts.get(request);
    if (startedAt)
      requestDuration.observe(
        { method: request.method, route },
        (performance.now() - startedAt) / 1000,
      );
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    return payload;
  });

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (request, reply) => {
    const configured = Boolean(
      config.DATABASE_URL && config.PRIVY_APP_ID && config.PRIVY_APP_SECRET,
    );
    const migrated = config.DATABASE_URL
      ? await (dependencies.readinessProbe ?? checkDatabaseReadiness)(config.DATABASE_URL).catch(
          () => false,
        )
      : false;
    if (!configured || !migrated)
      return reply.code(503).send({
        status: "unavailable",
        dependencies: {
          configuration: configured ? "ok" : "missing",
          database: migrated ? "ok" : "unavailable",
        },
        requestId: request.id,
      });
    return { status: "ready", dependencies: { configuration: "ok", database: "ok" } };
  });
  app.get("/v1/capabilities", async () => ({
    live: {
      solana: config.SISERA_LIVE_SOLANA_ENABLED,
      predictions: config.SISERA_LIVE_PREDICTIONS_ENABLED,
      binance: config.SISERA_LIVE_BINANCE_ENABLED,
      hyperliquid: false,
    },
  }));
  app.get(
    "/v1/preferences",
    { preHandler: requirePermission("portfolio:read") },
    async (request, reply) => {
      if (!config.DATABASE_URL || !request.principal)
        return reply
          .code(503)
          .send({ error: "persistence_unavailable", message: "Account settings are unavailable." });
      return { data: await getAccountPreferences(config.DATABASE_URL, request.principal.subject) };
    },
  );
  app.put(
    "/v1/preferences",
    { preHandler: requirePermission("portfolio:read") },
    async (request, reply) => {
      if (!config.DATABASE_URL || !request.principal)
        return reply
          .code(503)
          .send({ error: "persistence_unavailable", message: "Account settings are unavailable." });
      const preferences = z
        .object({
          refreshIntervalMs: z.union([
            z.literal(0),
            z.literal(15000),
            z.literal(30000),
            z.literal(60000),
          ]),
          failedOrderAlerts: z.boolean(),
          leaderboardOptIn: z.boolean().optional(),
        })
        .parse(request.body);
      return {
        data: await saveAccountPreferences(config.DATABASE_URL, request.principal.subject, {
          ...preferences,
          leaderboardOptIn: preferences.leaderboardOptIn,
        }),
      };
    },
  );
  app.get(
    "/v1/alerts",
    { preHandler: requirePermission("portfolio:read") },
    async (request, reply) => {
      if (!config.DATABASE_URL || !request.principal)
        return reply
          .code(503)
          .send({ error: "persistence_unavailable", message: "Alert history is unavailable." });
      return {
        data: await listAccountAlerts(config.DATABASE_URL, request.principal.subject),
      };
    },
  );
  app.get(
    "/v1/activity/events",
    { preHandler: requirePermission("portfolio:read") },
    async (request, reply) => {
      if (!config.DATABASE_URL || !request.principal)
        return reply
          .code(503)
          .send({ error: "persistence_unavailable", message: "Account timeline is unavailable." });
      return { data: await listAccountEvents(config.DATABASE_URL, request.principal.subject) };
    },
  );
  app.post(
    "/v1/alerts/:id/acknowledge",
    { preHandler: requirePermission("portfolio:read") },
    async (request, reply) => {
      if (!config.DATABASE_URL || !request.principal)
        return reply
          .code(503)
          .send({ error: "persistence_unavailable", message: "Alert history is unavailable." });
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const acknowledged = await acknowledgeAccountAlert(
        config.DATABASE_URL,
        request.principal.subject,
        id,
      );
      return acknowledged
        ? { acknowledged: true }
        : reply.code(404).send({ error: "alert_not_found" });
    },
  );
  app.get("/v1/social-feed", { preHandler: requirePermission("market:read") }, async () => {
    const feed = await social.list();
    return { data: feed.posts, sources: feed.sources, fetchedAt: new Date().toISOString() };
  });
  app.get(
    "/v1/wallets/hyperevm/:address",
    { preHandler: requirePermission("portfolio:read") },
    async (request, reply) => {
      const { address } = z
        .object({ address: z.string().regex(/^0x[a-fA-F0-9]{40}$/) })
        .parse(request.params);
      try {
        return { data: await hyperEvmWallet.balances(address) };
      } catch {
        return reply
          .code(503)
          .send({ message: "HyperEVM wallet balances are temporarily unavailable." });
      }
    },
  );
  app.post(
    "/v1/bridge/quote",
    {
      preHandler: requirePermission("portfolio:read"),
      config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      if (!request.principal?.subject.startsWith("privy:"))
        return reply.code(403).send({ error: "account_required" });
      if (!config.DATABASE_URL)
        return reply.code(503).send({ message: "Account bridge history is unavailable." });
      try {
        const input = BridgeQuoteInput.parse(request.body);
        if (!(await requireOwnedWallet(reply, request.principal.subject, input.user, "ethereum")))
          return reply;
        if (
          !(await requireOwnedWallet(
            reply,
            request.principal.subject,
            input.recipient,
            input.destinationChainId === 999 ? "ethereum" : "solana",
          ))
        )
          return reply;
        const quote = await bridge.quote(input);
        await createBridgeTransfer(config.DATABASE_URL, {
          requestId: quote.requestId,
          tenantId: request.principal.tenantId,
          subject: request.principal.subject,
          originAddress: input.user,
          recipient: quote.recipient,
          originChainId: quote.originChainId,
          destinationChainId: quote.destinationChainId,
          originAmountUsdc: quote.originAmountUsdc,
          quotedOutputUsdc: quote.outputAmountUsdc,
        });
        return { data: quote };
      } catch (error) {
        if (error instanceof BridgeUnavailable)
          return reply.code(error.status).send({ message: error.message });
        if (error instanceof z.ZodError)
          return reply.code(400).send({ message: "Invalid bridge request", issues: error.issues });
        request.log.warn({ error }, "Bridge quote failed");
        return reply.code(503).send({ message: "Bridge quote is temporarily unavailable." });
      }
    },
  );
  app.get(
    "/v1/bridge/transfers",
    { preHandler: requirePermission("portfolio:read") },
    async (request, reply) => {
      if (!config.DATABASE_URL || !request.principal)
        return reply.code(503).send({ message: "Account bridge history is unavailable." });
      return { data: await listBridgeTransfers(config.DATABASE_URL, request.principal.subject) };
    },
  );
  app.post(
    "/v1/bridge/submission",
    { preHandler: requirePermission("portfolio:read") },
    async (request, reply) => {
      if (!config.DATABASE_URL || !request.principal)
        return reply.code(503).send({ message: "Account bridge history is unavailable." });
      const { requestId, sourceTxHash } = z
        .object({
          requestId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
          sourceTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
        })
        .parse(request.body);
      const recorded = await markBridgeSourceSubmitted(
        config.DATABASE_URL,
        request.principal.subject,
        requestId,
        sourceTxHash,
      );
      return recorded
        ? { recorded: true, verification: "pending" }
        : reply.code(404).send({ message: "Bridge request not found for this account." });
    },
  );
  app.get(
    "/v1/bridge/status",
    { preHandler: requirePermission("portfolio:read") },
    async (request, reply) => {
      if (!config.DATABASE_URL || !request.principal)
        return reply.code(503).send({ message: "Account bridge history is unavailable." });
      const query = z
        .object({ requestId: z.string().regex(/^0x[a-fA-F0-9]{64}$/) })
        .safeParse(request.query);
      if (!query.success) return reply.code(400).send({ message: "Invalid bridge request ID." });
      try {
        const { requestId } = query.data;
        const owned = await getBridgeTransfer(
          config.DATABASE_URL,
          request.principal.subject,
          requestId,
        );
        if (!owned) return reply.code(404).send({ message: "Bridge request not found." });
        const status = await bridge.status(requestId);
        const persisted = await updateBridgeTransferStatus(
          config.DATABASE_URL,
          request.principal.subject,
          requestId,
          status.status,
          status.inTxHashes?.[0] ?? null,
          status.txHashes?.[0] ?? null,
        );
        return {
          data: {
            ...status,
            status: persisted?.status ?? status.status,
            inTxHashes: persisted?.sourceTxHash
              ? [persisted.sourceTxHash]
              : (status.inTxHashes ?? []),
            txHashes: persisted?.destinationTxHash
              ? [persisted.destinationTxHash]
              : (status.txHashes ?? []),
          },
        };
      } catch (error) {
        if (error instanceof BridgeUnavailable)
          return reply.code(error.status).send({ message: error.message });
        return reply.code(503).send({ message: "Bridge status is temporarily unavailable." });
      }
    },
  );
  app.post("/v1/helius/webhook", async (request, reply) => {
    if (!validWebhookSecret(request.headers.authorization, config.HELIUS_WEBHOOK_SECRET))
      return reply.code(401).send({ error: "unauthorized" });
    if (!config.DATABASE_URL)
      return reply
        .code(503)
        .send({ error: "identity_store_unavailable", message: "Event database is not configured" });
    const events = parseHeliusWebhook(request.body);
    const inserted = await recordSolanaWebhookEvents(config.DATABASE_URL, events);
    return { accepted: events.length, inserted, status: "observation_only" };
  });
  app.get(
    "/v1/private-markets",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async () => ({
      data: await prestocks.list(),
    }),
  );
  app.get(
    "/v1/public-stocks",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async () => ({
      data: await xstocks.list(),
    }),
  );
  app.get("/v1/agents", { preHandler: requirePermission("agent:read") }, async (request) => {
    if (!config.DATABASE_URL || !request.principal)
      return { templates: agentTemplates, custom: [], persistence: "unavailable" };
    try {
      return {
        templates: agentTemplates,
        custom: await listAgentManifests(
          config.DATABASE_URL,
          request.principal.tenantId,
          request.principal.subject,
        ),
        persistence: "postgres",
      };
    } catch {
      request.log.error({ requestId: request.id }, "agent store unavailable");
      return { templates: agentTemplates, custom: [], persistence: "unavailable" };
    }
  });
  app.get(
    "/v1/agents/templates/:id/research",
    {
      preHandler: requirePermission("agent:read"),
      config: { rateLimit: { max: 15, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      if (!agentTemplates.some((template) => template.id === id))
        return reply.code(404).send({ message: "Unknown agent template." });
      try {
        if (id === "trend-confirmation-v1") {
          const candles = await marketData.getCandles?.("BTCUSDT", "1h", 120);
          if (!candles) throw new Error("Spot candles unavailable");
          const assessment = analyzeCandles(candles);
          const volume = assessment.signals.find((signal) => signal.id === "volume")?.value ?? 0;
          return {
            data: {
              templateId: id,
              market: "BTCUSDT",
              source: "binance-spot-candles",
              observedAt: assessment.observedAt,
              stance: volume >= 1.2 && assessment.direction === "long" ? "watch_long" : "abstain",
              rationale: [
                `EMA/RSI composite ${assessment.score.toFixed(1)} (${assessment.direction}).`,
                `Relative volume ${volume.toFixed(2)}×; requires at least 1.20×.`,
                "Research signal only; check fresh depth and risk before any operator order.",
              ],
            },
          };
        }
        if (id === "funding-dislocation-v1") {
          const [metrics, candles] = await Promise.all([
            hyperliquid.listPerpetualMetrics(["BTC"]),
            hyperliquid.getCandles("BTCUSDT", "4h", 120),
          ]);
          const metric = metrics[0];
          if (!metric) throw new Error("Perp metric unavailable");
          const assessment = analyzeCandles(candles);
          return {
            data: {
              templateId: id,
              market: "BTC perpetual",
              source: "hyperliquid-perps",
              observedAt: metric.observedAt,
              stance: "abstain",
              rationale: [
                `Current funding ${metric.fundingRate ?? "unavailable"}; mark ${metric.markPrice}, oracle ${metric.oraclePrice ?? "unavailable"}.`,
                `4h directional assessment: ${assessment.direction} (${assessment.score.toFixed(1)}).`,
                "Funding history and reversal confirmation are required before forming a dislocation proposal.",
              ],
            },
          };
        }
        if (id === "spot-breakout-v1") {
          const candles = await marketData.getCandles?.("SOLUSDT", "1h", 60);
          if (!candles) throw new Error("Spot candles unavailable");
          const latest = candles.at(-1);
          const previous = candles.slice(-21, -1);
          if (!latest || previous.length < 20) throw new Error("Insufficient spot candles");
          const high = Math.max(...previous.map((candle) => Number(candle.high)));
          const averageVolume =
            previous.reduce((sum, candle) => sum + Number(candle.volume), 0) / previous.length;
          const relativeVolume = averageVolume > 0 ? Number(latest.volume) / averageVolume : 0;
          return {
            data: {
              templateId: id,
              market: "SOLUSDT",
              source: "binance-spot-candles",
              observedAt: new Date(latest.time * 1000).toISOString(),
              stance:
                Number(latest.close) > high && relativeVolume >= 1.2 ? "watch_long" : "abstain",
              rationale: [
                `Latest close ${latest.close}; prior 20-candle high ${high.toFixed(4)}.`,
                `Relative volume ${relativeVolume.toFixed(2)}×; requires at least 1.20×.`,
                "Fresh spread and order-book depth must pass before any operator order.",
              ],
            },
          };
        }
        if (id === "private-market-value-v1") {
          const assets = await prestocks.list();
          const candidate = [...assets].sort(
            (a, b) => Number(a.premiumDiscountPct) - Number(b.premiumDiscountPct),
          )[0];
          if (!candidate) throw new Error("Private market unavailable");
          return {
            data: {
              templateId: id,
              market: candidate.instrument.baseAsset,
              source: "prestocks",
              observedAt: candidate.fetchedAt,
              stance: "abstain",
              rationale: [
                `Token versus issuer mark: ${candidate.premiumDiscountPct}%.`,
                "Issuer mark is not a verified fair value or executable quote.",
                "Review liquidity and company news before proposing an order.",
              ],
            },
          };
        }
        const markets = await predictions.listOpenMarkets(20);
        const market = markets
          .flatMap((item) => {
            const parsed = PredictionMarket.safeParse(item);
            return parsed.success ? [parsed.data] : [];
          })
          .find((item) => item.resolutionRules && item.outcomes.length >= 2);
        if (!market) throw new Error("Prediction evidence unavailable");
        return {
          data: {
            templateId: id,
            market: market.title,
            source: "jupiter-prediction",
            observedAt: market.quality.observedAt,
            stance: "abstain",
            rationale: [
              `Outcome prices: ${market.outcomes.map((outcome) => `${outcome.label} ${outcome.probability}`).join(", ")}.`,
              `Closes ${market.closesAt ?? "unspecified"}.`,
              `Resolution rules: ${market.resolutionRules?.slice(0, 240)}`,
              "Independent probability evidence is required before proposing a trade.",
            ],
          },
        };
      } catch (error) {
        request.log.warn({ error, templateId: id }, "Agent research unavailable");
        return reply
          .code(503)
          .send({ message: "Fresh source data for this strategy is unavailable." });
      }
    },
  );
  app.post(
    "/v1/agents",
    { preHandler: requirePermission("agent:manage") },
    async (request, reply) => {
      if (!request.principal?.subject.startsWith("privy:"))
        return reply.code(403).send({ error: "account_required" });
      if (!config.DATABASE_URL)
        return reply
          .code(503)
          .send({ error: "persistence_unavailable", message: "Agent database is not configured" });
      const input = AgentDraftInput.parse(request.body);
      const { policy, manifestHash } = compileAgentDraft(input);
      const manifest = await createAgentManifest(config.DATABASE_URL, {
        id: `custom:${crypto.randomUUID()}`,
        version: "1.0.0",
        tenantId: request.principal.tenantId,
        name: input.name,
        stage: "draft",
        autonomy: "research",
        ownerSubject: request.principal.subject,
        manifestHash,
        policy,
      });
      return reply.code(201).send({ data: manifest });
    },
  );
  app.get(
    "/v1/stocks/:symbol/news",
    { preHandler: requirePermission("market:read") },
    async (request, reply) => {
      const { symbol } = z
        .object({ symbol: z.string().regex(/^[A-Za-z0-9-]{1,20}$/) })
        .parse(request.params);
      const [privateResult, publicResult] = await Promise.allSettled([
        prestocks.list(),
        xstocks.list(),
      ]);
      const asset = (privateResult.status === "fulfilled" ? privateResult.value : []).find(
        (item) => item.instrument.baseAsset.toLowerCase() === symbol.toLowerCase(),
      );
      const publicStock = (publicResult.status === "fulfilled" ? publicResult.value : []).find(
        (item) => item.symbol.toLowerCase() === symbol.toLowerCase(),
      );
      if (!asset && !publicStock)
        return reply.code(404).send({ error: "not_found", message: "Unknown stock" });
      const result = await stockNews.search(
        asset?.company ?? publicStock?.name ?? symbol,
        publicStock?.underlyingSymbol,
      );
      return { ...result, delayedPossible: true };
    },
  );
  app.post(
    "/v1/stocks/:symbol/assessment",
    {
      preHandler: requirePermission("market:read"),
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      if (!research)
        return reply.code(503).send({
          error: "provider_unavailable",
          message: "Sisera research model is not configured",
        });
      const { symbol } = z
        .object({ symbol: z.string().regex(/^[A-Za-z0-9-]{1,20}$/) })
        .parse(request.params);
      const asset = (await prestocks.list()).find(
        (item) => item.instrument.baseAsset.toLowerCase() === symbol.toLowerCase(),
      );
      if (!asset)
        return reply.code(404).send({ error: "not_found", message: "Unknown PreStocks asset" });
      const news = await stockNews.search(asset.company).catch(() => ({ data: [], providers: [] }));
      const inputArticles = news.data.slice(0, 5).map((item) => ({
        title: item.title,
        publishedAt: item.publishedAt,
        publisher: item.publisher,
        url: item.url,
      }));
      const assessment = await research.assess({
        company: asset.company,
        symbol: asset.instrument.baseAsset,
        tokenPrice: asset.tokenPrice,
        markPrice: asset.markPrice,
        premiumDiscountPct: asset.premiumDiscountPct,
        fetchedAt: asset.fetchedAt,
        articles: inputArticles,
      });
      return {
        data: {
          ...assessment,
          evidence: {
            marketSource: asset.source,
            marketObservedAt: asset.fetchedAt,
            articles: inputArticles,
          },
        },
        provenance: {
          market: asset.source,
          news: news.providers,
          model: config.SISERA_INTELLIGENCE_MODEL,
        },
        executable: false,
      };
    },
  );
  app.get(
    "/v1/clawpump/search",
    { preHandler: requirePermission("market:read") },
    async (request, reply) => {
      const { query } = z.object({ query: z.string().trim().min(2).max(80) }).parse(request.query);
      if (!clawpump)
        return reply.code(503).send({
          error: "provider_unavailable",
          message: "Clawpump partner API is not configured",
        });
      return { data: await clawpump.search(query), source: "clawpump" };
    },
  );
  app.get(
    "/v1/clawpump/price/:mint",
    { preHandler: requirePermission("market:read") },
    async (request, reply) => {
      const { mint } = z
        .object({ mint: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/) })
        .parse(request.params);
      if (!clawpump)
        return reply.code(503).send({
          error: "provider_unavailable",
          message: "Clawpump partner API is not configured",
        });
      return { data: await clawpump.price(mint) };
    },
  );
  app.get(
    "/v1/clawpump/pairs",
    { preHandler: requirePermission("market:read") },
    async (_request, reply) => {
      if (!clawpump)
        return reply.code(503).send({
          error: "provider_unavailable",
          message: "Clawpump partner API is not configured",
        });
      return { data: await clawpump.pairs() };
    },
  );
  app.get(
    "/v1/solana/quote",
    { preHandler: requirePermission("market:read") },
    async (request, reply) => {
      const mint = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
      const { inputMint, outputMint, amount } = z
        .object({
          inputMint: mint,
          outputMint: mint,
          amount: z.string().regex(/^[1-9][0-9]{0,18}$/),
        })
        .parse(request.query);
      if (!jupiter)
        return reply
          .code(503)
          .send({ error: "provider_unavailable", message: "Jupiter API is not configured" });
      return { data: await jupiter.preview(inputMint, outputMint, amount) };
    },
  );
  app.post(
    "/v1/solana/orders/prepare",
    {
      preHandler: requirePermission("order:live:create"),
      config: { rateLimit: { max: 8, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      if (!config.SISERA_LIVE_SOLANA_ENABLED)
        return reply
          .code(503)
          .send({ error: "live_trading_disabled", message: "Solana live trading is paused." });
      const principal = request.principal;
      if (!principal?.subject.startsWith("privy:"))
        return reply.code(403).send({ error: "account_required" });
      const input = z
        .object({
          wallet: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
          mint: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
          side: z.enum(["buy", "sell"]),
          amount: z.string().regex(/^[1-9][0-9]{0,18}$/),
        })
        .parse(request.body);
      if (!(await requireOwnedWallet(reply, principal.subject, input.wallet, "solana")))
        return reply;
      return {
        data: await solanaTrading.prepare({
          ...input,
          subject: principal.subject,
          tenantId: principal.tenantId,
        }),
      };
    },
  );
  app.post(
    "/v1/solana/orders/paper",
    {
      preHandler: requirePermission("order:paper:create"),
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request) => {
      const principal = request.principal;
      if (!principal) throw new TradeRejection("Sign in to trade.", 401);
      const input = z
        .object({
          mint: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
          side: z.enum(["buy", "sell"]),
          amount: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/),
        })
        .parse(request.body);
      return {
        data: await solanaTrading.paper({
          ...input,
          subject: principal.subject,
          tenantId: principal.tenantId,
        }),
      };
    },
  );
  app.post(
    "/v1/solana/orders/:id/execute",
    {
      preHandler: requirePermission("order:live:create"),
      config: { rateLimit: { max: 8, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      if (!config.SISERA_LIVE_SOLANA_ENABLED)
        return reply
          .code(503)
          .send({ error: "live_trading_disabled", message: "Solana live trading is paused." });
      const principal = request.principal;
      if (!principal?.subject.startsWith("privy:"))
        return reply.code(403).send({ error: "account_required" });
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const { signedTransaction } = z
        .object({ signedTransaction: z.string().min(40).max(5000) })
        .parse(request.body);
      return { data: await solanaTrading.execute(id, principal.subject, signedTransaction) };
    },
  );
  app.get(
    "/v1/solana/orders",
    { preHandler: requirePermission("portfolio:read") },
    async (request) => ({
      data:
        config.DATABASE_URL && request.principal
          ? await listSolanaSwapOrders(config.DATABASE_URL, request.principal.subject)
          : [],
    }),
  );
  app.get(
    "/v1/leaderboard",
    { preHandler: requirePermission("market:read") },
    async (request, reply) => {
      if (!config.DATABASE_URL)
        return reply
          .code(503)
          .send({ error: "persistence_unavailable", message: "Trade ledger is not configured" });
      const [accounts, marketAccounts, publicStocks, privateStocks, participants] =
        await Promise.all([
          listPaperAccounts(config.DATABASE_URL),
          listMarketPaperAccounts(config.DATABASE_URL),
          xstocks.list().catch(() => []),
          prestocks.list().catch(() => []),
          listLeaderboardParticipants(config.DATABASE_URL),
        ]);
      const prices = new Map<string, number>();
      for (const asset of publicStocks)
        if (asset.priceUsd) prices.set(asset.mint, Number(asset.priceUsd));
      for (const asset of privateStocks)
        if (asset.instrument.mint) prices.set(asset.instrument.mint, Number(asset.tokenPrice));
      const totals = new Map<string, { nav: number; baseline: number; observedAt: string }>();
      const incompleteSubjects = new Set<string>();
      let skippedUnpriced = 0;
      const addAccount = (subject: string, nav: number, observedAt: string) => {
        const previous = totals.get(subject);
        totals.set(subject, {
          nav: (previous?.nav ?? 0) + nav,
          baseline: (previous?.baseline ?? 0) + 10_000,
          observedAt:
            previous && previous.observedAt > observedAt ? previous.observedAt : observedAt,
        });
      };
      for (const account of accounts) {
        if (!participants.has(account.subject)) continue;
        const holdings = Object.entries(account.holdings).filter(
          ([, quantity]) => Number(quantity) !== 0,
        );
        if (holdings.some(([mint]) => !Number.isFinite(prices.get(mint)))) {
          skippedUnpriced++;
          incompleteSubjects.add(account.subject);
          continue;
        }
        const nav =
          Number(account.cashUsd) +
          holdings.reduce(
            (sum, [mint, quantity]) => sum + Number(quantity) * (prices.get(mint) ?? 0),
            0,
          );
        if (!Number.isFinite(nav)) {
          skippedUnpriced++;
          incompleteSubjects.add(account.subject);
          continue;
        }
        addAccount(account.subject, nav, account.updatedAt.toISOString());
      }
      const spotSymbols = new Set<string>();
      const perpSymbols = new Set<string>();
      for (const account of marketAccounts) {
        if (!participants.has(String(account.subject))) continue;
        for (const [asset, quantity] of Object.entries(
          account.spotHoldings as Record<string, string>,
        ))
          if (Number(quantity) !== 0) spotSymbols.add(`${asset}USDT`);
        for (const [symbol, position] of Object.entries(
          account.perpPositions as Record<string, { size: string }>,
        ))
          if (Number(position.size) !== 0) perpSymbols.add(symbol);
      }
      const marketMarks = new Map<string, number>();
      await Promise.all([
        ...[...spotSymbols].map(async (symbol) => {
          const snapshot = await marketData.getSnapshot(symbol).catch(() => null);
          if (snapshot?.quality.status === "live")
            marketMarks.set(`spot:${symbol}`, Number(snapshot.bid));
        }),
        ...[...perpSymbols].map(async (symbol) => {
          const snapshot = await hyperliquid.getSnapshot(symbol).catch(() => null);
          if (snapshot?.quality.status === "live")
            marketMarks.set(`perp:${symbol}`, Number(snapshot.last));
        }),
      ]);
      for (const account of marketAccounts) {
        if (!participants.has(String(account.subject))) continue;
        const spotHoldings = Object.entries(account.spotHoldings as Record<string, string>).filter(
          ([, quantity]) => Number(quantity) !== 0,
        );
        const perpPositions = Object.entries(
          account.perpPositions as Record<string, { size: string; entryPrice: string }>,
        ).filter(([, position]) => Number(position.size) !== 0);
        if (
          spotHoldings.some(([asset]) => !Number.isFinite(marketMarks.get(`spot:${asset}USDT`))) ||
          perpPositions.some(([symbol]) => !Number.isFinite(marketMarks.get(`perp:${symbol}`)))
        ) {
          skippedUnpriced++;
          incompleteSubjects.add(String(account.subject));
          continue;
        }
        const nav =
          Number(account.cashUsd) +
          spotHoldings.reduce(
            (sum, [asset, quantity]) =>
              sum + Number(quantity) * (marketMarks.get(`spot:${asset}USDT`) ?? 0),
            0,
          ) +
          perpPositions.reduce(
            (sum, [symbol, position]) =>
              sum +
              Number(position.size) *
                ((marketMarks.get(`perp:${symbol}`) ?? 0) - Number(position.entryPrice)),
            0,
          );
        if (!Number.isFinite(nav)) {
          skippedUnpriced++;
          incompleteSubjects.add(String(account.subject));
          continue;
        }
        addAccount(
          String(account.subject),
          nav,
          new Date(account.updatedAt as string | Date).toISOString(),
        );
      }
      const rows = [...totals.entries()]
        .filter(([subject]) => !incompleteSubjects.has(subject))
        .map(([subject, total]) => ({
          name: `Trader ${createHash("sha256").update(subject).digest("hex").slice(0, 8)}`,
          pnlUsd: total.nav - total.baseline,
          returnPct: ((total.nav - total.baseline) / total.baseline) * 100,
          observedAt: total.observedAt,
        }))
        .sort((left, right) => right.pnlUsd - left.pnlUsd);
      return {
        data: rows,
        scope: "Paper accounts: Solana stocks, Binance spot, Hyperliquid perps",
        baselineUsd: 10_000,
        skippedUnpriced,
      };
    },
  );
  app.get(
    "/v1/pyth/reference",
    { preHandler: requirePermission("market:read") },
    async (request, reply) => {
      const { symbol } = z
        .object({ symbol: z.string().regex(/^[A-Za-z0-9./_-]{1,80}$/) })
        .parse(request.query);
      if (!config.PYTH_PRO_API_KEY)
        return reply
          .code(503)
          .send({ error: "provider_unavailable", message: "Pyth Pro is not configured" });
      return { data: await pyth.getLatest(symbol) };
    },
  );
  app.get(
    "/v1/pyth/references",
    {
      preHandler: requirePermission("market:read"),
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { symbols } = z.object({ symbols: z.string().max(240) }).parse(request.query);
      if (!config.PYTH_PRO_API_KEY)
        return reply
          .code(503)
          .send({ error: "provider_unavailable", message: "Pyth Pro is not configured" });
      return { data: await pyth.getLatestEquities(symbols.split(",")) };
    },
  );
  app.get(
    "/v1/solana/wallet/:address",
    { preHandler: requirePermission("portfolio:read") },
    async (request) => {
      const { address } = z
        .object({ address: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/) })
        .parse(request.params);
      return { data: await helius.getWallet(address) };
    },
  );
  app.get("/metrics", async (_request, reply) =>
    reply.type(registry.contentType).send(await registry.metrics()),
  );

  app.get("/v1/markets", { preHandler: requirePermission("market:read") }, async (request) => {
    const { symbols, venue } = z
      .object({
        symbols: z.string().default("BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT"),
        venue: z.enum(["binance", "hyperliquid"]).default("binance"),
      })
      .parse(request.query);
    const provider = marketProvider(venue);
    const requested = [
      ...new Set(
        symbols
          .split(",")
          .map((symbol) => symbol.trim())
          .filter(Boolean),
      ),
    ].slice(0, 20);
    if (provider.listMarkets) {
      try {
        const data = await provider.listMarkets(requested);
        const available = new Set(data.map((row) => row.instrument.baseAsset));
        return {
          data,
          unavailable: requested
            .filter((symbol) => !available.has(symbol.replace(/USDT$|USDC$/, "")))
            .map((symbol) => ({ symbol, reason: "provider_unavailable" })),
        };
      } catch {
        return {
          data: [],
          unavailable: requested.map((symbol) => ({ symbol, reason: "provider_unavailable" })),
        };
      }
    }
    const results = await Promise.allSettled(
      requested.map(async (symbol) => {
        const [instrument, snapshot] = await Promise.all([
          provider.getInstrument(symbol),
          provider.getSnapshot(symbol),
        ]);
        return { instrument, snapshot };
      }),
    );
    return {
      data: results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
      unavailable: results.flatMap((result, index) =>
        result.status === "rejected"
          ? [{ symbol: requested[index], reason: "provider_unavailable" }]
          : [],
      ),
    };
  });

  app.get(
    "/v1/reference-markets",
    { preHandler: requirePermission("market:read") },
    async (request) => {
      const { symbols } = z.object({ symbols: z.string().max(200) }).parse(request.query);
      return { data: await referenceMarkets.list(symbols.split(",").slice(0, 20)) };
    },
  );

  app.get(
    "/v1/markets/:symbol",
    { preHandler: requirePermission("market:read") },
    async (request) => {
      const { symbol } = z.object({ symbol: z.string().min(5).max(20) }).parse(request.params);
      const { venue } = z
        .object({ venue: z.enum(["binance", "hyperliquid"]).default("binance") })
        .parse(request.query);
      const provider = marketProvider(venue);
      const [instrument, snapshot] = await Promise.all([
        provider.getInstrument(symbol),
        provider.getSnapshot(symbol),
      ]);
      return { instrument, snapshot };
    },
  );

  app.get(
    "/v1/markets/:symbol/candles",
    { preHandler: requirePermission("market:read") },
    async (request) => {
      const { venue, interval, limit } = z
        .object({
          venue: z.enum(["binance", "hyperliquid"]).default("binance"),
          interval: z.string().default("15m"),
          limit: z.coerce.number().int().min(30).max(1000).default(240),
        })
        .parse(request.query);
      const provider = marketProvider(venue);
      if (!provider.getCandles) throw new MarketDataUnavailableError("Candle adapter unavailable");
      const { symbol } = z.object({ symbol: z.string().min(5).max(20) }).parse(request.params);
      return { data: await provider.getCandles(symbol, interval, limit), interval };
    },
  );

  app.get(
    "/v1/markets/:symbol/depth",
    { preHandler: requirePermission("market:read") },
    async (request) => {
      const { venue, limit } = z
        .object({
          venue: z.enum(["binance", "hyperliquid"]).default("binance"),
          limit: z.coerce.number().int().min(5).max(100).default(20),
        })
        .parse(request.query);
      const provider = marketProvider(venue);
      if (!provider.getOrderBook) throw new MarketDataUnavailableError("Depth adapter unavailable");
      const { symbol } = z.object({ symbol: z.string().min(5).max(20) }).parse(request.params);
      return { data: await provider.getOrderBook(symbol, limit) };
    },
  );

  app.get(
    "/v1/markets/:symbol/intelligence",
    { preHandler: requirePermission("market:read") },
    async (request) => {
      const { venue } = z
        .object({ venue: z.enum(["binance", "hyperliquid"]).default("binance") })
        .parse(request.query);
      const provider = marketProvider(venue);
      if (!provider.getCandles) throw new MarketDataUnavailableError("Candle adapter unavailable");
      const { symbol } = z.object({ symbol: z.string().min(5).max(20) }).parse(request.params);
      const candles = await provider.getCandles(symbol, "1h", 240);
      return { data: analyzeCandles(candles) };
    },
  );

  app.get(
    "/v1/perpetual-metrics",
    { preHandler: requirePermission("market:read") },
    async (request) => {
      const { symbols } = z
        .object({ symbols: z.string().default("BTC,ETH,SOL,HYPE,AVAX") })
        .parse(request.query);
      return { data: await hyperliquid.listPerpetualMetrics(symbols.split(",").slice(0, 20)) };
    },
  );

  app.get("/v1/chains", { preHandler: requirePermission("market:read") }, async (request) => {
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(50).default(20) })
      .parse(request.query);
    return { data: await chains.listChains(limit) };
  });

  app.get(
    "/v1/macro-regime",
    { preHandler: requirePermission("market:read") },
    async (_request, reply) => {
      try {
        return { data: await macro.getRegime() };
      } catch (error) {
        if (error instanceof MarketDataUnavailableError) {
          return reply.code(503).send({ error: error.message, code: error.code });
        }
        throw error;
      }
    },
  );

  app.get(
    "/v1/public-wallet/:address",
    { preHandler: requirePermission("portfolio:read") },
    async (request) => {
      const { address } = z
        .object({ address: z.string().regex(/^0x[a-fA-F0-9]{40}$/) })
        .parse(request.params);
      return { data: await hyperliquid.getPublicAccount(address) };
    },
  );

  app.get(
    "/v1/prediction-markets",
    { preHandler: requirePermission("market:read") },
    async (request, reply) => {
      const { limit } = z
        .object({ limit: z.coerce.number().int().min(1).max(100).default(20) })
        .parse(request.query);
      try {
        return { data: await predictions.listOpenMarkets(limit) };
      } catch (error) {
        return reply.code(503).send({
          error: "jupiter_prediction_unavailable",
          message:
            error instanceof Error && /401/.test(error.message)
              ? "Jupiter API key is required or invalid"
              : "Jupiter prediction market data is unavailable",
        });
      }
    },
  );

  app.post(
    "/v1/prediction-orders/paper",
    {
      preHandler: requirePermission("order:paper:create"),
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      if (!config.DATABASE_URL || !request.principal)
        return reply.code(503).send({
          error: "persistence_unavailable",
          message: "Prediction paper account is unavailable.",
        });
      const input = z
        .object({
          id: z.string().uuid(),
          marketId: z.string().regex(/^[A-Za-z0-9:_-]{5,128}$/),
          outcome: z.enum(["yes", "no"]),
          depositUsd: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/),
        })
        .parse(request.body);
      try {
        const quote = await predictionPaperQuote(input.marketId, input.outcome);
        if (Date.parse(quote.closesAt) <= Date.now())
          throw new PredictionPaperRejection("This prediction market has closed.");
        const order = await applyPredictionPaperOrder(
          config.DATABASE_URL,
          {
            ...input,
            fillPriceUsd: quote.priceUsd,
            closesAt: quote.closesAt,
            tenantId: request.principal.tenantId,
            subject: request.principal.subject,
          },
          (state) =>
            settlePredictionPaperOrder(state, {
              marketId: input.marketId,
              outcome: input.outcome,
              depositUsd: input.depositUsd,
              priceUsd: quote.priceUsd,
            }),
        );
        return { data: order };
      } catch (error) {
        if (error instanceof TradeRejection)
          return reply.code(error.statusCode).send({ message: error.message });
        if (error instanceof PredictionPaperRejection)
          return reply.code(422).send({ message: error.message });
        request.log.warn({ requestId: request.id }, "Prediction paper order unavailable");
        return reply.code(503).send({ message: "Prediction paper order is unavailable." });
      }
    },
  );
  app.get(
    "/v1/prediction-orders/paper",
    { preHandler: requirePermission("portfolio:read") },
    async (request, reply) => {
      if (!config.DATABASE_URL || !request.principal)
        return reply.code(503).send({ message: "Prediction paper account is unavailable." });
      const [account, orders] = await Promise.all([
        getPredictionPaperAccount(config.DATABASE_URL, request.principal.subject),
        listPredictionPaperOrders(config.DATABASE_URL, request.principal.subject),
      ]);
      return { data: { account, orders } };
    },
  );

  app.post(
    "/v1/prediction-orders/prepare",
    {
      preHandler: requirePermission("order:live:create"),
      config: { rateLimit: { max: 8, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      if (!config.SISERA_LIVE_PREDICTIONS_ENABLED)
        return reply
          .code(503)
          .send({ error: "live_trading_disabled", message: "Prediction live trading is paused." });
      const principal = request.principal;
      if (!principal?.subject.startsWith("privy:"))
        return reply.code(403).send({ error: "account_required" });
      const input = z
        .object({
          wallet: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
          marketId: z.string().regex(/^[A-Za-z0-9:_-]{5,128}$/),
          outcome: z.enum(["yes", "no"]),
          depositAmount: z.string().regex(/^[1-9]\d{0,11}$/),
        })
        .parse(request.body);
      if (!(await requireOwnedWallet(reply, principal.subject, input.wallet, "solana")))
        return reply;
      return {
        data: await predictionTrading.prepare({
          ...input,
          subject: principal.subject,
          tenantId: principal.tenantId,
        }),
      };
    },
  );
  app.post(
    "/v1/prediction-orders/:id/execute",
    {
      preHandler: requirePermission("order:live:create"),
      config: { rateLimit: { max: 8, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      if (!config.SISERA_LIVE_PREDICTIONS_ENABLED)
        return reply
          .code(503)
          .send({ error: "live_trading_disabled", message: "Prediction live trading is paused." });
      const principal = request.principal;
      if (!principal?.subject.startsWith("privy:"))
        return reply.code(403).send({ error: "account_required" });
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const { signedTransaction } = z
        .object({ signedTransaction: z.string().min(40).max(20000) })
        .parse(request.body);
      return {
        data: await predictionTrading.execute({
          subject: principal.subject,
          orderId: id,
          signedTransaction,
        }),
      };
    },
  );
  app.get(
    "/v1/prediction-orders",
    { preHandler: requirePermission("portfolio:read") },
    async (request) => {
      const orders =
        config.DATABASE_URL && request.principal
          ? await listPredictionOrders(config.DATABASE_URL, request.principal.subject)
          : [];
      const data = await Promise.all(
        orders.map(async (order, index) => ({
          ...order,
          venueStatus:
            index < 10 && ["submitted", "unknown"].includes(order.status)
              ? await predictionTrading.orderStatus(String(order.orderPubkey)).catch(() => null)
              : null,
        })),
      );
      return { data };
    },
  );

  app.post(
    "/v1/copilot/compile",
    { preHandler: requirePermission("market:read") },
    async (request) => {
      const { text } = z.object({ text: z.string().min(1).max(2000) }).parse(request.body);
      return { intent: compileIntent(text), executable: false };
    },
  );

  app.post(
    "/v1/market-orders/paper",
    {
      preHandler: requirePermission("order:paper:create"),
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal) return reply.code(401).send({ error: "account_required" });
      if (!config.DATABASE_URL)
        return reply
          .code(503)
          .send({ error: "persistence_unavailable", message: "Paper ledger is not configured." });
      const input = z
        .object({
          venue: z.enum(["binance", "hyperliquid"]),
          symbol: z.string().regex(/^[A-Z0-9]{5,20}$/),
          side: z.enum(["buy", "sell"]),
          quantity: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/),
        })
        .parse(request.body);
      const provider = input.venue === "binance" ? marketData : hyperliquid;
      const [instrument, quote] = await Promise.all([
        provider.getInstrument(input.symbol),
        provider.getSnapshot(input.symbol),
      ]);
      if (
        quote.quality.status !== "live" ||
        Date.now() - Date.parse(quote.quality.observedAt) > 30_000
      )
        return reply
          .code(503)
          .send({ error: "stale_quote", message: "A fresh venue quote is required." });
      const fillPrice = input.side === "buy" ? quote.ask : quote.bid;
      const feeUsd = new (await import("decimal.js")).default(input.quantity)
        .mul(fillPrice)
        .mul(input.venue === "binance" ? "0.001" : "0.0005")
        .toString();
      const next = await applyMarketPaperOrder(
        config.DATABASE_URL,
        {
          id: crypto.randomUUID(),
          tenantId: principal.tenantId,
          subject: principal.subject,
          ...input,
          fillPrice,
          feeUsd,
        },
        (state) =>
          settleMarketPaperOrder(state, { ...input, baseAsset: instrument.baseAsset, fillPrice })
            .state,
      );
      return reply.code(201).send({
        data: {
          mode: "paper",
          status: "filled",
          venue: input.venue,
          symbol: input.symbol,
          side: input.side,
          quantity: input.quantity,
          fillPrice,
          feeUsd,
          account: next,
        },
      });
    },
  );
  app.get(
    "/v1/market-orders/paper",
    { preHandler: requirePermission("portfolio:read") },
    async (request) => ({
      data:
        config.DATABASE_URL && request.principal
          ? await listMarketPaperOrders(config.DATABASE_URL, request.principal.subject)
          : [],
    }),
  );

  app.post(
    "/v1/market-orders/binance/live",
    {
      preHandler: requirePermission("order:live:create"),
      config: { rateLimit: { max: 4, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      if (!config.SISERA_LIVE_BINANCE_ENABLED)
        return reply
          .code(503)
          .send({ error: "live_trading_disabled", message: "Binance live trading is paused." });
      const principal = request.principal;
      if (!principal?.subject.startsWith("privy:"))
        return reply.code(403).send({ error: "account_required" });
      if (!config.DATABASE_URL)
        return reply.code(503).send({
          error: "persistence_unavailable",
          message: "Order audit ledger is not configured.",
        });
      const input = z
        .object({
          apiKey: z.string().min(16).max(256),
          apiSecret: z.string().min(16).max(256),
          symbol: z.string().regex(/^[A-Z0-9]{5,20}$/),
          side: z.enum(["buy", "sell"]),
          quantity: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/),
        })
        .parse(request.body);
      const quote = await marketData.getSnapshot(input.symbol);
      if (
        quote.quality.status !== "live" ||
        Date.now() - Date.parse(quote.quality.observedAt) > 15_000
      )
        return reply
          .code(503)
          .send({ error: "stale_quote", message: "A fresh Binance quote is required." });
      const id = crypto.randomUUID();
      const clientOrderId = `sis_${id.replaceAll("-", "")}`;
      await createMarketLiveOrder(config.DATABASE_URL, {
        id,
        clientOrderId,
        tenantId: principal.tenantId,
        subject: principal.subject,
        venue: "binance",
        symbol: input.symbol,
        side: input.side,
        quantity: input.quantity,
      });
      try {
        const result = await binanceTrading.placeMarketOrder({
          ...input,
          indicativePrice: input.side === "buy" ? quote.ask : quote.bid,
          clientOrderId,
        });
        await updateMarketLiveOrder(
          config.DATABASE_URL,
          id,
          result.status === "FILLED" ? "filled" : "unknown",
          String(result.orderId),
        );
        return { data: { id, venue: "binance", ...result } };
      } catch (error) {
        await updateMarketLiveOrder(
          config.DATABASE_URL,
          id,
          error instanceof TradeRejection && error.statusCode === 504 ? "unknown" : "rejected",
        ).catch(() => {});
        throw error;
      }
    },
  );
  app.get(
    "/v1/market-orders/live",
    { preHandler: requirePermission("portfolio:read") },
    async (request) => ({
      data:
        config.DATABASE_URL && request.principal
          ? await listMarketLiveOrders(config.DATABASE_URL, request.principal.subject)
          : [],
    }),
  );

  app.post(
    "/v1/orders/paper",
    { preHandler: requirePermission("order:paper:create") },
    async (request, reply) => {
      const order = OrderIntent.parse(request.body);
      if (!order.instrumentId.startsWith("binance:") || !order.instrumentId.endsWith(":spot")) {
        return reply.code(422).send({
          error: "unsupported_paper_venue",
          message: "Paper execution currently supports only Binance spot instruments.",
        });
      }
      const context = await dependencies.loadRiskContext?.(order.portfolioId);
      if (!context) {
        return reply.code(503).send({
          error: "risk_context_unavailable",
          message: "Portfolio and mandate state must be available before order evaluation.",
        });
      }
      const [instrument, quote] = await Promise.all([
        marketData.getInstrument(order.instrumentId.split(":")[1] ?? order.instrumentId),
        marketData.getSnapshot(order.instrumentId.split(":")[1] ?? order.instrumentId),
      ]);
      const riskDecision = evaluatePreTradeRisk({ order, instrument, quote, ...context });
      let record = createOrderRecord(crypto.randomUUID(), order);
      record = applyOrderEvent(record, {
        type: "risk_evaluated",
        decision: riskDecision,
        at: riskDecision.checkedAt,
      });
      if (riskDecision.outcome === "rejected")
        return reply.code(422).send({ order: record, riskDecision });
      record = applyOrderEvent(record, { type: "routed", at: new Date().toISOString() });
      const fillPrice = order.side === "buy" ? quote.ask : quote.bid;
      record = applyOrderEvent(record, {
        type: "filled",
        quantity: order.quantity,
        price: fillPrice,
        at: new Date().toISOString(),
      });
      return reply.code(201).send({ order: record, riskDecision, quote });
    },
  );

  app.setErrorHandler((error, request, reply) => {
    request.log.error(
      { errorType: error instanceof Error ? error.name : "unknown", requestId: request.id },
      "request failed",
    );
    if (error instanceof z.ZodError) {
      return reply
        .code(400)
        .send({ error: "validation_error", issues: error.issues, requestId: request.id });
    }
    if (error instanceof TradeRejection) {
      return reply
        .code(error.statusCode)
        .send({ error: "trade_unavailable", message: error.message });
    }
    if (error instanceof PaperOrderRejection)
      return reply.code(422).send({ error: "paper_order_rejected", message: error.message });
    if (error instanceof MarketDataUnavailableError) {
      return reply
        .code(503)
        .send({ error: error.code, message: error.message, requestId: request.id });
    }
    if (error instanceof ClawpumpError) {
      request.log.warn(
        { status: error.status, providerRequestId: error.providerRequestId, requestId: request.id },
        "Clawpump request failed",
      );
      return reply.code(503).send({
        error:
          error.status === 401 || error.status === 403
            ? "provider_credentials_invalid"
            : error.status === 429
              ? "provider_rate_limited"
              : "provider_unavailable",
        message:
          error.status === 401 || error.status === 403
            ? "Clawpump credentials require attention."
            : error.status === 429
              ? "Clawpump rate limit reached."
              : "Clawpump is temporarily unavailable.",
        requestId: request.id,
      });
    }
    const code =
      error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : "";
    if (/^(08|28|42P01|53300|57P03|ECONNREFUSED|ETIMEDOUT)/.test(code))
      return reply.code(503).send({
        error: "database_unavailable",
        message: "Account data is temporarily unavailable.",
        requestId: request.id,
      });
    return reply.code(500).send({
      error: "internal_error",
      message: "The request could not be completed.",
      requestId: request.id,
    });
  });

  return app;
}
