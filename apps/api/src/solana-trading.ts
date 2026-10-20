import { createPublicKey, verify } from "node:crypto";
import { PrivyClient } from "@privy-io/server-auth";
import {
  applySolanaPaperTrade,
  claimSolanaSwapOrder,
  finishSolanaSwapOrder,
  saveSolanaSwapOrder,
} from "@sisera/db";
import { type Instrument, MarketSnapshot, OrderIntent } from "@sisera/domain";
import type { PreStocksProvider } from "@sisera/market-data";
import { applyOrderEvent, createOrderRecord } from "@sisera/oms";
import { evaluatePreTradeRisk } from "@sisera/risk";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import Decimal from "decimal.js";
import type { ApiConfig } from "./config.js";
import type { HeliusClient } from "./helius.js";
import type { JupiterQuoteClient } from "./jupiter.js";
import type { XStocksClient } from "./xstocks.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MAX_USD = "500";
/** Jupiter sponsors network fees for wallets holding less than this much SOL. */
export const GASLESS_SOL_THRESHOLD = 10_000_000n;
/** A paper trade may use the whole simulated account. */
const MAX_PAPER_USD = 10_000;

/** Resolves Solana tokens outside the xStocks and PreStocks catalogues, such as agent tokens. */
export type TokenResolver = (
  mint: string,
) => Promise<{ symbol: string; priceUsd: number | null; kind: "agent_token" } | null>;

export class TradeRejection extends Error {
  constructor(
    message: string,
    readonly statusCode = 422,
    /** A machine-readable reason clients can act on, such as a missing approval. */
    readonly code = "trade_unavailable",
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function verifySignedSwap(unsignedBase64: string, signedBase64: string, wallet: string) {
  const unsigned = VersionedTransaction.deserialize(Buffer.from(unsignedBase64, "base64"));
  const signed = VersionedTransaction.deserialize(Buffer.from(signedBase64, "base64"));
  const message = Buffer.from(unsigned.message.serialize());
  if (!message.equals(Buffer.from(signed.message.serialize())))
    throw new TradeRejection("The trade changed after approval.");
  const signer = new PublicKey(wallet);
  const signerIndex = signed.message.staticAccountKeys.findIndex((key) => key.equals(signer));
  if (signerIndex < 0 || signerIndex >= signed.message.header.numRequiredSignatures)
    throw new TradeRejection("The selected wallet did not sign this trade.");
  const signature = signed.signatures[signerIndex];
  if (!signature) throw new TradeRejection("The wallet signature is missing.");
  const key = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(signer.toBytes()),
    ]),
    format: "der",
    type: "spki",
  });
  if (!verify(null, message, key, Buffer.from(signature)))
    throw new TradeRejection("The wallet signature is invalid.");
}

export class SolanaTradingService {
  private readonly privy: PrivyClient | null;
  private readonly developmentPaperAccounts = new Map<
    string,
    { cashUsd: string; holdings: Record<string, string> }
  >();

  constructor(
    private readonly config: ApiConfig,
    private readonly xstocks: XStocksClient,
    private readonly prestocks: PreStocksProvider,
    private readonly helius: HeliusClient | null,
    private readonly jupiter: JupiterQuoteClient | null,
    private readonly resolveToken: TokenResolver = async () => null,
  ) {
    this.privy =
      config.PRIVY_APP_ID && config.PRIVY_APP_SECRET
        ? new PrivyClient(config.PRIVY_APP_ID, config.PRIVY_APP_SECRET)
        : null;
  }

