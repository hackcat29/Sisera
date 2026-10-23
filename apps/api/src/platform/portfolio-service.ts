import {
  type FillRow,
  countUnnormalizedLiveSwaps,
  getAgentRuntimeState,
  getPaperAccounts,
  getRiskPreferences,
  listLiveWallets,
  listPortfolioFills,
  listRunnableAgents,
} from "@sisera/db";
import {
  type AssetClassKey,
  type Fill,
  type Mark,
  STANDARD_SCENARIOS,
  buildPositions,
  runScenario,
  simulateTrade,
  valuePositions,
} from "@sisera/portfolio";
import { DEFAULT_MANDATE, type MandateLimits, evaluateMandate } from "@sisera/risk";
import type { HeliusClient } from "../helius.js";
import type { AssetCatalog, CatalogAsset } from "./catalog.js";
import { USDC_MINT } from "./catalog.js";

export type MarkSources = {
  cryptoSpot: (symbol: string) => Promise<{ price: number; observedAt: string } | null>;
  perpetual: (symbol: string) => Promise<{ price: number; observedAt: string } | null>;
  /** Hyperliquid spot, by token symbol such as "BTC" or "HYPE". */
  hyperliquidSpot?: (symbol: string) => Promise<{ price: number; observedAt: string } | null>;
  prediction: (
    marketId: string,
    outcome: "yes" | "no",
  ) => Promise<{ price: number; observedAt: string } | null>;
  /** The question, picture, status, and resolution details of a prediction market. */
  predictionInfo?: (marketId: string) => Promise<{
    title: string;
    imageUrl: string | null;
    status?: string | undefined;
    phase?: string | undefined;
    winnerOutcome?: "yes" | "no" | null | undefined;
  } | null>;
};

const ASSET_CLASS_BY_KIND: Record<CatalogAsset["kind"], AssetClassKey> = {
  public_equity: "public_equity",
  pre_ipo: "pre_ipo",
  agent_token: "agent_token",
};

export type PortfolioView = Awaited<ReturnType<PortfolioService["view"]>>;

export type ReconciliationView = {
  status: "reconciled" | "breaks" | "observed_only" | "unavailable";
  wallets: Array<{ address: string; status: "live" | "unavailable"; usdc: number | null }>;
  breaks: Array<{
    symbol: string;
    mint: string;
    ledgerQuantity: number;
    observedQuantity: number;
    difference: number;
  }>;
  observedOnly: Array<{ symbol: string; mint: string; quantity: number; valueUsd: number | null }>;
  unnormalizedLiveSwaps: number;
};

/**
 * The unified portfolio. Positions are rebuilt from the immutable fill ledger (manual trades,
 * policy executions and agent executions), marked with the freshest available prices, and — in
 * live mode — reconciled against wallet balances observed onchain.
 */
export class PortfolioService {
  constructor(
    private readonly databaseUrl: string,
    private readonly catalog: AssetCatalog,
    private readonly helius: HeliusClient,
    private readonly marks: MarkSources,
  ) {}

