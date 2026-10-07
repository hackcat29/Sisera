import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import {
  OpenRouterChat,
  OpenRouterResearchClient,
  POLICY_GRAMMAR_PROMPT,
  assessFromEvidence,
  compileIntent,
} from "@sisera/copilot";
import { trackWallet } from "@sisera/db";
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
  listMarketLiveOrders,
  listMarketPaperOrders,
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
  PantaPredictionProvider,
  PreStocksProvider,
  PythCoreProvider,
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
import { ClawpumpClient, ClawpumpDirectory, ClawpumpError } from "./clawpump.js";
import { CoinMarketCapClient } from "./coinmarketcap.js";
import type { ApiConfig } from "./config.js";
import { PublicEquityReferenceClient } from "./equity-reference.js";
import { GeckoTerminalCandles } from "./geckoterminal.js";
import { parseHeliusWebhook, validWebhookSecret } from "./helius-webhook.js";
import { HeliusClient } from "./helius.js";
import { HyperEvmWalletClient } from "./hyperevm.js";
import { JupiterQuoteClient } from "./jupiter.js";
import { LivePriceHub } from "./live-prices.js";
import { PaperOrderRejection, settleMarketPaperOrder } from "./market-paper.js";
import {
  JupiterPredictionTradingClient,
  PantaPredictionTradingClient,
} from "./panta-prediction.js";
import { AgentMarketService } from "./platform/agent-market.js";
import { AgentError, AgentService } from "./platform/agent-service.js";
import { AssetCatalog } from "./platform/catalog.js";
import { CopilotService } from "./platform/copilot-service.js";
import { DbcError, DbcService } from "./platform/dbc.js";
import { DelegatedSigner } from "./platform/delegated-signer.js";
import { DexScreenerClient } from "./platform/dexscreener.js";
import { HistoryService } from "./platform/history.js";
import { IntelligenceService } from "./platform/intelligence-service.js";
import { LaunchError, LaunchService } from "./platform/launch-service.js";
import { MarketStateBuilder } from "./platform/market-state.js";
import { MarketplaceService } from "./platform/marketplace-service.js";
import { PolicyError, PolicyService } from "./platform/policy-service.js";
import { PortfolioService } from "./platform/portfolio-service.js";
import { RankingService } from "./platform/rankings.js";
import { registerPlatformRoutes } from "./platform/routes.js";
import { PlatformScheduler } from "./platform/scheduler.js";
import { SecEdgarClient } from "./platform/sec-edgar.js";
import { WalletLeaderboardService } from "./platform/wallet-leaderboard.js";
import { PredictionPaperRejection, settlePredictionPaperOrder } from "./prediction-paper.js";
import { researchPredictionMarket } from "./prediction-research.js";
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
  predictions?: {
    listOpenMarkets(limit?: number): Promise<unknown[]>;
    getMarket?(id: string): Promise<PredictionMarket | null>;
    listEventMarkets?(eventId: string): Promise<PredictionMarket[]>;
  };
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
  const pyth = new PythCoreProvider(config.PYTH_API_KEY ?? "", config.PYTH_HERMES_URL);
  const publicEquities = new PublicEquityReferenceClient();
  let pythEquityBlockedUntil = 0;
  async function getEquityReferences(symbols: string[]) {
    let pythReferences: Awaited<ReturnType<typeof pyth.getLatestEquities>> = [];
    if (config.PYTH_API_KEY && Date.now() >= pythEquityBlockedUntil) {
      try {
        pythReferences = await pyth.getLatestEquities(symbols);
      } catch (error) {
        if (error instanceof Error && error.message.includes("403"))
          pythEquityBlockedUntil = Date.now() + 60 * 60_000;
      }
    }
    const covered = new Set(pythReferences.map((item) => item.symbol.toUpperCase()));
    const missing = symbols.filter((symbol) => {
      const ticker = symbol
        .toUpperCase()
        .replace(/^EQUITY\.US\./, "")
        .replace(/\/USD$/, "");
      return !covered.has(`EQUITY.US.${ticker}/USD`);
    });
    const publicReferences = await publicEquities.getLatestEquities(missing);
    return [...pythReferences, ...publicReferences];
  }
  const coinMarketCap = config.COINMARKETCAP_API_KEY
    ? new CoinMarketCapClient(config.COINMARKETCAP_API_KEY)
    : null;
  const solanaRpcUrl =
    config.SOLANA_RPC_URL ??
    (config.HELIUS_API_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${config.HELIUS_API_KEY}`
      : "https://api.mainnet-beta.solana.com");
  const helius = new HeliusClient(
    solanaRpcUrl,
    globalThis.fetch,
    config.DATABASE_URL
      ? async (address) => {
          if (config.DATABASE_URL) await trackWallet(config.DATABASE_URL, address);
        }
      : undefined,
  );
  const hyperEvmWallet = new HyperEvmWalletClient();
  const clawpump = config.CLAWPUMP_API_KEY ? new ClawpumpClient(config.CLAWPUMP_API_KEY) : null;
  const jupiter = config.JUPITER_API_KEY ? new JupiterQuoteClient(config.JUPITER_API_KEY) : null;
  // Agent tokens are resolved through the catalog, which is constructed once live prices exist.
  let catalogRef: AssetCatalog | null = null;
  const solanaTrading = new SolanaTradingService(
    config,
    xstocks,
    prestocks,
    helius,
    jupiter,
    async (mint) => {
      const asset = await catalogRef?.byMint(mint);
      return asset?.kind === "agent_token"
        ? { symbol: asset.symbol, priceUsd: asset.priceUsd, kind: "agent_token" }
        : null;
    },
  );
  const solanaLiveReady = Boolean(
    config.SISERA_LIVE_SOLANA_ENABLED &&
      config.DATABASE_URL &&
      config.PRIVY_APP_ID &&
      config.PRIVY_APP_SECRET &&
      config.JUPITER_API_KEY &&
      config.HELIUS_API_KEY,
  );
  const predictionsLiveReady = Boolean(
    config.SISERA_LIVE_PREDICTIONS_ENABLED &&
      config.DATABASE_URL &&
      config.PRIVY_APP_ID &&
      config.PRIVY_APP_SECRET &&
      config.HELIUS_API_KEY,
  );
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
  const predictionPaperClient = new PantaPredictionTradingClient(
    config.PANTA_API_BASE_URL,
    config.PANTA_API_KEY,
    globalThis.fetch,
    solanaRpcUrl,
    config.PANTA_PROGRAM_ID,
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
    new PantaPredictionProvider(
      config.PANTA_API_BASE_URL,
      config.PANTA_API_KEY,
      globalThis.fetch,
      solanaRpcUrl,
      config.PANTA_PROGRAM_ID,
    );
  const referenceMarkets = new CoinGeckoReferenceProvider();
  const requestStarts = new WeakMap<object, number>();

  await app.register(helmet);
  await app.register(cors, { origin: false });
  // Every browser request reaches the API through the Next server, so keying limits by IP would
  // make all users share one bucket. Limits run after authentication and key on the signed-in
  // user; anonymous traffic shares one bucket, which the web tier absorbs with its own caching.
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    hook: "preHandler",
    keyGenerator: (request) =>
      request.principal && request.principal.subject !== "public"
        ? `user:${request.principal.subject}`
        : `ip:${request.ip}`,
  });
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
      solana: solanaLiveReady,
      predictions: predictionsLiveReady,
      binance: config.SISERA_LIVE_BINANCE_ENABLED,
      hyperliquid: false,
      launches: Boolean(config.SISERA_LIVE_LAUNCHES_ENABLED && config.DATABASE_URL),
      agents: Boolean(config.SISERA_LIVE_AGENTS_ENABLED && solanaLiveReady),
      delegatedSigning: delegatedSigner.available,
    },
    intelligence: { model: Boolean(research), clawpumpPartner: Boolean(clawpump) },
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
        if (config.DATABASE_URL) await trackWallet(config.DATABASE_URL, address);
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
  const geckoCandles = new GeckoTerminalCandles();
  // One shared per-second price snapshot for every open terminal (see LivePriceHub).
  const livePrices = new LivePriceHub(async () => {
    const [stocks, privateMarkets] = await Promise.all([
      xstocks.list().catch(() => []),
      prestocks.list().catch(() => []),
    ]);
    const traded = stocks
      .filter((stock) => (stock.liquidityUsd ?? 0) > 1_000)
      .sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0));
    const tradedMints = new Set(traded.map((stock) => stock.mint));
    return {
      priority: [
        ...privateMarkets.map((market) => market.instrument.venueSymbol),
        ...traded.slice(0, 92).map((stock) => stock.mint),
      ],
      tail: [
        ...traded.slice(92).map((stock) => stock.mint),
        ...stocks.filter((stock) => !tradedMints.has(stock.mint)).map((stock) => stock.mint),
      ],
    };
  }, config.JUPITER_API_KEY);
  app.addHook("onClose", async () => livePrices.stop());

  // ------------------------------------------------------------------ platform services
  const dexScreener = new DexScreenerClient();
  const clawpumpDirectory = new ClawpumpDirectory();
  const catalog = new AssetCatalog(
    xstocks,
    prestocks,
    clawpumpDirectory,
    dexScreener,
    livePrices,
    (tickers) => getEquityReferences(tickers),
  );
  catalogRef = catalog;
  const history = new HistoryService(config.BINANCE_SPOT_BASE_URL, geckoCandles);
  const intelligence = new IntelligenceService(
    catalog,
    stockNews,
    new SecEdgarClient(config.SEC_EDGAR_USER_AGENT),
    social,
    config.DATABASE_URL,
  );
  const marketStates = new MarketStateBuilder(intelligence, history);
  const delegatedSigner = new DelegatedSigner(
    config.PRIVY_APP_ID,
    config.PRIVY_APP_SECRET,
    config.PRIVY_AUTHORIZATION_PRIVATE_KEY,
    config.SISERA_DELEGATED_SIGNING_ENABLED,
  );
  const chat =
    config.OPENROUTER_API_KEY && config.SISERA_INTELLIGENCE_MODEL
      ? new OpenRouterChat(config.OPENROUTER_API_KEY, config.SISERA_INTELLIGENCE_MODEL)
      : null;
  const portfolioService = config.DATABASE_URL
    ? new PortfolioService(config.DATABASE_URL, catalog, helius, {
        cryptoSpot: async (symbol) => {
          const snapshot = await marketData.getSnapshot(symbol);
          return snapshot.quality.status === "live"
            ? { price: Number(snapshot.bid), observedAt: snapshot.quality.observedAt }
            : null;
        },
        perpetual: async (symbol) => {
          const snapshot = await hyperliquid.getSnapshot(symbol);
          return { price: Number(snapshot.last), observedAt: snapshot.quality.observedAt };
        },
        prediction: async (marketId, outcome) => {
          const market = await predictions.getMarket?.(marketId);
          const probability = market?.outcomes[outcome === "yes" ? 0 : 1]?.probability;
          return market && probability
            ? { price: Number(probability), observedAt: market.quality.observedAt }
            : null;
        },
      })
    : null;
  const policyService =
    config.DATABASE_URL && portfolioService
      ? new PolicyService({
          databaseUrl: config.DATABASE_URL,
          catalog,
          states: marketStates,
          portfolio: portfolioService,
          trading: solanaTrading,
          helius,
          signer: delegatedSigner,
          liveAvailable: solanaLiveReady,
          log: app.log,
          ...(chat
            ? {
                rewrite: async (text: string, assetHint: string | null) => {
                  const line = await chat.complete(
                    [
                      { role: "system", content: POLICY_GRAMMAR_PROMPT },
                      {
                        role: "user",
                        content: `${assetHint ? `Asset in context: ${assetHint}\n` : ""}Instruction: ${text}`,
                      },
                    ],
                    { maxTokens: 160 },
                  );
                  return !line || /^NONE\b/i.test(line) ? null : (line.split("\n")[0] ?? null);
                },
              }
            : {}),
        })
      : null;
  const agentService = config.DATABASE_URL
    ? new AgentService({
        databaseUrl: config.DATABASE_URL,
        catalog,
        history,
        states: marketStates,
        spot: marketData,
        trading: solanaTrading,
        helius,
        signer: delegatedSigner,
        liveAgentsEnabled: Boolean(config.SISERA_LIVE_AGENTS_ENABLED && solanaLiveReady),
        log: app.log,
      })
    : null;
  const launchService = config.DATABASE_URL
    ? new LaunchService(
        config.DATABASE_URL,
        solanaRpcUrl,
        clawpump,
        new DbcService(solanaRpcUrl, config.SISERA_DBC_PARTNER_WALLET),
        catalog,
        config.SISERA_PUBLIC_URL,
      )
    : null;
  const rankings = new RankingService(catalog, intelligence, portfolioService);
  const agentMarket = new AgentMarketService(catalog, clawpumpDirectory, solanaRpcUrl);
  const copilot = new CopilotService({
    databaseUrl: config.DATABASE_URL,
    catalog,
    intelligence,
    portfolio: portfolioService,
    policies: policyService,
    rankings,
    agentMarket,
    history,
    chat,
    model: config.SISERA_INTELLIGENCE_MODEL ?? null,
  });
  const walletLeaderboard = config.DATABASE_URL
    ? new WalletLeaderboardService(
        config.DATABASE_URL,
        config.HELIUS_API_KEY,
        config.HYPERLIQUID_BASE_URL,
      )
    : null;
  registerPlatformRoutes(app, config, {
    catalog,
    intelligence,
    rankings,
    agentMarket,
    copilot,
    portfolio: portfolioService,
    policies: policyService,
    agents: agentService,
    launches: launchService,
    marketplace:
      config.DATABASE_URL && agentService
        ? new MarketplaceService(config.DATABASE_URL, agentService, solanaRpcUrl)
        : null,
    walletLeaderboard,
    requireOwnedWallet,
  });
  if (config.DATABASE_URL && config.SISERA_SCHEDULER_ENABLED && config.NODE_ENV !== "test") {
    const scheduler = new PlatformScheduler(
      config.DATABASE_URL,
      { policies: policyService, agents: agentService, intelligence, catalog, walletLeaderboard },
      app.log,
    );
    app.addHook("onReady", async () => scheduler.start());
    app.addHook("onClose", async () => scheduler.stop());
  }
  app.get(
    "/v1/live/prices",
    { config: { rateLimit: { max: 1200, timeWindow: "1 minute" } } },
    async (request) => {
      const { mints } = z.object({ mints: z.string().max(20_000).optional() }).parse(request.query);
      const requested = mints
        ?.split(",")
        .filter((mint) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint))
        .slice(0, 500);
      return { data: livePrices.snapshot(requested), at: Date.now() };
    },
  );

  // Binance USDT spot pairs with 24h activity. The full ticker is large and can be slow, so it is
  // refreshed in the background every ten seconds and requests are always answered from memory.
  let spotUniverse: { at: number; value: unknown[] } | null = null;
  let spotRefresh: Promise<void> | null = null;
  const refreshSpotUniverse = () => {
    spotRefresh ??= (async () => {
      const response = await fetch(`${config.BINANCE_SPOT_BASE_URL}/api/v3/ticker/24hr?type=MINI`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Binance returned ${response.status}`);
      const rows = z
        .array(
          z.object({
            symbol: z.string(),
            openPrice: z.string(),
            highPrice: z.string(),
            lowPrice: z.string(),
            lastPrice: z.string(),
            volume: z.string(),
            quoteVolume: z.string(),
          }),
        )
        .parse(await response.json());
      const value = rows
        .filter(
          (row) =>
            row.symbol.endsWith("USDT") &&
            !/(UP|DOWN|BULL|BEAR)USDT$/.test(row.symbol) &&
            Number(row.quoteVolume) >= 50_000,
        )
        .map((row) => {
          const open = Number(row.openPrice);
          const last = Number(row.lastPrice);
          return {
            symbol: row.symbol,
            base: row.symbol.slice(0, -4),
            quote: "USDT",
            last,
            change24hPct: open > 0 ? (last / open - 1) * 100 : 0,
            high24h: Number(row.highPrice),
            low24h: Number(row.lowPrice),
            volume24hBase: Number(row.volume),
            volume24hUsd: Number(row.quoteVolume),
          };
        })
        .sort((a, b) => b.volume24hUsd - a.volume24hUsd);
      spotUniverse = { at: Date.now(), value };
    })()
      .catch((error) => app.log.warn({ error }, "spot universe refresh failed"))
      .finally(() => {
        spotRefresh = null;
      });
    return spotRefresh;
  };
  app.get(
    "/v1/spot-universe",
    { preHandler: requirePermission("market:read") },
    async (_request, reply) => {
      if (!spotUniverse) await refreshSpotUniverse();
      else if (Date.now() - spotUniverse.at > 10_000) void refreshSpotUniverse();
      if (!spotUniverse)
        return reply
          .code(503)
          .send({ error: "provider_unavailable", message: "Binance is unavailable" });
      return { data: spotUniverse.value };
    },
  );

  // Clawpump agent tokens from its public listing, cached briefly per query.
  const agentTokenCache = new Map<string, { until: number; value: unknown }>();
  app.get(
    "/v1/agent-tokens",
    { preHandler: requirePermission("market:read") },
    async (request, reply) => {
      const query = z
        .object({
          sort: z.enum(["volume", "new", "mcap"]).default("volume"),
          period: z.enum(["24h", "7d"]).default("24h"),
          limit: z.coerce.number().int().min(1).max(100).default(60),
          offset: z.coerce.number().int().min(0).max(50_000).default(0),
          q: z.string().trim().max(80).optional(),
        })
        .parse(request.query);
      const key = JSON.stringify(query);
      const cached = agentTokenCache.get(key);
      if (cached && cached.until > Date.now()) return cached.value;
      const url = new URL("https://clawpump.tech/api/tokens");
      url.searchParams.set("sort", query.sort);
      url.searchParams.set("period", query.period);
      url.searchParams.set("limit", String(query.limit));
      url.searchParams.set("offset", String(query.offset));
      if (query.q) url.searchParams.set("q", query.q);
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
      if (!response?.ok)
        return reply
          .code(503)
          .send({ error: "provider_unavailable", message: "Clawpump listings are unavailable" });
      const payload = z
        .object({
          tokens: z.array(
            z
              .object({
                mintAddress: z.string(),
                name: z.string(),
                symbol: z.string(),
                description: z.string().nullable().optional(),
                imageUrl: z.string().nullable().optional(),
                marketCap: z.number().nullable().optional(),
                price: z.number().nullable().optional(),
                volume24h: z.number().nullable().optional(),
                liquidity: z.number().nullable().optional(),
                agentName: z.string().nullable().optional(),
                verified: z.boolean().optional(),
                isGraduated: z.boolean().optional(),
                tags: z.array(z.string()).optional(),
                website: z.string().nullable().optional(),
                twitter: z.string().nullable().optional(),
                createdAt: z.string().nullable().optional(),
                launchPlatform: z.string().nullable().optional(),
              })
              .passthrough(),
          ),
          total: z.number(),
          hasMore: z.boolean(),
        })
        .parse(await response.json());
      const value = {
        data: payload.tokens.map((token) => ({
          mint: token.mintAddress,
          name: token.name,
          symbol: token.symbol,
          description: token.description ?? null,
          imageUrl: token.imageUrl
            ? token.imageUrl.startsWith("/")
              ? `https://clawpump.tech${token.imageUrl}`
              : token.imageUrl
            : null,
          priceUsd: token.price ?? null,
          marketCapUsd: token.marketCap ?? null,
          volume24hUsd: token.volume24h ?? null,
          liquidityUsd: token.liquidity ?? null,
          agentName: token.agentName ?? null,
          verified: token.verified ?? false,
          graduated: token.isGraduated ?? false,
          tags: token.tags ?? [],
          website: token.website ?? null,
          twitter: token.twitter ?? null,
          createdAt: token.createdAt ?? null,
          launchPlatform: token.launchPlatform ?? null,
        })),
        total: payload.total,
        hasMore: payload.hasMore,
        source: "clawpump",
      };
      agentTokenCache.set(key, { until: Date.now() + 30_000, value });
      if (agentTokenCache.size > 200)
        agentTokenCache.delete(agentTokenCache.keys().next().value ?? "");
      return value;
    },
  );

  app.get(
    "/v1/market-overview",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async () => {
      if (!coinMarketCap)
        return { data: { global: null, sentiment: null, crypto: [], rwaStocks: [] } };
      const [global, sentiment, crypto, rwaStocks] = await Promise.allSettled([
        coinMarketCap.globalMetrics(),
        coinMarketCap.sentiment(),
        coinMarketCap.cryptoLeaders(50),
        coinMarketCap.rwaStocks(50),
      ]);
      return {
        data: {
          global: global.status === "fulfilled" ? global.value : null,
          sentiment: sentiment.status === "fulfilled" ? sentiment.value : null,
          crypto: crypto.status === "fulfilled" ? crypto.value : [],
          rwaStocks: rwaStocks.status === "fulfilled" ? rwaStocks.value : [],
        },
      };
    },
  );
  app.get(
    "/v1/rwa/stocks",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (_request, reply) => {
      if (!coinMarketCap) return reply.code(503).send({ error: "market_data_unavailable" });
      try {
        return { data: await coinMarketCap.rwaStocks(100) };
      } catch {
        return reply.code(503).send({ error: "market_data_unavailable" });
      }
    },
  );
  app.get(
    "/v1/crypto/:id/profile",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
      if (!coinMarketCap) return reply.code(503).send({ error: "market_data_unavailable" });
      try {
        return { data: await coinMarketCap.cryptoProfile(id) };
      } catch {
        return reply.code(503).send({ error: "market_data_unavailable" });
      }
    },
  );
  app.get(
    "/v1/solana/tokens/:mint/history",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { mint } = z
        .object({ mint: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/) })
        .parse(request.params);
      const { interval } = z
        .object({ interval: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]).default("1h") })
        .parse(request.query);
      // GeckoTerminal covers every timeframe; CoinMarketCap backs up hourly and daily candles.
      const candles = await geckoCandles.history(mint, interval).catch(() => []);
      if (candles.length > 1) return { data: candles, source: "geckoterminal" };
      if (coinMarketCap && (interval === "1h" || interval === "1d")) {
        const history = await coinMarketCap.solanaTokenCandles(mint, interval).catch(() => null);
        if (history) return { data: history, source: "coinmarketcap" };
      }
      return reply.code(503).send({ error: "token_history_unavailable" });
    },
  );
  app.get(
    "/v1/rwa/:symbol/history",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { symbol } = z
        .object({ symbol: z.string().regex(/^[A-Za-z0-9$@.-]{1,15}$/) })
        .parse(request.params);
      const { token, period } = z
        .object({
          token: z.string().regex(/^[A-Za-z0-9$@.-]{1,20}$/),
          period: z.enum(["hourly", "daily"]).default("daily"),
        })
        .parse(request.query);
      if (!coinMarketCap) return reply.code(503).send({ error: "market_data_unavailable" });
      try {
        const detail = await coinMarketCap.rwaDetail(symbol);
        const asset = detail.market?.tokens.find(
          (item) => item.symbol.toUpperCase() === token.toUpperCase(),
        );
        if (!asset?.cryptoId) return reply.code(404).send({ error: "token_history_unavailable" });
        return {
          data: await coinMarketCap.tokenHistory(asset.cryptoId, period),
          token: asset.symbol,
        };
      } catch {
        return reply.code(503).send({ error: "token_history_unavailable" });
      }
    },
  );
  app.get(
    "/v1/rwa/:symbol",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { symbol } = z
        .object({ symbol: z.string().regex(/^[A-Za-z0-9$@.-]{1,15}$/) })
        .parse(request.params);
      if (!coinMarketCap) return reply.code(503).send({ error: "market_data_unavailable" });
      try {
        return { data: await coinMarketCap.rwaDetail(symbol) };
      } catch {
        return reply.code(503).send({ error: "market_data_unavailable" });
      }
    },
  );
  app.get("/v1/agents", { preHandler: requirePermission("agent:read") }, async (request) => {
    if (!config.DATABASE_URL || !request.principal || !agentService)
      return { templates: agentTemplates, custom: [], persistence: "unavailable" };
    try {
      return {
        templates: agentTemplates,
        custom: await agentService.list(request.principal),
        persistence: "postgres",
      };
    } catch {
      request.log.error({ requestId: request.id }, "agent store unavailable");
      return { templates: agentTemplates, custom: [], persistence: "unavailable" };
    }
  });
  app.get(
    "/v1/agents/:id/readiness",
    {
      preHandler: requirePermission("agent:read"),
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { id } = z
        .object({ id: z.string().regex(/^custom:[0-9a-f-]{36}$/) })
        .parse(request.params);
      if (!config.DATABASE_URL || !request.principal?.subject.startsWith("privy:"))
        return reply.code(503).send({ message: "Agent account store is unavailable." });
      const manifests = await listAgentManifests(
        config.DATABASE_URL,
        request.principal.tenantId,
        request.principal.subject,
      );
      const manifest = manifests.find((candidate) => candidate.id === id);
      if (!manifest) return reply.code(404).send({ message: "Agent draft not found." });
      const policy = z
        .object({
          universe: z.array(z.string()),
          timeframe: z.string(),
          factors: z.array(z.string()),
        })
        .passthrough()
        .parse(manifest.policy);
      const intervalSeconds: Record<string, number> = {
        "5m": 300,
        "15m": 900,
        "1h": 3600,
        "4h": 14400,
        "1d": 86400,
      };
      const interval = intervalSeconds[policy.timeframe];
      const data = await Promise.all(
        policy.universe.map(async (symbol) => {
          if (!interval || !/^[A-Z0-9]{2,20}USDT$/.test(symbol.toUpperCase()))
            return {
              symbol,
              status: "unsupported",
              bars: 0,
              reason: "No compatible historical market adapter for this asset or timeframe.",
            };
          try {
            const candles = await marketData.getCandles?.(
              symbol.toUpperCase(),
              policy.timeframe,
              120,
            );
            const first = candles?.[0];
            const last = candles?.at(-1);
            if (!candles || !first || !last) throw new Error("No historical bars");
            const missingIntervals = candles.slice(1).reduce((count, candle, index) => {
              const previous = candles[index];
              return previous
                ? count + Math.max(0, Math.round((candle.time - previous.time) / interval) - 1)
                : count;
            }, 0);
            const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000) - last.time);
            return {
              symbol,
              status:
                candles.length >= 100 && missingIntervals === 0 && ageSeconds <= interval * 3
                  ? "ready"
                  : "incomplete",
              bars: candles.length,
              start: new Date(first.time * 1000).toISOString(),
              end: new Date(last.time * 1000).toISOString(),
              missingIntervals,
              ageSeconds,
              source: "binance-spot-candles",
            };
          } catch {
            return {
              symbol,
              status: "unavailable",
              bars: 0,
              reason: "Historical market data could not be retrieved.",
            };
          }
        }),
      );
      return {
        data: {
          agentId: id,
          manifestHash: manifest.manifestHash,
          stage: manifest.stage,
          evaluation: "data_readiness_only",
          measuredAt: new Date().toISOString(),
          factorSpecification: "human-authored; no executable signal rules",
          readyForBacktest: false,
          markets: data,
          gates: [
            {
              name: "Historical data coverage",
              passed: data.length > 0 && data.every((item) => item.status === "ready"),
            },
            { name: "Executable strategy rules", passed: false },
            { name: "Backtest and stress evidence", passed: false },
            { name: "Paper and shadow evidence", passed: false },
          ],
        },
      };
    },
  );
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
            source: "panta-prediction",
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
      if (!config.DATABASE_URL || !agentService)
        return reply
          .code(503)
          .send({ error: "persistence_unavailable", message: "Agent database is not configured" });
      return reply
        .code(201)
        .send({ data: await agentService.create(request.principal, request.body) });
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
      const company = asset?.company ?? publicStock?.name ?? symbol;
      const [news, oracle] = await Promise.all([
        stockNews
          .search(company, publicStock?.underlyingSymbol)
          .catch(() => ({ data: [], providers: [] })),
        publicStock
          ? getEquityReferences([publicStock.underlyingSymbol])
              .then((rows) => rows[0] ?? null)
              .catch(() => null)
          : Promise.resolve(null),
      ]);
      const inputArticles = news.data.slice(0, 5).map((item) => ({
        title: item.title,
        publishedAt: item.publishedAt,
        publisher: item.publisher,
        url: item.url,
      }));
      const tokenPrice = asset?.tokenPrice ?? publicStock?.dexPriceUsd ?? null;
      const referencePrice = asset?.markPrice ?? oracle?.price ?? null;
      const premiumDiscountPct =
        asset?.premiumDiscountPct ??
        (oracle?.referenceFreshness === "live" &&
        tokenPrice &&
        referencePrice &&
        Number(referencePrice) > 0
          ? String((Number(tokenPrice) / Number(referencePrice) - 1) * 100)
          : null);
      const referenceKind = asset
        ? ("prestocks_mark" as const)
        : oracle
          ? oracle.source === "pyth-core"
            ? ("pyth_core_equity" as const)
            : ("public_equity" as const)
          : ("unavailable" as const);
      const referenceFreshness = asset
        ? ("unavailable" as const)
        : (oracle?.referenceFreshness ?? ("unavailable" as const));
      const marketSource = asset?.source ?? publicStock?.source ?? "unknown";
      const marketObservedAt =
        asset?.fetchedAt ?? publicStock?.fetchedAt ?? new Date().toISOString();
      const context = {
        company,
        symbol: asset?.instrument.baseAsset ?? publicStock?.symbol ?? symbol,
        tokenPrice,
        referencePrice,
        referenceKind,
        referenceFreshness,
        referenceObservedAt: oracle?.feedUpdateTimestamp ?? null,
        premiumDiscountPct,
        volume24hUsd: publicStock?.volume24hUsd ?? null,
        liquidityUsd: publicStock?.liquidityUsd ?? null,
        change24hPct: publicStock?.change24hPct ?? null,
        tradingHalted: publicStock?.tradingHalted ?? false,
        fetchedAt: marketObservedAt,
        articles: inputArticles,
      };
      // Prefer the language model; fall back to evidence-only research so it is always available.
      let modelUsed = research ? config.SISERA_INTELLIGENCE_MODEL : "sisera-evidence";
      const assessment = research
        ? await research.assess(context).catch((error) => {
            request.log.warn({ error }, "research model failed; using evidence-only assessment");
            modelUsed = "sisera-evidence";
            return assessFromEvidence(context);
          })
        : assessFromEvidence(context);
      const evidenceSources =
        Number(tokenPrice !== null) +
        Number((asset && referencePrice !== null) || oracle?.referenceFreshness === "live") +
        Number(inputArticles.length > 0) +
        Number(publicStock?.liquidityUsd != null);
      return {
        data: {
          ...assessment,
          confidence: Math.min(
            assessment.confidence,
            evidenceSources <= 1 ? 0.35 : evidenceSources === 2 ? 0.6 : 0.85,
          ),
          evidence: {
            marketSource,
            marketObservedAt,
            tokenPrice,
            referencePrice,
            referenceKind,
            referenceFreshness,
            referenceObservedAt: oracle?.feedUpdateTimestamp ?? null,
            liquidityUsd: publicStock?.liquidityUsd ?? null,
            articles: inputArticles,
          },
        },
        provenance: {
          market: marketSource,
          news: news.providers,
          model: modelUsed,
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
    "/v1/pyth/reference",
    { preHandler: requirePermission("market:read") },
    async (request, reply) => {
      const { symbol } = z
        .object({ symbol: z.string().regex(/^[A-Za-z0-9./_-]{1,80}$/) })
        .parse(request.query);
      try {
        const [reference] = await getEquityReferences([symbol]);
        if (!reference) throw new Error("No public equity quote");
        return { data: reference };
      } catch (error) {
        request.log.warn({ error, symbol }, "Equity reference unavailable");
        return reply
          .code(503)
          .send({ error: "reference_unavailable", message: "Equity reference is unavailable." });
      }
    },
  );
  app.get(
    "/v1/pyth/references",
    {
      preHandler: requirePermission("market:read"),
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { symbols } = z.object({ symbols: z.string().max(520) }).parse(request.query);
      try {
        return { data: await getEquityReferences(symbols.split(",")) };
      } catch (error) {
        request.log.warn({ error }, "Equity references unavailable");
        return reply
          .code(503)
          .send({ error: "reference_unavailable", message: "Equity references are unavailable." });
      }
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
      if (config.DATABASE_URL) await trackWallet(config.DATABASE_URL, address);
      return { data: await hyperliquid.getPublicAccount(address) };
    },
  );

  app.get(
    "/v1/prediction-markets",
    { preHandler: requirePermission("market:read") },
    async (request, reply) => {
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(500).default(50),
          offset: z.coerce.number().int().min(0).default(0),
          category: z.string().trim().max(40).optional(),
          q: z.string().trim().max(80).optional(),
          sort: z.enum(["volume", "closing", "contested"]).default("volume"),
        })
        .parse(request.query);
      try {
        // Filter, sort, and page here so clients receive one page instead of every market.
        const all = (await predictions.listOpenMarkets(100_000)) as PredictionMarket[];
        const counts = new Map<string, number>();
        for (const market of all)
          counts.set(market.category ?? "other", (counts.get(market.category ?? "other") ?? 0) + 1);
        const needle = query.q?.toLowerCase();
        const yes = (market: PredictionMarket) => Number(market.outcomes[0]?.probability ?? 0);
        const filtered = all
          .filter(
            (market) =>
              !query.category ||
              query.category === "all" ||
              (market.category ?? "other") === query.category,
          )
          .filter((market) => !needle || market.title.toLowerCase().includes(needle))
          .sort((a, b) =>
            query.sort === "closing"
              ? Date.parse(a.closesAt ?? "") - Date.parse(b.closesAt ?? "")
              : query.sort === "contested"
                ? Math.abs(yes(a) - 0.5) - Math.abs(yes(b) - 0.5)
                : (b.volumeUsd ?? 0) - (a.volumeUsd ?? 0),
          );
        return {
          // List views omit resolution rules; the market detail route returns them in full.
          data: filtered
            .slice(query.offset, query.offset + query.limit)
            .map(({ resolutionRules: _rules, ...market }) => market),
          total: filtered.length,
          all: all.length,
          categories: [...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => ({ name, count })),
        };
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

  app.get(
    "/v1/prediction-markets/:id",
    { preHandler: requirePermission("market:read") },
    async (request, reply) => {
      const { id } = z
        .object({ id: z.string().regex(/^[A-Za-z0-9:_-]{3,128}$/) })
        .parse(request.params);
      const market = await predictions.getMarket?.(id).catch(() => null);
      if (!market) return reply.code(404).send({ error: "not_found", message: "Unknown market" });
      const siblings =
        market.eventId && predictions.listEventMarkets
          ? await predictions.listEventMarkets(market.eventId).catch(() => [])
          : [];
      return { data: market, related: siblings.filter((item) => item.id !== market.id) };
    },
  );
  const predictionResearchCache = new Map<string, { until: number; value: unknown }>();
  app.get(
    "/v1/prediction-markets/:id/research",
    { preHandler: requirePermission("market:read") },
    async (request, reply) => {
      const { id } = z
        .object({ id: z.string().regex(/^[A-Za-z0-9:_-]{3,128}$/) })
        .parse(request.params);
      const cached = predictionResearchCache.get(id);
      if (cached && cached.until > Date.now()) return { data: cached.value };
      const market = await predictions.getMarket?.(id).catch(() => null);
      if (!market) return reply.code(404).send({ error: "not_found", message: "Unknown market" });
      const siblings =
        market.eventId && predictions.listEventMarkets
          ? await predictions.listEventMarkets(market.eventId).catch(() => [])
          : [];
      const value = await researchPredictionMarket(market, siblings);
      predictionResearchCache.set(id, { until: Date.now() + 60_000, value });
      if (predictionResearchCache.size > 500)
        predictionResearchCache.delete(predictionResearchCache.keys().next().value ?? "");
      return { data: value };
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
    if (
      error instanceof PolicyError ||
      error instanceof AgentError ||
      error instanceof LaunchError ||
      error instanceof DbcError
    )
      return reply
        .code(error.statusCode)
        .send({ error: "request_rejected", message: error.message, requestId: request.id });
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

  // Warm the slow catalogues once the server starts so the first visitor never waits on them.
  if (config.NODE_ENV !== "test")
    app.addHook("onReady", async () => {
      void xstocks.list().catch(() => undefined);
      void predictions.listOpenMarkets(1).catch(() => undefined);
      void refreshSpotUniverse();
    });
  return app;
}