  async paper(input: {
    subject: string;
    tenantId: string;
    mint: string;
    side: "buy" | "sell";
    amount: string;
    book?: string;
    /** A fresher executable price supplied by the caller, e.g. a live Jupiter price. */
    priceUsd?: string | null;
  }) {
    const [publicStocks, privateStocks] = await Promise.all([
      this.xstocks.list(),
      this.prestocks.list(),
    ]);
    const publicStock = publicStocks.find((asset) => asset.mint === input.mint);
    const privateStock = privateStocks.find((asset) => asset.instrument.mint === input.mint);
    const agentToken =
      publicStock || privateStock ? null : await this.resolveToken(input.mint).catch(() => null);
    const priceText =
      input.priceUsd ??
      publicStock?.priceUsd ??
      publicStock?.dexPriceUsd ??
      privateStock?.tokenPrice ??
      (agentToken?.priceUsd != null ? String(agentToken.priceUsd) : null);
    if (!priceText || !(Number(priceText) > 0) || publicStock?.tradingHalted)
      throw new TradeRejection("A price is not available for this asset.");
    const price = new Decimal(priceText);
    const amount = new Decimal(input.amount);
    const quantity = input.side === "buy" ? amount.div(price) : amount;
    const cost = quantity.mul(price);
    if (amount.lte(0) || cost.gt(MAX_PAPER_USD))
      throw new TradeRejection("Paper trades are limited to $10,000 each.");
    const instrumentId = publicStock
      ? `xstocks-solana:${input.mint}:tokenized_equity`
      : privateStock
        ? `prestocks-solana:${input.mint}:pre_ipo_equity`
        : `clawpump-solana:${input.mint}:agent_token`;
    const instrument: Instrument = {
      id: instrumentId,
      venue: publicStock ? "xstocks-solana" : privateStock ? "prestocks-solana" : "clawpump-solana",
      venueSymbol: input.mint,
      displaySymbol:
        publicStock?.symbol ??
        privateStock?.instrument.displaySymbol ??
        agentToken?.symbol ??
        "Token",
      assetClass: agentToken ? "crypto" : "equity",
      type: publicStock ? "tokenized_equity" : privateStock ? "pre_ipo_equity" : "agent_token",
      baseAsset:
        publicStock?.symbol ?? privateStock?.instrument.baseAsset ?? agentToken?.symbol ?? "TOKEN",
      quoteAsset: "USD",
      priceIncrement: "0.000001",
      quantityIncrement: "0.000001",
      contractMultiplier: "1",
      status: "active",
      chain: "solana",
      mint: input.mint,
    };
    const now = new Date().toISOString();
    const order = OrderIntent.parse({
      clientOrderId: crypto.randomUUID(),
      portfolioId: `paper:${input.subject}`,
      accountId: `paper:${input.subject}`,
      instrumentId,
      side: input.side,
      type: "market",
      quantity: quantity.toFixed(),
      timeInForce: "ioc",
      reduceOnly: false,
      mode: "paper",
      submittedBy: input.subject,
      correlationId: crypto.randomUUID(),
    });
    const snapshot = MarketSnapshot.parse({
      instrumentId,
      bid: price.toFixed(),
      ask: price.toFixed(),
      last: price.toFixed(),
      quality: {
        status: "delayed",
        source: input.priceUsd
          ? "live-price"
          : publicStock
            ? "xstocks-indicative"
            : privateStock
              ? "prestocks-indicative"
              : "clawpump-indicative",
        observedAt: now,
        receivedAt: now,
        latencyMs: 0,
      },
    });
    const decision = evaluatePreTradeRisk({
      order,
      instrument,
      quote: snapshot,
      portfolio: {
        nav: "10000",
        grossExposure: "0",
        netExposure: "0",
        dailyPnl: "0",
        existingInstrumentExposure: "0",
      },
      limits: {
        maxOrderNotional: String(MAX_PAPER_USD),
        maxGrossExposure: "10000",
        maxNetExposure: "10000",
        maxPositionNotional: "10000",
        maxDailyLoss: "10000",
        maxLeverage: "1",
        maxQuoteAgeMs: 15000,
        allowedAssetClasses: ["equity", "crypto"],
      },
    });
    if (decision.outcome !== "approved")
      throw new TradeRejection("This paper trade exceeds the current limits.");
    const orderId = crypto.randomUUID();
    const update = (state: { cashUsd: string; holdings: Record<string, string> }) => {
      const cash = new Decimal(state.cashUsd);
      const held = new Decimal(state.holdings[input.mint] ?? "0");
      if (input.side === "buy" && cash.lt(cost))
        throw new TradeRejection("Not enough paper cash for this trade.");
      if (input.side === "sell" && held.lt(quantity))
        throw new TradeRejection("Not enough paper shares to sell.");
      const nextHolding = input.side === "buy" ? held.plus(quantity) : held.minus(quantity);
      return {
        cashUsd: (input.side === "buy" ? cash.minus(cost) : cash.plus(cost)).toFixed(),
        holdings: { ...state.holdings, [input.mint]: nextHolding.toFixed() },
      };
    };
    const record = {
      id: orderId,
      tenantId: input.tenantId,
      subject: input.subject,
      wallet: `paper:${input.subject}`,
      inputMint: input.side === "buy" ? USDC : input.mint,
      outputMint: input.side === "buy" ? input.mint : USDC,
      inAmount: input.amount,
      outAmount: input.side === "buy" ? quantity.toFixed() : cost.toFixed(),
      riskDecision: decision,
      mode: "paper",
      status: "paper_filled",
      book: input.book ?? "manual",
      arrivalPriceUsd: price.toFixed(),
    } as const;
    const account = this.config.DATABASE_URL
      ? await applySolanaPaperTrade(this.config.DATABASE_URL, input.subject, record, update)
      : (() => {
          if (this.config.NODE_ENV === "production")
            throw new TradeRejection("Paper trading is temporarily unavailable.", 503);
          const next = update(
            this.developmentPaperAccounts.get(input.subject) ?? { cashUsd: "10000", holdings: {} },
          );
          this.developmentPaperAccounts.set(input.subject, next);
          return next;
        })();
    return {
      orderId,
      status: "paper_filled",
      filledQuantity: quantity.toFixed(),
      fillPrice: price.toFixed(),
      cashUsd: account.cashUsd,
      holdings: account.holdings,
      source: snapshot.quality.source,
    };
  }

