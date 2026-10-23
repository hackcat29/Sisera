import { PrivyClient } from "@privy-io/server-auth";
import { claimPredictionOrder, finishPredictionOrder, savePredictionOrder } from "@sisera/db";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import type { ApiConfig } from "./config.js";
import type { HeliusClient } from "./helius.js";
import { PantaPredictionTradingClient } from "./panta-prediction.js";
import { SolanaFeeCollector } from "./solana-fee.js";
import { TradeRejection, verifySignedSwap } from "./solana-trading.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export class PredictionTradingService {
  private readonly privy: PrivyClient | null;
  private readonly panta: PantaPredictionTradingClient;
  private readonly connection: Connection;
  private readonly fees: SolanaFeeCollector;

  constructor(
    private readonly config: ApiConfig,
    private readonly helius: HeliusClient,
    rpcUrl: string,
  ) {
    this.privy =
      config.PRIVY_APP_ID && config.PRIVY_APP_SECRET
        ? new PrivyClient(config.PRIVY_APP_ID, config.PRIVY_APP_SECRET)
        : null;
    this.panta = new PantaPredictionTradingClient(
      config.PANTA_API_BASE_URL,
      config.PANTA_API_KEY,
      globalThis.fetch,
      rpcUrl,
      config.PANTA_PROGRAM_ID,
    );
    this.connection = new Connection(rpcUrl, "confirmed");
    this.fees = new SolanaFeeCollector(
      this.connection,
      config.SISERA_SOLANA_FEE_ACCOUNT
        ? { feeAccount: config.SISERA_SOLANA_FEE_ACCOUNT, bps: config.SISERA_PREDICTION_FEE_BPS }
        : undefined,
    );
  }

  async prepare(input: {
    subject: string;
    tenantId: string;
    wallet: string;
    marketId: string;
    outcome: "yes" | "no";
    depositAmount: string;
  }) {
    if (!this.config.DATABASE_URL || !this.privy)
      throw new TradeRejection("Live prediction trading is not configured.", 503);
    try {
      new PublicKey(input.wallet);
    } catch {
      throw new TradeRejection("Enter a valid Solana wallet address.");
    }
    const owner = await this.privy.getUserByWalletAddress(input.wallet);
    if (!owner || `privy:${owner.id}` !== input.subject)
      throw new TradeRejection("Connect this Solana wallet to your Sisera account first.", 403);
    const deposit = BigInt(input.depositAmount);
    if (deposit < 5_000_000n || deposit > 500_000_000n)
      throw new TradeRejection("Prediction orders must be between $5 and $500.");
    const [usdc, solLamports] = await Promise.all([
      this.helius.getTokenBalance(input.wallet, USDC),
      this.helius.getSolLamports(input.wallet),
    ]);
    if (BigInt(usdc.rawBalance) < deposit + this.fees.feeFor(deposit))
      throw new TradeRejection(
        "Your wallet has insufficient USDC. Swap a token to USDC from your Portfolio first.",
      );
    if (BigInt(solLamports) < 1_000_000n)
      throw new TradeRejection("Add a little SOL for network fees.");
    const prepared = await this.panta.prepare({
      marketId: input.marketId,
      wallet: input.wallet,
      isYes: input.outcome === "yes",
      depositAmount: input.depositAmount,
    });
    // Sisera's fee is a USDC transfer added to the order, shown to the user before they sign.
    const charged = await this.fees.apply(prepared.transaction, input.wallet, deposit);
    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 90_000);
    await savePredictionOrder(this.config.DATABASE_URL, {
      id,
      tenantId: input.tenantId,
      subject: input.subject,
      wallet: input.wallet,
      marketId: input.marketId,
      outcome: input.outcome,
      depositAmount: input.depositAmount,
      orderPubkey: prepared.order.orderPubkey,
      unsignedTransaction: charged.transaction,
      expiresAt,
    });
    return {
      orderId: id,
      wallet: input.wallet,
      transaction: charged.transaction,
      orderPubkey: prepared.order.orderPubkey,
      feeUsd: (Number(charged.feeMicroUsdc) / 1e6).toFixed(2),
      priceUsd: prepared.priceUsd,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async execute(input: { subject: string; orderId: string; signedTransaction: string }) {
    if (!this.config.DATABASE_URL)
      throw new TradeRejection("Prediction order ledger is unavailable.", 503);
    const order = await claimPredictionOrder(
      this.config.DATABASE_URL,
      input.orderId,
      input.subject,
    );
    if (!order) throw new TradeRejection("This prediction order has expired. Review a new order.");
    try {
      verifySignedSwap(
        String(order.unsignedTransaction),
        input.signedTransaction,
        String(order.wallet),
      );
    } catch (error) {
      await finishPredictionOrder(this.config.DATABASE_URL, input.orderId, "failed");
      throw error;
    }
    let signature: string | undefined;
    try {
      const transaction = VersionedTransaction.deserialize(
        Buffer.from(input.signedTransaction, "base64"),
      );

      try {
        signature = await this.connection.sendRawTransaction(transaction.serialize(), {
          maxRetries: 3,
          skipPreflight: false,
        });
      } catch (sendError) {
        const rawMsg =
          sendError instanceof Error
            ? sendError.message
            : "Solana preflight transaction simulation failed";
        console.error("[prediction-trading] sendRawTransaction failed:", rawMsg);
        await finishPredictionOrder(this.config.DATABASE_URL, input.orderId, "failed");
        if (/blockhash/i.test(rawMsg)) {
          throw new TradeRejection(
            "Order expired before signing was completed. Please review and sign again.",
            422,
          );
        }
        if (/insufficient/i.test(rawMsg)) {
          throw new TradeRejection(
            "Insufficient USDC or SOL balance to execute this prediction order.",
            422,
          );
        }
        throw new TradeRejection(`Solana transaction rejected: ${rawMsg}`, 422);
      }

      // If signature was produced, the order has been broadcast to Solana validators.
      try {
        const confirmation = await Promise.race([
          this.connection.confirmTransaction(signature, "confirmed"),
          new Promise<{ value: { err: null } }>((resolve) =>
            setTimeout(() => resolve({ value: { err: null } }), 12_000),
          ),
        ]);
        if (confirmation.value.err) {
          await finishPredictionOrder(this.config.DATABASE_URL, input.orderId, "failed", signature);
          return { status: "failed", signature, orderPubkey: String(order.orderPubkey) };
        }
      } catch (confirmError) {
        console.warn(
          "[prediction-trading] confirmation timed out; order was broadcast:",
          signature,
          confirmError,
        );
      }

      await finishPredictionOrder(this.config.DATABASE_URL, input.orderId, "submitted", signature);
      return { status: "submitted", signature, orderPubkey: String(order.orderPubkey) };
    } catch (error) {
      if (error instanceof TradeRejection) throw error;
      console.error("[prediction-trading] execution error:", error);
      const finalStatus = signature ? "submitted" : "failed";
      await finishPredictionOrder(this.config.DATABASE_URL, input.orderId, finalStatus, signature);
      return {
        status: finalStatus,
        signature: signature ?? null,
        orderPubkey: String(order.orderPubkey),
        error: error instanceof Error ? error.message : "Unexpected trade error",
      };
    }
  }

  async orderStatus(orderPubkey: string) {
    return this.panta.orderStatus(orderPubkey);
  }
}