  private async enrich(
    fills: readonly FillRow[],
  ): Promise<{ fills: Fill[]; marks: Map<string, Mark> }> {
    const assets = await this.catalog.list();
    const byMint = new Map(assets.map((asset) => [asset.mint, asset]));
    const unknownMints = [...new Set(fills.map((fill) => fill.instrumentKey))].filter(
      (key) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(key) && !byMint.has(key),
    );
    for (const mint of unknownMints.slice(0, 20)) {
      const asset = await this.catalog.byMint(mint).catch(() => null);
      if (asset) byMint.set(mint, asset);
    }
    const marks = new Map<string, Mark>();
    const pending: Array<Promise<void>> = [];
    const normalized = fills.map((fill): Fill => {
      const asset = byMint.get(fill.instrumentKey);
      let assetClass =
        (fill.assetClass as AssetClassKey | null) ??
        (asset ? ASSET_CLASS_BY_KIND[asset.kind] : "agent_token");
      let symbol = asset?.symbol ?? fill.instrumentKey.slice(0, 8);
      if (fill.instrumentKey.startsWith("hyperliquid-spot:")) {
        assetClass = "crypto_spot";
        symbol = fill.instrumentKey.slice("hyperliquid-spot:".length).replace(/\/USDC$/, "");
      } else if (fill.instrumentKey.startsWith("binance:")) {
        assetClass = "crypto_spot";
        symbol = fill.instrumentKey.slice(8).replace(/USDT$|USDC$/, "");
      } else if (fill.instrumentKey.startsWith("hyperliquid:")) {
        assetClass = "perpetual";
        symbol = `${fill.instrumentKey.slice(12).replace(/USDT$|USDC$/, "")}-PERP`;
      } else if (fill.instrumentKey.startsWith("prediction:")) {
        assetClass = "prediction";
        const [, marketId, outcome] = fill.instrumentKey.split(":");
        symbol = `${(marketId ?? "").slice(0, 10)} ${(outcome ?? "").toUpperCase()}`;
      }
      if (!marks.has(fill.instrumentKey)) {
        marks.set(fill.instrumentKey, { priceUsd: null, source: "unavailable", observedAt: null });
        pending.push(
          this.markFor(fill.instrumentKey, asset).then(
            (mark) => void marks.set(fill.instrumentKey, mark),
          ),
        );
      }
      return {
        id: fill.id,
        mode: fill.mode,
        book: fill.book,
        venue: fill.venue,
        assetClass,
        instrumentKey: fill.instrumentKey,
        symbol,
        side: fill.side,
        quantity: fill.quantity,
        priceUsd: fill.priceUsd,
        feeUsd: fill.feeUsd,
        occurredAt: fill.occurredAt,
      };
    });
    await Promise.all(pending);
    return { fills: normalized, marks };
  }

  private async markFor(key: string, asset: CatalogAsset | undefined): Promise<Mark> {
    try {
      if (asset)
        return {
          priceUsd: asset.priceUsd == null ? null : String(asset.priceUsd),
          source: asset.priceSource,
          observedAt: asset.observedAt,
          liquidityUsd: asset.liquidityUsd,
          underlying: asset.underlying,
          sector: asset.sector,
        };
      if (key.startsWith("hyperliquid-spot:")) {
        const symbol = key.slice("hyperliquid-spot:".length).replace(/\/USDC$/, "");
        const quote = await this.marks.hyperliquidSpot?.(symbol);
        return {
          priceUsd: quote ? String(quote.price) : null,
          source: "hyperliquid-spot",
          observedAt: quote?.observedAt ?? null,
          underlying: symbol,
          sector: "Crypto",
        };
      }
      if (key.startsWith("binance:")) {
        const symbol = key.slice(8);
        const quote = await this.marks.cryptoSpot(symbol);
        return {
          priceUsd: quote ? String(quote.price) : null,
          source: "binance",
          observedAt: quote?.observedAt ?? null,
          underlying: symbol.replace(/USDT$|USDC$/, ""),
          sector: "Crypto",
        };
      }
      if (key.startsWith("hyperliquid:")) {
        const symbol = key.slice(12);
        const quote = await this.marks.perpetual(symbol);
        return {
          priceUsd: quote ? String(quote.price) : null,
          source: "hyperliquid",
          observedAt: quote?.observedAt ?? null,
          underlying: symbol.replace(/USDT$|USDC$/, ""),
          sector: "Crypto",
        };
      }
      if (key.startsWith("prediction:")) {
        const [, marketId, outcome] = key.split(":");
        const quote = marketId
          ? await this.marks.prediction(marketId, outcome === "no" ? "no" : "yes")
          : null;
        return {
          priceUsd: quote ? String(quote.price) : null,
          source: "panta-prediction",
          observedAt: quote?.observedAt ?? null,
          underlying: `prediction:${marketId}`,
          sector: "Prediction markets",
        };
      }
    } catch {
      // Unpriced positions stay visible with an explicit reason.
    }
    return { priceUsd: null, source: "unavailable", observedAt: null };
  }

