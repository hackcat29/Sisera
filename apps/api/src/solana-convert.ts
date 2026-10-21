import { saveSolanaSwapOrder } from "@sisera/db";
import { type Instrument, MarketSnapshot, OrderIntent } from "@sisera/domain";
import { applyOrderEvent, createOrderRecord } from "@sisera/oms";
import { evaluatePreTradeRisk } from "@sisera/risk";
import Decimal from "decimal.js";
import type { HeliusClient } from "./helius.js";
import {
  JupiterOrderError,
  type JupiterQuoteClient,
  priceImpactFraction,
  swapFailure,
} from "./jupiter.js";
import { GASLESS_SOL_THRESHOLD, TradeRejection } from "./solana-trading.js";

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";
/** SOL kept back when converting SOL itself, so the wallet can still pay for later transactions. */
export const SOL_FEE_RESERVE_LAMPORTS = 10_000_000n;
/** Conversions are recorded in this book, which the portfolio excludes from trading positions. */
export const CONVERT_BOOK = "convert";
const MAX_PRICE_IMPACT = 0.02;
const ORDER_TTL_MS = 45_000;

/**
 * Returns the catalog kind for mints Sisera tracks as trading positions (tokenized stocks,
 * pre-IPO tokens, agent tokens), or null for anything else. Those positions are closed from their
 * own trade ticket so the book stays consistent.
 */
export type TrackedAssetLookup = (mint: string) => Promise<string | null>;

/**
 * Converts any Solana token with Jupiter liquidity into USDC in the user's own wallet.
 *
 * Users fund Sisera with whatever they hold (SOL, USDT, JUP, memecoins), but every Sisera market
 * settles in USDC. Jupiter's Swap API routes across every Solana DEX and RFQ maker, and sponsors
 * network fees when the wallet has almost no SOL, which is the usual case for a wallet that was
 * funded with a single non-USDC token.
 */
export class SolanaConvertService {
  constructor(
    private readonly options: {
      databaseUrl: string | undefined;
      helius: HeliusClient | null;
      jupiter: JupiterQuoteClient | null;
      trackedAsset: TrackedAssetLookup;
      maxNotionalUsd: number;
      /** Sisera's Jupiter platform fee on conversions, when a referral account is configured. */
      referral?: { account: string; feeBps: number } | undefined;
    },
  ) {}

  private async solBalance(wallet: string) {
    const lamports = await this.options.helius?.getSolLamports(wallet).catch(() => "0");
    return BigInt(lamports ?? "0");
  }