  async prepare(input: {
    subject: string;
    tenantId: string;
    wallet: string;
    mint: string;
    side: "buy" | "sell";
    amount: string;
    book?: string;
    slippageBps?: number;
    arrivalPriceUsd?: number | null;
    maxNotionalUsd?: number;
  }) {
    if (!this.config.DATABASE_URL || !this.helius || !this.jupiter || !this.privy)
      throw new TradeRejection("Live trading is not available right now.", 503);
    const owner = await this.privy.getUserByWalletAddress(input.wallet);
    if (!owner || `privy:${owner.id}` !== input.subject)
      throw new TradeRejection("Connect this wallet to your Sisera account first.", 403);
    const [publicStocks, privateStocks] = await Promise.all([
      this.xstocks.list(),
      this.prestocks.list(),
    ]);
    const publicStock = publicStocks.find((asset) => asset.mint === input.mint);
    const privateStock = privateStocks.find((asset) => asset.instrument.mint === input.mint);
    const agentToken =
      publicStock || privateStock ? null : await this.resolveToken(input.mint).catch(() => null);
    if ((!publicStock && !privateStock && !agentToken) || publicStock?.tradingHalted)
      throw new TradeRejection("This asset is not available to trade.");
    const inputMint = input.side === "buy" ? USDC : input.mint;
    const outputMint = input.side === "buy" ? input.mint : USDC;
    const [inputHolding, solLamports, outputHolding, usdcHolding] = await Promise.all([
      this.helius.getTokenBalance(input.wallet, inputMint),
      this.helius.getSolLamports(input.wallet),
      this.helius.getTokenBalance(input.wallet, outputMint),
      input.side === "buy" ? null : this.helius.getTokenBalance(input.wallet, USDC),
    ]);
    if (BigInt(inputHolding.rawBalance) < BigInt(input.amount))
      throw new TradeRejection("Your wallet does not have enough balance for this trade.");
    if (BigInt(solLamports) < 1_000_000n)
      throw new TradeRejection("Add a little SOL to your wallet for network fees.");
    // Jupiter only sponsors gas without a referral fee, so wallets that need gasless pay none.
    const referral =
      this.config.SISERA_JUPITER_REFERRAL_ACCOUNT &&
      this.config.SISERA_JUPITER_TRADE_FEE_BPS > 0 &&
      BigInt(solLamports) >= GASLESS_SOL_THRESHOLD
        ? {
            account: this.config.SISERA_JUPITER_REFERRAL_ACCOUNT,
            feeBps: this.config.SISERA_JUPITER_TRADE_FEE_BPS,
          }
        : undefined;
    const quote = await this.jupiter.order(
      inputMint,
      outputMint,
      input.amount,
      input.wallet,
      input.slippageBps ?? 100,
      referral,
    );
    if (
      quote.inputMint !== inputMint ||
      quote.outputMint !== outputMint ||
      quote.inAmount !== input.amount
    )
      throw new TradeRejection("The trade quote did not match your request.");
    const notional =
      input.side === "buy"
        ? new Decimal(quote.inAmount).div(1_000_000)
        : new Decimal(quote.outAmount).div(1_000_000);
    const maxNotional = new Decimal(
      Math.min(Number(MAX_USD), input.maxNotionalUsd ?? Number(MAX_USD)),
    );
    if (notional.lte(0) || notional.gt(maxNotional))
      throw new TradeRejection(`Trades are currently limited to $${maxNotional.toFixed(0)} each.`);
    if (quote.priceImpactPct && new Decimal(quote.priceImpactPct).abs().gt("0.02"))
      throw new TradeRejection("The price impact is too high. Try a smaller trade.");
    const quantity =
      input.side === "buy"
        ? new Decimal(quote.outAmount).div(new Decimal(10).pow(outputHolding.decimals))
        : new Decimal(input.amount).div(new Decimal(10).pow(inputHolding.decimals));
    if (quantity.lte(0)) throw new TradeRejection("The trade quote is too small.");
    const unitPrice = notional.div(quantity);
    const instrument: Instrument = {
      id: publicStock
        ? `xstocks-solana:${input.mint}:tokenized_equity`
        : privateStock
          ? `prestocks-solana:${input.mint}:pre_ipo_equity`
          : `clawpump-solana:${input.mint}:agent_token`,
      venue: publicStock ? "xstocks-solana" : privateStock ? "prestocks-solana" : "clawpump-solana",
      venueSymbol: input.mint,
      displaySymbol:
        publicStock?.symbol ??
        privateStock?.instrument.displaySymbol ??
        agentToken?.symbol ??
        "Token",
      assetClass: agentToken ? "crypto" : "equity",
      type: publicStock ? "tokenized_equity" : privateStock ? "pre_ipo_equity" : "agent_token",
      baseAsset:
        publicStock?.symbol ?? privateStock?.instrument.baseAsset ?? agentToken?.symbol ?? "TOKEN",
      quoteAsset: "USDC",
      priceIncrement: "0.000001",
      quantityIncrement: "0.000001",
      contractMultiplier: "1",
      status: "active",
      chain: "solana",
      mint: input.mint,
    };
    const now = new Date().toISOString();
    const marketQuote = MarketSnapshot.parse({
      instrumentId: instrument.id,
      bid: unitPrice.toFixed(),
      ask: unitPrice.toFixed(),
      last: unitPrice.toFixed(),
      quality: {
        status: "live",
        source: "jupiter-order",
        observedAt: now,
        receivedAt: now,
        latencyMs: 0,
      },
    });
    const intent = OrderIntent.parse({
      clientOrderId: crypto.randomUUID(),
      portfolioId: `wallet:${input.wallet}`,
      accountId: input.wallet,
      instrumentId: instrument.id,
      side: input.side,
      type: "market",
      quantity: quantity.toFixed(),
      timeInForce: "ioc",
      reduceOnly: false,
      mode: "live",
      submittedBy: input.subject,
      correlationId: crypto.randomUUID(),
    });
    const riskDecision = evaluatePreTradeRisk({
      order: intent,
      instrument,
      quote: marketQuote,
      portfolio: {
        nav: Decimal.max(
          notional,
          new Decimal((input.side === "buy" ? inputHolding : usdcHolding)?.rawBalance ?? "0").div(
            1_000_000,
          ),
        ).toFixed(),
        grossExposure: "0",
        netExposure: "0",
        dailyPnl: "0",
        existingInstrumentExposure: input.side === "sell" ? notional.toFixed() : "0",
      },
      limits: {
        maxOrderNotional: MAX_USD,
        maxGrossExposure: MAX_USD,
        maxNetExposure: MAX_USD,
        maxPositionNotional: MAX_USD,
        maxDailyLoss: MAX_USD,
        maxLeverage: "1",
        maxQuoteAgeMs: 15_000,
        allowedAssetClasses: ["equity", "crypto"],
      },
    });
    const record = applyOrderEvent(createOrderRecord(crypto.randomUUID(), intent), {
      type: "risk_evaluated",
      decision: riskDecision,
      at: riskDecision.checkedAt,
    });
    if (riskDecision.outcome !== "approved")
      throw new TradeRejection("This trade exceeds your current risk limits.");
    await saveSolanaSwapOrder(this.config.DATABASE_URL, {
      id: record.orderId,
      tenantId: input.tenantId,
      subject: input.subject,
      wallet: input.wallet,
      inputMint,
      outputMint,
      inAmount: quote.inAmount,
      outAmount: quote.outAmount,
      requestId: quote.requestId,
      unsignedTransaction: quote.transaction,
      riskDecision,
      mode: "live",
      status: "prepared",
      expiresAt: new Date(Date.now() + 45_000),
      tokenDecimals: input.side === "buy" ? outputHolding.decimals : inputHolding.decimals,
      book: input.book ?? "manual",
      arrivalPriceUsd:
        input.arrivalPriceUsd != null ? String(input.arrivalPriceUsd) : unitPrice.toFixed(),
    });
    return {
      orderId: record.orderId,
      transaction: quote.transaction,
      wallet: input.wallet,
      inputMint,
      outputMint,
      inAmount: quote.inAmount,
      outAmount: quote.outAmount,
      outputDecimals: outputHolding.decimals,
      priceImpactPct: quote.priceImpactPct ?? null,
      expiresAt: new Date(Date.now() + 45_000).toISOString(),
    };
  }