  async view(subject: string, mode: "paper" | "live", wallets: readonly string[] = []) {
    const [rawFills, preferences, paperAccounts, runnable] = await Promise.all([
      listPortfolioFills(this.databaseUrl, subject),
      getRiskPreferences(this.databaseUrl, subject),
      mode === "paper" ? getPaperAccounts(this.databaseUrl, subject) : Promise.resolve(null),
      listRunnableAgents(this.databaseUrl).catch(() => []),
    ]);
    const { fills, marks } = await this.enrich(rawFills.filter((fill) => fill.mode === mode));
    const positions = buildPositions(fills);

    // Agent books carry their own simulated or allocated cash.
    const ownAgents = runnable.filter((agent) => agent.manifest.ownerSubject === subject);
    const agentStates = await Promise.all(
      ownAgents.map((agent) =>
        getAgentRuntimeState(this.databaseUrl, agent.manifest.id, agent.manifest.version).catch(
          () => null,
        ),
      ),
    );
    const agentCash = agentStates.reduce(
      (sum, state) => sum + (state && mode === "paper" ? state.cashUsd : 0),
      0,
    );

    let cashUsd = 0;
    const cashBreakdown: Array<{ account: string; cashUsd: number; source: string }> = [];
    let reconciliation: ReconciliationView | null = null;

    if (mode === "paper" && paperAccounts && !paperAccounts.solana) {
      // The stock paper account opens with $10,000 on first use; show it before the first trade.
      cashUsd += 10_000;
      cashBreakdown.push({
        account: "Solana stocks (opens on first trade)",
        cashUsd: 10_000,
        source: "paper-ledger",
      });
    }
    if (mode === "paper" && paperAccounts) {
      for (const [account, state] of [
        ["Solana stocks", paperAccounts.solana],
        ["Spot & perpetuals", paperAccounts.market],
        ["Predictions", paperAccounts.prediction],
      ] as const)
        if (state) {
          cashUsd += Number(state.cashUsd);
          cashBreakdown.push({ account, cashUsd: Number(state.cashUsd), source: "paper-ledger" });
        }
      if (agentCash)
        cashBreakdown.push({
          account: "Agent paper books",
          cashUsd: agentCash,
          source: "agent-runtime",
        });
      cashUsd += agentCash;
    }

    if (mode === "live") {
      const known = await listLiveWallets(this.databaseUrl, subject).catch(() => []);
      const addresses = [...new Set([...known, ...wallets])].slice(0, 6);
      const observed = await Promise.all(
        addresses.map(async (address) => {
          try {
            return { address, wallet: await this.helius.getWallet(address) };
          } catch {
            return { address, wallet: null };
          }
        }),
      );
      const observedByMint = new Map<string, number>();
      const walletRows: ReconciliationView["wallets"] = [];
      for (const { address, wallet } of observed) {
        if (!wallet) {
          walletRows.push({ address, status: "unavailable", usdc: null });
          continue;
        }
        let usdc = 0;
        for (const holding of wallet.holdings) {
          const quantity = Number(holding.rawBalance) / 10 ** holding.decimals;
          if (holding.mint === USDC_MINT) usdc += quantity;
          else observedByMint.set(holding.mint, (observedByMint.get(holding.mint) ?? 0) + quantity);
        }
        cashUsd += usdc;
        walletRows.push({ address, status: "live", usdc });
        cashBreakdown.push({
          account: `${address.slice(0, 4)}…${address.slice(-4)} USDC`,
          cashUsd: usdc,
          source: "onchain",
        });
      }
      const ledgerByMint = new Map<string, { quantity: number; symbol: string }>();
      for (const position of positions)
        if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(position.instrumentKey))
          ledgerByMint.set(position.instrumentKey, {
            quantity:
              (ledgerByMint.get(position.instrumentKey)?.quantity ?? 0) + Number(position.quantity),
            symbol: position.symbol,
          });
      const breaks: ReconciliationView["breaks"] = [];
      for (const [mint, ledger] of ledgerByMint) {
        const onchain = observedByMint.get(mint) ?? 0;
        const difference = onchain - ledger.quantity;
        if (Math.abs(difference) > Math.max(1e-6, Math.abs(ledger.quantity) * 1e-6))
          breaks.push({
            symbol: ledger.symbol,
            mint,
            ledgerQuantity: ledger.quantity,
            observedQuantity: onchain,
            difference,
          });
      }
      const assets = await this.catalog.list();
      const assetByMint = new Map(assets.map((asset) => [asset.mint, asset]));
      const observedOnly = [...observedByMint.entries()]
        .filter(([mint]) => !ledgerByMint.has(mint) && assetByMint.has(mint))
        .map(([mint, quantity]) => {
          const asset = assetByMint.get(mint);
          return {
            symbol: asset?.symbol ?? mint.slice(0, 6),
            mint,
            quantity,
            valueUsd: asset?.priceUsd != null ? asset.priceUsd * quantity : null,
          };
        });
      const unnormalized = await countUnnormalizedLiveSwaps(this.databaseUrl, subject).catch(
        () => 0,
      );
      reconciliation = {
        status: !walletRows.some((row) => row.status === "live")
          ? "unavailable"
          : breaks.length
            ? "breaks"
            : observedOnly.length
              ? "observed_only"
              : "reconciled",
        wallets: walletRows,
        breaks,
        observedOnly,
        unnormalizedLiveSwaps: unnormalized,
      };
    }