  async prepare(input: {
    subject: string;
    tenantId: string;
    wallet: string;
    inputMint: string;
    amount: string;
    slippageBps?: number | undefined;
  }) {
    const { databaseUrl, helius, jupiter } = this.options;
    if (!databaseUrl || !helius || !jupiter)
      throw new TradeRejection("Swaps are not available right now.", 503);
    if (input.inputMint === USDC_MINT) throw new TradeRejection("This balance is already USDC.");
    const tracked = await this.options.trackedAsset(input.inputMint).catch(() => {
      throw new TradeRejection("Swaps are not available right now. Try again shortly.", 503);
    });
    if (tracked)
      throw new TradeRejection(
        "This asset is part of your Sisera portfolio. Sell it from its market page instead.",
      );

    const amount = BigInt(input.amount);
    const native = input.inputMint === NATIVE_SOL_MINT;
    const holding = native
      ? { rawBalance: await helius.getSolLamports(input.wallet), decimals: 9 }
      : await helius.getTokenBalance(input.wallet, input.inputMint);
    const spendable = native
      ? BigInt(holding.rawBalance) - SOL_FEE_RESERVE_LAMPORTS
      : BigInt(holding.rawBalance);
    if (amount <= 0n || amount > spendable)
      throw new TradeRejection(
        native
          ? "Not enough SOL. Sisera keeps 0.01 SOL in your wallet for network fees."
          : "Your wallet does not have enough of this token.",
      );

    // Jupiter only sponsors gas without a referral fee, so wallets that need gasless pay none.
    const referral =
      this.options.referral &&
      (native ? BigInt(holding.rawBalance) : await this.solBalance(input.wallet)) >=
        GASLESS_SOL_THRESHOLD
        ? this.options.referral
        : undefined;
    let order: Awaited<ReturnType<JupiterQuoteClient["order"]>>;
    try {
      order = await jupiter.order(
        input.inputMint,
        USDC_MINT,
        input.amount,
        input.wallet,
        input.slippageBps,
        referral,
      );
    } catch (error) {
      if (error instanceof JupiterOrderError) {
        if (error.belowGaslessMinimum)
          throw new TradeRejection(
            "This swap is too small to cover network fees. Add a little SOL or swap a larger amount.",
          );
        if (error.insufficientGas)
          throw new TradeRejection("Add a little SOL to your wallet for network fees.");
        if (error.insufficientFunds)
          throw new TradeRejection("Your wallet does not have enough of this token.");
        throw new TradeRejection("No swap route is available for this token right now.");
      }
      const failure = swapFailure(error);
      throw new TradeRejection(failure.message, failure.noRoute ? 422 : 503);
    }
    if (
      order.inputMint !== input.inputMint ||
      order.outputMint !== USDC_MINT ||
      order.inAmount !== input.amount
    )
      throw new TradeRejection("The swap quote did not match your request.");

    const usdcOut = new Decimal(order.outAmount).div(1_000_000);
    const quantity = new Decimal(input.amount).div(new Decimal(10).pow(holding.decimals));
    if (usdcOut.lte(0) || quantity.lte(0)) throw new TradeRejection("The swap quote is too small.");
    if (usdcOut.gt(this.options.maxNotionalUsd))
      throw new TradeRejection(
        `Swaps are limited to $${this.options.maxNotionalUsd.toLocaleString("en-US")} each. Swap a smaller amount.`,
      );
    const impact = priceImpactFraction(order);
    if (impact != null && impact > MAX_PRICE_IMPACT)
      throw new TradeRejection(
        "This swap would move the price more than 2%. Try a smaller amount.",
      );

    const unitPrice = usdcOut.div(quantity);
    const instrument: Instrument = {
      id: `jupiter-solana:${input.inputMint}:spot`,
      venue: "jupiter-solana",
      venueSymbol: input.inputMint,
      displaySymbol: native ? "SOL" : input.inputMint.slice(0, 8),
      assetClass: "crypto",
      type: "spot",
      baseAsset: native ? "SOL" : input.inputMint,
      quoteAsset: "USDC",
      priceIncrement: "0.000001",
      quantityIncrement: "0.000000001",
      contractMultiplier: "1",
      status: "active",
      chain: "solana",
      mint: input.inputMint,
    };
    const now = new Date().toISOString();
    const quote = MarketSnapshot.parse({
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
      side: "sell",
      type: "market",
      quantity: quantity.toFixed(),
      timeInForce: "ioc",
      reduceOnly: true,
      mode: "live",
      submittedBy: input.subject,
      correlationId: crypto.randomUUID(),
    });
    const max = String(this.options.maxNotionalUsd);
    const riskDecision = evaluatePreTradeRisk({
      order: intent,
      instrument,
      quote,
      // Converting a held token to USDC only reduces exposure: the position it sells is the
      // balance verified above.
      portfolio: {
        nav: usdcOut.toFixed(),
        grossExposure: "0",
        netExposure: "0",
        dailyPnl: "0",
        existingInstrumentExposure: usdcOut.toFixed(),
      },
      limits: {
        maxOrderNotional: max,
        maxGrossExposure: max,
        maxNetExposure: max,
        maxPositionNotional: max,
        maxDailyLoss: max,
        maxLeverage: "1",
        maxQuoteAgeMs: 15_000,
        allowedAssetClasses: ["crypto"],
      },
    });
    const record = applyOrderEvent(createOrderRecord(crypto.randomUUID(), intent), {
      type: "risk_evaluated",
      decision: riskDecision,
      at: riskDecision.checkedAt,
    });
    if (riskDecision.outcome !== "approved")
      throw new TradeRejection("This swap exceeds your current risk limits.");

    const expiresAt = new Date(Date.now() + ORDER_TTL_MS);
    await saveSolanaSwapOrder(databaseUrl, {
      id: record.orderId,
      tenantId: input.tenantId,
      subject: input.subject,
      wallet: input.wallet,
      inputMint: input.inputMint,
      outputMint: USDC_MINT,
      inAmount: order.inAmount,
      outAmount: order.outAmount,
      requestId: order.requestId,
      unsignedTransaction: order.transaction,
      riskDecision,
      mode: "live",
      status: "prepared",
      expiresAt,
      tokenDecimals: holding.decimals,
      book: CONVERT_BOOK,
      arrivalPriceUsd: unitPrice.toFixed(),
    });
    return {
      orderId: record.orderId,
      transaction: order.transaction,
      wallet: input.wallet,
      inputMint: input.inputMint,
      inputDecimals: holding.decimals,
      inAmount: order.inAmount,
      outAmount: order.outAmount,
      minOutAmount: order.otherAmountThreshold ?? null,
      priceImpactPct: impact == null ? null : impact * 100,
      slippageBps: order.slippageBps ?? null,
      feeBps: order.feeBps ?? null,
      gasless: order.gasless,
      router: order.router,
      expiresAt: expiresAt.toISOString(),
    };
  }
}