  async execute(id: string, subject: string, signedTransaction: string) {
    if (!this.config.DATABASE_URL || !this.jupiter)
      throw new TradeRejection("Live trading is not available right now.", 503);
    const order = await claimSolanaSwapOrder(this.config.DATABASE_URL, id, subject);
    if (!order || !order.unsignedTransaction || !order.requestId)
      throw new TradeRejection("This trade has expired. Review a new quote.");
    try {
      verifySignedSwap(order.unsignedTransaction, signedTransaction, order.wallet);
    } catch (error) {
      await finishSolanaSwapOrder(this.config.DATABASE_URL, id, "failed");
      throw error;
    }
    try {
      const result = await this.jupiter.execute(signedTransaction, order.requestId);
      await finishSolanaSwapOrder(
        this.config.DATABASE_URL,
        id,
        result.status === "Success" ? "confirmed" : "failed",
        result.signature,
      );
      return {
        status: result.status === "Success" ? "confirmed" : "failed",
        signature: result.signature ?? null,
      };
    } catch {
      await finishSolanaSwapOrder(this.config.DATABASE_URL, id, "unknown");
      return { status: "unknown", signature: null };
    }
  }

  /**
   * Executes a prepared order with a server-side signer that the wallet owner delegated to Sisera.
   * The signer is only ever given the exact transaction that passed risk checks, and the signed
   * bytes are verified against it before submission.
   */
  async executeWithSigner(
    id: string,
    subject: string,
    sign: (unsignedTransaction: string, wallet: string) => Promise<string>,
  ) {
    if (!this.config.DATABASE_URL || !this.jupiter)
      throw new TradeRejection("Live trading is not available right now.", 503);
    const order = await claimSolanaSwapOrder(this.config.DATABASE_URL, id, subject);
    if (!order || !order.unsignedTransaction || !order.requestId)
      throw new TradeRejection("This trade has expired. Review a new quote.");
    let signedTransaction: string;
    try {
      signedTransaction = await sign(order.unsignedTransaction, order.wallet);
      verifySignedSwap(order.unsignedTransaction, signedTransaction, order.wallet);
    } catch (error) {
      await finishSolanaSwapOrder(this.config.DATABASE_URL, id, "failed");
      throw error instanceof TradeRejection
        ? error
        : new TradeRejection("The delegated signer did not sign this trade.", 503);
    }
    try {
      const result = await this.jupiter.execute(signedTransaction, order.requestId);
      const status = result.status === "Success" ? "confirmed" : "failed";
      await finishSolanaSwapOrder(this.config.DATABASE_URL, id, status, result.signature);
      return { status, signature: result.signature ?? null };
    } catch {
      await finishSolanaSwapOrder(this.config.DATABASE_URL, id, "unknown");
      return { status: "unknown", signature: null };
    }
  }
}
