import { PrivyClient } from "@privy-io/server-auth";
import { claimPredictionOrder, finishPredictionOrder, savePredictionOrder } from "@sisera/db";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import type { ApiConfig } from "./config.js";
import type { HeliusClient } from "./helius.js";
import { PantaPredictionTradingClient } from "./panta-prediction.js";
import { TradeRejection, verifySignedSwap } from "./solana-trading.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export class PredictionTradingService {
  private readonly privy: PrivyClient | null;
  private readonly panta: PantaPredictionTradingClient;
  private readonly connection: Connection;

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
    if (BigInt(usdc.rawBalance) < deposit)
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
    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 45_000);
    await savePredictionOrder(this.config.DATABASE_URL, {
      id,
      tenantId: input.tenantId,
      subject: input.subject,
      wallet: input.wallet,
      marketId: input.marketId,
      outcome: input.outcome,
      depositAmount: input.depositAmount,
      orderPubkey: prepared.order.orderPubkey,
      unsignedTransaction: prepared.transaction,
      expiresAt,
    });
    return {
      orderId: id,
      wallet: input.wallet,
      transaction: prepared.transaction,
      orderPubkey: prepared.order.orderPubkey,
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
      signature = await this.connection.sendRawTransaction(transaction.serialize(), {
        maxRetries: 0,
        skipPreflight: false,
      });
      const confirmation = await this.connection.confirmTransaction(signature, "confirmed");
      if (confirmation.value.err) {
        await finishPredictionOrder(this.config.DATABASE_URL, input.orderId, "failed", signature);
        return { status: "failed", signature, orderPubkey: String(order.orderPubkey) };
      }
      await finishPredictionOrder(this.config.DATABASE_URL, input.orderId, "submitted", signature);
      return { status: "submitted", signature, orderPubkey: String(order.orderPubkey) };
    } catch {
      await finishPredictionOrder(this.config.DATABASE_URL, input.orderId, "unknown", signature);
      return {
        status: "unknown",
        signature: signature ?? null,
        orderPubkey: String(order.orderPubkey),
      };
    }
  }

  async orderStatus(orderPubkey: string) {
    return this.panta.orderStatus(orderPubkey);
  }
}