    const { positions: valued, summary } = valuePositions(positions, marks, cashUsd);
    const mandateLimits: MandateLimits = {
      ...DEFAULT_MANDATE,
      ...(preferences.mandate as Partial<MandateLimits>),
    };
    const catalogAssets = await this.catalog.list();
    const changes = new Map(catalogAssets.map((asset) => [asset.mint, asset.change24hPct]));
    const images = new Map(catalogAssets.map((asset) => [asset.mint, asset.imageUrl]));
    // Prediction positions are keyed by market address; show them by their question instead.
    const predictionIds = [
      ...new Set(
        valued
          .filter((position) => position.instrumentKey.startsWith("prediction:"))
          .map((position) => position.instrumentKey.split(":")[1] ?? ""),
      ),
    ].filter(Boolean);
    const predictionInfo = new Map(
      await Promise.all(
        predictionIds.map(
          async (id) => [id, await this.marks.predictionInfo?.(id).catch(() => null)] as const,
        ),
      ),
    );
    const dailyPnlUsd = valued.reduce((sum, position) => {
      const change = changes.get(position.instrumentKey) ?? null;
      const value = Number(position.marketValueUsd ?? 0);
      return change == null ? sum : sum + value * (change / (100 + change));
    }, 0);
    const worstLiquidity = summary.liquidityRisk[0];
    const topUnderlying = summary.byUnderlying[0];
    const mandate = evaluateMandate(
      {
        grossExposureUsd: summary.grossExposureUsd,
        largestWeightPct: summary.concentration.largestWeightPct,
        largestSymbol: summary.concentration.largestSymbol,
        largestUnderlyingWeightPct: topUnderlying?.weightPct ?? 0,
        largestUnderlying: topUnderlying?.key ?? null,
        dailyPnlUsd,
        agentTokenWeightPct:
          summary.byAssetClass.find((row) => row.key === "agent_token")?.weightPct ?? 0,
        worstExitLiquidityPct: worstLiquidity?.exitLiquidityPct ?? null,
        worstExitSymbol: worstLiquidity?.symbol ?? null,
      },
      mandateLimits,
    );
    const agentAllocations = ownAgents.map((agent, index) => {
      const state = agentStates[index];
      const policy = agent.manifest.policy as { capitalAllocation?: { maxCapitalUsd?: number } };
      const book = `agent:${agent.manifest.id}`;
      const bookPositions = valued.filter((position) => position.book === book);
      const positionsValue = bookPositions.reduce(
        (sum, position) => sum + Number(position.marketValueUsd ?? 0),
        0,
      );
      const capital = policy.capitalAllocation?.maxCapitalUsd ?? 0;
      return {
        agentId: agent.manifest.id,
        name: agent.manifest.name,
        stage: agent.state.stage,
        autonomy: agent.state.autonomy,
        capitalCapUsd: capital,
        cashUsd: state?.cashUsd ?? null,
        positionsValueUsd: positionsValue,
        equityUsd: state ? state.cashUsd + positionsValue : null,
        pnlUsd: state
          ? state.cashUsd +
            positionsValue -
            (agent.state.stage === "limited_live" ? capital * 0.1 : capital)
          : null,
      };
    });
    return {
      mode,
      summary,
      // Logos for Solana assets come from the catalog; the app draws venue icons for the rest.
      positions: valued.map((position) => {
        const [, marketId, outcome] = position.instrumentKey.split(":");
        const prediction = position.instrumentKey.startsWith("prediction:")
          ? predictionInfo.get(marketId ?? "")
          : null;
        const isResolved = prediction?.status === "resolved";
        const isWinner =
          isResolved &&
          prediction?.winnerOutcome != null &&
          prediction.winnerOutcome === (outcome === "no" ? "no" : "yes");
        return {
          ...position,
          imageUrl: prediction?.imageUrl ?? images.get(position.instrumentKey) ?? null,
          ...(position.instrumentKey.startsWith("prediction:")
            ? {
                title: prediction?.title ?? null,
                marketId: marketId ?? null,
                outcome: outcome === "no" ? "no" : "yes",
                status: prediction?.status ?? null,
                phase: prediction?.phase ?? null,
                claimable: isWinner && Number(position.quantity) > 0,
                winnerOutcome: prediction?.winnerOutcome ?? null,
              }
            : {}),
        };
      }),
      cash: cashBreakdown,
      mandate,
      mandateLimits,
      dailyPnlUsd,
      scenarios: STANDARD_SCENARIOS.map((scenario) => runScenario(valued, summary, scenario)),
      agentAllocations,
      reconciliation,
      fillCount: fills.length,
      observedAt: new Date().toISOString(),
      notes: [
        "Positions are rebuilt from Sisera's fill ledger with average-cost accounting.",
        mode === "live"
          ? "Live balances are observed onchain and compared with the ledger; differences are listed as breaks."
          : "Paper balances are simulated and never represent real funds.",
        "Daily P&L is estimated from each position's 24h mark change.",
      ],
    };
  }

  async impact(
    subject: string,
    mode: "paper" | "live",
    trade: { asset: CatalogAsset; side: "buy" | "sell"; notionalUsd: number },
    wallets: readonly string[] = [],
  ) {
    const view = await this.view(subject, mode, wallets);
    const impact = simulateTrade(
      view.positions,
      view.summary,
      {
        instrumentKey: trade.asset.mint,
        symbol: trade.asset.symbol,
        assetClass: ASSET_CLASS_BY_KIND[trade.asset.kind],
        side: trade.side,
        notionalUsd: trade.notionalUsd,
        underlying: trade.asset.underlying,
        sector: trade.asset.sector,
        liquidityUsd: trade.asset.liquidityUsd,
      },
      {
        maxPositionWeightPct: view.mandateLimits.maxPositionWeightPct,
        maxUnderlyingWeightPct: view.mandateLimits.maxUnderlyingWeightPct,
        maxLiquidityUsagePct: 2,
        minCashUsd: 0,
      },
    );
    const sectorBefore =
      view.summary.bySector.find((row) => row.key === trade.asset.sector)?.weightPct ?? 0;
    const signed = trade.side === "buy" ? trade.notionalUsd : -trade.notionalUsd;
    return {
      asset: {
        key: trade.asset.key,
        symbol: trade.asset.symbol,
        name: trade.asset.name,
        kind: trade.asset.kind,
        sector: trade.asset.sector,
        underlying: trade.asset.underlying,
      },
      trade: { side: trade.side, notionalUsd: trade.notionalUsd, mode },
      impact,
      sector: {
        name: trade.asset.sector,
        beforePct: sectorBefore,
        afterPct:
          view.summary.navUsd > 0 ? sectorBefore + (signed / view.summary.navUsd) * 100 : 100,
      },
      navUsd: view.summary.navUsd,
      observedAt: view.observedAt,
    };
  }
}
